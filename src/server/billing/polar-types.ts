/**
 * The provider's wire shapes, parsed rather than trusted.
 *
 * Everything this product learns from Polar arrives as JSON over the network — a REST response or
 * a webhook body — and both are outside our control. Parsing them through Zod here means an
 * upstream shape change surfaces as a typed error naming the failing path, at the boundary, instead
 * of as an `undefined` read three files later inside a state write.
 *
 * Two rules govern the money fields, and both come from `docs/MONEY.md` by way of
 * `docs/plans/22-billing.md`:
 *
 * - **Amounts are integers or they are errors.** `z.number().int()` rejects a fractional value
 *   rather than rounding it. A price that arrived as a float is a provider contract we do not
 *   understand, and guessing at it is how a customer is charged one thing and shown another.
 * - **The currency is the provider's and stays the provider's.** It is stored verbatim and never
 *   coerced into the workspace's base currency. A subscription billed in USD is a USD fact; a
 *   converted figure is a number nobody was ever charged.
 *
 * These amounts deliberately do **not** carry the `Minor` brand from `#/lib/money/types`. That
 * brand marks ledger money, and a subscription price must never be addable to a transaction.
 *
 * Unknown keys are dropped rather than refused: Polar adds fields, and a strict parse would turn
 * every additive upstream release into an outage.
 */

import { z } from 'zod'

/** Polar's own subscription lifecycle vocabulary. Mapped onto ours in `./mapping`. */
export const polarSubscriptionStatusSchema = z.enum([
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
])
export type PolarSubscriptionStatus = z.infer<
  typeof polarSubscriptionStatusSchema
>

/** How often the provider bills. Ours says `monthly | yearly`; theirs says `month | year`. */
export const polarRecurringIntervalSchema = z.enum(['month', 'year'])

/** An ISO instant, as a `Date`. Null and absent are the same thing to every caller. */
const instant = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value))
const optionalInstant = instant.nullish().transform((value) => value ?? null)

/** An integer minor amount in the provider's currency. Never a float, never rounded. */
const minorAmount = z.number().int()

export const polarSubscriptionSchema = z.object({
  id: z.string().min(1),
  status: polarSubscriptionStatusSchema,
  product_id: z.string().min(1),
  customer_id: z.string().min(1),
  amount: minorAmount.nullish().transform((value) => value ?? null),
  currency: z
    .string()
    .min(3)
    .max(8)
    .nullish()
    .transform((value) => value ?? null),
  recurring_interval: polarRecurringIntervalSchema
    .nullish()
    .transform((value) => value ?? null),
  current_period_start: optionalInstant,
  current_period_end: optionalInstant,
  cancel_at_period_end: z.boolean().default(false),
  canceled_at: optionalInstant,
  started_at: optionalInstant,
  ends_at: optionalInstant,
  /**
   * Polar's own last-modified stamp. The **ordering key**: webhooks arrive out of order, and a
   * delayed `created` applied after a `canceled` is how somebody keeps a plan they cancelled.
   */
  modified_at: optionalInstant,
  created_at: instant,
  metadata: z.record(z.string(), z.unknown()).default({}),
})
export type PolarSubscription = z.infer<typeof polarSubscriptionSchema>

export const polarCheckoutSchema = z.object({
  id: z.string().min(1),
  /** The hosted page. The only place money changes hands. */
  url: z.url(),
  status: z.string().min(1),
  customer_id: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  product_id: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  subscription_id: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  metadata: z.record(z.string(), z.unknown()).default({}),
})
export type PolarCheckout = z.infer<typeof polarCheckoutSchema>

export const polarCustomerSessionSchema = z.object({
  token: z.string().min(1),
  customer_portal_url: z.url(),
})
export type PolarCustomerSession = z.infer<typeof polarCustomerSessionSchema>

export const polarProductSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  is_recurring: z.boolean().default(false),
  is_archived: z.boolean().default(false),
})
export const polarProductListSchema = z.object({
  items: z.array(polarProductSchema),
})
export type PolarProduct = z.infer<typeof polarProductSchema>

/**
 * The webhook envelope: a type and a payload, and nothing else this product reads.
 *
 * The delivery id is **not** in the body — Standard Webhooks carries it in the `webhook-id`
 * header, and that header is what `billing_events.id` stores. See `./webhook-verify`.
 */
export const polarWebhookEnvelopeSchema = z.object({
  type: z.string().min(1),
  data: z.unknown(),
})
export type PolarWebhookEnvelope = z.infer<typeof polarWebhookEnvelopeSchema>

/** The order events carry, for the "recent activity" list on the billing screen. */
export const polarOrderSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  total_amount: minorAmount.nullish().transform((value) => value ?? null),
  currency: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  customer_id: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  subscription_id: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  created_at: instant,
  metadata: z.record(z.string(), z.unknown()).default({}),
})
export type PolarOrder = z.infer<typeof polarOrderSchema>
