<!-- agent-gate-report -->

Head: `<full sha of the PR head>`
Status: green | red
Host: cursor-cloud-agent

| Rung       | Command                                                                   | Result                                    |
| ---------- | ------------------------------------------------------------------------- | ----------------------------------------- |
| route-tree | `pnpm generate-routes && git diff --exit-code -- src/routeTree.gen.ts`    | pass / fail                               |
| db-drift   | `pnpm db:generate < /dev/null && git diff --exit-code -- drizzle/`        | pass / fail                               |
| spec-index | `pnpm generate-spec-index && git diff --exit-code -- .ai/specs/README.md` | pass / fail                               |
| typecheck  | `pnpm typecheck …` (the command in `validation.commands`)                 | pass / fail                               |
| lint       | `pnpm lint`                                                               | pass / fail                               |
| unit       | `pnpm test`                                                               | pass / fail                               |
| build      | `pnpm build`                                                              | pass / fail                               |
| e2e        | `pnpm e2e --project=chromium --project=mobile-chromium`                   | pass / fail / skipped (docs-only, reason) |
| axe        | `pnpm exec tsx .github/a11y/axe-scan.mjs`                                 | pass / fail / skipped (docs-only, reason) |
| migrations | `node scripts/ci/assert-additive-migrations.mjs`                          | pass / fail                               |

Migrations: additive | none | fail

`om-approve-merge-pr` merges into `develop` only when Status is green, Head equals the current
SHA, and Migrations is additive or none. Re-post after every push.
