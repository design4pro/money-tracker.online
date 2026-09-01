# money-tracker.online

A multi-tenant SaaS personal finance manager on Cloudflare Workers: accounts, transactions,
budgets with rollover, recurring series, savings goals, automation rules, multi-currency
reporting and accessible analytics — with **manual entry and file import only**.

There are no bank connectors and there never will be. See `PRODUCT.md` and
`docs/adr/0008-no-bank-connectors.md` for why that is a product decision rather than a gap.

**Stack.** TanStack Start (React 19) on Cloudflare Workers · D1 + Drizzle · KV · R2 · Queues ·
one Durable Object (`AccountLedger`) · Tailwind 4 · shadcn-shaped components built on
**React Aria Components** · Better Auth (sessions in KV) · Polar for billing · Vitest +
Playwright + `@axe-core/playwright`. The dependency set is **pinned and frozen** — read
`docs/SPEC.md` §3 before adding or changing anything in `package.json`.

## Quickstart

```bash
pnpm install
cp .dev.vars.example .dev.vars      # runtime secrets read by the Worker
cp .env.local.example .env.local    # build-time VITE_* values read by Vite
pnpm db:migrate:local               # apply migrations to the local D1
pnpm dev                            # http://localhost:3000
```

`.dev.vars` and `.env.local` are two different files with two different readers, and mixing them
fails **silently**: while a `.dev.vars` exists Cloudflare loads no `.env` file into the Worker's
`env`, so a runtime secret placed in `.env.local` is `undefined` at request time; and a `VITE_*`
name placed in `.dev.vars` is an empty string at build time rather than an error. Both templates
repeat this warning next to the names it applies to.

The e2e suite needs a migrated local D1 and the seeded demo workspace
(`node scripts/seed/seed.mjs`). In CI and in the agent sandbox this is automated —
`.github/actions/e2e-env` and `.sandcastle/setup-e2e.sh` respectively.

## Scripts

| Script                  | What it does                                                                    |
| ----------------------- | ------------------------------------------------------------------------------- |
| `pnpm dev`              | Vite dev server with the Cloudflare plugin, on :3000                            |
| `pnpm build`            | Production build. `CLOUDFLARE_ENV=staging pnpm build` builds the staging Worker |
| `pnpm typecheck`        | `tsc --noEmit`                                                                  |
| `pnpm lint`             | ESLint. `pnpm lint:fix` writes                                                  |
| `pnpm test`             | Vitest (unit + repository). `pnpm test:watch`, `pnpm test:coverage`             |
| `pnpm e2e`              | Playwright: visual, i18n and accessibility suites. `pnpm e2e:ui` for the runner |
| `pnpm e2e:update`       | Re-record screenshot baselines **for the current platform only**                |
| `pnpm generate-routes`  | Regenerate `src/routeTree.gen.ts` — generated, never hand-edited                |
| `pnpm db:generate`      | Generate a Drizzle migration into `drizzle/` — generated, never hand-edited     |
| `pnpm db:migrate:local` | Apply migrations to the local D1                                                |
| `pnpm deploy`           | Build then `wrangler deploy` (production)                                       |
| `pnpm deploy:staging`   | `CLOUDFLARE_ENV=staging` build then deploy                                      |
| `pnpm sandcastle`       | Run the agent orchestration loop in the Docker sandbox                          |

`pnpm typecheck`, `pnpm lint` and `pnpm test` are the fast feedback trio: run all three before
committing. Two files in this repository are generated and a hand edit to either is a build
failure waiting to happen: `src/routeTree.gen.ts` and everything under `drizzle/`.

## Branch model

- Feature branches (`feat/*`, `fix/*`, `claude/*`, `sandcastle/*`) open a pull request to
  **`develop`**.
- Merging `develop` deploys **staging**: https://staging.money-tracker.online
  (`deploy-staging.yml`).
- Promotion is a pull request `develop` → **`main`**; merging deploys **production**:
  https://money-tracker.online (`deploy.yml`).
- `ci.yml` runs lint · typecheck · unit tests · build · the route-tree and migration drift checks
  on every pull request; the e2e visual gate runs on push and on PRs labelled `needs-e2e`.
- Screenshot baselines are per platform: `-darwin` recorded locally with `pnpm e2e:update`,
  `-linux` re-recorded through the manual **Update e2e baselines** workflow, which opens a
  reviewable pull request rather than committing to your branch.

Rationale: `docs/adr/0003-git-flow-develop-as-staging.md`.

## Deployment, in one paragraph

One Worker serves everything: the marketing site, the SSR application, every server function,
the Better Auth mount, the Polar webhook, the file and export routes, the queue consumer and four
cron handlers. The environment is chosen at **build** time (`CLOUDFLARE_ENV`), not at deploy time;
`wrangler.jsonc` is the Vite plugin's input and `dist/server/wrangler.json` is what `wrangler
deploy` actually reads. Resource ids are committed, secrets are not. The full first-provision
runbook — every `wrangler` command, every secret and how the product degrades when each one is
missing — is `docs/DEPLOY.md`.

## Working with agents

- Mention `@claude` on a GitHub issue and `claude.yml` implements it on a runner: branch cut from
  `develop`, pull request back to `develop`.
- `pnpm sandcastle` runs the local orchestration loop against issues labelled `ready-for-agent`.
- The backlog contract, label vocabulary and triage rules are `docs/agents/issue-tracker.md` and
  `docs/agents/triage-labels.md`.

## Documentation

| Document                | What it answers                                                        |
| ----------------------- | ---------------------------------------------------------------------- |
| `docs/SPEC.md`          | The master spec. Its numbered sections are cited across the whole repo |
| `docs/ARCHITECTURE.md`  | Runtime shape: request path, bindings, queues, crons, the ledger DO    |
| `docs/MONEY.md`         | The money contract. Load-bearing — read it before touching an amount   |
| `docs/DEPLOY.md`        | Provisioning and deploy runbook, with the live resource ids            |
| `docs/ACCESSIBILITY.md` | The conformance statement and exactly what is and is not claimed       |
| `docs/I18N.md`          | The EN + PL localisation contract                                      |
| `docs/SECURITY.md`      | Tenancy, secrets, redaction, data retention, sub-processors            |
| `docs/adr/`             | Why the hard-to-reverse decisions were made                            |
| `docs/plans/`           | The staged implementation backlog the agent fleet consumes             |
| `CONTRIBUTING.md`       | How to make a change here, human or agent                              |
