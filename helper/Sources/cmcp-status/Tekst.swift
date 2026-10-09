import Foundation
import CoreGraphics

// Tekst til menuen og Touch ID-arket. Egen fil, saa test/ombryd.mjs kan
// kompilere den direkte og maale at intet tegn falder ud (29/9).

/// Fjerner alt usynligt: styretegn, retningstegn, nul-bredde, linjeskift.
func renTekst(_ s: String) -> String {
    String(String.UnicodeScalarView(s.unicodeScalars.map { u -> Unicode.Scalar in
        switch u.properties.generalCategory {
        case .control, .format, .lineSeparator, .paragraphSeparator: return " "
        default: return u
        }
    }))
}

/// Kort udgave til hovedmenuen og banneret: resten staar i undermenuen.
func kort(_ s: String, _ n: Int) -> String {
    let r = renTekst(s)
    return r.count > n ? "\(r.prefix(n))…" : r
}

// MARK: - Boksen i hjoernet (9/10)
//
// ⛔ Gustav 9/10: «hver gang den bliver aktiv, er det en flydende komponent i hoejre
//    hjoerne af skaermen, saa man kan se hvad der sker, naar de koerer» - «saa kan
//    jeg ogsaa goere hvad du beder mig om». MAALT samme dag under F1: et spoergsmaal
//    udloeb, fordi boksen stod i hjoernet af den ANDEN skaerm (x=4794 paa en
//    ultrabred skaerm, musen var der) og kun sagde «Needs you: click the orange menu
//    bar icon». Nu: den skaerm mennesket arbejder paa, hvad hver agent goer, og
//    spoergsmaalet HELT med menuens egne knapper.
//
// ⛔ Regelaendring (Gustav 9/10, «1 ja»; R9 kraevede hans udtrykkelige ja): boksen
//    maa have «Allow». Det er den samme handling som menuens - Touch ID hver gang,
//    samme engangsnummer - og den vises KUN naar hele teksten staar i boksen: et ja
//    skal daekke alt hvad mennesket saa. Laengere spoergsmaal godkendes i menuen.

/// Saa mange tegn kan boksen vise HELT, ombrudt.
let BOKS_MAX_TEGN = 280
let BOKS_BREDDE_TEGN = 48

struct BoksIndhold: Equatable {
    let titel: String
    let orange: Bool
    let linjer: [String]
    let knapper: [String]
}

/// Menuens knap -> boksens. Kun etiketten er kortere; handlingen er den samme.
func boksKnap(_ menuKnap: String) -> String {
    menuKnap == "Allow… (confirm with Touch ID)" ? "Allow (Touch ID)" : menuKnap
}

/// `arbejder`: dem der arbejder nu (navn, hvilket program, hvad de goer).
/// `venter`: det foerste aabne spoergsmaal og menuens knapper for det.
func boksIndhold(arbejder: [(navn: String, maal: String?, nu: String)], tilsluttede: Int,
                 venter: (antal: Int, klient: String?, tekst: String, menuKnapper: [String])?) -> BoksIndhold {
    if let v = venter {
        let hel = renTekst(v.tekst)
        let helVist = hel.count <= BOKS_MAX_TEGN
        var linjer = helVist ? ombryd(hel, bredde: BOKS_BREDDE_TEGN)
            : ombryd(String(hel.prefix(120)) + "…", bredde: BOKS_BREDDE_TEGN)
              + ["(\(hel.count) characters - the whole text is in the menu bar icon)"]
        if v.antal > 1 { linjer.append("+\(v.antal - 1) more in the menu bar icon") }
        let knapper = v.menuKnapper
            .filter { helVist || $0 != "Allow… (confirm with Touch ID)" }
            .map(boksKnap)
        return BoksIndhold(titel: "\(renTekst(v.klient ?? "An agent")) needs you", orange: true, linjer: linjer, knapper: knapper)
    }
    var linjer: [String] = []
    for a in arbejder.prefix(3) {
        linjer.append("● " + renTekst(a.navn) + (a.maal.map { " · " + renTekst($0) } ?? ""))
        linjer.append("   " + kort(a.nu, 60))
    }
    if arbejder.count > 3 { linjer.append("+\(arbejder.count - 3) more working") }
    let hale = tilsluttede > arbejder.count ? " · \(tilsluttede) connected" : ""
    let titel = (arbejder.count == 1 ? "Computer MCP - 1 agent working" : "Computer MCP - \(arbejder.count) agents working") + hale
    return BoksIndhold(titel: titel, orange: false, linjer: linjer, knapper: arbejder.isEmpty ? [] : ["Follow"])
}

/// Hvilken skaerm arbejder mennesket paa? Den med det forreste vindue; ellers den
/// musen er paa; ellers den foerste. Rammerne er i Cocoa-koordinater.
func boksSkaerm(forrestVindue: CGRect?, mus: CGPoint, skaerme: [CGRect]) -> Int {
    if let v = forrestVindue, let i = skaerme.firstIndex(where: { $0.contains(CGPoint(x: v.midX, y: v.midY)) }) { return i }
    if let i = skaerme.firstIndex(where: { $0.contains(mus) }) { return i }
    return 0
}

/// CGWindowList maaler fra hovedskaermens OEVERSTE venstre hjoerne med y nedad;
/// NSScreen fra det NEDERSTE med y opad.
func cocoaRamme(_ cg: CGRect, hovedHoejde: CGFloat) -> CGRect {
    CGRect(x: cg.minX, y: hovedHoejde - cg.maxY, width: cg.width, height: cg.height)
}

/// Ombryder teksten i linjer, saa HELE den kan laeses i menuen (29/9).
/// Et ord laengere end linjen deles; intet tegn falder ud.
func ombryd(_ s: String, bredde: Int = 64) -> [String] {
    var linjer: [String] = []
    var nu = ""
    for stk in renTekst(s).split(separator: " ", omittingEmptySubsequences: true) {
        var ord = String(stk)
        while ord.count > bredde {
            if !nu.isEmpty { linjer.append(nu); nu = "" }
            linjer.append(String(ord.prefix(bredde)))
            ord = String(ord.dropFirst(bredde))
        }
        if nu.isEmpty { nu = ord } else if nu.count + 1 + ord.count <= bredde { nu += " " + ord } else { linjer.append(nu); nu = ord }
    }
    if !nu.isEmpty { linjer.append(nu) }
    return linjer
}
