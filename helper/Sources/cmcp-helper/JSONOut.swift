import Foundation

/// Hjaelperen taler kun JSON paa stdout. Én linje, ét svar.
/// Alt menneskelaesbart gaar til stderr, saa serveren aldrig skal gaette
/// om en linje er data eller stoej.
enum Out {
    static func ok(_ payload: [String: Any] = [:]) -> Never {
        emit(["ok": true].merging(payload) { _, new in new })
        exit(0)
    }

    static func fail(_ message: String, code: String = "error", extra: [String: Any] = [:]) -> Never {
        emit(["ok": false, "error": message, "code": code].merging(extra) { _, new in new })
        exit(1)
    }

    private static func emit(_ dict: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: dict, options: [.sortedKeys]),
              let text = String(data: data, encoding: .utf8) else {
            FileHandle.standardOutput.write(Data("{\"ok\":false,\"error\":\"json-encode-failed\"}\n".utf8))
            return
        }
        FileHandle.standardOutput.write(Data((text + "\n").utf8))
    }
}

/// Minimal argument-parser. Understoetter `--flag vaerdi` og `--flag`.
struct Args {
    let command: String
    private let map: [String: String]
    /// Noegler der blev sat til "true" fordi det naeste ord SELV begyndte med `--`.
    /// ⛔ SIKKERHEDSGENNEMGANG 24/9 (B1): `--max-width --no-redact` gav
    ///    max-width="true" OG no-redact=true - en vaerdi fra modellen blev til et
    ///    flag der slog sloeringen fra. Laeses saadan en noegle som en VAERDI
    ///    (str/int/dbl), er det ikke en vaerdi - det er et flag der tog dens plads.
    private let tomme: Set<String>

    init(_ argv: [String]) {
        var rest = Array(argv.dropFirst())
        command = rest.first ?? ""
        if !rest.isEmpty { rest.removeFirst() }
        var m: [String: String] = [:]
        var t: Set<String> = []
        var i = 0
        while i < rest.count {
            let a = rest[i]
            guard a.hasPrefix("--") else { i += 1; continue }
            let key = String(a.dropFirst(2))
            if i + 1 < rest.count, !rest[i + 1].hasPrefix("--") {
                m[key] = rest[i + 1]; i += 2
            } else {
                m[key] = "true"; t.insert(key); i += 1
            }
        }
        map = m
        tomme = t
    }

    /// En noegle der skulle have en vaerdi, men fik et flag i stedet, afvises -
    /// ellers bliver det flag stille og roligt til virkelighed.
    private func vaerdi(_ k: String) -> String? {
        if tomme.contains(k) {
            Out.fail("--\(k) needs a value, but the next word began with -- and was read as a flag instead. Refused, because that is how a value can switch a safety flag on.",
                     code: "bad-args")
        }
        return map[k]
    }
    func str(_ k: String) -> String? { vaerdi(k) }
    func dbl(_ k: String) -> Double? { vaerdi(k).flatMap(Double.init) }
    func int(_ k: String) -> Int? { vaerdi(k).flatMap(Int.init) }
    func flag(_ k: String) -> Bool { map[k] == "true" }

    /// Flag kommandoen ikke kender. Parseren samler ALT og lader hver kommando
    /// laese det den kender - resten ligger tavst tilbage.
    /// ⛔ MAALT 24/9 paa min egen skaerm: en aeldre binaer kendte ikke `--plan`
    ///    («tag IKKE et billede»), ignorerede det i stilhed og tog et almindeligt
    ///    skaermbillede. Et sikkerhedsflag blev til sin modsaetning uden en fejl.
    func ukendte(_ kendte: Set<String>) -> [String] { map.keys.filter { !kendte.contains($0) }.sorted() }
}
