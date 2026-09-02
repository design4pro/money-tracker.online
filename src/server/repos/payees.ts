/**
 * Payees — who was paid, who paid, and the strings that resolve to them.
 *
 * ---------------------------------------------------------------------------
 * THE FIVE RULES THIS MODULE EXISTS TO KEEP
 * ---------------------------------------------------------------------------
 *
 * 1. **{@link normalizePayeeName} is the matching key, and it is a pure function.** Every import
 *    batch, every alias write and every lookup goes through it, so a change to it changes
 *    historical matching behaviour — which is why it takes no scope, touches no database, and has
 *    its own block of cases in `__tests__/payees.test.ts` including idempotence.
 *
 * 2. **{@link resolvePayee} never creates.** A lookup that mints a payee turns one mistyped bank
 *    description into a permanent row nobody asked for, and an import that ran twice into two
 *    payees for one shop. Creation is explicit, from the form or the import preview.
 *
 * 3. **`categorization_mode` rewrites `category_id` and nothing else.** `enforce` re-files a
 *    payee's existing transactions; it does not touch `amount_minor`, `currency_code`,
 *    `ref_amount_minor` or `rate_e10`, and `__tests__/money-invariants.test.ts` asserts that by
 *    comparing every amount column before and after. A bulk `UPDATE` is where a stray `SET` clause
 *    does the most damage, so the assertion is on the columns rather than on the intent.
 *
 * 4. **No ledger rebuild is enqueued for a categorisation change, deliberately.** Re-filing two
 *    hundred transactions moves no money, so no day of any account's balance history changed. A
 *    rebuild here would be wasted work at exactly the scale where it hurts, and this sentence is
 *    the record of that decision rather than a defensive `touchLedgerAccount` nobody can remove
 *    later without wondering why it was there.
 *
 * 5. **The alias and ignored-name tables are bounded, and the bound is a {@link ConflictError}.**
 *    Fifty aliases per payee, five hundred ignored names per workspace. It is a sanity bound that
 *    stops an import loop from generating an unbounded table — not a plan feature — so it is
 *    never a `QuotaExceededError`, because that would put an upgrade prompt in front of a bug.
 */

import { and, count, eq, isNull, ne, or, sql } from 'drizzle-orm'
import { z } from 'zod'

import { newId } from '#/server/db/ids'
import {
  PAYEE_CATEGORIZATION_MODES,
  payeeAliases,
  payeeIgnoredNames,
  payeeTags,
  payees,
  recurringSeries,
  transactions,
} from '#/server/db/schema'

import {
  assertScopedWrite,
  createTenantRepository,
  createTenantTableAccess,
  tenantFilter,
} from './base'
import { assertCategoryUsable } from './categories'
import { ConflictError } from './errors'

import type {
  PayeeAliasRow,
  PayeeIgnoredNameRow,
  PayeeRow,
} from '#/server/db/schema'
import type { TenantScope } from './base'

/* -------------------------------------------------------------------------- */
/* Bounds                                                                      */
/* -------------------------------------------------------------------------- */

/** How many strings may resolve to one payee. See rule 5. */
export const MAX_ALIASES_PER_PAYEE = 50

/** How many strings a workspace may refuse to turn into payees. See rule 5. */
export const MAX_IGNORED_NAMES = 500

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

/** Thrown when an alias or ignored-name write would cross a sanity bound. */
export class PayeeListBoundError extends ConflictError {
  readonly limit: number

  constructor(what: string, limit: number) {
    super(`A workspace may hold at most ${limit} ${what}.`)
    this.limit = limit
  }
}

/** Thrown when one normalised string is asked to resolve to two payees. */
export class AliasTakenError extends ConflictError {
  readonly normalizedName: string
  readonly payeeId: string

  constructor(normalizedName: string, payeeId: string) {
    super(
      `"${normalizedName}" already resolves to payee ${payeeId}; one string cannot resolve to two payees.`,
    )
    this.normalizedName = normalizedName
    this.payeeId = payeeId
  }
}

/** Thrown when a merge is asked to fold a payee into itself. */
export class PayeeMergeError extends ConflictError {
  constructor(payeeId: string) {
    super(`Payee ${payeeId} cannot be merged into itself.`)
  }
}

/* -------------------------------------------------------------------------- */
/* Normalisation — the matching key                                            */
/* -------------------------------------------------------------------------- */

/**
 * The tokens a bank puts around a name that are never part of the name.
 *
 * Deliberately a fixed list rather than a heuristic: a heuristic that strips "one word in three"
 * would strip a different word as soon as somebody's statement format changed, and historical
 * matches would silently stop matching. Adding a token here is a decision with a test beside it.
 */
const NOISE_TOKENS: ReadonlySet<string> = new Set([
  // English card and transfer noise.
  'pos',
  'card',
  'payment',
  'purchase',
  'transaction',
  'sepa',
  'dd',
  'direct',
  'debit',
  'standing',
  'order',
  'ref',
  'reference',
  'auth',
  'visa',
  'mastercard',
  'maestro',
  'contactless',
  // Polish statement noise.
  'platnosc',
  'platnosci',
  'przelew',
  'zakup',
  'transakcja',
  'karta',
  'karty',
  'przy',
  'uzyciu',
  'blik',
])

/** A token that is a reference number rather than a word: `0012345678`, `tid1234567`. */
function isReferenceToken(token: string): boolean {
  return /^[a-z]{0,4}\d{4,}[a-z0-9]*$/u.test(token)
}

/**
 * The string a raw bank description is matched by.
 *
 * Lowercased, diacritics folded, punctuation collapsed to spaces, noise tokens removed and
 * trailing reference numbers dropped. Idempotent by construction — its output is already
 * lowercase ASCII words joined by single spaces, and a second pass finds nothing left to remove —
 * and `__tests__/payees.test.ts` asserts that rather than assuming it.
 *
 * **The empty result is refused, not returned.** A description made entirely of noise (`"CARD
 * PAYMENT"`) would normalise to `""`, and `""` is a key that matches every other all-noise
 * description in the workspace. When removal empties the string, the punctuation-folded form is
 * kept instead — which is exactly the string somebody puts on the ignored-names list.
 */
export function normalizePayeeName(raw: string): string {
  const folded = raw
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    // `ł` and `Ł` carry no combining mark, so NFD leaves them alone.
    .replace(/[łŁ]/gu, 'l')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ')

  if (folded === '') return ''

  const tokens = folded.split(' ')
  // Trailing reference numbers first: `tesco 4321 0099` is Tesco, and the digits are the terminal.
  while (tokens.length > 1 && isReferenceToken(tokens[tokens.length - 1])) {
    tokens.pop()
  }
  const kept = tokens.filter((token) => !NOISE_TOKENS.has(token))
  return kept.length === 0 ? folded : kept.join(' ')
}

/* -------------------------------------------------------------------------- */
/* Schemas                                                                     */
/* -------------------------------------------------------------------------- */

const idSchema = z.string().trim().min(1).max(64)
const nameSchema = z.string().trim().min(1).max(200)
const noteSchema = z.string().max(500)
const initialsSchema = z.string().trim().min(1).max(4)
const colorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-f]{6}$/iu, {
    error: 'A colour is a six-digit hex value, for example #0d6abb.',
  })

/**
 * A hostname, never a URL.
 *
 * `logo_domain` is a catalogue key, so `https://tesco.com/logo.png` stored in it is a key that
 * will never match. Rejecting the scheme at the boundary is cheaper than discovering it as a
 * missing logo six months later.
 */
const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(253)
  .regex(/^(?!-)[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+$/u, {
    error: 'A logo domain is a hostname such as tesco.com, not a full link.',
  })

const modeSchema = z.enum(PAYEE_CATEGORIZATION_MODES)

export const listPayeesSchema = z.strictObject({
  /** Free text over the payee's name. Absent means the whole list. */
  search: z.string().trim().min(1).max(200).optional(),
})
export type ListPayeesInput = z.input<typeof listPayeesSchema>

export const createPayeeSchema = z.strictObject({
  name: nameSchema,
  defaultCategoryId: idSchema.nullable().default(null),
  categorizationMode: modeSchema.default('hint'),
  logoDomain: domainSchema.nullable().default(null),
  logoInitials: initialsSchema.nullable().default(null),
  logoColor: colorSchema.nullable().default(null),
  note: noteSchema.nullable().default(null),
})
export type CreatePayeeInput = z.input<typeof createPayeeSchema>

export const updatePayeeSchema = z
  .strictObject({
    name: nameSchema,
    defaultCategoryId: idSchema.nullable(),
    categorizationMode: modeSchema,
    logoDomain: domainSchema.nullable(),
    logoInitials: initialsSchema.nullable(),
    logoColor: colorSchema.nullable(),
    note: noteSchema.nullable(),
  })
  .partial()
export type UpdatePayeeInput = z.input<typeof updatePayeeSchema>

export const mergePayeesSchema = z.strictObject({
  /** The payee that disappears. Its name survives as an alias of `into`. */
  from: idSchema,
  into: idSchema,
})
export type MergePayeesInput = z.input<typeof mergePayeesSchema>

export const addAliasSchema = z.strictObject({
  payeeId: idSchema,
  /** The raw string as it appears on a statement. Normalised before it is stored. */
  name: nameSchema,
})
export type AddAliasInput = z.input<typeof addAliasSchema>

export const ignoredNameSchema = z.strictObject({ name: nameSchema })
export type IgnoredNameInput = z.input<typeof ignoredNameSchema>

export const resolvePayeeSchema = z.strictObject({ rawName: nameSchema })
export type ResolvePayeeInput = z.input<typeof resolvePayeeSchema>

/* -------------------------------------------------------------------------- */
/* Returned shapes                                                             */
/* -------------------------------------------------------------------------- */

/** A payee, plus the one derived figure the list column shows. */
export interface PayeeSummary {
  readonly payee: PayeeRow
  readonly aliasCount: number
}

/** A payee and every string that resolves to it. What the detail screen is drawn from. */
export interface PayeeDetail {
  readonly payee: PayeeRow
  readonly aliases: ReadonlyArray<PayeeAliasRow>
}

/**
 * How a raw string was matched.
 *
 * `ignored` is a fourth answer beside the plan's three, and it is a different fact from `none`:
 * "this workspace has told us never to make a payee out of this string" is what stops an import
 * from offering the same "CARD PAYMENT" suggestion on every run.
 */
export type PayeeMatchSource = 'exact' | 'alias' | 'ignored' | 'none'

export interface PayeeMatch {
  readonly payeeId: string | null
  readonly source: PayeeMatchSource
  /** The key the lookup used. Returned so an import preview can show what it matched on. */
  readonly normalizedName: string
}

/**
 * What a payee suggests for a new transaction's category, and how hard.
 *
 * `off` payees are absent from the list rather than present with a null category: the entry form
 * asks "does this payee suggest anything", and a row that answers "no" is noise on the wire.
 */
export interface CategorySuggestion {
  readonly payeeId: string
  readonly categoryId: string
  /** `enforce` locks the field in the form; `hint` pre-fills something the person may change. */
  readonly mode: 'enforce' | 'hint'
}

/* -------------------------------------------------------------------------- */
/* Repositories                                                                */
/* -------------------------------------------------------------------------- */

const payeeRepo = createTenantRepository(payees, 'payee')
const aliasRepo = createTenantRepository(payeeAliases, 'payee alias')
const ignoredRepo = createTenantRepository(payeeIgnoredNames, 'ignored name')
const payeeTagAccess = createTenantTableAccess(payeeTags, 'payee tag')

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Every payee in the workspace, alphabetically, with its alias count.
 *
 * The counts come from one grouped query rather than one query per row: a workspace with three
 * hundred payees would otherwise cost three hundred round trips to draw a single column.
 */
export async function listPayees(
  scope: TenantScope,
  input: ListPayeesInput = {},
): Promise<ReadonlyArray<PayeeSummary>> {
  const { search } = listPayeesSchema.parse(input)

  const all = await payeeRepo.findMany(scope, { orderBy: [payees.name] })
  // Filtered and ordered here rather than in SQL, for the reason `resolvePayee` states at length:
  // SQLite's `lower()` is ASCII-only, so a search for "zabka" would not find "Żabka" and a
  // Polish workspace would conclude the box is broken. `localeCompare` sorts the same way.
  const needle = search === undefined ? null : normalizePayeeName(search)
  const rows = [...all]
    .filter(
      (row) =>
        needle === null || normalizePayeeName(row.name).includes(needle),
    )
    .sort((a, b) => a.name.localeCompare(b.name))

  const counts = await scope.db
    .select({ payeeId: payeeAliases.payeeId, value: count() })
    .from(payeeAliases)
    .where(tenantFilter(scope, payeeAliases))
    .groupBy(payeeAliases.payeeId)
  const byPayee = new Map(counts.map((row) => [row.payeeId, row.value]))

  return rows.map((payee) => ({
    payee,
    aliasCount: byPayee.get(payee.id) ?? 0,
  }))
}

/** One payee with its aliases, or {@link NotFoundError}. */
export async function getPayee(
  scope: TenantScope,
  payeeId: string,
): Promise<PayeeDetail> {
  const id = idSchema.parse(payeeId)
  const payee = await payeeRepo.requireById(scope, id)
  const aliases = await aliasRepo.findMany(scope, {
    where: eq(payeeAliases.payeeId, id),
    orderBy: [payeeAliases.normalizedName],
  })
  return { payee, aliases }
}

/** Every string this workspace has told the importer not to turn into a payee. */
export async function listIgnoredNames(
  scope: TenantScope,
): Promise<ReadonlyArray<PayeeIgnoredNameRow>> {
  return ignoredRepo.findMany(scope, {
    orderBy: [payeeIgnoredNames.normalizedName],
  })
}

/**
 * What each payee suggests for a new transaction's category.
 *
 * One row per payee that actually suggests something, so the entry form can pre-fill a category
 * the moment a payee is chosen without a round trip per keystroke. `off` payees and payees whose
 * default category has been archived or deleted are absent: a suggestion the picker cannot show is
 * worse than no suggestion, because the field would look filled and submit nothing.
 */
export async function listCategorySuggestions(
  scope: TenantScope,
): Promise<ReadonlyArray<CategorySuggestion>> {
  const rows = await payeeRepo.findMany(scope, {
    where: and(
      ne(payees.categorizationMode, 'off'),
      sql`${payees.defaultCategoryId} is not null`,
    ),
  })

  return rows.flatMap((row): Array<CategorySuggestion> => {
    const categoryId = row.defaultCategoryId
    const mode = row.categorizationMode
    if (categoryId === null) return []
    if (mode !== 'enforce' && mode !== 'hint') return []
    return [{ payeeId: row.id, categoryId, mode }]
  })
}

/**
 * Which payee a raw bank description belongs to — without creating anything.
 *
 * The order is deliberate and each step answers a different question:
 *
 * 1. **Ignored** — the workspace has said "stop asking about this string". Checked first, so a
 *    payee accidentally named "Card payment" cannot resurrect a suppressed suggestion.
 * 2. **Exact** — the description *is* a payee's name, compared case-insensitively. The strongest
 *    signal there is, and it needs no alias row to work.
 * 3. **Alias** — the normalised form is in `payee_aliases`, which is unique per workspace, so one
 *    string can never resolve to two payees.
 * 4. **None** — and the caller decides whether to offer creating one.
 *
 * Every query below runs under the tenant predicate, so a raw name whose alias exists only in
 * another workspace answers `none` rather than that workspace's payee.
 */
export async function resolvePayee(
  scope: TenantScope,
  input: ResolvePayeeInput,
): Promise<PayeeMatch> {
  const { rawName } = resolvePayeeSchema.parse(input)
  const normalizedName = normalizePayeeName(rawName)

  if (normalizedName === '') {
    return { payeeId: null, source: 'none', normalizedName }
  }

  const ignored = await ignoredRepo.findOne(
    scope,
    eq(payeeIgnoredNames.normalizedName, normalizedName),
  )
  if (ignored !== null) {
    return { payeeId: null, source: 'ignored', normalizedName }
  }

  // The exact step compares **normalised** names, and therefore reads the workspace's payees
  // rather than asking SQL. SQLite's `lower()` folds ASCII only, so `lower('Żabka') = 'żabka'` is
  // false — and an ASCII comparison here would answer "no match" for every Polish payee and let an
  // import mint a duplicate on every run. Correctness of the one matching key this module is built
  // on is worth more than an index lookup on a table that holds tens of rows.
  const candidates = await payeeRepo.findMany(scope)
  const exact = candidates.find(
    (row) => normalizePayeeName(row.name) === normalizedName,
  )
  if (exact !== undefined) {
    return { payeeId: exact.id, source: 'exact', normalizedName }
  }

  const alias = await aliasRepo.findOne(
    scope,
    eq(payeeAliases.normalizedName, normalizedName),
  )
  if (alias !== null) {
    return { payeeId: alias.payeeId, source: 'alias', normalizedName }
  }

  return { payeeId: null, source: 'none', normalizedName }
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Creates a payee.
 *
 * The default category is checked against **this workspace's live categories**, so a payee cannot
 * be created pointing at another tenant's category or at an archived one the form could not show.
 * Initials are derived when they were not given, because rule "the fallback is always sufficient"
 * means there is no state in which a payee has no visual.
 */
export async function createPayee(
  scope: TenantScope,
  input: CreatePayeeInput,
): Promise<PayeeRow> {
  const parsed = createPayeeSchema.parse(input)
  await assertCategoryUsable(scope, parsed.defaultCategoryId)

  const now = new Date()
  return payeeRepo.insert(scope, {
    id: newId(),
    name: parsed.name,
    defaultCategoryId: parsed.defaultCategoryId,
    categorizationMode: parsed.categorizationMode,
    logoDomain: parsed.logoDomain,
    logoInitials: parsed.logoInitials ?? initialsOf(parsed.name),
    logoColor: parsed.logoColor,
    logoSource: parsed.logoDomain === null ? null : 'manual',
    note: parsed.note,
    createdAt: now,
    updatedAt: now,
  })
}

/**
 * Edits a payee, and re-files its history when the edit turns `enforce` on.
 *
 * The re-file runs when the resulting state is `enforce` **and** something that decides the
 * outcome moved — the mode or the category. Editing a note therefore does not rewrite two hundred
 * rows. What it rewrites is `category_id`; see rule 3.
 */
export async function updatePayee(
  scope: TenantScope,
  payeeId: string,
  patch: UpdatePayeeInput,
): Promise<PayeeRow> {
  const id = idSchema.parse(payeeId)
  const parsed = updatePayeeSchema.parse(patch)
  const before = await payeeRepo.requireById(scope, id)

  if (parsed.defaultCategoryId !== undefined) {
    await assertCategoryUsable(scope, parsed.defaultCategoryId)
  }

  const row = await payeeRepo.requireUpdate(scope, id, {
    ...parsed,
    // A domain the person typed is `manual` and the fetcher must never overwrite it.
    ...(parsed.logoDomain === undefined
      ? {}
      : { logoSource: parsed.logoDomain === null ? null : 'manual' }),
    updatedAt: new Date(),
  })

  const decidingFieldMoved =
    (parsed.categorizationMode !== undefined &&
      parsed.categorizationMode !== before.categorizationMode) ||
    (parsed.defaultCategoryId !== undefined &&
      parsed.defaultCategoryId !== before.defaultCategoryId)

  if (row.categorizationMode === 'enforce' && decidingFieldMoved) {
    await applyCategorization(scope, row.id)
  }
  return row
}

/**
 * Re-files every one of a payee's transactions under its default category.
 *
 * One statement, `SET category_id` and `updated_at` only. No amount column is named, no ledger
 * rebuild is enqueued (rule 4), and the return value is the number of rows the statement claimed
 * so a screen can say what it did rather than closing a dialog silently.
 *
 * A payee that is not in `enforce`, or has no default category, re-files nothing — the function is
 * safe to call from any path that has just changed either.
 */
export async function applyCategorization(
  scope: TenantScope,
  payeeId: string,
): Promise<number> {
  const id = idSchema.parse(payeeId)
  const payee = await payeeRepo.requireById(scope, id)
  const categoryId = payee.defaultCategoryId
  if (payee.categorizationMode !== 'enforce' || categoryId === null) return 0

  const match = and(
    eq(transactions.payeeId, id),
    or(
      isNull(transactions.categoryId),
      ne(transactions.categoryId, categoryId),
    ),
  )
  assertScopedWrite([match], 'transactions')
  const rows = await scope.db
    .update(transactions)
    .set({ categoryId, updatedAt: new Date() })
    .where(tenantFilter(scope, transactions, match))
    .returning({ id: transactions.id })

  return rows.length
}

/**
 * Deletes a payee.
 *
 * Allowed with history, unlike an account or a used category: `transactions.payee_id` is
 * `ON DELETE SET NULL`, so what is lost is a label rather than a row, and a ledger line whose
 * payee has been deleted still states its amount, its account and its date. {@link mergePayees} is
 * the alternative the screen offers first, because it keeps the label.
 */
export async function deletePayee(
  scope: TenantScope,
  payeeId: string,
): Promise<void> {
  const id = idSchema.parse(payeeId)
  await payeeRepo.requireRemove(scope, id)
}

/**
 * Folds one payee into another: aliases, ignored-name safety, transactions and tags in one pass.
 *
 * The disappearing payee's **name becomes an alias** of the survivor, which is the whole point —
 * the next import that meets that string still resolves, instead of re-creating the payee that was
 * just merged away. Amount columns are untouched; see rule 3.
 */
export async function mergePayees(
  scope: TenantScope,
  input: MergePayeesInput,
): Promise<PayeeRow> {
  const parsed = mergePayeesSchema.parse(input)
  if (parsed.from === parsed.into) throw new PayeeMergeError(parsed.from)

  const from = await payeeRepo.requireById(scope, parsed.from)
  const into = await payeeRepo.requireById(scope, parsed.into)

  // The survivor's aliases plus the loser's must stay inside the per-payee bound.
  const moving = await aliasRepo.count(scope, eq(payeeAliases.payeeId, from.id))
  const held = await aliasRepo.count(scope, eq(payeeAliases.payeeId, into.id))
  if (held + moving + 1 > MAX_ALIASES_PER_PAYEE) {
    throw new PayeeListBoundError(
      `aliases for one payee`,
      MAX_ALIASES_PER_PAYEE,
    )
  }

  const aliasMatch = eq(payeeAliases.payeeId, from.id)
  assertScopedWrite([aliasMatch], 'payee aliases')
  await scope.db
    .update(payeeAliases)
    .set({ payeeId: into.id })
    .where(tenantFilter(scope, payeeAliases, aliasMatch))

  const transactionMatch = eq(transactions.payeeId, from.id)
  assertScopedWrite([transactionMatch], 'transactions')
  await scope.db
    .update(transactions)
    .set({ payeeId: into.id, updatedAt: new Date() })
    .where(tenantFilter(scope, transactions, transactionMatch))

  const seriesMatch = eq(recurringSeries.payeeId, from.id)
  assertScopedWrite([seriesMatch], 'recurring series')
  await scope.db
    .update(recurringSeries)
    .set({ payeeId: into.id, updatedAt: new Date() })
    .where(tenantFilter(scope, recurringSeries, seriesMatch))

  // Tag links are a set, so the loser's links are moved only where the survivor has none —
  // `payee_tags` is keyed on the pair and a blind move would collide.
  const survivorTags = await payeeTagAccess.findMany(scope, {
    where: eq(payeeTags.payeeId, into.id),
  })
  const held2 = new Set(survivorTags.map((row) => row.tagId))
  const losingTags = await payeeTagAccess.findMany(scope, {
    where: eq(payeeTags.payeeId, from.id),
  })
  const movable = losingTags
    .filter((row) => !held2.has(row.tagId))
    .map((row) => row.tagId)
  if (movable.length > 0) {
    await payeeTagAccess.insertMany(
      scope,
      movable.map((tagId) => ({ payeeId: into.id, tagId })),
    )
  }
  await payeeTagAccess.removeWhere(scope, eq(payeeTags.payeeId, from.id))

  // The loser's name survives as an alias, unless something already claims that key.
  const normalizedName = normalizePayeeName(from.name)
  if (normalizedName !== '') {
    const taken = await aliasRepo.findOne(
      scope,
      eq(payeeAliases.normalizedName, normalizedName),
    )
    if (taken === null) {
      await aliasRepo.insert(scope, {
        id: newId(),
        payeeId: into.id,
        normalizedName,
        createdAt: new Date(),
      })
    }
  }

  await payeeRepo.requireRemove(scope, from.id)
  return payeeRepo.requireById(scope, into.id)
}

/**
 * Teaches a payee one more string.
 *
 * The normalised key is unique per workspace by index; the explicit lookup exists so the caller
 * gets a sentence naming the payee that already holds it rather than a constraint violation.
 */
export async function addAlias(
  scope: TenantScope,
  input: AddAliasInput,
): Promise<PayeeAliasRow> {
  const parsed = addAliasSchema.parse(input)
  await payeeRepo.requireById(scope, parsed.payeeId)

  const normalizedName = normalizePayeeName(parsed.name)
  if (normalizedName === '') {
    throw new ConflictError(
      `"${parsed.name}" normalises to nothing and cannot be an alias.`,
    )
  }

  const existing = await aliasRepo.findOne(
    scope,
    eq(payeeAliases.normalizedName, normalizedName),
  )
  if (existing !== null) {
    throw new AliasTakenError(normalizedName, existing.payeeId)
  }

  const held = await aliasRepo.count(
    scope,
    eq(payeeAliases.payeeId, parsed.payeeId),
  )
  if (held + 1 > MAX_ALIASES_PER_PAYEE) {
    throw new PayeeListBoundError(
      'aliases for one payee',
      MAX_ALIASES_PER_PAYEE,
    )
  }

  return aliasRepo.insert(scope, {
    id: newId(),
    payeeId: parsed.payeeId,
    normalizedName,
    createdAt: new Date(),
  })
}

/** Forgets one alias. An id from another workspace is a {@link NotFoundError}. */
export async function removeAlias(
  scope: TenantScope,
  aliasId: string,
): Promise<void> {
  await aliasRepo.requireRemove(scope, idSchema.parse(aliasId))
}

/** Adds a string the importer must never turn into a payee. Idempotent on the normalised key. */
export async function addIgnoredName(
  scope: TenantScope,
  input: IgnoredNameInput,
): Promise<PayeeIgnoredNameRow> {
  const parsed = ignoredNameSchema.parse(input)
  const normalizedName = normalizePayeeName(parsed.name)
  if (normalizedName === '') {
    throw new ConflictError(
      `"${parsed.name}" normalises to nothing and cannot be ignored.`,
    )
  }

  const existing = await ignoredRepo.findOne(
    scope,
    eq(payeeIgnoredNames.normalizedName, normalizedName),
  )
  if (existing !== null) return existing

  const held = await ignoredRepo.count(scope)
  if (held + 1 > MAX_IGNORED_NAMES) {
    throw new PayeeListBoundError('ignored payee names', MAX_IGNORED_NAMES)
  }

  return ignoredRepo.insert(scope, {
    id: newId(),
    normalizedName,
    createdAt: new Date(),
  })
}

/** Stops ignoring a string. */
export async function removeIgnoredName(
  scope: TenantScope,
  ignoredNameId: string,
): Promise<void> {
  await ignoredRepo.requireRemove(scope, idSchema.parse(ignoredNameId))
}

/* -------------------------------------------------------------------------- */
/* Presentation fallback                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Up to two initials for a name, so a payee always has a visual.
 *
 * Exported because the create path and the import path both need the same two letters, and two
 * implementations of "first letters of the first two words" is two payees drawn differently.
 */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/u)
    .filter((word) => word.length > 0)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return `${words[0][0]}${words[1][0]}`.toUpperCase()
}
