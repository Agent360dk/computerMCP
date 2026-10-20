import AppKit
import Carbon
import CoreGraphics
import Foundation

enum Input {
    /// ⛔ DEN LINJE DER AFGOER OM VI TAGER SKAERMEN (fundet 21/9-2026)
    ///
    ///    `.cghidEventTap` er den globale HID-stroem - den samme kanal som det
    ///    fysiske tastatur. Derfor flytter den den rigtige markoer og rammer
    ///    det program der er forrest. Det var grunden til at `type`, `key`,
    ///    `scroll` og `click` stod paa en liste over «tager skaermen»: ikke
    ///    fordi handlingen kraever det, men fordi LEVERINGEN goer.
    ///
    ///    `postToPid` lægger den SAMME haendelse i ét programs egen koe.
    ///    MAALT 21/9 mod et prøvemaal, mens mennesket arbejdede i en anden app:
    ///    tastetryk ankom, markoeren stod stille, forgrunden skiftede ikke.
    ///
    ///    Vi lover det ikke - vi maaler det. Hvert skrivende svar baerer
    ///    `took_screen` fra `Skaerm`, saa daekningen kan goeres op pr. program
    ///    i stedet for at blive paastaaet.
    /// B19 (20/10): ALLE haendelser hjaelperen sender, gaar herigennem - ogsaa Escape i menunettet og
    /// rullemenu-valget, Cmd+V i paste og ctrl+pil i Space-skift - saa proevekrogen ser dem alle.
    /// ⚠️ GRAENSE (R59 Astra + Opus): krogen daekker HAENDELSER, ikke tilgaengeligheds-laget. `type --app` uden
    /// `--keystrokes` (AX.indsaetIFokus), press, set-value og aktivering skriver direkte gennem AX, og paste
    /// aendrer udklipsholderen foer Cmd+V. En proeve med krogen maa derfor kun bruge drag/click/key/type
    /// med --keystrokes mod et rigtigt program.
    static func post(_ event: CGEvent?, _ tilPid: pid_t? = nil) {
        guard let event else { return }
        // Proevekrog (S2b): med CMCP_HJAELPER_ATTRAP skrives haendelsen i en fil i stedet for at blive sendt -
        // saa en proeve kan stoppe et traek midt i uden at roere skaermen. Med den sat sendes ALDRIG noget, og den
        // skriver kun haendelsestype + pid i en fil i en midlertidig mappe (R49).
        if let fil = attrapFil {
            // R49 (Astra, MAALT): krogen fulgte et symbolsk link og skrev i en hvilken som helst fil. Nu kun i
            // systemets midlertidige mappe, aldrig gennem et link, og kun haendelsestype + pid.
            if attrapStiTilladt(fil) {
                let linje = "\(event.type.rawValue) \(tilPid ?? 0)\n"
                let fd = open(fil, O_WRONLY | O_APPEND | O_CREAT | O_NOFOLLOW, 0o600)
                if fd >= 0 { _ = linje.withCString { write(fd, $0, strlen($0)) }; close(fd) }
            }
            return   // med krogen sat sendes ALDRIG noget - heller ikke naar stien afvises
        }
        if let pid = tilPid { event.postToPid(pid) } else { event.post(tap: .cghidEventTap) }
    }
    private static let attrapFil: String? = ProcessInfo.processInfo.environment["CMCP_HJAELPER_ATTRAP"].flatMap { $0.isEmpty ? nil : $0 }
    /// Proevekrogens fil skal ligge i en midlertidig mappe (TMPDIR, /tmp, /private/tmp, /private/var/folders).
    private static func attrapStiTilladt(_ fil: String) -> Bool {
        let mappe = URL(fileURLWithPath: fil).deletingLastPathComponent().resolvingSymlinksInPath().path
        var roedder = ["/private/tmp", "/tmp", "/private/var/folders"]
        if let t = ProcessInfo.processInfo.environment["TMPDIR"] { roedder.append(URL(fileURLWithPath: t).resolvingSymlinksInPath().path) }
        return roedder.contains { mappe == $0 || mappe.hasPrefix($0.hasSuffix("/") ? $0 : $0 + "/") }
    }
    /// R49 (Astra): et sikkerhedsnet, naar serveren MAATTE draebe et traek med SIGKILL (hjaelperen stod
    /// stille i over 2 s og kunne ikke selv slippe): en ny hjaelper slipper venstre knap, hvor markoeren er.
    /// Et slip uden et tryk foer er harmloest for programmerne.
    @discardableResult
    static func slipVenstreKnap(start: CGPoint?) -> Bool {
        // R50 (Opus N3) + R51 (Opus M1): kun naar knappen ER nede i sessionen. Om macOS taeller vores egne tryk
        // uden kilde som «fysiske» (hidSystemState), kan ikke maales uden at trykke paa Gustavs skaerm - saa den
        // betingelse er fjernet: en knap der haenger for hele Mac'en er vaerre end at slippe et traek mennesket
        // selv er midt i, netop naar en hjaelper har staaet stille i 2 s (kendt graense, CHANGELOG).
        // Med proevekrogen kendes tilstanden ikke - intet blev trykket for alvor - saa der slippes altid.
        if attrapFil == nil {
            guard CGEventSource.buttonState(.combinedSessionState, button: .left) else { return false }
        }
        let her = CGEvent(source: nil)?.location ?? .zero
        slipKnap(her, start ?? her)
        return true
    }

    /// S2b · sikker frigivelse: et stop (SIGTERM fra serveren - laanet sluttede, eller «Stop all agents now»;
    /// R49: ogsaa SIGINT/SIGHUP fra en terminal) maa aldrig efterlade en museknap eller en tast NEDE - og maa
    /// aldrig lade et trin BEGYNDE. Signalet blokeres for HELE kommandoen (ogsaa opslagene foer handlingen) og
    /// ses som VENTENDE: lige foer den foerste haendelse (R49 Opus: ellers blev et stop under opslagene
    /// ignoreret, og trinnet sendt bagefter) og mellem haendelserne. Samme moenster som paste (SIGUSR1).
    /// Kaldes FOER alt andet i kommandoen.
    private static let stopSignaler: [Int32] = [SIGTERM, SIGINT, SIGHUP]
    static func blokerStop() {
        var s = sigset_t(); sigemptyset(&s)
        for sig in stopSignaler { sigaddset(&s, sig) }
        pthread_sigmask(SIG_BLOCK, &s, nil)
    }
    /// Er et stop kommet? Synkront: laeser de ventende signaler.
    static var stopVenter: Bool {
        var s = sigset_t(); sigemptyset(&s)
        sigpending(&s)
        return stopSignaler.contains { sigismember(&s, $0) == 1 }
    }

    static func move(x: Double, y: Double) {
        post(CGEvent(mouseEventSource: nil, mouseType: .mouseMoved,
                     mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: .left))
    }

    /// Vinduesserverens ramme for vinduet `nr` (globale punkter).
    static func vindueRamme(_ nr: Int) -> CGRect? {
        let liste = (CGWindowListCopyWindowInfo([.optionIncludingWindow], CGWindowID(nr)) as? [[String: Any]]) ?? []
        guard let d = liste.first?[kCGWindowBounds as String] else { return nil }
        return CGRect(dictionaryRepresentation: d as! CFDictionary)
    }

    /// Det vindue i programmet `pid`, der dækker punktet - forrest først (CGWindowList er
    /// ordnet forrest først). Kun programmets egne almindelige vinduer (lag <= 0).
    static func vindueVedPunkt(pid: pid_t, x: Double, y: Double) -> Int? {
        let liste = (CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]]) ?? []
        for w in liste where (w[kCGWindowOwnerPID as String] as? pid_t) == pid && ((w[kCGWindowLayer as String] as? Int) ?? 1) <= 0 {
            guard let d = w[kCGWindowBounds as String], let r = CGRect(dictionaryRepresentation: d as! CFDictionary),
                  r.contains(CGPoint(x: x, y: y)) else { continue }
            return w[kCGWindowNumber as String] as? Int
        }
        return nil
    }

    /// ⛔ R27 (10/10, MAALT af Opus og efterproevet af Claude 3/3 i Lommeregneren bagved):
    ///    et museklik sendt til en proces-koe LANDER IKKE, medmindre haendelsen baerer
    ///    felt 51 = modtagervinduets nummer og felt 58 = et tal forskelligt fra 0. Begge
    ///    saettes med det offentlige setIntegerValueField, men numrene er udokumenterede -
    ///    derfor maa svaret aldrig paastaa at klikket landede uden at det er aflaest.
    static let FELT_VINDUE = CGEventField(rawValue: 51)!
    static let FELT_VINDUESPUNKT = CGEventField(rawValue: 58)!

    /// Svarer hvor mange klik der blev sendt - et stop (S2b) kan komme foer det foerste eller mellem to.
    @discardableResult
    static func click(x: Double, y: Double, button: String, count: Int, tilPid: pid_t? = nil, vindue: Int? = nil) -> Int {
        let pt = CGPoint(x: x, y: y)
        let (down, up, btn): (CGEventType, CGEventType, CGMouseButton)
        switch button {
        case "right": (down, up, btn) = (.rightMouseDown, .rightMouseUp, .right)
        case "middle": (down, up, btn) = (.otherMouseDown, .otherMouseUp, .center)
        default: (down, up, btn) = (.leftMouseDown, .leftMouseUp, .left)
        }
        // ⛔ Markoeren flyttes KUN naar der ikke er en modtager. Med en
        //    modtager er hele pointen at den bliver hvor mennesket satte den.
        if stopVenter { return 0 }   // R49: et stop under opslagene - intet sendes
        if tilPid == nil {
            move(x: x, y: y)
            usleep(20_000)
        }
        for i in 1...max(1, count) {
            if stopVenter { return i - 1 }   // S2b: knappen er oppe mellem klikkene - stop dér (ogsaa foer det foerste)
            let d = CGEvent(mouseEventSource: nil, mouseType: down, mouseCursorPosition: pt, mouseButton: btn)
            d?.setIntegerValueField(.mouseEventClickState, value: Int64(i))
            if let v = vindue, tilPid != nil { d?.setIntegerValueField(FELT_VINDUE, value: Int64(v)); d?.setIntegerValueField(FELT_VINDUESPUNKT, value: 1) }
            post(d, tilPid)
            let u = CGEvent(mouseEventSource: nil, mouseType: up, mouseCursorPosition: pt, mouseButton: btn)
            u?.setIntegerValueField(.mouseEventClickState, value: Int64(i))
            if let v = vindue, tilPid != nil { u?.setIntegerValueField(FELT_VINDUE, value: Int64(v)); u?.setIntegerValueField(FELT_VINDUESPUNKT, value: 1) }
            post(u, tilPid)
            usleep(40_000)
        }
        return max(1, count)
    }

    /// Traekker fra ét punkt til et andet - filer, omsortering, skydere.
    ///
    /// ⛔ Den fejl der goer at et traek IKKE virker: at sende `.mouseMoved`
    /// mens knappen er nede. Systemet skelner, og programmet ser da en markoer
    /// der svaever, ikke et traek. Det SKAL vaere `.leftMouseDragged`.
    ///
    /// ⛔ Og et traek i ét spring virker heller ikke: Finder og de fleste
    /// lister kraever at markoeren faktisk bevaeger sig et stykke, og at der
    /// gaar lidt tid, foer de accepterer at et traek er begyndt. Derfor
    /// mellemskridt med pause imellem.
    enum TraekUdfald { case faerdig, ikkeBegyndt, stoppet }
    static func drag(fromX: Double, fromY: Double, toX: Double, toY: Double,
                     steps: Int, holdMs: Int) -> TraekUdfald {
        let start = CGPoint(x: fromX, y: fromY)
        let slut = CGPoint(x: toX, y: toY)
        let n = max(2, min(steps, 200))

        if stopVenter { return .ikkeBegyndt }   // R49: et stop under opslagene - intet sendes
        move(x: fromX, y: fromY)
        usleep(30_000)
        if stopVenter { return .ikkeBegyndt }   // R49 (Opus MAALT 15/15): ellers blev det et klik paa startpunktet
        post(CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown,
                     mouseCursorPosition: start, mouseButton: .left))
        // Ventetiden er ikke pynt: mange lister begynder foerst at traekke naar
        // knappen har vaeret nede et oejeblik paa samme sted.
        // S2b: ventetiden deles op, saa et stop ses inden for 10 ms - og knappen slippes, hvor den er.
        var holdt = max(0, min(holdMs, 2000))
        while holdt > 0 {
            if stopVenter { slipKnap(start, start); return .stoppet }
            let bid = min(holdt, 10); usleep(UInt32(bid * 1000)); holdt -= bid
        }
        var her = start
        for i in 1...n {
            if stopVenter { slipKnap(her, start); return .stoppet }
            let t = Double(i) / Double(n)
            let p = CGPoint(x: fromX + (toX - fromX) * t, y: fromY + (toY - fromY) * t)
            post(CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged,
                         mouseCursorPosition: p, mouseButton: .left))
            her = p
            usleep(12_000)
        }

        // Et kort ophold paa maalet, saa modtageren naar at markere sig selv
        // som drop-omraade foer knappen slippes.
        usleep(60_000)
        if stopVenter { slipKnap(slut, start); return .stoppet }   // R50 (Opus N4): ogsaa i opholdet paa maalet
        post(CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp,
                     mouseCursorPosition: slut, mouseButton: .left))
        return .faerdig
    }
    /// S2b: et stoppet traek maa aldrig efterlade knappen nede. R49 (Opus R3): det traekkes tilbage til
    /// startpunktet foer knappen slippes - saa det ikke bliver et slip paa et tilfaeldigt mellempunkt (en fil i
    /// en forkert mappe). Stoppes det under holdet, er ned+op paa startpunktet et klik dér (kendt graense).
    static func slipKnap(_ her: CGPoint, _ start: CGPoint) {
        let n = 8
        if her != start {
            for i in 1...n {
                let t = Double(i) / Double(n)
                post(CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged,
                             mouseCursorPosition: CGPoint(x: her.x + (start.x - her.x) * t, y: her.y + (start.y - her.y) * t), mouseButton: .left))
                usleep(8_000)
            }
        }
        post(CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: start, mouseButton: .left))
    }

    /// ⛔ MAALT 10/10: et rul til et programs koe uden punkt bar markoerens plads - menneskets -
    ///    og landede ikke i et program bagved (svaret var «ok»). Med et punkt og vinduet (felt
    ///    51/58, som klikket) lander det dér, uden at markoeren flytter sig.
    static func scroll(dx: Int, dy: Int, tilPid: pid_t? = nil, punkt: CGPoint? = nil, vindue: Int? = nil) {
        let e = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2,
                        wheel1: Int32(dy), wheel2: Int32(dx), wheel3: 0)
        if let p = punkt { e?.location = p }
        if let v = vindue, tilPid != nil { e?.setIntegerValueField(FELT_VINDUE, value: Int64(v)); e?.setIntegerValueField(FELT_VINDUESPUNKT, value: 1) }
        post(e, tilPid)
    }

    /// Skriver tekst som Unicode direkte i haendelsen i stedet for at slaa
    /// tastekoder op. Det er den eneste maade der virker ens paa dansk,
    /// tysk og amerikansk tastatur - en tastekode-tabel ville skrive noget
    /// andet end det agenten bad om, alt efter brugerens layout.
    /// Hvilket program har tastaturet LIGE NU? Slaaet op live i tilgaengeligheds-
    /// laget; NSWorkspace kan vaere forældet i et program uden koerende haendelsesloekke.
    static func fokuseretPid() -> pid_t? {
        let sys = AXUIElementCreateSystemWide()
        AXUIElementSetMessagingTimeout(sys, 1.0)
        var v: CFTypeRef?
        guard AXUIElementCopyAttributeValue(sys, kAXFocusedApplicationAttribute as CFString, &v) == .success,
              let el = v, CFGetTypeID(el) == AXUIElementGetTypeID() else { return nil }
        var pid: pid_t = 0
        return AXUIElementGetPid(el as! AXUIElement, &pid) == .success ? pid : nil
    }

    /// Returnerer hvor mange tegn der blev sendt.
    ///
    /// ⛔ ASTRA runde 2 (25/9): uden modtager gaar hvert tegn i den globale stroem.
    ///    Porten genmaaler det forreste program lige foer - men ved `cps: 1` tager
    ///    en tekst minutter, og skifter mennesket program imens, faar det nye
    ///    program resten. Nu kontrolleres modtageren foer hvert tegn; har den
    ///    skiftet (eller kan ikke bekraeftes), stopper skrivningen.
    ///
    /// ⛔ `stop` spoerges foer HVERT tegn (29/9): et Tab i «bruger\tkode», et klik
    ///    eller et felt der selv hopper videre kan flytte fokus ind i et
    ///    kodeordsfelt midt i teksten. Et tjek kun ved start lod resten lande dér.
    @discardableResult
    static func type(_ text: String, cps: Int, tilPid: pid_t? = nil, stop: (() -> Bool)? = nil) -> Int {
        let delay = cps > 0 ? UInt32(1_000_000 / cps) : 4000
        let globalStart = tilPid == nil ? fokuseretPid() : nil
        if tilPid == nil && globalStart == nil { return 0 }
        var sendt = 0
        var forrige: Character?
        for ch in text {
            if tilPid == nil && fokuseretPid() != globalStart { return sendt }
            // Et fokusskift tager et oejeblik; efter Tab/Enter ventes der, foer der spoerges.
            if let f = forrige, f == "\t" || f == "\n" || f == "\r" { usleep(80_000) }
            if let stop, stop() { return sendt }
            if stopVenter { return sendt }   // S2b: et stop mellem to tegn - aldrig midt i ét
            forrige = ch
            let s = String(ch)
            var utf16 = Array(s.utf16)
            if let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true) {
                down.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: &utf16)
                post(down, tilPid)
            }
            if let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) {
                up.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: &utf16)
                post(up, tilPid)
            }
            sendt += 1
            usleep(delay)
        }
        return sendt
    }

    /// Navngivne taster. Bevidst kort liste: hver tast her er en tast en agent
    /// kan trykke paa uden at mennesket ser det, saa listen skal kunne laeses
    /// igennem paa ti sekunder af den der vurderer om det er sikkert.
    static let keyCodes: [String: CGKeyCode] = [
        "return": 36, "enter": 36, "tab": 48, "space": 49, "delete": 51, "backspace": 51,
        "escape": 53, "esc": 53, "left": 123, "right": 124, "down": 125, "up": 126,
        "home": 115, "end": 119, "pageup": 116, "pagedown": 121, "forwarddelete": 117,
        "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97,
        "f7": 98, "f8": 100, "f9": 101, "f10": 109, "f11": 103, "f12": 111,
        "a": 0, "b": 11, "c": 8, "d": 2, "e": 14, "f": 3, "g": 5, "h": 4, "i": 34,
        "j": 38, "k": 40, "l": 37, "m": 46, "n": 45, "o": 31, "p": 35, "q": 12,
        "r": 15, "s": 1, "t": 17, "u": 32, "v": 9, "w": 13, "x": 7, "y": 16, "z": 6,
        "0": 29, "1": 18, "2": 19, "3": 20, "4": 21, "5": 23, "6": 22, "7": 26, "8": 28, "9": 25
    ]

    static func hotkey(_ combo: String, tilPid: pid_t? = nil) -> Bool {
        let parts = combo.lowercased().split(separator: "+").map(String.init)
        guard let keyName = parts.last, let code = keyCodes[keyName] else { return false }
        var flags: CGEventFlags = []
        for m in parts.dropLast() {
            switch m {
            case "cmd", "command", "meta": flags.insert(.maskCommand)
            case "shift": flags.insert(.maskShift)
            case "alt", "option", "opt": flags.insert(.maskAlternate)
            case "ctrl", "control": flags.insert(.maskControl)
            case "fn": flags.insert(.maskSecondaryFn)
            default: return false
            }
        }
        let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true)
        down?.flags = flags
        post(down, tilPid)
        usleep(30_000)
        let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false)
        up?.flags = flags
        post(up, tilPid)
        return true
    }
}

/// macOS' adgangskodesignal (Secure Event Input) lige nu - se Skrivevagt.swift.
func macosSikkerIndtastning() -> Bool { IsSecureEventInputEnabled() }
