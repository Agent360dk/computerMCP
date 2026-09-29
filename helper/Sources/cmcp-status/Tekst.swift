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
