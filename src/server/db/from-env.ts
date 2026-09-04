/**
 * A Drizzle handle built from an explicitly handed `Env`.
 *
 * `src/server/auth/db.ts` caches one handle per isolate over the binding it reads from
 * `cloudflare:workers`. That binding is the ambient *request* environment, and two things in this
 * Worker run outside a request: a Durable Object serving its own turn, and a cron serving
 * `scheduled`. Both are handed the `env` that is real for them as an argument, so both need a way
 * to build a handle from one.
 *
 * It is deliberately not cached. A per-isolate singleton keyed on nothing would hand the first
 * caller's binding to every later one, and the whole point here is that the caller says which
 * environment it means.
 */

import { drizzle } from 'drizzle-orm/d1'

import * as financeSchema from './schema'

import type { Database } from '../repos/base'

/** A Drizzle handle over `env.DB`, registered with the finance schema. */
export function dbFromEnv(env: Env): Database {
  return drizzle(env.DB, {
    schema: financeSchema,
    logger: false,
  }) as unknown as Database
}
