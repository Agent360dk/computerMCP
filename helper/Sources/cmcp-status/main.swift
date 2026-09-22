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
        item.button?.title = s.count > 1 ? " \(s.count)" : ""
        item.button?.appearsDisabled = !s.contains { $0.now != nil }
        for p in paneler.values where p.panel.isVisible { p.opdater() }
        if s.isEmpty {
            if tomSiden == nil { tomSiden = Date() }
            if let t = tomSiden, Date().timeIntervalSince(t) > 10 { afslut() }
        } else { tomSiden = nil }
    }

    func menuNeedsUpdate(_ m: NSMenu) {
        m.removeAllItems()
        let s = laesSessioner()
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

    func afslut() {
        if let pid = try? String(contentsOfFile: pidFil, encoding: .utf8),
           pid.trimmingCharacters(in: .whitespacesAndNewlines) == String(getpid()) {
            try? FileManager.default.removeItem(atPath: pidFil)
        }
        NSApp.terminate(nil)
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let ikon = Ikon()
app.run()
