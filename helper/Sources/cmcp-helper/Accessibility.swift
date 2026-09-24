import AppKit
import ApplicationServices
import Foundation

struct Rect: Codable {
    var x: Double, y: Double, w: Double, h: Double
    var dict: [String: Any] { ["x": x, "y": y, "w": w, "h": h] }
    var cg: CGRect { CGRect(x: x, y: y, width: w, height: h) }
}

enum AX {
    /// ⛔ MAALT 21/9-2026: Electron-apps saa TOMME ud, og vi var ved at konkludere
    ///    at vi manglede en syns-model som konkurrenterne har. Det var forkert.
    ///
    ///    Chromium bygger sit tilgaengeligheds-trae DOVENT. Indtil nogen beder om
    ///    det, svarer appen med naesten ingenting. `AXManualAccessibility` er den
    ///    kontakt hjaelpe-teknologi bruger til at bede om det.
    ///
    ///    Maalt paa en VS Code-fork med to vinduer:
    ///      foer:  computer_find role=AXButton -> 0 traeffere
    ///      efter: 728 knapper i de samme to vinduer, med rigtige navne
    ///        ("Send message", "Show command menu", "Copy response to clipboard")
    ///
    ///    Det er forskellen paa at vaere blind og at kunne se i Slack, VS Code,
    ///    Discord, Notion, Teams og WhatsApp - der hvor folk arbejder.
    ///
    ///    ⛔ RETTET 22/9, fordi den her kommentar loej. Der stod: «Vi saetter
    ///    den KUN for de programmer vi bliver spurgt om, og kun én gang pr.
    ///    proces.» Ingen af delene var sandt.
    ///
    ///    `secureRects` - som koerer ved HVERT skaermbillede - kalder
    ///    `taendTrae` paa HVER synlig app. Og `traeTaendt` lever i
    ///    hjaelper-processen, som startes forfra ved hvert kald, saa
    ///    dedupliken har aldrig virket paa tvaers af kald.
    ///
    ///    Og det ER rigtigt at goere. Uden traeet kan vi ikke finde
    ///    adgangskodefelter i Slack, Notion eller Discord - og saa lover
    ///    forsiden en sloering den ikke kan levere netop der hvor folk
    ///    skriver deres adgangskoder. Det er ikke en bivirkning vi taaler;
    ///    det er prisen for produktets vigtigste loefte.
    ///
    ///    Prisen er aerlig og staar i dokumentationen: den app vi peger paa
    ///    bygger og vedligeholder et tilgaengeligheds-trae den ellers ikke
    ///    ville have. Den der ikke vil betale den, saetter
    ///    CMCP_INGEN_ELECTRON=1 - og faar saa en sloering der er blind i
    ///    Electron. Begge valg er sande; vi skjuler ingen af dem.
    private static var traeTaendt = Set<pid_t>()
    // Saet CMCP_INGEN_ELECTRON=1 for at lade vaere. To grunde til at den findes:
    //
    //  1. Paastanden skal kunne falsificeres af andre end os. «0 knapper foer,
    //     728 efter» er marketing hvis ingen kan koere foer-tallet selv. Med
    //     flaget er det to kommandoer paa en hvilken som helst Mac.
    //  2. Det koster i den app vi peger paa - den bygger og vedligeholder et
    //     tilgaengeligheds-trae den ellers ikke ville have. Den der ikke vil
    //     betale det, skal kunne lade vaere.
    //
    // Standarden er uaendret: traeet taendes.
    static let taendTraeSlaaetFra = ProcessInfo.processInfo.environment["CMCP_INGEN_ELECTRON"] == "1"

    static func taendTrae(_ pid: pid_t) {
        guard !taendTraeSlaaetFra else { return }
        guard !traeTaendt.contains(pid) else { return }
        traeTaendt.insert(pid)
        AXUIElementSetAttributeValue(
            AXUIElementCreateApplication(pid),
            "AXManualAccessibility" as CFString,
            kCFBooleanTrue
        )
    }

    // MARK: - Lavniveau

    /// ⛔ MAALT 23/9: med en svarfrist paa programmet gik Finder fra 39,5 sek
    ///    til 0,8 - men ogsaa fra 1.500 noder til 105, TAVST. En hurtig
    ///    ufuldstaendig laesning er ikke bedre end en langsom, hvis svaret ikke
    ///    siger at noget mangler. Vi taeller de opslag der loeb toer for tid.
    static var langsommeOpslag = 0

    static func attr(_ el: AXUIElement, _ name: String) -> CFTypeRef? {
        var value: CFTypeRef?
        let fejl = AXUIElementCopyAttributeValue(el, name as CFString, &value)
        if fejl == .cannotComplete { langsommeOpslag += 1 }
        guard fejl == .success else { return nil }
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

    /// Slaar ét navngivet program op. Den leder i ALT der koerer.
    ///
    /// ⛔ MAALT 23/9-2026, og det er TREDJE gang samme fejl rammer denne fil.
    ///    Her stod `runningApps()`, som kun giver `.regular`-programmer - dem
    ///    med et Dock-ikon. Et menulinje-program (`LSUIElement`, altsaa
    ///    `.accessory`) var dermed usynligt for **seks** veje paa én gang:
    ///    `menus`, `menu`, `window`, `launch`, `quit` og `activate`.
    ///
    ///    Maalt paa en engangs-attrap med `LSUIElement`:
    ///      inspect --app <bid>  -> 8 noder, foerste er AXWindow
    ///      windows --app <bid>  -> {"count":0}
    ///      quit    --app <bid>  -> "the app '<bid>' is not running"
    ///    Traeet var der hele tiden. Det var opslaget der ikke kunne se det.
    ///
    ///    Linje 115 i denne fil beskriver PRAECIS samme fejl, fundet 18/9 i
    ///    sloeringen: «en adgangskode-dialog rejst af en baggrundsproces blev
    ///    ALDRIG scannet». Dengang blev det ene sted rettet. Moenstret blev
    ///    ikke. Det er derfor `allApps()` findes - og derfor den bruges her nu.
    ///
    ///    Det udvider ikke hvad der maa rammes: `main.swift`s faelles opslag
    ///    faldt allerede tilbage paa `allApps()`, saa porten kunne i forvejen
    ///    navngive et menulinje-program. Det var kun DE SEKS veje der ikke kunne.
    static func app(bundleId: String) -> NSRunningApplication? {
        allApps().first { $0.bundleIdentifier == bundleId }
            ?? allApps().first { $0.localizedName?.lowercased() == bundleId.lowercased() }
    }

    /// ⛔ ARKET DER STOPPER EN UBEVOGTET KOERSEL (22/9-2026)
    ///
    ///    Et «vil du gemme?» laegger sig over vinduet og tager ALT input i
    ///    programmet, indtil nogen svarer. For en agent der koerer om natten
    ///    er det ikke en fejl - det er en tavshed. Den proever igen, faar
    ///    ingenting, og staar der til nogen opdager det.
    ///
    ///    ⛔ OG EN RETTELSE AF MIN EGEN BEGRUNDELSE, samme dag.
    ///    Her stod: «MAALT foer i dag: AXSheet fandtes NUL gange i hele
    ///    kodebasen». Det var falsk. Jeg havde grep'et i TO mapper - helper/
    ///    og mcp-server/ - og skrevet resultatet ned som «hele kodebasen».
    ///    Repoet har det i fem filer, og `test/claims.mjs:1103` proever
    ///    allerede `find --role AXSheet`. Et modstander-review fandt det.
    ///
    ///    Samme fejlklasse som huset har betalt for hele dagen: et tal maalt
    ///    paa en delmaengde, rapporteret som helheden.
    ///
    ///    ARKET KUNNE ALTSAA FINDES I FORVEJEN - med `computer_find
    ///    --role AXSheet` og `computer_press`. Det reelle delta er mindre og
    ///    stadig aegte: **man skulle vide at man skulle lede.** En agent der
    ///    faar tavshed fra et program, proever igen; den spoerger ikke af sig
    ///    selv om der ligger et ark. Nu staar det i svaret fra `windows`, saa
    ///    tavsheden bliver til en tilstand uden at nogen skal gaette.
    ///
    ///    Det er et FELT, ikke et nyt vaerktoej. Svaret gives med
    ///    `computer_press`, som allerede fandtes.
    static func arkPaa(_ vindue: AXUIElement) -> [String: Any]? {
        guard let ark = children(vindue).first(where: {
            (attr($0, kAXRoleAttribute as String) as? String) == (kAXSheetRole as String)
        }) else { return nil }

        var d: [String: Any] = [:]

        // Det mennesket ville laese. Hoejst faa linjer: et ark er kort.
        var tekst: [String] = []
        func saml(_ e: AXUIElement, _ dybde: Int) {
            if dybde > 6 || tekst.count >= 4 { return }
            if let r = attr(e, kAXRoleAttribute as String) as? String, r == "AXStaticText",
               let v = attr(e, kAXValueAttribute as String) as? String,
               !v.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                tekst.append(v)
            }
            for b in children(e) { saml(b, dybde + 1) }
        }
        saml(ark, 0)
        if !tekst.isEmpty { d["says"] = tekst }

        // Knapperne, saa svaret kan gives uden at lede.
        var knapper: [String] = []
        func samlKnap(_ e: AXUIElement, _ dybde: Int) {
            if dybde > 6 { return }
            if let r = attr(e, kAXRoleAttribute as String) as? String, r == "AXButton",
               let t = attr(e, kAXTitleAttribute as String) as? String, !t.isEmpty {
                knapper.append(t)
            }
            for b in children(e) { samlKnap(b, dybde + 1) }
        }
        samlKnap(ark, 0)
        if !knapper.isEmpty { d["buttons"] = knapper }

        // macOS peger selv paa de to vigtigste - saa vi gaetter ikke.
        for (navn, felt) in [("default", kAXDefaultButtonAttribute as String),
                             ("cancel", kAXCancelButtonAttribute as String)] {
            if let raa = attr(ark, felt) {
                let knap = raa as! AXUIElement
                if let t = attr(knap, kAXTitleAttribute as String) as? String, !t.isEmpty { d[navn] = t }
            }
        }

        d["note"] = "This sheet is taking every keystroke in the app until someone answers it. "
                  + "Answer it with computer_press on one of the buttons above, then carry on."
        return d
    }

    /// ⛔ MAALT 24/9: «INGEN VINDUER» OG «JEG FIK IKKE SVAR» VAR SAMME SVAR.
    ///
    ///    Her stod `?? []`, saa ENHVER fejl fra tilgaengeligheds-laget blev til
    ///    en tom liste. `computer_windows` svarede `{"count":0,"windows":[]}`
    ///    uanset om programmet ikke havde vinduer, eller om opslaget aldrig fik
    ///    svar. De to er ikke det samme, og en agent kan ikke se forskel.
    ///
    ///    Sadan blev det maalt: under en fuld suite-koersel svarede tre paa
    ///    hinanden foelgende opslag «0 vinduer» om attrappen - mens programmet
    ///    beviseligt levede (`quit` lykkedes med exitCode 0 lige bagefter), og
    ///    samme proeve alene var groen. Proeven konkluderede at vinduet var
    ///    vaek. Det var det ikke; svaret var bare tomt.
    ///
    ///    Det er husets egen tilbagevendende fejlklasse: et tomt svar der
    ///    laeses som et faktum. `computer_inspect` melder selv `stopped_early`
    ///    naar den ikke naaede igennem. Det her gjorde ikke.
    ///
    ///    `.noValue` og `.attributeUnsupported` betyder FAKTISK ingen vinduer -
    ///    Dock'en og menulinje-ikoner har nul, og det er sandt. Alt andet
    ///    betyder at vi ikke ved det, og saa skal vi sige det.
    static func windowsMed(of app: NSRunningApplication) -> (vinduer: [AXUIElement], fejl: AXError?) {
        AX.taendTrae(app.processIdentifier)
        let axApp = AXUIElementCreateApplication(app.processIdentifier)
        AXUIElementSetMessagingTimeout(axApp, 2.0)
        var value: CFTypeRef?
        let f = AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute as CFString, &value)
        if f == .success { return ((value as? [AXUIElement]) ?? [], nil) }
        if f == .noValue || f == .attributeUnsupported { return ([], nil) }
        if f == .cannotComplete { langsommeOpslag += 1 }
        return ([], f)
    }

    static func windows(of app: NSRunningApplication) -> [AXUIElement] {
        windowsMed(of: app).vinduer
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
            AX.taendTrae(front.processIdentifier)
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
        // ⛔ FUNDET AF KONSULENTEN 22/9: de to naeste stod paa serverens
        //    «spoerg hver gang»-liste, men IKKE her. Et program kan altsaa
        //    have vaeret vigtigt nok til at spoerge om - og alligevel staa
        //    usloeret paa et skaermbillede og aabent i traeet. To lister der
        //    skal sige det samme, driver fra hinanden hver gang nogen retter
        //    den ene. `test/claims.mjs` sammenligner dem nu.
        "com.agilebits.onepassword",          // 1Password 6, aeldre bundle-ID
        "com.maxgoedjen.Secretive.Host",      // SSH-noegler i Secure Enclave
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
    /// ⛔ MAALT 23/9: et skaermbillede tog 86 sekunder. Ikke optagelsen -
    ///    SLOERINGEN. Den gennemgik hvert synligt programs trae for at finde
    ///    adgangskodefelter, og IDE'en alene (Electron, to store vinduer) tog
    ///    54 af de 79 sekunder. Chrome tog 1,2. macOS' egen soege-API
    ///    (AXUIElementsForSearchPredicate) er ikke understoettet af dem
    ///    (fejl -25213), saa den vej var lukket.
    ///
    ///    Det der virker, er at huske hvad billedet faktisk daekker: vi
    ///    behoever kun sloere det der ER med paa billedet. Vinduer der ikke
    ///    overlapper det optagede omraade, gaas ikke igennem.
    ///    Loeber tiden alligevel ud, sloerer vi HELE det program vi ikke naaede
    ///    - aldrig et billede med et ugennemgaaet vindue paa.
    static var sloeringStoppede: [String] = []

    static func secureRects(scopeBundleId: String?, extraDeny: Set<String>,
                            maxDepth: Int = 40, indenfor: Rect? = nil) -> [Rect] {
        var out: [Rect] = []
        sloeringStoppede = []
        let start = Date()
        let deny = defaultDenyBundles.union(extraDeny)
        let visible = onScreenPIDs()
        let apps = allApps().filter { a in
            // Tom maengde = vi kunne ikke spoerge vinduesserveren; saa tager vi alle.
            if !visible.isEmpty && !visible.contains(a.processIdentifier) { return false }
            guard let scope = scopeBundleId else { return true }
            return a.bundleIdentifier == scope || a.localizedName?.lowercased() == scope.lowercased()
        }

        // ⛔ MAALT 24/9: BUDGETTET BANDT IKKE DET DET HED EFTER.
        //
        //    Tidsgraensen laa KUN inde i vindues-loekken, og den brugte
        //    `continue`. Naar de 10 sekunder var brugt, blev vi ved med at
        //    spoerge hvert RESTERENDE program om dets vinduer - og hvert af de
        //    opslag kan tage op til 2 sekunder paa et program der haenger.
        //    Tre maalinger af `secure-rects` med standardbudgettet paa 10:
        //      13,76 s · 13,88 s · 21,25 s
        //    Serveren giver skaermbilledet 45 s, saa paa en travl maskine
        //    ryger hele kaldet i en tidsgraense og agenten faar INTET billede.
        //
        //    ⛔ OG DEN NAERLIGGENDE RETTELSE VAR FORKERT: at bryde loekken ville
        //    springe de resterende programmer HELT over, saa deres vinduer
        //    aldrig blev sloeret. Det ville lave en langsomheds-fejl om til en
        //    privatlivs-fejl. Den rettelse blev forkastet, ikke shippet.
        //
        //    I stedet foelger vi produktets EGEN regel ét niveau op. Den siger
        //    allerede: «naaede vi ikke igennem vinduet i tide, sloerer vi hele
        //    vinduet». Saa: naaede vi ikke igennem programlisten i tide,
        //    sloerer vi hele billedet. Det er strengt MERE sloering end foer,
        //    ikke mindre, og det er bundet i tid.
        if !apps.isEmpty && Date().timeIntervalSince(start) > sloeringsGraense {
            sloeringStoppede.append("(the scan ran out of time before it began - the whole image is redacted)")
            return [indenfor ?? heleSkaermen()]
        }
        for app in apps {
            // Samme regel, maalt pr. program: er tiden brugt, stopper vi med at
            // spoerge - og sloerer alt i stedet for at springe noget over.
            if Date().timeIntervalSince(start) > sloeringsGraense {
                sloeringStoppede.append("(the scan ran out of time - the whole image is redacted, not just what it found)")
                return [indenfor ?? heleSkaermen()]
            }
            let bid = (app.bundleIdentifier ?? "").lowercased()
            let isDenied = deny.contains(where: { $0.lowercased() == bid })
            AX.taendTrae(app.processIdentifier)
            let axApp = AXUIElementCreateApplication(app.processIdentifier)
            // Et enkelt haengende opslag maa ikke kunne spise hele budgettet.
            AXUIElementSetMessagingTimeout(axApp, 2.0)
            let opslag = windowsMed(of: app)
            // ⛔ A3, FUNDET AF SIKKERHEDSGENNEMGANGEN 24/9 - og samme dag som jeg
            //    rettede PRAECIS denne fejlklasse i `computer_windows`. Jeg rettede
            //    laeseren og lod sikkerhedsstien ligge.
            //    Her stod `?? []`: et program hvis vinduesopslag ikke fik svar (optaget,
            //    haengende - fx midt i en login-dialog), blev laest som «ingen vinduer».
            //    Saa blev `wins = [axApp]`, `frame(axApp)` er nil, gennemgangen timede
            //    ogsaa ud: NUL rektangler og ingen note. Dialogen kom igennem usloeret.
            //    Nu: fik vi ikke svar, spoerger vi vinduesserveren i stedet. Den ved
            //    hvor programmets vinduer staar uden at spoerge programmet, og den
            //    svarer i samme koordinatrum som optagelsen. Vi svaerter dem hele.
            if opslag.fejl != nil {
                let cg = cgRammer(pid: app.processIdentifier)
                    .filter { r in indenfor.map { r.cg.intersects($0.cg) } ?? true }
                // ⛔ B2 (sikkerhedsgennemgang 24/9): gav vinduesserveren INTET, blev
                //    intet svaertet - mens noten nedenfor paastod det modsatte. Samme
                //    faldbag som de to andre steder: kender vi ikke rammerne, svaertes
                //    hele omraadet. Rettelsen kom paa to af tre steder foerste gang.
                out.append(contentsOf: cg.isEmpty ? [indenfor ?? heleSkaermen()] : cg)
                sloeringStoppede.append((app.localizedName ?? bid) + " (did not answer - its windows were blacked out whole)")
                continue
            }
            var wins = opslag.vinduer
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
                // Kun det billedet daekker. Et vindue paa en anden skaerm kan
                // ikke vaere paa billedet, og behoever derfor ikke gennemgaas.
                if let omr = indenfor, let f = frame(win), !f.cg.intersects(omr.cg) { continue }
                // Naaede vi ikke igennem i tide, sloerer vi hele vinduet.
                //
                // ⛔ RETTET 24/9 EFTER EN SIKKERHEDSGENNEMGANG - og det var MIN fejl.
                //    Commit 589fac5 flyttede dette tjek fra `tidsgraense` (10) til
                //    `sloeringsGraense` (30) og skrev «strengt MERE sloering end
                //    foer, aldrig mindre». Det var falsk. Vinduer der naas mellem
                //    10 og 30 sek - og paa en travl Mac tager scanningen 13-21 -
                //    fik en praecis gennemgang i stedet for at blive svaertet helt,
                //    og den gennemgang kan misse et felt i tavshed (et `children()`
                //    der timer ud giver [], alt under dybde 40 naas aldrig).
                //    Vindues-niveauet er tilbage paa 10, som i foraelderen. 30 bruges
                //    KUN til programniveauets hele-billedet-faldbag, som er ny.
                if Date().timeIntervalSince(start) > tidsgraense {
                    // ⛔ A4: kunne rammen ikke laeses, blev INTET tilfoejet - mens
                    //    `sloeringStoppede` paastod at vinduet var svaertet.
                    let hele = frame(win).map { [$0] } ?? cgRammer(pid: app.processIdentifier)
                    out.append(contentsOf: hele.isEmpty ? [indenfor ?? heleSkaermen()] : hele)
                    sloeringStoppede.append(app.localizedName ?? bid)
                    continue
                }
                if isDenied {
                    // Hele vinduet ud. Vi gaar ikke ind i det - at gaa ind i en
                    // adgangskode-boks for at finde ud af hvad der skal sloeres,
                    // er selve den fejl vi undgaar.
                    //
                    // ⛔ 24/9: her stod `if let f = frame(win) { out.append(f) }`. Kunne
                    //    rammen ikke laeses - fx et program uden AX-vinduer, hvor
                    //    `wins = [axApp]` og `frame(axApp)` er nil - blev INTET af
                    //    adgangskode-manageren svaertet. Samme fejl som A4, fundet af
                    //    sikkerhedsgennemgangen - her paa den ene sti hvor den er vaerst.
                    let hele = frame(win).map { [$0] } ?? cgRammer(pid: app.processIdentifier)
                    out.append(contentsOf: hele.isEmpty ? [indenfor ?? heleSkaermen()] : hele)
                    continue
                }
                // ⛔ 24/9: tidsloftet var kun en PORT foer hvert vindue. Selve
                //    gennemgangen af ét vindue havde intet loft, saa et langsomt
                //    vindue kunne blokere forbi serverens 45 sek - og saa kom der
                //    INTET billede. Maalt alene: ét svigt paa 82 sek, én succes paa 27.
                //    Nu stopper gennemgangen ved loftet, og vinduet svaertes HELT.
                //    Det er samme regel som porten ovenfor - bare ogsaa midt i et vindue.
                gennemgangFrist = start.addingTimeInterval(tidsgraense)
                gennemgangOverskred = false
                walk(win, depth: 0, maxDepth: maxDepth) { el, role in
                    if isSecure(el, role: role), let f = frame(el) { out.append(f) }
                }
                gennemgangFrist = nil
                if gennemgangOverskred {
                    let hele = frame(win).map { [$0] } ?? cgRammer(pid: app.processIdentifier)
                    out.append(contentsOf: hele.isEmpty ? [indenfor ?? heleSkaermen()] : hele)
                    sloeringStoppede.append((app.localizedName ?? bid) + " (walk ran out of time - window blacked out whole)")
                }
            }
        }
        return out
    }

    /// Fristen for den gennemgang der koerer lige nu - sat af `secureRects`.
    static var gennemgangFrist: Date? = nil
    /// Blev fristen overskredet midt i gennemgangen?
    static var gennemgangOverskred = false

    private static func walk(_ el: AXUIElement, depth: Int, maxDepth: Int, _ visit: (AXUIElement, String) -> Void) {
        guard depth < maxDepth else { return }
        if let f = gennemgangFrist, Date() > f { gennemgangOverskred = true; return }
        let role = string(el, kAXRoleAttribute as String) ?? ""
        visit(el, role)
        for child in children(el) {
            walk(child, depth: depth + 1, maxDepth: maxDepth, visit)
        }
    }

    // MARK: - Inspektion

    /// Læsbart traeudtraek, som en agent kan navigere efter uden at gaette paa pixels.
    /// ⛔ MAALT 23/9: Finder tog 39,5 sekunder for 1.500 noder - og 8,5 sekunder
    ///    allerede ved dybde 6 for 732. IDE'en klarer 1.500 paa 1,7. Det er ikke
    ///    maengden; hvert AX-opslag i Finder er langsomt. Serveren giver op efter
    ///    30 sekunder, saa et helt almindeligt opslag fejlede med «hjaelperen
    ///    svarede ikke». Nu stopper gennemgangen ved en tidsgraense og SIGER det,
    ///    i stedet for at loebe ind i muren. Samme aerlighed som tekst-loftet.
    static var stoppedeTidligt = false
    static let tidsgraense: Double = Double(ProcessInfo.processInfo.environment["CMCP_BUDGET_SEK"] ?? "") ?? 10

    /// Sloeringens EGET loft - adskilt fra `tidsgraense` med vilje.
    ///
    /// ⛔ MAALT 24/9: de to delte ét tal, og det tal passede kun til det ene.
    ///    10 sekunder blev sat for `inspect` (Finder-sagen: 39,5 sek). Sloeringen
    ///    respekterede aldrig tallet - den loeb videre - saa ingen opdagede at
    ///    det var for stramt til DENS job. Da den begyndte at respektere det,
    ///    blev hvert fuldskaerms-billede paa en travl Mac HELT sort:
    ///    scanningen tog 12,75 sek og ramte loftet hver gang.
    ///
    ///    Loftets formaal er at forhindre et HAENG, ikke at begraense normal drift.
    ///    Serveren giver skaermbilledet 45 sek. Scanningen + ét langsomt program
    ///    (maalt overskud ~2,75 sek) + optagelse + kodning skal kunne naa det.
    ///    30 giver plads. Maalte normale scanninger her: 13-21 sek - de bliver
    ///    praecise; et program der haenger, bliver bundet og sloeret helt.
    static let sloeringsGraense: Double = {
        // ⛔ A6: `Double("nan")` og `Double("inf")` parser, og `x > nan` er altid
        //    falsk - saa faldbagen ville aldrig fyre. Kun endelige tal >= 0.
        if let v = Double(ProcessInfo.processInfo.environment["CMCP_REDACT_BUDGET_SEK"] ?? ""),
           v.isFinite, v >= 0 { return v }
        return 30
    }()

    static func inspect(bundleId: String?, maxDepth: Int, maxNodes: Int,
                        ekstraDeny: Set<String> = []) -> [[String: Any]] {
        let start = Date()
        stoppedeTidligt = false
        langsommeOpslag = 0
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
            AX.taendTrae(app.processIdentifier)
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
            // ⛔ MAALT 22/9 i Chrome: fire vinduer (fanelinje, vaerktoejslinje,
            //    oplysningsbjaelke, indhold) peger ind i SAMME trae. `find` gav
            //    10 svar, hvoraf 4 var forskellige - samme fane talt op til fire
            //    gange, og en graense paa 10 blev brugt op paa gentagelser.
            //    Hvert element besoeges nu hoejst én gang pr. program.
            var besoegt = Set<AXUIElement>()
            for win in wins {
                var stack: [(AXUIElement, Int)] = [(win, 0)]
                while let (el, d) = stack.popLast() {
                    if nodes.count >= maxNodes { break outer }
                    if Date().timeIntervalSince(start) > tidsgraense { stoppedeTidligt = true; break outer }
                    guard besoegt.insert(el).inserted else { continue }
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
                        // ⛔ FUNDET AF KONSULENTEN 22/9: her blev klippet TAVST.
                        //    Samme dag kostede det mig selv en forkert maaling
                        //    («40 tegn tabt» - de var klippet). Et svar der blev
                        //    kappet, skal sige det: det er browser-mcp's egen
                        //    regel, og den er hele grunden til at vi kopierer den.
                        if v.count > 200 {
                            n["value"] = String(v.prefix(200))
                            n["value_cut"] = true
                            n["value_chars"] = v.count
                        } else {
                            n["value"] = v
                        }
                    }
                    if isSecure { n["secure"] = true }
                    if let f = frame(el) { n["frame"] = f.dict }
                    nodes.append(n)
                    // ⛔ `.reversed()` ER rettelsen, fundet af et modstander-review 22/9.
                    //    Stakken tages med popLast(), saa boern lagt i raekkefoelge
                    //    besoeges BAGFRA. `find` svarede i omvendt laeseretning, og
                    //    `press`, `set_value` og `wait_for` bruger alle `hits.first`
                    //    - altsaa det SIDSTE element i laeseretning. En agent der bad
                    //    om «den foerste Gem-knap» trykkede den sidste.
                    //    Det ramte skrivende kald, ikke kun visningen.
                    for c in children(el).reversed() { stack.append((c, d + 1)) }
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
        let start = Date()
        stoppedeTidligt = false
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
            AX.taendTrae(app.processIdentifier)
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
            // ⛔ MAALT 22/9 i Chrome: fire vinduer (fanelinje, vaerktoejslinje,
            //    oplysningsbjaelke, indhold) peger ind i SAMME trae. `find` gav
            //    10 svar, hvoraf 4 var forskellige - samme fane talt op til fire
            //    gange, og en graense paa 10 blev brugt op paa gentagelser.
            //    Hvert element besoeges nu hoejst én gang pr. program.
            var besoegt = Set<AXUIElement>()
            for win in wins {
                var stack: [(AXUIElement, Int)] = [(win, 0)]
                while let (el, d) = stack.popLast() {
                    if out.count >= limit { break outer }
                    if Date().timeIntervalSince(start) > tidsgraense { stoppedeTidligt = true; break outer }
                    guard besoegt.insert(el).inserted else { continue }
                    guard d < maxDepth else { continue }
                    // ⛔ `.reversed()` ER rettelsen, fundet af et modstander-review 22/9.
                    //    Stakken tages med popLast(), saa boern lagt i raekkefoelge
                    //    besoeges BAGFRA. `find` svarede i omvendt laeseretning, og
                    //    `press`, `set_value` og `wait_for` bruger alle `hits.first`
                    //    - altsaa det SIDSTE element i laeseretning. En agent der bad
                    //    om «den foerste Gem-knap» trykkede den sidste.
                    //    Det ramte skrivende kald, ikke kun visningen.
                    for c in children(el).reversed() { stack.append((c, d + 1)) }

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

    /// Hele skaermfladen som en sloerings-rektangel - faldbagen naar scanningen
    /// ikke naaede igennem i tide. Hellere et sort billede end et der viser
    /// noget vi ikke naaede at kigge efter.
    ///
    /// ⛔ RETTET 24/9: foerste udgave byggede paa `NSScreen.frame` - Cocoa-rummet,
    ///    hvor y vender OPAD fra hovedskaermens bund. Alt andet her (AX-rammer,
    ///    optagelsens omraade) er CG-rummet, hvor y vender NEDAD fra toppen. Paa
    ///    Gustavs opsaetning ramte de hinanden ved et tilfaelde (skaermene er
    ///    bund-justeret). En skaerm placeret OVER hovedskaermen ville vaere
    ///    sprunget helt over. CGDisplayBounds svarer i det rigtige rum.
    static func heleSkaermen() -> Rect {
        var ids = [CGDirectDisplayID](repeating: 0, count: 32)
        var n: UInt32 = 0
        var u = CGRect.null
        if CGGetActiveDisplayList(32, &ids, &n) == .success {
            for i in 0..<Int(n) { u = u.union(CGDisplayBounds(ids[i])) }
        }
        if u.isNull { u = CGDisplayBounds(CGMainDisplayID()) }
        return Rect(x: Double(u.origin.x), y: Double(u.origin.y), w: Double(u.width), h: Double(u.height))
    }

    /// Et programs vinduer paa skaermen, som VINDUESSERVEREN ser dem - uden at
    /// spoerge programmet. Bruges naar programmet ikke svarer: saa ved vi ikke
    /// hvad der staar i vinduerne, men vi ved hvor de er. CG-rum, samme som optagelsen.
    static func cgRammer(pid: pid_t) -> [Rect] {
        let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
        guard let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else { return [] }
        return list.compactMap { w in
            guard (w[kCGWindowOwnerPID as String] as? pid_t) == pid,
                  let b = w[kCGWindowBounds as String] as? [String: Any],
                  let r = CGRect(dictionaryRepresentation: b as CFDictionary) else { return nil }
            return Rect(x: Double(r.origin.x), y: Double(r.origin.y), w: Double(r.width), h: Double(r.height))
        }
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
        AX.taendTrae(app.processIdentifier)
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
                // ⛔ MAALT 22/9 i Finder: genvejen kom UDEN taster foran.
                //    «Toem papirkurv…» og «Toem papirkurv» stod begge som «\b»,
                //    «Nyt Findervindue» og «Ny mappe» begge som «N». En agent der
                //    tog genvejen til computer_key, kunne ikke skelne dem - og
                //    den ene sletter uden at spoerge. Nu i computer_key's eget
                //    format, med ALLE taster: «cmd+shift+backspace».
                if let cmd = string(barn, kAXMenuItemCmdCharAttribute as String), !cmd.isEmpty {
                    let maske = (attr(barn, kAXMenuItemCmdModifiersAttribute as String) as? Int) ?? 0
                    punkt["shortcut"] = AX.genvej(tegn: cmd, maske: maske)
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
        AX.taendTrae(app.processIdentifier)
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

    /// Svarede programmet ikke, da `findWindow` sidst spurgte? Saa er «intet vindue»
    /// ikke sandt - det er «ingen ved det». Kalderne siger det i stedet.
    static var vinduesOpslagSvaredeIkke = false

    /// ⛔ 24/9: her stod `windows(of: app)`, som goer ENHVER fejl til en tom liste.
    ///    Samme fejlklasse jeg rettede i `computer_windows` samme morgen - og ikke
    ///    foerte hertil. Under en fuld suite svarede et travlt program ikke, og
    ///    `computer_window` sagde «could not find that window» om et vindue der
    ///    fandtes (tjek 1c havde lige set det). Nu: proev igen kort, og svarer det
    ///    stadig ikke, sig DET.
    private static func findWindow(bundleId: String, title: String?, index: Int?) -> AXUIElement? {
        guard let app = AX.app(bundleId: bundleId) else { return nil }
        var opslag = windowsMed(of: app)
        for _ in 0..<3 where opslag.fejl != nil { usleep(300_000); opslag = windowsMed(of: app) }
        vinduesOpslagSvaredeIkke = opslag.fejl != nil
        let vinduer = opslag.vinduer
        if let t = title, !t.isEmpty {
            for w in vinduer where (string(w, kAXTitleAttribute as String) ?? "").contains(t) { return w }
            return nil
        }
        let i = index ?? 0
        return i >= 0 && i < vinduer.count ? vinduer[i] : nil
    }

    /// Flyt og/eller aendr et vindue. Koordinater er GLOBALE punkter, samme rum
    /// som computer_click - saa en negativ x er en skaerm til venstre.
    /// ⛔ MAALT 23/9-2026: ET HALVT UDFOERT KALD BLEV MELDT SOM EN REN FEJL.
    ///
    ///    Flyt-og-aendr-stoerrelse er TO skrivninger. Attrappens vindue er
    ///    `.borderless` og har ingen `AXSize`, saa flytningen lykkedes og
    ///    stoerrelsen fejlede med -25200. Svaret var «could not resize», og
    ///    revisionsloggen skrev:
    ///        {"tool":"computer_window","outcome":"error", ...}
    ///    Vinduet var paa det tidspunkt MAALT flyttet fra x=-20000 til x=-19000.
    ///
    ///    Produktets andet loefte er at revisionssporet er helt. En mutation
    ///    der skete, og en log der siger at intet skete, er praecis det loefte
    ///    brudt - og det er vaerre end en fejl, fordi ingen gaar og leder.
    ///
    ///    Derfor baerer svaret nu `gjort`: hvad der faktisk blev skrevet, ogsaa
    ///    naar resten fejlede. Kaldet er stadig en FEJL - den der bad om begge
    ///    dele fik kun den ene - men den er ikke laengere tavs.
    static func windowSet(bundleId: String, title: String?, index: Int?,
                          x: Int?, y: Int?, w: Int?, h: Int?) -> (ok: Bool, why: String, frame: Rect?, gjort: [String]) {
        var gjort: [String] = []
        guard let win = findWindow(bundleId: bundleId, title: title, index: index) else {
            return (false, vinduesOpslagSvaredeIkke
                ? "the app did not answer when asked for its windows - it may be busy. Nothing was changed; try again"
                : "could not find that window - run 'windows --app \(bundleId)' to see which ones exist", nil, gjort)
        }
        if x != nil || y != nil {
            // ⛔ ASTRA 23/9: her stod `nu?.x ?? 0`. Kunne vinduets nuvaerende
            //    ramme ikke laeses, GAETTEDE vi paa 0 for den koordinat der
            //    ikke var opgivet - og 0 er hovedskaermens hjoerne. Et kald med
            //    kun `y` kunne altsaa flytte et vindue fra et sted uden for
            //    skaermen og IND paa den. Produktets hele loefte er at det ikke
            //    roerer menneskets skaerm; et gaet der defaulter til midt i
            //    synsfeltet er det daarligst mulige gaet.
            //    Kan vi ikke laese rammen, ved vi ikke hvor vinduet er. Saa
            //    flytter vi det ikke.
            guard let nu = frame(win) else {
                return (false, "could not read the window's current position, so a partial move would have to guess - give both x and y, or try again", nil, gjort)
            }
            var p = CGPoint(x: CGFloat(x ?? Int(nu.x)), y: CGFloat(y ?? Int(nu.y)))
            if let v = AXValueCreate(.cgPoint, &p) {
                let r = AXUIElementSetAttributeValue(win, kAXPositionAttribute as CFString, v)
                if r != .success { return (false, "could not move the window (\(r.rawValue)) - some apps do not allow it", frame(win), gjort) }
                gjort.append("moved")
            }
        }
        if w != nil || h != nil {
            // Samme grund: en stoerrelse gaettet til 0 er et usynligt vindue.
            guard let nu = frame(win) else {
                return (false, "could not read the window's current size, so a partial resize would have to guess - give both width and height, or try again", frame(win), gjort)
            }
            var s = CGSize(width: CGFloat(w ?? Int(nu.w)), height: CGFloat(h ?? Int(nu.h)))
            if let v = AXValueCreate(.cgSize, &s) {
                let r = AXUIElementSetAttributeValue(win, kAXSizeAttribute as CFString, v)
                if r != .success { return (false, "could not resize the window (\(r.rawValue))", frame(win), gjort) }
                gjort.append("resized")
            }
        }
        return (true, "sat", frame(win), gjort)
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

        guard restore else { return (true, "pasted", false) }

        // Programmet skal naa at laese udklipsholderen foer vi skifter den.
        // ⛔ MAALT: uden pausen fik modtageren af og til det GAMLE indhold
        //    tilbage, fordi vi havde naaet at gendanne foer Cmd+V blev laest.
        Thread.sleep(forTimeInterval: 0.35)
        pb.clearContents()
        if !gammel.isEmpty { pb.writeObjects(gammel) }
        return (true, "pasted, and your own clipboard was put back", true)
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

    /// ⛔ `stille` (22/9): start programmet UDEN at hente det frem.
    ///
    ///    Foer i dag gjorde `launch` to ting paa én gang: startede programmet
    ///    OG aktiverede det. Derfor stod den paa listen over vaerktoejer der
    ///    tager skaermen - ikke fordi en start kraever det, men fordi koden
    ///    gjorde begge dele. `NSWorkspace.OpenConfiguration.activates = false`
    ///    starter det bagved, og `hide()` holder det ude af vejen.
    ///
    ///    Og «koerte allerede» maa saa heller ikke hente det frem: det ville
    ///    vaere `computer_activate`, som er et andet vaerktoej med en anden
    ///    port.
    static func launchApp(_ hvad: String, stille: Bool = false) -> (ok: Bool, why: String, bundleId: String?) {
        // Allerede i gang? Saa er "start" bare "hent frem", og det siger vi.
        if let k = AX.app(bundleId: hvad) {
            if stille { return (true, "was already running - left where it was", k.bundleIdentifier) }
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
        cfg.activates = !stille
        cfg.addsToRecentItems = !stille
        ws.openApplication(at: u, configuration: cfg) { app, err in
            if let e = err { svar.set((false, "could not launch: \(e.localizedDescription)", nil)) }
            else {
                if stille { app?.hide() }
                svar.set((true, stille ? "launched in the background" : "launched", app?.bundleIdentifier))
            }
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
            ? (true, "asked '\(navn)' to quit - it may still ask you about unsaved work")
            : (false, "'\(navn)' refused to quit")
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

extension AX {
    /// Menupunktets genvej i computer_key's format. Masken er macOS' egen:
    /// 1 = shift, 2 = option, 4 = control, 8 = INGEN cmd (cmd er ellers med).
    static func genvej(tegn: String, maske: Int) -> String {
        var dele: [String] = []
        if maske & 4 != 0 { dele.append("ctrl") }
        if maske & 2 != 0 { dele.append("option") }
        if maske & 1 != 0 { dele.append("shift") }
        if maske & 8 == 0 { dele.append("cmd") }
        let navne: [UInt32: String] = [
            0x08: "backspace", 0x0D: "return", 0x09: "tab", 0x1B: "escape", 0x20: "space",
            0xF700: "up", 0xF701: "down", 0xF702: "left", 0xF703: "right",
        ]
        if let u = tegn.unicodeScalars.first, tegn.unicodeScalars.count == 1, let navn = navne[u.value] {
            dele.append(navn)
        } else {
            dele.append(tegn.lowercased())
        }
        return dele.joined(separator: "+")
    }
}
