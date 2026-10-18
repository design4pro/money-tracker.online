# 0033. Pull-request verification runs on Cursor cloud agents; GitHub Actions only deploys

Status: accepted
Date: 2026-10-18
Amends: 0003, 0020, 0022, 0027, 0032

## Context

PR verification queued on the OVH `vps-ci-*` pool for every pull request (`ci.yml` verify / unit /
e2e, `a11y.yml`). That pool is shared, slow relative to a cloud-agent VM, and it blocked stacked
financial PRs (#752, #759, #757, #758) behind required checks that never started. The owner
decision is to stay on GitHub as the forge and to stop depending on GitHub Actions / VPS runners
for PR verification.

Deploys still need the VPS: `CLOUDFLARE_API_TOKEN` stays on machines the organisation runs
(ADR 0022). Staging must keep a smoke check so a merged commit is not "deployed" until
`/api/health` returns 200.

## Decision

1. **GitHub remains the forge.** Issues, pull requests, and branch protection stay on GitHub.
   Nobody in an agent run changes organisation or repository settings (rulesets, required checks,
   Actions enable/disable).
2. **Cursor cloud agents run the full gate** on their VM and post the result on the PR as a
   conversation comment marked `<!-- agent-gate-report -->` for the current head SHA. The rungs
   are every command in `.ai/agentic.config.json` → `validation.commands`, then
   `prVerification.buildCheck` (`node scripts/ci/assert-build-output.mjs`, the two assertions
   `ci.yml` made after its build: the route tree is untouched and the production build carries no
   pinned day), `prVerification.browserCommands` (`pnpm e2e` on `chromium` and `mobile-chromium`,
   and `pnpm exec tsx .github/a11y/axe-scan.mjs`; skipped only when
   `scripts/ci/change-scope.mjs` says `browser=false`), then
   `node scripts/ci/assert-additive-migrations.mjs`. The comment counts only when it is the newest
   one with the marker, written by an account in `prVerification.evidenceAuthors`, and the merge
   is made with `--match-head-commit` on that head.
3. **`om-pr-autopilot --allow-merge` merges into `develop` only** when that comment is
   **gate-green** on the current head and drizzle is an additive chain (unique journal `idx`,
   snapshot `prevId` equals the previous snapshot's `id`, no `DROP TABLE` / `DROP COLUMN` in SQL
   the branch added). After rebase, run `pnpm db:generate`. `main` stays owner-only.
4. **If `develop` is red** (staging deploy or smoke failed), open a fix or revert PR. Never
   commit straight to `develop`.
5. **GitHub Actions keeps only shipping.** `deploy-staging.yml` on push to `develop` (migrate,
   deploy, smoke). `deploy-production.yml` on push to `main`. `promote-develop.yml` still opens
   the promotion PR. `a11y.yml` is `workflow_dispatch` only. There is no `ci.yml`. No workflow
   queues `vps-ci-*` on `pull_request`.
6. **Required GitHub status checks are removed by the owner** after reviewing the PR that lands
   this record. Until then the merge button may stay blocked on contexts that never report.

## Consequences

- A pull request is merge-ready when the agent evidence comment is gate-green, labels allow it, and
  (until the owner acts) any leftover required checks are green or gone.

## Amendment 2026-10-18 (no new failures vs develop)

Owner decision the same day: a red `<!-- agent-gate-report -->` may still be **gate-green for
merge-to-develop** when the agent ran the same commands on `origin/develop`
(`.ai/agentic.config.json` → `prVerification.baselineRef`) and the PR adds **no new failing
tests** (`New-failures: none`, `Baseline-develop: <that SHA>`). `Status` stays the raw result
(`red` if any rung failed). Identical failures on the baseline are allowed so a docs/CI PR is
not blocked by a red `develop` tip; a new failure is not. A broken `develop` still needs its own
fix or revert PR (decision 4). `main` stays owner-only.

- Staging deploys without a second Actions unit/e2e run on the push. Quality was judged on the
  PR. The smoke check is what proves the new Worker is serving.
- Two green PRs can still break `develop` together (ADR 0032). The repair is a fix or revert PR,
  not a direct push.
- The VPS pool is reserved for deploys, promotion-PR opening, and an optional dispatched axe
  scan. Artifact-quota incidents from PR coverage/blob reports stop.
