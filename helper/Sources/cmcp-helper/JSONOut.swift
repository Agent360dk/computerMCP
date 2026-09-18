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

    init(_ argv: [String]) {
        var rest = Array(argv.dropFirst())
        command = rest.first ?? ""
        if !rest.isEmpty { rest.removeFirst() }
        var m: [String: String] = [:]
        var i = 0
        while i < rest.count {
            let a = rest[i]
            guard a.hasPrefix("--") else { i += 1; continue }
            let key = String(a.dropFirst(2))
            if i + 1 < rest.count, !rest[i + 1].hasPrefix("--") {
                m[key] = rest[i + 1]; i += 2
            } else {
                m[key] = "true"; i += 1
            }
        }
        map = m
    }

    func str(_ k: String) -> String? { map[k] }
    func dbl(_ k: String) -> Double? { map[k].flatMap(Double.init) }
    func int(_ k: String) -> Int? { map[k].flatMap(Int.init) }
    func flag(_ k: String) -> Bool { map[k] == "true" }
}
