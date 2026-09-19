// Et "Gem / Gem ikke"-ark der ikke kan ses.
//
// ⛔ Hul H8 fra 19/9-listen: et menneske moeder det ark ved HVER eneste lukning
//    med ugemt arbejde. Spoergsmaalet var om agenten overhovedet kan naa
//    knapperne i det - og det kunne ikke maales, fordi der ikke laa et ark paa
//    maskinen, og fordi det at fremkalde et ville tage menneskets skaerm.
//
//    Et ark er et NSWindow som macOS haenger paa et andet vindue. Baade
//    forael­dre og ark saettes til alphaValue 0: de findes for
//    tilgaengeligheds-API'et, og der er ingen pixels.
import Cocoa

let sekunder = CommandLine.arguments.count > 1 ? Double(CommandLine.arguments[1]) ?? 20 : 20
let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let foraelder = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 420, height: 260),
                         styleMask: [.titled], backing: .buffered, defer: false)
foraelder.title = "cmcp-proveark"
foraelder.alphaValue = 0
foraelder.ignoresMouseEvents = true
foraelder.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)))
foraelder.orderFrontRegardless()

let ark = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 360, height: 130),
                   styleMask: [.titled], backing: .buffered, defer: false)
ark.alphaValue = 0
ark.ignoresMouseEvents = true

let tekst = NSTextField(labelWithString: "Vil du gemme aendringerne?")
tekst.frame = NSRect(x: 20, y: 80, width: 320, height: 20)
ark.contentView?.addSubview(tekst)

func knap(_ titel: String, _ x: Double) -> NSButton {
    let b = NSButton(frame: NSRect(x: x, y: 20, width: 104, height: 30))
    b.title = titel; b.bezelStyle = .rounded
    return b
}
ark.contentView?.addSubview(knap("Gem", 240))
ark.contentView?.addSubview(knap("Gem ikke", 128))
ark.contentView?.addSubview(knap("Annuller", 16))

foraelder.beginSheet(ark) { _ in }
print("klar")
fflush(stdout)

Timer.scheduledTimer(withTimeInterval: sekunder, repeats: false) { _ in
    NSApp.stop(nil)
    if let tom = NSEvent.otherEvent(with: .applicationDefined, location: .zero,
                                    modifierFlags: [], timestamp: 0, windowNumber: 0,
                                    context: nil, subtype: 0, data1: 0, data2: 0) {
        NSApp.postEvent(tom, atStart: true)
    }
}
app.run()
