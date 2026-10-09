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

// D3 (2/10): `target` er den raa app-streng (bundle-id ELLER synligt navn) serveren
// allerede havde i hånden - se status.js' statusHandling for hvorfor den ikke
// slås op dér. Mangler nøglen i ældre/andre poster, afkodes den som nil (Codable).
struct Post: Codable { let ts: String; let text: String; let outcome: String; let target: String? }
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
/// D3 (2/10): det seneste KENDTE maal - den igangvaerende handling hvis der er
/// én, ellers den sidst FAERDIGE. `now` er kun sat de faa millisekunder en
/// handling rent faktisk koerer; uden faldbagget til `recent` ville "Show me
/// where" naesten aldrig vaere aktiv, fordi de fleste handlinger er for hurtige
/// til at nogen naar at se dem som "now".
func senesteMaal(_ s: Session) -> String? {
    s.now?.target ?? s.recent.last?.target
}

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
        return "lend \(hvem) your screen for \(max(1, min(15, a.s.minutes ?? 10))) minutes. It pauses when you use the keyboard or mouse; take it back any time from the box or the menu bar. \u{201C}\(grund)\u{201D}"
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

    let bredde: CGFloat
    let titel = NSTextField(labelWithString: "")
    let tekst = NSTextField(wrappingLabelWithString: "")
    let knapper = NSStackView()
    /// Stopknappen i sin egen raekke (R24: med gør-selv-knapperne var raekken 465 af 336 px).
    let stopRaekke = NSStackView()
    let vaelger = NSPopUpButton(frame: .zero, pullsDown: false)
    let stak = NSStackView()
    var valgt: String? = nil
    /// Det spoergsmaal knapperne svarer paa - sat i SAMME opdatering som teksten,
    /// saa et klik altid gaelder det mennesket saa.
    private(set) var nonce: String? = nil
    private var vist: BoksIndhold? = nil
    /// Hvornaar det viste spoergsmaal kom, og om Touch ID-arket er oppe (R17, Opus).
    private var nytSpoergsmaal = Date.distantPast
    var touchIdIGang = false { didSet { opdaterKnapper() } }
    func knapperAktive() -> Bool {
        boksKnapperAktive(sidenNytSpoergsmaal: Date().timeIntervalSince(nytSpoergsmaal), touchIdIGang: touchIdIGang)
    }
    func opdaterKnapper() {
        let aktiv = nonce == nil || knapperAktive()
        // Stopknappen slaas aldrig fra: at tage skaermen tilbage maa aldrig vente (R22).
        for case let b as NSButton in knapper.arrangedSubviews { b.isEnabled = aktiv || b.title == TAG_TILBAGE }
    }
    /// Den skaerm boksen sidst blev sat paa.
    private(set) var placeretPaa: CGRect? = nil
    /// (knappens titel, det spoergsmaal KNAPPEN blev lavet til) - R17 (Astra).
    var knapTrykket: (String, String?) -> Void = { _, _ in }

    init(bredde: CGFloat = 360) {
        self.bredde = bredde
        super.init(contentRect: NSRect(x: 0, y: 0, width: bredde, height: 78),
                   styleMask: [.borderless, .nonactivatingPanel],
                   backing: .buffered, defer: false)
        // ⛔ R22/R24 (Opus, MAALT): laget skal saettes EFTER isFloatingPanel - samlet i
        //    boksPanelOpsaetning (Tekst.swift), som prøven maaler paa et rigtigt panel.
        boksPanelOpsaetning(self)

        let baggrund = NSVisualEffectView(frame: contentView!.bounds)
        baggrund.autoresizingMask = [.width, .height]
        baggrund.material = .hudWindow
        baggrund.state = .active
        baggrund.wantsLayer = true
        baggrund.layer?.cornerRadius = 12
        baggrund.layer?.masksToBounds = true
        contentView?.addSubview(baggrund)

        titel.font = .systemFont(ofSize: 12, weight: .semibold)
        tekst.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        tekst.textColor = .labelColor
        tekst.preferredMaxLayoutWidth = bredde - 24
        tekst.maximumNumberOfLines = 0
        vaelger.controlSize = .small
        vaelger.font = .systemFont(ofSize: 11)
        knapper.orientation = .horizontal
        knapper.spacing = 8
        stak.orientation = .vertical
        stak.alignment = .leading
        stak.spacing = 6
        stak.edgeInsets = NSEdgeInsets(top: 10, left: 12, bottom: 10, right: 12)
        stak.translatesAutoresizingMaskIntoConstraints = false
        stopRaekke.orientation = .horizontal
        for v in [titel, tekst, stopRaekke, knapper] as [NSView] { stak.addArrangedSubview(v) }
        baggrund.addSubview(stak)
        NSLayoutConstraint.activate([
            stak.leadingAnchor.constraint(equalTo: baggrund.leadingAnchor),
            stak.trailingAnchor.constraint(equalTo: baggrund.trailingAnchor),
            stak.topAnchor.constraint(equalTo: baggrund.topAnchor),
            tekst.widthAnchor.constraint(equalToConstant: bredde - 24),
        ])
    }

    /// Oeverst til hoejre paa den skaerm mennesket arbejder paa: den med det
    /// forreste vindue, ellers den med musen (boksSkaerm i Tekst.swift).
    func placer() {
        let skaerme = NSScreen.screens
        guard !skaerme.isEmpty else { return }
        let i = boksSkaerm(forrestVindue: forrestVindue(), mus: NSEvent.mouseLocation, skaerme: skaerme.map { $0.frame })
        let f = skaerme[i].visibleFrame
        setFrameTopLeftPoint(boksHjoerne(synlig: f, bredde: frame.width))
        placeretPaa = skaerme[i].frame
    }

    /// Er mennesket gaaet over paa en anden skaerm, siden boksen blev sat?
    func skalFlyttes() -> Bool {
        let skaerme = NSScreen.screens
        guard !skaerme.isEmpty else { return false }
        let i = boksSkaerm(forrestVindue: forrestVindue(), mus: NSEvent.mouseLocation, skaerme: skaerme.map { $0.frame })
        return placeretPaa != skaerme[i].frame
    }

    func vis(_ ind: BoksIndhold, nonce ny: String?, sessioner: [Session]) {
        if ind == vist && ny == nonce { return }
        if ny != nonce && ny != nil {
            nytSpoergsmaal = Date()
            DispatchQueue.main.asyncAfter(deadline: .now() + BOKS_PAUSE + 0.05) { [weak self] in self?.opdaterKnapper() }
        }
        vist = ind; nonce = ny
        titel.stringValue = ind.titel
        titel.textColor = ind.orange ? .systemOrange : .labelColor
        tekst.stringValue = ind.linjer.joined(separator: "\n")
        for r in [knapper, stopRaekke] { for v in r.arrangedSubviews { r.removeArrangedSubview(v); v.removeFromSuperview() } }
        // Flere agenter: vaelgeren bestemmer hvem «Follow» foelger.
        // Vaelgeren og Follow: kun naar intet spoergsmaal vises (R24, Astra: et laan er
        // ogsaa orange, og saa blev `valgt` aldrig opdateret).
        if ny == nil && sessioner.count > 1 {
            let navne = sessioner.map { navn($0) }
            if vaelger.itemTitles != navne { vaelger.removeAllItems(); vaelger.addItems(withTitles: navne) }
            if let v = valgt, let i = sessioner.firstIndex(where: { $0.session == v }) { vaelger.selectItem(at: i) }
            knapper.addArrangedSubview(vaelger)
        }
        if ny == nil {
            let i = vaelger.indexOfSelectedItem
            valgt = (sessioner.count > 1 && sessioner.indices.contains(i)) ? sessioner[i].session : sessioner.first?.session
        }
        for k in ind.knapper {
            let b = NSButton(title: k, target: self, action: #selector(tryk(_:)))
            // Knappen baerer selv sit spoergsmaal - ikke boksens nuvaerende (R17, Astra).
            b.identifier = NSUserInterfaceItemIdentifier("boks-" + (ny ?? ""))
            b.bezelStyle = .rounded
            b.controlSize = .small
            b.font = .systemFont(ofSize: 11)
            if k == TAG_TILBAGE { stopRaekke.addArrangedSubview(b) } else { knapper.addArrangedSubview(b) }
        }
        knapper.isHidden = knapper.arrangedSubviews.isEmpty
        stopRaekke.isHidden = stopRaekke.arrangedSubviews.isEmpty
        opdaterKnapper()
        stak.layoutSubtreeIfNeeded()
        let hoejde = ceil(stak.fittingSize.height)
        let top = frame.maxY
        setContentSize(NSSize(width: bredde, height: hoejde))
        setFrameTopLeftPoint(NSPoint(x: frame.minX, y: top))
    }

    @objc func tryk(_ b: NSButton) {
        let id = b.identifier?.rawValue ?? ""
        knapTrykket(b.title, id.count > 5 ? String(id.dropFirst(5)) : nil)
    }
}

/// ⛔ 9/10 (F1, MAALT): serveren starter ikonet med `open -g -j`, og «-j» starter det
///    SKJULT. Et skjult program viser ingen vinduer: boksen kom aldrig frem - hverken i
///    0.2.1 eller 0.2.2 - naar serveren startede ikonet (visible = false, CGWindowList uden
///    onscreen, paa intet skrivebord). Kun naar ikonet blev startet direkte (liveproeven
///    13:07) kunne den ses. Nu goeres programmet synligt UDEN at blive aktivt: fokus bliver hos
///    mennesket, og boksen kommer frem.
func visBoksen(_ b: NSPanel) {
    if NSApp.isHidden { NSApp.unhideWithoutActivation() }
    b.orderFrontRegardless()
}

/// Det forreste programs forreste almindelige vindue, i Cocoa-koordinater - eller nil.
func forrestVindue() -> CGRect? {
    guard let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier,
          let hovedHoejde = NSScreen.screens.first?.frame.height,
          let liste = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]],
          let r = forrestVinduesRamme(liste, pid: pid)
    else { return nil }
    return cocoaRamme(r, hovedHoejde: hovedHoejde)
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
    return [laanTekst(klient: klient, minutterTilbage: rest), TAG_TILBAGE]
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
                             "box": { () -> [String: Any] in
                                 // Boksen i hjoernet for samme spoergsmaal - samme funktion som den rigtige boks.
                                 let b = boksIndhold(arbejder: [], tilsluttede: 0,
                                                     venter: (antal: 1, klient: s.client, tekst: s.text, fakta: m.fakta, menuKnapper: m.knapper))
                                 return ["title": b.titel, "orange": b.orange, "lines": b.linjer, "buttons": b.knapper]
                             }()]
    if let v = m.ventetekst { ud["waitingForLoan"] = v }
    if s.kind == "screen" {
        let minutter = max(1, min(15, s.minutes ?? 10))
        ud["whileLent"] = laanLinjer(klient: s.client, til: Date().addingTimeInterval(Double(minutter) * 60))
        // Boksen mens laanet varer (R22) - samme funktion som den rigtige boks.
        let b = boksIndhold(arbejder: [], tilsluttede: 1, venter: nil, laan: (klient: s.client, minutter: minutter))
        ud["boxWhileLent"] = ["title": b.titel, "orange": b.orange, "lines": b.linjer, "buttons": b.knapper]
    }
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
        "sessions": s.map { $0.session },
        // D3: maalet for den igangvaerende handling, saa en proeve kan maale at
        // det naar helt frem til --dump uden en levende GUI. nil -> NSNull (JSON null).
        "nowTarget": s.map { sess -> Any in
            if let t = senesteMaal(sess) { return t }
            return NSNull()
        }
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
    let visKnap = NSButton(title: "Show me where", target: nil, action: nil)
    var session: String
    var lukket: () -> Void = {}
    var maal: String? = nil   // raa app-streng fra den igangvaerende handling (D3)

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
        // D3 (2/10): en knaprad nederst, resten scroller. MENNESKETS klik henter
        // programmet frem - samme princip som "Take me there" paa et samtykke
        // (hentFrem): agenten selv roerer aldrig forgrunden.
        let hoejde = panel.contentView!.bounds.height
        let scroll = NSScrollView(frame: NSRect(x: 0, y: 32, width: panel.contentView!.bounds.width, height: hoejde - 32))
        scroll.autoresizingMask = [.width, .height]
        scroll.hasVerticalScroller = true
        tekst = NSTextView(frame: scroll.bounds)
        tekst.isEditable = false
        tekst.isSelectable = true
        tekst.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        tekst.autoresizingMask = [.width]
        scroll.documentView = tekst
        panel.contentView?.addSubview(scroll)
        visKnap.frame = NSRect(x: 12, y: 6, width: 160, height: 22)
        visKnap.bezelStyle = .rounded
        visKnap.controlSize = .small
        visKnap.autoresizingMask = [.maxXMargin]
        visKnap.isEnabled = false
        panel.contentView?.addSubview(visKnap)
        super.init()
        visKnap.target = self
        visKnap.action = #selector(visMigHvor)
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
            maal = nil; visKnap.isEnabled = false
            return
        }
        panel.title = "Computer MCP — \(navn(s))"
        let ny = liveTekst(s)
        if tekst.string != ny { tekst.string = ny }
        maal = senesteMaal(s)
        visKnap.isEnabled = maal != nil
    }

    /// MENNESKETS klik - aldrig agentens. Proever bundle-id foerst (det
    /// aegte format), falder tilbage til et synligt navn (det modellen kan
    /// have skrevet i stedet). Finder den intet, sker der ingenting - ingen
    /// fejlboks, ingen gaetten paa et andet program.
    @objc func visMigHvor() {
        guard let m = maal, !m.isEmpty else { return }
        if let app = NSRunningApplication.runningApplications(withBundleIdentifier: m).first {
            app.activate(options: [])
            return
        }
        NSWorkspace.shared.runningApplications.first { $0.localizedName == m }?.activate(options: [])
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
        b.vaelger.target = self
        b.vaelger.action = #selector(skiftIBoks)
        b.knapTrykket = { [weak self] knap, nonce in self?.boksKnapTrykket(knap, nonce: nonce) }
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
        // En skaerm sat i eller taget ud: boksen hen paa en skaerm der findes (9/10).
        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification,
                                               object: nil, queue: .main) { [weak self] _ in
            if self?.boks.isVisible == true { self?.boks.placer() }
        }
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
        // ⛔ R22: et aktivt skaerm-laan holder boksen fremme - ogsaa naar agenten er stille,
        //    og ogsaa naar boksen er slaaet fra i menuen - for stopknappen skal kunne ses.
        let laan: (klient: String?, minutter: Int)? = {
            guard let l = aktivtLaan, !l.lukket, let til = laanTil else { return nil }
            return (klient: l.s.client, minutter: max(0, Int(ceil(til.timeIntervalSinceNow / 60))))
        }()
        if !boksSynlig(laan: laan != nil, sessioner: s.count, slaaetFra: boksSlaaetFra, arbejder: arbejder) {
            if boks.isVisible { boks.orderOut(nil) }
        } else {
            let aktive = s.filter { $0.now != nil || (iso.date(from: $0.updated).map { -$0.timeIntervalSinceNow } ?? 999) < 30 }
            let foerste = aabne.first
            let venter = foerste.map { a in
                let mm = spoergsmaalMenu(a.s, aktivtAndetLaan: andetLaan(a))
                return (antal: aabne.count, klient: a.s.client, tekst: a.s.text, fakta: mm.fakta, menuKnapper: mm.knapper)
            }
            let arbejdende = aktive.map { sess in
                (navn: navn(sess), maal: senesteMaal(sess),
                 nu: sess.now.map { $0.text } ?? sess.recent.last.map { "idle - last: \($0.text) (\(siden($0.ts)))" } ?? "idle")
            }
            boks.vis(boksIndhold(arbejder: arbejdende, tilsluttede: s.count, venter: venter, laan: laan),
                     nonce: foerste?.s.nonce, sessioner: aktive)
            if !boks.isVisible || NSApp.isHidden { boks.placer(); visBoksen(boks) }
            else if boks.skalFlyttes() { boks.placer() }
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
                let mm = spoergsmaalMenu(a.s, aktivtAndetLaan: andetLaan(a))
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
        let lyd = NSMenuItem(title: "Play a sound when an agent needs you", action: #selector(skiftLyd), keyEquivalent: "")
        lyd.target = self
        lyd.state = lydSlaaetTil() ? .on : .off
        m.addItem(lyd)
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
        if i >= 0 && i < s.count { boks.valgt = s[i].session }
    }

    @objc func skiftBoks() {
        boksSlaaetFra = !boksSlaaetFra
        tik()
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

    /// Et ANDET skaerm-laan der allerede er aktivt (skaerm-koe 2/10) - menuen og boksen.
    func andetLaan(_ a: Anmodning) -> (klient: String?, til: Date)? {
        (a.s.kind == "screen" && aktivtLaan != nil && aktivtLaan !== a) ? (aktivtLaan!.s.client, laanTil!) : nil
    }

    func aaben(_ nonce: String?) -> Anmodning? {
        guard let n = nonce else { return nil }
        return anmodninger.first { $0.s.nonce == n && !$0.besvaret }
    }

    /// Boksens knapper (9/10): samme handlinger som menuens - Allow gaar gennem
    /// tilladNonce og dermed Touch ID. Knappen svarer paa det spoergsmaal boksen viste.
    func boksKnapTrykket(_ knap: String, nonce n: String?) {
        // Knappens eget spoergsmaal skal vaere det boksen viser NU, og knapperne skal vaere
        // aktive (R17: Astra + Opus) - ellers sker intet. Afgoeres i boksHandling (Tekst.swift).
        switch boksHandling(knap: knap, knapNonce: n, visteNonce: boks.nonce, aktive: boks.knapperAktive()) {
        case .foelg: foelgFraBoks()
        case .tagTilbage: tagTilbageNu(kilde: "take-back-box")
        case .tillad(let n): tilladNonce(n, kilde: "allow-box")
        case .gjort(let n): gjortNonce(n, kilde: "done-box")
        case .hentFrem(let n): hentFremNonce(n)
        case .afvis(let n): afvisNonce(n, kilde: "deny-box")
        case .intet: break
        }
    }

    @objc func tillad(_ sender: NSMenuItem) { tilladNonce(sender.representedObject as? String, kilde: "allow") }

    func tilladNonce(_ nonce: String?, kilde: String) {
        noterKilde(kilde)
        guard let a = aaben(nonce) else { return }
        // Et ja i boksen kraever, at boksen viste HELE teksten (som menuen goer).
        if kilde == "allow-box" && renTekst(a.s.text).count > BOKS_MAX_TEGN { return }
        boks.touchIdIGang = true
        bekraeftMenneske(a) { [weak self] ok in
            self?.boks.touchIdIGang = false
            // Et mislykket Touch ID er et nej, ikke et «proev igen» agenten kan vente paa.
            switch touchIdUdfald(ok: ok, erLaan: a.s.kind == "screen") {
            case .laan:
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
            case .svar(let v):
                a.svar(ok: v)
            }
            anmodninger.removeAll { $0 === a }
            self?.tik()
        }
    }

    /// Tag skaermen tilbage: intet Touch ID - at STOPPE kraever aldrig bevis.
    @objc func tagTilbage() { tagTilbageNu(kilde: "take-back") }

    /// Menuens og boksens stopknap: samme vej, hvert sit kildemaerke (R22).
    func tagTilbageNu(kilde: String) {
        noterKilde(kilde)
        aktivtLaan?.afslutLaan()
        tik()
    }

    /// «Done» paa et goer-selv-spoergsmaal: et signal, ikke et samtykke.
    @objc func gjort(_ sender: NSMenuItem) { gjortNonce(sender.representedObject as? String, kilde: "done") }

    func gjortNonce(_ nonce: String?, kilde: String) {
        noterKilde(kilde)
        guard let a = aaben(nonce), a.s.kind == "goer-selv" else { return }
        a.svar(ok: true, verified: "done")
        anmodninger.removeAll { $0 === a }
        tik()
    }

    /// «Take me there»: MENNESKETS klik henter programmet frem - ikke agentens.
    @objc func hentFrem(_ sender: NSMenuItem) { hentFremNonce(sender.representedObject as? String) }

    func hentFremNonce(_ nonce: String?) {
        guard let a = aaben(nonce), let b = a.s.targetBundle else { return }
        NSRunningApplication.runningApplications(withBundleIdentifier: b).first?.activate(options: [])
    }

    @objc func afvis(_ sender: NSMenuItem) { afvisNonce(sender.representedObject as? String, kilde: "deny") }

    func afvisNonce(_ nonce: String?, kilde: String) {
        noterKilde(kilde)
        guard let a = aaben(nonce) else { return }
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

    /// Lyden (punkt S): reglen bor i Lyd.swift, saa proeven maaler den samme.
    @objc func skiftLyd() { UserDefaults.standard.set(!lydSlaaetTil(), forKey: "lyd") }
    var lydHukommelse = LydHukommelse()

    func vis(_ a: Anmodning) {
        tik()
        if lydHukommelse.skalLyde(nonce: a.s.nonce, lukket: a.lukket, besvaret: a.besvaret, til: lydSlaaetTil()) {
            NSSound(named: "Glass")?.play()
        }
        // Et nyt spoergsmaal flytter boksen hen hvor mennesket er (30/9, live-proeven).
        if boks.isVisible { boks.placer(); visBoksen(boks) }
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
