# Wishlist

Things that should exist and do not yet. Nothing here is assigned. If one of
them is interesting, say so in an issue and take it - you will not be stepping
on anyone.

Sized honestly: **S** is an afternoon, **M** is a weekend, **L** is a real project.

---

## The list that only gets good if many people write it

**S - Add an app to the redaction list.**
The screenshot redaction blacks out macOS secure fields plus a hard-coded list
of apps whose windows are always hidden: Keychain Access, 1Password, Bitwarden,
LastPass, Dashlane, Apple Passwords.

That list is the honest weak point of this project. It contains the password
managers *we* happened to think of, in *our* country, on *our* machines. It
does not contain your banking app, your company's VPN client, your team's
secrets manager, or the password manager that is popular where you live.

Nobody can enumerate that list alone. Everybody can add one line to it.
There is an issue template for exactly this, and it is the single most useful
thing you can contribute here.

**S - A secure-field role we are missing.**
We detect `AXSecureTextField` as a role and as a subrole. Some toolkits mark
their fields differently, and an Electron app is not a Cocoa app. If you find a
field that stays visible in a screenshot when it should not, that is a security
bug and we want it as one.

---

## Reliability, where the sharp edges are

**S - Keyboard layouts.** Typing goes in as Unicode, which should work on any
layout. Should. If your layout produces something else, we want the case.

**M - `computer_wait_for`.** Wait for an element to appear, a window title to
change, a spinner to go. Today an agent invents its own sleep loops and gets
them wrong.

**M - Recipes per app.** ([format og det foerste eksempel](recipes/)) Every large Mac app has its own accessibility quirks -
what Xcode calls a button, where Finder hides the path bar, why Slack's message
box is three elements deep. A recipe is a short markdown file: here is how you
drive this app reliably. This is the kind of knowledge that only exists in the
heads of people who have already fought it.

**M - Multiple displays.** We capture the main display. If you work on three,
we would like to hear what the right behaviour is before we guess.

**L - A persistent helper process.** Today the binary starts per call, about
150 ms each time. A long-lived process would remove that and make waiting for
elements possible without polling.

---

## Reach

**M - A real signature.** The package ships a universal binary, so nobody
needs Swift any more - but it is ad-hoc signed, which is only what macOS
needs to run it. A Developer ID signature and notarization would stop
Gatekeeper asking, and would let you verify the binary came from us.
That needs a paid Apple developer account, which is why it is still here.

**M - Windows and Linux.** Honestly: this is macOS-shaped to its bones -
Accessibility, ScreenCaptureKit, CGEvent. A port is not a port, it is a sibling
project sharing an interface. If that interests you, it is the biggest thing on
this page.

What we have actually measured about a Windows sibling, so you know what you
would be taking on:

- **Blacking out password fields has a counterpart.** `IsPassword` is a
  documented UI Automation property across Win32, .NET and WinApp SDK. Whether
  Chrome, Edge and Electron apps actually set it is unmeasured - and that exact
  question cost us work on macOS, where a password field in a browser carries
  the role `AXTextField` with the *subrole* `AXSecureTextField`, so a check that
  only read the role let every browser through.
- **"An unanswered prompt is a no" has none.** Our macOS promise rests on
  `display dialog ... giving up after N`, which closes itself and reports that it
  gave up. `MessageBoxTimeOut` is undocumented, PowerShell's message box has no
  timeout at all, and the usual workaround leaves the dialog on screen after the
  agent has already moved on - so a human can click "Yes" an hour later on a box
  that answers to nothing. That is not the same promise; it is a worse one.
- **The log nobody else can read would quietly stop being true.** We set the
  file to owner-only with `chmod 0600`. On Windows Node's `chmod` only toggles
  the read-only flag and sets no ACL, so the sentence would still be on the site
  while no longer being true.

**M - Ask in the client, not in a window.** Today consent is a macOS dialog the
server raises itself. MCP has a better shape for it: `elicitation/create` lets
the server ask the CLIENT to put the question to the person - for a terminal
client, inline in the very conversation that asked for permission, which is the
yes/no they already know. The window is the wrong channel: run five chats and
five identical boxes say "Computer MCP" without saying which one is asking.

Two things to measure before anyone builds it, both found by measuring rather
than reading:

- **Is it actually reachable?** Claude Code 2.1.263 announces `elicitation` as a
  client capability, but the one occurrence of `elicitation:{create` in the
  binary sits behind a function that returns `false` - that is the *task-based*
  variant, and it is off. And the binary carries the string "No wire schema for
  elicitation/create in the resolved era", with connections that negotiate a
  2025 protocol version still being classed `legacy`. Land in that era and the
  call fails at the wire, falling back to exactly the dialog we were leaving.
- **Where does the proof of consent then live?** A dialog goes to the operating
  system. An elicitation goes to the client, and the append-only log would then
  be recording "the human said yes" on the client's word. For a product whose
  only edge is that the consent is real, that is the argument to answer first.

**S - Client integrations.** Recipes for Zed, Windsurf, Continue, LM Studio and
whatever appears next.

---

## Things we have deliberately not built

Say so if you disagree - with a reason, and we will listen. But these are
choices, not omissions:

- **No shell tool.** A computer-control server with a shell inside it is remote
  access under a friendlier name.
- **No arbitrary file reading.** Same argument.
- **No model inside the server.** Your agent already has one, and adding ours
  would mean an API key, a bill, and a second place your screen goes.
- **No telemetry.** We would rather not know than ask you to trust us.
