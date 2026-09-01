/**
 * The Drizzle handle for the Worker: one per isolate, over the whole schema.
 *
 * It lives here rather than in `src/server/db/` because the auth layer is the first thing in a
 * request that needs a database — `requireOrg()` re-reads the caller's membership before any
 * repository runs — and `src/server/db/` is generated-adjacent territory owned by the foundation
 * plan. If a dedicated `src/server/db/client.ts` lands later this module becomes a re-export.
 *
 * Both schemas are registered so `db.query.*` works for auth tables and finance tables alike. The
 * repositories only use the select builder today, where the schema argument is inert; registering
 * both costs nothing and stops the first relational query anybody writes from failing at runtime
 * with a table the handle was never told about.
 *
 * It is a stateless wrapper around the binding and holds no request state, so caching one per
 * isolate is the whole optimisation.
 */

import { drizzle } from 'drizzle-orm/d1'

import { authSchema } from '#/server/db/auth-schema'
import * as financeSchema from '#/server/db/schema'
import { d1 } from './env'

import type { Database } from '#/server/repos/scope'

/** A prepared Drizzle write. Query builders are thenables, which is what `batch()` accepts. */
export type BatchStatement = PromiseLike<unknown>

/**
 * The `batch` surface D1 — and the test proxy driver — add on top of the abstract handle.
 *
 * D1 has no interactive transactions: a statement list is submitted in one round trip with
 * `batch()`, which is atomic and, for a Worker, a single network hop. Provisioning needs that
 * atomicity: an `organization` row without its owner's `member` row is a workspace nobody can reach.
 */
export interface BatchCapableDatabase {
  batch: (
    statements: readonly [BatchStatement, ...Array<BatchStatement>],
  ) => Promise<Array<unknown>>
}

/** A handle that can both query and batch. What every function in `./organization` takes. */
export type AppDatabase = Database & BatchCapableDatabase

let instance: AppDatabase | null = null

/**
 * The Drizzle handle for this isolate.
 *
 * The cast is the one place the two descriptions of the same object meet: Drizzle types `batch` as a
 * generic method over its own `BatchItem`, which no driver-agnostic handle type can express, while
 * every driver this codebase uses — D1 in the Worker, the proxy driver in tests — implements exactly
 * the shape above. Narrowing it here means no call site has to.
 */
export function getDb(): AppDatabase {
  instance ??= drizzle(d1(), {
    schema: { ...authSchema, ...financeSchema },
    logger: false,
  }) as unknown as AppDatabase
  return instance
}
