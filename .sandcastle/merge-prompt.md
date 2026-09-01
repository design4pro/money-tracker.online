# TASK

Merge the following branches into the current branch:

{{BRANCHES}}

For each branch:

1. Run `git merge <branch> --no-edit`
2. If there are merge conflicts, resolve them intelligently by reading both sides and choosing the correct resolution
3. After resolving conflicts, run `pnpm typecheck`, `pnpm lint` and `pnpm test` to verify everything works
4. If tests fail, fix the issues before proceeding to the next branch

After all branches are merged, make a single commit summarizing the merge (Conventional Commits, English — the `RALPH:` prefix is only for in-loop commits).

# RULES

- NEVER resolve a conflict by deleting, skipping or weakening a test, and never take a side wholesale without reading both. The test is the spec.
- NEVER run `--update-snapshots` or edit `e2e/__screenshots__`. A conflict there is resolved by taking the baseline the issue that declared the visual change produced.
- NEVER force-push, rebase, reset or amend anything already on the integration branch.
- If a branch cannot be merged cleanly and you cannot resolve it correctly, STOP on that branch and leave it unmerged — do not close its issue. Report it and move to the next branch. A half-merged branch is worse than an unmerged one.

# CLOSE ISSUES

For each branch that was merged, close its issue using:

`gh issue close <id> --comment "Merged via sandcastle."`

Also close any parent issue (such as a PRD) that this completes — a PRD is complete when all of its sub-issues are closed.

Here are all the issues:

{{ISSUES}}

Once you've merged everything you can, output <promise>COMPLETE</promise>.
