# 0032. No "Update branch", drafts run no gates, and the test results are one comment

Status: accepted
Date: 2026-10-07
Amends: 0020, 0027

## Context

The `develop` ruleset of this repository already has `strict_required_status_checks_policy: false`
(read from the live ruleset on 2026-10-07), so a green pull request with no conflicts merges
without being brought up to date and without a second pass through the gates. The sibling
repositories planned.travel and smakopas.pl had it on `true` and changed it the same day; this
record states the rule here so it is not switched back by accident.

Two other costs remained on the pool of `ci` runners. A draft pull request ran the whole suite on
every push although it cannot be merged, and the results of a run lived only in the checks tab and
in a seven-day artifact, so nothing on the pull request itself said which commit had been tested.

## Decision

1. **No "Update branch".** `strict_required_status_checks_policy` stays `false` on `develop` and
   `main`. A pull request merges on its own green checks when it has no conflicts.
2. **Drafts run no gates.** `ci.yml` and `a11y.yml` skip every job of a draft pull request and start
   on `ready_for_review`. A skipped required check counts as passed, and a draft cannot be merged,
   so no verdict is lost. Pushes, merge groups and promotion pull requests are not drafts and run as
   before; the `verdict` job (ADR 0020) is untouched.
3. **One test-report comment per pull request.** `e2e · merged report` posts and then updates a
   single comment (marker `<!-- ci-test-report -->`, `scripts/ci/test-report.mjs`) naming the commit,
   the unit-suite result and the Playwright totals from the merged JSON report. It never gates: the
   step is `continue-on-error`, and `pull-requests: write` is granted to that job alone. A pull
   request whose diff cannot reach the browser skips that job and carries no comment.

## Consequences

- Two pull requests that are each green alone can break `develop` together, because neither was
  tested on top of the other. The push to `develop` runs the full suite on the merged commit and
  `deploy · staging` needs it green (ADR 0020), so the breakage stops at staging and the fix is a
  normal pull request.
- The accessibility result is not in the comment: `a11y.yml` is a separate workflow that runs in
  parallel and has no verdict to read when the comment is written. Its check stays on the pull
  request.
- Rolling back the ruleset is one setting; rolling back the rest is reverting this change.
