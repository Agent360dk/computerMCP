# Changelog

Dates are the day the version was tagged. Everything here was measured before it
was written down; where a claim has a test, the test is named.

## 0.2.0

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
