# money-tracker.online — Deployment runbook

From a provisioned Cloudflare account to `https://money-tracker.online` serving traffic. Every
command is copy-pasteable. Read `docs/ARCHITECTURE.md` for _why_ these resources exist.

Two rules govern this document:

- **Resource ids go into `wrangler.jsonc` and are committed.** They are not secrets, and the ids
  below are the real, already-provisioned ones.
- **Secrets never go into `wrangler.jsonc`.** They are set with `wrangler secret put`, and
  `.dev.vars.example` documents each one with the steps that obtain it and how the product degrades
  while it is missing.

**GitHub Actions only ships** (ADR 0033). A push to `develop` runs `deploy-staging.yml` (migrate,
deploy, smoke `/api/health`). A push to `main` runs `deploy-production.yml`. Pull-request
verification is the Cursor agent full gate posted on the PR, not Actions. The owner, not an
agent, changes branch-protection required checks.

**One thing is not finished and a first deploy will want to assume it is:** §9.6's Polar sandbox
acceptance matrix is **unwalked**. No credential has been issued to a build round, so no live
checkout, upgrade, downgrade, cancellation or webhook delivery has ever been observed. A green
`pnpm test` is evidence about our handler; it is never evidence about the vendor. Walk §9.6 on
staging before production takes a card.

---

## 0. Prerequisites

```bash
node --version              # 24.x or newer
pnpm --version              # 10.15.0
pnpm install --frozen-lockfile
pnpm exec wrangler --version
pnpm exec wrangler login
pnpm exec wrangler whoami   # confirm the account you are about to bill
```

You also need:

- **Workers Paid** on the account. D1, KV, R2, Queues and SQLite-backed Durable Objects all have
  free allowances, but Queues and the plan floor are what make the production configuration in
  `wrangler.jsonc` (5 retries, 4 consumers, 100% log sampling) legal and sane.
- **A decision before anything else: does this deploy sell?** The Worker deploys, serves and signs
  people up with no payment provider configured at all — every workspace sits on `free` and the
  pricing page has nothing to buy. That is a legitimate first deploy. If it must take money,
  everything it needs is §6 and §9, and there is exactly one provider to configure.
- A **Polar** organization with the four products of §9.1, plus a **separate sandbox organization**
  for the acceptance walk. Sandbox and production are different accounts and their product ids never
  match.
- A **Resend** account and a verified sending domain, if transactional email is to work.

---

## 1. Account and zone

```
Cloudflare account id   6cfdf3b5143cddc631383a4c14736c3a     (r.wolak@design4.pro)
Zone                    money-tracker.online
Nameservers             randall.ns.cloudflare.com, rosa.ns.cloudflare.com   (already delegated)
```

The zone is on Cloudflare nameservers already. The Worker can deploy before a custom domain is
attached; the routes in §8 cannot be attached until the zone is active.

---

## 2. The resources, already created

**These exist. Do not create them again.** Creating a second `money-tracker-db` and pointing
`wrangler.jsonc` at it is a silent data split that is only noticed when a customer says their
transactions vanished.

### 2.1 D1

| Binding | Env        | Database name              | `database_id`                          | Location |
| ------- | ---------- | -------------------------- | -------------------------------------- | -------- |
| `DB`    | production | `money-tracker-db`         | `9002d5d8-9fac-48c5-b055-5bdbbd30d7d4` | EEUR     |
| `DB`    | staging    | `money-tracker-db-staging` | `501071ae-4f57-49a4-8cfb-c5c2bb6eec8f` | EEUR     |

### 2.2 KV

| Binding    | Env        | Namespace title       | `id`                               |
| ---------- | ---------- | --------------------- | ---------------------------------- |
| `KV`       | production | `MT-KV`               | `54cc3d1d8df34b189746cd79c567e26a` |
| `KV`       | staging    | `MT-KV-staging`       | `a5aed155af244bf6a1ea6b2df53c9c0c` |
| `SESSIONS` | production | `MT-SESSIONS`         | `aeff2f0ee1d245e981ba7fc9231d7225` |
| `SESSIONS` | staging    | `MT-SESSIONS-staging` | `76af562c7bcc4b1ab7205da39af3ad60` |

The binding **name** is what the code reads; the namespace **title** is only a dashboard label.
Sessions live in their own namespace so a cache purge can never sign everyone out.

### 2.3 R2

| Binding | Env        | Bucket                        |
| ------- | ---------- | ----------------------------- |
| `FILES` | production | `money-tracker-files`         |
| `FILES` | staging    | `money-tracker-files-staging` |

Neither bucket has public access, and neither ever gets it. Objects are served only through
`/api/files/$id` after a tenant check.

### 2.4 Queues

| Binding | Env        | Queue                         | Dead-letter queue                 |
| ------- | ---------- | ----------------------------- | --------------------------------- |
| `TASKS` | production | `money-tracker-tasks`         | `money-tracker-tasks-dlq`         |
| `TASKS` | staging    | `money-tracker-tasks-staging` | `money-tracker-tasks-staging-dlq` |

### 2.5 Verify all of it before the first deploy

```bash
pnpm exec wrangler d1 list
pnpm exec wrangler kv namespace list
pnpm exec wrangler r2 bucket list
pnpm exec wrangler queues list
```

Each id printed must match the tables above **and** the value already committed in
`wrangler.jsonc`. If one does not, stop: fix the config, do not create a new resource.

### 2.6 If you are provisioning a third environment from scratch

For reference only — the two environments above are done.

```bash
pnpm exec wrangler d1 create <name>-db
pnpm exec wrangler kv namespace create KV
pnpm exec wrangler kv namespace create SESSIONS
pnpm exec wrangler r2 bucket create <name>-files
pnpm exec wrangler queues create <name>-tasks-dlq      # the DLQ FIRST
pnpm exec wrangler queues create <name>-tasks
```

**Create the dead-letter queue before the queue that references it.** A consumer whose DLQ does not
exist fails to deploy, and an incident is the worst possible moment to discover that.

---

## 3. Durable Objects and migration tags

`wrangler.jsonc` declares:

```jsonc
"durable_objects": { "bindings": [ { "name": "LEDGER", "class_name": "AccountLedger" } ] },
"migrations": [ { "tag": "v1", "new_sqlite_classes": ["AccountLedger"] } ]
```

Staging carries two further tags: `v2` created `SandcastleRegistry`, and `v3` deleted it when the
orchestrator was removed (`docs/adr/0013-cezar-replaces-sandcastle.md`). Both stay in the list.

**Migration tags are append-only and are never renumbered.** Deleting a class is itself a new tag
carrying `deleted_classes`, never the removal of the tag that created it - and it destroys the
objects' contents, which is why it is a decision rather than a cleanup. A tag that has been applied to a
deployed Worker is history. A new DO class is a new tag.

The class must be **re-exported from `src/server/worker.ts`**. A missing export fails isolate
startup outright — the dev server serves no request at all — which is the failure mode you want,
but only if you recognise it.

---

## 4. Migrations

```bash
pnpm db:generate                 # writes SQL into drizzle/ — read what it wrote
git add drizzle && git commit    # generated, but committed and reviewed
pnpm db:migrate:local            # local D1
pnpm db:migrate:staging          # money-tracker-db-staging, --remote --env staging
pnpm db:migrate:prod             # money-tracker-db,         --remote
```

`d1 migrations apply` is the **only** command in this repository that still needs `--env staging`.
Everything else selects its environment at build time (§7).

The order in a release is **migrate, then deploy**. Migrations are additive
(`docs/ARCHITECTURE.md` §9), which is what makes that window safe: the currently-running Worker's
SQL still works against the new schema.

### 4.1 The non-additive migration register

A migration that drops, renames or narrows a column, or that adds a `NOT NULL` without a default, is
**non-additive** and must be listed here before it is merged, with its window and its manual step.

| Migration    | Date | What is non-additive | Required manual step |
| ------------ | ---- | -------------------- | -------------------- |
| _(none yet)_ |      |                      |                      |

An empty register is the correct state. A non-additive migration that is not in this table is a
release blocker, not a note.

---

## 5. Build-time versus runtime configuration

This trips people up once and costs an afternoon, so it is stated before the secrets list.

| Where            | Read by                | Names                                                   | Source in CI             |
| ---------------- | ---------------------- | ------------------------------------------------------- | ------------------------ |
| `.dev.vars`      | the Worker, at runtime | `BETTER_AUTH_SECRET`, `POLAR_*`, `EMAIL_API_KEY`, …     | `wrangler secret put`    |
| `.env.local`     | Vite, at build time    | every `VITE_*`                                          | repository **variables** |
| `wrangler.jsonc` | the Worker, at runtime | non-secret `vars` (`ENVIRONMENT`, `APP_URL`, limits, …) | committed                |

**The trap, stated exactly:** while a `.dev.vars` file exists, Cloudflare loads **no** `.env` file
into the Worker's `env`. A runtime secret placed in `.env.local` is therefore `undefined` at request
time — not an error, `undefined`. And a `VITE_*` name placed in `.dev.vars` is an empty string at
build time, again with no error. Both failures are silent. `.dev.vars.example` repeats this warning
beside the names it applies to.

---

## 6. Secrets

Set each with `wrangler secret put <NAME>`, adding `--env staging` for the staging Worker.

```bash
# Required — the Worker is not correctly configured without this
pnpm exec wrangler secret put BETTER_AUTH_SECRET        # openssl rand -base64 32

# Required for paid plans (see also the four VITE_POLAR_PRODUCT_* variables in §10)
pnpm exec wrangler secret put POLAR_ACCESS_TOKEN
pnpm exec wrangler secret put POLAR_WEBHOOK_SECRET
pnpm exec wrangler secret put POLAR_SERVER              # "sandbox" or "production" — NO DEFAULT

# Optional — each of these degrades cleanly while absent
pnpm exec wrangler secret put GOOGLE_CLIENT_ID
pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET
pnpm exec wrangler secret put APPLE_CLIENT_ID
pnpm exec wrangler secret put APPLE_CLIENT_SECRET
pnpm exec wrangler secret put APPLE_APP_BUNDLE_IDENTIFIER
pnpm exec wrangler secret put EMAIL_API_KEY             # Resend
pnpm exec wrangler secret put CLOUDFLARE_ACCOUNT_ID     # backup cron
pnpm exec wrangler secret put CLOUDFLARE_API_TOKEN      # backup cron, D1:read only
pnpm exec wrangler secret put D1_DATABASE_ID            # backup cron
pnpm exec wrangler secret put FX_API_KEY                # only if a keyed FX provider is chosen
pnpm exec wrangler secret put SENTRY_DSN
```

### 6.1 What breaks when each one is missing

| Secret                                   | Degradation when unset                                                                                                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`                     | **Misconfigured Worker.** Authentication does not work at all. Nothing else matters                                                                                     |
| `GOOGLE_*` / `APPLE_*`                   | That provider's button is not rendered. Email sign-in still works                                                                                                       |
| `POLAR_ACCESS_TOKEN` / `_WEBHOOK_SECRET` | `BillingConfigError` on the first Upgrade click; the webhook answers 400                                                                                                |
| `POLAR_SERVER`                           | Same. **There is deliberately no default** — defaulting to production would let a sandbox key hit real money, and defaulting to sandbox would silently take no payments |
| `EMAIL_API_KEY`                          | Queued mail fails loudly to the dead-letter queue rather than being dropped silently                                                                                    |
| `CLOUDFLARE_*` / `D1_DATABASE_ID`        | The nightly backup logs a skip and continues. **No backups exist**                                                                                                      |
| `FX_API_KEY`                             | Falls back to the keyless provider. Not needed unless a keyed provider is chosen                                                                                        |
| `SENTRY_DSN`                             | Nothing is reported. Errors still classify and redact correctly                                                                                                         |

### 6.2 Verify

```bash
pnpm exec wrangler secret list
pnpm exec wrangler secret list --env staging
```

Values are never printed. Only names.

---

## 7. Build and deploy

**The environment is chosen at build time.** `wrangler.jsonc` is the Vite plugin's _input_; the
emitted `dist/server/wrangler.json` is what `wrangler deploy` actually reads.

```bash
# production
pnpm generate-routes && pnpm lint && pnpm typecheck && pnpm test
pnpm run deploy                       # = vite build && wrangler deploy

# staging
CLOUDFLARE_ENV=staging pnpm run build
node -e "const c=require('./dist/server/wrangler.json'); if(c.name!=='money-tracker-staging'){console.error('WRONG TARGET:',c.name);process.exit(1)}"
pnpm exec wrangler deploy
```

That assertion is not decoration. `deploy-staging.yml` runs the same check and exits 1 on
mismatch, because a staging build that emits the production name deploys over production and
nothing else in the pipeline would notice.

`wrangler deploy` must print the bindings `DB, KV, SESSIONS, FILES, LEDGER, TASKS`. A missing
binding in that list means the emitted config is not the one you think it is — stop and re-read
`dist/server/wrangler.json`.

---

## 8. Custom domains

`wrangler.jsonc` carries the routes; they attach on deploy once the zone is active.

| Environment | Hostnames                                          |
| ----------- | -------------------------------------------------- |
| production  | `money-tracker.online`, `www.money-tracker.online` |
| staging     | `staging.money-tracker.online`                     |

`workers_dev` and `preview_urls` are **false in both environments**. A `*.workers.dev` hostname
serving a real session cookie is an authentication surface nobody is watching.

### 8.1 Production sits behind Cloudflare Access until launch

Production is deployed but not public. A self-hosted Access application named
`money-tracker.online` covers both production hostnames and carries the account's existing reusable
policy `team` (Allow, `Emails ending in design4.pro`) - the same policy the `planned.travel`
applications use, so there is one definition of who the team is rather than three.

|              |                                                             |
| ------------ | ----------------------------------------------------------- |
| Application  | `money-tracker.online` (self-hosted, Public DNS)            |
| Destinations | `money-tracker.online`, `www.money-tracker.online`, no path |
| Policy       | `team` - Allow, include `Emails ending in design4.pro`      |
| Policy id    | `62767633-cc32-48d1-bb80-6d9d8f9d78cc`                      |

Verify from a machine with no Access session:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://money-tracker.online/
# 302, redirecting to design4pro.cloudflareaccess.com/cdn-cgi/access/login/...
```

A `200` here means the application was removed or its destinations no longer match, and production
is public again.

**Staging is deliberately _not_ behind Access.** The browser suites drive it unattended, and an
interactive login in front of them turns every run into a redirect to an identity provider.

**Access breaks the production smoke check, and that is not yet fixed.** `deploy-production.yml`
asserts `/api/health` answers exactly `200`; behind Access it answers `302`, so the production
deploy job fails on a healthy deploy. §11 has the detail and the two ways out. Staging is
unaffected.

**Before plan 22 ships billing, Polar's webhook needs its own bypass application.** Access is
default-deny, so a `POST` from Polar to `/api/webhooks/polar` gets the 302 above and the webhook
fails silently. `planned.travel` solves this with a separate application scoped to the webhook path
carrying a `Bypass` policy, ordered ahead of the site-wide one; mirror that rather than widening the
site policy. This is written down here because the failure looks like "Polar is not sending
webhooks", not like an access-control problem.

---

## 9. Polar

### 9.1 Four products

Create, in the production organization and again in the sandbox organization:

| Product             | Plan        | Interval | Price (EUR) |
| ------------------- | ----------- | -------- | ----------- |
| Plus — monthly      | `plus`      | monthly  | 3.99        |
| Plus — yearly       | `plus`      | yearly   | 39.00       |
| Household — monthly | `household` | monthly  | 6.99        |
| Household — yearly  | `household` | yearly   | 69.00       |

Their UUIDs become the four `VITE_POLAR_PRODUCT_*` values of §10. **Sandbox and production ids never
match**; keeping two sets straight is what `POLAR_SERVER` exists for.

Three properties of each product are load-bearing rather than cosmetic, and both organizations carry
them identically so that a sandbox walk says something about production:

- **One fixed price, in EUR, and no second currency.** The plan card renders the catalogue's EUR
  amount, so a USD price beside it charges one figure while the screen states another. The amounts
  are `src/lib/plans.ts`'s and nothing else may restate them.
- **Not seat-based.** `subscriptionStateFrom` stores `seats: 1` and reads `amount`; a per-seat price
  would be recorded as something nobody was charged. The household ceiling of six people is enforced
  by `assertWithinLimit`, not billed per seat.
- **A 14-day trial.** `trialing` entitles (§9.4), and the billing screen has its own state for it.

### 9.2 The webhook

Endpoint `https://money-tracker.online/api/webhooks/polar` (and the staging equivalent). Copy the
signing secret into `POLAR_WEBHOOK_SECRET`.

The handler verifies a Standard Webhooks HMAC-SHA256 over `${id}.${timestamp}.${raw}` with a 300s
tolerance, tolerates multiple `v1,<sig>` entries so a secret can be rotated without downtime, and
compares in constant time.

**It tries two key derivations, and it has to.** Polar changed how a secret becomes an HMAC key:

| Secret issued   | Key                                                                  | Endpoint reports                         |
| --------------- | -------------------------------------------------------------------- | ---------------------------------------- |
| from 2026-09-08 | base64-decode of the `whsec_` remainder (Standard Webhooks)          | `uses_standard_webhook_signature: true`  |
| before that     | the literal UTF-8 of the **whole** `whsec_…` string, prefix included | `uses_standard_webhook_signature: false` |

The older behaviour is Polar base64-encoding the complete secret before handing it to its
`standardwebhooks` library, which then had no `whsec_` prefix to strip (polarsource/polar#13519).
The flag is read-only: it cannot be set at creation and cannot be updated, so an organization whose
secrets predate the cutover cannot be migrated by re-creating the endpoint. Polar's own SDKs try
both from 1.0.0-alpha.19 and so does `src/server/billing/webhook-verify.ts`.

This was walked, not assumed: on 2026-09-06 every delivery to the staging endpoint answered **401**
with a correct secret configured, and it looked exactly like "Polar is not sending webhooks".

Status codes are a contract:

- **400** — unsigned or badly signed. Never processed, never retried into a loop.
- **200** — accepted, duplicate, or an event kind we deliberately ignore.
- **500** — only when a retry could actually succeed.

Dedupe is claim-then-handle in KV: a 120s claim keyed on the event id, released on throw, promoted
to a 72h handled marker on success.

### 9.3 The client never names a product

The browser sends `{ planId, interval, seats? }`. The product UUID is resolved server-side.
`external_customer_id` is the workspace id. This is what stops a crafted request buying a different
product than the one the pricing page displayed.

### 9.4 Entitlement statuses

`trialing`, `active` and `past_due` all entitle. `past_due` is dunning, not a lockout: locking a
person out of their own financial records because a card expired is both hostile and bad for
recovery.

### 9.5 The client's operating limits

Hand-rolled `fetch` + WebCrypto, never the SDK. `POLAR_MAX_RETRIES = 2`,
`POLAR_TIMEOUT_MS = 20_000`, retry on 429 and 5xx only, honour `retry-after` up to a 5s ceiling.
`resolvePolarOrigin` has **no default** — see §6.1.

### 9.6 Sandbox acceptance matrix — **UNWALKED**

Eight rows. **Not one is green.** Walk them on staging against the sandbox organization before
production takes a card, and tick them here.

| #   | Scenario                   | Expected                                                                                                                                                              | Walked |
| --- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | Subscribe to Plus monthly  | Checkout completes; `subscriptions` row `trialing` (the products carry a 14-day trial, §9.1), then `active` when it converts; entitlements flip within 60s either way | ☐      |
| 2   | Upgrade Plus → Household   | Proration as Polar computes it; `seats` ceiling rises; no double charge                                                                                               | ☐      |
| 3   | Downgrade Household → Plus | `pending_plan` set with `pending_effective_at`; current period unchanged                                                                                              | ☐      |
| 4   | Cancel at period end       | `cancel_at_period_end = true`; access holds until `current_period_end`                                                                                                | ☐      |
| 5   | Resume before period end   | Cancellation cleared; no new charge                                                                                                                                   | ☐      |
| 6   | Failed payment             | Status `past_due`; **access retained**; the dunning notification is sent                                                                                              | ☐      |
| 7   | Orders list renders        | Invoices listed with amounts in the subscription's own currency                                                                                                       | ☐      |
| 8   | Customer Portal round trip | Portal opens for the right customer and returns to the app                                                                                                            | ☐      |

---

## 10. Repository secrets and variables

**Secrets** (Settings → Secrets and variables → Actions → Secrets):

| Name                              | Used by                            |
| --------------------------------- | ---------------------------------- |
| `CLOUDFLARE_API_TOKEN`            | `deploy.yml`, `deploy-staging.yml` |
| `CLOUDFLARE_ACCOUNT_ID`           | same                               |
| `SENTRY_AUTH_TOKEN`               | source-map upload                  |
| `CF_ACCESS_CLIENT_ID` / `_SECRET` | the post-deploy smoke check        |

**Variables** (not secrets — they are inlined into the client bundle):

| Name                                   | Value                     |
| -------------------------------------- | ------------------------- |
| `VITE_POLAR_PRODUCT_PLUS_MONTHLY`      | the product UUID          |
| `VITE_POLAR_PRODUCT_PLUS_YEARLY`       | the product UUID          |
| `VITE_POLAR_PRODUCT_HOUSEHOLD_MONTHLY` | the product UUID          |
| `VITE_POLAR_PRODUCT_HOUSEHOLD_YEARLY`  | the product UUID          |
| `VITE_SENTRY_DSN`                      | the client DSN            |
| `SENTRY_ORG` / `SENTRY_PROJECT`        | for the source-map upload |

Both halves are needed: the three `POLAR_*` **secrets** and the four `VITE_POLAR_PRODUCT_*`
**variables**. Either half missing is a Worker that serves, signs people up, and bills nobody.

---

## 11. Post-deploy smoke check

Run against the deployed origin. **Exact status codes**, not "it loads":

```bash
BASE=https://money-tracker.online
curl -s -o /dev/null -w '%{http_code} /\n'                        "$BASE/"
curl -s -o /dev/null -w '%{http_code} /api/health\n'              "$BASE/api/health"
curl -s -o /dev/null -w '%{http_code} /api/auth/get-session\n'    "$BASE/api/auth/get-session"
curl -s -o /dev/null -w '%{http_code} /pricing\n'                 "$BASE/pricing"
curl -s -o /dev/null -w '%{http_code} GET webhook (405)\n'        "$BASE/api/webhooks/polar"
```

Expected: `200 200 200 200 405`. Anything else is a failed deploy.

**Against production this currently returns `302` five times**, because §8.1 put the site behind
Cloudflare Access and Access is default-deny. The check is not wrong; it is unauthenticated. Two
ways out, and the first is the one to take:

1. **A service token.** Mint one in Zero Trust → Access → Service credentials, add a `Service Auth`
   policy to the `money-tracker.online` application ordered _above_ `team`, store the pair as the
   `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` repository secrets §10 already lists, and send
   them as `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers here and in
   `deploy-production.yml`. This is what `planned.travel` does - its policy is called
   `ci-smoke-production`.
2. **A bypass application on `/api/health` alone.** Cheaper, and it puts the version string and the
   environment name back on the public internet. Take this only if the deploy has to go out before
   somebody can mint a token.

Until one of them is done, run the check against staging, and read a production deploy's smoke
failure as "unauthenticated", not as "unhealthy".

Then, by hand, once:

- `/api/health` returns the **expected version** — it echoes `CF_VERSION_METADATA`, so it is how you
  confirm the deploy that is live is the one you just built.
- Sign in on staging and load `/dashboard`. Zero console errors.
- Confirm the four cron triggers are listed in the dashboard for production and **only** `0 3 * * *`
  for staging.

---

## 12. Rollback

```bash
pnpm exec wrangler deployments list
pnpm exec wrangler rollback --message "reason"
```

**A rollback rolls back code, never the database.** That is precisely why migrations are additive:
the previous Worker's SQL has to keep working against the current schema. If a release included a
migration in the §4.1 register, read that row's manual step before rolling back — some of them
require a forward fix rather than a rollback.

Rolling back also does not un-send an email, un-charge a card, or un-run a queue job. Check the DLQ
depth and the Polar dashboard after any rollback that touched billing or notifications.

---

## 13. Dead-letter queue inspection

```bash
pnpm exec wrangler queues list
```

Nothing consumes either dead-letter queue and nothing writes a dead-lettered body to R2, so there is
no `dlq/` object to list or fetch. What an operator has today is the dead-letter queue's own retention:
the body stays in `money-tracker-tasks-dlq` (`money-tracker-tasks-staging-dlq` in staging) for the
queue's retention window, a platform setting, and is gone after it. The writer that copies the envelope
to `dlq/<queue>/<messageId>.json` is planned, not written (`docs/ARCHITECTURE.md` §6); it ships with an
R2 lifecycle expiry rule and stores the envelope only.

Re-driving is a deliberate act: fix the cause, then enqueue a fresh message. The old message's claim in
KV may still be held (it expires after 120 seconds), and a held claim makes the fresh message a delayed
retry rather than a lost one.

---

## 14. Release checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green locally
- [ ] `pnpm db:generate` produces no diff (no uncommitted schema drift)
- [ ] `pnpm generate-routes` produces no diff
- [ ] Migrations applied to the target environment **before** the deploy
- [ ] Any non-additive migration is in the §4.1 register with its manual step done
- [ ] Emitted `dist/server/wrangler.json` name matches the intended environment
- [ ] `wrangler deploy` printed all six expected bindings
- [ ] §11's smoke check returns `200 200 200 200 405 503`
- [ ] `/api/health` reports the version just built
- [ ] If the release touches billing: §9.6's matrix is walked on staging first

## Appendix: email sender domain

Resend verifies `money-tracker.online` (the apex) only. Resend does **not** cover subdomains under a
verified parent, so a `From:` at `staging.money-tracker.online` would be rejected at send time even
though the parent shows `verified`.

Staging therefore sends as `no-reply@money-tracker.online` and distinguishes itself in the display
name, not in the domain. The alternative - adding `staging.money-tracker.online` as a second Resend
domain with its own DKIM and SPF records on the zone - is deliberately not taken: a second sending
domain is a second reputation to warm and a second set of records to keep correct, for no benefit
beyond a cosmetic sender address on an environment no customer receives mail from.

A DMARC record already exists on the apex and is a leftover from another provider:

    _dmarc  TXT  "v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com"

It is `p=none`, so it does not block Resend, but its aggregate reports go to a provider this project
does not use. Repoint `rua` before tightening the policy to `quarantine` or `reject`; tightening it
while the reports go elsewhere means failures become invisible exactly when they start mattering.
