import { describe, expect, it } from 'vitest'

import {
  citations,
  isOpen,
  isPathShaped,
  parsePlan,
  resolveOwnedPath,
} from '../parse-plan.ts'

/**
 * The parser is asserted against an inline fixture rather than against `00-foundations.md`,
 * deliberately.
 *
 * `plan-paths.test.ts` is the test that reads the real document; if this one did too, a change to
 * that document could turn both red at once and neither would say whether the parser or the plan
 * had moved. The fixture below is the grammar, small enough to read in one screen and stable
 * forever - it carries one wrapped row, one glob, one `edit` entry, one non-path backticked token
 * and one row that never landed, because those are the five shapes the consumers key on.
 */
const FIXTURE = `# 00 — Foundations

## Area brief

Prose before the first stage belongs to no stage.

## Stage 00-S1 — First stage

### Stage id

\`00-S1\` · Wave 0 · effort **M**.

### Reference rows

\`FND-01 missing → done\` — the schema module exists with its conventions docblock and
\`enumCheck\`, at \`src/server/db/schema.ts\`.
\`FND-02 missing → missing\` — \`accounts\` never landed.

Requisitioned by \`04-S1\`. This paragraph is not part of \`FND-02\`.

### Owned paths

- \`src/server/db/schema.ts\` — new
- \`src/components/ui/**\` — edit
- \`drizzle/0000_init.sql\` — new (generated)

### Blockers

None.

## Stage 00-S2 — Second stage

### Stage id

\`00-S2\` · Wave 1 · effort **S**.

### Owned paths

- \`wrangler.jsonc\` — edit
`

/**
 * The 1-based line number of the first fixture line containing `needle`. Line numbers are part of
 * the parser's contract - a guard failure has to point at the bullet that caused it - so they are
 * asserted rather than ignored, but hard-coding them would make every edit to the fixture above a
 * puzzle rather than an edit.
 */
const lineOf = (needle: string): number =>
  FIXTURE.split('\n').findIndex((line) => line.includes(needle)) + 1

describe('parsePlan', () => {
  const plan = parsePlan(FIXTURE)

  it('finds every stage and no prose block', () => {
    expect(plan.stages.map((stage) => stage.id)).toEqual(['00-S1', '00-S2'])
    expect(plan.stages[0].title).toBe('First stage')
  })

  it('captures the section headings in document order', () => {
    expect(plan.stages[0].headings).toEqual([
      'Stage id',
      'Reference rows',
      'Owned paths',
      'Blockers',
    ])
  })

  it('distinguishes a new entry from an edit entry', () => {
    expect(plan.stages[0].ownedPaths).toEqual([
      {
        path: 'src/server/db/schema.ts',
        kind: 'new',
        line: lineOf('- `src/server/db/schema.ts`'),
      },
      {
        path: 'src/components/ui/**',
        kind: 'edit',
        line: lineOf('- `src/components/ui/**`'),
      },
      {
        path: 'drizzle/0000_init.sql',
        kind: 'new',
        line: lineOf('- `drizzle/0000_init.sql`'),
      },
    ])
    expect(plan.stages[1].ownedPaths).toEqual([
      {
        path: 'wrangler.jsonc',
        kind: 'edit',
        line: lineOf('- `wrangler.jsonc`'),
      },
    ])
  })

  it('captures a reference row with its statuses and its wrapped body', () => {
    const [first, second] = plan.stages[0].referenceRows

    expect(first.id).toBe('FND-01')
    expect(first.from).toBe('missing')
    expect(first.to).toBe('done')
    // The row wraps onto a second line; a parser that stopped at the newline would lose the one
    // citation the row carries, which is exactly what assertion 4 reads.
    expect(first.body).toContain('`src/server/db/schema.ts`')

    expect(second.id).toBe('FND-02')
    expect(second.to).toBe('missing')
  })

  it('stops a row body at the blank line, not at the next heading', () => {
    const [, second] = plan.stages[0].referenceRows

    expect(second.body).not.toContain('Requisitioned by')
  })

  it('reads a status as open when it is anything other than done', () => {
    const [first, second] = plan.stages[0].referenceRows

    expect(isOpen(first)).toBe(false)
    expect(isOpen(second)).toBe(true)
  })
})

/**
 * A row id whose prefix carries a digit.
 *
 * `docs/plans/02-i18n.md` mints its rows `I18N-01` … `I18N-07`, and it is the only document in the
 * set that does - every other prefix is letters alone. An id pattern of `[A-Z]+-\d+` matches none
 * of the seven, so the parser returned no rows for that document at all, and because a plan
 * declares no expected row count there was nothing to report the gap against. Assertion 4 - every
 * `→ done` row cites a path that resolves - therefore passed `02-i18n.md` having read none of its
 * seven rows, which is worse than failing it.
 *
 * The fixture is its own rather than a sixth shape added to `FIXTURE`, because this is a defect
 * with one document behind it and the shared fixture is the grammar.
 */
describe('a reference row whose id prefix carries a digit', () => {
  const FIXTURE_DIGIT_ID = `## Stage 02-S1 — The locale table

### Reference rows

\`I18N-01 missing → done\` — the frozen table is \`src/lib/i18n/locales.ts\`.
`

  it('is parsed rather than silently dropped', () => {
    const rows = parsePlan(FIXTURE_DIGIT_ID).stages[0].referenceRows

    expect(rows.map((row) => row.id)).toEqual(['I18N-01'])
    expect(rows[0].to).toBe('done')
    expect(citations(rows[0])).toEqual(['src/lib/i18n/locales.ts'])
  })
})

describe('citations', () => {
  const plan = parsePlan(FIXTURE)

  it('keeps the path-shaped tokens and drops the rest', () => {
    const [first, second] = plan.stages[0].referenceRows

    // `enumCheck` is an identifier and `accounts` is a table; neither resolves on disk and a
    // guard that demanded they did could never go green.
    expect(citations(first)).toEqual(['src/server/db/schema.ts'])
    expect(citations(second)).toEqual([])
  })
})

describe('isPathShaped', () => {
  it.each([
    ['src/server/db/schema.ts', true],
    ['drizzle/', true],
    ['money.test.ts', true],
    ['prettier.config.js', true],
    ['enumCheck', false],
    ['accounts', false],
    ['@tanstack/react-table', false],
    ['pnpm db:generate', false],
  ])('classifies %s as path-shaped: %s', (token, expected) => {
    expect(isPathShaped(token)).toBe(expected)
  })
})

describe('resolveOwnedPath', () => {
  it('resolves a directory glob to its base and leaves a file alone', () => {
    expect(resolveOwnedPath('src/components/ui/**')).toBe('src/components/ui')
    expect(resolveOwnedPath('src/lib/money.ts')).toBe('src/lib/money.ts')
  })
})
