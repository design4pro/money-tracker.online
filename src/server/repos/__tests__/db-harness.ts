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

import type { Database } from '../base'

const MIGRATIONS = fileURLToPath(
  new URL('../../../../drizzle/', import.meta.url),
)

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

  return drizzle(async (query, params, method) => {
    const statement = sqlite.prepare(query)
    if (method === 'run') {
      statement.run(...(params as Array<never>))
      return { rows: [] }
    }
    const rows = statement
      .all(...(params as Array<never>))
      .map((row) => Object.values(row as Record<string, unknown>))
    return method === 'get' ? { rows: rows.at(0) ?? [] } : { rows }
  })
}
