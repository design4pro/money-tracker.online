<!-- agent-gate-report -->

Head: `<full sha of the PR head>`
Status: green | red
Host: cursor-cloud-agent
Baseline-develop: `<full sha of origin/develop compared in this run>` (omit when Status is green and you did not compare)
New-failures: none | listed as `file › title [project]`

| Rung       | Command                                                                    | Result                               |
| ---------- | -------------------------------------------------------------------------- | ------------------------------------ |
| route-tree | `pnpm generate-routes && git diff --exit-code -- src/routeTree.gen.ts`     | pass / fail                          |
| db-drift   | `pnpm db:generate < /dev/null && git diff --exit-code -- drizzle/`         | pass / fail                          |
| spec-index | `pnpm generate-spec-index && git diff --exit-code -- .ai/specs/README.md`  | pass / fail                          |
| typecheck  | `pnpm typecheck …` (the command in `validation.commands`)                  | pass / fail                          |
| lint       | `pnpm lint`                                                                | pass / fail                          |
| unit       | `pnpm test`                                                                | pass / fail                          |
| build      | `pnpm build`                                                               | pass / fail                          |
| build-out  | `node scripts/ci/assert-build-output.mjs` (straight after the plain build) | pass / fail                          |
| e2e        | `pnpm e2e --project=chromium --project=mobile-chromium`                    | pass / fail / skipped (change-scope) |
| axe        | `pnpm exec tsx .github/a11y/axe-scan.mjs`                                  | pass / fail / skipped (change-scope) |
| migrations | `node scripts/ci/assert-additive-migrations.mjs`                           | pass / fail                          |

Migrations: additive | none | fail

`skipped (change-scope)` is allowed only when `node scripts/ci/change-scope.mjs` (with
`BASE_SHA=$(git merge-base origin/develop HEAD)` and `HEAD_SHA=$(git rev-parse HEAD)`) prints
`browser=false` for this head; say so in the Result cell. Any other skip is a failed rung.

`om-approve-merge-pr` merges into `develop` when Head equals the current SHA, Migrations is
additive or none, and **either** Status is green **or** New-failures is `none` against the
Baseline-develop SHA this comment recorded (same failing tests as `origin/develop` are allowed;
a new failing test is not). Re-post after every push.
