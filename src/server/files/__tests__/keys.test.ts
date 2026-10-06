import { describe, expect, it } from 'vitest'
import {
  InvalidKeyError,
  assertKeyInOrg,
  backupKey,
  dlqKey,
  exportKey,
  orgPrefix,
} from '../keys'

/** The workspace-scoped builders, each producing a key for the given workspace. */
const scopedBuilders = [
  {
    family: 'exports',
    build: (org: string) => exportKey(org, 'job-1', 'zip'),
  },
  {
    family: 'backups',
    build: (org: string) => backupKey(org, '2026-10-04'),
  },
  {
    // `attachmentKey` lives in `repos/attachments.ts`, which this module must not import, so the
    // shipped layout `attachments/<workspace>/<transaction>/<attachment>` is spelled out here.
    family: 'attachments',
    build: (org: string) => `attachments/${org}/txn-1/att-1`,
  },
] as const

/** Every value a path segment must refuse, whatever argument it arrives in. */
const badSegments = ['', '.', '..', 'a/b', 'a\\b', '../x', 'x/..'] as const

describe('R2 key layout', () => {
  describe('the builders', () => {
    it('lays an export out as exports/<workspace>/<job>.<zip|json>', () => {
      expect(exportKey('org-a', 'job-1', 'zip')).toBe('exports/org-a/job-1.zip')
      expect(exportKey('org-a', 'job-1', 'json')).toBe(
        'exports/org-a/job-1.json',
      )
    })

    it('lays a backup out as backups/<workspace>/<yyyy-mm-dd>.json', () => {
      expect(backupKey('org-a', '2026-10-04')).toBe(
        'backups/org-a/2026-10-04.json',
      )
    })

    it('lays a dead-letter archive entry out as dlq/<queue>/<message>.json, with no workspace', () => {
      expect(dlqKey('money-tracker-tasks', 'msg-1')).toBe(
        'dlq/money-tracker-tasks/msg-1.json',
      )
    })

    it.each(scopedBuilders)(
      'puts the workspace second in a $family key',
      ({ build }) => {
        expect(build('org-a').split('/')[1]).toBe('org-a')
      },
    )

    it.each(['2026-02-31', '2026-13-01', '2026-1-4', '20261004', 'today', ''])(
      'refuses the backup date %j',
      (date) => {
        expect(() => backupKey('org-a', date)).toThrow(InvalidKeyError)
      },
    )
  })

  describe('segment guard', () => {
    it.each(badSegments)('exportKey refuses the workspace %j', (segment) => {
      expect(() => exportKey(segment, 'job-1', 'zip')).toThrow()
    })
    it.each(badSegments)('exportKey refuses the job %j', (segment) => {
      expect(() => exportKey('org-a', segment, 'zip')).toThrow()
    })
    it.each(badSegments)('backupKey refuses the workspace %j', (segment) => {
      expect(() => backupKey(segment, '2026-10-04')).toThrow()
    })
    it.each(badSegments)('dlqKey refuses the queue %j', (segment) => {
      expect(() => dlqKey(segment, 'msg-1')).toThrow()
    })
    it.each(badSegments)('dlqKey refuses the message %j', (segment) => {
      expect(() => dlqKey('money-tracker-tasks', segment)).toThrow()
    })
    it.each(badSegments)('orgPrefix refuses the workspace %j', (segment) => {
      expect(() => orgPrefix('exports', segment)).toThrow()
    })
  })

  describe('orgPrefix', () => {
    it.each(['imports', 'exports', 'attachments', 'backups'] as const)(
      'ends a %s prefix in a separator',
      (family) => {
        expect(orgPrefix(family, 'org-a')).toBe(`${family}/org-a/`)
      },
    )

    it.each(scopedBuilders)(
      'is a prefix of every $family key built for that workspace',
      ({ family, build }) => {
        expect(build('org-a').startsWith(orgPrefix(family, 'org-a'))).toBe(true)
      },
    )

    it('does not make org-a a prefix of a key under org-ab', () => {
      expect(
        exportKey('org-ab', 'job-1', 'zip').startsWith(
          orgPrefix('exports', 'org-a'),
        ),
      ).toBe(false)
    })
  })

  describe('assertKeyInOrg', () => {
    it.each(scopedBuilders)(
      'accepts a key built by the $family builder',
      ({ family, build }) => {
        expect(() =>
          assertKeyInOrg(family, 'org-a', build('org-a')),
        ).not.toThrow()
      },
    )

    it.each(scopedBuilders)(
      'refuses the same $family key checked against another workspace',
      ({ family, build }) => {
        expect(() => assertKeyInOrg(family, 'org-b', build('org-a'))).toThrow()
      },
    )

    it.each(scopedBuilders)(
      'refuses a $family key that only shares the workspace id as characters',
      ({ family, build }) => {
        expect(() => assertKeyInOrg(family, 'org-a', build('org-ab'))).toThrow()
      },
    )

    // The checker sees a stored key, which no builder vetted, so a segment that would walk out of
    // the workspace prefix is refused even though the key starts with it.
    it.each([
      'attachments/org-a/../org-b/txn-1/att-1',
      'attachments/org-a/./txn-1/att-1',
      'attachments/org-a/txn-1/..',
      'attachments/org-a/txn-1/.',
      'attachments/org-a/..',
    ])(
      'refuses the key %j, which has a dot segment after the prefix',
      (key) => {
        expect(() => assertKeyInOrg('attachments', 'org-a', key)).toThrow(
          InvalidKeyError,
        )
      },
    )

    it.each([
      'attachments/org-a/txn-1/file..pdf',
      'attachments/org-a/txn-1/..x',
      'attachments/org-a/txn-1/x..',
      'attachments/org-a/txn-1/.hidden',
      'attachments/org-a/txn-1/att-1',
    ])('accepts the key %j, whose dots are inside a segment', (key) => {
      expect(() => assertKeyInOrg('attachments', 'org-a', key)).not.toThrow()
    })

    it('refuses a key of another family', () => {
      expect(() =>
        assertKeyInOrg('backups', 'org-a', exportKey('org-a', 'job-1', 'zip')),
      ).toThrow()
    })
  })
})
