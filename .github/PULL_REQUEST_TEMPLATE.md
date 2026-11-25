## What changes

<!-- One or two sentences. Link the issue: "Closes #NN". -->

## Why

<!-- What was wrong or missing. If you measured it, the number. -->

## The test that can fail

<!--
Every new guarantee needs a test, and the test has to have been seen going red.
A test that has never failed has not been shown to work - it has only been shown to run.
See CONTRIBUTING.md, "New behaviour needs a test that can fail".

1. Name the test (file and case), e.g. `test/parallel.mjs` 4b.
2. Break the code on purpose (the mutation) and paste the red output below.
3. Put the code back and paste the green output.

Docs-only, recipe-only or list-only change? Say so and delete this section.
-->

**Test:**

**Mutation** (what you broke on purpose):

```text
paste the red output here
```

**Green again:**

```text
paste the passing output here
```

## Checklist

- [ ] It does not weaken redaction, consent or the audit log - or the PR says why it has to.
- [ ] No new third-party dependency in the helper (`helper/`).
- [ ] Typed text does not reach the log in clear, not even behind a flag.
- [ ] `./test/run-all.sh` run on a real Mac (or I say which parts I could not run, and why).
- [ ] `CHANGELOG.md` and README updated where the behaviour a person sees has changed.
