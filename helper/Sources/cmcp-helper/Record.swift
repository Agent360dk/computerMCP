import AppKit
import CoreMedia
import Foundation
import ScreenCaptureKit

/// Skaermoptagelse til en fil - til film et menneske skal se, ikke til modellen.
///
/// Tilfoejet 25/9-2026 til generalproeven (Gustav): agenten skal kunne optage
/// sig selv, mens den installerer VS Code og saetter Claude op, saa det kan
/// blive til undervisning. Tre regler, alle fra samme loefte som skaermbilledet:
///
///  1. Samme spaerreliste. Adgangskode-programmer holdes UDE af optagelsen -
///     deres pixels bliver aldrig optaget. Listen genberegnes hvert kvarte
///     sekund, saa et program der aabnes UNDER optagelsen ogsaa udelades.
///     ⚠ Det aerlige hul: i op til et kvart sekund efter det aabnes, kan det ses.
///  2. Filen gaar aldrig til modellen. Serveren svarer med stien, og den har
///     intet vaerktoej der kan laese en fil.
///  3. Den stopper af sig selv: ved sit loft, ved SIGINT/SIGTERM fra serveren,
///     og hvis serveren der startede den, forsvinder (foraelderen bliver pid 1).
///     En optagelse der loeber videre efter at agenten er vaek, er en optagelse
///     ingen har bedt om.
///
/// Kraever macOS 15 (SCRecordingOutput). Hjaelperen selv kraever 14, saa det siges.
enum Record {

    static func run(outPath: String, maxSeconds: Int, extraDeny: Set<String>, displayId: Int?, plan: Bool) {
        guard #available(macOS 15.0, *) else {
            Out.fail("screen recording needs macOS 15 or later; this Mac runs an older macOS", code: "record-needs-macos-15")
        }
        Perms.require(screen: true)
        Optagelse.koer(outPath: outPath, maxSeconds: maxSeconds, extraDeny: extraDeny, displayId: displayId, plan: plan)
    }
}

@available(macOS 15.0, *)
private final class Optagelse: NSObject, SCRecordingOutputDelegate, SCStreamDelegate, @unchecked Sendable {
    private let laas = NSLock()
    private var _fejl: String?
    private var _stream: SCStream?
    private var _display: SCDisplay?
    private var _udelukket: [String] = []
    private var _planKlar = false
    let faerdig = DispatchSemaphore(value: 0)

    var fejl: String? { laas.lock(); defer { laas.unlock() }; return _fejl }
    func saetFejl(_ s: String) { laas.lock(); if _fejl == nil { _fejl = s }; laas.unlock() }
    var stream: SCStream? { laas.lock(); defer { laas.unlock() }; return _stream }
    func saet(stream: SCStream) { laas.lock(); _stream = stream; laas.unlock() }
    var display: SCDisplay? { laas.lock(); defer { laas.unlock() }; return _display }
    func saet(display: SCDisplay) { laas.lock(); _display = display; laas.unlock() }
    var udelukket: [String] { laas.lock(); defer { laas.unlock() }; return _udelukket }
    func saet(udelukket: [String]) { laas.lock(); _udelukket = udelukket; laas.unlock() }
    var planKlar: Bool { laas.lock(); defer { laas.unlock() }; return _planKlar }
    func saetPlanKlar() { laas.lock(); _planKlar = true; laas.unlock() }

    func recordingOutputDidFinishRecording(_ recordingOutput: SCRecordingOutput) { faerdig.signal() }
    func recordingOutput(_ recordingOutput: SCRecordingOutput, didFailWithError error: Error) {
        saetFejl("the recording failed: \(error.localizedDescription)")
        faerdig.signal()
    }
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        saetFejl("the capture stopped: \(error.localizedDescription)")
        faerdig.signal()
    }

    /// Hvilke koerende programmer skal holdes ude - ALLE, ogsaa skjulte.
    ///
    /// ⛔ FABLE 25/9: et fejlet opslag gav en TOM liste - og en tom liste er et
    ///    gyldigt filter: «hold intet ude». Adgangskode-programmerne blev filmet,
    ///    og svaret sagde stadig «udeladt». `nil` betyder nu «ved det ikke», og
    ///    den der spoerger, skal selv beslutte at standse.
    static func spaerrede(_ extraDeny: Set<String>) async -> [SCRunningApplication]? {
        let spaerret = AX.defaultDenyBundles.union(extraDeny).map { $0.lowercased() }
        guard let alle = try? await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false) else { return nil }
        return alle.applications.filter { spaerret.contains($0.bundleIdentifier.lowercased()) }
    }

    static func koer(outPath: String, maxSeconds: Int, extraDeny: Set<String>, displayId: Int?, plan: Bool) {
        let o = Optagelse()
        let klar = DispatchSemaphore(value: 0)
        Task {
            do {
                let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
                let skaerme = content.displays
                let oensket = displayId.map { UInt32($0) } ?? CGMainDisplayID()
                guard let display = skaerme.first(where: { $0.displayID == oensket }) ?? (displayId == nil ? skaerme.first : nil) else {
                    o.saetFejl(displayId != nil
                        ? "no screen with id \(displayId!) - run 'displays' to see which ones exist"
                        : "no screen to record")
                    klar.signal(); return
                }
                o.saet(display: display)
                guard let udelukkes = await spaerrede(extraDeny) else {
                    o.saetFejl("could not check which apps to leave out of the recording, so it did not start")
                    klar.signal(); return
                }
                o.saet(udelukket: udelukkes.map { $0.bundleIdentifier }.sorted())
                if plan { o.saetPlanKlar(); klar.signal(); return }

                let filter = SCContentFilter(display: display, excludingApplications: udelukkes, exceptingWindows: [])
                let cfg = SCStreamConfiguration()
                let mode = CGDisplayCopyDisplayMode(display.displayID)
                cfg.width = mode?.pixelWidth ?? display.width
                cfg.height = mode?.pixelHeight ?? display.height
                cfg.minimumFrameInterval = CMTime(value: 1, timescale: 30)
                cfg.showsCursor = true
                let stream = SCStream(filter: filter, configuration: cfg, delegate: o)
                let rcfg = SCRecordingOutputConfiguration()
                rcfg.outputURL = URL(fileURLWithPath: outPath)
                rcfg.outputFileType = .mov
                let ud = SCRecordingOutput(configuration: rcfg, delegate: o)
                try stream.addRecordingOutput(ud)
                try await stream.startCapture()
                o.saet(stream: stream)
                klar.signal()
            } catch {
                o.saetFejl("the recording could not start: \(error.localizedDescription). This is usually Screen Recording permission.")
                klar.signal()
            }
        }
        if klar.wait(timeout: .now() + 30) == .timedOut {
            Out.fail("the recording did not start within 30 seconds", code: "record-timeout")
        }
        if let f = o.fejl { Out.fail(f, code: "record-failed") }
        if o.planKlar {
            Out.ok(["plan": true, "recording": false, "displayId": Int(o.display?.displayID ?? 0),
                    "excluded_apps": o.udelukket, "max_seconds": maxSeconds])
        }
        guard let stream = o.stream, let display = o.display else {
            Out.fail("the recording did not start", code: "record-failed")
        }
        // Stop paa signal fra serveren. ⛔ Fable 25/9: handlerne stod EFTER start-linjen,
        // saa et stop i det oejeblik draebte hjaelperen uden at faerdiggoere filen.
        let stop = DispatchSemaphore(value: 0)
        let stopGrund = LaastTekst("time-limit")
        signal(SIGINT, SIG_IGN); signal(SIGTERM, SIG_IGN)
        let s1 = DispatchSource.makeSignalSource(signal: SIGINT, queue: .global())
        s1.setEventHandler { stopGrund.saet("requested"); stop.signal() }
        s1.resume()
        let s2 = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .global())
        s2.setEventHandler { stopGrund.saet("requested"); stop.signal() }
        s2.resume()

        let start = Date()
        // Foerste linje: startet. Serveren venter paa den, foer den svarer agenten.
        Out.linje(["ok": true, "recording": true, "path": outPath, "displayId": Int(display.displayID),
                   "excluded_apps": o.udelukket, "max_seconds": maxSeconds])

        // Hvert kvarte sekund: er serveren vaek? er et nyt spaerret program startet?
        // ⛔ FABLE 25/9 (runde 2): en langsom opdatering kunne lande EFTER en nyere og
        //    rulle filteret tilbage - og saa proevede ingen igen, fordi listen «var
        //    uaendret». Nu koerer hoejst én opdatering ad gangen, og hver opdatering
        //    laegger den liste paa, den selv har slaaet op lige nu.
        var sidst = o.udelukket
        let iGang = LaastFlag()
        let nyListe = LaastListe()
        let fejlISte = LaastTal()
        var opslagStartet = Date()
        let slut = Date().addingTimeInterval(TimeInterval(maxSeconds))
        while Date() < slut {
            if stop.wait(timeout: .now() + .milliseconds(250)) == .success { break }
            if getppid() == 1 { stopGrund.saet("server-gone"); break }
            if o.fejl != nil { stopGrund.saet("error"); break }
            if let ids = nyListe.tag() { sidst = ids; o.saet(udelukket: Array(Set(o.udelukket).union(ids)).sorted()) }
            if iGang.vaerdi {
                // Et opslag der haenger, er et opslag vi ikke kan stole paa: to sekunder
                // uden svar, og optagelsen stopper. Det er loftet docs lover.
                if Date().timeIntervalSince(opslagStartet) > 2 {
                    o.saetFejl("could not check which apps to leave out of the recording for two seconds, so it was stopped")
                }
                continue
            }
            iGang.saet(true)
            opslagStartet = Date()
            let foer = sidst
            // ⛔ FABLE 25/9: `try?` slugte en fejlet filteropdatering, og svaret sagde
            //    alligevel «udeladt» om et program der stadig blev filmet. Nu gaelder listen
            //    kun naar filteret ER lagt paa; og kan et NYT spaerret program ikke holdes
            //    ude, stopper optagelsen. At filme en adgangskode-app er ikke en mulighed.
            Task {
                defer { iGang.saet(false) }
                guard let udelukkes = await Optagelse.spaerrede(extraDeny) else {
                    // Ved det ikke = kan ikke love det. Et sekund uden svar, og optagelsen stopper.
                    if fejlISte.oeg() >= 4 {
                        o.saetFejl("could not check which apps to leave out of the recording for about a second, so it was stopped")
                    }
                    return
                }
                fejlISte.nulstil()
                let ids = udelukkes.map { $0.bundleIdentifier }.sorted()
                if ids == foer {
                    nyListe.saet(ids)
                } else {
                    do {
                        try await stream.updateContentFilter(
                            SCContentFilter(display: display, excludingApplications: udelukkes, exceptingWindows: []))
                        nyListe.saet(ids)
                    } catch {
                        let nye = Set(ids).subtracting(foer)
                        if !nye.isEmpty {
                            o.saetFejl("could not leave \(nye.sorted().joined(separator: ", ")) out of the recording, so it was stopped")
                        }
                    }
                }
            }
        }

        let stoppet = DispatchSemaphore(value: 0)
        Task { try? await stream.stopCapture(); stoppet.signal() }
        _ = stoppet.wait(timeout: .now() + 10)
        // ⛔ Fable 25/9: udloeb ventetiden, svarede den «ok» om en fil der ikke var
        //    faerdigskrevet - og en .mov uden sin afslutning kan ofte ikke afspilles.
        let faerdigskrevet = o.faerdig.wait(timeout: .now() + 15) == .success
        let sekunder = Date().timeIntervalSince(start)
        let stoerrelse = (try? FileManager.default.attributesOfItem(atPath: outPath)[.size] as? Int) ?? 0
        if let f = o.fejl, stoerrelse == 0 { Out.fail(f, code: "record-failed", extra: ["path": outPath]) }
        guard stoerrelse > 0 else {
            Out.fail("the recording stopped but no file was written", code: "record-failed", extra: ["path": outPath])
        }
        guard faerdigskrevet else {
            Out.fail("the recording stopped but the file was not finished, so it may not play", code: "record-unfinished",
                     extra: ["path": outPath, "bytes": stoerrelse])
        }
        var svar: [String: Any] = ["recording": false, "path": outPath, "seconds": Int(sekunder.rounded()), "bytes": stoerrelse,
                                   "stopped_by": stopGrund.vaerdi, "excluded_apps": o.udelukket]
        // En fejl midtvejs efterlader en brugbar fil op til fejlen - men svaret siger hvorfor den stoppede.
        if let f = o.fejl { svar["error"] = f }
        Out.ok(svar)
    }
}

private final class LaastTekst: @unchecked Sendable {
    private let laas = NSLock()
    private var v: String
    init(_ v: String) { self.v = v }
    func saet(_ ny: String) { laas.lock(); v = ny; laas.unlock() }
    var vaerdi: String { laas.lock(); defer { laas.unlock() }; return v }
}

private final class LaastListe: @unchecked Sendable {
    private let laas = NSLock()
    private var v: [String]?
    func saet(_ ny: [String]) { laas.lock(); v = ny; laas.unlock() }
    /// Henter den nyeste liste og toemmer pladsen, saa den samme liste aldrig bruges to gange.
    func tag() -> [String]? { laas.lock(); defer { v = nil; laas.unlock() }; return v }
}

private final class LaastFlag: @unchecked Sendable {
    private let laas = NSLock()
    private var v = false
    func saet(_ ny: Bool) { laas.lock(); v = ny; laas.unlock() }
    var vaerdi: Bool { laas.lock(); defer { laas.unlock() }; return v }
}

private final class LaastTal: @unchecked Sendable {
    private let laas = NSLock()
    private var v = 0
    func oeg() -> Int { laas.lock(); defer { laas.unlock() }; v += 1; return v }
    func nulstil() { laas.lock(); v = 0; laas.unlock() }
}
