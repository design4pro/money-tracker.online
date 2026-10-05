/**
 * The plan catalogue — what each tier sells, and the only place a number appears.
 *
 * **Isomorphic and binding-free.** The pricing page, the billing screen, the quota resolver and
 * the console all read this file, and they cannot share a runtime: it imports nothing from
 * `#/server`, touches no Worker binding and does no I/O. `docs/SPEC.md` §5.4 names it as the
 * catalogue half of the billing surface; `#/server/billing/resolve-limits` is the other half and
 * it is the only module allowed to decide *which* plan a workspace is on.
 *
 * Three rules hold this file together:
 *
 * 1. **The published number is the enforced number.** Every ceiling below is read by
 *    `resolveLimits()` and enforced by `assertWithinLimit()` inside a repository. A marketing
 *    string stating a different figure is a bug in the copy, not a second source of truth —
 *    which is why the screens render {@link planLimits} rather than restating it.
 * 2. **Every metric the product meters appears in every plan.** {@link PlanLimits} is a total
 *    record over {@link QUOTA_METRICS}, so a new metered resource does not compile until each
 *    tier has said what it sells. A missing entry would otherwise resolve to "no ceiling" for
 *    free accounts, which is the failure that is discovered on the invoice.
 * 3. **Copy lives in the catalogue, not here.** Plan names and feature sentences are
 *    {@link MessageKey}s: this module holds numbers and identifiers, the EN + PL message
 *    catalogue holds the words (`docs/SPEC.md` §9).
 *
 * ## Prices, and why they are integers with no `Minor` brand
 *
 * A price is **the provider's money, not the ledger's**. It is stored and displayed in the
 * currency Polar bills in, with that currency's own digits, and it is never converted into a
 * workspace's base currency — a converted subscription price is a number nobody was charged
 * (`docs/MONEY.md`). It is an integer minor amount for the same reason every other amount in
 * this product is, but it deliberately does **not** carry the `Minor` brand from
 * `#/lib/money/types`: that brand marks amounts that flow through the ledger's arithmetic, and a
 * plan price must never be addable to a transaction.
 *
 * ## Product ids come from the build, not from this file
 *
 * `VITE_POLAR_PRODUCT_*` are public by construction (a product id ships in every checkout link)
 * and differ between the sandbox and production Polar accounts, so they are build-time values
 * from `.env.local.example` rather than checked-in constants. An unset id is `null` here and
 * {@link requirePrice} throws for that one plan and interval; the pricing page still renders.
 */

import type { MessageKey } from '#/lib/i18n'

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The tiers, cheapest first.
 *
 * Mirrored by `PLAN_IDS` in `#/lib/enums` (re-exported by `#/server/db/schema`) — the column
 * needs the tuple for its `CHECK` constraint and the enum module imports nothing.
 * `src/server/billing/__tests__/resolve-limits.test.ts` asserts the two lists are identical, so the
 * mirror cannot drift.
 */
export const PLAN_IDS = ['free', 'plus', 'household'] as const
export type PlanId = (typeof PLAN_IDS)[number]

/** How often a paid plan bills. */
export const BILLING_INTERVALS = ['monthly', 'yearly'] as const
export type BillingInterval = (typeof BILLING_INTERVALS)[number]

/**
 * Every metered resource in the product, and the closed vocabulary `assertWithinLimit` accepts.
 *
 * Each name is the string a repository already passes at its call site; the call sites are the
 * authority for what a metric *counts*, and they are named in {@link QUOTA_METRIC_OWNERS} so a
 * reader can get from a ceiling to the `INSERT` it guards without grepping.
 */
export const QUOTA_METRICS = [
  'members',
  'accounts',
  'currencies',
  'budgets',
  'goals',
  'rules',
  'recurringSeries',
  'transactions',
  'importsPerMonth',
  'storageBytes',
] as const
export type QuotaMetric = (typeof QUOTA_METRICS)[number]

/**
 * Where each ceiling is enforced. Documentation with a type behind it: the record is total over
 * {@link QUOTA_METRICS}, so a metric added without an enforcement point is a compile error rather
 * than a limit nobody applies.
 */
export const QUOTA_METRIC_OWNERS: Readonly<Record<QuotaMetric, string>> = {
  members: 'src/server/repos/members.ts — invite and accept',
  accounts: 'src/server/repos/accounts.ts — createAccount',
  currencies: 'src/server/repos/workspace-currencies.ts — addCurrency',
  budgets: 'src/server/repos/budgets.ts — createBudget',
  goals: 'src/server/repos/goals.ts — createGoal',
  rules: 'src/server/repos/rules.ts — createRule',
  recurringSeries: 'src/server/repos/recurring.ts — createSeries',
  transactions: 'src/server/fns/import-mapping.ts — commitImport',
  importsPerMonth: 'src/server/repos/imports.ts — createBatch',
  storageBytes: 'src/server/repos/attachments.ts — uploadAttachment',
}

/** No ceiling. The value `resolveLimits()` returns for an uncapped metric. */
export const UNLIMITED = Number.POSITIVE_INFINITY

export function isPlanId(value: unknown): value is PlanId {
  return (
    typeof value === 'string' &&
    (PLAN_IDS as ReadonlyArray<string>).includes(value)
  )
}

export function isBillingInterval(value: unknown): value is BillingInterval {
  return (
    typeof value === 'string' &&
    (BILLING_INTERVALS as ReadonlyArray<string>).includes(value)
  )
}

export function isQuotaMetric(value: unknown): value is QuotaMetric {
  return (
    typeof value === 'string' &&
    (QUOTA_METRICS as ReadonlyArray<string>).includes(value)
  )
}

/* -------------------------------------------------------------------------- */
/* Shapes                                                                      */
/* -------------------------------------------------------------------------- */

/** Every metric, every plan. Total by construction — see rule 2 in the file docblock. */
export type PlanLimits = Readonly<Record<QuotaMetric, number>>

/**
 * One purchasable line: the provider's price and the product it belongs to.
 *
 * `amountMinor` is in `currency`'s own minor units and is **display data** — the charge is made
 * by Polar against the product, never computed here. `productId` is `null` when the build did not
 * carry an id for this line.
 */
export interface PlanPrice {
  readonly amountMinor: number
  readonly currency: string
  readonly productId: string | null
}

export interface PlanDefinition {
  readonly id: PlanId
  /** `true` for the one tier that is never charged for. */
  readonly free: boolean
  readonly nameKey: MessageKey
  readonly taglineKey: MessageKey
  /** The sentences the pricing and billing screens list under the tier, in order. */
  readonly featureKeys: ReadonlyArray<MessageKey>
  readonly limits: PlanLimits
  /** `null` on the free tier: there is nothing to buy, so there is no price to state. */
  readonly prices: Readonly<Record<BillingInterval, PlanPrice>> | null
}

/* -------------------------------------------------------------------------- */
/* The catalogue                                                               */
/* -------------------------------------------------------------------------- */

const MEGABYTE = 1024 * 1024

/**
 * Build-time product ids, read once.
 *
 * `import.meta.env` is inlined by Vite, so this is a constant in the bundle rather than a lookup.
 * An empty string is normalised to `null` here so every consumer has one absent-value shape.
 */
function productId(value: string | undefined): string | null {
  return value === undefined || value === '' ? null : value
}

/** The billing currency. One currency for every plan: two would need an FX opinion about price. */
const BILLING_CURRENCY = 'EUR'

export const PLANS: Readonly<Record<PlanId, PlanDefinition>> = {
  /**
   * Free is a **complete product**, not a trial: one person, a household's worth of everyday
   * accounts, and export-everything at any time (`PRODUCT.md`). What it does not carry is the
   * scale a second person and a multi-currency household need.
   */
  free: {
    id: 'free',
    free: true,
    nameKey: 'plans.free.name',
    taglineKey: 'plans.free.tagline',
    featureKeys: [
      'plans.feature.free.people',
      'plans.feature.free.accounts',
      'plans.feature.free.currency',
      'plans.feature.free.planning',
      'plans.feature.export',
    ],
    limits: {
      members: 1,
      accounts: 3,
      currencies: 1,
      budgets: 2,
      goals: 2,
      rules: 3,
      recurringSeries: 2,
      transactions: 5_000,
      importsPerMonth: 2,
      storageBytes: 25 * MEGABYTE,
    },
    prices: null,
  },

  /** One person, no ceilings on the things one person accumulates, and more than one currency. */
  plus: {
    id: 'plus',
    free: false,
    nameKey: 'plans.plus.name',
    taglineKey: 'plans.plus.tagline',
    featureKeys: [
      'plans.feature.plus.people',
      'plans.feature.plus.unlimited',
      'plans.feature.plus.currencies',
      'plans.feature.plus.rules',
      'plans.feature.plus.storage',
    ],
    limits: {
      members: 1,
      accounts: UNLIMITED,
      currencies: UNLIMITED,
      budgets: UNLIMITED,
      goals: UNLIMITED,
      rules: 20,
      recurringSeries: UNLIMITED,
      transactions: UNLIMITED,
      importsPerMonth: 20,
      storageBytes: 1024 * MEGABYTE,
    },
    prices: {
      monthly: {
        amountMinor: 399,
        currency: BILLING_CURRENCY,
        productId: productId(import.meta.env.VITE_POLAR_PRODUCT_PLUS_MONTHLY),
      },
      yearly: {
        amountMinor: 3900,
        currency: BILLING_CURRENCY,
        productId: productId(import.meta.env.VITE_POLAR_PRODUCT_PLUS_YEARLY),
      },
    },
  },

  /** The whole household: six people sharing one workspace, and no ceilings at all. */
  household: {
    id: 'household',
    free: false,
    nameKey: 'plans.household.name',
    taglineKey: 'plans.household.tagline',
    featureKeys: [
      'plans.feature.household.people',
      'plans.feature.household.unlimited',
      'plans.feature.household.roles',
      'plans.feature.household.storage',
      'plans.feature.export',
    ],
    limits: {
      members: 6,
      accounts: UNLIMITED,
      currencies: UNLIMITED,
      budgets: UNLIMITED,
      goals: UNLIMITED,
      rules: UNLIMITED,
      recurringSeries: UNLIMITED,
      transactions: UNLIMITED,
      importsPerMonth: UNLIMITED,
      storageBytes: 5 * 1024 * MEGABYTE,
    },
    prices: {
      monthly: {
        amountMinor: 699,
        currency: BILLING_CURRENCY,
        productId: productId(
          import.meta.env.VITE_POLAR_PRODUCT_HOUSEHOLD_MONTHLY,
        ),
      },
      yearly: {
        amountMinor: 6900,
        currency: BILLING_CURRENCY,
        productId: productId(
          import.meta.env.VITE_POLAR_PRODUCT_HOUSEHOLD_YEARLY,
        ),
      },
    },
  },
}

/** The tiers in display order, cheapest first. */
export const PLAN_LIST: ReadonlyArray<PlanDefinition> = PLAN_IDS.map(
  (id) => PLANS[id],
)

/** The plan a workspace with no entitling subscription is on. Never `null`, never "unknown". */
export const DEFAULT_PLAN_ID: PlanId = 'free'

export function planLimits(planId: PlanId): PlanLimits {
  return PLANS[planId].limits
}

/** The price line for one tier and interval, or `null` on the free tier. */
export function priceFor(
  planId: PlanId,
  interval: BillingInterval,
): PlanPrice | null {
  return PLANS[planId].prices?.[interval] ?? null
}

/** Raised when a checkout is asked for a line the build carries no product id for. */
export class MissingProductError extends Error {
  readonly planId: PlanId
  readonly interval: BillingInterval

  constructor(planId: PlanId, interval: BillingInterval) {
    super(
      `No Polar product id is configured for ${planId}/${interval}. Set VITE_POLAR_PRODUCT_${planId.toUpperCase()}_${interval.toUpperCase()} and rebuild.`,
    )
    this.name = 'MissingProductError'
    this.planId = planId
    this.interval = interval
  }
}

/**
 * The product id to open a checkout against, or a throw naming what is unset.
 *
 * Deliberately loud. A checkout opened against `undefined` is a Polar 404 three hops later, and
 * the missing build variable is not in that stack trace.
 */
export function requirePrice(
  planId: PlanId,
  interval: BillingInterval,
): PlanPrice & { readonly productId: string } {
  const price = priceFor(planId, interval)
  if (!price || price.productId === null) {
    throw new MissingProductError(planId, interval)
  }
  return { ...price, productId: price.productId }
}

/** The tier a Polar product id belongs to, or `null` when the id is not one of ours. */
export function planForProductId(
  value: string | null | undefined,
): { readonly planId: PlanId; readonly interval: BillingInterval } | null {
  if (!value) return null
  for (const planId of PLAN_IDS) {
    for (const interval of BILLING_INTERVALS) {
      if (PLANS[planId].prices?.[interval].productId === value) {
        return { planId, interval }
      }
    }
  }
  return null
}

/**
 * How many yearly billing saves against twelve monthly charges, in percent, rounded down.
 *
 * Integer arithmetic on integer minor amounts: no float touches a price. `null` when either line
 * is absent, so the screens omit the badge rather than printing "0%".
 */
export function yearlySavingPercent(planId: PlanId): number | null {
  const monthly = priceFor(planId, 'monthly')
  const yearly = priceFor(planId, 'yearly')
  if (!monthly || !yearly || monthly.amountMinor === 0) return null
  const full = monthly.amountMinor * 12
  if (yearly.amountMinor >= full) return null
  return Math.floor(((full - yearly.amountMinor) * 100) / full)
}
