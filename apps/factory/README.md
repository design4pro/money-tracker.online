# Money Tracker factory pilot

A Cloudflare Worker and one SQLite Durable Object per environment coordinate issue triage, planning, implementation, merge and post-deployment closure. Staging and production have separate Worker names and Durable Object storage. Both default to `MERGE_ENABLED=false`.

## Local commands

Use Node 22 or newer. These commands need no cloud account, DNS or credentials.

```sh
npm ci
npm run check
npm test
npm run build
```

The build is a Wrangler dry run. Operators deploy with `npm run deploy:staging` and `npm run deploy:production` after preparing the respective bindings. `GET /health` is a public liveness check. Monitor-authenticated `GET /ops/status` returns recent audit reasons, issue state and the current slot.

## Operator setup

1. Use fctl client, server and runner release 0.39.0 and a Codex connection. Bind the fctl project to only the pilot repository, use GitHub Issues as its tracker and configure its Issue events. The project’s GitHub access cap must permit push to the implementation session’s branch. Create the repository label `factory:parity`. Keep the setup credentials with the operator. Run the schedule reconciler once with the actual project ID and authenticated fctl CLI. It creates missing schedules paused, reconciles drift on paused schedules and prints the server-assigned IDs. Keep these stable and configure them in the matching Worker environment. Pause a drifted active schedule before editing it. Use a single operator for reconciliation.

   ```sh
   FACTORY_PROJECT_ID=prj_EXAMPLE npm run schedules
   fctl review settings -p prj_EXAMPLE --on --agent codex --rounds 3 --drafts off --instructions-file profiles/v1/review.md
   ```

   `prj_EXAMPLE` is synthetic. Set `FACTORY_FCTL_BIN` to the checksum-verified 0.39.0 binary path if it is outside PATH. Use the instance's project setup credentials and server in the operator shell. The controller does not alter fctl settings. Never run Plan or Implement manually on the dedicated controller schedules. The one-active guarantee covers work started by the controller in one environment. Point staging at an isolated fctl project and keep its merge gate disabled when using the production repository.

2. Configure the dedicated factory GitHub App installation on the pilot repository. The controller requests a repository-restricted installation token for Actions read, Checks write, Contents write, Issues write and Pull requests read. Metadata read is implicit. Use a different App from fctl's discovery and native review apps. Deliver signed Issues, Pull request, Pull request review, Check run and Workflow run events for this repository to `POST /webhooks/github`. For `main`, bind the required GitHub check `verify` to GitHub Actions and `factory/merge-gate` to the dedicated factory app. Keep bypass disabled for the app and enable stale approval dismissal and current-head protection. Use squash merging and disallow direct writes to `main` by automation. The delivery workflow must run on pushes to `main` and deploy the checked-out workflow head. If operators can merge outside the factory, disable GitHub's automatic closing of linked issues or keep closing links out of pilot PRs.

3. Configure the Worker variables and staged credentials below. Create a project-scoped fctl webhook for `POST /webhooks/fctl` with `session.finished,session.failed,session.stopped,session.question`, filtered to schedules. The unsigned fctl URL challenge only echoes the challenge. Install the generated secret before testing deliveries. The instance's native triage webhook and this Worker webhook are distinct. Confirm fctl's native `issue_opened` reports a started run and the expected bot identities/comment URLs in staging. Verify that the required CI check and native review appear on the SHA the controller will check.

4. Confirm the staging workflow, policy and staging bindings, then enable the schedules explicitly. A first run always leaves newly created schedules paused, even with this flag. Turn on `MERGE_ENABLED` only after confirming the required app-bound checks and branch rules. With the gate disabled the controller can still dispatch sessions and record gate failures.

   ```sh
   FACTORY_PROJECT_ID=prj_EXAMPLE npm run schedules -- --enable
   ```

## Runtime configuration

Configure vars per environment using the Wrangler configuration or the deployment environment's equivalent. The values below are **synthetic examples**, except for the pilot repo and fixed workflow/check names.

| Variable | Required value or example |
| --- | --- |
| `REPO`, `REPO_ID` | `design4pro/money-tracker.online` and the real numeric GitHub repository ID, e.g. `100` |
| `FCTL_SERVER`, `FCTL_WORKSPACE_ID`, `FCTL_PROJECT_ID`, `FCTL_ACCOUNT_ID` | HTTPS origin only, e.g. `https://fctl.example.invalid`, and IDs like `wsp_EXAMPLE`, `prj_EXAMPLE`, `usr_EXAMPLE`. The user ID owns both Worker PATs. |
| `TRIAGE_SCHEDULE_ID`, `PLAN_SCHEDULE_ID`, `IMPLEMENT_SCHEDULE_ID`, `OPS_SCHEDULE_ID` | Exact IDs from the reconciler, e.g. `sch_EXAMPLE` |
| `GITHUB_APP_ID`, `GITHUB_INSTALLATION_ID` | Dedicated merge app and installation IDs, e.g. `55` and `66` |
| `GITHUB_DISCOVERY_BOT_ID`, `GITHUB_TRIAGE_BOT_ID` | Numeric GitHub bot user IDs for discovery and fctl's ticket comments. They may be the same. |
| `GITHUB_ACTIONS_APP_ID`, `GITHUB_REVIEW_APP_ID` | Actual Check Run app IDs from GitHub Actions and the native fctl review app |
| `DELIVERY_SMOKE_STEP` or `DELIVERY_SMOKE_JOB` | Set exactly one. Use the exact step name inside `deploy-production`, `Deploy and smoke-test production`, or the exact name of a separate smoke job in the same attempt. Smoke failures must fail delivery. |
| `HUMAN_REVIEWER_IDS` | Comma-separated trusted human GitHub user IDs, e.g. `81,82`. Empty blocks sensitive and bootstrap PRs. |
| `BOOTSTRAP_PRS` | Optional, up to three explicit PR numbers, e.g. `12,13`. Each requires an allowlisted human's current-head approval, same-repo main base, `verify` and native fctl review on the same head. No issue is closed from this path. Removing an entry stops polling it. |
| `MERGE_ENABLED` | Explicitly `true` to publish the merge gate and enable merge requests. Disabled factories leave the check untouched. |

Install secrets through the environment's secret store. Use `FCTL_TOKEN` as a project-scoped expiring Run sessions PAT capped at push, and `FCTL_OPS_TOKEN` as a separate project-scoped Run sessions PAT capped at read. Set `FCTL_WEBHOOK_SECRET` to the Standard Webhooks `whsec_` secret, `GITHUB_WEBHOOK_SECRET` to the dedicated app's signing secret, `GITHUB_APP_PRIVATE_KEY` to the PKCS#8 private key and `OPS_TOKEN` to an independent high-entropy monitor token. Convert an operator-held PKCS#1 key to PKCS#8 before injecting it. For an Access-protected fctl origin, install both `FCTL_ACCESS_CLIENT_ID` and `FCTL_ACCESS_CLIENT_SECRET`. Never put these values in schedule prompts, Wrangler vars, shell history or tracked files. Local tests generate ephemeral fixtures.

Monitor requests use `Authorization: Bearer …` and a stable deduplication key. `POST /ops/alert` accepts JSON with a `key`, a `code` of `deploy-failed`, `smoke-failed`, `availability` or `pipeline-stalled`, and optional `head` SHA. A repeated key is accepted without another run. Send an authenticated alert or a signed GitHub event to start polling if enabling a bootstrap entry while the object is idle.

## Profile contract

| Profile | Native trigger and access | Evidence |
| --- | --- | --- |
| Parity | Monday 09:00 Europe/Warsaw, comment | Published MoneyMatter v0.34.3 at `2aae986ff5ad1da1dd8d967498b3b32d6ded413d`, exact deployed source, stable `feature_id` and at most three new issues with `factory:parity` applied at creation |
| Triage | Issue opened, by agents, triage | fctl event run with exact repo, issue number, event actor and session, plus a signed `ready` result and bot-authored issue comment |
| Plan | When asked, triage | Controller-supplied issue, feature, deployment SHA and triage comment ID, followed by a signed `planned` result with a bot-authored plan comment |
| Implement | When asked, push | Controller-supplied issue, feature, deployment SHA and plan comment ID. The signed `implemented` result names a same-repo PR on the dispatched session branch with the exact issue/session marker. |
| Review | Native Codex review, three rounds of findings passed back | fctl's latest review state is `passed`, zero new/open findings and a successful native check for the exact PR head. Neutral fails. |
| Ops | When asked, read | Allowlisted monitor code and optional SHA |
| Retro | Friday 10:00 Europe/Warsaw, read | One proposed improvement with a metric and a reproducible evaluation |

The versioned files in `profiles/v1` define the result lines. Triage, Plan and Implement put the compact v1 JSON at the very start of the final reply so it appears in signed `session.finished.data.message`. Status labels, issue prose and arbitrary comments confer no authority. Dedicated app path approval is conservative. Only UI component/style paths, dedicated locale JSON and Markdown under `docs/` qualify as routine, with sensitive names excluded. Everything outside that subset requires exact-head human approval.

The controller serializes claims, stores the fctl run and session, and rechecks GitHub on alarms. After an uncertain POST it reconciles run and initial session context via a generated invocation UUID. Because fctl starts the session before recording its run, an empty run history cannot establish that the POST failed. An unresolved implementation blocks the slot for operator investigation. A positively identified schedule-rate-limit response is retried with backoff. Operators can inspect `/ops/status`, the fctl schedule's runs and the exact sessions. No automatic override or slot reset is exposed. A matched merged PR holds the slot until a successful delivery attempt on `main` includes its actual merge commit and the configured smoke step or job succeeds.

The v0.39.0 release CLI and source were checked for schedule flags, run/event shapes, signed envelope, ticket comments and native review. The local Worker suite exercises real SQLite and alarms with mocked providers. Live provider permissions, subscriptions, workflow smoke naming and effective branch rules need to be confirmed in staging.

[fctl 0.39.0 automation](https://github.com/design4pro/fctl/blob/v0.39.0/docs/automation.md) · [Agent access](https://github.com/design4pro/fctl/blob/v0.39.0/docs/agents.md) · [Self-hosted GitHub setup](https://github.com/design4pro/fctl/blob/v0.39.0/docs/self-hosting.md) · [Cloudflare SQLite Durable Objects](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) · [GitHub merge API](https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request)

A release waiting for smoke becomes blocked if protected main has advanced past its merge SHA. It releases the factory slot and leaves the issue open. A later successful Delivery workflow can wake the blocked release for independent verification of exact-SHA production smoke.
