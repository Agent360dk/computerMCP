# Computer MCP - AI-assisted install guide

This file is written for an AI assistant setting up **Computer MCP by Agent360**.
Follow it top to bottom. There is **one step only a human can do** - granting two
macOS permissions - and it is called out clearly. Do not claim the setup is
finished until `computer_permissions` confirms it.

## What this server is, in one paragraph

Computer MCP drives macOS itself: it reads the accessibility tree, takes
screenshots, clicks, types, presses buttons, chooses menu items and moves
windows. The source has **26 tools, 11 of them read-only**, no API key, and
no network calls of its own.

> **Tell the user what they are actually getting.** `npx` currently serves
> **0.1.0**, which has 12 tools. The newer ones - menu bar, window control,
> `wait_for`, `set_value`, `ask_user` - ship with 0.2.0, which is built and
> tested but not published yet. Do not describe those five as available
> after an npx install. If the user wants them now, building from source
> takes about seventeen seconds and needs no dependencies. The design premise is
that it is safe to leave running: password fields are blacked out in memory
before a screenshot is written to disk, writes go through a consent gate, and
every action lands in a log that can only be added to, never edited that never stores typed text in clear.

## Step 1 - register the server with the client

Claude Code:

```bash
claude mcp add --scope user computer -- npx -y @agent360/computer-mcp@latest
```

OpenAI Codex:

```bash
codex mcp add computer -- npx -y @agent360/computer-mcp@latest
```

Any other client (Cursor, VS Code, Windsurf, Cline) - write this into that
client's MCP config:

```json
{
  "mcpServers": {
    "computer": {
      "command": "npx",
      "args": ["-y", "@agent360/computer-mcp@latest"]
    }
  }
}
```

## Step 2 - pick the mode BEFORE the first run

This is the decision that matters, and the default is deliberately not the
permissive one. Set `CMCP_MODE` in the server's `env` block:

| `CMCP_MODE` | What the agent can do | Use it when |
|---|---|---|
| `readonly` | Only the 9 read tools are listed. The write tools do not exist as far as the model is concerned. | You are evaluating, or the agent only needs to look. **Start here.** |
| `ask` | **Default.** One dialog grants the session. Apps on the dangerous list ask every single time. | Normal use. |
| `allow` | Writes proceed without asking. Still logged. Dangerous apps still ask. | Long unattended runs you have already decided to trust. |

Recommend `readonly` for a first install and say why: nothing can go wrong, and
the user can see the tool list before granting anything.

## Step 3 - THE HUMAN STEP: two macOS permissions

**You cannot do this. A person has to click it.** Ask them, then wait.

1. **System Settings -> Privacy & Security -> Accessibility**
2. **System Settings -> Privacy & Security -> Screen Recording**

**Which app do they grant them to?** macOS attributes these to the *responsible
process*, which depends on how the server was launched. Run from a terminal it is
usually the terminal; launched by an MCP client over `npx` it may be the client.
Tell them honestly: grant it to whichever app the system dialog names, and if no
dialog appears, start with the app that launched the client.

## Step 4 - verify, do not assume

Call `computer_permissions`. It reports each permission separately. Only when
both read as granted is the install finished. If one is missing, say which one
and send the user back to Step 3 - do not retry the tool in a loop.

Then call `computer_screenshot` once. A returned image with both permissions
granted is the real end-to-end proof.

## What this server deliberately does not have

No shell execution, no arbitrary file access, no URL fetching. Each would be a
few lines of code. Do not suggest working around this by pairing it with a shell
server without saying plainly what that combination gives up.

## Reporting back

If macOS behaves differently from the above - for instance if upgrading the
package re-prompts for permissions - that is an unmeasured case the maintainers
want: https://github.com/Agent360dk/computerMCP/issues

Homepage: https://computermcp.dev - MIT licence - macOS only.
