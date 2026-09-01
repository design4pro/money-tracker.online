# TASK

Review the code changes on branch `{{BRANCH}}` and improve code clarity, consistency, and maintainability while preserving exact functionality.

# CONTEXT

## Branch diff

!`git diff {{TARGET_BRANCH}}...{{BRANCH}}`

## Commits on this branch

!`git log {{TARGET_BRANCH}}..{{BRANCH}} --oneline`

# REVIEW PROCESS

1. **Understand the change**: Read the diff and commits above to understand the intent.

Then walk the five axes, in this order. The order is the priority: a correctness problem outranks
every readability note below it, and a diff with an unfixed `blocker` on any axis is not ready
regardless of how clean the rest reads.

2. **Correctness.** Look for anything dodgy. Stress-test edge cases: empty arrays, zero, negative
   numbers, nulls, race conditions, off-by-one, regressions in adjacent code. If you can break it,
   fix it. Are new behaviours covered by tests, at a seam that survives a refactor?

3. **Architecture.** Tenancy and layering are contract violations, not style: every new query goes
   through the tenant-scoped repository (`server/catalog` is the only exception, docs/SPEC.md §6);
   `components/ui` never imports `server/`; every server-function input is Zod-validated. Flag
   feature logic leaking into shared paths, and bespoke helpers where a canonical one exists.

4. **Security.** Unsafe casts and `any` at a boundary, injection risks, credential or PII leaks
   into logs and error messages, authorization checked in the component rather than the server
   function, a tenant id taken from client input instead of the session.

5. **Performance.** Only where the diff plausibly changes the shape of the work: a query inside a
   loop, an unbounded fetch, a new render path without memoization in a hot list, a synchronous
   call on the request path. Do not speculate about costs you have not reasoned through.

6. **Readability.** Reduce unnecessary complexity and nesting; eliminate redundant code and
   abstractions; avoid nested ternaries — prefer a switch or an if/else chain; choose clarity over
   brevity. Avoid over-simplification, overly clever solutions, or removing a helpful abstraction.

Label what you find, and let the label decide what you do with it:

- `blocker` — correctness, tenancy, layering or security. **Fix it on this branch.**
- `strong` — real debt on any axis. Fix it if it sits inside this diff; otherwise say so in the
  commit body rather than reaching outside the issue's Owned paths.
- `minor` — worth saying once, not worth churn. Say it, do not rewrite for it.

7. **Preserve functionality**: Never change what the code does - only how it does it.

If the change touches UI (components, routes, styles), the loop runs an advisory pixel-critic pass after validation — you do not need to arrange it, and the deterministic visual gate (Playwright snapshots) runs in the validation ladder right after you.

# EXECUTION

If you find improvements to make:

1. Make the changes directly on this branch
2. Run `pnpm typecheck`, `pnpm lint` and `pnpm test` to ensure nothing is broken
3. Commit with a `RALPH: Review -` prefix describing the refinements, naming the axis of each one

# VERIFICATION

Done is **docs/SPEC.md §7**; the bar for the code itself is @.sandcastle/CODING_STANDARDS.md. Read
them rather than working from memory — this prompt deliberately does not copy them.

If the code is already clean, well-tested, and handles edge cases properly, do nothing.

Once complete, output <promise>COMPLETE</promise>.
