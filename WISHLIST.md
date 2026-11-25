# Computer MCP - Wishlist

The public list of what people have asked for, and what is still open. Curated by Agent360.

## How to add a wish

- **Easy:** [open a wish issue](https://github.com/Agent360dk/computerMCP/issues/new/choose) - there
  are ready-made forms for an app whose window should always be blacked out, a secure field we are
  missing, and app-specific recipes.
- **Faster:** ask the agent in your own session to "submit a wish for computer-mcp to do X". It knows
  the format.
- **PR directly:** edit this file and open a pull request with your bullet under **🟡 Wanted**.

When a wish ships it moves to **✅ Shipped** with the version it landed in. Nothing is deleted from
this file - a wish we decided against moves to **Not in scope** with the reason, so the next person
does not have to ask twice.

---

## 🟡 Wanted

Current version: **0.4.1** (npm, the MCPB bundle and the GitHub release). Each wish below has an
issue where the work and the discussion live - comment there to take it.

**Small - a good first contribution:**

- **`computer-mcp doctor`** - one command that says what is installed, granted and missing.
  [#19](https://github.com/Agent360dk/computerMCP/issues/19)
- **Setup guides for more clients** - Zed, Windsurf, Continue, LM Studio, Cline, Goose, Raycast.
  [#20](https://github.com/Agent360dk/computerMCP/issues/20)
- **Recipes for the native apps everyone uses** - Finder, Mail, Notes, System Settings, Safari.
  [#21](https://github.com/Agent360dk/computerMCP/issues/21)
- **`ARCHITECTURE.md`** - an English map of the code and a glossary of the Danish names.
  [#22](https://github.com/Agent360dk/computerMCP/issues/22)
- **`examples/`** - chat prompts, a 50-line agent of your own, a read-only demo.
  [#23](https://github.com/Agent360dk/computerMCP/issues/23)
- **An app for the redaction list** - the one that never closes.
  [#1](https://github.com/Agent360dk/computerMCP/issues/1)

**Larger - help wanted:**

- **A real queue between agents** - fair order, a visible position, and the action continues by
  itself when it is its turn instead of "ask again in a moment".
  [#17](https://github.com/Agent360dk/computerMCP/issues/17)
- **Switch on by itself** - the icon at login, waking when something lands in the queue,
  first-run permission setup. [#18](https://github.com/Agent360dk/computerMCP/issues/18)
- **Hands-free and voice** - queued work moves on by itself, and the person can hear what is
  waiting. A yes stays Touch ID. [#25](https://github.com/Agent360dk/computerMCP/issues/25)
- **Recipes as MCP resources** - so every agent reads the right recipe before it drives an app.
  [#24](https://github.com/Agent360dk/computerMCP/issues/24)
- **A running server never tells you it is out of date.** Measured 20/9, and it cost a real day:
  nineteen servers were alive on this machine, eighteen of them started the day before. A process
  carries the code it was born with. It should compare the running file against the package on
  start, and say plainly in the startup line when they differ. Still open; no issue yet - open one
  if you want it.

---

## ✅ Shipped

- **0.4.1** - the first npm release since 0.1.0; it carries everything from 0.2.1, 0.2.2 and 0.4.0
  ([CHANGELOG](CHANGELOG.md)). Among the wishes that landed there:
  - **A menu-bar question has to be noticeable, not just askable** (measured 6/10: 1 of 23
    questions approved). Now: one sound per new question, a banner (which never has an Allow
    button - an agent can click a banner), and the box in the corner turns orange with the whole
    question. A question waits about ten minutes instead of one.
  - **Work in apps behind yours** (first planned as 0.3.0).
  - **A prebuilt universal binary**, so `npx` works without Swift
    ([#3](https://github.com/Agent360dk/computerMCP/issues/3)), and
    **`computer_wait_for`** ([#2](https://github.com/Agent360dk/computerMCP/issues/2)).
  - **`computer_pending` should be able to notify, not just answer** - the banner covers questions;
    a queue that says what is waiting *now* is [#17](https://github.com/Agent360dk/computerMCP/issues/17).
- **0.2.0** (GitHub release only; on npm with 0.4.1) - background by default
  (`CMCP_BACKGROUND=0` turns it off), `computer_pending`, three ways a secret could escape closed,
  the accessibility tree no longer hands over what the screenshot hides, search strings off the
  command line, the whole product surface in English, a loop guard, and four more things a person
  can do (switch desktop, drag, the Dock and status icons, Save / Don't Save sheets).
- **0.1.0** - the first twelve tools, the consent gate, secure-field redaction, the append-only log.

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

**M - Recipes per app.** ([the format and the first example](recipes/); open: [#21](https://github.com/Agent360dk/computerMCP/issues/21)) Every large Mac app has its own accessibility quirks -
what Xcode calls a button, where Finder hides the path bar, why Slack's message
box is three elements deep. A recipe is a short markdown file: here is how you
drive this app reliably. This is the kind of knowledge that only exists in the
heads of people who have already fought it.

**L - A persistent helper process.** Measured, and smaller than we assumed:
starting the binary costs about 21 ms per call, not the 150 ms this entry
claimed for weeks. A long-lived process holding Accessibility permission is not
worth 21 ms, so this is here for honesty rather than as a plan.

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
whatever appears next. ([#20](https://github.com/Agent360dk/computerMCP/issues/20))

---

## 📋 TODO - taken as we go

Ordered by what costs most to be without, not by when it was found. Everything here is measured;
where it is not, the line says so.

**From a security review of the 0.2.0 work, 20/9 - all ten now closed:**

Kept here because the reasoning is worth more than the diff.

- [x] **A refusal lost the candidates it found.** `computer_press` promises that several matches is
  "a refusal, not a guess" - and the helper did send them, but the error carried only the message.
  The model could not narrow the search, only guess again. A promise in a tool description is a
  promise.
- [x] **The audit log wrote model-controlled fields verbatim.** A value that *looks* structured is
  still whatever the model wrote. `app` was taken off the list entirely after a 66-character secret
  of letters and hyphens passed a shape check - a shape check on free text is a race you lose. The
  log now records the server's own resolved `target` instead.
- [x] **"Append-only" was an intention.** Now every line carries a fingerprint of itself and the one
  before it; a removed or edited line breaks the chain, and `computer_audit` says where. The honest
  limit is on the site in the same breath: it proves no line was changed, not that the file cannot
  be deleted.
- [x] **`CMCP_OSASCRIPT` could make the log claim a human answered.** It grants no power that
  `CMCP_MODE=allow` does not - but the two do not lie the same way. Lines now carry `asker=custom`.
- [x] **The loop guard was narrower than it looked**, and it read `tool.tier` instead of the
  effective one, so fifty unredacted screenshots were free. Fixed, and the boundary is now written
  in the tool description rather than left to look wider than it is.

**Unmeasured, and staying that way until someone can measure it:**

- [ ] **Whether a drag is actually accepted** by an app. It needs a receiver, and a receiver needs
  the pointer to move on a real screen. The tool says the drag was *sent*, never that it worked.
- [ ] **Whether macOS raises its own screen-recording reminder** in read-only mode. Since macOS 15
  the system nags about capture that bypasses the picker. It would be a window we cannot switch
  off, in the mode that promises none. Visible only after a month of use.
- [ ] **Whether `elicitation/create` is reachable** in Claude Code. It announces the capability, but
  the one occurrence in the binary sits behind a function returning false, and the binary carries
  the string "No wire schema for elicitation/create in the resolved era".

**Reach, in the order that does not waste itself:**

- [x] **Search Console and Bing.** Done 21 Sep, not the way this line said: the registrar's API
  refuses our address and its key belongs to someone else, so ownership is proved from the site
  itself - a file and a meta tag for Google, an XML file for Bing. Both sitemaps are in, 22 pages
  read. Note for next time: a meta tag added to a page GitHub Pages already caches is invisible to
  a crawler for ten minutes; a new file is not cached at all and lands at once.
- [ ] **The catalogues that actually get read:** awesome-mcp-servers, Glama, Smithery, PulseMCP,
  mcp.so. Not before npm serves the same version the site describes - a submission made early
  caches the wrong product.
- [x] **browser-mcp as a channel.** Done 21 Sep - one section before the licence in its README,
  which is what npm shows to the 1,737 people who fetch it each week.
- [ ] **One post about the finding, not the tool.** "What leaks in an agent screenshot" and "the
  audit log was itself the leak" are stories. "Another macOS MCP" is not.

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
