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
}

final class Anmodning {
    let s: Spoergsmaal
    let fd: Int32
    var besvaret = false
    init(_ s: Spoergsmaal, fd: Int32) { self.s = s; self.fd = fd }

    func svar(ok: Bool) {
        guard !besvaret else { return }
        besvaret = true
        let linje = "{\"nonce\":\"\(s.nonce)\",\"ok\":\(ok),\"verified\":\"\(ok ? "owner" : "none")\"}\n"
        linje.withCString { p in _ = write(fd, p, strlen(p)) }
        close(fd)
    }
}

var anmodninger: [Anmodning] = []
var nyAnmodning: (Anmodning) -> Void = { _ in }

func startSocket() {
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
    while !data.contains(0x0A) && data.count < 16_384 {
        let n = read(k, &buf, buf.count)
        if n <= 0 { close(k); return }
        data.append(buf, count: n)
    }
    guard let i = data.firstIndex(of: 0x0A),
          let s = try? JSONDecoder().decode(Spoergsmaal.self, from: data[..<i]) else { close(k); return }
    let a = Anmodning(s, fd: k)
    DispatchQueue.main.async {
        anmodninger.append(a)
        nyAnmodning(a)
    }
    // Venter paa at serveren lukker: saa er spoergsmaalet ikke laengere aabent.
    var en: UInt8 = 0
    while read(k, &en, 1) > 0 {}
    DispatchQueue.main.async {
        anmodninger.removeAll { $0 === a }
    }
}

/// Ét ja = ét menneske der bekraefter at det er ham. Uden det: nej.
func bekraeftMenneske(_ tekst: String, _ faerdig: @escaping (Bool) -> Void) {
    let ctx = LAContext()
    var fejl: NSError?
    guard ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &fejl) else { faerdig(false); return }
    ctx.evaluatePolicy(.deviceOwnerAuthentication,
                       localizedReason: "let an agent: \(tekst.prefix(120))") { ok, _ in
        DispatchQueue.main.async { faerdig(ok) }
    }
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
        if s.isEmpty && anmodninger.isEmpty {
            if tomSiden == nil { tomSiden = Date() }
            if let t = tomSiden, Date().timeIntervalSince(t) > 10 { afslut() }
        } else { tomSiden = nil }
    }

    func menuNeedsUpdate(_ m: NSMenu) {
        m.removeAllItems()
        let s = laesSessioner()
        let aabne = anmodninger.filter { !$0.besvaret }
        if !aabne.isEmpty {
            let h = NSMenuItem(title: aabne.count == 1 ? "Needs you — 1 question" : "Needs you — \(aabne.count) questions", action: nil, keyEquivalent: "")
            h.isEnabled = false
            m.addItem(h)
            for a in aabne {
                // Selve «Allow» ligger i en undermenu: ét klik i hovedmenuen maa
                // aldrig vaere et ja, og menuen kan bygges om mens den er aaben.
                let i = NSMenuItem(title: "\(a.s.client ?? "agent") · \(a.s.session): \(a.s.text)", action: nil, keyEquivalent: "")
                let sub = NSMenu()
                for linje in [a.s.scope, "Lands in: \(a.s.target)"] {
                    let l = NSMenuItem(title: linje, action: nil, keyEquivalent: "")
                    l.isEnabled = false
                    sub.addItem(l)
                }
                sub.addItem(.separator())
                let ja = NSMenuItem(title: "Allow… (confirm with Touch ID)", action: #selector(tillad(_:)), keyEquivalent: "")
                ja.target = self; ja.representedObject = a.s.nonce
                let nej = NSMenuItem(title: "Deny", action: #selector(afvis(_:)), keyEquivalent: "")
                nej.target = self; nej.representedObject = a.s.nonce
                sub.addItem(ja); sub.addItem(nej)
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

    func find(_ sender: NSMenuItem) -> Anmodning? {
        guard let n = sender.representedObject as? String else { return nil }
        return anmodninger.first { $0.s.nonce == n && !$0.besvaret }
    }

    @objc func tillad(_ sender: NSMenuItem) {
        guard let a = find(sender) else { return }
        bekraeftMenneske(a.s.text) { [weak self] ok in
            // Et mislykket Touch ID er et nej, ikke et «proev igen» agenten kan vente paa.
            a.svar(ok: ok)
            anmodninger.removeAll { $0 === a }
            self?.tik()
        }
    }

    @objc func afvis(_ sender: NSMenuItem) {
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
        guard UserDefaults.standard.bool(forKey: "banner") else { return }
        let c = UNMutableNotificationContent()
        c.title = "An agent needs you"
        c.body = "\(a.s.client ?? "agent"): \(a.s.text)"
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
let ikon = Ikon()
nyAnmodning = { a in ikon.vis(a) }
app.run()
