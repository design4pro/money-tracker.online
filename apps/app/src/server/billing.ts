import { PolarClientError } from "@polar-sh/sdk"
import { createPolar, webhooks } from "@polar-sh/sdk/2026-10"
import type { Env, PolarEvent } from "./env"

const minute = 60_000
export const freshness = 20 * minute
const recheckInterval = 5 * minute
const pendingDuration = 24 * 60 * minute

interface Entitlement {
  status: "active" | "inactive"
  expires_at: number
  pending_until: number
  checked_at: number
}

export function access(row: Entitlement | null, now = Date.now()) {
  if (row?.status === "active") {
    if (row.expires_at <= now) return "expired"
    return row.checked_at > now - freshness ? "active" : "stale"
  }
  return row && row.pending_until > now ? "pending" : "inactive"
}

export function getEntitlement(db: D1Database, userId: string) {
  return db
    .prepare(
      "SELECT status, expires_at, pending_until, checked_at FROM entitlement WHERE user_id = ?"
    )
    .bind(userId)
    .first<Entitlement>()
}

function productIds(env: Env) {
  const monthly = env.POLAR_MONTHLY_PRODUCT_ID
  const yearly = env.POLAR_YEARLY_PRODUCT_ID
  if (!monthly || !yearly || monthly === yearly)
    throw new Error("Configure two Polar products")
  return { monthly, yearly }
}

function polar(env: Env) {
  if (
    !env.POLAR_ACCESS_TOKEN ||
    !["sandbox", "production"].includes(env.POLAR_ENVIRONMENT)
  ) {
    throw new Error("Polar is not configured")
  }
  return createPolar({
    accessToken: env.POLAR_ACCESS_TOKEN,
    environment: env.POLAR_ENVIRONMENT,
    timeout: 8,
  })
}

export function catalog(env: Env) {
  const client = polar(env)
  const ids = productIds(env)
  return Promise.all(
    (["monthly", "yearly"] as const).map(async (plan) => {
      const id = ids[plan]
      const product = await client.products.get(id)
      const prices = product.prices.filter((price) => !price.is_archived)
      const price = prices[0]
      if (
        product.id !== id ||
        product.is_archived ||
        !product.is_recurring ||
        product.recurring_interval !==
          (plan === "monthly" ? "month" : "year") ||
        product.recurring_interval_count !== 1 ||
        prices.length !== 1 ||
        price.amount_type !== "fixed" ||
        price.source !== "catalog" ||
        price.product_id !== id ||
        !Number.isSafeInteger(price.price_amount) ||
        price.price_amount <= 0
      ) {
        throw new Error("Invalid Polar catalog product")
      }
      return {
        plan,
        name: product.name,
        amount: price.price_amount,
        currency: price.price_currency,
      }
    })
  )
}

export async function checkout(
  env: Env,
  userId: string,
  plan: "monthly" | "yearly"
) {
  await catalog(env)
  const session = await polar(env).checkouts.create({
    products: [productIds(env)[plan]],
    external_customer_id: userId,
    success_url: new URL("/?checkout=return", env.APP_ORIGIN).href,
    return_url: env.APP_ORIGIN,
    allow_trial: false,
    allow_discount_codes: false,
  })
  const now = Date.now()
  await env.DB.prepare(
    `
    INSERT INTO entitlement(user_id, pending_until, recheck_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      pending_until = CASE WHEN status = 'active' AND expires_at > ? THEN 0
        ELSE max(pending_until, excluded.pending_until) END,
      recheck_at = min(recheck_at, excluded.recheck_at)
  `
  )
    .bind(userId, now + pendingDuration, now, now)
    .run()
  return session.url
}

export async function portal(env: Env, userId: string) {
  const session = await polar(env).customerSessions.create({
    external_customer_id: userId,
    return_url: env.APP_ORIGIN,
  })
  return session.customer_portal_url
}

interface Subscription {
  product_id: string
  status: string
  current_period_end: string
  ends_at: string | null
}

export function expiration(
  subscriptions: Subscription[],
  allowed: string[],
  now: number
) {
  let expires = 0
  for (const subscription of subscriptions) {
    if (
      !allowed.includes(subscription.product_id) ||
      subscription.status !== "active"
    )
      continue
    const periodEnd = Date.parse(subscription.current_period_end)
    const end =
      subscription.ends_at === null
        ? periodEnd
        : Math.min(periodEnd, Date.parse(subscription.ends_at))
    if (end > now) expires = Math.max(expires, end)
  }
  return expires
}

async function fetchExpiration(env: Env, userId: string, now: number) {
  const ids = Object.values(productIds(env))
  try {
    const state = await polar(env).customers.getStateExternal(userId)
    if (state.external_id !== userId)
      throw new Error("Polar customer identity mismatch")
    return expiration(state.active_subscriptions, ids, now)
  } catch (error) {
    if (error instanceof PolarClientError && error.statusCode === 404) return 0
    throw error
  }
}

export async function reconcile(
  env: Env,
  userId: string,
  eventId?: string,
  getExpiration: (userId: string, now: number) => Promise<number> = (id, now) =>
    fetchExpiration(env, id, now)
) {
  const db = env.DB
  if (
    eventId &&
    (await db
      .prepare("SELECT id FROM polar_event WHERE id = ?")
      .bind(eventId)
      .first())
  )
    return

  // Reserve the revision before reading Polar so a slower refresh cannot overwrite
  // a refresh that started later and has already committed.
  const revision = await db
    .prepare(
      `
    INSERT INTO entitlement(user_id, next_revision)
    SELECT id, 1 FROM user WHERE id = ?
    ON CONFLICT(user_id) DO UPDATE SET next_revision = next_revision + 1
    RETURNING next_revision
  `
    )
    .bind(userId)
    .first<number>("next_revision")
  if (revision === null) return

  const observedAt = Date.now()
  let expires: number
  try {
    expires = await getExpiration(userId, observedAt)
  } catch (error) {
    await db
      .prepare(
        `
      UPDATE entitlement SET recheck_at = ?
      WHERE user_id = ? AND next_revision = ? AND recheck_at <= ?
    `
      )
      .bind(observedAt + recheckInterval, userId, revision, observedAt)
      .run()
    throw error
  }

  const statements = [
    db
      .prepare(
        `
    UPDATE entitlement SET status = ?, expires_at = ?, checked_at = ?, recheck_at = ?,
      pending_until = CASE WHEN ? > 0 THEN 0 ELSE pending_until END, applied_revision = ?
    WHERE user_id = ? AND applied_revision < ?
      AND (? IS NULL OR NOT EXISTS (SELECT 1 FROM polar_event WHERE id = ?))
  `
      )
      .bind(
        expires > 0 ? "active" : "inactive",
        expires,
        observedAt,
        observedAt + recheckInterval,
        expires,
        revision,
        userId,
        revision,
        eventId ?? null,
        eventId ?? null
      ),
  ]
  if (eventId) {
    statements.push(
      db
        .prepare(
          `
      INSERT INTO polar_event(id, user_id, received_at) SELECT ?, id, ? FROM user WHERE id = ?
      ON CONFLICT(id) DO NOTHING
    `
        )
        .bind(eventId, observedAt, userId)
    )
  }
  await db.batch(statements)
}

export async function recheck(env: Env) {
  const now = Date.now()
  const due = await env.DB.prepare(
    `
    SELECT user_id FROM entitlement WHERE recheck_at <= ?
      AND (status = 'active' OR pending_until > ?)
    ORDER BY recheck_at LIMIT 40
  `
  )
    .bind(now, now)
    .all<{ user_id: string }>()
  for (let index = 0; index < due.results.length; index += 4) {
    const results = await Promise.allSettled(
      due.results
        .slice(index, index + 4)
        .map(({ user_id }) => reconcile(env, user_id))
    )
    if (results.some((result) => result.status === "rejected")) {
      console.error("A scheduled Polar refresh failed")
    }
  }
}

export async function receiveWebhook(
  request: Request,
  env: {
    POLAR_WEBHOOK_SECRET?: string
    POLAR_EVENTS: { send: (message: PolarEvent) => Promise<unknown> }
  }
) {
  if (!env.POLAR_WEBHOOK_SECRET) return new Response(null, { status: 503 })
  const eventId = request.headers.get("webhook-id")
  if (!eventId || eventId.length > 200)
    return new Response(null, { status: 400 })

  let payload: Awaited<ReturnType<typeof webhooks.validateEvent>>
  try {
    payload = await webhooks.validateEvent(
      await request.text(),
      Object.fromEntries(request.headers),
      env.POLAR_WEBHOOK_SECRET
    )
  } catch {
    return new Response(null, { status: 400 })
  }
  if (payload.type === "customer.state_changed") {
    const data: unknown = payload.data
    if (
      typeof data === "object" &&
      data !== null &&
      "external_id" in data &&
      typeof data.external_id === "string" &&
      data.external_id
    ) {
      await env.POLAR_EVENTS.send({ eventId, userId: data.external_id })
    }
  }
  return new Response(null, { status: 204 })
}
