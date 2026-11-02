# money-tracker.online - project orientation

Read this first. It is a short sheet, not a spec. `AGENTS.md` is the authority; this file only
points at it.

## What it is

A multi-tenant SaaS personal finance manager on Cloudflare Workers: accounts, transactions, budgets,
recurring series, savings goals, automation rules, multi-currency reporting and accessible
analytics. Data enters by manual entry and file import only. Bank connectors are out of scope
permanently (`docs/adr/0008-no-bank-connectors.md`).

## Stack

- TanStack Start with React 19 on Cloudflare Workers (Vite build).
- D1 with Drizzle, KV, R2, Queues, and one Durable Object (`LEDGER`).
- Tailwind 4; shadcn-shaped UI built on React Aria Components (not Radix).
- Better Auth for sessions, Polar for billing, Zod for validation.
- Vitest (unit, repository, and a `workerd` project) and Playwright with axe for e2e.
- pnpm, Node >=24, oxlint, Prettier, TypeScript. The dependency set is frozen (`docs/SPEC.md` §3).

## Commands

- Dev server: `pnpm dev` (port 3000; agents in a shared checkout use 3011-3020).
- Typecheck: `pnpm typecheck`. Lint: `pnpm lint` (`pnpm lint:fix` writes).
- Unit and repository tests: `pnpm test` (`pnpm test:workerd` for the Worker project only).
- E2E: `pnpm e2e` (needs a migrated local D1 and the seeded demo workspace).
- Build: `pnpm build`.
- Regenerate: `pnpm generate-routes`, `pnpm db:generate`, `pnpm generate-spec-index`.
- Full validation gate: run the commands in `validation.commands` of `.ai/agentic.config.json`,
  in order. Stage changes (`git add -A`) first, because the generated-file diffs compare the index.

## Where things live

- `src/routes` - route modules; `src/routeTree.gen.ts` is generated.
- `src/server` - Worker code: `repos`, `fns`, `auth`, `ledger`, `queue`, `cron`, `billing`, `import`.
- `src/server/repos` - the only place for SQL, behind the tenant-scoped base repository.
- `src/components/ui` - primitives; `src/components/app` and `src/components/charts` build on them.
- `src/lib` - shared code: `money`, `i18n`, `plans.ts`, `failure*`.
- `drizzle/` - generated migrations; `wrangler.jsonc` - bindings.
- `e2e/` - Playwright specs; `docs/` - `SPEC.md`, `MONEY.md`, `I18N.md`, `ACCESSIBILITY.md`, `adr/`.
- `CONTEXT.md` (glossary), `DESIGN.md` (components), `SDLC.md` (delivery flow).

## Boundaries

- Money is integer minor units at every layer; the scale is `currencies.digits`, never a
  hard-coded 2. Never float arithmetic on an amount (`docs/MONEY.md`).
- SQL only in `src/server/repos`. Every server-function input is validated with Zod, and parsed
  again in the repository. A new repository function ships with a tenant-isolation test case.
- User-facing copy goes in the EN and PL catalogues in the same change (skill `i18n-messages`).
  No hardcoded strings, no `if (n === 1)` plurals.
- Never hand-edit `src/routeTree.gen.ts`, `drizzle/`, or `.ai/specs/README.md`; regenerate them.
  Migrations are additive.
- Never read `.env*`, `.dev.vars*`, or `.ai/qa/test-env.env`; a blocked read ends the run.
- Ask first before: adding or upgrading a dependency, a schema migration, any change to auth,
  tenant scoping, billing or the ledger, widening the accessibility claim, deleting or narrowing a
  test.
- Never: `--no-verify`, a force-push, `@ts-ignore` or lint-disable comments, `.skip`/`.only` on a
  test, a PNG or report inside the repository.
- Branches are `<type>/issue-<n>-<slug>` (or `<type>/<slug>` with no issue). Commits are
  Conventional Commits in English. PRs target `develop` and carry `Closes #<n>`.
- Push with an explicit refspec: `git push origin HEAD:refs/heads/<branch>`.
- In a worktree, every `Write` and `Edit` path starts at the worktree root.
- The rest of the rules are in `AGENTS.md`; read its Always, Ask First and Never sections.

## Verification

- Follow skill `verifying-changes` (`.claude/skills/verifying-changes/`) before claiming a change works.
- `pnpm test` is slow: `AGENTS.md` says 160-200 s, longer than the Bash tool's 120 s default.
  Pass `timeout: 600000` and write the output to a file.
- Re-run a failed test file alone before drawing conclusions.
