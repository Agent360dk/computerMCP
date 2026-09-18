# Changelog

Dates are the day the version was tagged. Everything here was measured before it
was written down; where a claim has a test, the test is named.

## 0.2.0

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
