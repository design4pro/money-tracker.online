/**
 * A real SQLite database built from `drizzle/*.sql`, behind Drizzle's proxy driver.
 *
 * The migrations are replayed rather than a schema being declared here, so a test runs against
 * the DDL that will actually be deployed — including the seeded currency catalogue, which is a
 * migration and not a fixture.
 *
 * It lives under `repos/__tests__` because the SQL layer owns it: `.oxlintrc.json` refuses a
 * `drizzle-orm` import anywhere under `src/routes/**`, and a route-level test that needs a
 * database should borrow one from here rather than open the layering law for itself.
 *
 * `transaction-queries.test.ts`, `account-balances.test.ts` and `transactions.test.ts` each still
 * carry their own copy of this function, which predates it; they are left alone deliberately.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { drizzle } from 'drizzle-orm/sqlite-proxy'

import type { AsyncBatchRemoteCallback } from 'drizzle-orm/sqlite-proxy'
import type { Database } from '../base'

const MIGRATIONS = fileURLToPath(
  new URL('../../../../drizzle/', import.meta.url),
)

type ProxyMethod = 'run' | 'all' | 'values' | 'get'

function runStatement(
  sqlite: DatabaseSync,
  query: string,
  params: Array<unknown>,
  method: ProxyMethod,
): { rows: Array<unknown> } {
  const statement = sqlite.prepare(query)
  if (method === 'run') {
    statement.run(...(params as Array<never>))
    return { rows: [] }
  }
  const rows = statement
    .all(...(params as Array<never>))
    .map((row) => Object.values(row as Record<string, unknown>))
  return method === 'get' ? { rows: rows.at(0) ?? [] } : { rows }
}

/**
 * The batch callback for Drizzle's proxy driver: the statements run inside one transaction and a
 * throw rolls every one of them back, which is what D1's `batch` does and what a repository's
 * atomicity claim needs a test to be able to observe.
 *
 * `beforeStatement` sees each query before it runs, so a harness can record it or throw to inject
 * a fault into one named statement of the batch.
 */
export function sqliteBatchCallback(
  sqlite: DatabaseSync,
  beforeStatement?: (query: string) => void,
): AsyncBatchRemoteCallback {
  return async (statements) => {
    sqlite.exec('BEGIN')
    try {
      const results = statements.map(({ sql, params, method }) => {
        beforeStatement?.(sql)
        return runStatement(sqlite, sql, params, method)
      })
      sqlite.exec('COMMIT')
      return results
    } catch (error) {
      sqlite.exec('ROLLBACK')
      throw error
    }
  }
}

/** Statements that throw when `when` says so, for a test that fails one statement of a write. */
export const fault: { when: ((query: string) => boolean) | null } = {
  when: null,
}

function throwOnFault(query: string): void {
  if (fault.when?.(query) === true) {
    throw new Error(`injected fault: ${query}`)
  }
}

export function openTestDb(): Database {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON;')
  for (const file of readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    for (const statement of readFileSync(
      path.join(MIGRATIONS, file),
      'utf8',
    ).split('--> statement-breakpoint')) {
      const trimmed = statement.trim()
      if (trimmed.length > 0) {
        sqlite.exec(trimmed)
      }
    }
  }

  return drizzle(
    async (query, params, method) => {
      throwOnFault(query)
      return runStatement(sqlite, query, params, method)
    },
    sqliteBatchCallback(sqlite, throwOnFault),
  )
}
