/**
 * The envelope's shape, as the browser sees it.
 *
 * `src/lib/failure-envelope.ts` is imported by the client bundle, so what it may import is part of
 * its contract: a `#/server` import there would drag the repository tree into the browser. A test
 * walks the import closure of the module for exactly that, the same way the repository's other
 * boundary tests read the source: a leak that arrives through another `#/lib` file is still a leak.
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  FAILURE_FIELD_KEYS,
  FAILURE_KINDS,
  FAILURE_MESSAGE_KEYS,
  MAX_FAILURE_PATH_LENGTH,
  MAX_FAILURE_PATH_SEGMENTS,
  MAX_FAILURE_PATH_SEGMENT_LENGTH,
  failureEnvelopeSchema,
} from '#/lib/failure-envelope'
import En from '#/lib/i18n/messages/en'
import Pl from '#/lib/i18n/messages/pl'

import { buildEnvelope } from '../envelope'
import { classifyFailure } from '../classify'

const EXPECTED_EN: Readonly<Record<string, string>> = {
  'failure.internal': 'Something went wrong on our side.',
  'failure.unauthenticated': 'Sign in to continue.',
  'failure.forbidden': 'You do not have access to this.',
  'failure.not_found': 'This could not be found.',
  'failure.validation': 'Check the highlighted fields and try again.',
  'failure.conflict':
    'This conflicts with what is already saved. Reload and try again.',
  'failure.quota': 'Your plan has reached its limit for this.',
  'failure.feature_locked': 'This is not part of your plan.',
  'failure.rate_unavailable': 'No exchange rate is available for that date.',
  'failure.rate_limited': 'Too many requests. Try again shortly.',
  'failure.upstream': 'A service we depend on did not answer. Try again.',
  'failure.field.invalid': 'This value is not valid.',
  'failure.field.tooShort': 'This value is too short.',
  'failure.field.tooLong': 'This value is too long.',
}

const SOURCE_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

function readSource(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function inServerTree(path: string, root: string = SOURCE_ROOT): boolean {
  return path.startsWith(join(root, 'server') + sep)
}

/**
 * Every module specifier a source file imports: `import`, `import type`, `export ... from`, a bare
 * `import 'x'` and a dynamic `import('x')` with a literal specifier. Comments are blanked first, so
 * a quote in one cannot cut a clause short and prose in one is not read as an import. A static clause
 * is anchored at the start of a line with no `=`, `(` or `;` in it, so an expression is not read as
 * an import either. A computed `import(expr)` and `import.meta.glob` are not followed.
 */
function importSpecifiers(source: string): Array<string> {
  const code = source.replace(/\/\*[\s\S]*?\*\/|(^|\s)\/\/[^\n]*/g, '$1')
  const pattern =
    /^\s*(?:import|export)\b[^;'"=()]*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gm
  return [...code.matchAll(pattern)].map(
    (match) => match[1] ?? match[2] ?? match[3],
  )
}

/**
 * The file `specifier` names, relative to `from`, or `null` for a package. `#/x` is `<root>/x`.
 * A local specifier that matches no file throws: skipping it would let a broken walk look clean.
 */
function resolveLocal(
  from: string,
  specifier: string,
  root: string,
  read: (path: string) => string | null,
): string | null {
  const base = specifier.startsWith('#/')
    ? join(root, specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(dirname(from), specifier)
      : null
  if (base === null) return null

  for (const suffix of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
    if (read(base + suffix) !== null) return base + suffix
  }
  throw new Error(`${specifier} (from ${from}) names no file`)
}

/** The set of files reachable from `entry` through local imports, the entry included. */
function importClosure(
  entry: string,
  read: (path: string) => string | null,
  root: string,
): Set<string> {
  const reached = new Set<string>()
  const pending = [entry]
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (reached.has(file)) continue
    reached.add(file)
    for (const specifier of importSpecifiers(read(file) ?? '')) {
      const target = resolveLocal(file, specifier, root, read)
      if (target !== null) pending.push(target)
    }
  }
  return reached
}

describe('failureEnvelopeSchema', () => {
  const valid = {
    v: 1,
    kind: 'quota',
    message: { key: 'failure.quota', params: { metric: 'rules' } },
  }

  it('accepts what the builder produces, for every kind', () => {
    const throwables = [
      new Error('x'),
      new Error(JSON.stringify([{ path: ['name'], code: 'too_small' }])),
    ]
    for (const thrown of throwables) {
      const envelope = buildEnvelope(thrown, classifyFailure(thrown))
      expect(failureEnvelopeSchema.parse(envelope)).toEqual(envelope)
    }
    expect(failureEnvelopeSchema.safeParse(valid).success).toBe(true)
  })

  it('tolerates an unknown extra key at the top level and in params, and drops it', () => {
    const parsed = failureEnvelopeSchema.parse({
      ...valid,
      future: 'x',
      message: {
        ...valid.message,
        params: { metric: 'rules', reason: 'y' },
        extra: 1,
      },
    })

    expect(parsed).toEqual(valid)
  })

  it('rejects any version but the literal 1', () => {
    expect(failureEnvelopeSchema.safeParse({ ...valid, v: 2 }).success).toBe(
      false,
    )
    expect(failureEnvelopeSchema.safeParse({ ...valid, v: '1' }).success).toBe(
      false,
    )
    expect(failureEnvelopeSchema.safeParse({ kind: 'quota' }).success).toBe(
      false,
    )
  })

  it('rejects a kind, a key or a metric outside the closed sets', () => {
    expect(
      failureEnvelopeSchema.safeParse({ ...valid, kind: 'teapot' }).success,
    ).toBe(false)
    expect(
      failureEnvelopeSchema.safeParse({
        ...valid,
        message: { key: 'failure.nope' },
      }).success,
    ).toBe(false)
    expect(
      failureEnvelopeSchema.safeParse({
        ...valid,
        message: { key: 'failure.quota', params: { metric: 'widgets' } },
      }).success,
    ).toBe(false)
  })

  it('bounds a field path at the longest legal one: eight segments of sixty-four characters', () => {
    expect(MAX_FAILURE_PATH_SEGMENTS).toBe(8)
    expect(MAX_FAILURE_PATH_SEGMENT_LENGTH).toBe(64)
    // 8 * 64 characters plus 7 separating dots.
    expect(MAX_FAILURE_PATH_LENGTH).toBe(519)

    const withPath = (path: string) => ({
      ...valid,
      fields: [{ path, key: 'failure.field.invalid' }],
    })
    const longestLegal = Array.from({ length: 8 }, () => 'x'.repeat(64)).join(
      '.',
    )

    expect(longestLegal).toHaveLength(519)
    expect(
      failureEnvelopeSchema.safeParse(withPath(longestLegal)).success,
    ).toBe(true)
    expect(
      failureEnvelopeSchema.safeParse(withPath(`${longestLegal}x`)).success,
    ).toBe(false)
    expect(failureEnvelopeSchema.safeParse(withPath('')).success).toBe(true)
  })

  it('bounds fields at twenty and retryAfter at 1..3600', () => {
    const field = { path: 'a', key: 'failure.field.invalid' }
    expect(
      failureEnvelopeSchema.safeParse({
        ...valid,
        fields: Array.from({ length: 21 }, () => field),
      }).success,
    ).toBe(false)
    expect(
      failureEnvelopeSchema.safeParse({ ...valid, retryAfter: 0 }).success,
    ).toBe(false)
    expect(
      failureEnvelopeSchema.safeParse({ ...valid, retryAfter: 3601 }).success,
    ).toBe(false)
    expect(
      failureEnvelopeSchema.safeParse({ ...valid, retryAfter: 30 }).success,
    ).toBe(true)
  })
})

describe('field paths', () => {
  const pathOf = (path: ReadonlyArray<unknown>) => {
    const thrown = new Error(JSON.stringify([{ path, code: 'invalid_type' }]))
    return buildEnvelope(thrown, classifyFailure(thrown)).fields?.[0]?.path
  }

  it('reports exactly eight segments and form-level for nine', () => {
    expect(pathOf(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])).toBe(
      'a.b.c.d.e.f.g.h',
    )
    expect(pathOf(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'])).toBe('')
    expect(pathOf(['lines', 0, 'a', 'b', 'c', 'd', 'e', 'f'])).toBe(
      'lines.0.a.b.c.d.e.f',
    )
    expect(pathOf(['lines', 0, 'a', 'b', 'c', 'd', 'e', 'f', 'g'])).toBe('')
  })

  it('never emits a path the envelope schema refuses, however deep or long the input', () => {
    const wide = Array.from({ length: 8 }, () => 'x'.repeat(64))
    const hostile: ReadonlyArray<ReadonlyArray<unknown>> = [
      wide,
      [...wide, 'y'],
      Array.from({ length: 5000 }, () => 'x'),
      Array.from({ length: 8 }, () => 'x'.repeat(65)),
    ]
    for (const path of hostile) {
      const thrown = new Error(JSON.stringify([{ path, code: 'invalid_type' }]))
      const envelope = buildEnvelope(thrown, classifyFailure(thrown))
      expect(failureEnvelopeSchema.safeParse(envelope).success).toBe(true)
    }
    expect(pathOf(wide)).toBe(wide.join('.'))
    expect(pathOf([...wide, 'y'])).toBe('')
  })

  it.each([
    '__proto__',
    'constructor',
    'prototype',
    'toString',
    'valueOf',
    'hasOwnProperty',
  ])('a %s segment sends the whole path to form level', (name) => {
    expect(pathOf([name])).toBe('')
    expect(pathOf(['lines', 0, name])).toBe('')
    expect(pathOf([name, 'amount'])).toBe('')
  })

  it('still reports an ordinary name that merely contains a denied one', () => {
    expect(pathOf(['constructor_id'])).toBe('constructor_id')
    expect(pathOf(['prototypes', 0])).toBe('prototypes.0')
  })
})

describe('the key table', () => {
  it('has exactly one key per kind', () => {
    expect(Object.keys(FAILURE_MESSAGE_KEYS).sort()).toEqual(
      [...FAILURE_KINDS].sort(),
    )
    expect(FAILURE_KINDS).toHaveLength(11)
  })

  it('exists in English with the spec text and in Polish, for all fourteen keys', () => {
    const keys = [...Object.values(FAILURE_MESSAGE_KEYS), ...FAILURE_FIELD_KEYS]
    expect(keys).toHaveLength(14)
    for (const key of keys) {
      expect(En[key]).toBe(EXPECTED_EN[key])
      expect(Pl[key]).toBeTypeOf('string')
      expect(Pl[key]).not.toBe(En[key])
    }
  })
})

describe('client safety', () => {
  it('failure-envelope.ts imports nothing from the server tree', () => {
    const source = readFileSync(
      fileURLToPath(
        new URL('../../../lib/failure-envelope.ts', import.meta.url),
      ),
      'utf8',
    )
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(
      (match) => match[1],
    )

    expect(imports.length).toBeGreaterThan(0)
    for (const specifier of imports) {
      expect(specifier).not.toMatch(/server|cloudflare|drizzle/)
    }
  })

  it('reaches nothing under the server tree through any chain of imports', () => {
    const entry = join(SOURCE_ROOT, 'lib', 'failure-envelope.ts')
    const reached = importClosure(entry, readSource, SOURCE_ROOT)

    // A walk that visited only the entry would pass for the wrong reason.
    expect(reached.size).toBeGreaterThan(1)
    expect(reached.has(entry)).toBe(true)
    expect([...reached].filter((file) => inServerTree(file))).toEqual([])
  })

  it('the walker finds a server import that arrives through another file', () => {
    const root = '/virtual/src'
    const files = new Map([
      [
        `${root}/lib/entry.ts`,
        [
          "import { z } from 'zod'",
          '// import { nope } from "#/server/in-a-comment"',
          'import {',
          "  middle, // don't stop reading here (really)",
          "} from '#/lib/middle'",
          "const later = () => import('#/lib/lazy')",
        ].join('\n'),
      ],
      [`${root}/lib/middle.ts`, "export { leaf } from './deep/leaf'"],
      [`${root}/lib/lazy.ts`, 'export const lazy = 1'],
      [
        `${root}/lib/deep/leaf.ts`,
        "import type { Secret } from '../../server/repos/secret'",
      ],
      [`${root}/server/repos/secret.ts`, 'export type Secret = string'],
      [`${root}/lib/unrelated.ts`, "import '#/server/never-reached'"],
    ])
    const read = (path: string) => files.get(path) ?? null

    const reached = importClosure(`${root}/lib/entry.ts`, read, root)

    expect([...reached].sort()).toEqual([
      `${root}/lib/deep/leaf.ts`,
      `${root}/lib/entry.ts`,
      `${root}/lib/lazy.ts`,
      `${root}/lib/middle.ts`,
      `${root}/server/repos/secret.ts`,
    ])
    expect([...reached].filter((file) => inServerTree(file, root))).toEqual([
      `${root}/server/repos/secret.ts`,
    ])
  })

  it('the walker refuses a local specifier it cannot resolve rather than skipping it', () => {
    const root = '/virtual/src'
    const read = (path: string) =>
      path === `${root}/lib/entry.ts` ? "import '#/lib/missing'" : null

    expect(() => importClosure(`${root}/lib/entry.ts`, read, root)).toThrow(
      /#\/lib\/missing/,
    )
  })

  it('builds no catalogue key at runtime', () => {
    const source = readFileSync(
      fileURLToPath(
        new URL('../../../lib/failure-envelope.ts', import.meta.url),
      ),
      'utf8',
    )

    expect(source).not.toMatch(/`failure\./)
    expect(source).not.toMatch(/['"]failure\.['"]\s*\+/)
  })
})
