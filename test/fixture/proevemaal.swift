// Et proevemaal vi ejer fuldstaendigt.
//
// Findes fordi det foerste forsoeg brugte TextEdit, som genskabte menneskets
// EGNE dokumenter. Et instrument der kan roere brugerens data, er forkert
// instrument - uanset hvor forsigtigt man er.
//
// Vinduet placeres UDEN FOR enhver skaerm, saa intet kan ses.
import AppKit

/// Et vindue uden titellinje kan som standard ikke blive noeglevindue, og
/// saa naar tastetryk aldrig feltet. Proeverne skal kunne taste i det.
final class Proevevindue: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

/// Som et kodeordsfelt på en webside: rollen er AXTextField, men undertypen er
/// AXSecureTextField. macOS beskytter det IKKE selv; kun vores egen vagt gør (27/9).
final class WebKodeord: NSTextField {
    override func accessibilitySubrole() -> NSAccessibility.Subrole? { .secureTextField }
}

final class App: NSObject, NSApplicationDelegate {
    var vindue: NSWindow!
    var felt: NSTextField!
    var knap: NSButton!

    @objc func trykket() { knap.title = "TRYKKET" }
    @objc func hentFrem() { NSApp.activate(ignoringOtherApps: true) }

    /// ⛔ En knap der kun kan skifte titel ved et KLIK - tilfoejet 22/9.
    ///    `click --app` svarede «uden at tage skaermen», men det beviste ikke
    ///    at klikket LANDEDE: den knap der blev sigtet paa havde ingen handling.
    ///    Et museklik baerer intet vinduesnummer, saa om AppKit tager imod et
    ///    klik leveret til en proces-koe er det store umaalte spoergsmaal.
    var klikMaal: NSButton!
    @objc func klikket() { klikMaal.title = "KLIKKET" }

    /// Et Gem-panel som ARK paa attrappens eget vindue - uden for skaermen,
    /// saa intet kan ses. Tilfoejet 22/9: filpaneler er det eneste hul der
    /// STOPPER en agent, og et panel kan ikke maales uden at et findes.
    /// Startes af miljoevariablen CMCP_PROEVE_GEMPANEL=1, aldrig ellers.
    func aabnGemPanel() {
        let p = NSSavePanel()
        p.nameFieldStringValue = "proeve-dokument.txt"
        p.beginSheetModal(for: vindue) { _ in }
    }
    func applicationDidFinishLaunching(_ n: Notification) {
        // Langt ude i venstre side: ingen skaerm naar dertil.
        // ⛔ FUNDET 22/9 AF GUSTAV, ikke af mig: «dens pop up tager stadig
        //    opmaerksomheden». Vinduet laa IKKE uden for skaermen. macOS flytter
        //    et vindue med titellinje ind paa skaermen, uanset hvor man beder om
        //    det. Traeet rapporterede hele dagen knapper paa (390, 216) og
        //    (395, 245) - midt paa hans hovedskaerm - og jeg saa det ikke.
        //    Hver proevekoersel viste et vindue hos ham.
        //
        //    Nu: UDEN titellinje (saa det ikke flyttes ind), HELT gennemsigtigt
        //    (saa det er usynligt selv hvis det goer) og ligger under alt
        //    andet. Det staar stadig i tilgaengeligheds-
        //    traeet, og det er det eneste proeverne har brug for.
        vindue = Proevevindue(contentRect: NSRect(x: -20000, y: -20000, width: 300, height: 120),
                          styleMask: [.borderless], backing: .buffered, defer: false)
        vindue.alphaValue = 0
        vindue.level = NSWindow.Level(rawValue: NSWindow.Level.normal.rawValue - 1)
        vindue.hasShadow = false
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

        // ⛔ Tre soeskende i kendt raekkefoelge, tilfoejet 22/9.
        //    Traeet blev gennemgaaet med en stak og popLast(), saa boern lagt
        //    i raekkefoelge blev besoegt BAGFRA. `find` svarede i omvendt
        //    laeseretning, og `press`/`set_value`/`wait_for` bruger `hits.first`
        //    - altsaa det SIDSTE element i laeseretning.
        //    De her tre er den eneste maade at maale det paa: samme forael-
        //    der, kendt orden, voksende x.
        // ⛔ En rullemenu, tilfoejet 22/9. macOS svarer «success» paa at saette
        //    dens vaerdi og aendrer intet - og `set_value` returnerede `set: true`
        //    paa den oplysning. Uden den her kan loegnen ikke maales.
        let rulle = NSPopUpButton(frame: NSRect(x: 180, y: 10, width: 110, height: 26))
        rulle.addItems(withTitles: ["rulle-A", "rulle-B"])
        vindue.contentView?.addSubview(rulle)

        klikMaal = NSButton(frame: NSRect(x: 180, y: 50, width: 110, height: 24))
        klikMaal.title = "klik-maal"
        klikMaal.target = self
        klikMaal.action = #selector(klikket)
        vindue.contentView?.addSubview(klikMaal)

        for (i, navn) in ["orden-1", "orden-2", "orden-3"].enumerated() {
            let b = NSButton(frame: NSRect(x: 10 + i * 90, y: 80, width: 80, height: 22))
            b.title = navn
            vindue.contentView?.addSubview(b)
        }
        felt = NSTextField(frame: NSRect(x: 10, y: 10, width: 280, height: 30))
        felt.stringValue = ""
        vindue.contentView?.addSubview(felt)
        // Flere felter uden navn, som i Finder: et søgefelt og et felt ved siden af.
        // Kun når en prøve beder om det, så de andre prøvers «ét tekstfelt» holder.
        if ProcessInfo.processInfo.environment["CMCP_PROEVE_VAELGER"] == "1" {
            let soeg = NSSearchField(frame: NSRect(x: 10, y: 110, width: 280, height: 24))
            soeg.stringValue = ""
            vindue.contentView?.addSubview(soeg)
            let andet = NSTextField(frame: NSRect(x: 10, y: 140, width: 280, height: 24))
            andet.stringValue = "filnavn.txt"
            vindue.contentView?.addSubview(andet)
        }
        // Et kodeordsfelt med fokus, når en prøve beder om det: tekst må aldrig sættes
        // ind her gennem tilgængeligheds-laget (27/9).
        var foerste: NSView = felt
        if let slags = ProcessInfo.processInfo.environment["CMCP_PROEVE_SIKKER"] {
            let sikker: NSTextField = slags == "web" ? WebKodeord(frame: NSRect(x: 10, y: 170, width: 280, height: 24))
                                                     : NSSecureTextField(frame: NSRect(x: 10, y: 170, width: 280, height: 24))
            vindue.contentView?.addSubview(sikker)
            foerste = sikker
        }
        vindue.orderFront(nil)              // frem, men IKKE makeKey - vi stjaeler ingen fokus
        // Feltet har fokus INDE I appen. Det er den tilstand et rigtigt
        // program er i: noget er valgt, selv naar vinduet ikke er forrest.
        vindue.initialFirstResponder = foerste
        vindue.makeFirstResponder(foerste)
        if ProcessInfo.processInfo.environment["CMCP_PROEVE_GEMPANEL"] == "1" {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.aabnGemPanel() }
        }
        // Et program der kører uden vindue, som Aktivitetsovervågning efter at
        // mennesket har lukket det (27/9). Kun når en prøve beder om det.
        if udenVindue { vindue.orderOut(nil) }
        // En knap der henter programmet frem, som «Nyt Finder-vindue» gjorde på en
        // fremmed Mac (27/9). Kun når en prøve beder om det - den TAGER skærmen.
        if ProcessInfo.processInfo.environment["CMCP_PROEVE_HENT_FREM"] == "1" {
            let frem = NSButton(frame: NSRect(x: 10, y: 200, width: 120, height: 24))
            frem.title = "hent-frem"
            frem.target = self
            frem.action = #selector(hentFrem)
            vindue.contentView?.addSubview(frem)
        }
        print("pid=\(ProcessInfo.processInfo.processIdentifier)")
        fflush(stdout)
    }
    let udenVindue = ProcessInfo.processInfo.environment["CMCP_PROEVE_UDEN_VINDUE"] == "1"
    /// Det et klik på Dock-ikonet beder om: «vis dig». Svaret er vinduet igen.
    func applicationShouldHandleReopen(_ s: NSApplication, hasVisibleWindows synlige: Bool) -> Bool {
        if udenVindue && !synlige { vindue.title = "genaabnet"; vindue.orderFront(nil) }
        return false
    }
}
let app = NSApplication.shared
app.setActivationPolicy(.accessory)         // ingen Dock-ikon, ingen menulinje
let d = App(); app.delegate = d
app.run()
