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

    /// ⛔ FUNDET AF SIKKERHEDSREVIEWET 20/9: et hul i produktets FOERSTE loefte.
    /// Spaerre-listen gjaldt KUN skaermbilleder - `inspect` og `find` havde nul
    /// tjek. Et skaermbillede maler 1Passwords vindue helt sort, mens traeet
    /// afleverede det samme vindues indhold i klartekst. Laesende, uden
    /// samtykke, ogsaa i readonly og i baggrunds-tilstand.
    ///
    /// Alt der ikke er markeret AXSecureTextField kom med: et afsloeret kodeord
    /// i et statisk felt, en TOTP-kode, en sikker note, hvert brugernavn.
    ///
    /// Spaerringen hoerer til HER, i gennemloebet - ikke i serveren. Hjaelperen
    /// maa aldrig DANNE vaerdierne; goer den det, ligger de allerede i en
    /// proces' hukommelse, og saa er den eneste beskyttelse at nogen husker at
    /// filtrere dem fra.
    static func erSpaerret(_ app: NSRunningApplication, _ ekstra: Set<String> = []) -> Bool {
        guard let bid = app.bundleIdentifier?.lowercased() else { return false }
        return defaultDenyBundles.union(ekstra).contains { $0.lowercased() == bid }
    }

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
            var wins = (attr(axApp, kAXWindowsAttribute as String) as? [AXUIElement]) ?? []
            // ⛔ MAALT 19/9: Dock'en og menulinjens statusikoner har NUL
            //    vinduer - deres indhold haenger direkte paa programmet.
            //    Dock: 0 vinduer, 32 AXDockItem under en AXList.
            //    Kontrolcenter: 0 vinduer, 9 AXMenuBarItem under en AXMenuBar.
            //    Saa laenge vi kun gik ned gennem vinduer, var alt uden for et
            //    vindue usynligt for agenten - og det er wifi, uret, batteriet
            //    og hvert eneste program i Dock'en.
            //
            //    Faldbagen er billig og kan ikke skade: har programmet vinduer,
            //    aendrer intet sig. Har det ingen, gaar vi ned fra programmet
            //    selv i stedet for at returnere tomt.
            if wins.isEmpty { wins = [axApp] }

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
    static func inspect(bundleId: String?, maxDepth: Int, maxNodes: Int,
                        ekstraDeny: Set<String> = []) -> [[String: Any]] {
        var nodes: [[String: Any]] = []
        let apps = allApps().filter { a in
            guard let scope = bundleId else { return true }
            return a.bundleIdentifier == scope || a.localizedName?.lowercased() == scope.lowercased()
        }
        outer: for app in apps {
            // Et spaerret program afleverer KUN at det findes - aldrig indhold.
            if erSpaerret(app, ekstraDeny) {
                nodes.append([
                    "app": app.localizedName ?? "", "bundleId": app.bundleIdentifier ?? "",
                    "role": "AXApplication", "depth": 0, "denied": true,
                    "note": "This app is on the always-redact list. Its window is blacked out in screenshots, so its accessibility tree is not returned either - otherwise the tree would hand over exactly what the image hides."
                ])
                continue
            }
            let axApp = AXUIElementCreateApplication(app.processIdentifier)
            var wins = (attr(axApp, kAXWindowsAttribute as String) as? [AXUIElement]) ?? []
            // ⛔ MAALT 19/9: Dock'en og menulinjens statusikoner har NUL
            //    vinduer - deres indhold haenger direkte paa programmet.
            //    Dock: 0 vinduer, 32 AXDockItem under en AXList.
            //    Kontrolcenter: 0 vinduer, 9 AXMenuBarItem under en AXMenuBar.
            //    Saa laenge vi kun gik ned gennem vinduer, var alt uden for et
            //    vindue usynligt for agenten - og det er wifi, uret, batteriet
            //    og hvert eneste program i Dock'en.
            //
            //    Faldbagen er billig og kan ikke skade: har programmet vinduer,
            //    aendrer intet sig. Har det ingen, gaar vi ned fra programmet
            //    selv i stedet for at returnere tomt.
            if wins.isEmpty { wins = [axApp] }
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
        maxDepth: Int, limit: Int, ekstraDeny: Set<String> = []
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
            // Samme spaerring som inspect: et spaerret program giver INGEN
            // traeffere. En soegning der kan finde "brugernavn" i 1Password er
            // den samme laek, bare med et filter paa.
            if erSpaerret(app, ekstraDeny) { continue }
            let axApp = AXUIElementCreateApplication(app.processIdentifier)
            var wins = (attr(axApp, kAXWindowsAttribute as String) as? [AXUIElement]) ?? []
            // ⛔ MAALT 19/9: Dock'en og menulinjens statusikoner har NUL
            //    vinduer - deres indhold haenger direkte paa programmet.
            //    Dock: 0 vinduer, 32 AXDockItem under en AXList.
            //    Kontrolcenter: 0 vinduer, 9 AXMenuBarItem under en AXMenuBar.
            //    Saa laenge vi kun gik ned gennem vinduer, var alt uden for et
            //    vindue usynligt for agenten - og det er wifi, uret, batteriet
            //    og hvert eneste program i Dock'en.
            //
            //    Faldbagen er billig og kan ikke skade: har programmet vinduer,
            //    aendrer intet sig. Har det ingen, gaar vi ned fra programmet
            //    selv i stedet for at returnere tomt.
            if wins.isEmpty { wins = [axApp] }
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
            return (false, "the app '\(bundleId)' is not running")
        }
        let axApp = AXUIElementCreateApplication(app.processIdentifier)
        guard let bar = attr(axApp, "AXMenuBar") else {
            return (false, "this app publishes no menu bar we can read")
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
                return (false, "could not find '\(oensket)' in '\(path)' - run 'menus' to see what is there")
            }
            if i == led.count - 1 {
                if let enabled = attr(naeste, kAXEnabledAttribute as String) as? Bool, !enabled {
                    return (false, "'\(path)' is greyed out right now - the app does not allow it in this state")
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
            return (false, "could not find that window - run 'windows --app \(bundleId)' to see which ones exist", nil)
        }
        if x != nil || y != nil {
            let nu = frame(win)
            var p = CGPoint(x: CGFloat(x ?? Int(nu?.x ?? 0)), y: CGFloat(y ?? Int(nu?.y ?? 0)))
            if let v = AXValueCreate(.cgPoint, &p) {
                let r = AXUIElementSetAttributeValue(win, kAXPositionAttribute as CFString, v)
                if r != .success { return (false, "could not move the window (\(r.rawValue)) - some apps do not allow it", frame(win)) }
            }
        }
        if w != nil || h != nil {
            let nu = frame(win)
            var s = CGSize(width: CGFloat(w ?? Int(nu?.w ?? 0)), height: CGFloat(h ?? Int(nu?.h ?? 0)))
            if let v = AXValueCreate(.cgSize, &s) {
                let r = AXUIElementSetAttributeValue(win, kAXSizeAttribute as CFString, v)
                if r != .success { return (false, "could not resize the window (\(r.rawValue))", frame(win)) }
            }
        }
        return (true, "sat", frame(win))
    }

    /// Luk eller minimér. ⛔ At lukke kan tabe ugemt arbejde - derfor gaar den
    /// gennem porten hver gang, som et destruktivt menupunkt.
    static func windowButton(bundleId: String, title: String?, index: Int?,
                             which: String) -> (ok: Bool, why: String) {
        guard let win = findWindow(bundleId: bundleId, title: title, index: index) else {
            return (false, "could not find that window")
        }
        let attr = which == "close" ? kAXCloseButtonAttribute : kAXMinimizeButtonAttribute
        guard let knap = AX.attr(win, attr as String) else {
            return (false, "the window has no \(which) button")
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
            return (false, "could not write to the clipboard", false)
        }

        // Cmd+V gennem den samme vej som computer_key.
        let src = CGEventSource(stateID: .combinedSessionState)
        let vKode: CGKeyCode = 9  // 'v' paa ethvert layout: det er en FYSISK tast
        guard let ned = CGEvent(keyboardEventSource: src, virtualKey: vKode, keyDown: true),
              let op  = CGEvent(keyboardEventSource: src, virtualKey: vKode, keyDown: false) else {
            return (false, "could not build the key event", false)
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

// MARK: - Start og afslut programmer
//
// ⛔ MAALT 19/9: `activate` bruger NSRunningApplication.activate, som kun kan
//    hente et program der ALLEREDE koerer frem. Et menneske kan aabne et
//    lukket program; agenten kunne ikke.
//
// ⛔ Og de to handlinger er IKKE lige farlige. At starte et program kan intet
//    tabe. At afslutte det kan tabe ugemt arbejde - derfor gaar `quit` gennem
//    porten hver gang, og `launch` goer ikke.
extension AX {

    static func launchApp(_ hvad: String) -> (ok: Bool, why: String, bundleId: String?) {
        // Allerede i gang? Saa er "start" bare "hent frem", og det siger vi.
        if let k = AX.app(bundleId: hvad) {
            k.activate(options: [])
            return (true, "koerte allerede - hentet frem i stedet", k.bundleIdentifier)
        }
        let ws = NSWorkspace.shared
        var url: URL? = ws.urlForApplication(withBundleIdentifier: hvad)
        if url == nil {
            // Ogsaa et almindeligt navn skal virke: mennesket siger "Notes",
            // ikke "com.apple.Notes".
            for m in ["/Applications", "/System/Applications", NSHomeDirectory() + "/Applications"] {
                let k = URL(fileURLWithPath: m).appendingPathComponent(hvad + ".app")
                if FileManager.default.fileExists(atPath: k.path) { url = k; break }
            }
        }
        guard let u = url else {
            return (false, "could not find '\(hvad)' - neither as a bundle id nor as an app name in /Applications", nil)
        }
        // ⛔ SAMME FEJL SOM `listDisplays` havde, og den ville have holdt CI roed
        //    alene: svaret laa i en almindelig `var` som en anden traad skrev i.
        //    Min egen Swift lod det passere; GitHubs runner kalder det en fejl.
        //    Et laast rum i stedet - og saa er der ingen forskel paa de to
        //    oversaettere.
        final class Svar: @unchecked Sendable {
            private let laas = NSLock()
            private var v: (Bool, String, String?) = (false, "start gav intet svar", nil)
            func set(_ ny: (Bool, String, String?)) { laas.lock(); v = ny; laas.unlock() }
            var vaerdi: (Bool, String, String?) { laas.lock(); defer { laas.unlock() }; return v }
        }
        let sem = DispatchSemaphore(value: 0)
        let svar = Svar()
        let cfg = NSWorkspace.OpenConfiguration()
        cfg.activates = true
        ws.openApplication(at: u, configuration: cfg) { app, err in
            if let e = err { svar.set((false, "could not launch: \(e.localizedDescription)", nil)) }
            else { svar.set((true, "startet", app?.bundleIdentifier)) }
            sem.signal()
        }
        _ = sem.wait(timeout: .now() + 25)
        return svar.vaerdi
    }

    /// ⛔ Afslutter PAENT (samme vej som Cmd+Q), saa programmet faar lov at
    ///    spoerge om ugemt arbejde. Vi draeber aldrig en proces: et menneske
    ///    der trykker Cmd+Q faar en dialog, og det skal agenten ogsaa udloese
    ///    frem for at omgaa.
    static func quitApp(_ hvad: String) -> (ok: Bool, why: String) {
        guard let k = AX.app(bundleId: hvad) else {
            return (false, "the app '\(hvad)' is not running")
        }
        let navn = k.localizedName ?? hvad
        return k.terminate()
            ? (true, "bad '\(navn)' om at afslutte - den kan stadig spoerge om ugemt arbejde")
            : (false, "'\(navn)' afviste at afslutte")
    }
}

// MARK: - Skriveborde (Spaces)
//
// ⛔ macOS har INGEN offentlig API til at skifte Space. Den aerlige vej er den
//    samme som menneskets: systemets egen tastaturgenvej. Men den kan vaere
//    slaaet fra - MAALT paa Gustavs maskine 19/9: "flyt til Space til venstre"
//    var DEAKTIVERET, mens hoejre var slaaet til.
//
//    Et vaerktoej der bare sender tastetrykket, ville fejle TAVST paa hans
//    maskine. Saa det her laeser opsaetningen FOERST og naegter med en
//    begrundelse - og efterproever bagefter om skiftet faktisk skete, ved at
//    se om vinduerne paa skaermen aendrede sig.
extension AX {

    /// Er systemets genvej til at skifte Space slaaet til?
    /// 79 = til venstre, 81 = til hoejre (Apples egne id'er).
    static func spaceGenvejAktiv(_ hoejre: Bool) -> Bool? {
        guard let d = UserDefaults(suiteName: "com.apple.symbolichotkeys"),
              let alle = d.dictionary(forKey: "AppleSymbolicHotKeys") else { return nil }
        let id = hoejre ? "81" : "79"
        guard let post = alle[id] as? [String: Any] else { return nil }  // ikke rørt = standard = til
        return (post["enabled"] as? Bool) ?? ((post["enabled"] as? Int).map { $0 != 0 })
    }

    // ⛔ TREDJE UDGAVE, og de to foerste var forkerte paa hver sin maade:
    //
    //    1. Jeg taalte AX-vinduer. STOEJ: uden at skifte noget gik antallet
    //       10 -> 10 -> 9 -> 8 -> 10 over fire maalinger. AX lister ALLE et
    //       programs vinduer uanset hvilken Space de staar paa, saa saettet
    //       aendrer sig af sig selv. Den rapporterede "verified" om noget den
    //       ikke kunne se.
    //    2. Saa lyttede jeg efter NSWorkspace.activeSpaceDidChangeNotification.
    //       Den er aegte - den er tavs naar intet skifter, maalt - men den naar
    //       ikke en kortlivet kommandolinje-proces uden app-loekke. Resultatet
    //       var "kan ikke bekraefte" hver gang, ogsaa naar skiftet skete.
    //
    //    Det der VIRKER er CoreGraphics' egen liste over vinduer paa skaermen:
    //    den daekker kun den Space der er fremme. MAALT foer den blev brugt:
    //    31 vinduer, NUL forskel over fire maalinger med et sekund imellem.
    //    Denne gang maalte jeg instrumentet foer jeg byggede paa det.
    private static func paaDenneSpace() -> Set<Int> {
        guard let l = CGWindowListCopyWindowInfo(
                [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
                as? [[String: Any]] else { return [] }
        return Set(l.compactMap { $0[kCGWindowNumber as String] as? Int })
    }

    static func skiftSpace(hoejre: Bool) -> (ok: Bool, why: String, aendret: Bool?) {
        // ⛔ nil betyder "no such entry", og det ER standard-tilstanden:
        //    macOS skriver kun i plisten naar nogen har aendret noget.
        if spaceGenvejAktiv(hoejre) == false {
            let retning = hoejre ? "hoejre" : "venstre"
            return (false, "systemets genvej til at skifte Space til \(retning) er slaaet FRA paa denne maskine. "
                         + "Slaa den til i Systemindstillinger > Tastatur > Tastaturgenveje > Mission Control, "
                         + "or switch desktop yourself. We do not send a key press that does nothing.", nil)
        }
        let foer = paaDenneSpace()
        let src = CGEventSource(stateID: .combinedSessionState)
        let pil: CGKeyCode = hoejre ? 124 : 123   // hoejre / venstre piletast
        guard let ned = CGEvent(keyboardEventSource: src, virtualKey: pil, keyDown: true),
              let op  = CGEvent(keyboardEventSource: src, virtualKey: pil, keyDown: false) else {
            return (false, "could not build the key event", nil)
        }
        ned.flags = .maskControl; op.flags = .maskControl
        ned.post(tap: .cghidEventTap); op.post(tap: .cghidEventTap)

        // Overgangen er animeret; uden pausen maaler vi den gamle Space.
        Thread.sleep(forTimeInterval: 1.2)
        let efter = paaDenneSpace()
        let skiftet = foer != efter
        return (true,
                skiftet
                ? "switched desktop - \(foer.subtracting(efter).count) windows went away, "
                  + "\(efter.subtracting(foer).count) appeared"
                : "the key press was sent, but the same windows are still on screen. "
                  + "There is probably no desktop in that direction. We are not claiming it worked.",
                skiftet)
    }
}
