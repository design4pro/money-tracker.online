/**
 * 0012 adds OAuth tables. It must not rebuild `account`: D1 does not honour
 * `PRAGMA foreign_keys=OFF`, and existing login rows have to survive.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

const migrations = new URL('../../../../drizzle/', import.meta.url)
const migration = '0012_classy_wind_dancer.sql'

describe('the OAuth account migration', () => {
  it('is additive: existing account rows survive with foreign keys on', () => {
    const sql = readFileSync(new URL(migration, migrations), 'utf8')
    expect(sql).not.toMatch(/PRAGMA foreign_keys\s*=\s*OFF/i)
    expect(sql).not.toContain('__new_account')
    expect(sql).not.toMatch(/DROP TABLE [`']?account[`']?/i)
    expect(sql).not.toMatch(
      /ALTER TABLE [`']?__new_account[`']? RENAME TO [`']?account[`']?/i,
    )

    const db = new DatabaseSync(':memory:')
    try {
      db.exec('PRAGMA foreign_keys = ON')
      for (const file of readdirSync(migrations)
        .filter((name) => name.endsWith('.sql') && name < migration)
        .sort()) {
        db.exec(readFileSync(new URL(file, migrations), 'utf8'))
      }

      db.exec(`
        INSERT INTO user(id, name, email, email_verified, two_factor_enabled, banned, created_at, updated_at)
        VALUES ('synthetic-user-0012', 'Synthetic User', 'synthetic-0012@example.test', 0, 0, 0, 1, 1);
        INSERT INTO account(
          id, issuer, account_id, provider_id, user_id, password, created_at, updated_at
        ) VALUES (
          'synthetic-account-0012', 'credential', 'synthetic-user-0012',
          'credential', 'synthetic-user-0012', 'not-a-real-hash', 1, 1
        );
      `)

      const before = db.prepare('SELECT * FROM account').all()
      expect(before).toHaveLength(1)

      db.exec(sql)

      expect(db.prepare('SELECT * FROM account').all()).toEqual(before)
      expect(
        db
          .prepare(
            "SELECT name, \"notnull\" AS not_null FROM pragma_table_info('account') WHERE name = 'issuer'",
          )
          .get(),
      ).toEqual({ name: 'issuer', not_null: 1 })
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'oauth_client'",
          )
          .get(),
      ).toEqual({ name: 'oauth_client' })
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      db.close()
    }
  })
})
