import AppKit
import ApplicationServices
import CoreGraphics

enum Perms {
    /// `prompt: false` spoerger ALDRIG. Det er med vilje: en MCP-server maa ikke
    /// kunne faa en systemdialog til at poppe op midt i en agent-koersel, hvor
    /// mennesket ikke sidder og kigger. Serveren beder brugeren om at give
    /// adgang i Systemindstillinger i stedet.
    static func accessibility(prompt: Bool = false) -> Bool {
        let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: prompt] as CFDictionary
        return AXIsProcessTrustedWithOptions(opts)
    }

    static func screenRecording() -> Bool {
        CGPreflightScreenCaptureAccess()
    }

    static func report() -> [String: Any] {
        [
            "accessibility": accessibility(),
            "screenRecording": screenRecording(),
            "host": ProcessInfo.processInfo.hostName,
            "macos": ProcessInfo.processInfo.operatingSystemVersionString
        ]
    }

    /// Kraev rettigheder foer en handling. Fejler haardt og forklarende.
    static func require(accessibility needAX: Bool = false, screen needSC: Bool = false) {
        if needAX && !accessibility() {
            Out.fail(
                "Tilgaengeligheds-adgang mangler. Giv adgang i Systemindstillinger > Anonymitet og sikkerhed > Tilgaengelighed.",
                code: "missing-accessibility"
            )
        }
        if needSC && !screenRecording() {
            Out.fail(
                "Skaermoptagelses-adgang mangler. Giv adgang i Systemindstillinger > Anonymitet og sikkerhed > Skaermoptagelse.",
                code: "missing-screen-recording"
            )
        }
    }
}
