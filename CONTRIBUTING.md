# Contributing

## Why this one actually needs you

Most projects say contributions are welcome and mean it politely. Here it is
load-bearing, and for a specific reason.

The screenshot redaction blacks out macOS secure fields plus a hard-coded list
of apps whose windows are always hidden. That list contains the password
managers *we* thought of, in *our* country, on *our* machines. It does not
contain your banking app, your company's secrets manager, or whatever is
popular where you live.

**That list cannot be written by one team. It can be written by many people
adding one line each.** Every app someone adds makes the tool safer for
everyone who installs it afterwards - including for people who will never know
the contribution happened. There is an
[issue template](https://github.com/Agent360dk/computerMCP/issues/new/choose)
for it and you do not need to write any code.

The [recipes folder](recipes/) has the format and a first example, measured
rather than remembered. The same is true of knowing how to drive a particular
Mac app. Every large app
has its own accessibility quirks, and that knowledge currently lives only in the
heads of people who already fought it. Writing one down takes ten minutes and
saves the next person an evening.

The [wishlist](WISHLIST.md) is the rest: things that should exist and do not
yet, sized honestly, none of them assigned. If one looks interesting, say so in
an issue and take it. You will not be stepping on anyone.

## Two things to know before you change code

### The gates are the product

Anything that weakens redaction, consent or the audit log needs a very good
argument, and "it is more convenient" is not one. In particular:

- Apps that always ask, always ask. That is not made configurable.
- An unanswered dialog refuses. It never defaults to approval.
- Typed text does not reach the log in clear, not even behind a flag.
- The helper binary keeps **zero third-party dependencies**. It is the part
  that holds Accessibility and Screen Recording permission, and every package
  inside it is a vendor the user is trusting without having chosen to.

Disagree with any of these? Say so, with a reason. They are choices, and a good
argument can move them. Silence cannot.

### New behaviour needs a test that can fail

Every gate here has a test, and every one of those tests has been checked by
breaking the code on purpose and confirming it goes red. A test that has never
failed has not been shown to work - it has only been shown to run.

If you add a guarantee, add the test, then mutate the code and paste the red
output in the pull request. That paste *is* the review.

This is not ceremony. It has already paid for itself twice here: one test
passed while the consent gate was mutated away, because it only checked that a
call failed rather than *why*; and a redaction test passed on a machine where
it could not see anything at all.

## Running things

```bash
cd helper && swift build -c release
cd ../mcp-server && npm install
./test/run-all.sh
```

`run-all.sh` keeps the full output in a log file, because a flaky run you
cannot inspect afterwards is a bug report nobody can act on.

Two of the tests need a desktop that is not in full-screen mode - a test window
cannot be placed over another app's full-screen Space. They fail loudly rather
than skipping quietly, which is deliberate.

## What CI can and cannot tell you

A build runner cannot be granted Accessibility or Screen Recording permission,
so everything touching a real screen is unproven there. CI says so out loud on
every run rather than letting a green tick imply more than it means.
