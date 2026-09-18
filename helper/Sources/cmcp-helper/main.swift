import AppKit
import Foundation

let HELPER_VERSION = "0.1.0"

let args = Args(CommandLine.arguments)

func denySet(_ a: Args) -> Set<String> {
    guard let raw = a.str("deny") else { return [] }
    return Set(raw.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty })
}

switch args.command {

case "version", "--version", "-v":
    Out.ok(["version": HELPER_VERSION])

case "permissions":
    Out.ok(Perms.report())

case "apps":
    let apps = AX.runningApps().map { a -> [String: Any] in
        [
            "name": a.localizedName ?? "",
            "bundleId": a.bundleIdentifier ?? "",
            "pid": a.processIdentifier,
            "active": a.isActive
        ]
    }
    Out.ok(["apps": apps, "count": apps.count])

case "windows":
    Perms.require(accessibility: true)
    var out: [[String: Any]] = []
    for a in AX.runningApps() {
        if let scope = args.str("app"),
           a.bundleIdentifier != scope,
           a.localizedName?.lowercased() != scope.lowercased() { continue }
        for w in AX.windows(of: a) {
            var d: [String: Any] = ["app": a.localizedName ?? "", "bundleId": a.bundleIdentifier ?? ""]
            d["title"] = AX.string(w, kAXTitleAttribute as String) ?? ""
            if let f = AX.frame(w) { d["frame"] = f.dict }
            out.append(d)
        }
    }
    Out.ok(["windows": out, "count": out.count])

case "activate":
    guard let bid = args.str("app") else { Out.fail("--app mangler", code: "bad-args") }
    guard let a = AX.app(bundleId: bid) else { Out.fail("programmet '\(bid)' koerer ikke", code: "not-running") }
    a.activate(options: [])
    Out.ok(["activated": a.localizedName ?? bid])

case "secure-rects":
    Perms.require(accessibility: true)
    let rects = AX.secureRects(scopeBundleId: args.str("app"), extraDeny: denySet(args))
    Out.ok(["rects": rects.map(\.dict), "count": rects.count])

case "screenshot":
    guard let out = args.str("out") else { Out.fail("--out mangler", code: "bad-args") }
    Capture.run(
        outPath: out,
        bundleId: args.str("app"),
        redact: !args.flag("no-redact"),
        extraDeny: denySet(args),
        maxWidth: args.int("max-width")
    )

case "redact":
    guard let inp = args.str("in"), let outp = args.str("out") else {
        Out.fail("--in og --out mangler", code: "bad-args")
    }
    guard let raw = args.str("rects") else { Out.fail("--rects mangler (x,y,w,h;x,y,w,h)", code: "bad-args") }
    let parsed: [Rect] = raw.split(separator: ";").compactMap { part in
        let n = part.split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
        guard n.count == 4 else { return nil }
        return Rect(x: n[0], y: n[1], w: n[2], h: n[3])
    }
    guard !parsed.isEmpty else { Out.fail("kunne ikke laese --rects", code: "bad-args") }
    Capture.redactFile(inPath: inp, outPath: outp, rects: parsed, scale: args.dbl("scale") ?? 1.0)

case "inspect":
    Perms.require(accessibility: true)
    let nodes = AX.inspect(
        bundleId: args.str("app"),
        maxDepth: args.int("depth") ?? 12,
        maxNodes: args.int("limit") ?? 400
    )
    Out.ok(["nodes": nodes, "count": nodes.count])

case "click":
    Perms.require(accessibility: true)
    guard let x = args.dbl("x"), let y = args.dbl("y") else { Out.fail("--x og --y mangler", code: "bad-args") }
    Input.click(x: x, y: y, button: args.str("button") ?? "left", count: args.int("count") ?? 1)
    Out.ok(["clicked": ["x": x, "y": y]])

case "move":
    Perms.require(accessibility: true)
    guard let x = args.dbl("x"), let y = args.dbl("y") else { Out.fail("--x og --y mangler", code: "bad-args") }
    Input.move(x: x, y: y)
    Out.ok(["moved": ["x": x, "y": y]])

case "scroll":
    Perms.require(accessibility: true)
    Input.scroll(dx: args.int("dx") ?? 0, dy: args.int("dy") ?? 0)
    Out.ok([:])

case "type":
    Perms.require(accessibility: true)
    guard let text = args.str("text") else { Out.fail("--text mangler", code: "bad-args") }
    Input.type(text, cps: args.int("cps") ?? 240)
    Out.ok(["typed": text.count])

case "key":
    Perms.require(accessibility: true)
    guard let combo = args.str("combo") else { Out.fail("--combo mangler", code: "bad-args") }
    guard Input.hotkey(combo) else { Out.fail("ukendt tastekombination '\(combo)'", code: "bad-key") }
    Out.ok(["key": combo])

default:
    Out.fail(
        "ukendt kommando '\(args.command)'",
        code: "bad-command",
        extra: ["commands": ["version", "permissions", "apps", "windows", "activate", "secure-rects",
                            "screenshot", "redact", "inspect", "click", "move", "scroll", "type", "key"]]
    )
}
