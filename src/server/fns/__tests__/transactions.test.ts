/**
 * The transaction server functions, run: the ledger wrapper, the refusals and the strict input.
 *
 * Nothing else runs these handlers. The repository tests call `createTransaction` directly, where
 * nothing opens a ledger batch, so a handler that lost its `runWithLedgerBatch` wrapper would still
 * compile and pass every one of them while silently no longer enqueuing a balance rebuild - which
 * `docs/MONEY.md` calls the worst failure this product has. The wrapper is the only thing that makes
 * a write enqueue, so the handler is the only place it can be pinned.
 *
 * **Framework seams only.** The mocking is the technique of `attachments.test.ts`: `createServerFn`
 * becomes a builder that hands back the handler as a plain function with the validator still
 * running, `requireOrg` returns the world's scope (as a spy, so a case can say it was never
 * reached), and `cloudflare:workers` is an empty `env`. The repository, `conversionContextFor` and
 * the ledger batch are the real code over a real SQLite database; the one fake is the `LEDGER`
 * namespace, which records the account of each rebuild request, the seam `batch.test.ts` uses.
 *
 * `loadTransactions` in the same module is `07-S2`'s and is neither run nor changed here. Dates are
 * fixed, never the wall clock.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import { setLedgerBatchPorts } from '#/server/ledger/batch'
import { accounts, categories, payees, transactions } from '#/server/db/schema'
import {
  createBudgetWorld,
  seedTransaction,
} from '#/server/repos/__tests__/budget-harness'
import { NotFoundError } from '#/server/repos/errors'

import {
  createTransaction,
  deleteTransaction,
  getTransaction,
  updateTransaction,
} from '../transactions'

import type { BudgetWorld } from '#/server/repos/__tests__/budget-harness'

/** The guard the handlers call: a spy, so a case can assert it was reached or was not. */
const requireOrg = vi.hoisted(() => vi.fn())

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

vi.mock('cloudflare:workers', () => ({ env: {} }))

/** Every policy states itself; the most permissive set, so a policy never hides the row under test. */
const POLICIES = {
  planned: 'include',
  adjustments: 'include',
  transfers: 'include',
  completeness: 'any',
} as const

const CREATE_INPUT = {
  accountId: 'acc-a',
  direction: 'expense',
  amountMinor: 12_50,
  currencyCode: 'PLN',
  bookedOn: '2026-03-10',
} as const

/** Keys no schema on this path names: each must be refused rather than stripped or stored. */
const FOREIGN_KEYS = {
  organizationId: 'org-b',
  transferId: 'transfer-1',
  transferKind: 'internal',
  refundLinked: true,
  importBatchId: 'batch-1',
  importSourceHash: 'hash-1',
  categorizationSource: 'rule',
  createdByUserId: 'user-b',
} as const

let world: BudgetWorld
/** The account id of each rebuild request the fake `LEDGER` namespace received, in order. */
let rebuilds: Array<string>

beforeEach(async () => {
  world = await createBudgetWorld()
  requireOrg.mockReset()
  requireOrg.mockImplementation(async () => world.scope)

  rebuilds = []
  setLedgerBatchPorts({
    namespace: () => ({
      idFromName: (name: string) => name as unknown as DurableObjectId,
      get: () => ({
        fetch: async (request: Request) => {
          rebuilds.push(
            new URL(request.url).searchParams.get('accountId') ?? '',
          )
          return new Response(null, { status: 204 })
        },
      }),
    }),
  })

  await seedTransaction(world.db, { id: 'txn-a', refAmountMinor: 120_00 })
  await seedTransaction(world.db, {
    id: 'txn-b',
    refAmountMinor: 80_00,
    organizationId: 'org-b',
    accountId: 'acc-b',
  })
})

afterEach(() => {
  setLedgerBatchPorts(null)
})

/** Calls a handler the way the framework would: asynchronously, so a validator throw is a rejection. */
type Handler = (call: { data: unknown }) => Promise<unknown>

const call = async (handler: Handler, data: unknown) => handler({ data })

const handlers = {
  create: createTransaction as unknown as Handler,
  update: updateTransaction as unknown as Handler,
  remove: deleteTransaction as unknown as Handler,
  get: getTransaction as unknown as Handler,
}

const allTransactions = () => world.db.select().from(transactions)

/** Every row workspace B owns in the four tables a write on this path could reach. */
async function snapshotOfB() {
  const ofB = <T extends { organizationId: string }>(rows: Array<T>) =>
    rows.filter((row) => row.organizationId === 'org-b')
  return {
    transactions: ofB(await world.db.select().from(transactions)),
    accounts: ofB(await world.db.select().from(accounts)),
    categories: ofB(await world.db.select().from(categories)),
    payees: ofB(await world.db.select().from(payees)),
  }
}

describe('the ledger wrapper', () => {
  it('a create enqueues exactly one rebuild, for the account it wrote to', async () => {
    const created = (await call(handlers.create, {
      policies: POLICIES,
      input: CREATE_INPUT,
    })) as { id: string; accountId: string }

    expect(created.accountId).toBe('acc-a')
    expect(await allTransactions()).toHaveLength(3)
    expect(rebuilds).toEqual(['acc-a'])
  })

  it('an update across accounts enqueues one rebuild for each, once', async () => {
    await call(handlers.update, {
      transactionId: 'txn-a',
      policies: POLICIES,
      patch: { accountId: 'acc-a-hidden' },
    })

    expect([...rebuilds].sort()).toEqual(['acc-a', 'acc-a-hidden'])
  })

  it('a delete enqueues exactly one rebuild, for the account of the row', async () => {
    await call(handlers.remove, {
      transactionId: 'txn-a',
      policies: POLICIES,
    })

    expect(await allTransactions()).toHaveLength(1)
    expect(rebuilds).toEqual(['acc-a'])
  })
})

describe("a write aimed at another workspace's rows", () => {
  const attempts: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
    [
      "create into B's account",
      () =>
        call(handlers.create, {
          policies: POLICIES,
          input: { ...CREATE_INPUT, accountId: 'acc-b' },
        }),
    ],
    [
      "update of B's transaction",
      () =>
        call(handlers.update, {
          transactionId: 'txn-b',
          policies: POLICIES,
          patch: { note: 'mine now' },
        }),
    ],
    [
      "delete of B's transaction",
      () =>
        call(handlers.remove, {
          transactionId: 'txn-b',
          policies: POLICIES,
        }),
    ],
  ]

  it.each(attempts)(
    '%s raises not-found, enqueues nothing and leaves B untouched',
    async (_name, attempt) => {
      const before = await snapshotOfB()
      // The control: a snapshot with nothing in it would make the comparison below prove nothing.
      expect(before.transactions).toHaveLength(1)

      await expect(attempt()).rejects.toBeInstanceOf(NotFoundError)

      expect(rebuilds).toEqual([])
      expect(await snapshotOfB()).toEqual(before)
    },
  )
})

describe('the guard is the authorisation point', () => {
  beforeEach(() => {
    requireOrg.mockRejectedValue(new Error('not a member of this workspace'))
  })

  const attempts: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
    [
      'create',
      () => call(handlers.create, { policies: POLICIES, input: CREATE_INPUT }),
    ],
    [
      'update',
      () =>
        call(handlers.update, {
          transactionId: 'txn-a',
          policies: POLICIES,
          patch: { note: 'changed' },
        }),
    ],
    [
      'delete',
      () =>
        call(handlers.remove, { transactionId: 'txn-a', policies: POLICIES }),
    ],
  ]

  it.each(attempts)(
    'a rejecting guard rejects the %s, with no row written and no rebuild',
    async (_name, attempt) => {
      const before = await allTransactions()

      await expect(attempt()).rejects.toThrow('not a member of this workspace')

      expect(requireOrg).toHaveBeenCalledOnce()
      expect(await allTransactions()).toEqual(before)
      expect(rebuilds).toEqual([])
    },
  )
})

describe('the strict input is refused before anything runs', () => {
  /** What every case below must show: it threw, the guard was never reached and no row moved. */
  async function expectRefused(handler: Handler, data: unknown) {
    const before = await allTransactions()

    await expect(call(handler, data)).rejects.toThrow()

    expect(requireOrg).not.toHaveBeenCalled()
    expect(await allTransactions()).toEqual(before)
    expect(rebuilds).toEqual([])
  }

  const { completeness: _dropped, ...incompletePolicies } = POLICIES

  const shapes: ReadonlyArray<
    readonly [
      string,
      (patch: Record<string, unknown>) => Record<string, unknown>,
    ]
  > = [
    ['a negative amount', () => ({ amountMinor: -12_50 })],
    ['a fractional amount', () => ({ amountMinor: 12.5 })],
    ['a booking date that is not a date', () => ({ bookedOn: 'yesterday' })],
  ]

  it.each(shapes)('create refuses %s', async (_name, bad) => {
    await expectRefused(handlers.create, {
      policies: POLICIES,
      input: { ...CREATE_INPUT, ...bad({}) },
    })
  })

  it.each(shapes)('update refuses %s', async (_name, bad) => {
    await expectRefused(handlers.update, {
      transactionId: 'txn-a',
      policies: POLICIES,
      patch: bad({}),
    })
  })

  it('refuses a missing policy set on every handler', async () => {
    await expectRefused(handlers.create, { input: CREATE_INPUT })
    await expectRefused(handlers.update, {
      transactionId: 'txn-a',
      patch: { note: 'x' },
    })
    await expectRefused(handlers.remove, { transactionId: 'txn-a' })
    await expectRefused(handlers.get, { transactionId: 'txn-a' })
  })

  it('refuses a policy set with one field missing on every handler', async () => {
    await expectRefused(handlers.create, {
      policies: incompletePolicies,
      input: CREATE_INPUT,
    })
    await expectRefused(handlers.update, {
      transactionId: 'txn-a',
      policies: incompletePolicies,
      patch: { note: 'x' },
    })
    await expectRefused(handlers.remove, {
      transactionId: 'txn-a',
      policies: incompletePolicies,
    })
    await expectRefused(handlers.get, {
      transactionId: 'txn-a',
      policies: incompletePolicies,
    })
  })

  it.each(Object.entries(FOREIGN_KEYS))(
    'refuses the extra key %s on the create input, the update patch and every envelope',
    async (key, value) => {
      await expectRefused(handlers.create, {
        policies: POLICIES,
        input: { ...CREATE_INPUT, [key]: value },
      })
      await expectRefused(handlers.update, {
        transactionId: 'txn-a',
        policies: POLICIES,
        patch: { note: 'x', [key]: value },
      })
      await expectRefused(handlers.create, {
        policies: POLICIES,
        input: CREATE_INPUT,
        [key]: value,
      })
      await expectRefused(handlers.update, {
        transactionId: 'txn-a',
        policies: POLICIES,
        patch: { note: 'x' },
        [key]: value,
      })
      await expectRefused(handlers.remove, {
        transactionId: 'txn-a',
        policies: POLICIES,
        [key]: value,
      })
      await expectRefused(handlers.get, {
        transactionId: 'txn-a',
        policies: POLICIES,
        [key]: value,
      })
    },
  )
})

describe('getTransaction', () => {
  it('is read-only and returns the row under the policies sent', async () => {
    const before = await allTransactions()

    const row = await call(handlers.get, {
      transactionId: 'txn-a',
      policies: POLICIES,
    })

    expect(row).toMatchObject({
      id: 'txn-a',
      accountId: 'acc-a',
      amountMinor: 120_00,
    })
    expect(rebuilds).toEqual([])
    expect(await allTransactions()).toEqual(before)
  })

  it('is not found under a policy set that excludes the row', async () => {
    // `txn-a` is posted; a policy that only admits planned rows must not show it.
    await expect(
      call(handlers.get, {
        transactionId: 'txn-a',
        policies: { ...POLICIES, planned: 'only' },
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(rebuilds).toEqual([])
  })
})
