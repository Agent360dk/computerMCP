import AppKit
import Foundation

let HELPER_VERSION = "0.2.0"

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
        maxWidth: args.int("max-width"),
        displayIndex: args.int("display"),
        displayId: args.int("display-id")
    )

case "space":
    guard let r = args.str("direction"), r == "left" || r == "right" else {
        Out.fail("--direction skal vaere left eller right", code: "bad-args")
    }
    Perms.require(accessibility: true)
    let sp = AX.skiftSpace(hoejre: r == "right")
    if !sp.ok { Out.fail(sp.why, code: "space-failed") }
    var svar: [String: Any] = ["direction": r, "result": sp.why]
    if let a = sp.aendret { svar["verified"] = a }
    Out.ok(svar)

case "launch":
    guard let hvad = args.str("app") else { Out.fail("--app mangler", code: "bad-args") }
    let l = AX.launchApp(hvad)
    if !l.ok { Out.fail(l.why, code: "launch-failed") }
    var ls: [String: Any] = ["app": hvad, "result": l.why]
    if let b = l.bundleId { ls["bundleId"] = b }
    Out.ok(ls)

case "quit":
    guard let hvad = args.str("app") else { Out.fail("--app mangler", code: "bad-args") }
    let q = AX.quitApp(hvad)
    if !q.ok { Out.fail(q.why, code: "quit-failed") }
    Out.ok(["app": hvad, "result": q.why])

case "paste":
    // Teksten kommer paa stdin, ikke som argument - samme grund som `type`:
    // et argument staar i procestabellen, hvor enhver bruger paa maskinen
    // kan laese det med `ps`.
    Perms.require(accessibility: true)
    var ind = ""
    while let l = readLine(strippingNewline: false) { ind += l }
    if ind.isEmpty { Out.fail("ingen tekst paa stdin", code: "bad-args") }
    let r = AX.pasteText(ind, restore: !args.flag("no-restore"))
    if !r.ok { Out.fail(r.why, code: "paste-failed") }
    Out.ok(["pasted": true, "chars": ind.count, "restored": r.restored, "note": r.why])

case "window-set":
    guard let bid = args.str("app") else { Out.fail("--app mangler", code: "bad-args") }
    Perms.require(accessibility: true)
    let ws = AX.windowSet(bundleId: bid, title: args.str("title"), index: args.int("index"),
                          x: args.int("x"), y: args.int("y"), w: args.int("width"), h: args.int("height"))
    if !ws.ok { Out.fail(ws.why, code: "window-failed") }
    var svar: [String: Any] = ["app": bid, "result": ws.why]
    if let f = ws.frame { svar["frame"] = ["x": Int(f.x), "y": Int(f.y), "w": Int(f.w), "h": Int(f.h)] }
    Out.ok(svar)

case "window-button":
    guard let bid = args.str("app") else { Out.fail("--app mangler", code: "bad-args") }
    guard let hvilken = args.str("button"), hvilken == "close" || hvilken == "minimize" else {
        Out.fail("--button skal vaere close eller minimize", code: "bad-args")
    }
    Perms.require(accessibility: true)
    let wb = AX.windowButton(bundleId: bid, title: args.str("title"), index: args.int("index"), which: hvilken)
    if !wb.ok { Out.fail(wb.why, code: "window-failed") }
    Out.ok(["app": bid, "did": wb.why])

case "menus":
    guard let bid = args.str("app") else { Out.fail("--app mangler", code: "bad-args") }
    Perms.require(accessibility: true)
    let punkter = AX.menuPaths(bundleId: bid, maxDepth: args.int("depth") ?? 5)
    if punkter.isEmpty {
        Out.fail("ingen menulinje laest for '\(bid)' - koerer programmet, og er det det rigtige bundle-id?",
                 code: "no-menubar")
    }
    Out.ok(["items": punkter, "count": punkter.count, "app": bid])

case "menu-click":
    guard let bid = args.str("app") else { Out.fail("--app mangler", code: "bad-args") }
    guard let sti = args.str("path") else { Out.fail("--path mangler, f.eks. \"File > Export\"", code: "bad-args") }
    Perms.require(accessibility: true)
    let r = AX.menuClick(bundleId: bid, path: sti)
    if r.ok { Out.ok(["clicked": sti, "app": bid]) }
    Out.fail(r.why, code: "menu-failed")

case "displays":
    Capture.listDisplays()

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
    Capture.redactFile(inPath: inp, outPath: outp, rects: parsed,
                       scale: args.dbl("scale") ?? 1.0,
                       origin: CGPoint(x: args.dbl("origin-x") ?? 0, y: args.dbl("origin-y") ?? 0))

case "inspect":
    Perms.require(accessibility: true)
    let nodes = AX.inspect(
        bundleId: args.str("app"),
        maxDepth: args.int("depth") ?? 12,
        maxNodes: args.int("limit") ?? 400
    )
    Out.ok(["nodes": nodes, "count": nodes.count])

case "find":
    Perms.require(accessibility: true)
    let hits = AX.find(
        bundleId: args.str("app"),
        role: args.str("role"),
        title: args.str("title"),
        contains: args.str("contains"),
        maxDepth: args.int("depth") ?? 24,
        limit: args.int("limit") ?? 25
    )
    Out.ok(["matches": hits.map(\.dict), "count": hits.count])

case "set-value":
    // Skriv i et felt der ligger BAG et andet vindue, uden at flytte musen.
    //
    // ⛔ SPAERREN ER HELE POINTEN. Et sikkert felt afvises, hver gang, uanset
    // hvad der bliver bedt om. Uden den har vi bygget en tavs vej til at
    // skrive i en adgangskodeboks - og det er praecis det produktets foerste
    // loefte siger ikke kan lade sig goere.
    //
    // Teksten kommer paa stdin, aldrig som argument: `ps` viser hele
    // kommandolinjen for enhver proces med samme bruger.
    Perms.require(accessibility: true)
    let sv: String
    if args.flag("stdin") {
        let data = FileHandle.standardInput.readDataToEndOfFile()
        guard let t = String(data: data, encoding: .utf8) else {
            Out.fail("kunne ikke laese teksten fra stdin", code: "bad-args")
        }
        sv = t
    } else if let t = args.str("text") {
        sv = t
    } else {
        Out.fail("--text eller --stdin mangler", code: "bad-args")
    }

    // Enten et navngivet element, eller det der har fokus.
    var target: (el: AXUIElement, dict: [String: Any])?
    if args.str("app") != nil || args.str("role") != nil || args.str("title") != nil || args.str("contains") != nil {
        let hits = AX.find(bundleId: args.str("app"), role: args.str("role"),
                           title: args.str("title"), contains: args.str("contains"),
                           maxDepth: args.int("depth") ?? 24, limit: 25)
        guard let first = hits.first else {
            Out.fail("fandt ikke noget der passer", code: "not-found", extra: ["count": 0])
        }
        if hits.count > 1 && !args.flag("first") {
            Out.fail("fandt \(hits.count) der passer - praecisér, eller brug --first",
                     code: "ambiguous", extra: ["matches": hits.map(\.dict), "count": hits.count])
        }
        target = (first.el, first.dict)
    } else {
        guard let f = AX.focused() else {
            Out.fail("intet element har tastaturfokus, og der blev ikke navngivet et",
                     code: "no-target")
        }
        target = f
    }
    guard let t = target else { Out.fail("intet maal", code: "no-target") }

    let role = (t.dict["role"] as? String) ?? ""
    if AX.isSecure(t.el, role: role) {
        Out.fail("feltet er et sikkert felt - der skrives ikke i adgangskodefelter. Bed mennesket taste selv med computer_ask_user.",
                 code: "secure-field", extra: ["element": t.dict])
    }
    guard AX.setValue(t.el, sv) else {
        Out.fail("elementet tog ikke imod en vaerdi", code: "set-failed", extra: ["element": t.dict])
    }
    Out.ok(["set": true, "length": sv.count, "element": t.dict])

case "focused":
    // Laesende: hvad har tastaturfokus, og er det et sikkert felt?
    Perms.require(accessibility: true)
    if let f = AX.focused() {
        Out.ok(["focused": true, "element": f.dict])
    } else {
        Out.ok(["focused": false,
                "hint": "intet element har tastaturfokus - klik eller tryk i feltet foerst"])
    }

case "wait-for":
    // Vent paa at noget dukker op, i stedet for at tage skaermbilleder i ring.
    //
    // Uden den maa en agent pollet med `screenshot` - og et skaermbillede koster
    // baade tid og en billedbeskrivelse i modellens kontekst. Tyve forsoeg er
    // tyve billeder. Her er det ét kald, og svaret er enten elementet eller en
    // aerlig timeout.
    //
    // Den er LAESENDE: den observerer, den aendrer intet. Derfor ingen
    // samtykke-port - der er intet at give lov til.
    Perms.require(accessibility: true)
    let deadline = Date().addingTimeInterval(Double(args.int("timeout") ?? 15))
    let pollMs = max(100, args.int("poll") ?? 400)
    var attempts = 0
    while true {
        attempts += 1
        let hits = AX.find(
            bundleId: args.str("app"),
            role: args.str("role"),
            title: args.str("title"),
            contains: args.str("contains"),
            maxDepth: args.int("depth") ?? 24,
            limit: 5
        )
        if let first = hits.first {
            Out.ok(["found": true, "waitedSeconds": (Double(attempts) * Double(pollMs) / 1000.0),
                    "attempts": attempts, "match": first.dict, "count": hits.count])
        }
        if Date() >= deadline { break }
        usleep(UInt32(pollMs) * 1000)
    }
    // En timeout er et svar, ikke en fejl i opsaetningen. Beskeden siger hvad
    // der blev ledt efter, saa agenten kan indsnaevre i stedet for at gentage.
    Out.fail("intet element dukkede op inden for tidsgraensen",
             code: "wait-timeout",
             extra: ["found": false, "attempts": attempts,
                     "soegte": ["app": args.str("app") ?? "alle",
                                "role": args.str("role") ?? "-",
                                "title": args.str("title") ?? "-",
                                "contains": args.str("contains") ?? "-"]])

case "press":
    Perms.require(accessibility: true)
    let hits = AX.find(
        bundleId: args.str("app"),
        role: args.str("role"),
        title: args.str("title"),
        contains: args.str("contains"),
        maxDepth: args.int("depth") ?? 24,
        limit: 25
    )
    guard let first = hits.first else {
        Out.fail("fandt ikke noget der passer", code: "not-found", extra: ["count": 0])
    }
    // Flere traef = tvetydigt. Vi gaetter ikke; agenten faar kandidaterne og
    // vaelger selv. At trykke paa det foerste tilfaeldige traef er praecis
    // den slags naesten-rigtige handling der er svaer at opdage bagefter.
    if hits.count > 1 && !args.flag("first") {
        Out.fail("fandt \(hits.count) der passer - praecisér, eller brug --first",
                 code: "ambiguous", extra: ["matches": hits.map(\.dict), "count": hits.count])
    }
    guard AX.press(first) else {
        Out.fail("elementet kunne ikke trykkes", code: "press-failed", extra: ["match": first.dict])
    }
    Out.ok(["pressed": first.dict])

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

case "drag":
    Perms.require(accessibility: true)
    guard let fx = args.dbl("from-x"), let fy = args.dbl("from-y"),
          let tx = args.dbl("to-x"), let ty = args.dbl("to-y") else {
        Out.fail("--from-x --from-y --to-x --to-y mangler", code: "bad-args")
    }
    Input.drag(fromX: fx, fromY: fy, toX: tx, toY: ty,
               steps: args.int("steps") ?? 24, holdMs: args.int("hold-ms") ?? 120)
    Out.ok(["from": ["x": fx, "y": fy], "to": ["x": tx, "y": ty],
            "note": "Traekket er sendt. Om modtageren tog imod det, kan kun et skaermbillede eller en ny inspektion vise - vi paastaar ikke at det lykkedes."])

case "scroll":
    Perms.require(accessibility: true)
    Input.scroll(dx: args.int("dx") ?? 0, dy: args.int("dy") ?? 0)
    Out.ok([:])

case "type":
    Perms.require(accessibility: true)
    // --stdin er den rigtige vej og den eneste vej for hemmeligheder.
    //
    // Gives teksten som --text, staar den i procestabellen: `ps aux` viser
    // hele kommandolinjen for ALLE brugere paa maskinen, saa et kodeord paa
    // vej ind i et felt ville kunne laeses af enhver anden proces mens det
    // skrives. Det er ikke en teoretisk laek; det er en et-linjes kommando.
    // --text beholdes til almindelig tekst, hvor det er praktisk at kunne se
    // kaldet i loggen.
    let typeText: String
    if args.flag("stdin") {
        let data = FileHandle.standardInput.readDataToEndOfFile()
        guard let t = String(data: data, encoding: .utf8) else {
            Out.fail("kunne ikke laese teksten fra stdin", code: "bad-args")
        }
        typeText = t
    } else if let t = args.str("text") {
        typeText = t
    } else {
        Out.fail("--text eller --stdin mangler", code: "bad-args")
    }
    Input.type(typeText, cps: args.int("cps") ?? 240)
    // Laengden, aldrig indholdet.
    Out.ok(["typed": typeText.count])

case "key":
    Perms.require(accessibility: true)
    guard let combo = args.str("combo") else { Out.fail("--combo mangler", code: "bad-args") }
    guard Input.hotkey(combo) else { Out.fail("ukendt tastekombination '\(combo)'", code: "bad-key") }
    Out.ok(["key": combo])

default:
    Out.fail(
        "ukendt kommando '\(args.command)'",
        code: "bad-command",
        extra: ["commands": ["version", "permissions", "apps", "windows", "activate", "secure-rects", "wait-for", "focused", "set-value",
                            "screenshot", "redact", "inspect", "find", "press", "click", "move", "scroll", "type", "key"]]
    )
}
