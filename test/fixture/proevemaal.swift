// Et proevemaal vi ejer fuldstaendigt.
//
// Findes fordi det foerste forsoeg brugte TextEdit, som genskabte menneskets
// EGNE dokumenter. Et instrument der kan roere brugerens data, er forkert
// instrument - uanset hvor forsigtigt man er.
//
// Vinduet placeres UDEN FOR enhver skaerm, saa intet kan ses.
import AppKit

final class App: NSObject, NSApplicationDelegate {
    var vindue: NSWindow!
    var felt: NSTextField!
    func applicationDidFinishLaunching(_ n: Notification) {
        // Langt ude i venstre side: ingen skaerm naar dertil.
        vindue = NSWindow(contentRect: NSRect(x: -20000, y: -20000, width: 300, height: 60),
                          styleMask: [.titled], backing: .buffered, defer: false)
        vindue.title = "cmcp-proevemaal"
        felt = NSTextField(frame: NSRect(x: 10, y: 10, width: 280, height: 30))
        felt.stringValue = ""
        vindue.contentView?.addSubview(felt)
        vindue.orderFront(nil)              // frem, men IKKE makeKey - vi stjaeler ingen fokus
        // Feltet har fokus INDE I appen. Det er den tilstand et rigtigt
        // program er i: noget er valgt, selv naar vinduet ikke er forrest.
        vindue.initialFirstResponder = felt
        vindue.makeFirstResponder(felt)
        print("pid=\(ProcessInfo.processInfo.processIdentifier)")
        fflush(stdout)
    }
}
let app = NSApplication.shared
app.setActivationPolicy(.accessory)         // ingen Dock-ikon, ingen menulinje
let d = App(); app.delegate = d
app.run()
