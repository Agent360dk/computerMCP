import AppKit
import Foundation

/// Hvem skal haendelsen leveres til?
///
/// Uden `--app` gaar den i den globale HID-stroem: den flytter den rigtige
/// markoer og rammer det forreste program. Med `--app` lægges den i dét
/// programs egen koe, og mennesket maerker intet.
///
/// Findes et program ikke, er det en FEJL og ikke en stille tilbagefalden til
/// den globale stroem: et tastetryk der lander et andet sted end agenten bad
/// om, er praecis den slags der goer at man ikke kan lade den koere alene.
func modtager(_ args: Args) -> pid_t? {
    guard let navn = args.str("app") else { return nil }
    guard let app = AX.app(bundleId: navn)
        ?? AX.allApps().first(where: { $0.bundleIdentifier == navn })
        ?? AX.allApps().first(where: { $0.localizedName?.lowercased() == navn.lowercased() }) else {
        Out.fail("'\(navn)' is not running, so there is no queue to deliver to",
                 code: "app-not-found")
    }
    return app.processIdentifier
}


let HELPER_VERSION = "0.2.0"

let args = Args(CommandLine.arguments)

// ⛔ FUNDET AF SIKKERHEDSREVIEWET 20/9. `contains` og `title` gik som
//    ARGUMENTER, og `ps` viser hele kommandolinjen for enhver proces med samme
//    bruger. MAALT: `--contains MIN-ADGANGSKODE-42` stod ordret i
//    procestabellen. Det er praecis den laekvej vi lukkede for den SKREVNE
//    tekst 18/9 - og vores egen revisionslog fingeraftrykker de samme to
//    felter, netop fordi de baerer hemmeligheder ("vent til feltet indeholder
//    <min adgangskode>"). Loggen behandlede dem som hemmelige; kaldet gjorde
//    ikke.
//
//    Med --match-stdin kommer de paa stdin som JSON i stedet. De gamle flag
//    virker stadig, saa et menneske kan koere hjaelperen i haanden - men
//    serveren bruger altid stdin.
struct Soegning {
    var title: String?
    var contains: String?
    /// `set-value` skal bruge BAADE en soegning og en tekst. De kan ikke hver
    /// laese stdin, saa de deler én blok.
    var text: String?
}

func laesSoegning(_ a: Args) -> Soegning {
    if a.flag("match-stdin") {
        let data = FileHandle.standardInput.readDataToEndOfFile()
        if let t = String(data: data, encoding: .utf8),
           let d = try? JSONSerialization.jsonObject(with: Data(t.utf8)) as? [String: Any] {
            return Soegning(title: d["title"] as? String,
                            contains: d["contains"] as? String,
                            text: d["text"] as? String)
        }
        return Soegning(title: nil, contains: nil, text: nil)
    }
    return Soegning(title: a.str("title"), contains: a.str("contains"), text: nil)
}

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
    guard let bid = args.str("app") else { Out.fail("--app is missing", code: "bad-args") }
    guard let a = AX.app(bundleId: bid) else { Out.fail("the app '\(bid)' is not running", code: "not-running") }
    a.activate(options: [])
    Out.ok(["activated": a.localizedName ?? bid])

case "secure-rects":
    Perms.require(accessibility: true)
    let rects = AX.secureRects(scopeBundleId: args.str("app"), extraDeny: denySet(args))
    Out.ok(["rects": rects.map(\.dict), "count": rects.count])

case "screenshot":
    guard let out = args.str("out") else { Out.fail("--out is missing", code: "bad-args") }
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
    guard let hvad = args.str("app") else { Out.fail("--app is missing", code: "bad-args") }
    // --background starter programmet uden at hente det frem.
    let stille = args.flag("background")
    let foerL = Skaerm.stand()
    let l = AX.launchApp(hvad, stille: stille)
    if !l.ok { Out.fail(l.why, code: "launch-failed") }
    var ls: [String: Any] = ["app": hvad, "result": l.why]
    if let b = l.bundleId { ls["bundleId"] = b }
    // ⛔ MAALT 22/9: uden --background sagde feltet `took_screen: false`, fordi
    //    et program ikke naar at komme frem paa 300 ms. Maalingen var sand om
    //    oejeblikket og falsk om handlingen.
    //
    //    Vi beder SELV om aktiveringen, saa den skal ikke observeres - den skal
    //    erklaeres. Kun den stille vej fortjener en maaling, for der er det et
    //    aabent spoergsmaal om programmet selv hiver sig frem.
    if stille {
        usleep(600_000)
        for (k, v) in Skaerm.udfald(foer: foerL) { ls[k] = v }
    } else {
        ls["took_screen"] = true
        ls["why"] = "launching without --background brings the app to the front. Pass --background to start it behind what the person is doing."
    }
    Out.ok(ls)

case "quit":
    guard let hvad = args.str("app") else { Out.fail("--app is missing", code: "bad-args") }
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
    if ind.isEmpty { Out.fail("no text on stdin", code: "bad-args") }
    let r = AX.pasteText(ind, restore: !args.flag("no-restore"))
    if !r.ok { Out.fail(r.why, code: "paste-failed") }
    Out.ok(["pasted": true, "chars": ind.count, "restored": r.restored, "note": r.why])

case "window-set":
    guard let bid = args.str("app") else { Out.fail("--app is missing", code: "bad-args") }
    Perms.require(accessibility: true)
    let ws = AX.windowSet(bundleId: bid, title: args.str("title"), index: args.int("index"),
                          x: args.int("x"), y: args.int("y"), w: args.int("width"), h: args.int("height"))
    if !ws.ok { Out.fail(ws.why, code: "window-failed") }
    var svar: [String: Any] = ["app": bid, "result": ws.why]
    if let f = ws.frame { svar["frame"] = ["x": Int(f.x), "y": Int(f.y), "w": Int(f.w), "h": Int(f.h)] }
    Out.ok(svar)

case "window-button":
    guard let bid = args.str("app") else { Out.fail("--app is missing", code: "bad-args") }
    guard let hvilken = args.str("button"), hvilken == "close" || hvilken == "minimize" else {
        Out.fail("--button skal vaere close eller minimize", code: "bad-args")
    }
    Perms.require(accessibility: true)
    let wb = AX.windowButton(bundleId: bid, title: args.str("title"), index: args.int("index"), which: hvilken)
    if !wb.ok { Out.fail(wb.why, code: "window-failed") }
    Out.ok(["app": bid, "did": wb.why])

case "menus":
    guard let bid = args.str("app") else { Out.fail("--app is missing", code: "bad-args") }
    Perms.require(accessibility: true)
    let punkter = AX.menuPaths(bundleId: bid, maxDepth: args.int("depth") ?? 5)
    if punkter.isEmpty {
        Out.fail("no menu bar read for '\(bid)' - is the app running, and is that the right bundle id?",
                 code: "no-menubar")
    }
    Out.ok(["items": punkter, "count": punkter.count, "app": bid])

case "menu-click":
    guard let bid = args.str("app") else { Out.fail("--app is missing", code: "bad-args") }
    guard let sti = args.str("path") else { Out.fail("--path is missing, e.g. \"File > Export\"", code: "bad-args") }
    Perms.require(accessibility: true)
    let r = AX.menuClick(bundleId: bid, path: sti)
    if r.ok { Out.ok(["clicked": sti, "app": bid]) }
    Out.fail(r.why, code: "menu-failed")

case "displays":
    Capture.listDisplays()

case "redact":
    guard let inp = args.str("in"), let outp = args.str("out") else {
        Out.fail("--in and --out are missing", code: "bad-args")
    }
    guard let raw = args.str("rects") else { Out.fail("--rects is missing (x,y,w,h;x,y,w,h)", code: "bad-args") }
    let parsed: [Rect] = raw.split(separator: ";").compactMap { part in
        let n = part.split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
        guard n.count == 4 else { return nil }
        return Rect(x: n[0], y: n[1], w: n[2], h: n[3])
    }
    guard !parsed.isEmpty else { Out.fail("could not parse --rects", code: "bad-args") }
    Capture.redactFile(inPath: inp, outPath: outp, rects: parsed,
                       scale: args.dbl("scale") ?? 1.0,
                       origin: CGPoint(x: args.dbl("origin-x") ?? 0, y: args.dbl("origin-y") ?? 0))

case "inspect":
    Perms.require(accessibility: true)
    let nodes = AX.inspect(
        bundleId: args.str("app"),
        maxDepth: args.int("depth") ?? 12,
        maxNodes: args.int("limit") ?? 400,
        ekstraDeny: denySet(args)
    )
    Out.ok(["nodes": nodes, "count": nodes.count])

case "find":
    let _soeg = laesSoegning(args)
    Perms.require(accessibility: true)
    let hits = AX.find(
        bundleId: args.str("app"),
        role: args.str("role"),
        title: _soeg.title,
        contains: _soeg.contains,
        maxDepth: args.int("depth") ?? 24,
        limit: args.int("limit") ?? 25,
        ekstraDeny: denySet(args)
    )
    Out.ok(["matches": hits.map(\.dict), "count": hits.count])

case "set-value":
    let _soeg = laesSoegning(args)
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
    if let fraBlok = _soeg.text {
        sv = fraBlok
    } else if args.flag("stdin") {
        let data = FileHandle.standardInput.readDataToEndOfFile()
        guard let t = String(data: data, encoding: .utf8) else {
            Out.fail("could not read the text from stdin", code: "bad-args")
        }
        sv = t
    } else if let t = args.str("text") {
        sv = t
    } else {
        Out.fail("--text or --stdin is missing", code: "bad-args")
    }

    // Enten et navngivet element, eller det der har fokus.
    var target: (el: AXUIElement, dict: [String: Any])?
    if args.str("app") != nil || args.str("role") != nil || _soeg.title != nil || _soeg.contains != nil {
        let hits = AX.find(bundleId: args.str("app"), role: args.str("role"),
                           title: _soeg.title, contains: _soeg.contains,
                           maxDepth: args.int("depth") ?? 24, limit: 25)
        guard let first = hits.first else {
            Out.fail("nothing matched", code: "not-found", extra: ["count": 0])
        }
        if hits.count > 1 && !args.flag("first") {
            Out.fail("found \(hits.count) matches - narrow the search, or pass --first",
                     code: "ambiguous", extra: ["matches": hits.map(\.dict), "count": hits.count])
        }
        target = (first.el, first.dict)
    } else {
        guard let f = AX.focused() else {
            Out.fail("no element has keyboard focus, and none was named",
                     code: "no-target")
        }
        target = f
    }
    guard let t = target else { Out.fail("intet maal", code: "no-target") }

    let role = (t.dict["role"] as? String) ?? ""
    if AX.isSecure(t.el, role: role) {
        Out.fail("this is a secure field - we do not write into password fields. Ask the person to type it themselves with computer_ask_user.",
                 code: "secure-field", extra: ["element": t.dict])
    }
    guard AX.setValue(t.el, sv) else {
        Out.fail("the element did not accept a value", code: "set-failed", extra: ["element": t.dict])
    }
    Out.ok(["set": true, "length": sv.count, "element": t.dict])

case "focused":
    // Laesende: hvad har tastaturfokus, og er det et sikkert felt?
    Perms.require(accessibility: true)
    if let f = AX.focused() {
        Out.ok(["focused": true, "element": f.dict])
    } else {
        Out.ok(["focused": false,
                "hint": "no element has keyboard focus - click or press into the field first"])
    }

case "wait-for":
    let _soeg = laesSoegning(args)
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
            title: _soeg.title,
            contains: _soeg.contains,
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
    Out.fail("no element appeared within the time limit",
             code: "wait-timeout",
             extra: ["found": false, "attempts": attempts,
                     "soegte": ["app": args.str("app") ?? "alle",
                                "role": args.str("role") ?? "-",
                                "title": _soeg.title ?? "-",
                                "contains": _soeg.contains ?? "-"]])

case "press":
    let _soeg = laesSoegning(args)
    Perms.require(accessibility: true)
    let hits = AX.find(
        bundleId: args.str("app"),
        role: args.str("role"),
        title: _soeg.title,
        contains: _soeg.contains,
        maxDepth: args.int("depth") ?? 24,
        limit: 25
    )
    guard let first = hits.first else {
        Out.fail("nothing matched", code: "not-found", extra: ["count": 0])
    }
    // Flere traef = tvetydigt. Vi gaetter ikke; agenten faar kandidaterne og
    // vaelger selv. At trykke paa det foerste tilfaeldige traef er praecis
    // den slags naesten-rigtige handling der er svaer at opdage bagefter.
    if hits.count > 1 && !args.flag("first") {
        Out.fail("found \(hits.count) matches - narrow the search, or pass --first",
                 code: "ambiguous", extra: ["matches": hits.map(\.dict), "count": hits.count])
    }
    guard AX.press(first) else {
        Out.fail("the element could not be pressed", code: "press-failed", extra: ["match": first.dict])
    }
    Out.ok(["pressed": first.dict])

case "click":
    Perms.require(accessibility: true)
    guard let x = args.dbl("x"), let y = args.dbl("y") else { Out.fail("--x and --y are missing", code: "bad-args") }
    let klikPid = modtager(args)
    let klikMaal = Skaerm.maalt(tilPid: klikPid, flyttedeMarkoer: klikPid == nil) {
        Input.click(x: x, y: y, button: args.str("button") ?? "left",
                    count: args.int("count") ?? 1, tilPid: klikPid)
    }
    Out.ok(["clicked": ["x": x, "y": y]].merging(klikMaal) { a, _ in a })

case "move":
    Perms.require(accessibility: true)
    guard let x = args.dbl("x"), let y = args.dbl("y") else { Out.fail("--x and --y are missing", code: "bad-args") }
    Input.move(x: x, y: y)
    Out.ok(["moved": ["x": x, "y": y]])

case "drag":
    Perms.require(accessibility: true)
    guard let fx = args.dbl("from-x"), let fy = args.dbl("from-y"),
          let tx = args.dbl("to-x"), let ty = args.dbl("to-y") else {
        Out.fail("--from-x --from-y --to-x --to-y are missing", code: "bad-args")
    }
    Input.drag(fromX: fx, fromY: fy, toX: tx, toY: ty,
               steps: args.int("steps") ?? 24, holdMs: args.int("hold-ms") ?? 120)
    Out.ok(["from": ["x": fx, "y": fy], "to": ["x": tx, "y": ty],
            "note": "The drag was sent. Whether anything accepted it can only be told from a screenshot or a fresh look at the tree - we are not claiming it worked."])

case "scroll":
    Perms.require(accessibility: true)
    let rulPid = modtager(args)
    let rulMaal = Skaerm.maalt(tilPid: rulPid) {
        Input.scroll(dx: args.int("dx") ?? 0, dy: args.int("dy") ?? 0, tilPid: rulPid)
    }
    Out.ok(rulMaal)

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
            Out.fail("could not read the text from stdin", code: "bad-args")
        }
        typeText = t
    } else if let t = args.str("text") {
        typeText = t
    } else {
        Out.fail("--text or --stdin is missing", code: "bad-args")
    }
    let skrivPid = modtager(args)
    let skrivMaal = Skaerm.maalt(tilPid: skrivPid) { Input.type(typeText, cps: args.int("cps") ?? 240, tilPid: skrivPid) }
    // Laengden, aldrig indholdet.
    Out.ok(["typed": typeText.count].merging(skrivMaal) { a, _ in a })

case "key":
    Perms.require(accessibility: true)
    guard let combo = args.str("combo") else { Out.fail("--combo is missing", code: "bad-args") }
    let tastPid = modtager(args)
    var tastOk = false
    let tastMaal = Skaerm.maalt(tilPid: tastPid) { tastOk = Input.hotkey(combo, tilPid: tastPid) }
    guard tastOk else { Out.fail("unknown key combination '\(combo)'", code: "bad-key") }
    Out.ok(["key": combo].merging(tastMaal) { a, _ in a })

default:
    Out.fail(
        "unknown command '\(args.command)'",
        code: "bad-command",
        extra: ["commands": ["version", "permissions", "apps", "windows", "activate", "secure-rects", "wait-for", "focused", "set-value",
                            "screenshot", "redact", "inspect", "find", "press", "click", "move", "scroll", "type", "key"]]
    )
}
