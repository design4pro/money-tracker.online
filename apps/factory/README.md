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

1. Use fctl client, server and runner release 0.39.0 and a Codex connection. Bind the fctl project to only the pilot repository, use GitHub Issues as its tracker and configure its Issue events. The project’s GitHub access cap must permit push to the implementation session’s branch. Ensure both `factory:parity` and `type: feature` exist. Keep the setup credentials with the operator. Run the schedule reconciler once with the actual project ID and authenticated fctl CLI. It creates missing schedules paused, reconciles drift on paused schedules and prints the server-assigned IDs. Keep these stable and configure them in the matching Worker environment. Pause a drifted active schedule before editing it. Use a single operator for reconciliation.

   ```sh
   FACTORY_PROJECT_ID=prj_EXAMPLE npm run schedules
   fctl review settings -p prj_EXAMPLE --on --agent codex --rounds 3 --drafts off --instructions-file profiles/v1/review.md
   ```

   `prj_EXAMPLE` is synthetic. Set `FACTORY_FCTL_BIN` to the checksum-verified 0.39.0 binary path if it is outside PATH. Use the instance's project setup credentials and server in the operator shell. The controller does not alter fctl settings. Leave the dedicated Maintainer Triage, Plan and Implement schedules for controller dispatch. The one-active guarantee covers work started by the controller in one environment. Point staging at an isolated fctl project and keep its merge gate disabled when using the production repository.

2. Configure the dedicated factory GitHub App installation on the pilot repository. The controller requests a repository-restricted installation token for Actions read, Checks write, Contents write, Issues write and Pull requests read. Metadata read is implicit. Use a different App from fctl's discovery and native review apps. Deliver signed Issues, Pull request, Pull request review, Check run and Workflow run events for this repository to `POST /webhooks/github`. For `main`, bind the required GitHub check `verify` to GitHub Actions and `factory/merge-gate` to the dedicated factory app. Keep bypass disabled for the app and enable stale approval dismissal and current-head protection. Use squash merging and disallow direct writes to `main` by automation. Delivery starts after successful push CI on `main` and deploys the checked-out workflow head. If operators can merge outside the factory, disable GitHub's automatic closing of linked issues or keep closing links out of pilot PRs.

3. Configure the Worker variables and staged credentials below. Create a project-scoped fctl webhook for `POST /webhooks/fctl` with `session.finished,session.failed,session.stopped,session.question`, filtered to schedules. The unsigned fctl URL challenge only echoes the challenge. Install the generated secret before testing deliveries. The instance's native triage webhook and this Worker webhook are distinct. Confirm fctl's native `issue_opened` reports a started run and the expected actor, bot identities and comment URLs in staging. Verify that the required CI check and native review appear on the SHA the controller will check.

4. Confirm staging bindings and keep `MERGE_ENABLED=false` in staging when using the live repository. Use a fresh test issue and route its signed events to one controller environment. Separate fctl projects alone do not prevent duplicate intake if both projects listen for the same issue-opening events.

## Maintainer intake rollout

1. Reconcile schedules without `--enable`. Confirm the existing `TRIAGE_SCHEDULE_ID` still points to native `issue-opened --by agents` with `factory:parity` and limits of 3 per hour and 10 per day. Bind the new paused `money-tracker-online-factory-maintainer-triage-v1` ID as `MAINTAINER_TRIAGE_SCHEDULE_ID` in the matching Worker environment. Confirm it is when-asked with Codex, triage access and base `main`. Set `HUMAN_REVIEWER_IDS` to the reviewed numeric IDs that can initiate feature work and approve sensitive PRs. After review and merge, deploy the approved Worker revision through the operator's normal process and confirm its exact source SHA at `/health`.
2. With production off, explicitly resume Maintainer Triage, Plan and Implement by ID. Ops can also be resumed if the read-only monitor path is configured. Leave Parity discovery and native parity Triage paused until exact production deployment evidence is available. Retro can remain paused until its separate report path is verified. The reconciler's `--enable` resumes all existing schedules, so use individual resumes for this rollout.

   ```sh
   fctl schedules resume "$MAINTAINER_TRIAGE_SCHEDULE_ID" -p "$FACTORY_PROJECT_ID"
   fctl schedules resume "$PLAN_SCHEDULE_ID" -p "$FACTORY_PROJECT_ID"
   fctl schedules resume "$IMPLEMENT_SCHEDULE_ID" -p "$FACTORY_PROJECT_ID"
   ```

3. Have an allowlisted maintainer open a fresh in-scope issue with `type: feature` in the opening request. Confirm the signed GitHub delivery and the controller's token-triggered run on the Maintainer Triage schedule. Match the repo, issue, actor and issue snapshot digest in the run's initial context. In `/ops/status`, match the triage run/session, the sole active issue slot and the verified main SHA, then match the Plan and Implement runs and their issue snapshot digests. Confirm the resulting PR belongs to the dispatched session and native review checks the current PR head SHA. With merge disabled, stop the smoke exercise at the reviewed PR. A feature opening by a writer outside the allowlist starts neither a maintainer triage run nor a native parity triage run.

4. Production delivery still requires the existing `PRODUCTION_DELIVERY_ENABLED` opt-in and cutover controls. Enable the production merge gate only after operator approval and verification of the required app-bound checks and branch rules. After merge, compare the ticket's `merge` and GitHub's `merge_commit_sha` to the Delivery attempt's `head_sha` on `main`. Verify that attempt's production deploy job and configured smoke step or job passed for that exact SHA before expecting a `closed` ticket. A later successful deployment of a different SHA cannot close it. Pause Maintainer Triage, Plan and Implement to stop fresh maintainer dispatches while diagnosing a rollout issue.

## Runtime configuration

Configure vars per environment using the Wrangler configuration or the deployment environment's equivalent. The values below are **synthetic examples**, except for the pilot repo and fixed workflow/check names.

| Variable | Required value or example |
| --- | --- |
| `REPO`, `REPO_ID` | `design4pro/money-tracker.online` and the real numeric GitHub repository ID, e.g. `100` |
| `FCTL_SERVER`, `FCTL_WORKSPACE_ID`, `FCTL_PROJECT_ID`, `FCTL_ACCOUNT_ID` | HTTPS origin only, e.g. `https://fctl.example.invalid`, and IDs like `wsp_EXAMPLE`, `prj_EXAMPLE`, `usr_EXAMPLE`. The user ID owns both Worker PATs. |
| `MAINTAINER_TRIAGE_SCHEDULE_ID` | Exact ID of the dedicated when-asked Maintainer Triage schedule. Required for maintainer intake. |
| `TRIAGE_SCHEDULE_ID`, `PLAN_SCHEDULE_ID`, `IMPLEMENT_SCHEDULE_ID`, `OPS_SCHEDULE_ID` | Exact IDs from the reconciler, e.g. `sch_EXAMPLE` |
| `RETRO_SCHEDULE_ID`, `RETRO_ENABLED` | Use the reconciler’s read-only when-asked Retro ID. Set `RETRO_ENABLED=true` in production only after verifying the schedule and project-scoped operations token. |
| `GITHUB_APP_ID`, `GITHUB_INSTALLATION_ID` | Dedicated merge app and installation IDs, e.g. `55` and `66` |
| `GITHUB_DISCOVERY_BOT_ID`, `GITHUB_TRIAGE_BOT_ID` | Numeric GitHub bot user IDs for discovery and fctl's ticket comments. They may be the same. |
| `GITHUB_ACTIONS_APP_ID`, `GITHUB_REVIEW_APP_ID` | Actual Check Run app IDs from GitHub Actions and the native fctl review app |
| `DELIVERY_SMOKE_STEP` or `DELIVERY_SMOKE_JOB` | Set exactly one. Use the exact step name inside `deploy-production`, `Deploy and smoke-test production`, or the exact name of a separate smoke job in the same attempt. Smoke failures must fail delivery. |
| `HUMAN_REVIEWER_IDS` | Comma-separated trusted human GitHub user IDs, e.g. `81,82`. Empty disables maintainer intake and blocks approval for sensitive and bootstrap PRs. |
| `BOOTSTRAP_PRS` | Optional, up to three explicit PR numbers, e.g. `12,13`. Each requires an allowlisted human's current-head approval, same-repo main base, `verify` and native fctl review on the same head. No issue is closed from this path. Removing an entry stops polling it. |
| `MERGE_ENABLED` | Explicitly `true` to publish the merge gate and enable merge requests. Disabled factories leave the check untouched. |

Install secrets through the environment's secret store. Use `FCTL_TOKEN` as a project-scoped expiring Run sessions PAT capped at push, and `FCTL_OPS_TOKEN` as a separate project-scoped Run sessions PAT capped at read. Set `FCTL_WEBHOOK_SECRET` to the Standard Webhooks `whsec_` secret, `GITHUB_WEBHOOK_SECRET` to the dedicated app's signing secret, `GITHUB_APP_PRIVATE_KEY` to the PKCS#8 private key and `OPS_TOKEN` to an independent high-entropy monitor token. Convert an operator-held PKCS#1 key to PKCS#8 before injecting it. For an Access-protected fctl origin, install both `FCTL_ACCESS_CLIENT_ID` and `FCTL_ACCESS_CLIENT_SECRET`. Never put these values in schedule prompts, Wrangler vars, shell history or tracked files. Local tests generate ephemeral fixtures.

Monitor requests use `Authorization: Bearer …` and a stable deduplication key. `POST /ops/alert` accepts JSON with a `key`, a `code` of `deploy-failed`, `smoke-failed`, `availability` or `pipeline-stalled`, and optional `head` SHA. A repeated key is accepted without another run. Send an authenticated alert or a signed GitHub event to start polling if enabling a bootstrap entry while the object is idle.

## Profile contract

| Profile | Native trigger and access | Evidence |
| --- | --- | --- |
| Parity | Monday 09:00 Europe/Warsaw, comment | Published MoneyMatter v0.34.3 at `2aae986ff5ad1da1dd8d967498b3b32d6ded413d`, exact deployed source, stable `feature_id` and at most three new issues with `factory:parity` applied at creation |
| Triage | Issue opened, by agents, `factory:parity`, triage | fctl event run with exact repo, issue number, event actor and session, plus a signed `ready` result and bot-authored issue comment |
| Maintainer Triage | When asked, triage | Signed opening and independently verified current issue, author and snapshot before token dispatch. Exact run/session join and signed `ready` result with a bot-authored issue comment. |
| Plan | When asked, triage | Controller-supplied issue, provenance evidence and triage comment ID, followed by a signed `planned` result with a bot-authored plan comment |
| Implement | When asked, push | Controller-supplied issue, provenance evidence and plan comment ID. The signed `implemented` result names a same-repo PR on the dispatched session branch with the exact issue/session marker. |
| Review | Native Codex review, three rounds of findings passed back | fctl's latest review state is `passed`, zero new/open findings and a successful native check for the exact PR head. Neutral fails. |
| Ops | When asked, read | Allowlisted monitor code and optional SHA |
| Retro | When asked, read. Production Worker Cron requests it Friday 09:00 UTC. | Bounded digest and read-only GitHub evidence. Compare issue-to-verified-production time, first native review outcomes, and production failure share against the preceding week. Give denominators and propose one measurable improvement. |

The versioned files in `profiles/v1` define the result lines. Triage, Plan and Implement put the compact v1 JSON at the very start of the final reply so it appears in signed `session.finished.data.message`. For maintainer provenance, the signed opening delivery must identify an allowlisted GitHub User as both issue author and sender. The Worker verifies the open issue from GitHub, hashes the opening title, body and required `type: feature` classification, before queuing the dedicated Maintainer Triage run. It rechecks the same snapshot before dispatching Plan or Implement. Before starting a queued Plan or Implement run, the Worker also rechecks its required Triage or Plan comment. Missing or invalid evidence blocks dispatch and frees any claimed slot. A dispatch whose POST outcome is uncertain still follows run reconciliation. After Implement starts, only a signed maintainer pre-work evidence block with no recorded PR and a corroborated GitHub mismatch frees the slot. Other blocked Implement results retain the claim. Changes to unrelated labels are allowed. After exact-SHA production smoke, release uses the recorded numeric author ID and rechecks the snapshot before closing an open maintainer issue. If the issue is gone, moved, or its identity or snapshot has changed, release frees the slot without closing the issue. Transient lookup errors are retried. The validated GitHub main ref SHA is planning context. Parity provenance still requires the exact discovery marker and production evidence. Status labels, issue prose and arbitrary comments confer no authority. Dedicated app path approval is conservative. Only UI component/style paths, dedicated locale JSON and Markdown under `docs/` qualify as routine, with sensitive names excluded. Everything outside that subset requires exact-head human approval.

The controller serializes claims, stores the fctl run and session, and rechecks GitHub on alarms. After an uncertain POST it reconciles run and initial session context via a generated invocation UUID. Because fctl starts the session before recording its run, an empty run history cannot establish that the POST failed. An unresolved implementation blocks the slot for operator investigation. A positively identified schedule-rate-limit response is retried with backoff. Operators can inspect `/ops/status`, the fctl schedule's runs and the exact sessions. No automatic override or slot reset is exposed. A matched merged PR holds the slot until a successful delivery attempt on `main` includes its actual merge commit and the configured smoke step or job succeeds.

The production Worker has a Friday 09:00 UTC Cron that stays inactive until explicitly configured. Use the reconciler on the existing paused RETRO schedule to switch it from native Cron to when-asked while retaining its ID. The parity schedule keeps its native Monday trigger. Leave fctl credentials out of all agent sandboxes. The Worker reuses its scoped `FCTL_OPS_TOKEN` to read the project's retrospective pages and start the verified read-only Retro schedule from a separate Durable Object that makes no GitHub requests.

The weekly key uses the scheduled window end rather than delivery time. The Worker examines up to three pages of 20 reports and forwards up to 24 outcomes recorded in the preceding seven days, with up to three allowlisted technical insights per entry. It drops raw prose and identifying data, reports when the sample is capped, and does not retain unredacted results in the Durable Object. Repeated triggers reuse the same weekly dispatch. The read-only profile posts its proposal in its session.

The v0.39.0 release CLI and source were checked for schedule flags, run/event shapes, signed envelope, ticket comments and native review. The local Worker suite exercises real SQLite and alarms with mocked providers. Live provider permissions, subscriptions, workflow smoke naming and effective branch rules need to be confirmed in staging.

[fctl 0.39.0 automation](https://github.com/design4pro/fctl/blob/v0.39.0/docs/automation.md) · [Agent access](https://github.com/design4pro/fctl/blob/v0.39.0/docs/agents.md) · [Self-hosted GitHub setup](https://github.com/design4pro/fctl/blob/v0.39.0/docs/self-hosting.md) · [Cloudflare SQLite Durable Objects](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) · [GitHub merge API](https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request)

A release waiting for smoke becomes blocked if protected main has advanced past its merge SHA. It releases the factory slot and leaves the issue open. A later successful Delivery workflow can wake the blocked release for independent verification of exact-SHA production smoke. The factory indexes successful GitHub Actions production checks on the exact SHA and verifies their linked job and Delivery attempt. A failed rerun leaves earlier successful smoke evidence available. A bounded lookup resumes on later alarms when the evidence spans multiple pages or candidates.
