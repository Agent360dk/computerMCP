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
        let apps = allApps().filter { a in
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
