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
///    begge sider mod de samme tilfaelde:
///      1. et praecist navn (store/smaa bogstaver ligegyldige) vinder, som foer
///      2. ellers navnet uden usynlige formateringstegn (Unicode Cf) - men kun naar
///         praecis ét program passer. Passer flere, vaelges intet, og et ukendt maal
///         afvises.
enum Navne {
    static func noegle(_ s: String) -> String {
        var v = String.UnicodeScalarView()
        v.append(contentsOf: s.unicodeScalars.filter { $0.properties.generalCategory != .format })
        return String(v).trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    /// Hvilket af `navne` mener `want`? nil = intet entydigt.
    static func vaelg(_ navne: [String], _ want: String) -> Int? {
        let lav = want.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if let i = navne.firstIndex(where: { $0.lowercased() == lav }) { return i }
        let n = noegle(want)
        guard !n.isEmpty else { return nil }
        let hits = navne.indices.filter { noegle(navne[$0]) == n }
        return hits.count == 1 ? hits[0] : nil
    }
}
