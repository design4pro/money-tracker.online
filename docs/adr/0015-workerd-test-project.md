# 0015. A fourth vitest project running inside workerd

Status: accepted
Date: 2026-09-03

## Context

`vitest.config.ts` runs everything in plain Node, and SPEC §5 is why: bindings arrive as
arguments, so a repository takes a `Database` and a Durable Object takes a storage port. That
design is worth keeping. It makes almost the whole server testable in milliseconds, and a test
that hands in a fake says what it means far more clearly than one that boots a runtime.

Two things it cannot say anything about, and both fail in production and nowhere else.

**A Durable Object is not its interface.** `AccountLedger` is declared against
`AccountLedgerStorage` - `get` and `put`, both returning promises - and a fake satisfying that
interface proves the algorithm and nothing about the object. Real `storage.put` serialises with
the structured clone algorithm rather than `JSON.stringify`, so a record a fake accepts can be one
workerd refuses. And the class exists for its turn semantics: two requests to one id are two turns
rather than two racers. A single-threaded Node test cannot make that false, so it cannot test it
either. Before this project the class had no test at all.

**D1 is not the driver the repository tests use.** `src/server/repos/__tests__` applies the SQL in
`drizzle/` to a local SQLite and runs the repositories over it. That catches almost everything and
misses the class of failure where D1 itself rejects a statement, which is discovered on deploy.

`@cloudflare/vitest-pool-workers` is Cloudflare's own answer: it runs vitest files inside workerd
against the bindings `wrangler.jsonc` declares. Adding it means adding a dependency, and SPEC §3
freezes the dependency set precisely so that an agent run cannot install its way out of a problem.

## Decision

`@cloudflare/vitest-pool-workers` is added as a devDependency, and `vitest.config.ts` gains a
fourth project, `workerd`, alongside `ui`, `server` and `tooling`.

**Its scope is closed, not open.** The project takes only what a fake cannot reproduce: the
Durable Object's storage and turn semantics, and D1 accepting the SQL Drizzle generates. Files
opt in by name - `*.workerd.test.ts` - and the `server` project excludes exactly that suffix, so
the file name is what states which world a test expects. A test that could run in `server` belongs
in `server`; slowness is the reason, and "it is more realistic" is not an argument for moving one.

The migrations in `drizzle/` are read in Node by `readD1Migrations()`, passed in as a Miniflare
binding, and applied to the real D1 by `vitest.setup.workerd.ts`. That setup is itself the
assertion about generated SQL: a migration D1 rejects fails the suite before any test runs.

The pool needs an entry module exporting the Durable Object class, and the real entry
(`src/server/worker.ts`) pulls the whole TanStack Start application in behind it. So the wired
class moved to `src/server/do/account-ledger.ts`, which both entries re-export - the deployed one
because `wrangler.jsonc` names it as `main`, and `src/server/worker.workerd-entry.ts` because it
must import nothing else.

## What this costs

The `workerd` project boots a runtime, so it is slower than the other three by roughly the time
Miniflare takes to start - about a second, once, not per file. It is a fourth world to keep
configured: a binding added to `wrangler.jsonc` is a binding these tests get for free, but a
compatibility date drifting between `wrangler.jsonc` and the pool options is a difference nothing
else would notice.

It also weakens SPEC §3 by exactly one package, and the weakening is the point of writing this
down: the freeze is a rule about agent runs, not a claim that the pinned set is final. A stage
that wants a package still records it under `### Blockers` with a disposition. Changing the set is
a decision a human makes here, in an ADR, with the reason attached.

## Consequences

- SPEC §3 records the addition and cites this ADR.
- `src/server/do/account-ledger.ts` owns the wired class. `worker.ts` re-exports it and no longer
  builds a Drizzle handle of its own; `src/server/db/from-env.ts` does, for both the object and
  the cron, which are the two callers that run outside a request.
- The first thing the project found is fixed rather than recorded: a burst of requests to one live
  instance did not coalesce, because `serialise()` chained them and each pass cleared `running`
  before the next started, which left the coalescing branch reachable only from a record a
  previous instance had abandoned - and therefore from a pass that would never run, wedging the
  account permanently. The lock moved into memory (issue #22), where a Durable Object's turn
  semantics already make it safe, and this project is where the eviction that used to cause the
  wedge is now asserted.
- The queue consumer is not covered. It has no handler yet, so there is nothing to assert; it
  joins this project when it has one.
