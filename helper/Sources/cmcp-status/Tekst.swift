import Foundation

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

/// Boksen paa skaermen mens et spoergsmaal venter (30/9, live-proeven).
/// ⛔ MAALT: fire skaerm-laan udloeb uden svar, ogsaa mens Gustav holdt oeje. Ikonet
///    skiftede korrekt 21 -> 1, men boksen sagde kun «N working» og stod paa en
///    anden skaerm. Kun tekst - boksen faar aldrig en knap, der kan give et ja.
func ventendeBoks(antal: Int, tekst: String) -> [String] {
    [antal == 1 ? "Needs you: click the orange menu bar icon" : "\(antal) questions: click the orange menu bar icon",
     kort(tekst, 60)]
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
