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
