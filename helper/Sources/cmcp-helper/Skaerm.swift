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

    static func stand() -> Stand {
        let f = NSWorkspace.shared.frontmostApplication
        return Stand(markoer: NSEvent.mouseLocation,
                     forrestPid: f?.processIdentifier ?? -1,
                     forrestNavn: f?.localizedName ?? "")
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

    /// Koerer en handling og beskriver den aerligt.
    static func maalt(tilPid: pid_t?, flyttedeMarkoer: Bool = false,
                      _ handling: () -> Void) -> [String: Any] {
        let foer = stand()
        handling()
        usleep(120_000)
        return svar(tilPid: tilPid, flyttedeMarkoer: flyttedeMarkoer, foer: foer)
    }
}
