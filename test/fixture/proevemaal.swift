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
    var knap: NSButton!

    @objc func trykket() { knap.title = "TRYKKET" }
    func applicationDidFinishLaunching(_ n: Notification) {
        // Langt ude i venstre side: ingen skaerm naar dertil.
        vindue = NSWindow(contentRect: NSRect(x: -20000, y: -20000, width: 300, height: 90),
                          styleMask: [.titled], backing: .buffered, defer: false)
        vindue.title = "cmcp-proevemaal"
        // En knap, saa et KLIK leveret ad den stille kanal kan maales -
        // ikke kun et tastetryk. Reviewet 21/9: CGEvent-musehaendelser baerer
        // intet vinduesnummer, og AppKit finder modtagervinduet paa netop det
        // felt, saa postToPid er kendt solidt for tastatur og usikkert for mus.
        // Uden den her knap er «klik virker stille» en paastand.
        knap = NSButton(frame: NSRect(x: 10, y: 50, width: 120, height: 24))
        knap.title = "ikke-trykket"
        knap.target = self
        knap.action = #selector(trykket)
        vindue.contentView?.addSubview(knap)
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
