# Changelog

Dates are the day the version was tagged. Everything here was measured before it
was written down; where a claim has a test, the test is named.

## 0.2.1

The first release since 0.1.0. A `v0.2.0` tag exists on GitHub from 20
September, but that version was never published to npm; everything below is
new relative to 0.1.0.

**Typing reaches an app in the background.** `computer_type` with an `app` now
writes into the field that app has focus in and reads it back, instead of sending
keystrokes an app without a key window can drop (text sent to Finder's search
field arrived nowhere). A field that does not accept that still gets
keystrokes, and the answer says the text was not confirmed. A password field gets
nothing: `computer_type` now refuses it as `computer_set_value` always did, and
checks before every character, so a Tab in "user<Tab>password" - or a click, or a
field that moves on by itself - stops the typing at the password field.
**It says where it can be walked around.** The consent gate guards this
server's own calls; an agent with `osascript` or browser automation in its
client's allow list never reaches it. `computer_permissions` now names those
rules (Claude Code settings; other clients are not read), and SECURITY.md says
plainly what the gate is and is not.
**The screen can be lent, and taken back.** Background mode kept seven tools
out of reach unless you restarted with `CMCP_BACKGROUND=0`, per server.
`computer_request_screen` now asks in the menu bar: you lend this one agent the
screen with Touch ID for at most 15 minutes, only one agent at a time. Those
tools then appear for it, each pauses while you use the keyboard or mouse, and
`Take the screen back now` ends the loan at once. Setting `CMCP_BACKGROUND`
locks it out. Consent in the foreground now goes through the menu bar icon too
(Touch ID); the dialog is only the fallback when the icon is not running. A no in
the menu bar, a question already waiting, or an action too long to show in full
is a no - never a dialog instead.
**A message to a real person asks every time.** Until now, pressing Send in
WhatsApp went through in `allow` without anyone being asked. In messaging apps,
Send (pressed or clicked) and Return/Enter with any modifier now ask for that one
message, showing the recipient and the text read from the screen by the server.
A line break in `computer_type` is refused in chat apps, since it sends; in mail it
is a new line, and Cmd+Return / Cmd+Shift+D is the send. Web chats and webmail in
a browser count too, recognised by the window title. The recipient is the name
above the text field; if it or the text cannot be read, nothing is sent. If what
would be sent changes after the yes, nothing is sent.
**`computer_ask_user` works in background mode.** It used to be a dialog, so
background mode refused it - and an agent that hit a password or a 2FA code
could only give up. The question now waits in the menu bar icon: the whole
request, where it lands (written by the server), and `Take me there`, so it is
the person who brings the app forward. `Done` is a signal, never a consent, and
is only accepted on this kind of question.
**You see the whole action before you allow it.** The menu bar question used to
cut the action at 200 characters and the Touch ID sheet at 80, without saying so.
The full text now sits wrapped above `Allow…` (up to 4,000 characters), the sheet
says when it is shortened, and a longer action is not asked at all.
**When an app brings itself forward, the front is handed back.** Pressing a
button or a menu item can make the app bring itself to the front: "New Finder
Window" pulled Finder over the app the person was working in, and the answer
said nothing. `computer_press` and `computer_menu` now report `took_screen`, and
when the target app took the front, it is handed straight back to the app the
person was in (`gave_back`). The front is only handed back when the change was
the app's own doing: if someone pressed a key or clicked just before, it is left
where they put it and the reply says the screen changed rather than reactivating
under their hands. And taking the screen and handing it back is no longer counted
as a clean background run - the scenario reports it as `delvist`, not proven.
`computer_launch` with `background: true` does the same: measured on a clean
Mac, six of eight apps brought themselves forward as they started, before the
hide took effect. And every `took_screen` that rested on a change of front app
was blind until now: the helper read a cached value that never updated within
one call. It now asks the accessibility layer which app has focus, each time.
**A learnings file, so the tool gets better.** `computer_learning` lets the
model write down what it learned while driving the Mac: a step that said ok and
did nothing, the route that worked instead, a refusal, a missing capability. It
appends one line to `learnings.jsonl` next to the audit log - numbers and email
addresses removed - and sends nothing anywhere. The answer holds a pre-filled
GitHub issue link the person can use to share it. The instructions sent to the
model point to it right where a step did nothing.
**A greyed-out menu item says why.** App Store and Contacts switch their menus
off when they are not the front app. `computer_menu` used to answer "the app does
not allow it in this state"; it now says the app is not in front, that this
cannot be done without taking the person's screen, and to ask them to bring the
app forward (`menu-needs-front`).
**An app that runs without a window can be opened in the background.**
`computer_launch` with `background: true` on an app that is running but has no
window (the person closed it) now asks the app to show one, as a Dock click
would, without activating it. Before, it answered "already running" and left
nothing to reach. An app that already has a window is left exactly as it is.
**A field without a name can be picked.** `subrole` (e.g. AXSearchField) and
`index` (its number in the list `computer_find` returned) pick one element.
`computer_set_value` no longer guesses with `first` when several fields match:
in Finder the first text field can be a file name.
**An app's own door, opened from behind.** `computer_open` reaches an app whose
window is covered or that will not act from behind, through the app's own URL
rather than its window: `play_track` (a Spotify track), `open_chat` (a WhatsApp
chat, with no pre-filled text), `open_app`. You give an intent and one parameter,
never a URL; the server builds a fixed, validated URL for it, and `file:`,
`shortcuts:`, `osascript` and anything else are refused. It carries navigation
only, never a send. Its input safety is proven; its effect on the real apps is
not yet measured on a Mac that has them.

**The safety fixes, first.**
The per-app lock now fails closed: if it cannot be taken for any reason other
than another agent holding it, the action does not happen (before, a lock-
infrastructure error let two agents write over each other - the very thing the
lock exists to stop). 0.1.0's redaction could fail open: if painting
over a password field failed, the unpainted image was used. It now fails
closed, and the whole image is blacked out when the scan runs out of time.
Password managers are left out of the capture itself, not just painted over.
A coordinate click, drag or scroll is judged by the app that owns the point
under it - including every window stacked above that point - and that owner is
checked again right before the action, after any wait. Arguments a tool does
not take are refused, so a field the tool ignores can no longer steer the
consent gate. If the audit log cannot be written, write actions are refused.
Every log line carries the id of the call it belongs to. Four places wrote text
the model chose into the log verbatim - a value inside a list, an argument name
the tool does not have, an unknown tool's name, and an error message that
repeated what the model wrote. They are fingerprinted now. The log's chain shows
a removed or edited line; it is not a signature, and the docs now say so.

**It can record the screen.** `computer_record` records one display to a video file, for a
person to watch afterwards - a tutorial, a demo, proof of what an agent did. Starting asks every
time (refused in read-only mode), and can be approved from the menu bar icon; stopping never asks.
Only password managers are left out of the recording, including ones opened while it runs (one opened
mid-recording can be visible for a moment); everything else is recorded as it looks - password fields are not blacked out as they are in screenshots. The
answer is a file path: the server never reads the file back. It stops on its own at its time limit
and when the server that started it ends. If the list of apps to leave out cannot be checked for two
seconds, or a password manager cannot be kept out, it stops rather than keep filming. Every ending is
written to the audit log with the file and the reason; when the server itself is ending, it writes
that it is leaving and the helper finishes the file on its own. A server killed outright cannot write
anything. Needs macOS 15.

**Consent, as it actually works.** `allow` is the default, so an agent can be
left running. Password managers ask every single time, in every mode. Terminals
and editors ask once per app per session. Quitting, closing a window, switching
Space and destructive-looking menu items ask every time. Several pages said
otherwise; they now match the code, and a test derives the forbidden phrasings
from the code so they cannot drift back.

**A box on the screen, and a question you can answer.** While an agent works, a
small box sits in the top right of the screen the pointer is on: which agent,
what it is doing right now, a Follow button that opens a live window, and a
picker when several run at once. It never takes focus - measured, after a
finding that merely *launching* the status app stole the front window. When
something needs a person, the question waits there and is answered with Touch
ID: bound to a one-time number, over the same socket connection it came in on,
with a deadline enforced on both sides. Password managers, an unknown target
app and an unredacted screenshot can never be approved that way. An agent
cannot press anything in the icon, including by clicking its coordinates -
macOS is asked who owns that point first.

**One agent at a time in each app.** Measured with two real servers typing into
the same window: the two texts were interleaved character by character, 153
switches in 160 characters, and both servers reported success. There is now a
lock per target app, held across processes. Two agents in *different* apps still
run at the same time. The loop guard counts across every agent on the machine
too - it used to count per process, which on a machine with fifteen open chats
meant ten identical clicks each, not ten in total.

**A screenshot went from 86 seconds to 1.3.** Not the capture - the redaction,
which walked every visible app's accessibility tree looking for password
fields; one Electron window alone took 54 seconds of it. It now only scans what
the image actually covers, and if it still runs out of time the whole window is
blacked out rather than risk leaving a password visible. macOS' own search API
turned out to be unsupported by those apps (error -25213).

**Everything that gets cut now says so.** A field value cut at 200 characters, a
tree walk that ran out of time, a text answer over the limit. The audit log
distinguishes `verified` (we read it back), `performed` (the app did it) and
`sent` (delivered, outcome unknown), says UNKNOWN rather than "intact" when it
cannot be read, and detects a removed *tail* - the chain alone could not, and
an anchor that only remembered the last line was reset by the next write.

**Measured limits, written down rather than wrapped up.** Keystrokes do not land
in a Chromium window that is not focused: the helper reports `typed: 21` and the
text arrives nowhere. Web page content is not in the accessibility tree at all -
zero web areas in two different Chromes - while Electron apps expose everything
(4.000 nodes, 1.434 texts in one window). So: inside a web page, use a browser
tool; inside an app, use this one.

**The server now tells the model its rules** - 34 lines, sent at startup - so it
picks the quiet route from the first call instead of learning it from refusals.

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
