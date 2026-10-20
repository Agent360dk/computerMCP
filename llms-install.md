# Installing Computer MCP (instructions for an AI agent)

You are installing a macOS computer-use MCP server. Two parts: an npm package
and two macOS permissions. There is no extension and no account.

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

- `CMCP_MODE` - `readonly` | `ask` | `allow` (default)
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

Call `computer_permissions`. It reports Accessibility and Screen Recording
separately; both granted means both halves are working. (`computer_apps` alone
proves nothing about permissions: it lists apps without them.)

## Notes that save a round trip

- Screenshots are redacted by default; secure fields come back black. That is
  correct behaviour, not a rendering fault.
- In `readonly` mode the write tools are not listed. If the user asks you to
  click something, tell them to set `CMCP_MODE=ask` and restart.
- A write into a password manager is refused in background mode (the default) and
  cannot be approved from the menu bar; in the foreground it asks every time. A
  write into a terminal or an editor, or one that quits or closes something,
  needs the human's yes - in background mode it waits in the menu bar icon. If you get "the person said no, or did not answer", they
  did not see it or declined - ask them, do not retry in a loop.
- Prefer `computer_inspect` over guessing coordinates from a screenshot. It
  returns frames you can click accurately.
