import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

const migrations = new URL('../../../../drizzle/', import.meta.url)
const migration = '0007_freezing_falcon.sql'

describe('the recurring book migration', () => {
  it('preserves existing periods with foreign keys on, including a transaction rollback', () => {
    const db = new DatabaseSync(':memory:')
    try {
      db.exec('PRAGMA foreign_keys = ON')
      for (const file of readdirSync(migrations)
        .filter((name) => name.endsWith('.sql') && name < migration)
        .sort()) {
        db.exec(readFileSync(new URL(file, migrations), 'utf8'))
      }
      db.exec(`
        INSERT INTO organization(id, name, slug, created_at)
        VALUES ('migration-org', 'Migration fixture', 'migration-fixture', 0);
        INSERT INTO recurring_series(
          id, organization_id, name, kind, direction, expected_amount_minor,
          expected_currency_code, frequency, start_date, created_at, updated_at
        ) VALUES (
          'migration-series', 'migration-org', 'Fixture bill', 'bill', 'expense',
          100, 'PLN', 'monthly', '2026-03-01', 0, 0
        );
        INSERT INTO recurring_periods(
          organization_id, series_id, period_start, due_on,
          expected_amount_minor, expected_currency_code, created_at, updated_at
        ) VALUES (
          'migration-org', 'migration-series', '2026-03-01', '2026-03-01',
          100, 'PLN', 0, 0
        );
      `)
      const before = db.prepare('SELECT * FROM recurring_periods').all()
      const sql = readFileSync(new URL(migration, migrations), 'utf8')

      db.exec('BEGIN')
      db.exec(sql)
      db.exec('ROLLBACK')
      expect(db.prepare('SELECT * FROM recurring_periods').all()).toEqual(
        before,
      )
      expect(
        db
          .prepare(
            "SELECT name FROM pragma_table_info('recurring_series') WHERE name = 'book'",
          )
          .all(),
      ).toEqual([])

      db.exec('BEGIN')
      db.exec(sql)
      db.exec('COMMIT')
      expect(
        db
          .prepare('SELECT book FROM recurring_series WHERE id = ?')
          .get('migration-series')?.book,
      ).toBe('personal')
      expect(db.prepare('SELECT * FROM recurring_periods').all()).toEqual(
        before,
      )
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      db.close()
    }
  })
})
