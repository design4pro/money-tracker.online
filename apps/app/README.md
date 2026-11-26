# Money Tracker app

TanStack Start serves the React dashboard and Better Auth on Cloudflare Workers. The app owns pricing and entitlement. The UI was generated from shadcn preset `b3SSEeVco` with the TanStack Start template. Public app links are `/login`, `/register`, and `/billing`. The production origin is `https://app.money-tracker.online`.

## Local development

Use Node 22.12+ and the committed npm lockfile.

```sh
npm ci
npm run check
npm test
npm run build
npm run migrate:local
npm run dev
```

Vite serves `http://localhost:3000` and defaults to local Workers bindings. Set `BETTER_AUTH_SECRET` in an ignored local `.dev.vars` to a randomly generated development-only value of at least 32 characters. The local example sender is `auth@example.invalid`. The native email binding simulates delivery locally. Tests inject an in-memory sender through the auth factory to verify sign-up and password reset, and use Miniflare D1 and synthetic Polar responses. The Worker exposes no email injection switch. Leave Polar variables unset for local development without billing. Build, type checks, lint and tests require no Cloudflare account, DNS, live email or Polar credentials.

`GET /health` checks the migrated database read-only and returns `{"ok":true,"sourceSha":null}` locally. If the schema is unavailable it responds with HTTP 503 and `ok: false`. The deployed value of `sourceSha` is the Worker’s `SOURCE_SHA` variable.

## Runtime setup

Use distinct staging and production Workers, D1 databases, queues and dead-letter queues. Names are in `wrangler.jsonc`. The D1 IDs beginning with `00000000-` and any `.example.invalid` domains are synthetic placeholders. The configured cron runs every five minutes. The consumer handles one message at a time with up to eight retries, then moves failures to the environment’s DLQ. Inspect and redrive failed messages after resolving the underlying failure. Staging uses Polar Sandbox and production uses Polar production.

| Value | Requirement |
| --- | --- |
| `D1_DATABASE_ID` | Required in the migration/deployment shell. Use the target D1 database UUID for binding `DB`. |
| `APP_ORIGIN` | Exact HTTPS origin in deployment. Replace the synthetic staging origin with the staging hostname. |
| `EMAIL_FROM` | Required verified Cloudflare Email Service sender for binding `EMAIL`. Example `auth@example.invalid` is synthetic. |
| `POLAR_ENVIRONMENT` | Selected by the target in Wrangler. Values are `sandbox` and `production`. |
| `POLAR_MONTHLY_PRODUCT_ID`, `POLAR_YEARLY_PRODUCT_ID` | Required distinct product UUIDs from the target Polar organization. Example synthetic UUID `cd960f79-20dc-4ecb-a5cb-71cd98939470`. |
| `SOURCE_SHA` | Required full SHA of the built commit. The footer links to that GitHub tree. Local startup falls back to the repository URL. |
| `BETTER_AUTH_SECRET` | Required Worker secret, at least 32 random characters. Use a different secret per environment. |
| `POLAR_ACCESS_TOKEN` | Required Worker secret. Use an organization token with `products:read`, `customers:read`, `checkouts:write` and `customer_sessions:write`. |
| `POLAR_WEBHOOK_SECRET` | Required Worker secret for the matching Polar endpoint. Copy the secret from Polar as issued. |

Use stage-specific secrets on the target Worker. For a first deployment, an operator can supply a Wrangler-compatible secrets file through `npm run deploy:staging -- --secrets-file /path/to/secrets` or the production equivalent. Enable native Email Service sending for the verified sender domain so verification and password reset emails can be delivered. Use one private monthly and one private annual recurring product, each with a single non-archived fixed catalog price and an interval count of one. Configure both with the same entitlement and keep Polar’s organization setting `allow_multiple_subscriptions=false`. The app gets displayed prices from the Polar catalog and sends only the selected server-configured product to hosted checkout. Subscribe Polar to `customer.state_changed` at `POST /api/webhooks/polar`. The signed event queues only its ID and the external customer ID. The consumer fetches the latest Polar state using the app user ID as the external ID. A scheduled recheck covers active and pending subscriptions if an event is delayed. Pending checkout is tracked for 24 hours. Access closes at the verified period end or after 20 minutes without a successful refresh.

## Delivery commands

From `apps/app`, run the migration and deployment for the same target. Supply the nonsecret values above in the command environment. Wrangler uses its normal CI authentication for remote operations. Both deploy commands consume the existing `npm run build` output under `dist/`.

```sh
npm run migrate:staging
npm run deploy:staging
```

```sh
npm run migrate:production
npm run deploy:production
```

Production and staging must use their own Cloudflare and Polar bindings and configuration. The initial SQL migration creates both Better Auth and ledger tables. The OAuth-free pilot supports email/password authentication, private accounts, categories and transactions, and currency-separated balances. Each transaction amount is a signed safe integer in the account’s minor units. The dashboard’s **Export JSON** action downloads the verified user’s accounts, categories, transactions and currency balances even after the subscription lapses. The versioned export uses decimal strings for aggregated minor-unit balances so large totals remain exact.

## Pilot operations

Set the app Worker secret `POLAR_SIGNAL_TOKEN` and send it as a bearer token over HTTPS. `GET /ops/polar-lag` returns `lagSeconds`, the age of the oldest overdue eligible scheduled Polar refresh, or zero if none are due. It measures scheduled refresh lag.

`GET /ops/pilot-milestones` returns three aggregate counts among current accounts: `signUps`, `firstPaid` (ever observed with an active paid entitlement), and `firstTransaction` (first recorded transaction at or after first paid). Migration 0002 records the first observed milestones on the existing entitlement and ledger writes. Renewal, expiry, retries, and transaction deletion preserve the first timestamps. The migration leaves historical milestone times unknown until the next qualifying write. The endpoint returns counts only and disables caching.
