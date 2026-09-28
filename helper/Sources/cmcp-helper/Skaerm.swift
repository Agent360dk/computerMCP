import AppKit
import CoreGraphics

/// Maaler om en handling tog skaermen - i stedet for at love at den ikke gjorde.
///
/// ⛔ HVORFOR DEN FINDES (21/9-2026)
///    Produktets loefte er «computer use you can actually leave running». Indtil
///    nu var det en saetning i en README, og hvilke vaerktoejer der «tager
///    skaermen» blev afgjort af en HAANDSKREVET NAVNELISTE i policy.js. En
///    liste er en hensigt. Den kan ikke opdage at et program alligevel hev sig
///    selv frem.
///
///    Det der faktisk tager skaermen er LEVERINGSKANALEN, ikke vaerktoejets
///    navn: `post(tap: .cghidEventTap)` gaar til vinduesserveren, som flytter
///    den rigtige markoer og rammer det forreste vindue.
///
///    MAALT 21/9 mod et prøvemaal vi selv ejer, mens mennesket arbejdede:
///    tastetryk leveret med `postToPid` ankom, og markoer, forgrund og
///    fokus-vindue stod stille. Kanalen findes. Men om ET GIVET program
///    opfoerer sig saadan, kan kun maales - derfor det her.
///
///    Reglen: hver skrivende handling maaler sig selv, og svaret baerer
///    `took_screen`. Et loefte man kan efterprove pr. kald er mere vaerd end
///    et loefte der staar paa en hjemmeside.
enum Skaerm {
    struct Stand {
        let markoer: CGPoint
        let forrestPid: pid_t
        let forrestNavn: String
    }

    /// ⛔ MAALT 27/9 paa en fremmed Mac: `NSWorkspace.frontmostApplication` er en
    ///    GEMT vaerdi, der kun opdateres naar programmets koersels-loekke tager
    ///    imod arbejdsfladens beskeder - og hjaelperen koerer aldrig sin loekke.
    ///    Foer og efter var derfor det samme inden for ét kald: et program der
    ///    hev sig selv frem, blev maalt som «took_screen: false». Hvert eneste
    ///    `took_screen` der byggede paa et skift, var blindt.
    ///    Tilgaengeligheds-laget spoerges direkte, hver gang.
    static func forrestLige() -> pid_t? {
        let sys = AXUIElementCreateSystemWide()
        AXUIElementSetMessagingTimeout(sys, 1.0)
        var v: CFTypeRef?
        guard AXUIElementCopyAttributeValue(sys, kAXFocusedApplicationAttribute as CFString, &v) == .success,
              let raw = v, CFGetTypeID(raw) == AXUIElementGetTypeID() else { return nil }
        var pid: pid_t = 0
        guard AXUIElementGetPid(raw as! AXUIElement, &pid) == .success, pid > 0 else { return nil }
        return pid
    }

    static func stand() -> Stand {
        let pid = forrestLige() ?? NSWorkspace.shared.frontmostApplication?.processIdentifier ?? -1
        return Stand(markoer: NSEvent.mouseLocation,
                     forrestPid: pid,
                     forrestNavn: NSRunningApplication(processIdentifier: pid)?.localizedName ?? "")
    }

    /// Hvad svaret skal baere.
    ///
    /// ⛔ RETTET TO GANGE PAA ÉN TIME 21/9, og den anden rettelse er den vigtige.
    ///
    ///    FOERSTE fejl: feltet frikendte den globale stroem. `type --text x`
    ///    uden modtager skrev et «x» ind i den boks mennesket sad i, og svaret
    ///    sagde `took_screen: false` - markoeren havde ikke flyttet sig, og
    ///    forgrunden var ikke skiftet. Begge dele sande, maalingen forkert.
    ///    En haendelse i den globale HID-stroem lander DEFINITORISK i det
    ///    vindue mennesket bruger. Den tager tastaturet, ikke markoeren.
    ///
    ///    ANDEN fejl: resten af feltet maalte MENNESKET. `pointer_moved` blev
    ///    udledt af markoerens position foer og efter - paa en maskine hvor
    ///    han sad og brugte musen. Den sagde «vi flyttede markoeren» om hans
    ///    egen haandbevaegelse, og «appen kom frem» om at han selv skiftede
    ///    til Chrome. Et instrument der ikke kan tilskrive aarsagen, maaler
    ///    ingenting - det producerer bare tal der ligner noget.
    ///
    ///    Derfor er `took_screen` nu UDLEDT AF HVAD VI GJORDE, ikke af hvad
    ///    der skete omkring os:
    ///      ingen modtager        -> sand. Den gik i den globale stroem.
    ///      modtager + markoer    -> sand. Vi flyttede den selv.
    ///      modtager, kun tastatur-> falsk. Vi roerte hverken markoer eller forgrund.
    ///
    ///    Det der stadig OBSERVERES, staar i `observed` - og det siger selv at
    ///    det kan vaere mennesket. Et tal med et forbehold er aerligt; det
    ///    samme tal uden er en paastand.
    static func svar(tilPid: pid_t?, flyttedeMarkoer: Bool, foer: Stand) -> [String: Any] {
        let efter = stand()
        var d: [String: Any] = [:]

        if tilPid == nil {
            d["took_screen"] = true
            d["why"] = "sent to the global input stream, so it landed in whatever window you were using. Name the app to deliver it into that app's own queue instead."
        } else if flyttedeMarkoer {
            d["took_screen"] = true
            d["why"] = "this action moves the real pointer, so it is visible wherever you are looking."
        } else if tilPid == foer.forrestPid {
            // ⛔ TREDJE RETTELSE AF DET HER FELT PAA ÉN DAG, og reviewet fandt
            //    den - ikke jeg. At levere i ét programs koe er kun stille
            //    hvis det program ikke er DET mennesket sidder i. Skriver vi
            //    i Chrome mens han skriver i Chrome, lander teksten i hans
            //    felt og indholdet flytter sig for oejnene af ham.
            //
            //    Markoeren stod stille og forgrunden skiftede ikke. Begge
            //    dele sande. Maalingen forkert - noejagtig samme fejlklasse
            //    som de to foerste gange. Koden HAVDE `foer.forrestPid` og
            //    sammenlignede den aldrig med modtageren.
            d["took_screen"] = true
            d["why"] = "delivered into the app the person is using right now, so they will see it happen."
        } else {
            d["took_screen"] = false
        }

        // Observationer, ikke paastande. Paa en maskine der er i brug kan de
        // vaere mennesket selv, og det skal staa der.
        var set: [String: Any] = [:]
        if abs(foer.markoer.x - efter.markoer.x) > 0.5 || abs(foer.markoer.y - efter.markoer.y) > 0.5 {
            set["pointer_moved"] = true
        }
        if foer.forrestPid != efter.forrestPid {
            set["frontmost_changed_to"] = efter.forrestNavn
        }
        if !set.isEmpty {
            set["note"] = "observed around the call - on a machine someone is using, this may be them, not us"
            d["observed"] = set
        }
        return d
    }

    /// For handlinger der ikke er input-haendelser - at starte eller lukke et
    /// program, at flytte et vindue.
    ///
    /// ⛔ TILFOEJET 22/9 fordi `svar()` gav noget vroevl om «den globale
    ///    input-stroem» om en PROGRAMSTART. Feltet var bygget til tastetryk,
    ///    og en start har ingen kanal - den har kun et udfald: kom programmet
    ///    frem, eller blev det hvor det var? Det kan maales direkte, og det
    ///    skal ikke laane en begrundelse fra et andet vaerktoej.
    /// ⛔ HVOR LANGT DEN HER RAEKKER - sagt hoejt 23/9 efter to raadgivere
    ///    pegede paa det samme: det her er **EEN sammenligning** - hvilket
    ///    program var forrest foer og efter. Den kan IKKE se:
    ///      - et vindue der haeves uden at programmet aktiveres
    ///      - et vindue macOS klemmer ind paa en synlig skaerm
    ///      - genie-animationen ved minimering
    ///      - en resize der daekker hele skaermen
    ///    Alle fire giver `took_screen: false`.
    ///
    ///    Feltet er derfor RAPPORTERING, ikke et tilladelses-grundlag. En
    ///    efter-maaling kan dokumentere et brud; den kan ikke forhindre det.
    ///    Skal `computer_window` nogensinde slippes loes i baggrund, kraever
    ///    det en PORT foer skrivningen - maalrammen snittet mod skaermene -
    ///    ikke det her felt. Hele dommen: `~/.claude/plans/computermcp/
    ///    DOM-tager-skaermen-2026-09-23.md`.
    static func udfald(foer: Stand) -> [String: Any] {
        let efter = stand()
        if foer.forrestPid == efter.forrestPid { return ["took_screen": false] }
        return ["took_screen": true,
                "why": "the front window changed from \(foer.forrestNavn) to \(efter.forrestNavn)"]
    }

    /// En handling paa et programs EGET element (en knap, et menupunkt) - og
    /// henter programmet sig selv frem af den, gives forgrunden tilbage.
    ///
    /// ⛔ MAALT 27/9 paa en fremmed Mac (GitHubs koerer): «File > New Finder
    ///    Window» i baggrunden hev Finder frem over det program mennesket
    ///    arbejdede i. Svaret fra `menu-click` og `press` sagde intet om det,
    ///    for ingen af dem maalte. Det er programmet der henter sig selv frem,
    ///    ikke vores kanal - men det er VORES handling der udloeser det.
    ///    Kun et skift TIL maalprogrammet tilskrives os: at mennesket selv
    ///    skifter til netop dét program inden for et kvart sekund, er ikke
    ///    det vi maaler.
    static func handletOgGivetTilbage(tilPid: pid_t, ventMs: Int = 240, _ handling: () -> Void) -> [String: Any] {
        let foer = stand()
        handling()
        return givTilbage(foer: foer, tilPid: { tilPid }, ventMs: ventMs)
    }

    /// Tog `tilPid` forgrunden fra `foer` inden for `ventMs`? Saa gives den tilbage.
    /// ⛔ 27/9 (koersel 5): Finder hentede sig selv frem EFTER de foerste 240 ms,
    ///    og et nyt program efter op mod et sekund - derfor et vindue pr. handling.
    static func givTilbage(foer: Stand, tilPid: () -> pid_t?, ventMs: Int) -> [String: Any] {
        var efter = stand()
        var gaaet = 0
        while efter.forrestPid == foer.forrestPid && gaaet < ventMs {
            usleep(60_000); gaaet += 60; efter = stand()
        }
        guard foer.forrestPid > 0, efter.forrestPid != foer.forrestPid else { return ["took_screen": false] }
        // ⛔ 27/9 (koersel 7-9): ved en baggrundsstart kom et TREDJE program frem
        //    (Kontakter, da Aktivitetsovervaagning startede), og kun et skift til
        //    maalprogrammet blev givet tilbage. Et menneske der skifter program,
        //    trykker en tast eller klikker; et program der skubber sig frem, goer
        //    ingen af delene. Uden menneskelig input i 1,5 s var det ikke mennesket.
        let maal = tilPid()
        // Maalet er der mennesket allerede var: intet skift at give tilbage.
        if maal == foer.forrestPid { return ["took_screen": false] }
        // ⛔ 28/9 (haerdning M4): FOER stod `efter.forrestPid == maal || !menneskeRoerteNetop()`
        //    - naar maalprogrammet kom frem, blev forgrunden givet tilbage UANSET om
        //    mennesket lige havde klikket/tastet. Klikkede mennesket selv over i netop
        //    dét program, rev vi det tilbage under haenderne paa dem. Nu gaelder
        //    menneske-tjekket i ALLE grene: har nogen roert tastatur eller mus lige
        //    foer, saa lader vi forgrunden staa - og siger aerligt at skaermen skiftede,
        //    i stedet for et tavst took_screen:false.
        if menneskeRoerteNetop() {
            return ["took_screen": true, "gave_back": false,
                    "observed": ["frontmost_changed_to": efter.forrestNavn,
                                 "note": "a person clicked or typed just before, so this is taken to be them and the front was left with \(efter.forrestNavn)"]]
        }
        NSRunningApplication(processIdentifier: foer.forrestPid)?.activate(options: [])
        var tilbage = false
        for _ in 0..<10 {
            usleep(50_000)
            if stand().forrestPid == foer.forrestPid { tilbage = true; break }
        }
        return ["took_screen": true, "gave_back": tilbage,
                "why": tilbage
                    ? "\(efter.forrestNavn) brought itself to the front when this ran; the front was handed straight back to \(foer.forrestNavn)"
                    : "\(efter.forrestNavn) brought itself to the front when this ran, and handing the front back to \(foer.forrestNavn) did not work"]
    }

    /// Har et menneske trykket en tast eller klikket inden for de sidste 1,5 s?
    /// Kun tryk og klik: musebevaegelser sker hele tiden uden at skifte program.
    static func menneskeRoerteNetop(sekunder: Double = 1.5) -> Bool {
        let typer: [CGEventType] = [.keyDown, .flagsChanged, .leftMouseDown, .rightMouseDown, .otherMouseDown]
        return typer.contains { CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: $0) < sekunder }
    }

    /// Koerer en handling og beskriver den aerligt.
    static func maalt(tilPid: pid_t?, flyttedeMarkoer: Bool = false,
                      _ handling: () -> Void) -> [String: Any] {
        let foer = stand()
        handling()
        usleep(120_000)
        return svar(tilPid: tilPid, flyttedeMarkoer: flyttedeMarkoer, foer: foer)
    }
}
