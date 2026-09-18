# Computer MCP

**Computer use you can actually leave running.**

A macOS computer-use MCP server with the guardrails on by default. Password
fields are blacked out while the screenshot is still in memory. Nothing clicks
or types until a human says yes. Every call is written to an append-only log.

No account, no API key, no model inside it. MIT.

```bash
git clone https://github.com/Agent360dk/computerMCP
cd computerMCP/helper && swift build -c release
cd ../mcp-server && npm install
```

> **v0.1 is not on npm yet.** Build from source for now. When the package is
> published, `npx @agent360/computer-mcp` replaces the three lines above and
> nothing else changes.

[computermcp.dev](https://computermcp.dev) · [Security model](https://computermcp.dev/security.html)

---

## Why

Handing an agent your keyboard, mouse and screen is the most useful thing you
can give it and the least reversible. A screenshot of a working developer's Mac
can contain a password manager mid-unlock, a `.env` open in the editor, or
customer data. A stray keystroke in a terminal is not a typo - it is a command.

Most desktop-automation MCP servers hand all of that over at once, with no way
to say *that, but not that*. So the careful people don't run them on the machine
where the work actually is.

This is the same capability with the dangerous edges answered.

## The three gates

**1. Passwords never reach the model.** Secure text fields and password-manager
windows are painted opaque black on the bitmap *in memory*, before the PNG is
written. There is no moment where an unredacted picture of your desktop exists
as a file. Native fields expose the role `AXSecureTextField`; fields in a web
page expose role `AXTextField` with the *subrole* `AXSecureTextField`. Checking
only the role would catch native fields and let every browser password box
through - so both are checked.

**2. Nothing clicks until you say yes.** The first write action opens a real
macOS dialog naming what is about to happen. Password managers and terminals ask
*every single time*, even after the session was approved, even in `allow` mode -
that one is not configurable. If nobody answers the dialog, the answer is no.

**3. Everything is written down.** `~/.local/state/computer-mcp/audit.jsonl`,
mode `0600`, append-only: every call, its target app, and whether it was allowed
or refused with the reason. Typed text is stored as a length and a SHA-256
prefix, never in clear - an audit trail full of passwords is its own breach.

Each gate has a test, and each test has been mutation-checked: break the code on
purpose and the test goes red. See [Testing](#testing).

## Install

Until the npm package is published, point your client at the built server
directly: `node /path/to/computerMCP/mcp-server/index.js`. Once it is on npm:

```bash
# Claude Code
claude mcp add computer -- npx -y @agent360/computer-mcp
```

```jsonc
// Cursor, VS Code, Codex CLI, Windsurf - mcp.json
{
  "mcpServers": {
    "computer": { "command": "npx", "args": ["-y", "@agent360/computer-mcp"] }
  }
}
```

Then grant two macOS permissions to the app running the server (your terminal or
editor): **System Settings → Privacy & Security → Accessibility**, and the same
under **Screen Recording**. Ask your agent to call `computer_permissions` and it
will tell you exactly what is missing.

## Modes

| `CMCP_MODE` | Behaviour |
|---|---|
| `readonly` | Write tools are not even listed. The agent can look and cannot touch. |
| `ask` | **Default.** One dialog grants the session. Dangerous apps still ask every time. |
| `allow` | Writes proceed without asking, still logged. Dangerous apps *still* ask. |

`CMCP_ASK_TIMEOUT` (seconds, default 60) controls how long a dialog waits before
it refuses.

## Tools

**Look:** `computer_screenshot` · `computer_inspect` · `computer_apps` ·
`computer_windows` · `computer_permissions` · `computer_audit`

**Touch:** `computer_click` · `computer_type` · `computer_key` ·
`computer_scroll` · `computer_move` · `computer_activate`

`computer_inspect` reads the accessibility tree - roles, titles, values, frames -
so the agent can click a button by knowing where it is instead of guessing from
pixels. Values of secure fields are never returned, not even to the agent.

**Deliberately absent:** no shell execution, no arbitrary file access, no URL
fetching. Each would be one line of code. A computer-control server with a shell
inside it is remote access under a friendlier name. If you want a shell, install
a shell MCP server - then you have chosen it, and the choice is visible in your
config.

## What it does not do

- **macOS only** (14+). No Windows or Linux build, and none planned.
- **Only what macOS marks as secure is redacted.** A password in a plain text
  editor or a token in a terminal buffer is not marked and will not be hidden.
  Use `readonly` when the screen holds something the system cannot know about.
- **Consent is not containment.** After you approve, the agent drives your real
  Mac - that is what you approved. If you need a boundary rather than a
  decision, run it in a VM. That is the honest answer, not a missing feature.
- **Prompt injection stays possible.** The dialogs and the log make it visible
  rather than silent. They do not make it impossible.

## Building from source

```bash
git clone https://github.com/Agent360dk/computerMCP
cd computerMCP/helper && swift build -c release     # the privileged binary
cd ../mcp-server && npm install
CMCP_MODE=readonly node index.js
```

The helper is a separate Swift binary with **zero third-party dependencies**.
It is the only part that receives Accessibility and Screen Recording permission,
it is small enough to read in one sitting, and it can be replaced without
touching the server. Every package inside a binary that privileged is a vendor
you are trusting without having chosen to.

## Testing

```bash
./test/run-all.sh                # everything, full output kept in a log

python3 test/redaction-unit.py   # the four redaction checks
node test/server-e2e.mjs         # the MCP protocol, read paths, readonly refusal
node test/failclosed.mjs         # an unanswered dialog must refuse
node test/claims.mjs             # every claim this README makes
./test/redaction-proof.sh        # live secure-field detection (needs a normal desktop)
```

`claims.mjs` checks the sentences on the front page against the code: that a
terminal still asks in `allow` mode, that a harmless app does *not* (otherwise
"refuse everything" would pass), that typed text reaches the log only as a
length and a hash, and that no shell, file or URL tool has appeared.

Where a check cannot be made meaningfully - no secure field happens to be on
screen - it reports SKIPPED, not passed. A green suite that measured nothing is
the failure mode these tests exist to avoid.

`redaction-unit.py` builds its own image instead of measuring the live screen.
The first version measured the real desktop - and on a machine where the editor
runs full-screen the test window could not appear at all, so the test measured
an empty screenshot and called it a pass. A security test that passes when it
cannot see anything is worse than no test.

`redaction-proof.sh` still exercises the live path and needs a desktop that is
not in full-screen mode. It fails loudly rather than skipping quietly.

## Help build it

The redaction list holds the password managers we thought of. It does not hold
your banking app, your company's secrets manager, or whatever is popular where
you live. **One team cannot write that list; many people adding one line each
can** - and every app someone contributes makes the tool safer for everyone who
installs it afterwards.

That takes [an issue form](https://github.com/Agent360dk/computerMCP/issues/new/choose)
and no code. So does writing down how some Mac app actually behaves, which is
knowledge that currently only exists in the heads of people who already fought it.

[The wishlist](WISHLIST.md) is the rest: open items, sized honestly, none of them
assigned. [How contributing works](CONTRIBUTING.md).

## Licence

MIT © Agent360 Group ApS. Built alongside
[Browser MCP](https://browsermcp.dev), which does the same thing for a real,
logged-in Chrome.
