/**
 * A real SQLite database for the auth tests.
 *
 * The auth layer's interesting behaviour is transactional — provisioning writes an `organization`
 * and a `member` in one `batch`, and a slug collision is a unique-index violation. None of that is
 * observable against a mock, so these tests run the committed `drizzle/*.sql` migrations into an
 * in-memory database with foreign keys enabled and talk to it through Drizzle's proxy driver.
 *
 * The `batch` callback is the reason this file exists rather than each test building its own handle:
 * `AppDatabase` is `Database & BatchCapableDatabase`, and a proxy driver created without the second
 * callback throws the moment provisioning runs.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { drizzle } from 'drizzle-orm/sqlite-proxy'

import { organization, user } from '#/server/db/auth-schema'

import type { AppDatabase } from '../db'

const MIGRATIONS = fileURLToPath(
  new URL('../../../../drizzle/', import.meta.url),
)

type ProxyResult = { rows: Array<unknown> }

function runOne(
  sqlite: DatabaseSync,
  query: string,
  params: Array<unknown>,
  method: string,
): ProxyResult {
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

/** A fresh database with the whole schema applied. */
export function openAuthTestDb(): AppDatabase {
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
      if (trimmed.length > 0) sqlite.exec(trimmed)
    }
  }

  const db = drizzle(
    async (query, params, method) => runOne(sqlite, query, params, method),
    async (queries) => {
      // `BEGIN`/`COMMIT` around the list, because the property provisioning depends on is that a
      // failed second statement undoes the first. Without it this harness would pass a test that
      // production, where D1's `batch` is atomic, would also pass — for the wrong reason.
      sqlite.exec('BEGIN')
      try {
        const results = queries.map((entry) =>
          runOne(sqlite, entry.sql, entry.params, entry.method),
        )
        sqlite.exec('COMMIT')
        return results
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
  )

  return db as unknown as AppDatabase
}

const NOW = new Date('2026-04-01T09:00:00.000Z')

/** Inserts a `user` row. Provisioning reads it to name the workspace it creates. */
export async function seedUser(
  db: AppDatabase,
  input: { id: string; name?: string | null; email: string },
): Promise<void> {
  await db.insert(user).values({
    id: input.id,
    name: input.name ?? '',
    email: input.email,
    emailVerified: false,
    createdAt: NOW,
    updatedAt: NOW,
  })
}

/** Inserts an `organization` row directly, for the collision and membership fixtures. */
export async function seedOrganization(
  db: AppDatabase,
  input: { id: string; name: string; slug: string },
): Promise<void> {
  await db.insert(organization).values({
    id: input.id,
    name: input.name,
    slug: input.slug,
    createdAt: NOW,
    updatedAt: NOW,
  })
}
