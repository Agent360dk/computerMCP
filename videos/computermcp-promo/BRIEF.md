---
workflow: product-launch-video
flow: full
---

# Computer MCP - hero promo

## Intent

Sell, not show. A hero video for the top of computermcp.dev: autoplay, loop,
muted, carrying its point without sound. It sits where browser-mcp's
`docs/demo.mp4` sits on browsermcp.dev.

## Destination and shape

- **16:9**, embedded on the site behind a poster image
- **25-30 seconds.** Shorter than the 30-90s sweet spot on purpose: a muted
  autoplay loop at the top of a landing page is read in one pass and then
  repeats. It must land its point before a visitor scrolls.
- Output: `docs/demo.mp4` in the computerMCP repo, plus a poster frame

## The product

A macOS computer-use MCP server. It lets an AI agent see and operate Mac
applications. On npm as `@agent360/computer-mcp`, in the official MCP registry,
MIT, macOS 14+. Install is one line: `npx @agent360/computer-mcp`.

## Angle - and why this one

**"Computer use you can actually leave running."**

The category is crowded (Peekaboo, mac-use-mcp, mac-computer-use, MacOS-MCP).
Every one of them hands an agent the whole machine at once. The reason people
do not run them on their work Mac is not that they lack features - it is that
a screenshot of a working developer's desktop contains a password manager
mid-unlock, a `.env` in the editor, a token in a terminal.

So the video does not sell capability. It sells **the thing that is missing
everywhere else**: the guardrails.

## The one image the whole video is built around

**A screenshot being taken - and the password field going black before the
image exists.**

That single moment is the product. Everything else is context around it.

## The three gates, in order of screen time

1. **Passwords never reach the model.** Secure fields and password-manager
   windows are painted opaque black while the image is still in memory,
   before the PNG is written. There is no file, anywhere, that ever held the
   unredacted picture.
2. **Nothing clicks until a human says yes.** A real macOS dialog names the
   action. An unanswered dialog refuses.
3. **Everything is written down.** Append-only log. Typed text stored as a
   length and a hash, never in clear.

## Tone

Calm and exact. This is a security product for developers, and that audience
punishes overclaiming harder than it punishes plainness. No stock footage of
people pointing at screens, no rising synth build, no "revolutionise".

Closer to a good changelog than to a SaaS ad.

## Non-negotiable

- **Every claim in the video is true and checkable.** No invented numbers, no
  user counts, no "trusted by". The product is hours old and has one star; the
  video says nothing about adoption.
- **Never the long dash.** Only `-`.
- Do not imply the tool is sandboxed or that it prevents prompt injection. It
  makes those moments visible, not impossible. Overclaiming here would
  contradict the site's own security page, which is our strongest asset.

## Customizations

- Capture computermcp.dev for brand tokens: dark GitHub-like palette
  (`#0d1117` ground, `#3fb950` green accent, `#58a6ff` link blue),
  system sans for text, SF Mono for code.
- The install line `npx @agent360/computer-mcp` should be readable and should
  be the last thing on screen.
