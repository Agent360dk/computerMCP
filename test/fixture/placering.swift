// Proevevindue til `billede-placering.mjs`: et vindue paa en KENDT plads paa
// hovedskaermen, med et aegte kodeordsfelt paa en kendt plads i vinduet.
//
// Det skal vaere PAA skaermen - et billede af et program tages kun af det der
// er paa skaermen. Saa det goeres usynligt paa anden maade: 2 % synligt, under
// alle almindelige vinduer, og musen gaar igennem det.
import AppKit

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
// AX-rammen (400, 400, 200, 100) - AppKit regner nedefra.
let H = NSScreen.screens[0].frame.height
let w = NSWindow(contentRect: NSRect(x: 400, y: H - 400 - 100, width: 200, height: 100),
                 styleMask: [.borderless], backing: .buffered, defer: false)
w.backgroundColor = .white
w.isOpaque = false
w.alphaValue = 0.02
w.hasShadow = false
w.ignoresMouseEvents = true
w.level = NSWindow.Level(rawValue: NSWindow.Level.normal.rawValue - 1)
w.collectionBehavior = [.canJoinAllSpaces]
w.title = "cmcp-placering"
// Feltet: AX (500, 450) til (580, 480).
let felt = NSSecureTextField(frame: NSRect(x: 100, y: 20, width: 80, height: 30))
felt.stringValue = "x"
w.contentView?.addSubview(felt)
w.orderFront(nil)
print("pid=\(getpid())")
fflush(stdout)
app.run()
