// Proeve-fixtur: et vindue med et AEGTE NSSecureTextField paa en KENDT plads.
//
// Findes fordi en proeve der aabner en AppleScript-dialog, doer sammen med
// sit vaerktoejskald - og saa maaler man et tomt skaermbillede og laeser nullet
// som "ingen hemmeligheder fundet". Fixturen bliver staaende indtil den draebes,
// og den ved praecis hvor feltet er, saa proeven kan tjekke de enkelte pixels.
import AppKit

let app = NSApplication.shared
app.setActivationPolicy(.regular)

// Fast plads og fast stoerrelse. Proeven regner ud fra de samme tal.
let winX: CGFloat = 120, winY: CGFloat = 120, winW: CGFloat = 640, winH: CGFloat = 240

let window = NSWindow(
    contentRect: NSRect(x: winX, y: winY, width: winW, height: winH),
    styleMask: [.titled], backing: .buffered, defer: false
)
window.title = "CMCP-FIXTUR"
window.backgroundColor = .yellow
window.level = .floating
// Uden denne linje aabner fixturen paa standard-Space'en. Koerer udvikleren i
// fuldskaerm - hvilket er normalen - ligger vinduet saa paa en Space der ikke
// er fremme, og BAADE Tilgaengelighed og skaermbilledet ser tomt. Maalt 18/9:
// det saa ud som om sloeringen ikke fandt noget, men der var intet at finde.
window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]

let field = NSSecureTextField(frame: NSRect(x: 40, y: 80, width: 560, height: 60))
field.stringValue = "HEMMELIGHED-SKAL-SLOERES"
field.font = .systemFont(ofSize: 30)
window.contentView?.addSubview(field)

let label = NSTextField(labelWithString: "Gul = maa ses. Feltet = maa IKKE ses.")
label.frame = NSRect(x: 40, y: 20, width: 560, height: 40)
label.font = .systemFont(ofSize: 20)
window.contentView?.addSubview(label)

window.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)
app.run()
