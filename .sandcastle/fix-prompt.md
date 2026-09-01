# VALIDATION FAILED — fix attempt {{ATTEMPT}}/{{BUDGET}}

You are the same implementer session, resumed. The deterministic validation ladder rejected your work:

```
{{FAILURE_DIGEST}}
```

# RULES

- NEVER run `--update-snapshots` or edit files under `e2e/__screenshots__`. An unexpected snapshot diff is a regression in your change — fix the code, not the baseline. (Intended visual changes are handled by the orchestrator when the issue declares them.)
- NEVER weaken, skip, or delete a test to make it pass. The test is the spec.
- A failure that is a pure **TIMEOUT with no pixel count and no assertion diff** is machine load, not code — rerun the failing step once before changing anything.
- A **whole suite failing on one repeated error shape** (e.g. 504 "Outdated Optimize Dep", every authenticated spec skipping) is dev-server state: `rm -rf node_modules/.vite`, rerun.
- Stay inside the issue's Owned paths.

# RATIONALIZATIONS

You have {{BUDGET}} attempts and this is number {{ATTEMPT}}. Every one of these thoughts spends one
and gets you no closer.

| What you will think                                    | What is actually true                                                                                                                           |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| "Same failure again, I'll rerun and hope."             | You get **one** rerun, and only for a bare TIMEOUT (no pixel count, no assertion diff). A second identical red is your change.                  |
| "The digest is truncated, I'll guess what it means."   | The full logs are in the sandbox: `/tmp/validate-<step>.log`, and Playwright's report in `test-results/`. Read the real failure before editing. |
| "The screenshot moved by a few pixels, close enough."  | Not your call from here. An undeclared pixel diff is a regression; the orchestrator handles declared ones. Fix the code.                        |
| "Faster to rewrite the whole thing than find the bug." | The ladder was green on everything else. A rewrite throws away the parts that already passed and buys a new set of failures.                    |
| "I'll widen the type / add `any` to clear typecheck."  | That converts one visible failure into an invisible one.                                                                                        |
| "The fix belongs in a file outside Owned paths."       | Say that, in your result. Reaching outside is what makes two issues collide at merge.                                                           |
| "I'll delete the assertion that fails."                | The test is the spec. If the spec is wrong, leave it red and say why.                                                                           |

# VERIFICATION

The bar has not changed because the ladder went red: **docs/SPEC.md §7** and
@.sandcastle/CODING_STANDARDS.md still define done.

# PROCESS

1. Reproduce the smallest failing signal (single test file / single spec) before editing.
2. Fix, then run the relevant fast checks (`pnpm typecheck`, the failing tests).
3. Commit with a `RALPH: fix —` prefix describing what was wrong and what changed.
4. Output <promise>COMPLETE</promise>.

Do not re-run the full ladder yourself — the orchestrator re-validates after you finish.
