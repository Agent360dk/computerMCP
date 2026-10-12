import Foundation

// Maa agenten skrive - taste eller indsaette - i det felt der har fokus? (R23)
// Egen fil, saa test/skriv-ankommer.mjs kan kompilere afgoerelsen for sig.
//
// ⛔ R23 (Opus, Astra): macOS' eget adgangskodesignal (Secure Event Input) taendes af
//    en browser for et kodeordsfelt - ogsaa naar tilgaengeligheds-laget kun ser en
//    beholder (AXWebArea) og derfor siger «ikke sikkert». Signalet er kun et EKSTRA
//    NEJ: det er globalt (et kodeordsfelt i ethvert program taender det) og slukket,
//    naar browseren ikke er forrest. Det kan aldrig goere et ukendt fokus til et ja.

enum SkriveDom: Equatable { case maa, ukendtFokus, sikkertFelt }

/// `fokusSikkert`: tilgaengeligheds-lagets svar (nil = ukendt).
/// `sikkerIndtastning`: macOS' adgangskodesignal lige nu.
func skriveDom(fokusSikkert: Bool?, sikkerIndtastning: Bool) -> SkriveDom {
    if sikkerIndtastning { return .sikkertFelt }
    guard let s = fokusSikkert else { return .ukendtFokus }
    return s ? .sikkertFelt : .maa
}

/// Skriver denne tastekombination TEKST i feltet med fokus? (R24, Astra + Opus: `key`
/// med «a» eller cmd+v gik uden om skriveDom.) Bogstaver, tal og mellemrum uden cmd/ctrl
/// (shift, alt og fn giver ogsaa tegn), og cmd+v (indsaet). Genveje og flytte-taster ikke.
func kombiSkriverTekst(_ combo: String) -> Bool {
    let dele = combo.lowercased().split(separator: "+").map(String.init)
    guard let tast = dele.last else { return false }
    let mod = Set(dele.dropLast())
    if mod.contains("ctrl") || mod.contains("control") { return false }
    let cmd = mod.contains("cmd") || mod.contains("command") || mod.contains("meta")
    if cmd { return tast == "v" }
    return tast == "space" || (tast.count == 1 && (tast.first!.isLetter || tast.first!.isNumber))
}

/// Valget efter en soegning (R23/R24 - ren funktion, saa ÉT fund efter tidsudloeb kan proeves).
enum ValgDom: Equatable { case vaelg(Int), ufuldstaendig, udenforListen, ingen, tvetydigOverskriver, tvetydig }

func valgEfterSoegning(antal: Int, stoppedeTidligt: Bool, index: Int?, maaGaette: Bool, first: Bool) -> ValgDom {
    // ⛔ R23 (Astra, maalt): en soegning der loeb toer for tid har maaske ikke set et
    //    andet, ens element. Saa vaelges intet af sig selv - kun et udtrykkeligt index.
    if stoppedeTidligt && index == nil { return .ufuldstaendig }
    if let i = index { return i >= 0 && i < antal ? .vaelg(i) : .udenforListen }
    if antal == 0 { return .ingen }
    if antal > 1 {
        if !maaGaette { return .tvetydigOverskriver }
        if !first { return .tvetydig }
    }
    return .vaelg(0)
}
