# Installing Computer MCP (instructions for an AI agent)

You are installing a macOS computer-use MCP server. Two parts: an npm package
and two macOS permissions. There is no extension and no account.

> **Status check first.** As of v0.1 the npm package is not published. If
> `npm view @agent360/computer-mcp version` returns nothing, clone and build
> instead, and point the client at `node <path>/mcp-server/index.js`. Everything
> below about permissions and modes is unchanged either way.

## 1. Add the server to the client config

Claude Code:

```bash
claude mcp add computer -- npx -y @agent360/computer-mcp
```

Any other MCP client - add to its `mcp.json`:

```json
{ "mcpServers": { "computer": { "command": "npx", "args": ["-y", "@agent360/computer-mcp"] } } }
```

Optional environment variables:

- `CMCP_MODE` - `readonly` | `ask` (default) | `allow`
- `CMCP_ASK_TIMEOUT` - seconds a consent dialog waits before refusing (default 60)

Start in `readonly` if the user has not asked for control yet.

## 2. Verify, then ask the human for permissions

Restart the client, then call `computer_permissions`. It returns
`accessibility` and `screenRecording` as booleans.

If either is false, the human must grant it - you cannot. Tell them exactly:

> System Settings → Privacy & Security → **Accessibility** (and the same under
> **Screen Recording**) → enable the app that runs the MCP server: your terminal,
> or your editor. Then restart it.

The permission belongs to the host application, not to this package. Granting it
to the wrong app is the most common failure.

## 3. Confirm it works

Call `computer_apps`. A list of running applications with bundle IDs means both
halves are working.

## Notes that save a round trip

- Screenshots are redacted by default; secure fields come back black. That is
  correct behaviour, not a rendering fault.
- In `readonly` mode the write tools are not listed. If the user asks you to
  click something, tell them to set `CMCP_MODE=ask` and restart.
- The first write action opens a dialog on the human's screen. If you get
  "mennesket sagde nej eller svarede ikke", they did not see it or declined -
  ask them, do not retry in a loop.
- Prefer `computer_inspect` over guessing coordinates from a screenshot. It
  returns frames you can click accurately.
