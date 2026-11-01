/**
 * The category server functions, run: the guard, the scope, the strict input and the absence of
 * a ledger batch.
 *
 * Nothing else runs these handlers. The repository tests call `createCategory` directly, where no
 * guard and no validator stand in front of it, so a handler that stopped calling `requireOrg()`,
 * passed the wrong scope or began to wrap itself in `runWithLedgerBatch` would compile and pass
 * every one of them. The header of `fns/categories.ts` makes those promises; this file is where they
 * can fail.
 *
 * **Framework seams only,** the technique of `attachments.test.ts` and `transactions.test.ts`:
 * `createServerFn` becomes a builder that hands back the handler as a plain function with the
 * validator still running, `requireOrg` is a spy that returns the world's scope, and
 * `cloudflare:workers` is an empty `env`. The repository is the real code over a real SQLite
 * database, never a mock. The one wrapped module is `#/server/ledger/batch`, whose
 * `runWithLedgerBatch` stays real behind a spy: a fake `LEDGER` namespace could not pin "no batch",
 * because a batch flushes only what `touchLedgerAccount` collected and this repository never calls
 * it, so the spy is the only observation that a handler opened one at all.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { categories } from '#/server/db/schema'
import {
  addSecondMember,
  createBudgetWorld,
  seedCategory,
} from '#/server/repos/__tests__/budget-harness'
import { ForbiddenError, NotFoundError } from '#/server/repos/errors'
import { createScope } from '#/server/repos/scope'

import {
  archiveCategory,
  createCategory,
  deleteCategory,
  getCategory,
  listCategories,
  moveCategory,
  reorderCategories,
  restoreCategory,
  seedStandardCategories,
  updateCategory,
} from '../categories'

import type * as LedgerBatchModule from '#/server/ledger/batch'
import type { BudgetWorld } from '#/server/repos/__tests__/budget-harness'

/** The guard the handlers call: a spy, so a case can assert it was reached or was not. */
const requireOrg = vi.hoisted(() => vi.fn())
/** The ledger batch opener, still the real one behind this spy. */
const batchSpy = vi.hoisted(() => vi.fn())

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

vi.mock('#/server/ledger/batch', async (importOriginal) => {
  const actual = await importOriginal<typeof LedgerBatchModule>()
  return {
    ...actual,
    runWithLedgerBatch: (
      ...args: Parameters<typeof actual.runWithLedgerBatch>
    ) => {
      batchSpy(...args)
      return actual.runWithLedgerBatch(...args)
    },
  }
})

vi.mock('cloudflare:workers', () => ({ env: {} }))

type Handler = (call: { data: unknown }) => Promise<unknown>

const call = async (handler: unknown, data: unknown) =>
  (handler as Handler)({ data })

/** The tree every case starts from, in workspace A: a parent with a child, and three loose rows. */
const TREE = {
  parent: 'cat-food',
  child: 'cat-groceries',
  loose: 'cat-home',
  archived: 'cat-old',
  unused: 'cat-unused',
} as const

let world: BudgetWorld

beforeEach(async () => {
  requireOrg.mockReset()
  batchSpy.mockReset()
  world = await createBudgetWorld()
  requireOrg.mockResolvedValue(world.scope)

  await seedCategory(world.db, { id: TREE.parent, name: 'Food' })
  await seedCategory(world.db, {
    id: TREE.child,
    name: 'Groceries',
    parentId: TREE.parent,
  })
  await seedCategory(world.db, { id: TREE.loose, name: 'Home' })
  await seedCategory(world.db, { id: TREE.archived, name: 'Old' })
  await seedCategory(world.db, { id: TREE.unused, name: 'Unused' })
  await seedCategory(world.db, {
    id: 'cat-b-food',
    name: 'Food',
    organizationId: 'org-b',
  })
})

/** Whole rows of every workspace, so a refused call can be shown to have changed none of them. */
const allCategories = () =>
  world.db.select().from(categories).orderBy(categories.id)

/** Each handler with an input that is valid against {@link TREE}, in the order the file exports. */
const HANDLERS: ReadonlyArray<{
  readonly name: string
  readonly run: () => Promise<unknown>
}> = [
  {
    name: 'listCategories',
    run: () => call(listCategories, { includeArchived: true }),
  },
  {
    name: 'getCategory',
    run: () => call(getCategory, { categoryId: TREE.parent }),
  },
  { name: 'createCategory', run: () => call(createCategory, { name: 'Pets' }) },
  {
    name: 'updateCategory',
    run: () =>
      call(updateCategory, {
        categoryId: TREE.parent,
        patch: { name: 'Meals' },
      }),
  },
  {
    name: 'archiveCategory',
    run: () => call(archiveCategory, { categoryId: TREE.loose }),
  },
  {
    name: 'restoreCategory',
    run: () => call(restoreCategory, { categoryId: TREE.archived }),
  },
  {
    name: 'deleteCategory',
    run: () => call(deleteCategory, { categoryId: TREE.unused }),
  },
  {
    name: 'reorderCategories',
    run: () => call(reorderCategories, { ids: [TREE.loose, TREE.parent] }),
  },
  {
    name: 'moveCategory',
    run: () => call(moveCategory, { id: TREE.child, parentId: TREE.loose }),
  },
  {
    name: 'seedStandardCategories',
    run: () => call(seedStandardCategories, { locale: 'pl' }),
  },
]

describe('the guard and the scope', () => {
  it('has a case for every export of the handler file', async () => {
    const exported = Object.keys(await import('../categories')).sort()
    expect(HANDLERS.map(({ name }) => name).sort()).toEqual(exported)
    expect(exported).toHaveLength(10)
  })

  it.each(HANDLERS)(
    '$name resolves the workspace guard once and runs in the scope it returned',
    async ({ run }) => {
      await expect(run()).resolves.not.toBeInstanceOf(Error)

      expect(requireOrg).toHaveBeenCalledTimes(1)
    },
  )

  it('hands the scope requireOrg returned to the repository, and no other', async () => {
    // B's scope against A's ids: if a handler built or kept a scope of its own, the id would be
    // found. Every id-taking handler is refused as not found, as the repository would refuse B.
    requireOrg.mockResolvedValue(world.otherScope)
    const before = await allCategories()

    for (const { name, run } of HANDLERS) {
      if (
        ['listCategories', 'createCategory', 'seedStandardCategories'].includes(
          name,
        )
      )
        continue
      await expect(run(), name).rejects.toBeInstanceOf(NotFoundError)
    }

    expect(await allCategories()).toEqual(before)
    // Handlers with no id to refuse act inside B's workspace.
    const listed = (await call(listCategories, {})) as ReadonlyArray<{
      organizationId: string
    }>
    expect(listed.map((row) => row.organizationId)).toEqual(['org-b'])
    await expect(call(createCategory, { name: 'Pets' })).resolves.toMatchObject(
      { organizationId: 'org-b' },
    )
    await expect(
      call(seedStandardCategories, { locale: 'pl' }),
    ).resolves.toEqual({ created: 35, skipped: 1 })
    const seeded = await world.db
      .select()
      .from(categories)
      .orderBy(categories.id)
    expect(seeded.filter((row) => row.organizationId === 'org-a')).toEqual(
      before.filter((row) => row.organizationId === 'org-a'),
    )
    expect(seeded.find((row) => row.slug === 'housing')).toMatchObject({
      organizationId: 'org-b',
      name: 'Mieszkanie',
    })
  })

  it.each(HANDLERS)(
    '$name rejects when the guard rejects, and writes nothing',
    async ({ run }) => {
      const unauthenticated = new Error('not signed in')
      requireOrg.mockRejectedValue(unauthenticated)
      const before = await allCategories()

      await expect(run()).rejects.toBe(unauthenticated)

      expect(await allCategories()).toEqual(before)
    },
  )
})

describe('no handler opens a ledger batch', () => {
  it('runs the whole write sequence without reaching runWithLedgerBatch', async () => {
    for (const { run } of HANDLERS) await run()

    expect(batchSpy).not.toHaveBeenCalled()
  })

  it('sees a batch when one is opened through the entry point the handlers import', async () => {
    const { runWithLedgerBatch } = await import('#/server/ledger')

    await runWithLedgerBatch(async () => undefined)

    expect(batchSpy).toHaveBeenCalledTimes(1)
  })
})

describe('the strict input is refused at the door', () => {
  const REFUSED: ReadonlyArray<{
    readonly label: string
    readonly handler: unknown
    readonly data: unknown
  }> = [
    {
      label: 'an unsupported seed locale',
      handler: seedStandardCategories,
      data: { locale: 'de' },
    },
    {
      label: 'an extra seed field',
      handler: seedStandardCategories,
      data: { locale: 'pl', organizationId: 'org-b' },
    },
    {
      label: 'an unknown field on create',
      handler: createCategory,
      data: { name: 'Pets', organizationId: 'org-b' },
    },
    {
      label: 'an unknown field on update',
      handler: updateCategory,
      data: { categoryId: TREE.parent, patch: { name: 'Meals' }, extra: 1 },
    },
    {
      label: 'a parent in an update patch, which is the move handler’s alone',
      handler: updateCategory,
      data: { categoryId: TREE.child, patch: { parentId: null } },
    },
    {
      label: 'an unknown field on move',
      handler: moveCategory,
      data: { id: TREE.child, parentId: null, isSystem: true },
    },
    {
      label: 'a colour without its hash on create',
      handler: createCategory,
      data: { name: 'Pets', color: '0d6abb' },
    },
    {
      label: 'a colour of three digits on create',
      handler: createCategory,
      data: { name: 'Pets', color: '#fff' },
    },
    {
      label: 'a colour that is not hex on update',
      handler: updateCategory,
      data: { categoryId: TREE.parent, patch: { color: '#12345g' } },
    },
    {
      label: 'an icon outside the allowed names on create',
      handler: createCategory,
      data: { name: 'Pets', icon: 'not-an-icon' },
    },
    {
      label: 'an icon outside the allowed names on update',
      handler: updateCategory,
      data: { categoryId: TREE.parent, patch: { icon: '<script>' } },
    },
    {
      label: 'an empty id on get',
      handler: getCategory,
      data: { categoryId: '' },
    },
    {
      label: 'a blank id on archive',
      handler: archiveCategory,
      data: { categoryId: '   ' },
    },
    {
      label: 'an empty id on restore',
      handler: restoreCategory,
      data: { categoryId: '' },
    },
    {
      label: 'an empty id on delete',
      handler: deleteCategory,
      data: { categoryId: '' },
    },
    {
      label: 'an empty id on update',
      handler: updateCategory,
      data: { categoryId: '', patch: { name: 'Meals' } },
    },
    {
      label: 'an empty id on move',
      handler: moveCategory,
      data: { id: '', parentId: null },
    },
    {
      label: 'an empty id in a reorder',
      handler: reorderCategories,
      data: { ids: [TREE.parent, ''] },
    },
    {
      label: 'a 65-character id on get',
      handler: getCategory,
      data: { categoryId: 'x'.repeat(65) },
    },
    {
      label: 'a 65-character id on delete',
      handler: deleteCategory,
      data: { categoryId: 'x'.repeat(65) },
    },
    {
      label: 'a 65-character id on update',
      handler: updateCategory,
      data: { categoryId: 'x'.repeat(65), patch: { name: 'Meals' } },
    },
    {
      label: 'a 65-character parent on move',
      handler: moveCategory,
      data: { id: TREE.child, parentId: 'x'.repeat(65) },
    },
  ]

  it.each(REFUSED)(
    'refuses $label before the guard or the repository is reached',
    async ({ handler, data }) => {
      const before = await allCategories()

      await expect(call(handler, data)).rejects.toThrow()

      expect(requireOrg).not.toHaveBeenCalled()
      expect(await allCategories()).toEqual(before)
    },
  )

  it('accepts a 64-character id, so the bound is the one stated and no tighter', async () => {
    // Refused as not found by the repository, which is to say it passed the validator.
    await expect(
      call(getCategory, { categoryId: 'x'.repeat(64) }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('another workspace’s id is refused as not found', () => {
  const FOREIGN = 'cat-b-food'

  it.each([
    ['getCategory', () => call(getCategory, { categoryId: FOREIGN })],
    ['archiveCategory', () => call(archiveCategory, { categoryId: FOREIGN })],
    ['moveCategory', () => call(moveCategory, { id: FOREIGN, parentId: null })],
    [
      'moveCategory under it',
      () => call(moveCategory, { id: TREE.loose, parentId: FOREIGN }),
    ],
  ])('%s', async (_name, run) => {
    const before = await allCategories()

    await expect(run()).rejects.toBeInstanceOf(NotFoundError)

    expect(requireOrg).toHaveBeenCalledTimes(1)
    expect(await allCategories()).toEqual(before)
  })
})

describe('the write gate reaches the handlers', () => {
  it('refuses seeding for a plain member in a shared workspace and writes nothing', async () => {
    await addSecondMember(world.db)
    requireOrg.mockResolvedValue(
      createScope(world.db, {
        userId: 'user-b',
        organizationId: 'org-a',
        role: 'member',
      }),
    )
    const before = await allCategories()
    await expect(
      call(seedStandardCategories, { locale: 'pl' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(await allCategories()).toEqual(before)
  })

  it('refuses a plain member in a shared workspace through the create handler and writes nothing', async () => {
    await addSecondMember(world.db)
    requireOrg.mockResolvedValue(
      createScope(world.db, {
        userId: 'user-b',
        organizationId: 'org-a',
        role: 'member',
      }),
    )
    const before = await allCategories()

    await expect(call(createCategory, { name: 'Pets' })).rejects.toBeInstanceOf(
      ForbiddenError,
    )

    expect(await allCategories()).toEqual(before)
  })
})
