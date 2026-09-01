# TASK

Implement issue {{TASK_ID}}: {{ISSUE_TITLE}}

Pull in the issue using `gh issue view {{TASK_ID}} --comments`. If it has a parent PRD, pull that in too (`gh issue view <parent>`).

Only work on the issue specified. Respect the issue's **Owned paths** — do not touch files outside them; report discoveries in an issue comment instead.

Work on branch {{BRANCH}}. Make commits and run tests.

# CONTEXT

Read CLAUDE.md first — it holds the commands, layering rules and pointers. Domain vocabulary is in CONTEXT.md; decisions in docs/adr/.

Here are the last 10 commits:

<recent-commits>

!`git log -n 10 --format="%H%n%ad%n%B---" --date=short`

</recent-commits>

# EXPLORATION

Explore the repo and fill your context window with relevant information that will allow you to complete the task.

Pay extra attention to test files that touch the relevant parts of the code.

# EXECUTION

Use RGR (red-green-refactor) at the seams the issue names:

1. RED: write one failing test
2. GREEN: write the implementation to pass that test
3. REPEAT until done
4. REFACTOR the code

Never hand-edit generated files (`src/routeTree.gen.ts` → `pnpm generate-routes`; `drizzle/` → `pnpm db:generate`).

# VERIFICATION

Done is defined in **docs/SPEC.md §7** and the bar for the code itself in
@.sandcastle/CODING_STANDARDS.md. Read them rather than working from memory — they move, and this
prompt deliberately does not copy them.

Before committing, run `pnpm typecheck`, `pnpm lint` and `pnpm test` and make them pass.

You do NOT need to run the Playwright suite yourself: after you finish, the orchestrator runs the full deterministic ladder (`validate.sh`) in this sandbox — including e2e against the `-linux` baselines when your diff touches UI — and resumes your session with a failure digest if it is red. If you want an early e2e signal anyway: `bash .sandcastle/setup-e2e.sh --if-needed`, then `PLAYWRIGHT_BASE_URL=http://localhost:3010 pnpm e2e`.

**Billing tickets.** That same setup wires the Polar **sandbox** organization when the operator supplied its credentials, so `/pricing` and the Upgrade buttons reach a real checkout. Two halves of the flow, and only one is reachable from here: pressing Upgrade calls Polar and returns a hosted checkout URL, which you can assert on; the webhook that applies the subscription cannot be, because Polar has no route back into this container. Test that half by posting a signed payload at `/api/polar/webhook` — `src/server/billing/__tests__/webhook.test.ts` already does it with a captured one. If `requirePrice()` refuses with a message about a missing `VITE_POLAR_PRODUCT_*`, that is an unconfigured sandbox rather than a bug in your ticket; say so in your result instead of working around it.

Never run `--update-snapshots` and never edit `e2e/__screenshots__`. If your change intentionally moves pixels, the ISSUE must declare it (a `## Visual change expected` section or the `visual-change-expected` label) — the orchestrator then re-records baselines; an undeclared pixel diff is treated as a regression.

# RATIONALIZATIONS

Each of these has been said in this repo, by an agent that then burned its whole fix budget. The
thought is the signal: when you catch yourself forming it, the answer is in the right column.

| What you will think                                                               | What is actually true                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "That test is flaky, I'll just run it again."                                     | Only one shape reruns: a **TIMEOUT with no pixel count and no assertion diff**. Anything with an assertion diff is your change.                                                                                                         |
| "That typecheck error was here before me."                                        | Then prove it: `git stash` your work, run `pnpm typecheck`, unstash. If it really predates you, say so in the PR body — do not silence it.                                                                                              |
| "The snapshot diff is just rendering noise, `--update-snapshots` will settle it." | A pixel diff you did not intend is a regression. Only the ISSUE can declare an intended one (`## Visual change expected` / the `visual-change-expected` label), and only the orchestrator re-records. See docs/agents/triage-labels.md. |
| "I'll add the i18n key for `en` and backfill Polish later."                       | There is no later — the parity test fails the ladder now. A new key lands in **both `en` and `pl` in this change**. docs/SPEC.md §9, and the `i18n-messages` skill has the procedure.                                                   |
| "This is one small query, a repository for it is overkill."                       | All SQL lives in `server/repos` and goes through the tenant-scoped base repository; `server/catalog` is the single stated exception. docs/SPEC.md §6. A raw query in a server function is a tenancy hole, not a shortcut.               |
| "The Zod schema is obvious here, the caller is our own code."                     | Every server-function input is validated. "Our own code" includes anything a browser can post.                                                                                                                                          |
| "I'll just use a float here, it's only for display."                              | There is no display-only amount; the same value is exported, summed and audited. Amounts are integer minor units end to end, and `src/lib/money.ts` is the only place a decimal appears.                                                |
| "I'll recompute ref_amount from today's rate."                                    | A March expense is a March expense. Every amount that crossed the base-currency boundary carries the `rate_e10` it crossed at; recomputing it rewrites history and silently moves every total above it.                                 |
| "I need to touch one file outside Owned paths to make this work."                 | Then the decomposition is wrong, and that is a finding, not a licence. Report it in an issue comment — docs/SPEC.md §8 governs who gets that concept.                                                                                   |
| "I'll fix the failing test by relaxing the assertion."                            | The test is the spec. If the spec is wrong, say so explicitly in the PR body and leave the test red.                                                                                                                                    |

# RED FLAGS

If you find yourself doing any of these, **stop and report in the PR body** instead of proceeding.
None of them is a fix; each one is a signal that the change has gone somewhere it should not.

- Hand-editing `src/routeTree.gen.ts` or anything under `drizzle/` (regenerate: `pnpm generate-routes`, `pnpm db:generate`).
- Adding `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, or widening a type to `any` to get past a check.
- Deleting or weakening an assertion, or adding `test.skip` / `.only`.
- Editing files under `e2e/__screenshots__`, or passing `--update-snapshots`.
- Editing a file outside the issue's Owned paths.
- Adding a second way to do something the repo already has one way to do.

# COMMIT

Make a git commit. The commit message must:

1. Start with `RALPH:` prefix
2. Include task completed + PRD reference
3. Key decisions made
4. Files changed
5. Blockers or notes for next iteration

Keep it concise.

# THE ISSUE

If the task is not complete, leave a comment on the issue with what was done.

Do not close the issue - this will be done later.

Once complete, output <promise>COMPLETE</promise>.

# FINAL RULES

ONLY WORK ON A SINGLE TASK.
