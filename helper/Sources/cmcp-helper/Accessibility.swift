import AppKit
import ApplicationServices
import Foundation

struct Rect: Codable {
    var x: Double, y: Double, w: Double, h: Double
    var dict: [String: Any] { ["x": x, "y": y, "w": w, "h": h] }
    var cg: CGRect { CGRect(x: x, y: y, width: w, height: h) }
}

enum AX {
    // MARK: - Lavniveau

    static func attr(_ el: AXUIElement, _ name: String) -> CFTypeRef? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(el, name as CFString, &value) == .success else { return nil }
        return value
    }

    static func string(_ el: AXUIElement, _ name: String) -> String? {
        attr(el, name) as? String
    }

    static func children(_ el: AXUIElement) -> [AXUIElement] {
        (attr(el, kAXChildrenAttribute as String) as? [AXUIElement]) ?? []
    }

    static func frame(_ el: AXUIElement) -> Rect? {
        guard let posRef = attr(el, kAXPositionAttribute as String),
              let sizeRef = attr(el, kAXSizeAttribute as String) else { return nil }
        var pos = CGPoint.zero, size = CGSize.zero
        // swiftlint:disable:next force_cast
        guard AXValueGetValue(posRef as! AXValue, .cgPoint, &pos),
              AXValueGetValue(sizeRef as! AXValue, .cgSize, &size) else { return nil }
        guard size.width > 0, size.height > 0 else { return nil }
        return Rect(x: pos.x, y: pos.y, w: size.width, h: size.height)
    }

    // MARK: - Apps og vinduer

    /// Til visning: kun programmer med et ikon i Dock.
    static func runningApps() -> [NSRunningApplication] {
        NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }
    }

    /// Til sikkerhedsscanning: ALT der koerer.
    ///
    /// MAALT 18/9-2026: her stod `runningApps()`, som kun giver .regular-programmer.
    /// En adgangskode-dialog rejst af en baggrundsproces - `osascript ... with hidden
    /// answer`, en menulinje-hjaelper, en systemprompt - er .accessory og blev derfor
    /// ALDRIG scannet. Sloeringen missede praecis den slags vindue der oftest beder om
    /// en adgangskode. Proeven `secure-rects finder en dialog fra en baggrundsproces`
    /// findes for at holde denne linje paa plads.
    static func allApps() -> [NSRunningApplication] {
        NSWorkspace.shared.runningApplications.filter { $0.activationPolicy != .prohibited || $0.bundleIdentifier != nil }
    }

    static func app(bundleId: String) -> NSRunningApplication? {
        runningApps().first { $0.bundleIdentifier == bundleId }
            ?? runningApps().first { $0.localizedName?.lowercased() == bundleId.lowercased() }
    }

    static func windows(of app: NSRunningApplication) -> [AXUIElement] {
        let axApp = AXUIElementCreateApplication(app.processIdentifier)
        return (attr(axApp, kAXWindowsAttribute as String) as? [AXUIElement]) ?? []
    }

    // MARK: - Hemmelighedsfinder
    //
    // Det her er produktets kerne. Vi gaar traeet igennem og finder alt der
    // per definition indeholder noget mennesket ikke ville vise en fremmed:
    //
    //   1. AXSecureTextField - adgangskodefelter. macOS markerer dem selv.
    //   2. Vinduer i spaerrede programmer - 1Password, Noeglering osv.
    //
    // Vi kigger IKKE paa indholdet. Vi behoever ikke at vide hvad der staar;
    // vi behoever kun at vide hvor det staar, saa det kan sloeres foer billedet
    // findes. Et sloeringsfilter der selv skal laese teksten for at beslutte,
    // har allerede tabt.

    /// Roller der altid sloeres.
    ///
    /// Et native felt har ROLLEN AXSecureTextField. Et adgangskodefelt paa en
    /// webside har rollen AXTextField og UNDERROLLEN AXSecureTextField. Tjekkes
    /// kun rollen, sloeres native felter og webfelter slippes igennem - og
    /// webfelter er dem folk bruger. Begge skal tjekkes, hver gang.
    static let secureRoles: Set<String> = ["AXSecureTextField"]

    static func isSecure(_ el: AXUIElement, role: String) -> Bool {
        if secureRoles.contains(role) { return true }
        if let sub = string(el, kAXSubroleAttribute as String), secureRoles.contains(sub) { return true }
        return false
    }

    /// Hvilket element har tastaturfokus lige nu - paa tvaers af programmer.
    ///
    /// ⛔ Findes fordi panelet 19/9 fandt hullet: `computer_ask_user` kan sige
    /// HVILKET PROGRAM teksten lander i, men ikke om markoeren staar i et
    /// sikkert felt. Og `computer_set_value` kan slet ikke bygges forsvarligt
    /// uden - uden dette opslag ville den kunne skrive i en adgangskodeboks
    /// uden at nogen saa det.
    ///
    /// Systemets eget system-wide element svarer paa spoergsmaalet uden at vi
    /// skal gaette hvilket program der er forrest.
    static func focused() -> (el: AXUIElement, dict: [String: Any])? {
        // ⛔ MAALT 19/9: det system-wide element ALENE svarede ikke - hverken i
        // et almindeligt felt eller i et kodeordsfelt. Den vej der virker gaar
        // gennem det fokuserede PROGRAM foerst, og falder tilbage paa det
        // forreste program hvis ogsaa dét svigter. Tre forsoeg, ikke ét.
        func copyFocused(_ from: AXUIElement) -> AXUIElement? {
            var r: CFTypeRef?
            guard AXUIElementCopyAttributeValue(from, kAXFocusedUIElementAttribute as CFString, &r) == .success,
                  let raw = r else { return nil }
            // swiftlint:disable:next force_cast
            return (raw as! AXUIElement)
        }
        let sys = AXUIElementCreateSystemWide()
        var el: AXUIElement? = copyFocused(sys)
        if el == nil {
            var appRef: CFTypeRef?
            if AXUIElementCopyAttributeValue(sys, kAXFocusedApplicationAttribute as CFString, &appRef) == .success,
               let raw = appRef {
                // swiftlint:disable:next force_cast
                el = copyFocused(raw as! AXUIElement)
            }
        }
        if el == nil, let front = NSWorkspace.shared.frontmostApplication {
            el = copyFocused(AXUIElementCreateApplication(front.processIdentifier))
        }
        guard let el else { return nil }
        let role = string(el, kAXRoleAttribute as String) ?? ""
        var d: [String: Any] = ["role": role, "secure": isSecure(el, role: role)]
        if let sub = string(el, kAXSubroleAttribute as String), !sub.isEmpty { d["subrole"] = sub }
        if let t = string(el, kAXTitleAttribute as String), !t.isEmpty { d["title"] = t }
        if let ph = string(el, kAXPlaceholderValueAttribute as String), !ph.isEmpty { d["placeholder"] = ph }
        if let f = frame(el) { d["frame"] = f.dict }
        var pid: pid_t = 0
        if AXUIElementGetPid(el, &pid) == .success,
           let app = NSWorkspace.shared.runningApplications.first(where: { $0.processIdentifier == pid }) {
            d["app"] = app.localizedName ?? ""
            d["bundleId"] = app.bundleIdentifier ?? ""
        }
        return (el, d)
    }

    /// Programmer hvis vinduer altid sloeres, uanset indhold.
    /// Kan udvides af brugeren via --deny.
    static let defaultDenyBundles: Set<String> = [
        "com.apple.keychainaccess",
        "com.agilebits.onepassword7",
        "com.1password.1password",
        "com.bitwarden.desktop",
        "com.lastpass.LastPass",
        "com.dashlane.Dashlane",
        "com.apple.Passwords"
    ]

    /// Find alle rektangler der skal sloeres. Dybden er bevidst begraenset:
    /// et AX-trae kan vaere uendeligt i en web-visning, og en hjaelper der
    /// haenger, er en hjaelper der fejler aabent.
    static func secureRects(scopeBundleId: String?, extraDeny: Set<String>, maxDepth: Int = 40) -> [Rect] {
        var out: [Rect] = []
        let deny = defaultDenyBundles.union(extraDeny)
        let visible = onScreenPIDs()
        let apps = allApps().filter { a in
            // Tom maengde = vi kunne ikke spoerge vinduesserveren; saa tager vi alle.
            if !visible.isEmpty && !visible.contains(a.processIdentifier) { return false }
            guard let scope = scopeBundleId else { return true }
            return a.bundleIdentifier == scope || a.localizedName?.lowercased() == scope.lowercased()
        }

        for app in apps {
            let bid = (app.bundleIdentifier ?? "").lowercased()
            let isDenied = deny.contains(where: { $0.lowercased() == bid })
            let axApp = AXUIElementCreateApplication(app.processIdentifier)
            let wins = (attr(axApp, kAXWindowsAttribute as String) as? [AXUIElement]) ?? []

            for win in wins {
                if isDenied {
                    // Hele vinduet ud. Vi gaar ikke ind i det - at gaa ind i en
                    // adgangskode-boks for at finde ud af hvad der skal sloeres,
                    // er selve den fejl vi undgaar.
                    if let f = frame(win) { out.append(f) }
                    continue
                }
                walk(win, depth: 0, maxDepth: maxDepth) { el, role in
                    if isSecure(el, role: role), let f = frame(el) { out.append(f) }
                }
            }
        }
        return out
    }

    private static func walk(_ el: AXUIElement, depth: Int, maxDepth: Int, _ visit: (AXUIElement, String) -> Void) {
        guard depth < maxDepth else { return }
        let role = string(el, kAXRoleAttribute as String) ?? ""
        visit(el, role)
        for child in children(el) {
            walk(child, depth: depth + 1, maxDepth: maxDepth, visit)
        }
    }

    // MARK: - Inspektion

    /// Læsbart traeudtraek, som en agent kan navigere efter uden at gaette paa pixels.
    static func inspect(bundleId: String?, maxDepth: Int, maxNodes: Int) -> [[String: Any]] {
        var nodes: [[String: Any]] = []
        let apps = allApps().filter { a in
            guard let scope = bundleId else { return true }
            return a.bundleIdentifier == scope || a.localizedName?.lowercased() == scope.lowercased()
        }
        outer: for app in apps {
            let axApp = AXUIElementCreateApplication(app.processIdentifier)
            let wins = (attr(axApp, kAXWindowsAttribute as String) as? [AXUIElement]) ?? []
            for win in wins {
                var stack: [(AXUIElement, Int)] = [(win, 0)]
                while let (el, d) = stack.popLast() {
                    if nodes.count >= maxNodes { break outer }
                    guard d < maxDepth else { continue }
                    let role = string(el, kAXRoleAttribute as String) ?? ""
                    let isSecure = isSecure(el, role: role)
                    var n: [String: Any] = [
                        "app": app.localizedName ?? "",
                        "bundleId": app.bundleIdentifier ?? "",
                        "role": role,
                        "depth": d
                    ]
                    if let t = string(el, kAXTitleAttribute as String), !t.isEmpty { n["title"] = t }
                    if let d2 = string(el, kAXDescriptionAttribute as String), !d2.isEmpty { n["desc"] = d2 }
                    // Vaerdien af et adgangskodefelt forlader ALDRIG hjaelperen.
                    if !isSecure, let v = string(el, kAXValueAttribute as String), !v.isEmpty {
                        n["value"] = String(v.prefix(200))
                    }
                    if isSecure { n["secure"] = true }
                    if let f = frame(el) { n["frame"] = f.dict }
                    nodes.append(n)
                    for c in children(el) { stack.append((c, d + 1)) }
                }
            }
        }
        return nodes
    }
}

// MARK: - Semantisk soegning
//
// Det her er den storste enkeltforbedring i traefsikkerhed.
//
// Et skaermbillede fortaeller en model hvor noget SER UD til at vaere. Modellen
// regner en pixelkoordinat ud, og rammer ved siden af naar vinduet er flyttet,
// skaermen har en anden skala, eller knappen er rykket to pixels. Tilgaengeligheds-
// traeet ved derimod praecis hvor "Log ind" er, og hvad den hedder. At soege paa
// navn og trykke paa elementet er baade mere praecist og laeseligt bagefter:
// "tryk paa Log ind" kan revideres, "klik paa 812, 460" kan ikke.

extension AX {
    struct Match {
        let el: AXUIElement
        let dict: [String: Any]
    }

    static func find(
        bundleId: String?, role: String?, title: String?, contains: String?,
        maxDepth: Int, limit: Int
    ) -> [Match] {
        var out: [Match] = []
        let wantRole = role?.lowercased()
        let wantTitle = title?.lowercased()
        let wantContains = contains?.lowercased()

        let apps = allApps().filter { a in
            guard let scope = bundleId else { return true }
            return a.bundleIdentifier == scope || a.localizedName?.lowercased() == scope.lowercased()
        }

        outer: for app in apps {
            let axApp = AXUIElementCreateApplication(app.processIdentifier)
            let wins = (attr(axApp, kAXWindowsAttribute as String) as? [AXUIElement]) ?? []
            for win in wins {
                var stack: [(AXUIElement, Int)] = [(win, 0)]
                while let (el, d) = stack.popLast() {
                    if out.count >= limit { break outer }
                    guard d < maxDepth else { continue }
                    for c in children(el) { stack.append((c, d + 1)) }

                    let r = string(el, kAXRoleAttribute as String) ?? ""
                    if let wr = wantRole, r.lowercased() != wr, "ax" + wr != r.lowercased() { continue }

                    // Et element kan baere sit navn fire forskellige steder alt
                    // efter hvem der har bygget det. Kigger man kun paa title,
                    // er halvdelen af alle knapper usynlige.
                    let names = [
                        string(el, kAXTitleAttribute as String),
                        string(el, kAXDescriptionAttribute as String),
                        string(el, "AXLabel"),
                        isSecure(el, role: r) ? nil : string(el, kAXValueAttribute as String)
                    ].compactMap { $0 }.filter { !$0.isEmpty }

                    if let wt = wantTitle, !names.contains(where: { $0.lowercased() == wt }) { continue }
                    if let wc = wantContains, !names.contains(where: { $0.lowercased().contains(wc) }) { continue }
                    if wantRole == nil && wantTitle == nil && wantContains == nil { continue }

                    var dict: [String: Any] = [
                        "app": app.localizedName ?? "",
                        "bundleId": app.bundleIdentifier ?? "",
                        "role": r
                    ]
                    if let sub = string(el, kAXSubroleAttribute as String), !sub.isEmpty { dict["subrole"] = sub }
                    if let n = names.first { dict["name"] = n }
                    if names.count > 1 { dict["names"] = names }
                    if isSecure(el, role: r) { dict["secure"] = true }
                    if let f = frame(el) {
                        dict["frame"] = f.dict
                        // Midtpunktet, saa en agent kan klikke hvis press ikke virker.
                        dict["center"] = ["x": f.x + f.w / 2, "y": f.y + f.h / 2]
                    }
                    dict["pressable"] = canPress(el)
                    out.append(Match(el: el, dict: dict))
                }
            }
        }
        return out
    }

    /// Skriver en vaerdi direkte i et element - uden fokus, uden musen.
    ///
    /// ⛔ Kalderen SKAL have afvist sikre felter foerst. Denne funktion tjekker
    /// det ikke selv, fordi den ikke kender rollen; det goer main.swift, som
    /// ogsaa er der hvor afvisningen kan formuleres for et menneske.
    static func setValue(_ el: AXUIElement, _ text: String) -> Bool {
        AXUIElementSetAttributeValue(el, kAXValueAttribute as CFString, text as CFTypeRef) == .success
    }

    static func canPress(_ el: AXUIElement) -> Bool {
        var names: CFArray?
        guard AXUIElementCopyActionNames(el, &names) == .success,
              let list = names as? [String] else { return false }
        return list.contains(kAXPressAction as String)
    }

    /// Trykker elementet via dets egen handling i stedet for at simulere et klik
    /// paa en koordinat. Virker ogsaa naar vinduet ligger bag et andet, og
    /// efterlader ingen musebevaegelse hos brugeren.
    static func press(_ m: Match) -> Bool {
        AXUIElementPerformAction(m.el, kAXPressAction as CFString) == .success
    }
}

// MARK: - Kun det der faktisk er paa skaermen
//
// MAALT 18/9: et skaermbillede tog 2,5 sekunder, og 2,0 af dem var sloeringen.
// Den gik HVER koerende apps fulde traeer igennem - ogsaa de ni ud af ti der
// ikke havde et eneste vindue fremme.
//
// Det var ikke bare langsomt, det var ogsaa forkert. Et adgangskodefelt i et
// vindue paa en ANDEN Space kan ikke vaere paa billedet, men dets koordinater
// kan udmaerket ramme noget harmloest paa den Space der ER fremme - og saa
// malede vi en sort kasse hen over noget tilfaeldigt.
//
// Vinduesserveren ved praecis hvem der er fremme. Vi spoerger den foerst.
extension AX {
    /// Processer med mindst ét vindue paa skaermen lige nu.
    static func onScreenPIDs() -> Set<pid_t> {
        let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
        guard let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else {
            // Kan vi ikke spoerge, antager vi at alle er fremme. Hellere
            // langsom og fuldstaendig end hurtig og med huller i sloeringen.
            return []
        }
        var pids = Set<pid_t>()
        for w in list {
            if let p = w[kCGWindowOwnerPID as String] as? pid_t { pids.insert(p) }
        }
        return pids
    }

    /// Skaermens samlede omraade i punkter. Bruges til at kassere rektangler
    /// der ligger uden for billedet.
    static func screenBounds() -> CGRect {
        NSScreen.screens.reduce(CGRect.null) { $0.union($1.frame) }
    }
}

// MARK: - Menulinjen
//
// ⛔ MAALT 19/9: dette var det stoerste hul mellem "hvad et menneske kan" og
//    "hvad agenten kan". En stor del af macOS har INGEN knap paa skaermen -
//    Arkiv > Eksportér, Rediger > Søg, Format > Skrifttype. Uden menuer kan en
//    agent se dem og ikke naa dem.
//
//    Og det er tilgaengeligheds-API, ikke pixels: ligesom `press` virker det paa
//    et program hvis vindue ligger BAG et andet, og det flytter ikke markoeren.
extension AX {

    /// Menulinjen for et program, fladet ud til stier: "Arkiv > Eksportér som…"
    ///
    /// Apples egen menu (den med aeblet) springes over: den hoerer til systemet,
    /// ikke til programmet, og den er ens overalt.
    static func menuPaths(bundleId: String, maxDepth: Int = 5) -> [[String: Any]] {
        guard let app = AX.app(bundleId: bundleId) else { return [] }
        let axApp = AXUIElementCreateApplication(app.processIdentifier)
        guard let bar = attr(axApp, "AXMenuBar") else { return [] }
        // swiftlint:disable:next force_cast
        let barEl = bar as! AXUIElement

        var ud: [[String: Any]] = []
        for (i, menu) in children(barEl).enumerated() {
            if i == 0 { continue }  // Apple-menuen
            let navn = string(menu, kAXTitleAttribute as String) ?? ""
            if navn.isEmpty { continue }
            saml(menu, sti: [navn], dybde: 0, maxDepth: maxDepth, ud: &ud)
        }
        return ud
    }

    private static func saml(_ el: AXUIElement, sti: [String], dybde: Int,
                             maxDepth: Int, ud: inout [[String: Any]]) {
        if dybde > maxDepth || ud.count > 800 { return }
        for barn in children(el) {
            let rolle = string(barn, kAXRoleAttribute as String) ?? ""
            if rolle == "AXMenu" {
                saml(barn, sti: sti, dybde: dybde + 1, maxDepth: maxDepth, ud: &ud)
                continue
            }
            let titel = string(barn, kAXTitleAttribute as String) ?? ""
            // En skillelinje har ingen titel. Den er ikke et punkt man kan vaelge.
            if titel.isEmpty { continue }
            let nySti = sti + [titel]
            let underMenuer = children(barn).filter {
                (string($0, kAXRoleAttribute as String) ?? "") == "AXMenu"
            }
            if underMenuer.isEmpty {
                var punkt: [String: Any] = [
                    "path": nySti.joined(separator: " > "),
                    "title": titel,
                    "enabled": (attr(barn, kAXEnabledAttribute as String) as? Bool) ?? true
                ]
                // Genvejen er det et menneske faktisk bruger. Den hoerer med, saa
                // agenten kan vaelge computer_key i stedet naar det er hurtigere.
                if let cmd = string(barn, kAXMenuItemCmdCharAttribute as String), !cmd.isEmpty {
                    punkt["shortcut"] = cmd
                }
                ud.append(punkt)
            } else {
                for m in underMenuer {
                    saml(m, sti: nySti, dybde: dybde + 1, maxDepth: maxDepth, ud: &ud)
                }
            }
        }
    }

    /// Vaelg et menupunkt ved dets sti. Returnerer hvad der skete, saa kalderen
    /// kan sige det praecist videre.
    ///
    /// ⛔ Vi vaelger paa HELE stien, aldrig paa titlen alene. "Slet" findes i
    ///    flere menuer, og at ramme den forkerte er ikke en detalje.
    static func menuClick(bundleId: String, path: String) -> (ok: Bool, why: String) {
        guard let app = AX.app(bundleId: bundleId) else {
            return (false, "programmet '\(bundleId)' koerer ikke")
        }
        let axApp = AXUIElementCreateApplication(app.processIdentifier)
        guard let bar = attr(axApp, "AXMenuBar") else {
            return (false, "programmet har ingen menulinje vi kan laese")
        }
        // swiftlint:disable:next force_cast
        var nuvaerende = bar as! AXUIElement
        let led = path.components(separatedBy: ">").map {
            $0.trimmingCharacters(in: .whitespaces)
        }.filter { !$0.isEmpty }
        guard !led.isEmpty else { return (false, "tom sti") }

        for (i, oensket) in led.enumerated() {
            var fundet: AXUIElement?
            var kandidater = children(nuvaerende)
            // Under et menupunkt ligger selve menuen som et ekstra lag.
            if i > 0 {
                for k in kandidater where (string(k, kAXRoleAttribute as String) ?? "") == "AXMenu" {
                    kandidater = children(k); break
                }
            }
            for k in kandidater {
                if (string(k, kAXTitleAttribute as String) ?? "") == oensket { fundet = k; break }
            }
            guard let naeste = fundet else {
                return (false, "fandt ikke '\(oensket)' i '\(path)' - koer 'menus' for at se hvad der findes")
            }
            if i == led.count - 1 {
                if let enabled = attr(naeste, kAXEnabledAttribute as String) as? Bool, !enabled {
                    return (false, "'\(path)' er graa lige nu - programmet tillader den ikke i denne tilstand")
                }
                let r = AXUIElementPerformAction(naeste, kAXPressAction as CFString)
                return (r == .success, r == .success ? "valgt" : "AXPress fejlede (\(r.rawValue))")
            }
            nuvaerende = naeste
        }
        return (false, "stien slap op")
    }
}

// MARK: - Vinduer
//
// ⛔ MAALT 19/9: dette manglede, og det kostede en hel dags maaling. Proeven
//    for sloeringen skulle lægge sin egen side paa en skaerm hvor intet dækkede
//    den. Uden et vaerktoej til det maatte jeg bede Chromes AppleScript, som
//    klemte vinduet tilbage paa hovedskaermen - og proeven kunne aldrig
//    gennemfoeres. Et menneske flytter et vindue uden at taenke over det.
extension AX {

    private static func findWindow(bundleId: String, title: String?, index: Int?) -> AXUIElement? {
        guard let app = AX.app(bundleId: bundleId) else { return nil }
        let vinduer = windows(of: app)
        if let t = title, !t.isEmpty {
            for w in vinduer where (string(w, kAXTitleAttribute as String) ?? "").contains(t) { return w }
            return nil
        }
        let i = index ?? 0
        return i >= 0 && i < vinduer.count ? vinduer[i] : nil
    }

    /// Flyt og/eller aendr et vindue. Koordinater er GLOBALE punkter, samme rum
    /// som computer_click - saa en negativ x er en skaerm til venstre.
    static func windowSet(bundleId: String, title: String?, index: Int?,
                          x: Int?, y: Int?, w: Int?, h: Int?) -> (ok: Bool, why: String, frame: Rect?) {
        guard let win = findWindow(bundleId: bundleId, title: title, index: index) else {
            return (false, "fandt ikke vinduet - koer 'windows --app \(bundleId)' for at se hvilke der findes", nil)
        }
        if x != nil || y != nil {
            let nu = frame(win)
            var p = CGPoint(x: CGFloat(x ?? Int(nu?.x ?? 0)), y: CGFloat(y ?? Int(nu?.y ?? 0)))
            if let v = AXValueCreate(.cgPoint, &p) {
                let r = AXUIElementSetAttributeValue(win, kAXPositionAttribute as CFString, v)
                if r != .success { return (false, "kunne ikke flytte vinduet (\(r.rawValue)) - nogle programmer tillader det ikke", frame(win)) }
            }
        }
        if w != nil || h != nil {
            let nu = frame(win)
            var s = CGSize(width: CGFloat(w ?? Int(nu?.w ?? 0)), height: CGFloat(h ?? Int(nu?.h ?? 0)))
            if let v = AXValueCreate(.cgSize, &s) {
                let r = AXUIElementSetAttributeValue(win, kAXSizeAttribute as CFString, v)
                if r != .success { return (false, "kunne ikke aendre stoerrelsen (\(r.rawValue))", frame(win)) }
            }
        }
        return (true, "sat", frame(win))
    }

    /// Luk eller minimér. ⛔ At lukke kan tabe ugemt arbejde - derfor gaar den
    /// gennem porten hver gang, som et destruktivt menupunkt.
    static func windowButton(bundleId: String, title: String?, index: Int?,
                             which: String) -> (ok: Bool, why: String) {
        guard let win = findWindow(bundleId: bundleId, title: title, index: index) else {
            return (false, "fandt ikke vinduet")
        }
        let attr = which == "close" ? kAXCloseButtonAttribute : kAXMinimizeButtonAttribute
        guard let knap = AX.attr(win, attr as String) else {
            return (false, "vinduet har ingen \(which)-knap")
        }
        // swiftlint:disable:next force_cast
        let r = AXUIElementPerformAction(knap as! AXUIElement, kAXPressAction as CFString)
        return (r == .success, r == .success ? which : "AXPress fejlede (\(r.rawValue))")
    }
}

// MARK: - Udklipsholderen
//
// ⛔ KUN INDSAET. Der er med vilje ingen "laes udklipsholderen" i dette produkt.
//    Et menneske kopierer sin adgangskode ud af 1Password; et enkelt
//    laese-kald ville levere den i klartekst til modellen, forbi HELE
//    sloeringen. Det er det farligste enkeltkald der kan bygges her, og det
//    fortjener sin egen runde foer det overhovedet skrives.
//
// ⛔ MEN DEN HER LAESER ALLIGEVEL - og det skal siges praecist, ikke skjules:
//    for at lægge menneskets eget indhold TILBAGE bagefter, skal det foerst
//    laeses. Den vaerdi forlader aldrig processen: den returneres ikke, den
//    logges ikke, og den findes kun i hukommelsen i de faa millisekunder
//    indsaettelsen tager. Alternativet var at efterlade vores tekst i
//    udklipsholderen, hvor mennesket saa selv finder den senere.
extension AX {

    /// Laeg tekst i udklipsholderen, tryk Cmd+V, og laeg det gamle tilbage.
    static func pasteText(_ text: String, restore: Bool) -> (ok: Bool, why: String, restored: Bool) {
        let pb = NSPasteboard.general

        // Gemmes KUN for at kunne laegges tilbage. Se noten ovenfor.
        var gammel: [NSPasteboardItem] = []
        if restore {
            for item in pb.pasteboardItems ?? [] {
                let kopi = NSPasteboardItem()
                for t in item.types {
                    if let d = item.data(forType: t) { kopi.setData(d, forType: t) }
                }
                gammel.append(kopi)
            }
        }

        pb.clearContents()
        guard pb.setString(text, forType: .string) else {
            return (false, "kunne ikke skrive til udklipsholderen", false)
        }

        // Cmd+V gennem den samme vej som computer_key.
        let src = CGEventSource(stateID: .combinedSessionState)
        let vKode: CGKeyCode = 9  // 'v' paa ethvert layout: det er en FYSISK tast
        guard let ned = CGEvent(keyboardEventSource: src, virtualKey: vKode, keyDown: true),
              let op  = CGEvent(keyboardEventSource: src, virtualKey: vKode, keyDown: false) else {
            return (false, "kunne ikke danne tastetrykket", false)
        }
        ned.flags = .maskCommand; op.flags = .maskCommand
        ned.post(tap: .cghidEventTap)
        op.post(tap: .cghidEventTap)

        guard restore else { return (true, "indsat", false) }

        // Programmet skal naa at laese udklipsholderen foer vi skifter den.
        // ⛔ MAALT: uden pausen fik modtageren af og til det GAMLE indhold
        //    tilbage, fordi vi havde naaet at gendanne foer Cmd+V blev laest.
        Thread.sleep(forTimeInterval: 0.35)
        pb.clearContents()
        if !gammel.isEmpty { pb.writeObjects(gammel) }
        return (true, "indsat, og dit eget indhold er lagt tilbage", true)
    }
}
