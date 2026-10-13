/**
 * The tenant-scoped repository base — the deep module this codebase is built on.
 *
 * It exists so that **forgetting the tenant filter is not expressible**. Nothing outside this file
 * calls `db.select()` on a tenant table: repositories are built from
 * {@link createTenantRepository} / {@link createTenantTableAccess}, and every read and write path
 * they expose begins with `WHERE organization_id = ?` taken from the {@link TenantScope} they were
 * handed. Callers append predicates; there is no argument, option or overload that removes that one.
 *
 * The guarantee is layered, strongest first, because a guarantee resting on a single mechanism rests
 * on that mechanism never being wrong:
 *
 * 1. **A scope is a required first parameter.** Every function below takes `scope: TenantScope`, and
 *    `createScope` is its only constructor (`./scope`). A query written without a workspace does not
 *    type-check; it has nothing to call.
 * 2. **The predicate is composed here, not by the caller.** {@link tenantFilter} ANDs the tenant
 *    equality with whatever the caller passes. A caller cannot pass a `where` that replaces it.
 * 3. **The tenant column is stamped on write.** {@link TenantInsert} removes `organizationId` from
 *    the payload type and {@link createTenantTableAccess} writes it from the scope *after* spreading
 *    the payload, so an insert cannot be aimed at another workspace even by a caller who tries.
 * 4. **A patch cannot move a row.** {@link TenantPatch} removes `organizationId`, `id` and
 *    `createdAt` — by the type, not by a runtime check somebody can forget to add — and every
 *    `UPDATE` re-checks the tenant column at runtime, for the caller who casts around the type.
 * 5. **{@link assertScopedWrite} is the backstop** for the one case the types cannot see: a
 *    dynamically assembled predicate list that collapses to nothing because every branch was
 *    skipped. Every `UPDATE` and `DELETE` below passes through it, and the transaction repository's
 *    policy predicates go through it explicitly.
 * 6. **A batch is composed of statements this file built.** {@link TenantTableAccess.insertManyStatement},
 *    `updateWhereStatement` and `removeWhereStatement` return an opaque {@link TenantStatement}
 *    that only this file can produce, and {@link runTenantBatch} refuses anything else, so a
 *    repository gets atomicity without ever writing the tenant column or holding a raw statement.
 *
 * And the disclosure rule that makes all of the above observable rather than merely true: a foreign
 * id answers {@link NotFoundError}, never `ForbiddenError`, and a foreign row is absent from counts
 * and sums as well as from lists. See `./errors`.
 *
 * **Vocabulary.** `docs/plans/04-auth-and-tenancy.md` names the capabilities *get, list, page,
 * insert, insertMany, update, remove*; the methods below spell the first two `findById` and
 * `findMany`, which is what the repositories built on this base already call them. One name each,
 * and this paragraph is the map between the two documents.
 *
 * The narrow `as` casts below are the price of one generic implementation over Drizzle's per-table
 * generics. Every one of them widens a concrete row shape into the same shape expressed through a
 * generic, they are confined to this file, and each is annotated where it sits.
 */

import * as asyncHooks from 'node:async_hooks'

import { and, asc, count, desc, eq, inArray, lt, sum } from 'drizzle-orm'

import {
  ConflictError,
  NotFoundError,
  QuotaExceededError,
  TenantIsolationError,
  UnscopedWriteError,
} from './errors'
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, clampPageSize } from './pagination'
import { createScope, tenantContextSchema } from './scope'

import type { SQL } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type {
  SQLiteColumn,
  SQLiteInsertValue,
  SQLiteTable,
  SQLiteUpdateSetSource,
} from 'drizzle-orm/sqlite-core'
import type { CursorPage } from './pagination'
import type { Database, TenantContext, TenantScope } from './scope'

/**
 * Re-exported so a repository imports its whole world from `./base`.
 *
 * The definitions live in `./scope`, which is binding-free and has no dependency on this module —
 * the direction matters: the scope does not know what a repository is, and a repository cannot be
 * written without a scope.
 */
export { createScope, tenantContextSchema }
export type { Database, TenantContext, TenantScope }
export { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE }
export type { CursorPage }

/* -------------------------------------------------------------------------- */
/* Table shapes                                                               */
/* -------------------------------------------------------------------------- */

/** Any table carrying the tenant discriminator. */
export type TenantTable = SQLiteTable & {
  readonly organizationId: SQLiteColumn
}

/** A tenant table with a single-column `id` primary key — everything but the join tables. */
export type KeyedTenantTable = TenantTable & { readonly id: SQLiteColumn }

/** Column or expression usable in `ORDER BY`. */
export type OrderTerm = SQL | SQLiteColumn

/**
 * An insert payload with the tenant column removed.
 *
 * Removed rather than optional: an optional field a caller may set is a field a caller will set, and
 * the value it would carry is the one thing this layer exists to decide.
 */
export type TenantInsert<TTable extends TenantTable> = Omit<
  TTable['$inferInsert'],
  'organizationId'
>

/**
 * A partial update: never the tenant column, never the primary key, never `createdAt`.
 *
 * Those three are exactly the fields whose mutation is a tenancy or identity change rather than an
 * edit, so they are absent from the type. A patch carrying `organizationId` does not compile.
 */
export type TenantPatch<TTable extends TenantTable> = Partial<
  Omit<TTable['$inferInsert'], 'organizationId' | 'id' | 'createdAt'>
>

export interface ListOptions {
  /** Extra predicate, ANDed with — never instead of — the tenant filter. */
  readonly where?: SQL
  readonly orderBy?: ReadonlyArray<OrderTerm>
  readonly limit?: number
}

export interface PageOptions {
  readonly where?: SQL
  readonly limit?: number
  /** The `id` of the last row of the previous page. */
  readonly cursor?: string | null
}

/* -------------------------------------------------------------------------- */
/* Predicate composition                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The predicate for a tenant table: always `organization_id = <scope>`, ANDed with anything the
 * caller adds. There is no code path in this module that produces a predicate without it.
 */
export function tenantFilter(
  scope: TenantScope,
  table: TenantTable,
  ...extra: ReadonlyArray<SQL | undefined>
): SQL {
  const scoped = eq(table.organizationId, scope.ctx.organizationId)
  const additional = extra.filter((part): part is SQL => part !== undefined)
  if (additional.length === 0) return scoped
  return and(scoped, ...additional) ?? scoped
}

/**
 * ANDs predicates that are all optional except the first.
 *
 * Drizzle's `and()` widens to `SQL | undefined`, which the write paths below refuse to accept; this
 * keeps the narrowing in one place instead of a `?? something` at every call site.
 */
export function allOf(
  first: SQL,
  ...rest: ReadonlyArray<SQL | undefined>
): SQL {
  return and(first, ...rest) ?? first
}

/**
 * Refuses a write whose caller-supplied predicates all came out empty.
 *
 * The tenant filter would still be appended, so the statement would be scoped — and it would also
 * rewrite or delete **every row the workspace owns**, which is not what a caller who built a filter
 * dynamically meant by "no conditions matched". This is the assertion behind the message
 * _"refusing to write to every row of `<entity>`"_.
 *
 * `entityName` is optional because most call sites are inside a repository that has already named
 * its table in a hundred other places; the message degrades to "this table" rather than the call
 * site degrading to not making the check.
 */
export function assertScopedWrite(
  predicates: ReadonlyArray<SQL | undefined>,
  entityName = 'this table',
): void {
  if (!predicates.some((predicate) => predicate !== undefined)) {
    throw new UnscopedWriteError(entityName)
  }
}

/**
 * `IN (...)` over a readonly list. Drizzle renders an empty list as `false`, so an empty filter
 * returns no rows rather than producing invalid SQL.
 */
export function inIds(
  column: SQLiteColumn,
  values: ReadonlyArray<string>,
): SQL {
  return inArray(column, [...values])
}

/* -------------------------------------------------------------------------- */
/* Seam: plan quotas (the resolver is 22-S1)                                  */
/* -------------------------------------------------------------------------- */

/**
 * A metered resource name.
 *
 * A string alias deliberately: the metric vocabulary and its ceilings belong to the plan catalogue
 * (`src/lib/plans.ts`, plan 22), which is browser-safe and must not be pulled into the data layer to
 * satisfy a type. Plan `22-S1` narrows this alias to that union in one edit, and every call site
 * below then has to name a metric the catalogue actually sells.
 */
export type QuotaMetric = string

/** No ceiling. What {@link LimitResolver} returns for an uncapped metric. */
export const UNLIMITED = Number.POSITIVE_INFINITY

/** Answers "how many of `metric` may this workspace hold". Installed once per isolate. */
export type LimitResolver = (
  scope: TenantScope,
  metric: QuotaMetric,
) => Promise<number>

/**
 * Until `22-S1` installs the real resolver, nothing is capped.
 *
 * Stated rather than hidden: this is a **permissive** default, so the gap before billing lands looks
 * like "no limit was enforced" rather than "every write failed". The moment the resolver is
 * installed every {@link assertWithinLimit} call site starts enforcing without being edited — which
 * is the whole reason for defining the seam here rather than promising it later.
 */
const unlimitedResolver: LimitResolver = async () => UNLIMITED

let limitResolver: LimitResolver = unlimitedResolver

/**
 * Installs the plan-limit resolver. Module-level because the answer is request-independent and one
 * isolate serves many requests; passing `null` restores the permissive default.
 */
export function setLimitResolver(resolver: LimitResolver | null): void {
  limitResolver = resolver ?? unlimitedResolver
}

/**
 * Throws {@link QuotaExceededError} when the workspace may not hold `requested` of `metric`.
 *
 * The call convention, and the whole reason this sits at the repository boundary: it is called
 * **inside the repository, before the write**, with the count the workspace would end up at
 * (`current + 1`). A check in a server function is one call site away from being skipped, and
 * skipped is silent.
 */
export async function assertWithinLimit(
  scope: TenantScope,
  metric: QuotaMetric,
  requested: number,
): Promise<void> {
  const limit = await limitResolver(scope, metric)
  if (limit === UNLIMITED) return
  if (requested > limit) {
    throw new QuotaExceededError(metric, limit, Math.max(requested - 1, 0))
  }
}

/* -------------------------------------------------------------------------- */
/* Seam: the ledger batch (the collector is 09-S2)                            */
/* -------------------------------------------------------------------------- */

/**
 * The accounts whose balance history the unit of work running **in this async context** has
 * invalidated (plan `09-S2`, `docs/MONEY.md` §5.4).
 *
 * **`AsyncLocalStorage`, not a module variable, and the distinction is the whole point.** The
 * namespace binding beside it in `../ledger/batch.ts` may live on the module because a binding is
 * request-independent: every request in the isolate wants the same one. A *collector* is the most
 * request-dependent thing in this file. One isolate serves many requests and workerd interleaves
 * their handlers at every `await`, so a module variable cannot tell this request's collector from
 * the one a request currently suspended mid-`await` installed — and the loser is silent: the
 * request that settles first tears the collector down while the other is still writing, and every
 * account touched after that moment is dropped with no error anywhere. `docs/MONEY.md` §5.5 rules
 * that out in as many words.
 *
 * Because the store is per-context there is nothing to install and nothing to uninstall, so no
 * `finally` anywhere can take away a collector that belongs to somebody else.
 */
let store: asyncHooks.AsyncLocalStorage<Set<string>> | null = null

/**
 * The store, constructed on first use rather than when the module loads.
 *
 * **This is about the dev server, not about the runtime.** Several route modules import values from
 * the repository layer, so `base.ts` is in the client module graph. A production build shakes it
 * out and the browser never sees it; `vite dev` does no such shaking, so the module is evaluated
 * in the browser, where `node:async_hooks` is externalised to a stub that throws the moment
 * anything is read off it.
 *
 * **Hence the namespace import, which is load-bearing and must not be tidied into a named one.**
 * Vite rewrites `import { AsyncLocalStorage } from 'node:async_hooks'` into a property read at
 * module scope - `const AsyncLocalStorage = __vite__cjsImport0_node_async_hooks['AsyncLocalStorage']`
 * - which trips the stub while the module is still being evaluated, breaking hydration on every
 * page and taking the whole e2e suite with it. `import * as` compiles to a bare binding, so the
 * only read of the namespace happens below, inside a function no browser ever calls.
 *
 * Constructing on first use rather than at module scope is the same argument one step later.
 *
 * None of this is the real repair. A client route should not be importing repository values at
 * all; that is a layering problem older than this line, which this line only made fatal, and it is
 * not settled here.
 *
 * The `let` is per-isolate and request-independent - the same category as `ports` in
 * `../ledger/batch.ts`, and not the category that caused the bug this store exists to fix.
 */
function ledgerStore(): asyncHooks.AsyncLocalStorage<Set<string>> {
  store ??= new asyncHooks.AsyncLocalStorage<Set<string>>()
  return store
}

/**
 * Runs `work` with `collector` gathering touched account ids for the whole of its async context.
 *
 * Balance history is rebuilt wholesale through the `LEDGER` Durable Object, never accumulated, and
 * the rebuild is enqueued **once per touched account** after the work settles — including when it
 * throws, because by then the rows are committed. Settling and enqueuing are `runWithLedgerBatch`'s
 * (`../ledger/batch.ts`); this seam is here so that no repository has to be edited later to gain it.
 */
export function runWithLedgerCollector<T>(
  collector: Set<string>,
  work: () => T,
): T {
  return ledgerStore().run(collector, work)
}

/** The collector open in this async context, or `null` when the caller is outside a batch. */
export function currentLedgerCollector(): ReadonlySet<string> | null {
  return ledgerStore().getStore() ?? null
}

/**
 * Records that `accountId`'s balance history is stale.
 *
 * **A no-op when no batch is open in this context, and that is the designed behaviour rather than
 * an oversight.** `runWithLedgerBatch` wraps every server-function invocation, cron body and
 * queue-handler body, so in the running product a collector is open wherever a write happens; and
 * the nightly rebuild cron re-derives every qualifying account regardless, which is what heals a
 * write path that ran outside a batch.
 */
export function touchLedgerAccount(accountId: string): void {
  ledgerStore().getStore()?.add(accountId)
}

/* -------------------------------------------------------------------------- */
/* Seam: the tenant batch                                                     */
/* -------------------------------------------------------------------------- */

declare const tenantStatementBrand: unique symbol

/**
 * One write statement, built by this file under one scope and not yet run. `TResult` is what the
 * batch hands back for it (the `RETURNING` rows).
 *
 * Opaque on purpose: the only producers are the `…Statement` builders on {@link TenantTableAccess},
 * which stamp and scope it exactly as the executing methods do, and the only consumer is
 * {@link runTenantBatch}. A repository can therefore compose writes into one atomic unit without
 * writing `organization_id` itself, which the fork guard in `tenant-isolation.test.ts` forbids.
 *
 * **It is a handle, not the Drizzle query.** A Drizzle query is a thenable, so awaiting one — or
 * returning it from an `async` function — runs it on the spot instead of handing it on. The handle
 * has no `then`, so a statement can be built in one `await`ed function and batched in another.
 */
export interface TenantStatement<TResult = unknown> {
  readonly [tenantStatementBrand]: TResult
}

/** What {@link runTenantBatch} resolves to: one result per statement, in order. */
export type TenantBatchResults<T extends ReadonlyArray<TenantStatement>> = {
  [K in keyof T]: T[K] extends TenantStatement<infer TResult> ? TResult : never
}

/**
 * The query behind each handle, and which workspace and database handle built it.
 *
 * The brand is a type; this is its runtime half, for the caller who casts around the type. A
 * `WeakMap` so the record cannot be read or rewritten from outside this file, and so a statement
 * nobody runs is not kept alive by it.
 */
const statementOrigins = new WeakMap<
  object,
  {
    readonly query: BatchItem<'sqlite'>
    readonly organizationId: string
    readonly db: Database
  }
>()

function brandStatement<TResult>(
  scope: TenantScope,
  query: BatchItem<'sqlite'>,
): TenantStatement<TResult> {
  // The handle is an empty object: its identity is the key, and the brand exists only as a type.
  const handle = {} as TenantStatement<TResult>
  statementOrigins.set(handle, {
    query,
    organizationId: scope.ctx.organizationId,
    db: scope.db,
  })
  return handle
}

/**
 * Runs `statements` as one atomic unit: all of them are applied or none is.
 *
 * Refuses before anything runs an empty batch ({@link ConflictError}) and any statement that was not
 * built here under **this** scope and **this** database handle ({@link TenantIsolationError}).
 * Without that check a batch could carry another workspace's statement under the caller's name.
 *
 * Results come back in statement order. A statement that matched nothing contributes an empty
 * list; it does not fail the batch, so a caller that needs "this row must exist" reads the results
 * and decides.
 */
export async function runTenantBatch<
  T extends Readonly<[TenantStatement, ...Array<TenantStatement>]>,
>(scope: TenantScope, statements: T): Promise<TenantBatchResults<T>> {
  if (statements.length === 0) {
    throw new ConflictError('A batch needs at least one statement.')
  }
  const queries = statements.map((statement) => {
    const origin = statementOrigins.get(statement)
    if (
      origin === undefined ||
      origin.organizationId !== scope.ctx.organizationId ||
      origin.db !== scope.db
    ) {
      throw new TenantIsolationError('a batch statement')
    }
    return origin.query
  })
  // `map` loses the tuple shape Drizzle's `batch` wants, and the results' types were fixed per
  // statement when it was built; both widenings stay inside this function.
  const results = await scope.db.batch(
    queries as unknown as [BatchItem<'sqlite'>, ...Array<BatchItem<'sqlite'>>],
  )
  return results as unknown as TenantBatchResults<T>
}

/* -------------------------------------------------------------------------- */
/* Generic access for tables without a single-column primary key              */
/* -------------------------------------------------------------------------- */

export interface TenantTableAccess<TTable extends TenantTable> {
  readonly table: TTable
  readonly entityName: string
  /** Every matching row in the workspace, in the requested order. The plan's *list*. */
  findMany: (
    scope: TenantScope,
    options?: ListOptions,
  ) => Promise<Array<TTable['$inferSelect']>>
  findOne: (
    scope: TenantScope,
    where: SQL,
  ) => Promise<TTable['$inferSelect'] | null>
  count: (scope: TenantScope, where?: SQL) => Promise<number>
  /**
   * `SUM(column)` over the workspace's rows.
   *
   * On a `…_minor` column the result is a count of minor units and stays one: SQLite sums integers
   * as integers, and no step of this function divides, multiplies or formats. Anything that wants a
   * decimal goes through `src/lib/money`.
   */
  sumOf: (
    scope: TenantScope,
    column: SQLiteColumn,
    where?: SQL,
  ) => Promise<number>
  insert: (
    scope: TenantScope,
    values: TenantInsert<TTable>,
  ) => Promise<TTable['$inferSelect']>
  /**
   * The row, or `null` when a unique index on `target` says this workspace already has it.
   *
   * For the caller whose duplicate is an expected answer rather than a fault — a cron that
   * re-offers the same occasion after a transient failure, an idempotent replay. `null` is that
   * answer, decided by the database in one statement: a read-then-write pre-check lets two
   * concurrent ticks both find the row absent, and matching the error text a failed insert would
   * have raised is not portable, since SQLite names the columns and D1 wraps the message again.
   *
   * `target` names the index's columns, which is what SQLite's `ON CONFLICT` clause takes. Only a
   * *unique* index counts: a conflict on anything else is still a thrown error, as it should be.
   */
  insertOnConflictDoNothing: (
    scope: TenantScope,
    values: TenantInsert<TTable>,
    target: ReadonlyArray<SQLiteColumn>,
  ) => Promise<TTable['$inferSelect'] | null>
  insertMany: (
    scope: TenantScope,
    values: ReadonlyArray<TenantInsert<TTable>>,
  ) => Promise<Array<TTable['$inferSelect']>>
  updateWhere: (
    scope: TenantScope,
    where: SQL,
    patch: TenantPatch<TTable>,
  ) => Promise<Array<TTable['$inferSelect']>>
  removeWhere: (scope: TenantScope, where: SQL) => Promise<number>
  /**
   * The statement {@link TenantTableAccess.insertMany} runs, for {@link runTenantBatch}. Same
   * stamping; the batch result is the inserted rows. An empty list builds nothing and throws.
   */
  insertManyStatement: (
    scope: TenantScope,
    values: readonly [TenantInsert<TTable>, ...Array<TenantInsert<TTable>>],
  ) => TenantStatement<Array<TTable['$inferSelect']>>
  /**
   * The statement {@link TenantTableAccess.updateWhere} runs, for {@link runTenantBatch}. Same
   * guards; the batch result is the updated rows. An empty patch builds nothing and throws.
   */
  updateWhereStatement: (
    scope: TenantScope,
    where: SQL,
    patch: TenantPatch<TTable>,
  ) => TenantStatement<Array<TTable['$inferSelect']>>
  /**
   * The statement {@link TenantTableAccess.removeWhere} runs, for {@link runTenantBatch}. Same
   * guards; the batch result is the deleted rows.
   */
  removeWhereStatement: (
    scope: TenantScope,
    where: SQL,
  ) => TenantStatement<Array<TTable['$inferSelect']>>
}

/**
 * Refuses a patch that carries the tenant column.
 *
 * {@link TenantPatch} already removes it, so this fires only for a caller who cast around the type
 * — and that is exactly the caller worth stopping. It throws rather than dropping the key silently,
 * because an `UPDATE` that quietly ignores half of what it was asked to do is a bug that surfaces
 * as missing data much later, and "this row now belongs to another workspace" is not a mistake to
 * absorb quietly.
 */
function assertPatchCannotMoveRow(patch: object, entityName: string): void {
  if (Object.hasOwn(patch, 'organizationId')) {
    throw new TenantIsolationError(entityName)
  }
}

export function createTenantTableAccess<TTable extends TenantTable>(
  table: TTable,
  entityName: string,
): TenantTableAccess<TTable> {
  type Row = TTable['$inferSelect']

  async function findMany(
    scope: TenantScope,
    options: ListOptions = {},
  ): Promise<Array<Row>> {
    const query = scope.db
      .select()
      .from(table)
      .where(tenantFilter(scope, table, options.where))
      .$dynamic()

    if (options.orderBy && options.orderBy.length > 0) {
      query.orderBy(...options.orderBy)
    }
    if (options.limit !== undefined) {
      query.limit(options.limit)
    }

    // `select()` with no field list selects every column of `table`, so the rows are `Row`.
    return await query
  }

  async function findOne(scope: TenantScope, where: SQL): Promise<Row | null> {
    const rows = await findMany(scope, { where, limit: 1 })
    return rows[0] ?? null
  }

  async function countRows(scope: TenantScope, where?: SQL): Promise<number> {
    const rows = await scope.db
      .select({ value: count() })
      .from(table)
      .where(tenantFilter(scope, table, where))
    return rows[0]?.value ?? 0
  }

  async function sumOf(
    scope: TenantScope,
    column: SQLiteColumn,
    where?: SQL,
  ): Promise<number> {
    const rows = await scope.db
      .select({ value: sum(column) })
      .from(table)
      .where(tenantFilter(scope, table, where))
    const value = rows.at(0)?.value
    // `SUM` over no rows is SQL NULL, which is zero of whatever unit the column counts.
    return value === undefined || value === null ? 0 : Number(value)
  }

  function buildInsertMany(
    scope: TenantScope,
    values: ReadonlyArray<TenantInsert<TTable>>,
  ) {
    // The tenant column is stamped from the scope and written *after* the caller's payload is
    // spread, so a value smuggled in through a cast is overwritten rather than honoured.
    const records = values.map(
      (value) =>
        ({
          ...value,
          organizationId: scope.ctx.organizationId,
        }) as SQLiteInsertValue<TTable>,
    )

    return scope.db.insert(table).values(records).returning()
  }

  async function insertMany(
    scope: TenantScope,
    values: ReadonlyArray<TenantInsert<TTable>>,
  ): Promise<Array<Row>> {
    if (values.length === 0) return []
    return await buildInsertMany(scope, values)
  }

  async function insert(
    scope: TenantScope,
    values: TenantInsert<TTable>,
  ): Promise<Row> {
    const rows = await insertMany(scope, [values])
    const row = rows.at(0)
    if (row === undefined) {
      // `RETURNING` came back empty, which on D1 means the statement did not execute. Not a
      // `NotFoundError`: nothing was looked for.
      throw new ConflictError(`Inserting a ${entityName} row returned nothing.`)
    }
    return row
  }

  async function insertOnConflictDoNothing(
    scope: TenantScope,
    values: TenantInsert<TTable>,
    target: ReadonlyArray<SQLiteColumn>,
  ): Promise<Row | null> {
    // Stamped after the caller's payload, for the reason spelled out in `insertMany`.
    const record = {
      ...values,
      organizationId: scope.ctx.organizationId,
    } as SQLiteInsertValue<TTable>

    const rows = (await scope.db
      .insert(table)
      .values(record)
      .onConflictDoNothing({ target: [...target] })
      .returning()) as Array<Row>

    return rows.at(0) ?? null
  }

  function assertUpdatable(where: SQL, patch: TenantPatch<TTable>): void {
    assertScopedWrite([where], entityName)
    assertPatchCannotMoveRow(patch, entityName)
  }

  function buildUpdateWhere(
    scope: TenantScope,
    where: SQL,
    patch: TenantPatch<TTable>,
  ) {
    return scope.db
      .update(table)
      .set(patch as SQLiteUpdateSetSource<TTable>)
      .where(tenantFilter(scope, table, where))
      .returning()
  }

  async function updateWhere(
    scope: TenantScope,
    where: SQL,
    patch: TenantPatch<TTable>,
  ): Promise<Array<Row>> {
    assertUpdatable(where, patch)

    if (Object.keys(patch).length === 0) {
      // An empty patch is a no-op, not an `UPDATE … SET` with nothing to set (which is a syntax
      // error). Returning the matching rows keeps the caller's contract: "these are the rows".
      return findMany(scope, { where })
    }

    return await buildUpdateWhere(scope, where, patch)
  }

  function buildRemoveWhere(scope: TenantScope, where: SQL) {
    assertScopedWrite([where], entityName)

    return scope.db
      .delete(table)
      .where(tenantFilter(scope, table, where))
      .returning()
  }

  async function removeWhere(scope: TenantScope, where: SQL): Promise<number> {
    const rows = (await buildRemoveWhere(scope, where)) as Array<Row>

    return rows.length
  }

  return {
    table,
    entityName,
    findMany,
    findOne,
    count: countRows,
    sumOf,
    insert,
    insertOnConflictDoNothing,
    insertMany,
    updateWhere,
    removeWhere,
    insertManyStatement: (scope, values) =>
      brandStatement(scope, buildInsertMany(scope, values)),
    updateWhereStatement(scope, where, patch) {
      assertUpdatable(where, patch)
      if (Object.keys(patch).length === 0) {
        throw new ConflictError(
          `Updating a ${entityName} row with an empty patch builds no statement.`,
        )
      }
      return brandStatement(scope, buildUpdateWhere(scope, where, patch))
    },
    removeWhereStatement: (scope, where) =>
      brandStatement(scope, buildRemoveWhere(scope, where)),
  }
}

/* -------------------------------------------------------------------------- */
/* Generic access for tables keyed by a single `id` column                    */
/* -------------------------------------------------------------------------- */

export interface TenantRepository<
  TTable extends KeyedTenantTable,
> extends TenantTableAccess<TTable> {
  /** The row, or `null`. A row in another workspace is `null` — it does not exist here. */
  findById: (
    scope: TenantScope,
    id: string,
  ) => Promise<TTable['$inferSelect'] | null>
  /** The row, or {@link NotFoundError}. Never `ForbiddenError`: see `./errors`. */
  requireById: (
    scope: TenantScope,
    id: string,
  ) => Promise<TTable['$inferSelect']>
  findByIds: (
    scope: TenantScope,
    ids: ReadonlyArray<string>,
  ) => Promise<Array<TTable['$inferSelect']>>
  exists: (scope: TenantScope, id: string) => Promise<boolean>
  update: (
    scope: TenantScope,
    id: string,
    patch: TenantPatch<TTable>,
  ) => Promise<TTable['$inferSelect'] | null>
  requireUpdate: (
    scope: TenantScope,
    id: string,
    patch: TenantPatch<TTable>,
  ) => Promise<TTable['$inferSelect']>
  remove: (scope: TenantScope, id: string) => Promise<boolean>
  requireRemove: (scope: TenantScope, id: string) => Promise<void>
  /** Keyset pagination on the creation-sortable primary key, newest first. */
  page: (
    scope: TenantScope,
    options?: PageOptions,
  ) => Promise<CursorPage<TTable['$inferSelect']>>
}

export function createTenantRepository<TTable extends KeyedTenantTable>(
  table: TTable,
  entityName: string,
): TenantRepository<TTable> {
  type Row = TTable['$inferSelect']
  const access = createTenantTableAccess(table, entityName)

  async function findById(scope: TenantScope, id: string): Promise<Row | null> {
    return access.findOne(scope, eq(table.id, id))
  }

  async function requireById(scope: TenantScope, id: string): Promise<Row> {
    const row = await findById(scope, id)
    if (!row) throw new NotFoundError(entityName, id)
    return row
  }

  async function update(
    scope: TenantScope,
    id: string,
    patch: TenantPatch<TTable>,
  ): Promise<Row | null> {
    const rows = await access.updateWhere(scope, eq(table.id, id), patch)
    return rows[0] ?? null
  }

  async function remove(scope: TenantScope, id: string): Promise<boolean> {
    return (await access.removeWhere(scope, eq(table.id, id))) > 0
  }

  async function page(
    scope: TenantScope,
    options: PageOptions = {},
  ): Promise<CursorPage<Row>> {
    const limit = clampPageSize(options.limit)
    const cursorFilter = options.cursor
      ? lt(table.id, options.cursor)
      : undefined

    // One row past the page, so "is there more" is answered by the same query rather than by a
    // second `COUNT(*)` that can disagree with it under a concurrent insert.
    const rows = await access.findMany(scope, {
      where: and(options.where, cursorFilter),
      orderBy: [desc(table.id)],
      limit: limit + 1,
    })

    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    const last = items.at(-1)
    // Every keyed tenant table has a text `id`; reading it off the generic row needs a widening.
    const lastId =
      last === undefined ? undefined : (last as Record<string, unknown>).id

    return {
      items,
      nextCursor: hasMore && typeof lastId === 'string' ? lastId : null,
    }
  }

  return {
    ...access,
    findById,
    requireById,
    async findByIds(scope, ids) {
      if (ids.length === 0) return []
      return access.findMany(scope, { where: inIds(table.id, ids) })
    },
    async exists(scope, id) {
      return (await access.count(scope, eq(table.id, id))) > 0
    },
    update,
    async requireUpdate(scope, id, patch) {
      const row = await update(scope, id, patch)
      if (!row) throw new NotFoundError(entityName, id)
      return row
    },
    remove,
    async requireRemove(scope, id) {
      if (!(await remove(scope, id))) throw new NotFoundError(entityName, id)
    },
    page,
  }
}

/** Ordering helpers re-exported so a repository imports from this module only. */
export { asc, desc }
