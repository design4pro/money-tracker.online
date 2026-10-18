/**
 * The series-writing server functions hand their change to `writeSeries` and do nothing else.
 *
 * `recurring/series-write` owns *"write the series, then materialise its periods"* and its own tests
 * cross its interface. What is pinned here is the door: that each of the four handlers passes the
 * scope, the day, the shared horizon and its change on, and returns what the module returned. The
 * module is a fake in these cases, so a handler that stopped delegating, or delegated with a horizon
 * of its own, fails here rather than passing every other test.
 *
 * The second half is structural. The handler file must not import the repository's four series
 * writers, so a fifth handler that wants one has to come through the module, which is the only
 * place the materialise call is made. It reads the file's own source, as `planned-data.test.ts`
 * does for its module.
 *
 * **Framework seams only,** the technique of `transactions.test.ts`: `createServerFn` hands back the
 * handler with its validator still running, `requireOrg` returns the world's scope, and
 * `serverToday` is pinned. Pause, complete and delete run for real over SQLite, to show that none of
 * them reaches the module.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { recurringSeries } from '#/server/db/schema'
import {
  createSeries as createSeriesRow,
  createSeriesSchema,
  updateSeriesSchema,
} from '#/server/repos/recurring'
import { createBudgetWorld } from '#/server/repos/__tests__/budget-harness'
import { SERIES_AHEAD } from '#/server/recurring/series-write'

import {
  acceptCandidate,
  completeSeries,
  createSeries,
  deleteSeries,
  pauseSeries,
  resumeSeries,
  updateSeries,
} from '../recurring'

import type * as SeriesWriteModule from '#/server/recurring/series-write'
import type { BudgetWorld } from '#/server/repos/__tests__/budget-harness'

const TODAY = '2026-03-15'

const requireOrg = vi.hoisted(() => vi.fn())
const writeSeries = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validate: (data: unknown) => unknown = (data) => data
    const builder = {
      inputValidator(validator: unknown) {
        validate =
          typeof validator === 'function'
            ? (validator as (data: unknown) => unknown)
            : (data) =>
                (validator as { parse: (data: unknown) => unknown }).parse(data)
        return builder
      },
      handler(
        run: (context: { data: unknown }) => Promise<unknown>,
      ): (call: { data: unknown }) => Promise<unknown> {
        return ({ data }) => run({ data: validate(data) })
      },
    }
    return builder
  },
}))

vi.mock('#/server/auth/guards', () => ({
  requireOrg: () => requireOrg(),
}))

vi.mock('#/server/clock', () => ({
  serverToday: () => TODAY,
  workspaceCivilDay: () => TODAY,
}))

vi.mock('#/server/recurring/series-write', async (importOriginal) => ({
  ...(await importOriginal<typeof SeriesWriteModule>()),
  writeSeries: (...args: Array<unknown>) => writeSeries(...args),
}))

vi.mock('cloudflare:workers', () => ({ env: {} }))

type Handler = (call: { data: unknown }) => Promise<unknown>

const call = async (handler: unknown, data: unknown) =>
  (handler as Handler)({ data })

const SERIES = {
  name: 'Rent',
  expectedAmountMinor: 250_000,
  expectedCurrencyCode: 'PLN',
  frequency: 'monthly',
  startDate: '2026-01-31',
  accountId: 'acc-a',
} as const

let world: BudgetWorld

beforeEach(async () => {
  world = await createBudgetWorld()
  requireOrg.mockReset()
  requireOrg.mockImplementation(async () => world.scope)
  writeSeries.mockReset()
  writeSeries.mockImplementation(async () => ({ seriesId: 'series-1' }))
})

describe('each series-writing handler delegates to writeSeries', () => {
  it('createSeries passes the scope, the day, the horizon and the parsed input, and returns the id', async () => {
    const result = await call(createSeries, SERIES)

    expect(writeSeries).toHaveBeenCalledExactlyOnceWith(world.scope, {
      today: TODAY,
      ahead: SERIES_AHEAD,
      change: { kind: 'create', input: createSeriesSchema.parse(SERIES) },
    })
    expect(result).toEqual({ seriesId: 'series-1' })
  })

  it('updateSeries passes the series id and the parsed patch', async () => {
    const patch = { name: 'Rent 2' }

    const result = await call(updateSeries, { seriesId: 'series-1', patch })

    expect(writeSeries).toHaveBeenCalledExactlyOnceWith(world.scope, {
      today: TODAY,
      ahead: SERIES_AHEAD,
      change: {
        kind: 'update',
        seriesId: 'series-1',
        patch: updateSeriesSchema.parse(patch),
      },
    })
    expect(result).toBeUndefined()
  })

  it('resumeSeries passes the series id', async () => {
    const result = await call(resumeSeries, { seriesId: 'series-1' })

    expect(writeSeries).toHaveBeenCalledExactlyOnceWith(world.scope, {
      today: TODAY,
      ahead: SERIES_AHEAD,
      change: { kind: 'resume', seriesId: 'series-1' },
    })
    expect(result).toBeUndefined()
  })

  it('acceptCandidate passes the candidate id and the parsed series, and returns the id', async () => {
    const result = await call(acceptCandidate, {
      candidateId: 'cand-1',
      series: SERIES,
    })

    expect(writeSeries).toHaveBeenCalledExactlyOnceWith(world.scope, {
      today: TODAY,
      ahead: SERIES_AHEAD,
      change: {
        kind: 'accept',
        candidateId: 'cand-1',
        series: createSeriesSchema.parse(SERIES),
      },
    })
    expect(result).toEqual({ seriesId: 'series-1' })
  })

  it('an error from the module reaches the caller unchanged', async () => {
    const failure = new Error('refused')
    writeSeries.mockRejectedValue(failure)

    await expect(call(resumeSeries, { seriesId: 'series-1' })).rejects.toBe(
      failure,
    )
  })
})

describe('the handlers that add no period never reach the module', () => {
  it.each([
    ['pauseSeries', pauseSeries],
    ['completeSeries', completeSeries],
    ['deleteSeries', deleteSeries],
  ])('%s', async (_name, handler) => {
    const series = await createSeriesRow(world.scope, SERIES)

    await call(handler, { seriesId: series.id })

    expect(writeSeries).not.toHaveBeenCalled()
    expect(await world.db.select().from(recurringSeries)).toHaveLength(
      handler === deleteSeries ? 0 : 1,
    )
  })
})

describe('the handler file, by reading its own source', () => {
  const source = readFileSync(
    path.join(import.meta.dirname, '..', 'recurring.ts'),
    'utf8',
  )

  /** The names the file imports from the repository, as exported, without any `as` rename. */
  const repositoryImports =
    /import \{([^}]*)\} from '#\/server\/repos\/recurring'/
      .exec(source)?.[1]
      .split(',')
      .map((name) => name.trim().split(/\s+/)[0])
      .filter((name) => name !== '') ?? []

  it('imports none of the four series writers, so a new writer can only come through the module', () => {
    expect(repositoryImports).not.toContain('createSeries')
    expect(repositoryImports).not.toContain('updateSeries')
    expect(repositoryImports).not.toContain('resumeSeries')
    expect(repositoryImports).not.toContain('acceptCandidate')
  })

  it('still reads the repository, so the check above is looking at the right import', () => {
    expect(repositoryImports).toContain('pauseSeries')
    expect(repositoryImports).toContain('listSeries')
  })

  it('keeps no horizon of its own', () => {
    expect(source).not.toMatch(/const AHEAD\b/)
    expect(source).not.toMatch(/ahead: \d/)
  })
})
