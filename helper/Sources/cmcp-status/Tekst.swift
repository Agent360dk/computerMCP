import AppKit
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
/// Knapperne goer intet saa laenge efter et NYT spoergsmaal (R17, Opus 4b): et klik
/// paa vej mod det gamle maa ikke ramme det nye, der gled ind under markoeren.
let BOKS_PAUSE: TimeInterval = 1.0

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

/// Knappen der stopper et skaerm-laan. Den staar i menuen OG i boksen, saa laenge
/// laanet varer (R22, Astra + Opus: et stille laan kunne kun ses i menuen, og to
/// spoergsmaal i menulinjen udloeb 9/10, fordi mennesket ikke fandt ikonet).
let TAG_TILBAGE = "Take the screen back now"

/// Linjen om laanet - menuens oeverste linje og boksens, samme tekst.
func laanTekst(klient: String?, minutterTilbage: Int) -> String {
    "\(laanNavn(klient)) is using your screen — \(minutterTilbage) min left"
}

/// Agentens navn i laanets linjer: usynlige tegn vasket og ingen kantmellemrum.
func laanNavn(_ klient: String?) -> String {
    let n = renTekst(klient ?? "").trimmingCharacters(in: .whitespaces)
    return n.isEmpty ? "An agent" : n
}

/// `arbejder`: dem der arbejder nu (navn, hvilket program, hvad de goer).
/// `venter`: det foerste aabne spoergsmaal og menuens knapper for det.
/// `laan`: et aktivt skaerm-laan - saa staar det oeverst, og stopknappen er foerst.
func boksIndhold(arbejder: [(navn: String, maal: String?, nu: String)], tilsluttede: Int,
                 venter: (antal: Int, klient: String?, tekst: String, fakta: [String], menuKnapper: [String])?,
                 laan: (klient: String?, minutter: Int)? = nil) -> BoksIndhold {
    let b = boksIndholdUdenLaan(arbejder: arbejder, tilsluttede: tilsluttede, venter: venter)
    guard let l = laan else { return b }
    if venter != nil {
        return BoksIndhold(titel: b.titel, orange: true,
                           linjer: [laanTekst(klient: l.klient, minutterTilbage: l.minutter)] + b.linjer,
                           knapper: [TAG_TILBAGE] + b.knapper)
    }
    return BoksIndhold(titel: "\(laanNavn(l.klient)) is using your screen", orange: true,
                       linjer: ["\(l.minutter) min left - each step waits while you use the mouse or keyboard"] + b.linjer,
                       knapper: [TAG_TILBAGE] + b.knapper)
}

private func boksIndholdUdenLaan(arbejder: [(navn: String, maal: String?, nu: String)], tilsluttede: Int,
                                 venter: (antal: Int, klient: String?, tekst: String, fakta: [String], menuKnapper: [String])?) -> BoksIndhold {
    if let v = venter {
        let hel = renTekst(v.tekst)
        let helVist = hel.count <= BOKS_MAX_TEGN
        var linjer = helVist ? ombryd(hel, bredde: BOKS_BREDDE_TEGN)
            : ombryd(String(hel.prefix(120)) + "…", bredde: BOKS_BREDDE_TEGN)
              + ["(\(hel.count) characters - the whole text is in the menu bar icon)"]
        // ⛔ R17 (Opus 4c): HVOR det lander og HVOR LAENGE et ja gaelder - menuens fakta,
        //    skrevet af serveren. Altid hele, saa Allow aldrig staar uden dem.
        for f in v.fakta { linjer += ombryd(f, bredde: BOKS_BREDDE_TEGN) }
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

/// Skal boksen staa fremme? (R24, ren funktion - tik() afgoer det kun her.)
/// Et aktivt skaerm-laan holder den fremme uanset alt: stopknappen skal kunne ses.
/// Ellers kun naar der er sessioner, boksen ikke er slaaet fra, og nogen arbejder
/// (eller har gjort det inden for et halvt minut, eller et spoergsmaal venter).
func boksSynlig(laan: Bool, sessioner: Int, slaaetFra: Bool, arbejder: Bool) -> Bool {
    laan || (sessioner > 0 && !slaaetFra && arbejder)
}

/// Boksens panel-opsaetning (R24): laget saettes EFTER isFloatingPanel, som ellers
/// nulstiller det til det almindelige svaevelag (3) - maalt R22 og R24 (Opus).
func boksPanelOpsaetning(_ p: NSPanel) {
    p.isFloatingPanel = true
    p.level = .statusBar
    p.becomesKeyOnlyIfNeeded = true
    p.hidesOnDeactivate = false
    p.isMovableByWindowBackground = true
    p.isReleasedWhenClosed = false
    p.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
    p.backgroundColor = .clear
    p.isOpaque = false
    p.hasShadow = true
    // Boksen er til mennesket, ikke til agenternes skaermbilleder.
    p.sharingType = .none
}

/// Maa boksens knapper goere noget nu? Ikke foer BOKS_PAUSE efter et nyt spoergsmaal,
/// og ikke mens Touch ID-arket er oppe (et andet tryk ville starte endnu et, R17 Opus 4f).
func boksKnapperAktive(sidenNytSpoergsmaal: TimeInterval, touchIdIGang: Bool) -> Bool {
    sidenNytSpoergsmaal >= BOKS_PAUSE && !touchIdIGang
}

enum TouchIdUdfald: Equatable { case laan, svar(Bool) }

/// Hvad Touch ID-svaret betyder - for menuen og boksen ens. Et nej er altid et nej;
/// kun et ja til et skaerm-laan bliver et laan (R18, Astra: et «ok = true» i callbacken
/// overlevede proeven).
func touchIdUdfald(ok: Bool, erLaan: Bool) -> TouchIdUdfald { ok && erLaan ? .laan : .svar(ok) }

enum BoksHandling: Equatable { case foelg, tagTilbage, tillad(String), afvis(String), gjort(String), hentFrem(String), intet }

/// Hvad et tryk paa en boksknap betyder. Knappen baerer sit eget spoergsmaal (`knapNonce`);
/// er det ikke det boksen viser nu, eller er knapperne ikke aktive, sker intet.
func boksHandling(knap: String, knapNonce: String?, visteNonce: String?, aktive: Bool) -> BoksHandling {
    if knap == "Follow" { return .foelg }
    // At STOPPE venter aldrig: ingen pause, intet Touch ID, intet engangsnummer.
    if knap == TAG_TILBAGE { return .tagTilbage }
    guard aktive, let n = knapNonce, n == visteNonce else { return .intet }
    switch knap {
    case "Allow (Touch ID)": return .tillad(n)
    case "Done — I did it": return .gjort(n)
    case "Take me there": return .hentFrem(n)
    case "Deny", "I won't do this": return .afvis(n)
    default: return .intet
    }
}

/// Hvilken skaerm arbejder mennesket paa? Den med det forreste vindue; ellers den
/// musen er paa; ellers den foerste. Rammerne er i Cocoa-koordinater.
func boksSkaerm(forrestVindue: CGRect?, mus: CGPoint, skaerme: [CGRect]) -> Int {
    if let v = forrestVindue, let i = skaerme.firstIndex(where: { $0.contains(CGPoint(x: v.midX, y: v.midY)) }) { return i }
    if let i = skaerme.firstIndex(where: { $0.contains(mus) }) { return i }
    return 0
}

/// Boksens oeverste venstre hjoerne: oeverst til hoejre i skaermens synlige del.
func boksHjoerne(synlig: CGRect, bredde: CGFloat) -> CGPoint {
    CGPoint(x: synlig.maxX - bredde - 16, y: synlig.maxY - 12)
}

/// Det forreste programs forreste ALMINDELIGE vindue (lag 0) i CGWindowList' liste,
/// som er ordnet forrest foerst. Rammen er i CGWindowList' koordinater.
func forrestVinduesRamme(_ liste: [[String: Any]], pid: Int32) -> CGRect? {
    for w in liste where (w[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid
                      && (w[kCGWindowLayer as String] as? NSNumber)?.intValue == 0 {
        if let d = w[kCGWindowBounds as String] as? NSDictionary, let r = CGRect(dictionaryRepresentation: d) { return r }
    }
    return nil
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
