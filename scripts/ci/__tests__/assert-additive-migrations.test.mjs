import { describe, expect, it } from 'vitest'

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  journalFaults,
  loadSnapshots,
  snapshotChainFaults,
  sqlAdditiveFaults,
} from '../assert-additive-migrations.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

describe('journalFaults', () => {
  it('accepts the sequential unique idx chain this repo uses', () => {
    const journal = JSON.stringify({
      entries: [
        { idx: 0, tag: '0000_a' },
        { idx: 1, tag: '0001_b' },
      ],
    })
    expect(journalFaults(journal)).toEqual([])
  })

  it('rejects a duplicated idx', () => {
    const journal = JSON.stringify({
      entries: [
        { idx: 0, tag: '0000_a' },
        { idx: 0, tag: '0001_b' },
      ],
    })
    expect(journalFaults(journal).join('\n')).toMatch(/not unique/)
  })
})

describe('snapshotChainFaults', () => {
  it('accepts prevId equal to the previous snapshot id', () => {
    expect(
      snapshotChainFaults([
        {
          file: '0000_snapshot.json',
          id: 'aaa',
          prevId: '00000000-0000-0000-0000-000000000000',
        },
        { file: '0001_snapshot.json', id: 'bbb', prevId: 'aaa' },
      ]),
    ).toEqual([])
  })

  it('rejects a forked prevId (stacked migration without db:generate)', () => {
    const faults = snapshotChainFaults([
      {
        file: '0000_snapshot.json',
        id: 'aaa',
        prevId: '00000000-0000-0000-0000-000000000000',
      },
      { file: '0001_snapshot.json', id: 'bbb', prevId: 'aaa' },
      { file: '0002_snapshot.json', id: 'ccc', prevId: 'aaa' },
    ])
    expect(faults.join('\n')).toMatch(/0002_snapshot/)
    expect(faults.join('\n')).toMatch(/pnpm db:generate/)
  })
})

describe('sqlAdditiveFaults', () => {
  it('accepts an ADD COLUMN migration', () => {
    expect(
      sqlAdditiveFaults(
        'ALTER TABLE `accounts` ADD `iban` text;',
        'drizzle/0006_x.sql',
      ),
    ).toEqual([])
  })

  it('rejects ALTER TABLE ... DROP COLUMN, which does not start its line', () => {
    expect(
      sqlAdditiveFaults(
        'ALTER TABLE `accounts` DROP COLUMN `iban`;',
        'drizzle/0006_x.sql',
      ).join('\n'),
    ).toMatch(/DROP COLUMN/)
  })

  it.each([
    'ALTER TABLE `accounts` DROP `iban`;',
    'ALTER TABLE `accounts` RENAME COLUMN `iban` TO `code`;',
    'ALTER TABLE `accounts` RENAME TO `ledgers`;',
  ])('rejects %s', (sql) => {
    expect(sqlAdditiveFaults(sql, 'drizzle/0006_x.sql')).toHaveLength(1)
  })

  it('ignores DROP TABLE and DROP COLUMN inside a SQL comment', () => {
    expect(
      sqlAdditiveFaults(
        '-- `DROP TABLE` performs an implicit DELETE FROM.\nALTER TABLE `accounts` ADD `iban` text;',
        'drizzle/0006_x.sql',
      ),
    ).toEqual([])
  })

  it('rejects DROP TABLE in a new file', () => {
    expect(
      sqlAdditiveFaults('DROP TABLE `accounts`;', 'drizzle/0006_x.sql').join(
        '\n',
      ),
    ).toMatch(/DROP TABLE/)
  })
})

describe('assert-additive-migrations CLI', () => {
  it('fails closed when the base ref cannot be diffed', () => {
    const run = () =>
      execFileSync(
        process.execPath,
        [join(ROOT, 'scripts', 'ci', 'assert-additive-migrations.mjs')],
        {
          cwd: ROOT,
          env: { ...process.env, BASE: 'refs/does-not-exist' },
          stdio: 'pipe',
        },
      )
    expect(run).toThrow(/does-not-exist/)
  })
})

describe('committed drizzle tree', () => {
  it('has a unique sequential journal and a linked snapshot chain', () => {
    const journal = readFileSync(
      join(ROOT, 'drizzle', 'meta', '_journal.json'),
      'utf8',
    )
    expect(journalFaults(journal)).toEqual([])
    expect(snapshotChainFaults(loadSnapshots())).toEqual([])
  })
})
