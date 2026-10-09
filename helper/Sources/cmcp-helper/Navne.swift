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
        let v = vaelg(navne.map { $0 ?? "" }, want)
        // ⛔ R18 (Opus, MAALT live): et navn hvis id deles med en koerende proces med et ANDET
        //    navn (visningstjenester), er tvetydigt - leveringen gaar til id'et, ikke processen.
        guard case .fundet(let i) = v, let id = ids[i], !id.isEmpty else { return v }
        let mit = smaa(Array((navne[i] ?? "").unicodeScalars))
        let delt = ids.indices.contains { $0 != i && ids[$0] == id && smaa(Array((navne[$0] ?? "").unicodeScalars)) != mit }
        return delt ? .tvetydig : v
    }

    /// Programmets id efter oversaettelsen. Et program uden bundle-id (fx et program
    /// bygget med swiftc) faar sin proces som id: «pid:<n>» - ellers kunne det slet ikke
    /// naas, naar filtrene kun sammenligner id (R17-koersel 9/10: test/vaelger.mjs).
    static func id(bundleId: String?, pid: Int32) -> String {
        if let b = bundleId, !b.isEmpty { return b }
        return "pid:\(pid)"
    }

    /// `--app <navn>` oversat ÉN gang, foer nogen kommando ser det. `slaaOp` er
    /// opslaget blandt de koerende programmer; giver det intet, staar argumentet uroert.
    /// R17: `--app =<id>` er et maal serverens port har bundet - kun det praecise id, og
    /// koerer det ikke (`findesPraecist`), er svaret nil: intet maa ske.
    ///    `bundet` siger at maalet var bundet: saa maa intet senere opslag i hjaelperen
    ///    falde tilbage paa navne eller paa disken (R18, Astra: programmet kan forsvinde
    ///    mellem indgangen og leveringen).
    static func oversaet(_ argv: [String], slaaOp: (String) -> String?,
                         findesPraecist: (String) -> Bool) -> (argv: [String], bundet: Bool)? {
        var a = argv
        var bundet = false
        for i in a.indices.dropLast() where a[i] == "--app" && !a[i + 1].hasPrefix("--") {
            let v = a[i + 1]
            if v.hasPrefix("=") {
                let id = String(v.dropFirst())
                guard !id.isEmpty, findesPraecist(id) else { return nil }
                a[i + 1] = id
                bundet = true
            } else if let bid = slaaOp(v) { a[i + 1] = bid }
        }
        return (a, bundet)
    }
}
