# Money Tracker

The pilot tracks personal finances and uses [MoneyMatter v0.34.3](https://github.com/letehaha/moneymatter/tree/v0.34.3) as its upstream behavioral baseline. The project is licensed under the [GNU Affero General Public License v3.0](LICENSE). Preserve upstream copyright and license notices when reusing upstream code.

Operators who run a modified AGPL-covered version must prominently offer every user interacting with it over the network a way to get that deployed version's Corresponding Source over the network, at no charge, as required by section 13. Keep the offer available from the deployed service and point it to the exact revision named by `/health` as `sourceSha`. Provide the build and installation materials required by the license. Keep credentials and private operational data outside the source distribution.

## Local development

`apps/app` is the private finance application, `apps/site` serves the public landing page and private CMS, and `apps/factory` holds private delivery and operational data. Keep app financial records, CMS drafts and admin records, and factory audit and release records in separate bindings, with separate privileges and no cross-environment data reuse. Public source and the public landing page do not grant access to any of these records.

Use Node.js 24 and the lockfile in each npm project. Build and verification need no cloud accounts, credentials, or public DNS.

```sh
for package in apps/app apps/site apps/factory; do
  npm ci --prefix "$package" &&
  npm run check --prefix "$package" &&
  npm test --prefix "$package" &&
  npm run build --prefix "$package" || exit 1
done
npm ci --prefix scripts --ignore-scripts
npm test --prefix scripts
./scripts/node_modules/.bin/playwright install --with-deps chromium
node scripts/browser-fixture.mjs
GITHUB_SHA="$(git rev-parse HEAD)" bash scripts/ci-smoke.sh
```

The local smoke starts staging configurations in Wrangler's local runtime on ports 8787–8789, sets the synthetic `SOURCE_SHA`, `APP_URL` and `SIGN_IN_URL` bindings, and probes all three Workers. The URL defaults in `scripts/ci-smoke.sh` form the local route contract. See the package instructions for required synthetic binding values. Keep local `.dev.vars` files untracked.

## Repository readiness

Before enabling delivery, an operator must configure protected `main` to require reviewed pull requests, strict up-to-date `verify` and `factory/merge-gate` checks, and disable bypass for routine merges. Select the dedicated GitHub App as the expected source of `factory/merge-gate`. Configure the app with the least privileges needed by the factory. Treat edits to workflows, release scripts, and their required-check names as release-control changes requiring operator review. CI runs on the PR merge candidate with read-only permissions and no environment secrets. Where the protected base contains scenarios, CI also runs that copy against the candidate's package contracts and the synthetic rollback, auth and browser cases. Keep the independent factory check authoritative for approving merges.

An operator must create GitHub environments named `staging` and `production`, each restricted to protected `main`. Configure required production reviewers with self-review and administrative bypass disabled. Before approving a production job, confirm the full workflow SHA against the intended revision and the successful staging job's verified-release summary. Approval covers only that job and SHA. The pipeline rejects a stale SHA before starting deployment. Observation and alerting use a separate `production-monitoring` environment restricted to protected `main`.

## Delivery readiness

The protected-main workflow deploys staging first, then production from the same commit. The factory may advance or close a release issue only after the exact SHA's `deploy-production` job succeeds. A skipped, cancelled, or failed job is insufficient. An operator can dispatch delivery from `main` to retry the current SHA after resolving a failure.

Set these values separately in each GitHub delivery environment. Store delivery credentials only as environment secrets. Names and URLs below are synthetic examples. Set account IDs, names, paths, and credentials to match the approved resources before enabling the workflow.

| Value | Example or requirement |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Account that owns this environment's Workers and bindings |
| `APP_WORKER_NAME`, `SITE_WORKER_NAME`, `FACTORY_WORKER_NAME` | `money-app-staging`, `money-site-staging`, `money-factory-staging`; distinct production names |
| `APP_URL`, `SITE_URL`, `FACTORY_URL` | HTTPS origins such as `https://app-staging.example.com`; no paths |
| `SIGN_IN_URL` | Full URL on the app origin, for example `https://app-staging.example.com/sign-in` |
| `APP_PROTECTED_PATH`, `CMS_ADMIN_PATH` | Paths such as `/` and `/admin` for the operations under test |
| `CMS_UNAUTHENTICATED_STATUS` | Exact `401` or `403` expected from the application |
| `CLOUDFLARE_API_TOKEN` | Environment secret with scoped Worker deployment and app migration access |
| `{APP,SITE,FACTORY}_ACCESS_CLIENT_ID` and `{APP,SITE,FACTORY}_ACCESS_CLIENT_SECRET` | Paired environment secrets where a Worker probe crosses a Cloudflare Access policy |
| `PRODUCTION_CUTOVER_APPROVED` | Leave unset until first-cutover readiness is confirmed, then set to `true` in production. The required environment review still applies to each SHA. |

Before first cutover, inventory the existing Cloudflare Access applications, policies, service tokens, and routes together with the operators. Confirm the site landing remains public, and that smoke can exercise the app and CMS application auth boundaries without a user session. Access service tokens should grant only the edge access needed by probes. Provision staging bindings, verify staged migrations and rollback compatibility, then validate the separate production bindings and actual operator-managed secrets. Leave real payments disabled in default and unconfigured environments. Enabling live Polar credentials or real payments is a separate operator decision. The workflows do not set payment switches or seed live payment credentials.

The delivery script uses these package commands with each package's locked Wrangler. Deployment scripts must forward the appended Wrangler arguments to `wrangler deploy`, including the environment's Worker name and the full `SOURCE_SHA` runtime variable. Each Worker must expose `GET /health` with JSON `{"ok":true,"sourceSha":"<full Git SHA>"}`.

```sh
npm run migrate:staging --prefix apps/app
npm run deploy:staging --prefix apps/app -- --name "$APP_WORKER_NAME" --var "SOURCE_SHA:$GITHUB_SHA"
npm run deploy:staging --prefix apps/site -- --name "$SITE_WORKER_NAME" --var "SOURCE_SHA:$GITHUB_SHA"
npm run deploy:staging --prefix apps/factory -- --name "$FACTORY_WORKER_NAME" --var "SOURCE_SHA:$GITHUB_SHA"
node scripts/smoke.mjs "$GITHUB_SHA"
```

The production job uses the corresponding `migrate:production` and `deploy:production` scripts. Use the workflow for live delivery. Each environment needs an existing known-good deployment at 100% for each Worker before automatic delivery can begin. For brand-new Workers, an operator must establish that baseline in a separately approved bootstrap with staging and production access controls in place. Delivery records previous IDs before migration, fails on split or absent deployments, serializes releases and verifies active versions and live smoke. After a deploy or smoke failure, it attempts to restore every attempted Worker to the captured binary version and verifies the active version. Keep migrations compatible with both versions. A binary rollback never restores the database or reverses other external side effects. If the runner is cancelled or a rollback cannot be confirmed, use the captured version IDs and reconcile the active deployments before retrying.

## Monitoring readiness

In `production-monitoring`, configure the three HTTPS origins and any Access credentials using the same keys as delivery, plus `MONITOR_P95_MS` (synthetic example `1500`) and the scoped `FACTORY_ALERT_TOKEN` secret. Enable the probe with `MONITORING_ENABLED=true` once the factory accepts authenticated `POST /ops/alert` requests. Requests use bearer authentication and JSON with `correlationId`, `source`, and `evidence`. Evidence contains worker names, counts, timings, and thresholds. It excludes payloads, credentials and financial records.

The schedule samples each production `/health` five times to detect unavailability and synthetic 5xx responses and calculate nearest-rank p95. For Polar lag, set `POLAR_LAG_PATH` (for example `/ops/polar-lag`) only when the app supplies an authorized read-only signal returning `{"lagSeconds":42}`. Set the scoped `POLAR_SIGNAL_TOKEN` secret and `MONITOR_POLAR_LAG_SECONDS` (synthetic example `300`) together with the path. The workflow uses only that application signal for Polar lag.
