# Electron apps

VS Code and its forks, Slack, Discord, Notion, Obsidian, Postman, WhatsApp
Desktop, Spotify. If the app is not native Cocoa, it is probably one of these,
and they behave as a family.

## First: check whether this app exposes anything at all

**Electron is not a guarantee.** Measured 18/9 on two Electron apps on the same
machine, same settings, same moment:

```
Agent360 IDE (Electron)     2000 nodes,  80 buttons
Wispr Flow   (Electron)        8 nodes,   0 buttons
Finder       (native)        103 nodes,   0 buttons at that role
```

Wispr Flow returns 8 nodes at depth 14, at depth 30, and at depth 60. It is not
a limit you can raise - the app simply does not expose its interior. Chromium
builds the accessibility tree lazily, and an Electron app can ship without ever
turning it on.

**So the first call is a census, not an action:**

```
computer_inspect --app <bundle> --depth 30 --limit 2000
```

Under about twenty nodes with no buttons means the tree is empty for you. That
is the app, not your tooling and not a bug in the server. Fall back to
screenshots plus coordinates for that app, accept that it will be more brittle,
and say so in the recipe you write for it.

An earlier version of this file said Electron apps "expose a lot of real,
pressable elements" on the strength of a single app. That was one measurement
generalised into a rule, and it was wrong for the second app we tried.

## What works when the tree IS there

**Search by role first, read the names, then narrow.** Where Electron does
expose its interior, it exposes a lot of real, pressable elements. `computer_find --app <bundle> --role AXButton`
gives you the whole surface, and it is usually more complete than a screenshot
would suggest.

**`computer_press` works.** Elements expose `AXPress` properly, so you can
press them without moving the human's mouse and without the window being
frontmost.

**Prefer `contains` over `title`.** Electron labels often carry a trailing hint
in the accessible name - a shortcut, a count, a state. `Show command menu (/)`
is one string, not two, so an exact-title match on `Show command menu` finds
nothing.

## What does not

**Exact names are rarely unique.** This is the big one, and it is not a small
effect:

```
computer_find --app <electron app> --role AXButton --limit 80
  -> 73 buttons, 73 named, 47 unique names
     "Show command menu (/)"  x10
     "Send message"           x8
     "Copy code to clipboard" x6
```

Twenty-six of seventy-three buttons share a name with another button. A
composer, a message list and a sidebar each contribute their own copy of the
same control.

So `computer_press --title "Send message"` is ambiguous far more often than it
looks, and `--first` picks one of eight essentially at random. Computer MCP
refuses an ambiguous press by default and hands back the candidates - take that
list and narrow with the frame rather than overriding it.

**Frames are how you disambiguate.** Among eight `Send message` buttons, the
one you want is nearly always the lowest on screen (the active composer) or the
one inside the frame of the panel you are working in. Read `frame` and `center`
from the find result and choose deliberately.

**Do not walk the whole tree.** Electron trees are deep and wide.
`computer_inspect` without `--app` on a machine running three Electron apps
will hit the node limit before it reaches anything you care about. Always pass
the bundle ID, and raise `depth` before you raise `limit`.

## Gotchas

**A full-screen Electron window hides every other app.** Full screen on macOS
means its own Space, and both the accessibility API and the screenshot see only
the Space in front. Every other app will report zero windows and it will look
like a broken lookup. Ours did, for half a day.

**Web content inside the app marks fields differently.** A credential field in
a native window has the *role* `AXSecureTextField`. The same field rendered in
Electron's web view has role `AXTextField` with the *subrole*
`AXSecureTextField`. Computer MCP checks both, which is why redaction covers
Electron sign-in screens - but if you are writing your own matching, check both
or you will miss every one of them.

**Names can contain the app's own content.** In a chat app, a message becomes
part of a button's accessible name, so the name can be hundreds of characters
long and change every second. Match on a stable prefix, not the whole string.

## Measured

macOS 26.4, Computer MCP 0.1.0, 18 September 2026. One Electron app
(VS Code fork) with a chat panel open:

```
knapper fundet: 73   navngivne: 73   unikke navne: 47
trykbare: 73/73
navne der gaar igen: Show command menu (/) x10, Send message x8,
                     Copy code to clipboard x6
```

For contrast, a native Finder desktop returned zero `AXButton` elements at the
same depth - native apps put their controls behind different roles, so a role
filter tuned for Electron finds nothing there. Do not carry an Electron recipe
over to a native app and conclude the tool is broken.
