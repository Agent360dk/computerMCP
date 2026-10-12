import Foundation

// LYD VED ET NYT SPOERGSMAAL (panel R8-R9, punkt S, 7/10).
//
// ⛔ 22 af 23 spoergsmaal 30/9-4/10 udloeb ubesvaret. Det orange ikon ses kun af den
//    der kigger paa menulinjen; en lyd naar ogsaa den hvis blik er i chatten.
//    Reglen: ÉN lyd pr. nyt spoergsmaal - aldrig ved udloeb (`nyAnmodning` kaldes
//    ogsaa dér, for at slukke det orange), aldrig for et spoergsmaal der allerede er
//    besvaret, og aldrig to gange for samme nonce (en server kan levere det samme
//    spoergsmaal igen paa en ny forbindelse). Afgjort her, ét sted, saa test/ikon-lyd.mjs
//    kompilerer og maaler den samme regel ikonet bruger - uden at starte ikonet.
//
// Standarden var Gustavs valg (Opus: til, hans egen WISHLIST-tekst · Astra: tilvalg).
// Gustav 8/10 («kør det hele» på anbefalingen «lyd til»): TIL. Kan slås fra i menuen.
let LYD_STANDARD = true

func lydSlaaetTil() -> Bool {
    (UserDefaults.standard.object(forKey: "lyd") as? Bool) ?? LYD_STANDARD
}

struct LydHukommelse {
    private(set) var hoerte = Set<String>()

    /// Skal dette spoergsmaal give lyd nu? Husker nonce'en, saa svaret kun er ja én gang.
    mutating func skalLyde(nonce: String, lukket: Bool, besvaret: Bool, til: Bool) -> Bool {
        guard til, !lukket, !besvaret, !hoerte.contains(nonce) else { return false }
        // Et ikon lever i dagevis; hukommelsen maa ikke vokse uden graense.
        if hoerte.count >= 1000 { hoerte.removeAll() }
        hoerte.insert(nonce)
        return true
    }
}
