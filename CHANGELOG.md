# Changelog

Dates are the day the version was tagged. Everything here was measured before it
was written down; where a claim has a test, the test is named.

## 0.2.0

**It runs in the background, and that is the default.** What used to make that
impossible was that «takes the screen» was a property of a tool's *name*. It is
not - it is a property of the *delivery*. An event sent to the global input
stream lands in whatever window you are using; the same event delivered into one
app's own queue does not.

- **`app` on `computer_type`, `computer_key`, `computer_scroll` and
  `computer_click`.** With it the event goes into that app's queue
  (`CGEvent.postToPid`). Measured on a machine while someone was working on it:
  the text arrived in the app, the pointer stayed where they had left it, and
  the front window did not change. Clicks and scrolls take the same route and
  have not been measured that way - a mouse event carries no window number.
- **`took_screen` on every one of those four answers**, derived from what the
  server did rather than from what happened around it. The first version was
  measuring the person: it read the pointer position before and after on a
  machine where they were using the mouse. It is also in the audit log.
- **Naming the app is refused if that app is the one you are working in.** The
  quiet route is only quiet when the target is somewhere else.
- **The audit chain is written under a file lock.** Before this, each server
  process kept its own idea of where the chain left off, so two of them writing
  at once broke it - and `computer_audit` told you a line had been removed when
  none had. Breaks are now classified by position: everything after the first
  locked line must verify.
- **Dangerous key combinations ask.** `cmd+q`, `cmd+w`, `cmd+delete` and the
  rest do what `computer_quit` does, and that tool has always asked.
- **Twenty of the twenty-eight are offered in background mode**, eight of them
  writing. `computer_launch` takes `background: true` and starts the app behind
  what you are doing. `CMCP_BACKGROUND=0` adds the nine that cannot be made quiet.


**The menu bar.** A large part of macOS has no button on screen at all: File >
Export, Edit > Find, Format > Font. Without menus an agent can see those actions
and not reach them, which was the biggest single gap between what a person can
do on a Mac and what an agent could.

- **`computer_menus`** (read) returns the whole menu bar flattened to paths,
  with whether each item is enabled and its keyboard shortcut. Measured on
  Chrome: 301 items. The titles come back in the system language, which is
  exactly why reading beats guessing - on a Danish Mac the path is
  `Arkiv > Udskriv…`, and an English guess simply misses.
- **`computer_menu`** (write) chooses an item by its full path. It goes through
  the accessibility API, so like `computer_press` it reaches a window behind
  another one and never moves the pointer. Always the whole path: "Delete"
  exists in several menus.

**Menu items that look destructive ask every time, in every mode** - delete,
clear, erase, reset, trash, quit, in English or the system language. That is a
word match and can be wrong in both directions, so the dialog shows the full
path and says so; the person decides, not the word list. Mutation-proven:
remove the flag from the gate's chain and the guard goes red with
`asked=false allow=true`.

**Several displays.** `computer_screenshot` captured `displays.first` silently,
so on a Mac with three screens two thirds of the desktop was invisible with no
error. Measured and fixed: `computer_displays` (read) lists them with a stable
id, `displayId` selects one, and every screenshot answer now says how many
exist, which one it took, and where that screen starts on the desktop - without
that offset a click computed from a secondary display lands 1920 points away,
on another monitor. The display *index* is not a stable handle: it was measured
changing inside a single run, seconds apart. Use the id.

**Two tools that do not take over your screen.**

- **`computer_press`** fires an element's own accessibility action instead of
  simulating a click. It works while the window sits *behind* another one and it
  never moves the human's pointer - so an agent can finish a form while you keep
  working in a different app. Two or more matches is a refusal, not a guess.
- **`computer_find`** locates elements by role, title or substring and returns
  their frame and centre **in points**, which is the unit `computer_click` takes.
  No scale conversion, unlike a coordinate read off a screenshot.

Both were already implemented in the Swift helper and had simply never been
exposed. The website documented `computer_find` before it existed; that is fixed
in the only honest direction.

**The consent gate now judges the right app.** `computer_press` names its target,
and that name is what the always-ask rule sees. Without it, pressing "reveal
password" in 1Password would have been judged against whatever window happened to
be frontmost, and the gate would never have fired. `test/claims.mjs` claim 5
covers it, and the test is mutation-proven: revert the fix and it goes red.

**The audit log can tell agents apart.** Every line now carries a per-server
`session` mark, and `CMCP_CLIENT=<name>` puts a readable name on it. A second
chat is a second process writing to the same log; without the mark, "everything
is written down" was only true for the first one. `test/concurrent.mjs` runs two
servers through 50 interleaved writes: zero torn lines, both identifiable.
Also mutation-proven.

**Everything else a person can do at the machine.** Four gaps closed the same
day, and each one turned out to be smaller than it looked:

- **`computer_space`** switches desktop. macOS gives every full-screen window
  its own desktop, so a window an agent could not find was often simply on
  another one. It is the one tool here that deliberately moves what you are
  looking at, so it asks every time, in every mode, like quitting an app. If the
  system shortcut for switching desktops is off it says so and sends nothing
  rather than pressing a dead key, and it reports whether the desktop actually
  changed by comparing the windows on screen before and after.
- **`computer_drag`** drags a file, a row, a slider. Two details decide whether
  a drag works at all: the events must be `leftMouseDragged` and not
  `mouseMoved` - send "moved" while the button is down and the app sees a
  hovering cursor, not a drag - and it needs intermediate steps with the button
  held for a moment first, or Finder and most lists ignore it entirely. It
  reports that the drag was *sent*, never that it was accepted.
- **The Dock and the status icons** - Wi-Fi, the clock, the battery, every app
  in the Dock - were invisible, and not because they are special. They live
  *outside any window*, and the search only ever walked down through windows.
  Measured: the Dock has zero windows and 32 dock items hanging off the
  application itself; Control Center has zero windows and nine menu bar items.
  Three lines: when an app has no windows, start from the application. Nothing
  changes for apps that have them.
- **Save / Don't Save sheets** are reachable: the sheet comes back as
  `AXSheet`, its buttons carry a centre and a `pressable` flag, and searching
  for the words "Don't Save" returns exactly that one button. In read-only mode
  pressing it is refused - a sheet can throw your work away on your behalf.

**Three ways a secret could have escaped, all closed.**

- Redaction painted at **raw global coordinates**. Rectangles arrive in global
  points but an image starts at its own screen's corner, so on any display that
  does not begin at (0,0) the black box landed in the wrong place - leaving the
  password visible while blacking out something harmless. Measured on a machine
  whose screens sit at (-1920,27) and (-3840,27). It became reachable the same
  morning `displayId` made a secondary display selectable: a new capability woke
  a sleeping bug.
- The **audit log wrote secrets in the clear**. Only a short list of key names
  was masked, so the same secret survived verbatim under `contains`, `title` and
  anything nested. The first fix added more names and its own test failed it
  immediately: a list of dangerous names is a denylist and always has a hole.
  Inverted - only fields that describe *what was done* (app, role, menu path,
  key chord) are logged verbatim; every other string becomes a salted
  fingerprint, at any depth, including under names we have never seen.
- **An unredacted screenshot counted as a read.** `redact: false` was just an
  argument on a read-tier tool, so in read-only mode - the mode you choose when
  you want nothing touched - a model could ask for an image with the password
  fields visible and nobody was asked. It now raises the call to a write and
  requires consent in every mode.

**`computer_ask_user` skipped the gate entirely.** It was hidden from the tool
list in read-only mode, and hidden was mistaken for refused. The list filters;
the call handler looks up by name. Any client with a cached list could call it
and raise a dialog on the person's screen in the one mode that promises nothing
will be touched. It is now judged on mode, through the same refusal and audit
path as everything else.

**A loop guard.** An agent that cannot see why it is stuck does the same thing
again, and on a computer server every retry is a real click on someone's real
machine. The same write repeated more than ten times in a minute is refused, and
the refusal says what it saw and asks for a screenshot - sight is what a stuck
agent is missing. Scrolling, key presses and typing are exempt, because doing
those ten times is simply what a person does: a guard that fires on legitimate
repetition is worse than no guard, since the next person just turns it off. Both
directions are measured.

**The tests stopped needing your screen.** Consent used to be provable only by
showing a real dialog, so the tests that cover the gate were opt-in and
therefore almost never ran - while on this machine 323 dialogs were raised over
two days, 274 of them timing out unanswered, nearly all from test runs. The
asker is now injectable: the tests drive the real gate, the real call and the
real answer parsing through a stand-in, so they run every time and show nothing.
Exactly one fact still needs a real dialog - that macOS itself gives up after
`giving up after N` - and that is one box for two seconds, at release.

The same change fixed two things nobody had noticed: the tests were clicking at
(5,5), the Apple menu, whenever the gate failed, and they had written 539
entries into the user's own audit log - a log whose entire job is to answer
"what did the agent do on my machine".

**Two promises were never actually proven.** That the value of a secure field
never leaves the helper, and that `set_value` refuses to write into one, were
both skipped on every run: they measured whatever happened to be on screen, and
a password field rarely is. The tests now put up their own, in a fully
transparent window. Mutation-proven - without the guard the tool wrote into the
password field.

**The front page promised a signature we do not have.** It said the package
ships a *signed* universal binary; `codesign -v` says "code object is not signed
at all". It carries the ad-hoc signature macOS needs to run it, nothing more.
Corrected in all three places, with a test that now fails the build if any
surface claims otherwise. Real signing and notarization need a paid developer
account and are on the wishlist.

**It runs in the background by default.** Thirteen of the twenty-eight
tools can take over your screen - moving the pointer, sending key presses,
bringing an app forward, launching or quitting one, switching desktop, and
raising a consent dialog of our own. Out of the box those thirteen do not
exist: they are not offered, and calling one by name anyway is refused, because
hidden is not the same as refused. What is left is the quiet route - read the
accessibility tree, then act on it with `computer_press` or
`computer_set_value`, which reach a window behind another one and leave the
pointer where you put it.

A dialog would itself take the screen, so anything that would need one is
refused rather than asked - in `ask` and in `allow` alike. The refusal goes back
to the model, which puts the question in the conversation instead of on your
screen. Set `CMCP_BACKGROUND=0` if you want the other thirteen, and a typo
leaves you protected rather than exposed.

The honest limit, in the same breath: this is a promise about what *we* do.
Press a button and the app may open a window of its own. That is its choice.
And macOS has dialogs we cannot switch off - Gatekeeper the first time, and its
own screen-recording reminder.

**Still shared, and said out loud:** two servers driving coordinates at the same
moment share one pointer and one focused window, and nothing locks between them
yet. Use `computer_press` for background work.

## 0.1.0

First release. Twelve tools, three guarantees, each with a test that has been
mutation-checked:

- Secure text fields and password-manager windows are painted black on the bitmap
  **in memory**, before the PNG is written. Native fields expose the role
  `AXSecureTextField`; fields in a web page expose role `AXTextField` with the
  *subrole* `AXSecureTextField`. Both are checked - checking only the role would
  let every browser password box through.
- No write action happens until a human says yes. Password managers and terminals
  ask every single time, even in `allow` mode. An unanswered dialog refuses.
- Every call lands in an append-only log at mode 0600. Typed text is stored as a
  length and a SHA-256 prefix, never in clear.

macOS 14+. No account, no API key, no model inside it. MIT.
