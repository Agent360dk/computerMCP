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
