/**
 * The Worker's environment, hand-authored to match `wrangler.jsonc` exactly.
 *
 * This file is deliberately NOT `wrangler types` output. That command emits half a megabyte of
 * runtime declarations plus an `Env` derived from whichever environment happened to be selected,
 * and the derived half drifts silently: a binding added to `env.staging` alone appears as
 * required everywhere, or disappears entirely, depending on the flag the last person ran it
 * with. The runtime globals we do want come from `@cloudflare/workers-types`, named in
 * `tsconfig.json`'s `types`; what is left is this interface, which is short enough to review in
 * a pull request against the config it mirrors.
 *
 * The rule for keeping the two in step: every `binding`/`name` in `wrangler.jsonc` and every key
 * of a `vars` block appears here, and nothing else does. A binding declared in `env.staging`
 * only is optional here, because production really does run without it.
 *
 * Secrets are `string | undefined` on purpose. Almost every one of them has a defined
 * unconfigured behaviour (`.dev.vars.example` names it per secret), and the code that reads one
 * has to decide what that behaviour is rather than assume the value is there. The single
 * exception is BETTER_AUTH_SECRET: a Worker without it is misconfigured, and the auth module
 * throws at construction rather than serving unsigned sessions.
 */

interface WorkerEnv {
  /* ── Bindings ──────────────────────────────────────────────────────────── */

  /** D1. All domain tables and all Better Auth tables. `migrations_dir: drizzle`. */
  DB: D1Database

  /** Short-TTL cache: plan state, queue idempotency markers, FX day-cache, import-preset
   *  fingerprints, reminder dedupe markers. Everything here is reconstructible. */
  KV: KVNamespace

  /** Better Auth secondary storage: sessions, OAuth state, rate-limit counters. Separate from
   *  KV so a cache eviction can never sign a user out. */
  SESSIONS: KVNamespace

  /** R2. Uploaded import files, generated exports, receipt attachments, dead-letter bodies,
   *  nightly D1 backups. */
  FILES: R2Bucket

  /** Task queue producer. The consumer is the `queue()` export of `src/server/worker.ts`. */
  TASKS: Queue

  /** `AccountLedger`, addressed with `idFromName(accountId)`. The serialisation point for
   *  balance-history rebuilds: it holds a lock and a dirty bit, never ledger data. */
  LEDGER: DurableObjectNamespace

  /** `SandcastleRegistry`, bound on `env.staging` ONLY. One object per repository, so every
   *  claim against the agent backlog is decided in one thread. Production and local dev have no
   *  binding and `/api/sandcastle/*` answers 503 by design — which is why this is optional and
   *  why every reader must check it rather than assert it. */
  SANDCASTLE_REGISTRY?: DurableObjectNamespace

  /** Workers AI, bound on `env.staging` ONLY: import column-mapping assist and statement
   *  extraction, structured output only, never written without review. */
  AI?: Ai

  /** Version metadata, read as the Sentry `release` so a regression can be tied to the deploy
   *  that introduced it. */
  CF_VERSION_METADATA: WorkerVersionMetadata

  /* ── vars (wrangler.jsonc, checked in, never secret) ───────────────────── */

  ENVIRONMENT: 'production' | 'staging'
  APP_NAME: string
  /** Public origin. Overridden locally by the APP_URL line in `.dev.vars`. */
  APP_URL: string
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error'
  EMAIL_FROM: string
  EMAIL_API_URL: string
  /** FX provider order. Both are keyless today; see FX_API_KEY. */
  FX_PRIMARY: 'fawaz' | 'frankfurter'
  FX_FALLBACK: 'fawaz' | 'frankfurter'
  /** JSON numbers in `vars`, so they arrive as numbers rather than strings. */
  BACKUP_RETENTION_DAYS: number
  TASK_MAX_ATTEMPTS: number
  IMPORT_MAX_ROWS: number
  EXPORT_MAX_ROWS: number

  /* ── Secrets (`wrangler secret put`; `.dev.vars` locally) ──────────────── */

  /** Required. The auth module throws at construction without it. */
  BETTER_AUTH_SECRET: string

  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  APPLE_CLIENT_ID?: string
  APPLE_CLIENT_SECRET?: string
  APPLE_APP_BUNDLE_IDENTIFIER?: string

  POLAR_ACCESS_TOKEN?: string
  POLAR_WEBHOOK_SECRET?: string
  /** `sandbox` or `production`, and no default: the two are separate Polar accounts. */
  POLAR_SERVER?: 'sandbox' | 'production'

  EMAIL_API_KEY?: string

  CLOUDFLARE_ACCOUNT_ID?: string
  CLOUDFLARE_API_TOKEN?: string
  D1_DATABASE_ID?: string

  FX_API_KEY?: string

  /** Staging only, and paired with the SANDCASTLE_REGISTRY binding above. */
  SANDCASTLE_COORDINATOR_TOKEN?: string

  SENTRY_DSN?: string
}

/**
 * One definition, three names.
 *
 * `Env` is what a `fetch`/`queue`/`scheduled` handler is typed against. `Cloudflare.Env` is
 * where `@cloudflare/vite-plugin` and `wrangler` look. Both extend the single interface above
 * rather than repeating it, so the two can never disagree — which is exactly the drift the
 * generated file suffers from.
 */
interface Env extends WorkerEnv {}

declare namespace Cloudflare {
  interface Env extends WorkerEnv {}
}
