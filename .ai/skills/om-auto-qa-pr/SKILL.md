---
name: om-auto-qa-pr
description: Repo-local extension of om-auto-qa-pr - the viewports, themes, hydration wait and console policy that decide PASS/FAIL in this repository.
---

# om-auto-qa-pr (money-tracker.online)

This file extends the shared `om-auto-qa-pr` skill installed at
`.claude/skills/om-auto-qa-pr/SKILL.md`. Follow its full workflow (review-first gate, environment
via `om-prepare-test-env`, scenario, evidence, labels) with the rules below layered on top.

## Capture matrix

Every screen the diff touches is captured at **360x800 and 1280x900**, in **light and dark**: four
frames per state, plus the interaction state that is the point of the change (`docs/SPEC.md` §7.4).
Theme needs both halves: write the stored mode to `localStorage` **and** emulate
`prefers-color-scheme`; `useTheme()` in `e2e/support/app.ts` shows how.

## Before acting on a page

Wait for hydration. Every control is a React Aria component driven by `onPress` and the shell
streams: a click before hydration lands on a handler-less button and typed text is discarded.
`waitForHydration()` in `e2e/support/app.ts` waits on React's own fiber marker. Do the same, never a
fixed sleep.

## Console policy

Console red is the application talking. Any `pageerror`, `console.error`, `console.assert` or
`console.warn` not listed in `TOLERATED_CONSOLE_WARNINGS` (`e2e/support/console-policy.ts`) is a
**FAIL** for the step, quoted verbatim in the report. Never extend the tolerated list from this
skill.

## Credentials and data

Sign in with the descriptor's `owner` credential reference. The seed is deterministic and anchored
to `BASELINE_DAY` (`e2e/baseline-day.ts`); under `pnpm dev` the server honours the
`x-mt-server-today` header, which is how the dashboard opens on the seeded month rather than the
machine's. A rendered amount is a formatter's output: when a check is about arithmetic, read the
stored minor-unit value.

## Rules

- Sign-off follows the installed skill's `--self-qa-signoff` rules, and an unattended run always
  passes that flag. Before applying `qa-approved` + `qa-self-verified`, hand the frames and the
  report to the `manual-tester` sub-agent (with `accessibility-specialist` when the change touches
  layout or copy) through `.ai/skills/afk-decide/SKILL.md`, and sign off only on its approving
  verdict, quoted in the evidence comment. A `risk-high` PR keeps the installed skill's rule: post
  the evidence and the verdict, withhold the sign-off, and leave `qa-approved` to the owner (a
  security specialist's verdict, 2026-10-01: money, ledger, auth and migrations break silently,
  and those PRs are few).
- Frames go to `.ai/qa/artifacts_<runId>/` (gitignored). A PNG anywhere else in the repository is a
  defect.
- No secret from `.dev.vars` or `.ai/qa/test-env.env` enters a screenshot or the report.
