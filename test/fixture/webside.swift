// Proevemaal til web-bagved.mjs: en WebKit-visning (samme motor som Safari) med en lokal side.
// Uden for skaermen og gennemsigtig - intet ses. Skriver sidens titel paa stdout hvert halve sekund,
// saa proeven kan laese udfaldet UDENOM computer-mcp.
import AppKit
import WebKit
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let w = NSWindow(contentRect: NSRect(x: -20000, y: -20000, width: 600, height: 400), styleMask: [.borderless], backing: .buffered, defer: false)
w.alphaValue = 0
w.level = NSWindow.Level(rawValue: NSWindow.Level.normal.rawValue - 1)
let web = WKWebView(frame: w.contentView!.bounds)
w.contentView = web
let side = URL(fileURLWithPath: CommandLine.arguments[1])
web.loadFileURL(side, allowingReadAccessTo: side.deletingLastPathComponent())
w.orderFront(nil)
Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in
    web.evaluateJavaScript("document.title") { t, _ in if let t = t as? String { print("TITEL:\(t)"); fflush(stdout) } }
}
print("pid=\(getpid())"); fflush(stdout)
app.run()
