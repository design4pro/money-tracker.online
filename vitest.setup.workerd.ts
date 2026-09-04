/**
 * Schema for the `workerd` project's D1: the migrations in `drizzle/`, applied to the real
 * binding before any test runs.
 *
 * The point of this project is that nothing here is a fake, and an empty database would quietly
 * undo that - a Durable Object rebuild would fail on `no such table` rather than on anything the
 * test meant to say. `readD1Migrations()` reads the same directory `wrangler.jsonc` names as
 * `migrations_dir`, so what is applied here is what `pnpm db:migrate:local` applies and what a
 * deploy applies. That is the second thing this project is for: proof that the SQL Drizzle
 * generated is SQL D1 accepts.
 */

import { applyD1Migrations, env } from 'cloudflare:test'

import type { D1Migration } from '@cloudflare/vitest-pool-workers'

/**
 * The migration list arrives as a Miniflare binding (`vitest.config.ts`), because reading a
 * directory is a Node operation and this file runs inside workerd.
 *
 * The cast is here rather than in an ambient declaration: augmenting `Cloudflare.Env` would put a
 * test-only binding into the type every production module sees.
 */
const { TEST_MIGRATIONS } = env as unknown as {
  TEST_MIGRATIONS: Array<D1Migration>
}

await applyD1Migrations(env.DB, TEST_MIGRATIONS)
