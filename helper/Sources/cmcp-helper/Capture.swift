import AppKit
import CoreGraphics
import Foundation
import ScreenCaptureKit
import UniformTypeIdentifiers

enum Capture {

    /// Tager et skaermbillede, sloerer hemmelighederne og skriver PNG.
    ///
    /// Raekkefoelgen er hele pointen og er ikke til forhandling:
    ///
    ///     optag -> find rektangler -> mal dem sorte -> SAA skriv filen
    ///
    /// Det uredigerede billede eksisterer kun som CGImage i denne proces'
    /// hukommelse og bliver aldrig skrevet nogen steder. Havde vi skrevet
    /// filen foerst og sloeret bagefter, ville der vaere et vindue - maalt i
    /// millisekunder, men reelt - hvor brugerens adgangskode laa paa disken i
    /// klartekst, hvor enhver anden proces kunne laese den. Et sikkerhedsloefte
    /// ⛔ MAALT 19/9: `content.displays` har IKKE stabil raekkefoelge. Inden for
    /// EEN koersel, sekunder mellem to kald, pegede indeks 0 paa to forskellige
    /// skaerme. Et indeks er derfor ikke et gyldigt haandtag - `displayID` er.
    /// Denne liste er den billige vej til at se hvad der findes: ingen billeder,
    /// ingen skaermoptagelse ud over den tilladelse der allerede er givet.
    static func listDisplays() {
        let sem = DispatchSemaphore(value: 0)
        let box = ResultBox()
        Task {
            do {
                let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
                var samlet: [[String: Any]] = []
                for (i, d) in content.displays.enumerated() {
                    samlet.append([
                        "index": i,
                        "id": Int(d.displayID),
                        "x": Int(d.frame.origin.x),
                        "y": Int(d.frame.origin.y),
                        "width": d.width,
                        "height": d.height,
                        "main": d.frame.origin == .zero
                    ])
                }
                box.set(skaerme: samlet)
            } catch {
                box.set(failure: "could not read the screens: \(error.localizedDescription)")
            }
            sem.signal()
        }
        _ = sem.wait(timeout: .now() + 20)
        if let f = box.failure { Out.fail(f, code: "displays-failed") }
        let ud = box.skaerme
        Out.ok(["displays": ud, "count": ud.count,
                "note": "The order is NOT stable. Use id, not index."])
    }

    /// med et saadant vindue er ikke et loefte.
    static func run(
        outPath: String,
        bundleId: String?,
        redact: Bool,
        extraDeny: Set<String>,
        maxWidth: Int?,
        displayIndex: Int?,
        displayId: Int?
    ) {
        Perms.require(screen: true)
        if redact { Perms.require(accessibility: true) }

        let sem = DispatchSemaphore(value: 0)
        // Resultatet laegges i en laast kasse i stedet for i lokale variabler.
        //
        // Taskens krop koerer paa en anden traad, og at skrive direkte i
        // variabler fra den omkringliggende funktion er en datakapløb. Min egen
        // Mac oversatte det uden at kny; byggekoereren med strengere
        // samtidighedstjek afviste det med fem fejl. Da README'en beder folk
        // bygge fra kilden, var oversaettelsen altsaa i stykker for alle med en
        // aeldre Swift end min - og det opdagede jeg kun fordi CI'en findes.
        let box = ResultBox()

        Task {
            do {
                let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
                // ⛔ MAALT 19/9 paa en Mac med TRE skaerme: her stod
                //    `content.displays.first`, og det betoed at to tredjedele af
                //    skrivebordet var usynligt for computer_screenshot - uden fejl,
                //    og uden at svaret naevnte det med et ord. Agenten fik en
                //    optagelse der hed "the screen" og var een af tre.
                //
                //    Standarden er stadig den foerste skaerm, saa intet skifter for
                //    nogen med een. Men antallet staar nu ALTID i svaret, og
                //    --display vaelger en anden. En agent der ikke kan finde et
                //    vindue, kan nu se at der er flere steder at lede.
                let alle = content.displays
                guard !alle.isEmpty else {
                    box.set(failure: "no screen found"); sem.signal(); return
                }
                // Et id slaar altid et indeks: indekset kan have skiftet siden sidste kald.
                var valgt = displayIndex ?? 0

                // ⛔ FUNDET 22/9. `screenshot --app X` fejlede med «optagelse
                //    fejlede: Kunne ikke starte streaming» mens `--displayId`
                //    virkede fint paa samme maskine. Aarsagen: naar et program
                //    navngives, bygges filtret som (DEN VALGTE SKAERM, kun det
                //    program) - og den valgte skaerm var skaerm 0, mens
                //    programmets vinduer stod paa en anden. Et filter uden
                //    noget indhold faar ScreenCaptureKit til at fejle med en
                //    besked der intet siger om aarsagen.
                //
                //    Paa en maskine med én skaerm sker det aldrig. Gustav har
                //    tre, og saa er det to ud af tre gange.
                //
                //    Naar ingen skaerm er valgt udtrykkeligt, finder vi den
                //    skaerm programmets foerste vindue faktisk staar paa.
                if displayId == nil && displayIndex == nil, let bid = bundleId,
                   let app = AX.allApps().first(where: {
                       $0.bundleIdentifier == bid || $0.localizedName?.lowercased() == bid.lowercased()
                   }),
                   let w = AX.windows(of: app).first,
                   let r = AX.frame(w) {
                    let midt = CGPoint(x: r.x + r.w / 2, y: r.y + r.h / 2)
                    if let i = alle.firstIndex(where: { $0.frame.contains(midt) }) { valgt = i }
                }

                if let oensketId = displayId {
                    guard let i = alle.firstIndex(where: { Int($0.displayID) == oensketId }) else {
                        box.set(failure: "no screen with id \(oensketId) - run 'displays' to see which ones exist")
                        sem.signal(); return
                    }
                    valgt = i
                }
                guard valgt >= 0 && valgt < alle.count else {
                    box.set(failure: "screen \(valgt) does not exist - this machine has \(alle.count)")
                    sem.signal(); return
                }
                let display = alle[valgt]
                // ⛔ Origo er ikke pynt. computer_click regner i GLOBALE punkter.
                //    Et billede af skaerm 1 har sit eget (0,0) oeverst til venstre,
                //    men den skaerm begynder maaske ved x=1920 paa skrivebordet.
                //    Uden origo ville en agent dividere med pixelsPerPoint, klikke -
                //    og ramme den forkerte skaerm. Det er samme fejlklasse som den
                //    manglende maalestok, bare en skaerm forskudt i stedet for 600 punkter.
                box.set(displays: alle.count, displayIndex: valgt,
                        origin: display.frame.origin, displayId: Int(display.displayID))
                box.set(pointSize: CGSize(width: display.width, height: display.height))

                let filter: SCContentFilter
                if let bid = bundleId {
                    let apps = content.applications.filter {
                        $0.bundleIdentifier == bid || $0.applicationName.lowercased() == bid.lowercased()
                    }
                    guard !apps.isEmpty else {
                        // MAALT 18/9: her stod "the app is not running", og det var
                        // en loegn i det tilfaelde der faktisk sker. Et program med
                        // et vindue paa en ANDEN Space koerer udmaerket - det er
                        // bare ikke i SCShareableContents liste, fordi den kun
                        // daekker den Space der er fremme.
                        //
                        // Den forkerte besked sender folk ud at lede efter et
                        // program der staar lige for naesen af dem. Vi spoerger
                        // arbejdsbordet i stedet og siger hvad der faktisk er galt.
                        let running = AX.allApps().contains {
                            $0.bundleIdentifier == bid || $0.localizedName?.lowercased() == bid.lowercased()
                        }
                        box.set(failure: running
                            ? "'\(bid)' is running, but has no windows on the desktop that is showing. A full-screen app gives itself its own desktop, and everything else sits on another. Switch to it with computer_activate or computer_space, or leave full screen."
                            : "the app '\(bid)' is not running")
                        sem.signal(); return
                    }
                    filter = SCContentFilter(display: display, including: apps, exceptingWindows: [])
                } else {
                    filter = SCContentFilter(display: display, excludingWindows: [])
                }

                let cfg = SCStreamConfiguration()
                cfg.width = display.width * 2
                cfg.height = display.height * 2
                cfg.capturesAudio = false
                cfg.showsCursor = false

                box.set(image: try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: cfg))
            } catch {
                // ⛔ MAALT 23/9: her slap macOS' EGEN fejltekst ud til modellen -
                //    paa maskinens sprog («Kunne ikke starte streaming pga. fejl
                //    ved lyd-/video-optagelse»). To ting galt: produktet taler
                //    engelsk, og den besked siger ikke hvad man goer nu.
                //    Et program der koerer uden vindue paa den viste skaerm er
                //    det almindelige tilfaelde, og det har et svar: laes det i
                //    stedet for at fotografere det.
                let raa = error.localizedDescription
                if let bid = bundleId {
                    box.set(failure: "'\(bid)' could not be captured: it has no window on the desktop that is showing, "
                        + "so there is nothing to photograph. Read it with computer_inspect instead, or bring it forward "
                        + "with computer_activate first. (macOS said: \(raa))")
                } else {
                    box.set(failure: "the screen could not be captured (macOS said: \(raa)). "
                        + "This is usually Screen Recording permission, or a display that just went away.")
                }
            }
            sem.signal()
        }

        // 20 sekunder. Haenger ScreenCaptureKit, skal vi fejle synligt og ikke
        // efterlade agenten i en tavs venteposition.
        if sem.wait(timeout: .now() + 20) == .timedOut {
            Out.fail("the capture did not answer within 20 seconds", code: "capture-timeout")
        }
        let failure = box.failure
        let pointSize = box.pointSize
        let captured = box.image
        if let f = failure { Out.fail(f, code: "capture-failed") }
        guard var image = captured else { Out.fail("the capture returned no image at all", code: "capture-empty") }

        // Skalafaktor: AX regner i punkter, billedet er i pixels.
        let scale = pointSize.width > 0 ? Double(image.width) / Double(pointSize.width) : 1.0

        var redactedCount = 0
        var ufuldstaendig: [String] = []
        if redact {
            let omraade = Rect(x: Double(box.origin.x), y: Double(box.origin.y),
                               w: Double(pointSize.width), h: Double(pointSize.height))
            let rects = AX.secureRects(scopeBundleId: bundleId, extraDeny: extraDeny, indenfor: omraade)
            redactedCount = rects.count
            ufuldstaendig = AX.sloeringStoppede
            if !rects.isEmpty {
                guard let malet = paintOver(image, rects: rects, scale: scale, origin: box.origin) else {
                    Out.fail("could not paint over the \(rects.count) region(s) that must be blacked out, so no screenshot was written. An unredacted one is never written.",
                             code: "redaction-failed")
                }
                image = malet
            }
        }

        if let mw = maxWidth, image.width > mw {
            image = downscale(image, toWidth: mw) ?? image
        }

        guard write(image, to: outPath) else {
            Out.fail("could not write \(outPath)", code: "write-failed")
        }

        // Punktstoerrelsen SKAL med.
        //
        // MAALT 18/9: uden --max-width er billedet 3420x2214 pixels mens
        // skaermen er 1710x1107 punkter. computer_click regner i PUNKTER.
        // En model der laeser x=1200 af billedet og klikker der, rammer 600
        // punkter forkert - den halve skaerm - og faar ingen fejl, den rammer
        // bare noget andet. Vi fortalte billedets stoerrelse og fortav den
        // maalestok der skulle til for at bruge den.
        let finalScale = pointSize.width > 0 ? Double(image.width) / Double(pointSize.width) : 1.0
        Out.ok([
            "path": outPath,
            "width": image.width,
            "height": image.height,
            "screenWidthPoints": Int(pointSize.width),
            "screenHeightPoints": Int(pointSize.height),
            "pixelsPerPoint": (finalScale * 1000).rounded() / 1000,
            "clickHint": "computer_click works in POINTS. Divide a coordinate taken from this image by pixelsPerPoint before you click.",
            "displays": box.displays,
            "displayIndex": box.displayIndex,
            "displayId": box.displayId,
            "redaction_whole_window": ufuldstaendig.isEmpty ? nil : Array(Set(ufuldstaendig)) as Any,
            "redaction_note": ufuldstaendig.isEmpty ? nil : "The redaction scan ran out of time in \(Set(ufuldstaendig).joined(separator: ", ")), so the WHOLE window was blacked out rather than risk leaving a password field visible. Screenshot one app instead, or a display those windows are not on." as Any,
            "displayOriginX": Int(box.origin.x),
            "displayOriginY": Int(box.origin.y),
            "redacted": redact,
            "redactedRegions": redactedCount,
            "scope": bundleId ?? "screen"
        ])
    }

    /// Sloerer en FIL der allerede findes, med rektangler man selv angiver.
    /// Bruges til at sloere et skaermbillede man har i forvejen - og det er
    /// samtidig den vej proeverne gaar ind ad, saa sloeringen kan bevises paa
    /// et billede vi selv har lavet, uafhaengigt af hvad der stod paa skaermen.
    static func redactFile(inPath: String, outPath: String, rects: [Rect], scale: Double,
                           origin: CGPoint = .zero) {
        guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: inPath) as CFURL, nil),
              let image = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
            Out.fail("could not read \(inPath)", code: "read-failed")
        }
        guard let done = paintOver(image, rects: rects, scale: scale, origin: origin) else {
            Out.fail("could not paint over the \(rects.count) region(s), so nothing was written. An unredacted image is never written.",
                     code: "redaction-failed")
        }
        guard write(done, to: outPath) else { Out.fail("could not write \(outPath)", code: "write-failed") }
        Out.ok(["path": outPath, "width": done.width, "height": done.height, "redactedRegions": rects.count])
    }

    /// Maler uigennemsigtige felter over rektanglerne. Ikke sloering, ikke pixelering -
    /// sort. Pixelering kan vendes om af en model der er god nok; sort kan ikke.
    ///
    /// ⛔ FEJLEDE AABENT - FUNDET AF EN SIKKERHEDSGENNEMGANG 24/9.
    ///    Her stod `else { return image }` og `ctx.makeImage() ?? image`. Kunne
    ///    tegneomraadet ikke oprettes, eller billedet ikke laves bagefter, fik
    ///    kalderen det USVAERTEDE billede tilbage - og skrev det. Produktets
    ///    foerste loefte, brudt i stilhed, og netop under hukommelsespres, som
    ///    er dér et tegneomraade fejler (maskinen har haft hukommelses-panics).
    ///    Nu: nil. Kalderen skriver saa INTET billede. En afvisning kan ikke laekke.
    ///    `CMCP_TEST_PAINT_FAIL=1` tvinger fejlvejen, saa den kan proeves uden at
    ///    presse maskinen. Den kan kun goere et kald til en afvisning.
    private static func paintOver(_ image: CGImage, rects: [Rect], scale: Double,
                                  origin: CGPoint = .zero) -> CGImage? {
        if ProcessInfo.processInfo.environment["CMCP_TEST_PAINT_FAIL"] == "1" { return nil }
        let w = image.width, h = image.height
        guard let ctx = CGContext(
            data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return nil }

        ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        ctx.setFillColor(CGColor(red: 0, green: 0, blue: 0, alpha: 1))

        for r in rects {
            // AX har (0,0) oeverst til venstre og y nedad. CGContext har (0,0)
            // nederst til venstre og y opad. Uden denne vending sloerer vi det
            // spejlvendte sted paa skaermen - og efterlader adgangskoden synlig
            // mens vi maler hen over noget harmloest. Derfor er der en proeve
            // for netop denne vending.
            // ⛔ FUNDET AF PANELET 19/9, og det var en AEGTE laekvej.
            //    Rektanglerne er GLOBALE punkter; billedet har sit eget (0,0) i
            //    skaermens hjoerne. Uden at traekke origo fra maler vi det
            //    forkerte sted paa enhver skaerm der ikke starter i (0,0) - og
            //    lader adgangskoden staa synlig mens vi sortner noget harmloest.
            //    MAALT samme dag: skaermene ligger paa (-1920,27) og (-3840,27).
            //
            //    Den var utilgaengelig indtil i formiddags, hvor JEG tilfoejede
            //    `displayId` og dermed gjorde en sekundaer skaerm valgbar. En ny
            //    evne gjorde en sovende fejl naaelig.
            let px = (r.x - Double(origin.x)) * scale
            let pw = r.w * scale
            let ph = r.h * scale
            let py = Double(h) - ((r.y - Double(origin.y)) * scale) - ph
            // 4 pixels luft, saa en afrundingsfejl ikke efterlader en stribe tekst.
            ctx.fill(CGRect(x: px - 4, y: py - 4, width: pw + 8, height: ph + 8))
        }
        return ctx.makeImage()
    }

    private static func downscale(_ image: CGImage, toWidth target: Int) -> CGImage? {
        let ratio = Double(target) / Double(image.width)
        let h = Int(Double(image.height) * ratio)
        guard let ctx = CGContext(
            data: nil, width: target, height: h, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return nil }
        ctx.interpolationQuality = .high
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: target, height: h))
        return ctx.makeImage()
    }

    private static func write(_ image: CGImage, to path: String) -> Bool {
        let url = URL(fileURLWithPath: path)
        guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
            return false
        }
        CGImageDestinationAddImage(dest, image, nil)
        return CGImageDestinationFinalize(dest)
    }
}

/// Laast kasse til at baere et resultat ud af en Task.
///
/// `@unchecked Sendable` betyder at oversaetteren ikke kan bevise sikkerheden -
/// vi paatager os den. Her er den let at holde: alt gaar gennem én laas, og
/// kassen bliver aldrig laest foer semaforen har kvitteret for at Tasken er
/// faerdig med at skrive.
final class ResultBox: @unchecked Sendable {
    private let lock = NSLock()
    private var _image: CGImage?
    private var _failure: String?
    private var _pointSize: CGSize = .zero
    private var _displays: Int = 1
    private var _displayIndex: Int = 0

    /// ⛔ CI VAR ROED I 15 KOERSLER paa grund af den liste der foer laa som en
    /// almindelig `var` uden for `Task {}`: "mutation of captured var 'ud' in
    /// concurrently-executing code". Min egen Swift accepterede det; GitHubs
    /// runner gjorde ikke - og en udgivelse derfra ville have lavet en
    /// GitHub-udgivelse UDEN binaer. Listen bor nu bag den samme laas som alt
    /// andet der krydser den graense.
    private var _skaerme: [[String: Any]] = []
    func set(skaerme: [[String: Any]]) { lock.lock(); _skaerme = skaerme; lock.unlock() }
    var skaerme: [[String: Any]] { lock.lock(); defer { lock.unlock() }; return _skaerme }

    private var _origin: CGPoint = .zero
    private var _displayId: Int = 0
    func set(displays: Int, displayIndex: Int, origin: CGPoint, displayId: Int) {
        lock.lock(); _displays = displays; _displayIndex = displayIndex
        _origin = origin; _displayId = displayId; lock.unlock()
    }
    var displayId: Int { lock.lock(); defer { lock.unlock() }; return _displayId }
    var displays: Int { lock.lock(); defer { lock.unlock() }; return _displays }
    var displayIndex: Int { lock.lock(); defer { lock.unlock() }; return _displayIndex }
    var origin: CGPoint { lock.lock(); defer { lock.unlock() }; return _origin }

    func set(image: CGImage?) { lock.lock(); _image = image; lock.unlock() }
    func set(failure: String) { lock.lock(); _failure = failure; lock.unlock() }
    func set(pointSize: CGSize) { lock.lock(); _pointSize = pointSize; lock.unlock() }

    var image: CGImage? { lock.lock(); defer { lock.unlock() }; return _image }
    var failure: String? { lock.lock(); defer { lock.unlock() }; return _failure }
    var pointSize: CGSize { lock.lock(); defer { lock.unlock() }; return _pointSize }
}
