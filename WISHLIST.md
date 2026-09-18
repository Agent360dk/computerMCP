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

**M - Recipes per app.** Every large Mac app has its own accessibility quirks -
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

**M - Prebuilt universal binary in the npm package.** Right now installing
means having Swift. It should not.

**M - Windows and Linux.** Honestly: this is macOS-shaped to its bones -
Accessibility, ScreenCaptureKit, CGEvent. A port is not a port, it is a sibling
project sharing an interface. If that interests you, it is the biggest thing on
this page.

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
