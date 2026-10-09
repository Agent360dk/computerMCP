import Foundation

/// ⛔ 9/10 (F1 paa Gustavs Mac): WhatsApp hedder «\u{200E}WhatsApp» - et usynligt
///    venstre-mod-hoejre-maerke (U+200E) foran navnet, baade i filnavnet
///    (/Applications/\u{200E}WhatsApp.app) og i CFBundleDisplayName. `--app WhatsApp`
///    fandt derfor intet: opstarten blev «ukendt maal» og afvist i baggrunden, og
///    hvert skrivende kald i en koerende WhatsApp ligesaa. Et menneske ser «WhatsApp»;
///    det goer opslaget nu ogsaa.
///
///    Reglen er den SAMME som serverens `findProgram` i helper.js - porten og
///    leveringen skal ramme samme program (18/9). test/usynlige-navne.mjs koerer
///    begge sider mod de samme tilfaelde og sammenligner tegnmaengderne udtoemmende:
///      1. bundle-id praecist, saa bundle-id uden hensyn til store/smaa bogstaver
///      2. et praecist navn (smaa bogstaver) - det foerste
///      3. ellers navnet uden usynlige formateringstegn (Unicode Cf) - men kun naar
///         praecis ét program passer. Passer flere, er svaret «tvetydig», og et
///         tvetydigt navn afvises (ogsaa ved opstart: ingen faldbag til disken).
///
/// ⛔ R16 (Astra + Opus, MAALT 9/10): foerste udgave brugte Swifts egne regler -
///    `.whitespacesAndNewlines` (fjerner ogsaa U+0085 og U+200B, men ikke U+FEFF),
///    `lowercased()` paa hele strengen og Swifts kanoniske `==` (é = e+U+0301). JS
///    goer det modsatte paa alle tre. «Computer MCP\u{85}» blev derfor «ukendt maal»
///    i porten og menulinje-ikonet i hjaelperen. Nu: JS' trim-maengde ordret, smaa
///    bogstaver tegn for tegn, og sammenligning paa tegn - ikke paa kanonisk lighed.
enum Navne {
    enum Valg: Equatable { case fundet(Int), intet, tvetydig }

    /// Praecis ECMAScripts WhiteSpace + LineTerminator - det `String.prototype.trim` fjerner.
    static let kant: Set<UInt32> = Set([0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680]
        + Array(0x2000...0x200A) + [0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF])

    static func trim(_ s: String) -> [Unicode.Scalar] {
        var a = Array(s.unicodeScalars)
        while let f = a.first, kant.contains(f.value) { a.removeFirst() }
        while let l = a.last, kant.contains(l.value) { a.removeLast() }
        return a
    }

    /// Smaa bogstaver tegn for tegn - som JS' `Array.from(s, c => c.toLowerCase())`.
    static func smaa(_ t: [Unicode.Scalar]) -> [Unicode.Scalar] {
        t.flatMap { Array(String($0).lowercased().unicodeScalars) }
    }

    static func noegle(_ s: String) -> [Unicode.Scalar] {
        var v = String.UnicodeScalarView()
        v.append(contentsOf: s.unicodeScalars.filter { $0.properties.generalCategory != .format })
        return smaa(trim(String(v)))
    }

    /// Navnetrinene (2-3). Bruges alene for programmer paa disken, der ikke har et id endnu.
    static func vaelg(_ navne: [String], _ want: String) -> Valg {
        let lav = smaa(trim(want))
        guard !lav.isEmpty else { return .intet }
        if let i = navne.firstIndex(where: { smaa(Array($0.unicodeScalars)) == lav }) { return .fundet(i) }
        let n = noegle(want)
        guard !n.isEmpty else { return .intet }
        let hits = navne.indices.filter { noegle(navne[$0]) == n }
        return hits.count == 1 ? .fundet(hits[0]) : (hits.isEmpty ? .intet : .tvetydig)
    }

    /// Et koerende program: trin 1-3 i den raekkefoelge serverens `findProgram` bruger.
    static func vaelgApp(ids: [String?], navne: [String?], want: String) -> Valg {
        let w = trim(want)
        guard !w.isEmpty else { return .intet }
        if let i = ids.firstIndex(where: { $0.map { Array($0.unicodeScalars) } == w }) { return .fundet(i) }
        let lw = smaa(w)
        if let i = ids.firstIndex(where: { $0.map { smaa(Array($0.unicodeScalars)) } == lw }) { return .fundet(i) }
        return vaelg(navne.map { $0 ?? "" }, want)
    }

    /// `--app <navn>` oversat ÉN gang, foer nogen kommando ser det. `slaaOp` er
    /// opslaget blandt de koerende programmer; giver det intet, staar argumentet uroert.
    static func oversaet(_ argv: [String], slaaOp: (String) -> String?) -> [String] {
        var a = argv
        for i in a.indices.dropLast() where a[i] == "--app" && !a[i + 1].hasPrefix("--") {
            if let bid = slaaOp(a[i + 1]) { a[i + 1] = bid }
        }
        return a
    }
}
