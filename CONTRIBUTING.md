# Contributing

Issues and pull requests are welcome. Two things to know before you start.

## The gates are the product

Anything that weakens redaction, consent or the audit log needs a very good
argument, and "it is more convenient" is not one. In particular:

- Always-ask apps ask every time. That is not made configurable.
- An unanswered dialog refuses. It never defaults to approval.
- Typed text does not get logged in clear, not even behind a flag.
- The helper binary keeps **zero third-party dependencies**.

## New behaviour needs a test that can fail

Every gate here has a test, and every one of those tests has been checked by
breaking the code on purpose and confirming the test goes red. A test that has
never failed has not been shown to work - it has only been shown to run.

If you add a guarantee, add the test, then mutate the code and paste the red
output in the pull request. That paste is the review.

## Running things

```bash
cd helper && swift build -c release
cd ../mcp-server && npm install
python3 ../test/redaction-unit.py
node ../test/server-e2e.mjs
node ../test/failclosed.mjs
```

`redaction-proof.sh` needs a desktop that is not in full-screen mode, because a
test window cannot be placed over another app's full-screen Space. It fails
loudly instead of skipping quietly - that is deliberate.
