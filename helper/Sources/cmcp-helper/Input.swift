import AppKit
import CoreGraphics
import Foundation

enum Input {
    private static func post(_ event: CGEvent?) {
        event?.post(tap: .cghidEventTap)
    }

    static func move(x: Double, y: Double) {
        post(CGEvent(mouseEventSource: nil, mouseType: .mouseMoved,
                     mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: .left))
    }

    static func click(x: Double, y: Double, button: String, count: Int) {
        let pt = CGPoint(x: x, y: y)
        let (down, up, btn): (CGEventType, CGEventType, CGMouseButton)
        switch button {
        case "right": (down, up, btn) = (.rightMouseDown, .rightMouseUp, .right)
        case "middle": (down, up, btn) = (.otherMouseDown, .otherMouseUp, .center)
        default: (down, up, btn) = (.leftMouseDown, .leftMouseUp, .left)
        }
        move(x: x, y: y)
        usleep(20_000)
        for i in 1...max(1, count) {
            let d = CGEvent(mouseEventSource: nil, mouseType: down, mouseCursorPosition: pt, mouseButton: btn)
            d?.setIntegerValueField(.mouseEventClickState, value: Int64(i))
            post(d)
            let u = CGEvent(mouseEventSource: nil, mouseType: up, mouseCursorPosition: pt, mouseButton: btn)
            u?.setIntegerValueField(.mouseEventClickState, value: Int64(i))
            post(u)
            usleep(40_000)
        }
    }

    static func scroll(dx: Int, dy: Int) {
        post(CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2,
                     wheel1: Int32(dy), wheel2: Int32(dx), wheel3: 0))
    }

    /// Skriver tekst som Unicode direkte i haendelsen i stedet for at slaa
    /// tastekoder op. Det er den eneste maade der virker ens paa dansk,
    /// tysk og amerikansk tastatur - en tastekode-tabel ville skrive noget
    /// andet end det agenten bad om, alt efter brugerens layout.
    static func type(_ text: String, cps: Int) {
        let delay = cps > 0 ? UInt32(1_000_000 / cps) : 4000
        for ch in text {
            let s = String(ch)
            var utf16 = Array(s.utf16)
            if let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true) {
                down.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: &utf16)
                post(down)
            }
            if let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) {
                up.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: &utf16)
                post(up)
            }
            usleep(delay)
        }
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

    static func hotkey(_ combo: String) -> Bool {
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
        post(down)
        usleep(30_000)
        let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false)
        up?.flags = flags
        post(up)
        return true
    }
}
