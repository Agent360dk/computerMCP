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
    /// med et saadant vindue er ikke et loefte.
    static func run(
        outPath: String,
        bundleId: String?,
        redact: Bool,
        extraDeny: Set<String>,
        maxWidth: Int?
    ) {
        Perms.require(screen: true)
        if redact { Perms.require(accessibility: true) }

        let sem = DispatchSemaphore(value: 0)
        var captured: CGImage?
        var failure: String?
        var pointSize = CGSize.zero

        Task {
            do {
                let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
                guard let display = content.displays.first else {
                    failure = "ingen skaerm fundet"; sem.signal(); return
                }
                pointSize = CGSize(width: display.width, height: display.height)

                let filter: SCContentFilter
                if let bid = bundleId {
                    let apps = content.applications.filter {
                        $0.bundleIdentifier == bid || $0.applicationName.lowercased() == bid.lowercased()
                    }
                    guard !apps.isEmpty else {
                        failure = "programmet '\(bid)' koerer ikke"; sem.signal(); return
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

                captured = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: cfg)
            } catch {
                failure = "optagelse fejlede: \(error.localizedDescription)"
            }
            sem.signal()
        }

        // 20 sekunder. Haenger ScreenCaptureKit, skal vi fejle synligt og ikke
        // efterlade agenten i en tavs venteposition.
        if sem.wait(timeout: .now() + 20) == .timedOut {
            Out.fail("optagelsen svarede ikke inden for 20 sekunder", code: "capture-timeout")
        }
        if let f = failure { Out.fail(f, code: "capture-failed") }
        guard var image = captured else { Out.fail("intet billede", code: "capture-empty") }

        // Skalafaktor: AX regner i punkter, billedet er i pixels.
        let scale = pointSize.width > 0 ? Double(image.width) / Double(pointSize.width) : 1.0

        var redactedCount = 0
        if redact {
            let rects = AX.secureRects(scopeBundleId: bundleId, extraDeny: extraDeny)
            redactedCount = rects.count
            if !rects.isEmpty {
                image = paintOver(image, rects: rects, scale: scale)
            }
        }

        if let mw = maxWidth, image.width > mw {
            image = downscale(image, toWidth: mw) ?? image
        }

        guard write(image, to: outPath) else {
            Out.fail("kunne ikke skrive \(outPath)", code: "write-failed")
        }

        Out.ok([
            "path": outPath,
            "width": image.width,
            "height": image.height,
            "redacted": redact,
            "redactedRegions": redactedCount,
            "scope": bundleId ?? "screen"
        ])
    }

    /// Sloerer en FIL der allerede findes, med rektangler man selv angiver.
    /// Bruges til at sloere et skaermbillede man har i forvejen - og det er
    /// samtidig den vej proeverne gaar ind ad, saa sloeringen kan bevises paa
    /// et billede vi selv har lavet, uafhaengigt af hvad der stod paa skaermen.
    static func redactFile(inPath: String, outPath: String, rects: [Rect], scale: Double) {
        guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: inPath) as CFURL, nil),
              let image = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
            Out.fail("kunne ikke laese \(inPath)", code: "read-failed")
        }
        let done = paintOver(image, rects: rects, scale: scale)
        guard write(done, to: outPath) else { Out.fail("kunne ikke skrive \(outPath)", code: "write-failed") }
        Out.ok(["path": outPath, "width": done.width, "height": done.height, "redactedRegions": rects.count])
    }

    /// Maler uigennemsigtige felter over rektanglerne. Ikke sloering, ikke pixelering -
    /// sort. Pixelering kan vendes om af en model der er god nok; sort kan ikke.
    private static func paintOver(_ image: CGImage, rects: [Rect], scale: Double) -> CGImage {
        let w = image.width, h = image.height
        guard let ctx = CGContext(
            data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return image }

        ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        ctx.setFillColor(CGColor(red: 0, green: 0, blue: 0, alpha: 1))

        for r in rects {
            // AX har (0,0) oeverst til venstre og y nedad. CGContext har (0,0)
            // nederst til venstre og y opad. Uden denne vending sloerer vi det
            // spejlvendte sted paa skaermen - og efterlader adgangskoden synlig
            // mens vi maler hen over noget harmloest. Derfor er der en proeve
            // for netop denne vending.
            let px = r.x * scale
            let pw = r.w * scale
            let ph = r.h * scale
            let py = Double(h) - (r.y * scale) - ph
            // 4 pixels luft, saa en afrundingsfejl ikke efterlader en stribe tekst.
            ctx.fill(CGRect(x: px - 4, y: py - 4, width: pw + 8, height: ph + 8))
        }
        return ctx.makeImage() ?? image
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
