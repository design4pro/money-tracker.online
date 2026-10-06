/**
 * The task queue's envelope: what each kind accepts, what it refuses, and the one invariant over the
 * whole union.
 *
 * Every case goes through `parseTaskMessage` or the union's own schema members. A body that parses
 * must come back equal to what went in (a strict object adds and drops nothing), and a body that
 * does not must come back `null`, because that `null` is what the dispatcher acknowledges with a
 * warning instead of retrying.
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { parseTaskMessage, taskMessageSchema } from '../messages'

const tenantFields = {
  organizationId: 'org-a',
  userId: 'user_1',
}

/** One valid body per new kind, with the id fields each one carries. */
const idKinds = [
  ['import.parse', { ...tenantFields, batchId: 'batch-1' }],
  ['import.execute', { ...tenantFields, batchId: 'batch-1' }],
  ['import.revert', { ...tenantFields, batchId: 'batch-1' }],
  ['export.build', { ...tenantFields, jobId: 'job-1' }],
] as const

const validBackup = { kind: 'backup.run', date: '2026-10-04' }

/** Every kind with one valid body, for the cases that do not care which kind they are. */
const allNew: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ...idKinds.map(
    ([kind, fields]) =>
      [kind, { kind, ...fields }] as [string, Record<string, unknown>],
  ),
  ['backup.run', validBackup],
]

describe.each(allNew)('%s', (_kind, valid) => {
  it('parses a valid body to itself', () => {
    expect(parseTaskMessage(valid)).toEqual(valid)
  })

  it('refuses an unknown extra key', () => {
    expect(parseTaskMessage({ ...valid, role: 'owner' })).toBeNull()
  })

  it('refuses a missing field', () => {
    for (const key of Object.keys(valid).filter((k) => k !== 'kind')) {
      const { [key]: _omitted, ...rest } = valid
      expect(parseTaskMessage(rest), `without ${key}`).toBeNull()
    }
  })

  it('refuses an empty string and a non-string in every field', () => {
    for (const key of Object.keys(valid).filter((k) => k !== 'kind')) {
      expect(
        parseTaskMessage({ ...valid, [key]: '' }),
        `${key} empty`,
      ).toBeNull()
      expect(
        parseTaskMessage({ ...valid, [key]: 12 }),
        `${key} number`,
      ).toBeNull()
    }
  })

  it('carries no version field: a new kind is the versioning mechanism', () => {
    expect(parseTaskMessage({ ...valid, v: 1 })).toBeNull()
  })
})

describe.each(idKinds)('%s ids', (kind, fields) => {
  const idKeys = Object.keys(fields)

  it.each([
    ['a slash', 'a/b'],
    ['a space', 'a b'],
    ['a newline', 'a\nb'],
    ['a dot', 'a.b'],
    ['65 characters', 'a'.repeat(65)],
  ])('refuses an id with %s', (_name, bad) => {
    for (const key of idKeys) {
      expect(
        parseTaskMessage({ kind, ...fields, [key]: bad }),
        `${key}: ${JSON.stringify(bad)}`,
      ).toBeNull()
    }
  })

  it('accepts an id of 1 and of 64 characters from the charset', () => {
    for (const key of idKeys) {
      for (const ok of ['a', 'A-z_9', 'a'.repeat(64)]) {
        expect(parseTaskMessage({ kind, ...fields, [key]: ok })).toEqual({
          kind,
          ...fields,
          [key]: ok,
        })
      }
    }
  })
})

describe('backup.run', () => {
  it('has no organization: it is platform-level', () => {
    expect(
      parseTaskMessage({ ...validBackup, organizationId: 'org-a' }),
    ).toBeNull()
  })

  it.each([
    ['a non-padded day', '2026-1-4'],
    ['a timestamp', '2026-10-04T00:00:00Z'],
    ['a month 13', '2026-13-01'],
    ['day 0', '2026-10-00'],
    ['a day the month does not have', '2026-02-31'],
    ['29 February in a common year', '2026-02-29'],
    ['a slash separator', '2026/10/04'],
    ['an over-long string', `2026-10-04${'0'.repeat(600)}`],
  ])('refuses %s as the date', (_name, date) => {
    expect(parseTaskMessage({ ...validBackup, date })).toBeNull()
  })

  it('accepts 29 February in a leap year', () => {
    const body = { ...validBackup, date: '2028-02-29' }
    expect(parseTaskMessage(body)).toEqual(body)
  })

  it('accepts a cursor of printable ASCII up to 512 characters', () => {
    for (const cursor of ['a', 'abc/def==', ' ~!', 'x'.repeat(512)]) {
      const body = { ...validBackup, cursor }
      expect(parseTaskMessage(body)).toEqual(body)
    }
  })

  it.each([
    ['an empty cursor', ''],
    ['a cursor over 512 characters', 'x'.repeat(513)],
    ['a newline', 'ab\ncd'],
    ['a NUL', 'ab\u0000cd'],
    ['a DEL', 'ab\u007fcd'],
    ['a non-ASCII character', 'abécd'],
    ['a number', 12],
  ])('refuses %s as the cursor', (_name, cursor) => {
    expect(parseTaskMessage({ ...validBackup, cursor })).toBeNull()
  })
})

describe('billing.event', () => {
  it('keeps its shape: the event id and nothing else', () => {
    const body = { kind: 'billing.event', eventId: 'evt_1' }
    expect(parseTaskMessage(body)).toEqual(body)
    expect(parseTaskMessage({ ...body, extra: 1 })).toBeNull()
    expect(parseTaskMessage({ kind: 'billing.event', eventId: '' })).toBeNull()
  })
})

describe('the union', () => {
  it('has the six kinds', () => {
    const kinds = taskMessageSchema.options.map((o) => o.shape.kind.value)
    expect(kinds.sort()).toEqual([
      'backup.run',
      'billing.event',
      'export.build',
      'import.execute',
      'import.parse',
      'import.revert',
    ])
  })

  it('refuses an unknown kind', () => {
    expect(
      parseTaskMessage({ kind: 'import.delete', ...tenantFields }),
    ).toBeNull()
  })
})

/**
 * The invariant, as an allow-list: an envelope carries ids, one date and one cursor, and never a
 * value that is also stored in a row (an amount, a rate, a role, a status).
 *
 * A name deny-list would be defeated by a field called `value`, so the test names what is allowed
 * and fails for everything else. A new field of another name or type fails here until someone edits
 * `ALLOWED_FIELDS` on purpose, and that edit is the review point.
 */
describe('no envelope field can carry a value that is stored in a row', () => {
  const ALLOWED_FIELDS = [
    'organizationId',
    'userId',
    'batchId',
    'jobId',
    'eventId',
    'date',
    'cursor',
  ]

  /** Looks through one optional wrapper, the only wrapper an allowed field may have. */
  function unwrapOptional(schema: unknown): unknown {
    return schema instanceof z.ZodOptional ? schema.unwrap() : schema
  }

  /** What is wrong with one union member; empty when it is a strict object of allowed strings. */
  function violations(member: z.ZodObject): Array<string> {
    const found: Array<string> = []
    if (!(member._zod.def.catchall instanceof z.ZodNever)) {
      found.push('not a strict object')
    }
    for (const [name, field] of Object.entries(member.shape)) {
      if (name === 'kind') continue
      if (!ALLOWED_FIELDS.includes(name))
        found.push(`${name}: name not allowed`)
      if (!(unwrapOptional(field) instanceof z.ZodString)) {
        found.push(`${name}: not a string`)
      }
    }
    return found
  }

  it.each(
    taskMessageSchema.options.map((o) => [o.shape.kind.value, o] as const),
  )('%s is a strict object of allowed string fields', (_kind, member) => {
    expect(violations(member)).toEqual([])
  })

  it('walks the whole union: every member was checked', () => {
    expect(taskMessageSchema.options).toHaveLength(6)
  })

  it('fails for an unlisted name, a non-string type and a loose object', () => {
    const kind = z.literal('x.y')
    expect(violations(z.strictObject({ kind, value: z.string() }))).toEqual([
      'value: name not allowed',
    ])
    expect(violations(z.strictObject({ kind, jobId: z.number() }))).toEqual([
      'jobId: not a string',
    ])
    expect(
      violations(z.strictObject({ kind, cursor: z.string().nullable() })),
    ).toEqual(['cursor: not a string'])
    expect(violations(z.object({ kind, jobId: z.string() }))).toEqual([
      'not a strict object',
    ])
  })
})
