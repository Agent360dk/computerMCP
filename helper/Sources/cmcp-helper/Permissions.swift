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
                "Accessibility access is missing. Grant it in System Settings > Privacy & Security > Accessibility, to the app that runs the MCP server.",
                code: "missing-accessibility"
            )
        }
        if needSC && !screenRecording() {
            Out.fail(
                "Screen Recording access is missing. Grant it in System Settings > Privacy & Security > Screen & System Audio Recording, to the app that runs the MCP server.",
                code: "missing-screen-recording"
            )
        }
    }
}
