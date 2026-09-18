---
format: 1920x1080
duration: 27s
message: A screenshot of your Mac holds more than you meant to share - Computer MCP blacks it out before the image exists.
arc: Hook (the screenshot problem) -> The moment (redaction before write) -> Consent -> Accountability -> CTA
audience: developers deciding whether to let an AI agent drive their work Mac
mode: autonomous
music: none
---

# Computer MCP - hero promo

**No frame names a captured asset, and that is correct:** computermcp.dev is
static HTML with no images (see `capture/extracted/asset-descriptions.md`).
Every frame is drawn from the brand tokens in `frame.md`.

Silent by design: a muted autoplay loop at the top of computermcp.dev. Every
line must be readable without sound. No narration, no BGM, no SFX.

All text on screen is true and checkable against the live product. No adoption
claims, no invented numbers.

---

## Frame 01 - Hook

- id: 01-what-the-screenshot-holds
- status: animated
- src: compositions/frames/01-what-the-screenshot-holds.html
- duration: 6s
- transition_in: cut
- blueprint: zoom-out-workspace-reveal
- scene: Tight on a password field filling with dots, then pull out to reveal it was one corner of a working desktop
- asset_candidates: none
- on_screen: "Your agent takes a screenshot." -> "This is what is in it."

### Shot sequence

```
Scene 1 (0.0-1.8s): full-bleed on ONE macOS secure field at 1:1, centered, ~70% of width.
                    Dots appear one per 0.18s, eight of them. Nothing else exists on screen.
Scene 2 (1.8-4.2s): camera pulls out steadily (scale 1 -> 0.28, power2.out, NO overshoot).
                    As the field shrinks the desktop arrives around it: editor upper-left with a
                    visible `.env` tab, terminal lower-right holding a long token, a vault window
                    right of centre. Each arrives by OPACITY only, staggered 0.25s - nothing slides
                    in, because the desktop was always there.
Scene 3 (4.2-6.0s): all motion stops. Lower third: "Your agent takes a screenshot." holds 0.8s,
                    then swaps IN PLACE (hard cut, no fade) to "This is what is in it." Hold to end.
```

Opens at 1:1 on a single macOS secure text field, dots appearing one by one.
The camera pulls out steadily. As the field shrinks, the rest of the desktop
arrives around it: an editor holding a file named `.env`, a terminal with a
long token still on screen, a vault window standing open.

The hook is the pull-out itself. Nothing is claimed; the viewer does the
arithmetic.

---

## Frame 02 - The moment

- id: 02-black-before-the-file
- status: animated
- src: compositions/frames/02-black-before-the-file.html
- duration: 7s
- transition_in: crossfade
- blueprint: agent-progress-theater
- scene: A four-step pipeline where the black bar lands before the PNG ever exists
- asset_candidates: none
- on_screen: "capture" / "find" / "paint" / "write" -> "The unredacted image never becomes a file."

### Shot sequence

```
Scene 1 (0.0-1.2s): the desktop from frame 01, dimmed to 35%. Four step labels seat across the
                    lower-middle on a 1px hairline rail: capture / find / paint / write, all muted.
Scene 2 (1.2-2.4s): "capture" lights accent green; a thin outline snaps around the whole desktop
                    with a small "in memory" tag beside it.
Scene 3 (2.4-3.6s): "find" lights; the secure field's outline strokes in accent green, 2px.
Scene 4 (3.6-4.6s): "paint" lights; a PURE #000 rectangle drops over the field in ONE frame -
                    no fade, no scale. It is the only pure black in the film.
Scene 5 (4.6-5.6s): "write" lights; only NOW does a file icon materialise at the rail's end.
Scene 6 (5.6-7.0s): stillness. Lower third: "The unredacted image never becomes a file." Hold.
```

Four steps resolve left to right, each lighting in the accent green as it
completes: **capture** (a frame appears, in memory), **find** (the secure
field outlines), **paint** (an opaque black rectangle drops over it, hard, no
fade - black is not a filter), **write** (only now does a file icon appear).

The order is the product. The last step arriving last is the whole argument.

---

## Frame 03 - Consent

- id: 03-nothing-clicks-until-you-say-yes
- status: animated
- src: compositions/frames/03-nothing-clicks-until-you-say-yes.html
- duration: 5s
- transition_in: cut
- blueprint: cursor-ui-demo
- scene: A cursor heads for a terminal; a dialog intercepts, is not answered, and refuses
- asset_candidates: none
- on_screen: "Nothing clicks until a human says yes." -> "An unanswered dialog refuses."

### Shot sequence

```
Scene 1 (0.0-1.4s): a Terminal window seats centre-right, prompt blinking. A cursor enters from
                    bottom-left and travels toward it at constant speed.
Scene 2 (1.4-2.2s): before it lands, a macOS-style dialog cuts in (hard, no fade), centred:
                    "Computer MCP" / "Presses cmd+q in Terminal" / buttons [No] [Yes].
                    The cursor stops dead where it is.
Scene 3 (2.2-3.8s): a hairline progress line drains left to right across the dialog's foot over
                    1.6s. Nobody answers it.
Scene 4 (3.8-5.0s): the dialog resolves to "Refused" in MUTED text, never green - a refusal is not
                    a success. Lower third: "An unanswered dialog refuses." Hold.
```

A cursor travels toward a Terminal window. Before it lands, a macOS-style
dialog cuts in naming the action. The cursor stops. A thin progress line
drains across the dialog, and the answer resolves to **Refused** - not
Allowed.

That refusal is the point: silence is not consent.

---

## Frame 04 - Accountability

- id: 04-written-down
- status: animated
- src: compositions/frames/04-written-down.html
- duration: 4s
- transition_in: crossfade
- blueprint: transcript-scroll-artifact-reveal
- scene: The audit log scrolls; the typed text is a length and a hash, never words
- asset_candidates: none
- on_screen: "Everything is written down." -> "Typed text, never in clear."

### Shot sequence

```
Scene 1 (0.0-1.2s): mono log lines scroll upward at constant speed, 14px, muted, on the ground.
                    Legible, but not yet the point.
Scene 2 (1.2-2.4s): one line decelerates to a stop dead-centre and scales to 22px - a
                    `computer_type` entry. Everything else dims to 15%.
Scene 3 (2.4-3.2s): the `text` field's value strokes in accent green, character by character:
                    {"length": 32, "sha256_12": "2c64213be42e"}
Scene 4 (3.2-4.0s): lower third: "Typed text reaches the log as a length and a hash." Hold.
```

Log lines scroll upward in mono. One line holds and enlarges: a
`computer_type` entry whose `text` field is not text at all but
`{"length": 32, "sha256_12": "2c64213be42e"}`.

A real line from a real run, not a mock-up.

---

## Frame 05 - CTA

- id: 05-install
- status: animated
- src: compositions/frames/05-install.html
- duration: 5s
- transition_in: crossfade
- blueprint: titlecard-reveal
- scene: Wordmark, the one-line install, and the three facts that qualify it
- asset_candidates: none
- on_screen: "computermcp" -> "npx @agent360/computer-mcp" -> "macOS · MIT · no account, no API key"

### Shot sequence

```
Scene 1 (0.0-1.2s): ground alone. The wordmark assembles centre - "computer" in #E6EDF3, "mcp" in
                    #3FB950 - letters rising 12px with 0.03s stagger, power2.out.
Scene 2 (1.2-2.2s): the install line fades up below it, SF Mono on a #161B22 pill:
                    npx @agent360/computer-mcp
Scene 3 (2.2-3.0s): three facts seat under it, hairline-separated:
                    macOS · MIT · no account, no API key
Scene 4 (3.0-5.0s): everything holds. No motion at all. The install line is the last thing the eye
                    rests on before the loop returns.
```

The wordmark settles, `computer` in text white and `mcp` in the accent green,
exactly as the site sets it. Below it the install line in mono, held long
enough to read twice. Under that, three short facts.

The install line is the last thing on screen and stays until the loop returns.

---

## Video direction

**Register:** calm and exact. This is a security product, and the audience
punishes overclaiming harder than plainness. Nothing bounces. Nothing
overshoots. Easing is `power2.out` and short - motion states a fact, it does
not perform.

**Ground:** `#0D1117` throughout, full-bleed on a `class="clip"` background
layer in every frame, never on `#root`. Surfaces `#161B22`, raised `#1C2128`,
hairlines `#30363D`.

**Colour carries meaning, and only one does.** Accent green `#3FB950` marks
exactly one thing: the guard working. It appears on the completed pipeline
steps, on the refusal, on the hash, and on `mcp` in the wordmark. Nowhere
else. Link blue `#58A6FF` is for code tokens only.

**The black bar is never green.** Redaction is drawn in pure `#000`, the only
pure black in the film, so it reads as absence rather than as a highlight.

**Type:** system sans for statements, SF Mono for anything a developer would
copy. Statements sit in the lower third and never compete with the visual.

**Continuity:** frame 01 ends on the desktop wide; frame 02 opens on the same
ground at the same scale, so the crossfade reads as one continuous surface.

**Never the long dash.** Only `-`.
