# money-tracker.online

Multi-tenant SaaS personal finance manager on Cloudflare Workers (TanStack Start + React 19,
D1/Drizzle, KV, R2, Queues, one Durable Object). shadcn-shaped UI on **React Aria Components**,
not Radix. Package manager: pnpm. The stack is pinned — read `docs/SPEC.md` §3 before adding or
changing any dependency. There are no bank connectors and adding one is out of scope permanently
(`docs/adr/0008-no-bank-connectors.md`).

## Commands

- `pnpm dev` — dev server on :3000
- `pnpm typecheck` / `pnpm lint` / `pnpm test` — the fast feedback trio; run all three before committing
- `pnpm build` — production build (`CLOUDFLARE_ENV=staging pnpm build` for staging)
- `pnpm e2e` — Playwright visual, i18n and axe suites (needs local D1 migrations and the seed)
- `pnpm e2e:update` — re-record baselines for the current platform only
- `pnpm generate-routes` — regenerate the route tree; `src/routeTree.gen.ts` is generated, never hand-edit
- `pnpm db:generate` — generate a Drizzle migration; `drizzle/` is generated, never hand-edit
- `pnpm db:migrate:local` — apply migrations to the local D1

## Rules

- All SQL lives in `src/server/repos` and goes through the tenant-scoped base repository;
  `src/server/catalog` is the single stated exception. Full contract: `docs/SPEC.md` §6.
- **Money never leaves the integer minor-unit representation.** No float touches an amount at any
  layer, the scale is `currencies.digits` and never a hard-coded 2, and `ref_amount_minor` is a
  historical value that is never recomputed. Contract: `docs/MONEY.md`, cited by `docs/SPEC.md` §5.
- `components/ui` never fetches data and never imports from `server/`.
- Validate every server-function input with Zod, and parse it a second time in the repository.
  Named exports only (route modules excepted).
- Definition of done for any task: `docs/SPEC.md` §7. Decomposition rule ("one concept, one
  owner"): `docs/SPEC.md` §8. Accessibility conformance and what may be claimed: `docs/SPEC.md` §10.
- User-facing copy is never hardcoded — it lives in the EN + PL catalogue and a new key lands in
  both locales in the same change (the parity test enforces this; contract: `docs/SPEC.md` §9).
- Commits: Conventional Commits, in English. `RALPH:` prefixes are for in-loop agent commits only.

## Domain

Domain vocabulary lives in `CONTEXT.md` — a glossary and nothing else. Architecture decisions
live in `docs/adr/`. Arithmetic lives in `docs/MONEY.md`.

## Agent skills

- **Issue tracker**: GitHub Issues on `design4pro/money-tracker.online` — see `docs/agents/issue-tracker.md`
- **Triage labels**: see `docs/agents/triage-labels.md`
- **Domain docs**: see `docs/agents/domain.md`
- **Sharing a checkout** (measuring while somebody else edits): see `docs/agents/shared-checkout.md`
- **Reference product** (feature and quality benchmark; the clean-room rule applies): see
  `docs/agents/reference.md`

This repository has no agent orchestrator right now: sandcastle was removed and Cezar is not yet
ported (`docs/adr/0013-cezar-replaces-sandcastle.md`). Work is driven by hand until it is.

New work flows: grilling → `/to-spec-project` (PRD issue) → `/to-tickets-project` (vertical-slice
sub-issues) → `/implement-project` per ticket in a fresh context.
