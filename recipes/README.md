# Recipes

Short notes on how to drive a particular Mac app reliably.

Every large app has its own accessibility quirks. That knowledge currently
lives in the heads of people who already fought it, and disappears when they
move on. A recipe takes ten minutes to write and saves the next person an
evening.

## The format

One file per app or family. Keep it short. Four headings:

```markdown
# <App>

**What works** - roles and titles that find the right elements, in what order.
**What does not** - and what you did instead.
**Gotchas** - the thing that cost you an hour.
**Measured** - how you know. Paste the command and the number.
```

That last heading is the one that makes a recipe worth trusting. "Electron apps
have duplicate button names" is an opinion. "73 buttons, 47 unique names,
`Show command menu` appears 10 times" is a finding someone can check.

## Contributing one

Open an [issue](https://github.com/Agent360dk/computerMCP/issues/new/choose)
with the recipe template, or send a pull request adding a file here. Both are
equally welcome and the issue is less work.

You do not need to cover the whole app. One reliable path through one screen is
more useful than a complete map that is half guesses.

## What is here

- [electron-apps.md](electron-apps.md) - VS Code, Slack, Discord, Notion and
  every other Electron app. Start here if the app is not native.
