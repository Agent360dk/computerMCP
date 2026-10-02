// Menulinje-ikonet: viser at computer-mcp koerer, hvilke agenter, og hvad de goer.
//
// Tilfoejet 22/9 efter Gustavs oenske. Tre regler, alle fra samme loefte om
// aldrig at forstyrre:
//
//   1. Programmet AKTIVERER sig aldrig. Det er `.accessory` (intet Dock-ikon,
//      ingen menulinje af sin egen), og live-vinduet er et ikke-aktiverende
//      panel: det kommer kun frem naar mennesket selv klikker, og det tager
//      ikke fokus fra det vindue han skriver i.
//   2. Det kan kun LAESE. Hver server skriver sessions/<id>.json; ikonet laeser
//      mappen og kan intet godkende, sende eller aendre.
//   3. Det er der kun mens en agent lever. Er ingen server i live i ti
//      sekunder, lukker det sig selv.
//
// `--dump` skriver menuens indhold som JSON og lukker, uden at vise noget.
// Proeverne maaler DEN - samme kode bygger teksten til den rigtige menu.
import AppKit
import Foundation
import LocalAuthentication
import UserNotifications

// MARK: - Model

struct Post: Codable { let ts: String; let text: String; let outcome: String }
struct Session: Codable {
    let session: String
    let pid: Int32
    let client: String?
    let started: String
    let updated: String
    let now: Post?
    let recent: [Post]
}

let stateDir: String = {
    if let d = ProcessInfo.processInfo.environment["CMCP_STATE_DIR"], !d.isEmpty { return d }
    return (NSHomeDirectory() as NSString).appendingPathComponent(".local/state/computer-mcp")
}()
let sessionsDir = (stateDir as NSString).appendingPathComponent("sessions")
let pidFil = (stateDir as NSString).appendingPathComponent("status.pid")
let socketSti = (stateDir as NSString).appendingPathComponent("ikon.sock")

func lever(_ pid: Int32) -> Bool { pid > 0 && kill(pid, 0) == 0 }

func laesSessioner() -> [Session] {
    let fm = FileManager.default
    guard let navne = try? fm.contentsOfDirectory(atPath: sessionsDir) else { return [] }
    return navne.filter { $0.hasSuffix(".json") }.compactMap { navn in
        let sti = (sessionsDir as NSString).appendingPathComponent(navn)
        guard let data = fm.contents(atPath: sti),
              let s = try? JSONDecoder().decode(Session.self, from: data) else { return nil }
        return lever(s.pid) ? s : nil
    }.sorted { $0.started < $1.started }
}

let iso: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
}()

func siden(_ ts: String) -> String {
    guard let d = iso.date(from: ts) else { return "" }
    let s = Int(-d.timeIntervalSinceNow)
    if s < 60 { return "\(max(s, 0))s ago" }
    if s < 3600 { return "\(s / 60)m ago" }
    return "\(s / 3600)h ago"
}

func tegn(_ udfald: String) -> String {
    switch udfald {
    case "running": return "▶︎"
    case "ok": return "✓"
    case "refused": return "⊘"
    default: return "!"
    }
}

func navn(_ s: Session) -> String { "\(s.client ?? "agent") · \(s.session)" }

/// Linjen i rullemenuen for én agent. Den samme funktion bruges af --dump.
func menuLinje(_ s: Session) -> String {
    if let n = s.now { return "\(navn(s))  —  \(n.text)" }
    if let sidste = s.recent.last { return "\(navn(s))  —  idle, last: \(sidste.text) (\(siden(sidste.ts)))" }
    return "\(navn(s))  —  idle, nothing done yet"
}

func overskrift(_ n: Int) -> String {
    n == 1 ? "Computer MCP — 1 agent running" : "Computer MCP — \(n) agents running"
}

/// Live-vinduets tekst for én agent: nyeste oeverst.
func liveTekst(_ s: Session) -> String {
    var linjer = ["\(navn(s))   (pid \(s.pid), started \(siden(s.started)))", ""]
    if let n = s.now { linjer.append("NOW  ▶︎ \(n.text)"); linjer.append("") }
    for p in s.recent.reversed() {
        linjer.append("\(tegn(p.outcome)) \(siden(p.ts).padding(toLength: 8, withPad: " ", startingAt: 0)) \(p.text)")
    }
    if s.recent.isEmpty { linjer.append("Nothing done yet.") }
    linjer.append("")
    linjer.append("What is typed is never shown here, only how many characters.")
    return linjer.joined(separator: "\n")
}


// MARK: - «Kraever dig»: spoergsmaal fra serverne (22/9)
//
// En server der ellers ville afvise, forbinder hertil, sender ét spoergsmaal
// og venter. Svaret gaar tilbage ad SAMME forbindelse - intet skrives paa
// disken, og spoergsmaalet lever kun i denne proces' hukommelse.
// Et ja kraever at mennesket bekraefter at det er ham (Touch ID eller Mac'ens
// kodeord). Lukker serveren forbindelsen, forsvinder spoergsmaalet.

struct Spoergsmaal: Codable {
    let nonce: String
    let session: String
    let client: String?
    let text: String
    let scope: String
    let target: String
    let expires: Double
    /// nil = et samtykke (Touch ID). «goer-selv» = mennesket goer det selv, fx
    /// taster et kodeord; «Done» er et SIGNAL, aldrig et samtykke (29/9).
    let kind: String?
    /// Programmet «Take me there» henter frem - valgt af serveren, ikke modellen.
    let targetBundle: String?
    /// «skaerm»: hvor mange minutter skaermen laanes ud (hoejst 15).
    let minutes: Int?
}

final class Anmodning {
    let s: Spoergsmaal
    let fd: Int32
    var besvaret = false
    var lukket = false      // serveren gav op: svar aldrig paa denne forbindelse
    var ctx: LAContext?
    init(_ s: Spoergsmaal, fd: Int32) { self.s = s; self.fd = fd }

    /// ⛔ Runde 2: `close()` her, mens laesetraaden stadig sad i `read()`,
    ///    kunne give fd-nummeret til en NY forbindelse, som den gamle traad
    ///    saa stjal bytes fra. Nu ejer KUN laesetraaden `close`; her lukkes
    ///    kun skrivesiden.
    func svar(ok: Bool, verified: String? = nil) {
        guard !besvaret, !lukket else { return }
        besvaret = true
        let v = verified ?? (ok ? "owner" : "none")
        let linje = "{\"nonce\":\"\(s.nonce)\",\"ok\":\(ok),\"verified\":\"\(v)\"}\n"
        linje.withCString { p in _ = write(fd, p, strlen(p)) }
        shutdown(fd, SHUT_RDWR)
    }

    /// ⛔ SKAERM-LAANET (29/9): ja'et skrives, men forbindelsen holdes AABEN.
    ///    Laanet ER forbindelsen - naar den lukkes, er skaermen menneskets igen.
    func svarLaan(til: Double) {
        guard !besvaret, !lukket else { return }
        besvaret = true
        let linje = "{\"nonce\":\"\(s.nonce)\",\"ok\":true,\"verified\":\"owner\",\"until\":\(Int(til))}\n"
        linje.withCString { p in _ = write(fd, p, strlen(p)) }
    }
    func afslutLaan() { shutdown(fd, SHUT_RDWR) }
}

/// Hoejst ét laan ad gangen: skaermen er én.
var aktivtLaan: Anmodning?
var laanTil: Date?
var laanOpdateret: () -> Void = {}

var anmodninger: [Anmodning] = []
var nyAnmodning: (Anmodning) -> Void = { _ in }

func startSocket() {
    // ⛔ Runde 2: at skrive til en forbindelse serveren har lukket, giver
    //    SIGPIPE - og det draeber ikonet, og dermed alle andre agenters
    //    aabne spoergsmaal.
    signal(SIGPIPE, SIG_IGN)
    unlink(socketSti)
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { return }
    var adr = sockaddr_un()
    adr.sun_family = sa_family_t(AF_UNIX)
    let stiBytes = Array(socketSti.utf8CString)
    guard stiBytes.count <= MemoryLayout.size(ofValue: adr.sun_path) else { close(fd); return }
    withUnsafeMutableBytes(of: &adr.sun_path) { buf in
        for (i, b) in stiBytes.enumerated() { buf[i] = UInt8(bitPattern: b) }
    }
    let ok = withUnsafePointer(to: &adr) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            bind(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
        }
    }
    guard ok == 0 else { close(fd); return }
    chmod(socketSti, 0o600)
    listen(fd, 16)
    Thread.detachNewThread {
        while true {
            let k = accept(fd, nil, nil)
            if k < 0 { continue }
            Thread.detachNewThread { laesSpoergsmaal(k) }
        }
    }
}

func laesSpoergsmaal(_ k: Int32) {
    var data = Data()
    var buf = [UInt8](repeating: 0, count: 4096)
    // 64 KB: serveren sender teksten HEL (op til 4.000 tegn, 29/9); 16 KB kunne klippe den.
    while !data.contains(0x0A) && data.count < 65_536 {
        let n = read(k, &buf, buf.count)
        if n <= 0 { close(k); return }
        data.append(buf, count: n)
    }
    guard let i = data.firstIndex(of: 0x0A),
          let s = try? JSONDecoder().decode(Spoergsmaal.self, from: data[..<i]) else { close(k); return }
    let a = Anmodning(s, fd: k)
    DispatchQueue.main.async {
        // Skaerm-koe (2/10): en skaerm-anmodning mens et andet laan er aktivt
        // afvises IKKE laengere her - den staar i koen som enhver anden
        // anmodning. Serveren venter allerede taalmodigt (skaermVentetid());
        // menuen gatér «Allow» ud mens et andet laan loeber (menuNeedsUpdate).
        anmodninger.append(a)
        nyAnmodning(a)
        // ⛔ Astra, runde 2 (22/9): ikonet afkodede `expires` og brugte den
        //    aldrig. Et udloebet spoergsmaal blev staaende i menuen, og et
        //    Touch ID-ark kunne komme op for noget serveren havde opgivet.
        let om = max(0, (s.expires - Date().timeIntervalSince1970 * 1000) / 1000)
        DispatchQueue.main.asyncAfter(deadline: .now() + om + 0.5) {
            guard !a.besvaret, !a.lukket else { return }
            a.lukket = true
            a.ctx?.invalidate()
            anmodninger.removeAll { $0 === a }
            nyAnmodning(a)          // opdaterer ikonet (orange slukkes)
        }
    }
    // Venter paa at serveren lukker: saa er spoergsmaalet ikke laengere aabent.
    var en: UInt8 = 0
    while read(k, &en, 1) > 0 {}
    close(k)
    DispatchQueue.main.async {
        // Serveren gav op (eller vi svarede). Et Touch ID-ark der stadig er
        // oppe, lukkes: et ja efter fristen ville faa mennesket til at tro han
        // havde godkendt noget der allerede var afvist.
        a.lukket = true
        a.ctx?.invalidate()
        anmodninger.removeAll { $0 === a }
        // Forbindelsen er lukket: var det et laan, er skaermen menneskets igen.
        if aktivtLaan === a { aktivtLaan = nil; laanTil = nil; laanOpdateret() }
    }
}


/// Touch ID-arket er beslutnings-oejeblikket, saa det bygges af de FASTE felter
/// i fast raekkefoelge - hvem, hvor, og hvor meget et ja giver. Modellens egen
/// tekst kommer sidst, i anfoerselstegn. Sikkerhedskonsulenten, runde 2: arket
/// viste kun modellens tekst, og den kunne skubbe maalet ud eller lyve om det.
func touchIdTekst(_ a: Anmodning) -> String {
    let hvem = renTekst(a.s.client ?? "An agent")
    if a.s.kind == "screen" {
        let grund = kort(a.s.text, 90)
        return "lend \(hvem) your screen for \(max(1, min(15, a.s.minutes ?? 10))) minutes. It pauses when you use the keyboard or mouse; take it back any time from the menu bar. \u{201C}\(grund)\u{201D}"
    }
    let hvor = renTekst(a.s.target)
    let omfang = renTekst(a.s.scope)
    let hel = renTekst(a.s.text)
    // ⛔ 29/9: arket klippede ved 80 tegn uden at sige det. Nu siger det det -
    //    og hele teksten staar i menuen lige over «Allow».
    let hvad = hel.count > 80 ? "\(hel.prefix(80))… (\(hel.count) characters, all shown in the menu)" : hel
    return "let \(hvem) act in \(hvor). \(omfang) Action: \u{201C}\(hvad)\u{201D}"
}




/// Ét ja = ét menneske der bekraefter at det er ham. Uden det: nej.
func bekraeftMenneske(_ a: Anmodning, _ faerdig: @escaping (Bool) -> Void) {
    let ctx = LAContext()
    a.ctx = ctx
    var fejl: NSError?
    guard ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &fejl) else { faerdig(false); return }
    ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: touchIdTekst(a)) { ok, _ in
        DispatchQueue.main.async { faerdig(ok) }
    }
}


// MARK: - Boksen paa skaermen (23/9)
//
// ⛔ Gustav, 23/9: «det ikon, som du snakker om, er ikke noget jeg kan se».
//    Maalt samme dag: ikonet og alle otte andre statusikoner laa uden for
//    skaermen, fordi menulinjen var skjult. En flade der kan vaere usynlig,
//    er ingen flade. Hans oenske, ordret: «hver gang den koerer, kom en boks
//    op i hoejre hjoerne af skaermen, saa man kunne se, hvad den koerte paa»
//    + en knap til at foelge koerslen + et valg naar flere koerer.
//
// Boksen foelger de samme regler som alt andet i produktet:
//   - den AKTIVERER aldrig programmet og tager aldrig tastaturet
//     (.nonactivatingPanel + becomesKeyOnlyIfNeeded)
//   - den ligger paa alle skriveborde, men er ikke med i Cmd-Tab eller Mission
//     Control (.canJoinAllSpaces, .stationary, .ignoresCycle)
//   - den findes kun mens en agent koerer, og forsvinder af sig selv
//   - den kan flyttes med musen og skjules helt fra menuen
final class Boks: NSPanel {
    // ⛔ MAALT 23/9, foerste gang boksen blev vist: det forreste program
    //    skiftede fra IDE'en til status-programmet. En boks der tager fokus
    //    er praecis det produktet lover at lade vaere med - saa hellere ingen
    //    boks. Et vindue der aldrig kan blive noegle- eller hovedvindue, kan
    //    ikke tage tastaturet; knapperne virker stadig, fordi et
    //    .nonactivatingPanel sender museklik til sine knapper uden at
    //    programmet aktiveres.
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }

    let linje1 = NSTextField(labelWithString: "")
    let linje2 = NSTextField(labelWithString: "")
    let knap = NSButton(title: "Follow", target: nil, action: nil)
    let vaelger = NSPopUpButton(frame: .zero, pullsDown: false)
    var valgt: String? = nil

    init(bredde: CGFloat = 340) {
        super.init(contentRect: NSRect(x: 0, y: 0, width: bredde, height: 78),
                   styleMask: [.borderless, .nonactivatingPanel],
                   backing: .buffered, defer: false)
        level = .statusBar
        isFloatingPanel = true
        becomesKeyOnlyIfNeeded = true
        hidesOnDeactivate = false
        isMovableByWindowBackground = true
        isReleasedWhenClosed = false
        collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
        backgroundColor = .clear
        isOpaque = false
        hasShadow = true

        let baggrund = NSVisualEffectView(frame: contentView!.bounds)
        baggrund.autoresizingMask = [.width, .height]
        baggrund.material = .hudWindow
        baggrund.state = .active
        baggrund.wantsLayer = true
        baggrund.layer?.cornerRadius = 12
        baggrund.layer?.masksToBounds = true
        contentView?.addSubview(baggrund)

        linje1.font = .systemFont(ofSize: 12, weight: .semibold)
        linje1.frame = NSRect(x: 12, y: 50, width: bredde - 24, height: 16)
        linje2.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        linje2.textColor = .secondaryLabelColor
        linje2.frame = NSRect(x: 12, y: 30, width: bredde - 24, height: 16)
        linje2.lineBreakMode = .byTruncatingTail
        knap.frame = NSRect(x: bredde - 92, y: 6, width: 80, height: 20)
        knap.bezelStyle = .rounded
        knap.controlSize = .small
        knap.font = .systemFont(ofSize: 11)
        vaelger.frame = NSRect(x: 8, y: 5, width: bredde - 108, height: 22)
        vaelger.controlSize = .small
        vaelger.font = .systemFont(ofSize: 11)
        for v in [linje1, linje2, knap, vaelger] { baggrund.addSubview(v) }
    }

    /// Oeverst til hoejre paa den skaerm musen er paa, under menulinjen.
    func placer() {
        let skaerm = NSScreen.screens.first { NSMouseInRect(NSEvent.mouseLocation, $0.frame, false) } ?? NSScreen.main
        guard let f = skaerm?.visibleFrame else { return }
        setFrameTopLeftPoint(NSPoint(x: f.maxX - frame.width - 16, y: f.maxY - 12))
    }

    func opdater(_ sessioner: [Session], tilsluttede: Int = 0, venter: (Int, String)? = nil) {
        if let (antal, tekst) = venter {
            let l = ventendeBoks(antal: antal, tekst: tekst)
            vaelger.isHidden = true
            linje1.textColor = .systemOrange
            linje1.stringValue = l[0]
            linje2.stringValue = l[1]
            return
        }
        linje1.textColor = .labelColor
        let flere = sessioner.count > 1
        vaelger.isHidden = !flere
        if flere {
            let navne = sessioner.map { navn($0) }
            if vaelger.itemTitles != navne {
                vaelger.removeAllItems(); vaelger.addItems(withTitles: navne)
            }
            if let v = valgt, let i = sessioner.firstIndex(where: { $0.session == v }) { vaelger.selectItem(at: i) }
            valgt = sessioner[max(0, vaelger.indexOfSelectedItem)].session
        } else {
            valgt = sessioner.first?.session
        }
        let s = sessioner.first { $0.session == valgt } ?? sessioner.first
        guard let s else { return }
        // ⛔ Gustav 23/9: «der skal kun vaere det antal agenter, som der er live».
        //    Maalt samme dag: 15 servere koerte, 0 lavede noget. Et tal der
        //    blander «tilsluttet» og «arbejder» siger ingenting. Boksen viser
        //    dem der ARBEJDER, og naevner resten som tilsluttede.
        let hale = tilsluttede > sessioner.count ? " · \(tilsluttede) connected" : ""
        linje1.stringValue = (flere ? "Computer MCP - \(sessioner.count) working" : "Computer MCP - \(navn(s))") + hale
        if let n = s.now { linje2.stringValue = "> " + n.text }
        else if let sidste = s.recent.last { linje2.stringValue = "idle - last: \(sidste.text) (\(siden(sidste.ts)))" }
        else { linje2.stringValue = "idle" }
    }
}

// MARK: - Spoergsmaalets undermenu som ren tekst (29/9)
//
// Menuen OG --dump-question bygger af denne funktion, saa proeverne maaler den
// tekst mennesket faktisk ser - uden at ikonet nogensinde startes i en proeve.

struct SpoergsmaalMenu {
    let titel: String       // linjen i hovedmenuen
    let overskrift: String  // «The whole action (N characters):»
    let tekst: [String]     // hele handlingen, ombrudt
    let fakta: [String]     // omfang + hvor det lander (skrevet af serveren)
    let knapper: [String]   // i raekkefoelge
    let ventetekst: String? // sat naar et ANDET laan allerede er aktivt (skaerm-koe)
}

/// `aktivtAndetLaan`: et skaerm-laan en ANDEN anmodning allerede holder, hvis noget.
/// Sat -> «Allow» udelades (kun Deny), og ventetekst siger hvem og hvor laenge.
/// Skaerm-koeen 2/10: queue-trinnet gatér her, ikke ved at afvise forbindelsen -
/// samme funktion bygger baade den rigtige menu og --dump-question's svar.
func spoergsmaalMenu(_ s: Spoergsmaal, aktivtAndetLaan: (klient: String?, til: Date)? = nil) -> SpoergsmaalMenu {
    let hel = renTekst(s.text)
    var knapper: [String]
    if s.kind == "goer-selv" {
        knapper = (s.targetBundle != nil ? ["Take me there"] : []) + ["Done — I did it", "I won't do this"]
    } else {
        knapper = ["Allow… (confirm with Touch ID)", "Deny"]
    }
    var ventetekst: String? = nil
    if s.kind == "screen", let l = aktivtAndetLaan {
        knapper.removeAll { $0 == "Allow… (confirm with Touch ID)" }
        let rest = max(0, Int(ceil(l.til.timeIntervalSinceNow / 60)))
        ventetekst = "Waiting — the screen is lent to \(l.klient ?? "an agent") for \(rest) more minutes"
    }
    return SpoergsmaalMenu(
        titel: "\(s.client ?? "agent") · \(s.session): \(kort(s.text, 60))",
        overskrift: "The whole action (\(hel.count) characters):",
        tekst: ombryd(hel),
        fakta: [s.scope, "Lands in: \(s.target)"],
        knapper: knapper,
        ventetekst: ventetekst)
}

/// Oeverst i menuen mens skaermen er laant ud.
func laanLinjer(klient: String?, til: Date) -> [String] {
    let rest = max(0, Int(ceil(til.timeIntervalSinceNow / 60)))
    return ["\(klient ?? "An agent") is using your screen — \(rest) min left", "Take the screen back now"]
}

if CommandLine.arguments.contains("--dump-question") {
    // Et spoergsmaal paa stdin (samme JSON som socket'en) -> undermenuens tekst.
    let raa = FileHandle.standardInput.readDataToEndOfFile()
    guard let s = try? JSONDecoder().decode(Spoergsmaal.self, from: raa) else {
        FileHandle.standardError.write("could not read a question on stdin\n".data(using: .utf8)!); exit(2)
    }
    // Proeve-kun felt, IKKE en del af den rigtige socket-protokol (Spoergsmaal roeres ikke):
    // {"simulateActiveLoan": {"client": "andenagent", "minutesLeft": 4}} laeser skaerm-koeens
    // gatering uden en levende GUI - test/ikon-menu.mjs maaler den samme spoergsmaalMenu()
    // der ogsaa bygger den rigtige menu.
    var aktivtAndetLaan: (klient: String?, til: Date)? = nil
    if let raw = try? JSONSerialization.jsonObject(with: raa) as? [String: Any],
       let sim = raw["simulateActiveLoan"] as? [String: Any] {
        let min = (sim["minutesLeft"] as? Double) ?? (sim["minutesLeft"] as? Int).map(Double.init) ?? 1
        aktivtAndetLaan = (klient: sim["client"] as? String, til: Date().addingTimeInterval(min * 60))
    }
    let m = spoergsmaalMenu(s, aktivtAndetLaan: aktivtAndetLaan)
    var ud: [String: Any] = ["title": m.titel, "header": m.overskrift, "text": m.tekst, "facts": m.fakta,
                             "buttons": m.knapper, "touchId": touchIdTekst(Anmodning(s, fd: -1)),
                             "box": ventendeBoks(antal: 1, tekst: s.text)]
    if let v = m.ventetekst { ud["waitingForLoan"] = v }
    if s.kind == "screen" { ud["whileLent"] = laanLinjer(klient: s.client, til: Date().addingTimeInterval(Double(max(1, min(15, s.minutes ?? 10))) * 60)) }
    let data = try! JSONSerialization.data(withJSONObject: ud, options: [.prettyPrinted, .sortedKeys])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
    exit(0)
}

// MARK: - --dump (uden UI)

if CommandLine.arguments.contains("--dump") {
    let s = laesSessioner()
    let ud: [String: Any] = [
        "title": overskrift(s.count),
        "items": s.map(menuLinje),
        "live": s.map(liveTekst),
        "sessions": s.map { $0.session }
    ]
    let data = try! JSONSerialization.data(withJSONObject: ud, options: [.prettyPrinted, .sortedKeys])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
    exit(0)
}

// MARK: - Ét ikon ad gangen

if let gammel = try? String(contentsOfFile: pidFil, encoding: .utf8),
   let pid = Int32(gammel.trimmingCharacters(in: .whitespacesAndNewlines)),
   pid != getpid(), lever(pid) {
    exit(0)
}
try? FileManager.default.createDirectory(atPath: stateDir, withIntermediateDirectories: true)
try? String(getpid()).write(toFile: pidFil, atomically: true, encoding: .utf8)
chmod(pidFil, 0o600)
startSocket()

// MARK: - UI

final class LivePanel: NSObject, NSWindowDelegate {
    let panel: NSPanel
    let tekst: NSTextView
    var session: String
    var lukket: () -> Void = {}

    init(session: String) {
        self.session = session
        // ⛔ `.nonactivatingPanel`: vinduet kan vises uden at tage fokus fra
        //    det program mennesket skriver i. Det er hele forskellen paa et
        //    vindue man kigger paa og et vindue der afbryder.
        panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 520, height: 340),
                        styleMask: [.titled, .closable, .resizable, .utilityWindow, .nonactivatingPanel],
                        backing: .buffered, defer: false)
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.isReleasedWhenClosed = false
        let scroll = NSScrollView(frame: panel.contentView!.bounds)
        scroll.autoresizingMask = [.width, .height]
        scroll.hasVerticalScroller = true
        tekst = NSTextView(frame: scroll.bounds)
        tekst.isEditable = false
        tekst.isSelectable = true
        tekst.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        tekst.autoresizingMask = [.width]
        scroll.documentView = tekst
        panel.contentView?.addSubview(scroll)
        super.init()
        panel.delegate = self
    }

    func vis() {
        opdater()
        if !panel.isVisible {
            if let skaerm = NSScreen.main?.visibleFrame {
                panel.setFrameTopLeftPoint(NSPoint(x: skaerm.maxX - 540, y: skaerm.maxY - 10))
            }
        }
        panel.orderFrontRegardless()   // frem, men IKKE aktiveret
    }

    func opdater() {
        guard let s = laesSessioner().first(where: { $0.session == session }) else {
            panel.title = "Computer MCP — agent \(session) has stopped"
            return
        }
        panel.title = "Computer MCP — \(navn(s))"
        let ny = liveTekst(s)
        if tekst.string != ny { tekst.string = ny }
    }

    func windowWillClose(_ n: Notification) { lukket() }
}

final class Ikon: NSObject, NSMenuDelegate {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    let menu = NSMenu()
    var paneler: [String: LivePanel] = [:]
    var tomSiden: Date? = nil
    lazy var boks: Boks = {
        let b = Boks()
        b.knap.target = self
        b.knap.action = #selector(foelgFraBoks)
        b.vaelger.target = self
        b.vaelger.action = #selector(skiftIBoks)
        return b
    }()
    var boksSlaaetFra: Bool {
        get { UserDefaults.standard.bool(forKey: "boks-fra") }
        set { UserDefaults.standard.set(newValue, forKey: "boks-fra") }
    }

    override init() {
        super.init()
        if let knap = item.button {
            knap.image = NSImage(systemSymbolName: "cursorarrow.rays", accessibilityDescription: "Computer MCP")
            knap.imagePosition = .imageLeading
            knap.toolTip = "Computer MCP"
        }
        menu.delegate = self
        item.menu = menu
        let t = Timer(timeInterval: 1.0, repeats: true) { [weak self] _ in self?.tik() }
        RunLoop.main.add(t, forMode: .common)
        tik()
    }

    func tik() {
        let s = laesSessioner()
        let aabne = anmodninger.filter { !$0.besvaret }
        if !aabne.isEmpty {
            item.button?.contentTintColor = .systemOrange
            item.button?.title = " \(aabne.count)"
            item.button?.appearsDisabled = false
        } else {
            item.button?.contentTintColor = nil
            item.button?.title = s.count > 1 ? " \(s.count)" : ""
            item.button?.appearsDisabled = !s.contains { $0.now != nil }
        }
        for p in paneler.values where p.panel.isVisible { p.opdater() }
        // Boksen paa skaermen: findes kun mens der faktisk SKER noget.
        // ⛔ 23/9: paa maskinen her koerer 15 agenter hele tiden. «Mens en agent
        //    koerer» ville betyde doegnet rundt, og saa er boksen ikke en besked,
        //    men inventar. Den vises naar noget arbejder nu, eller har gjort det
        //    inden for et halvt minut - eller naar et spoergsmaal venter.
        let arbejder = s.contains { $0.now != nil }
            || s.contains { (iso.date(from: $0.updated).map { -$0.timeIntervalSinceNow } ?? 999) < 30 }
            || !anmodninger.filter { !$0.besvaret }.isEmpty
        if s.isEmpty || boksSlaaetFra || !arbejder {
            if boks.isVisible { boks.orderOut(nil) }
        } else {
            boks.opdater(s.filter { $0.now != nil || (iso.date(from: $0.updated).map { -$0.timeIntervalSinceNow } ?? 999) < 30 },
                         tilsluttede: s.count,
                         venter: aabne.first.map { (aabne.count, $0.s.text) })
            if !boks.isVisible { boks.placer(); boks.orderFrontRegardless() }
        }
        if s.isEmpty && anmodninger.isEmpty {
            if tomSiden == nil { tomSiden = Date() }
            if let t = tomSiden, Date().timeIntervalSince(t) > 10 { afslut() }
        } else { tomSiden = nil }
    }

    func menuNeedsUpdate(_ m: NSMenu) {
        m.removeAllItems()
        // Skaermen er laant ud: det OEVERSTE mennesket ser, og én knap til at tage den tilbage.
        if let l = aktivtLaan, !l.lukket, let til = laanTil {
            let ll = laanLinjer(klient: l.s.client, til: til)
            let h = NSMenuItem(title: ll[0], action: nil, keyEquivalent: "")
            h.isEnabled = false
            m.addItem(h)
            let tilbage = NSMenuItem(title: ll[1], action: #selector(tagTilbage), keyEquivalent: "")
            tilbage.target = self
            m.addItem(tilbage)
            m.addItem(.separator())
        }
        let s = laesSessioner()
        let aabne = anmodninger.filter { !$0.besvaret }
        if !aabne.isEmpty {
            let h = NSMenuItem(title: aabne.count == 1 ? "Needs you — 1 question" : "Needs you — \(aabne.count) questions", action: nil, keyEquivalent: "")
            h.isEnabled = false
            m.addItem(h)
            for a in aabne {
                // Selve «Allow» ligger i en undermenu: ét klik i hovedmenuen maa
                // aldrig vaere et ja, og menuen kan bygges om mens den er aaben.
                // Teksten kommer fra spoergsmaalMenu - den samme som --dump-question.
                // Skaerm-koe (2/10): et ANDET aktivt laan gatér «Allow» ud af denne
                // anmodnings egen undermenu - hun staar i koen, serveren venter allerede.
                let andetLaan: (klient: String?, til: Date)? =
                    (a.s.kind == "screen" && aktivtLaan != nil && aktivtLaan !== a) ? (aktivtLaan!.s.client, laanTil!) : nil
                let mm = spoergsmaalMenu(a.s, aktivtAndetLaan: andetLaan)
                let i = NSMenuItem(title: mm.titel, action: nil, keyEquivalent: "")
                let sub = NSMenu()
                // ⛔ HELE teksten, ombrudt, over knapperne (29/9, panelet): et ja
                //    skal daekke alt mennesket saa. Sort, ikke graa.
                let top = NSMenuItem(title: "", action: nil, keyEquivalent: "")
                top.attributedTitle = NSAttributedString(string: mm.overskrift,
                    attributes: [.font: NSFont.menuFont(ofSize: 0), .foregroundColor: NSColor.secondaryLabelColor])
                top.isEnabled = false
                sub.addItem(top)
                for linje in mm.tekst {
                    let l = NSMenuItem(title: "", action: nil, keyEquivalent: "")
                    l.attributedTitle = NSAttributedString(string: linje,
                        attributes: [.font: NSFont.menuFont(ofSize: 0), .foregroundColor: NSColor.labelColor])
                    l.isEnabled = false
                    sub.addItem(l)
                }
                sub.addItem(.separator())
                for linje in mm.fakta {
                    let l = NSMenuItem(title: linje, action: nil, keyEquivalent: "")
                    l.isEnabled = false
                    sub.addItem(l)
                }
                if let v = mm.ventetekst {
                    let l = NSMenuItem(title: v, action: nil, keyEquivalent: "")
                    l.isEnabled = false
                    sub.addItem(l)
                    sub.addItem(.separator())
                }
                // «Done» paa et goer-selv-spoergsmaal kraever intet Touch ID: det
                // giver ingen lov til noget, det siger kun at det er gjort (29/9).
                for knap in mm.knapper {
                    let handling: Selector
                    switch knap {
                    case "Take me there": handling = #selector(hentFrem(_:))
                    case "Done — I did it": handling = #selector(gjort(_:))
                    case "Allow… (confirm with Touch ID)": handling = #selector(tillad(_:))
                    default: handling = #selector(afvis(_:))
                    }
                    let k = NSMenuItem(title: knap, action: handling, keyEquivalent: "")
                    k.target = self; k.representedObject = a.s.nonce
                    sub.addItem(k)
                }
                i.submenu = sub
                m.addItem(i)
            }
            m.addItem(.separator())
        }
        let top = NSMenuItem(title: overskrift(s.count), action: nil, keyEquivalent: "")
        top.isEnabled = false
        m.addItem(top)
        m.addItem(.separator())
        for sess in s {
            let i = NSMenuItem(title: menuLinje(sess), action: #selector(foelg(_:)), keyEquivalent: "")
            i.target = self
            i.representedObject = sess.session
            i.toolTip = "Follow this agent live"
            m.addItem(i)
        }
        if s.isEmpty {
            let i = NSMenuItem(title: "No agent is running", action: nil, keyEquivalent: "")
            i.isEnabled = false
            m.addItem(i)
        }
        m.addItem(.separator())
        let boksPunkt = NSMenuItem(title: "Show the box on screen while an agent runs", action: #selector(skiftBoks), keyEquivalent: "")
        boksPunkt.target = self
        boksPunkt.state = boksSlaaetFra ? .off : .on
        m.addItem(boksPunkt)
        let banner = NSMenuItem(title: "Show a banner when an agent needs you", action: #selector(skiftBanner), keyEquivalent: "")
        banner.target = self
        banner.state = UserDefaults.standard.bool(forKey: "banner") ? .on : .off
        m.addItem(banner)
        let skjul = NSMenuItem(title: "Hide this icon until the next agent starts", action: #selector(skjulIkon), keyEquivalent: "")
        skjul.target = self
        m.addItem(skjul)
    }

    @objc func foelg(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        let p = paneler[id] ?? LivePanel(session: id)
        p.lukket = { [weak self] in self?.paneler[id] = nil }
        paneler[id] = p
        p.vis()
    }

    @objc func skjulIkon() { afslut() }

    @objc func foelgFraBoks() {
        guard let id = boks.valgt else { return }
        let i = NSMenuItem(); i.representedObject = id
        foelg(i)
    }

    @objc func skiftIBoks() {
        let s = laesSessioner()
        let i = boks.vaelger.indexOfSelectedItem
        if i >= 0 && i < s.count { boks.valgt = s[i].session; boks.opdater(s) }
    }

    @objc func skiftBoks() {
        boksSlaaetFra = !boksSlaaetFra
        tik()
    }

    func find(_ sender: NSMenuItem) -> Anmodning? {
        guard let n = sender.representedObject as? String else { return nil }
        return anmodninger.first { $0.s.nonce == n && !$0.besvaret }
    }

    /// ⛔ MAALING, ikke vagt (22/9): sikkerhedskonsulenten foreslog at afvise
    ///    klik der ikke kommer fra hardware. Hvad et AEGTE klik i en statusmenu
    ///    baerer af kilde-felter, er umaalt - en vagt bygget paa et gaet kunne
    ///    afvise mennesket selv. Saa foerst maales et rigtigt klik.
    func noterKilde(_ hvad: String) {
        var d: [String: Any] = ["ts": Date().timeIntervalSince1970, "action": hvad]
        if let e = NSApp.currentEvent {
            d["type"] = Int(e.type.rawValue)
            if let cg = e.cgEvent {
                d["sourcePid"] = cg.getIntegerValueField(.eventSourceUnixProcessID)
                d["sourceState"] = cg.getIntegerValueField(.eventSourceStateID)
                d["userData"] = cg.getIntegerValueField(.eventSourceUserData)
            }
        } else { d["type"] = "none" }
        guard let data = try? JSONSerialization.data(withJSONObject: d),
              var linje = String(data: data, encoding: .utf8) else { return }
        linje += "\n"
        let sti = (stateDir as NSString).appendingPathComponent("klik-kilde.jsonl")
        if let h = FileHandle(forWritingAtPath: sti) { h.seekToEndOfFile(); h.write(linje.data(using: .utf8)!); h.closeFile() }
        else { FileManager.default.createFile(atPath: sti, contents: linje.data(using: .utf8), attributes: [.posixPermissions: 0o600]) }
    }

    @objc func tillad(_ sender: NSMenuItem) {
        noterKilde("allow")
        guard let a = find(sender) else { return }
        bekraeftMenneske(a) { [weak self] ok in
            // Et mislykket Touch ID er et nej, ikke et «proev igen» agenten kan vente paa.
            if ok && a.s.kind == "screen" {
                if let l = aktivtLaan, !l.lukket, l !== a {
                    // Skaerm-koe (2/10): kaploeb - et andet laan blev givet mellem at
                    // menuen blev aabnet og klikket (gatingen i menuNeedsUpdate missede
                    // det). Intet svar sendes: anmodningen bliver staaende i koen og
                    // faar en frisk «Allow» naar det andet laan slutter, i stedet for at
                    // tvinge agenten til at spoerge forfra.
                    self?.tik()
                    return
                }
                let minutter = max(1, min(15, a.s.minutes ?? 10))
                let til = Date().addingTimeInterval(Double(minutter) * 60)
                a.svarLaan(til: til.timeIntervalSince1970 * 1000)
                aktivtLaan = a; laanTil = til
                DispatchQueue.main.asyncAfter(deadline: .now() + Double(minutter) * 60) {
                    if aktivtLaan === a { a.afslutLaan() }
                }
            } else {
                a.svar(ok: ok)
            }
            anmodninger.removeAll { $0 === a }
            self?.tik()
        }
    }

    /// Tag skaermen tilbage: intet Touch ID - at STOPPE kraever aldrig bevis.
    @objc func tagTilbage() {
        noterKilde("take-back")
        aktivtLaan?.afslutLaan()
    }

    /// «Done» paa et goer-selv-spoergsmaal: et signal, ikke et samtykke.
    @objc func gjort(_ sender: NSMenuItem) {
        noterKilde("done")
        guard let a = find(sender), a.s.kind == "goer-selv" else { return }
        a.svar(ok: true, verified: "done")
        anmodninger.removeAll { $0 === a }
        tik()
    }

    /// «Take me there»: MENNESKETS klik henter programmet frem - ikke agentens.
    @objc func hentFrem(_ sender: NSMenuItem) {
        guard let a = find(sender), let b = a.s.targetBundle else { return }
        NSRunningApplication.runningApplications(withBundleIdentifier: b).first?.activate(options: [])
    }

    @objc func afvis(_ sender: NSMenuItem) {
        noterKilde("deny")
        guard let a = find(sender) else { return }
        a.svar(ok: false)
        anmodninger.removeAll { $0 === a }
        tik()
    }

    /// Banneret er FRA som standard: det orange ikon er notifikationen.
    /// Slaaet til viser det aldrig knapper - et banner med «Allow» ville vaere
    /// endnu en vej til et ja, og en agent kan klikke paa et banner.
    @objc func skiftBanner() {
        let nu = !UserDefaults.standard.bool(forKey: "banner")
        UserDefaults.standard.set(nu, forKey: "banner")
        if nu { UNUserNotificationCenter.current().requestAuthorization(options: [.alert]) { _, _ in } }
    }

    func vis(_ a: Anmodning) {
        tik()
        // Et nyt spoergsmaal flytter boksen hen hvor mennesket er (30/9, live-proeven).
        if boks.isVisible { boks.placer(); boks.orderFrontRegardless() }
        guard UserDefaults.standard.bool(forKey: "banner") else { return }
        let c = UNMutableNotificationContent()
        c.title = "An agent needs you"
        c.body = "\(a.s.client ?? "agent"): \(kort(a.s.text, 120))"
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: a.s.nonce, content: c, trigger: nil))
    }

    func afslut() {
        if let pid = try? String(contentsOfFile: pidFil, encoding: .utf8),
           pid.trimmingCharacters(in: .whitespacesAndNewlines) == String(getpid()) {
            try? FileManager.default.removeItem(atPath: pidFil)
            unlink(socketSti)
        }
        NSApp.terminate(nil)
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
// ⛔ Og en sele til livremmen: bliver programmet alligevel aktivt ved start
//    (maalt 23/9 - det gjorde det), giver vi fokus tilbage med det samme.
DispatchQueue.main.async { if NSApp.isActive { NSApp.deactivate() } }
let ikon = Ikon()
nyAnmodning = { a in ikon.vis(a) }
laanOpdateret = { ikon.tik() }
app.run()
