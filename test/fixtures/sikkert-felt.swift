// Et adgangskodefelt der ikke kan ses.
//
// ⛔ MAALT 19/9: paastand 3 og 10 - to af produktets KERNELOEFTER, nemlig at
//    vaerdien af et sikkert felt aldrig forlader hjaelperen, og at set_value
//    naegter at skrive i et - blev SPRUNGET OVER paa hver eneste koersel, fordi
//    der ikke laa et adgangskodefelt paa skaermen. "Bevist intet" stod der, og
//    saadan havde det staaet i lang tid.
//
//    Samme mekanik som med dialogerne: hvis en proeve kun kan koere naar et
//    menneske stiller noget op for den, saa koerer den aldrig.
//
//    FOERSTE FORSOEG VAR FORKERT: jeg lagde vinduet 30.000 punkter ude til
//    venstre og troede det var uden for skaermen. macOS KLEMTE det ind igen -
//    maalt: det bad om x=-30000 og endte paa x=255. Der blinkede et lille
//    vindue paa menneskets skaerm i otte sekunder. Praecis den fejl proeven
//    skulle undgaa.
//
//    Det der VIRKER er gennemsigtighed: alphaValue = 0. Vinduet findes for
//    vinduesserveren og for tilgaengeligheds-API'et, saa proeven faar sit felt -
//    og der er ingen pixels at se. Det ligger ogsaa bagest og tager ingen mus.
import Cocoa

let sekunder = CommandLine.arguments.count > 1 ? Double(CommandLine.arguments[1]) ?? 20 : 20
let vaerdi = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "HEMMELIG-MAA-ALDRIG-UD"

let app = NSApplication.shared
app.setActivationPolicy(.accessory)   // intet Dock-ikon, aldrig forrest

let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 320, height: 90),
                 styleMask: [.borderless], backing: .buffered, defer: false)
w.title = "cmcp-proevefelt"
w.alphaValue = 0            // ingen pixels - men stadig i AX-traeet
w.ignoresMouseEvents = true // kan ikke komme i vejen for et klik
w.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)))

let sikkert = NSSecureTextField(frame: NSRect(x: 16, y: 46, width: 280, height: 24))
sikkert.stringValue = vaerdi
sikkert.placeholderString = "adgangskode"
w.contentView?.addSubview(sikkert)

// Et almindeligt felt ved siden af, saa proeven kan vise at forskellen ligger i
// FELTET og ikke i at hjaelperen bare udelader alt.
//
// Med "kun-sikkert" udelades det: saa matcher en soegning paa rolle praecis ÉT
// element, og en proeve kan skrive til DET uden at klikke paa skaermen.
let kunSikkert = CommandLine.arguments.contains("kun-sikkert")
if !kunSikkert {
    let alm = NSTextField(frame: NSRect(x: 16, y: 14, width: 280, height: 24))
    alm.stringValue = "HARMLOES-MAA-GERNE-SES"
    w.contentView?.addSubview(alm)
}

w.orderFrontRegardless()
print("klar")
fflush(stdout)

Timer.scheduledTimer(withTimeInterval: sekunder, repeats: false) { _ in
    NSApp.stop(nil)
    // ⛔ NSApp.stop virker foerst naar loopet behandler en HAENDELSE; en timer
    //    er ingen haendelse. Uden dette tomme event bliver vinduet staaende.
    if let tom = NSEvent.otherEvent(with: .applicationDefined, location: .zero,
                                    modifierFlags: [], timestamp: 0, windowNumber: 0,
                                    context: nil, subtype: 0, data1: 0, data2: 0) {
        NSApp.postEvent(tom, atStart: true)
    }
}
app.run()
