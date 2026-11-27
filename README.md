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

The smoke applies the app's D1 migrations into disposable local state. It seeds a separate local D1 through Astro dev on loopback port 8790, stops that process, and starts the built site against the same state. It then checks SHA and health on the app (3000), site (8788), and factory (8789). It checks public `/login` and `/register`, the signed-out `/billing` redirect, and a 403 from the built site's `/_emdash/admin` using synthetic Access settings without a user token. Playwright checks the published homepage and its sign-in link. Use a clean checkout or synthetic-only local configuration for smoke.

## Repository readiness

Before enabling delivery, an operator must configure protected `main` to require reviewed pull requests, strict up-to-date `verify` and `factory/merge-gate` checks, and disable bypass for routine merges. Select the dedicated GitHub App as the expected source of `factory/merge-gate`. Configure the app with the least privileges needed by the factory. Treat edits to workflows, release scripts, and their required-check names as release-control changes requiring operator review. CI runs on the PR merge candidate with read-only permissions and no environment secrets. Where the protected base contains scenarios, CI also runs that copy against the candidate's package contracts and the synthetic rollback, auth and browser cases. Keep the independent factory check authoritative for approving merges.

An operator must configure GitHub environments named `staging` and `production`, each restricted to protected `main`. Configure required reviewers on the `production` environment. Sensitive changes and first production cutover require explicit operator approval. For first cutover, confirm the exact SHA in the successful staging job's verified-release summary before setting the SHA-scoped approval below. The pipeline rejects a stale SHA before starting deployment. Observation and alerting use a separate `production-monitoring` environment restricted to protected `main`.

## Delivery readiness

Delivery starts when push CI on protected main succeeds and its exact SHA still matches the tip. It deploys staging first and can then deploy production from that same commit. The staging factory closes a release issue after the exact merge SHA's `deploy-staging` job and its `Deploy and verify staging` step succeed. Production release and parity evidence still require `deploy-production` and `Deploy and smoke-test production` for the exact SHA. See the [factory runbook](apps/factory/README.md) for staged rollout. A skipped, cancelled, or failed job is insufficient. An operator can dispatch Delivery from `main` with its full current SHA as the `head` input after enabling production or resolving a failure. The retry requires successful push CI for that SHA.

Production delivery skips by default. After provisioning the production environment and approving its catalog, set the repository variable `PRODUCTION_DELIVERY_ENABLED` to `true` under **Settings → Secrets and variables → Actions → Variables**. Leave it unset or set it to `false` to skip production. The production environment approval and first-cutover SHA checks still apply.

Set these values separately in each GitHub delivery environment. Store delivery credentials only as environment secrets. Names and URLs below are synthetic examples. Set account IDs, names, paths, and credentials to match the approved resources before enabling the workflow.

| Value | Example or requirement |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Account that owns this environment's Workers and bindings |
| `APP_WORKER_NAME`, `SITE_WORKER_NAME`, `FACTORY_WORKER_NAME` | `money-app-staging`, `money-site-staging`, `money-factory-staging`; distinct production names |
| `APP_ORIGIN` | Canonical app origin for auth, API origin checks, and landing CTAs. Set to `https://app.money-tracker.online` in production. |
| `SITE_ORIGIN` | Canonical landing origin for SEO. Set to `https://money-tracker.online` in production. |
| `APP_URL`, `SITE_URL`, `FACTORY_URL` | HTTPS origins allowed for smoke probes. These can be temporary verification hosts. |
| `D1_DATABASE_ID`, `EMAIL_FROM` | App D1 UUID and verified sender. |
| `POLAR_MONTHLY_PRODUCT_ID`, `POLAR_YEARLY_PRODUCT_ID` | Distinct product UUIDs supplied by the operator for the target environment. |
| `SITE_D1_DATABASE_ID`, `SITE_CACHE_KV_ID`, `SITE_SESSION_KV_ID`, `SITE_MEDIA_BUCKET` | Dedicated CMS D1, two KV namespaces, and private R2 bucket. Use separate bindings per environment. |
| `CF_ACCESS_TEAM_DOMAIN` | Team hostname used for the CMS application. Store `CF_ACCESS_AUDIENCE` as a site Worker secret. |
| `SIGN_IN_URL` | Full sign-in URL on `APP_ORIGIN`, for example `https://app-staging.example.com/login` |
| `APP_PROTECTED_PATH`, `CMS_ADMIN_PATH` | Paths `/billing` and `/_emdash/admin` for the operations under test |
| `CMS_UNAUTHENTICATED_STATUS` | Optional exact `401` or `403`. Leave unset to allow either status, the same-origin CMS login redirect, or a deployed `302` to the `CF_ACCESS_TEAM_DOMAIN` login route for the `SITE_URL` hostname with `redirect_url` set to `CMS_ADMIN_PATH`. |
| `CMS_LOGIN_URL` | Optional same-origin CMS login URL or path, default `/_emdash/admin/login` |
| `CLOUDFLARE_API_TOKEN` | Environment secret with scoped Worker deployment and app migration access |
| `{APP,SITE,FACTORY}_ACCESS_CLIENT_ID` and `{APP,SITE,FACTORY}_ACCESS_CLIENT_SECRET` | Paired environment secrets where a Worker probe crosses a Cloudflare Access policy |
| `PRODUCTION_CUTOVER_SHA` | In production, set to the full staged SHA explicitly approved for initial cutover or a later rollout with any missing Worker baseline. |
| `PRODUCTION_CUTOVER_COMPLETE` | Leave unset through initial verification and route cutover. After the operator confirms both, set to `true` and clear `PRODUCTION_CUTOVER_SHA` for routine releases with existing baselines. |

Before first cutover, inventory the existing Cloudflare Access applications, policies, service tokens, and routes together with the operators. Confirm the site landing remains public, and that smoke can exercise the app and CMS application auth boundaries without a user session. Access service tokens should grant only the edge access needed by probes. Provision staging bindings, verify staged migrations and rollback compatibility, then validate the separate production bindings and actual operator-managed secrets. Leave real payments disabled in default and unconfigured environments. Enabling live Polar credentials or real payments is a separate operator decision. The workflows do not set payment switches or seed live payment credentials.

The delivery script uses these package commands with each package's locked Wrangler. The app and site scripts consume `SOURCE_SHA` from the environment and forward `--name` to Wrangler. The factory consumes the forwarded `--name` and `--var SOURCE_SHA:…`. Keep operator-managed variables in environment bindings and secrets in the environment secret store. The staging factory release target and smoke step are versioned with its Worker. Each Worker must expose `GET /health` with JSON `{"ok":true,"sourceSha":"<full Git SHA>"}`.

```sh
npm run migrate:staging --prefix apps/app
export SOURCE_SHA="$GITHUB_SHA" APP_ORIGIN
npm run deploy:staging --prefix apps/app -- --name "$APP_WORKER_NAME"
SITE_URL="$SITE_ORIGIN" npm run deploy:staging --prefix apps/site -- --name "$SITE_WORKER_NAME"
npm run deploy:staging --prefix apps/factory -- --name "$FACTORY_WORKER_NAME" --var "SOURCE_SHA:$GITHUB_SHA"
node scripts/smoke.mjs "$GITHUB_SHA"
```

For the first rollout, provision approved verification endpoints that reach the candidate Workers separately from the live public routes. The standard package configs disable workers.dev and preview URLs. The initial production preflight rejects public routes and custom domains in Wrangler config. Use the standard package config with no route or domain flags in the deploy scripts, and keep route provisioning permissions with the operator. Before changing any public route, the operator must confirm that production `APP_ORIGIN`, `SIGN_IN_URL`, and `SITE_ORIGIN` match the intended public destinations and that the successful production smoke for the approved SHA verified them through the allowed probe hosts. Smoke sends a signed-out API request to `APP_URL` with the canonical app origin and checks that it reaches the app's session boundary. It also checks the visible sign-in link and canonical and Open Graph URLs on the landing served by `SITE_URL`. After switching the public routes, verify the public landing and app destinations and their health SHA before marking cutover complete. Set the routine smoke origins to the public URLs where appropriate. Keep that routing work outside migrations.

The production job uses the corresponding `migrate:production` and `deploy:production` scripts. Use the workflow for live delivery. For a fresh CMS database, an authorized editor must publish the seeded Home via normal Access-protected setup before smoke can pass. Staging can start with no previous deployments, and first production cutover can do so with exact-SHA approval. Delivery accepts a confirmed missing Worker or an empty deployment list as an absent baseline. It stops before migration on authorization errors, unknown responses, or split traffic. Delivery records previous IDs or their absence, serializes releases, and verifies active versions and live smoke.

On failure, delivery attempts to restore and verify captured binaries for Workers that had a prior version. Where no prior binary exists, keep public routes unchanged and recover manually before retrying if the attempted deployment left an unusable Worker. If rollback cannot be confirmed, reconcile the active version against the captured ID before retrying. Keep migrations compatible with old and new Workers. Binary rollback never restores the database.

## Monitoring readiness

In `production-monitoring`, configure the three HTTPS origins and any Access credentials using the same keys as delivery, plus `MONITOR_P95_MS` (synthetic example `1500`) and the scoped `FACTORY_ALERT_TOKEN` secret. Enable the probe with `MONITORING_ENABLED=true` once the factory accepts authenticated `POST /ops/alert` requests. Requests use bearer authentication and JSON with a run-scoped `key` and a `code` of `availability` or `pipeline-stalled`. Logs contain only aggregate health timings and counts. Set the same alert token on the factory as `OPS_TOKEN`.

The schedule samples each production `/health` five times to detect unavailability and 5xx responses and calculate nearest-rank p95. Set `POLAR_LAG_PATH=/ops/polar-lag`, `MONITOR_POLAR_LAG_SECONDS`, and the scoped `POLAR_SIGNAL_TOKEN` secret to measure the age in seconds of the oldest overdue or unresolved eligible Polar refresh, including during retry backoff. Store the same token as an app Worker secret. Both app operations endpoints require bearer authentication and return only aggregates. See the [app runbook](apps/app/README.md) for milestone semantics.
