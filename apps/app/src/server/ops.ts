import { json } from "./api"
import type { Env } from "./env"

export async function operations(request: Request, env: Env, path: string) {
  const authorization = request.headers.get("Authorization")
  if (!env.POLAR_SIGNAL_TOKEN || !authorization) {
    return new Response(null, { status: 401 })
  }
  const encode = (value: string) => new TextEncoder().encode(value)
  const key = await crypto.subtle.importKey(
    "raw",
    encode(env.POLAR_SIGNAL_TOKEN),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  )
  const expected = await crypto.subtle.sign(
    "HMAC",
    key,
    encode(`Bearer ${env.POLAR_SIGNAL_TOKEN}`)
  )
  if (
    !(await crypto.subtle.verify("HMAC", key, expected, encode(authorization)))
  ) {
    return new Response(null, { status: 401 })
  }
  if (request.method !== "GET") {
    return new Response(null, { status: 405, headers: { Allow: "GET" } })
  }
  try {
    if (path === "/ops/polar-lag") {
      const now = Date.now()
      const oldest = await env.DB.prepare(
        `SELECT min(COALESCE(refresh_failed_since, recheck_at)) AS oldest FROM entitlement
         WHERE (refresh_failed_since IS NOT NULL OR (recheck_at > 0 AND recheck_at <= ?))
           AND (status = 'active' OR pending_until > ?)`
      )
        .bind(now, now)
        .first<number | null>("oldest")
      return json({
        lagSeconds: oldest === null ? 0 : Math.floor((now - oldest) / 1000),
      })
    }
    return json(
      await env.DB.prepare(
        `SELECT count(*) AS signUps,
              count(first_paid_at) AS firstPaid,
              count(CASE WHEN first_transaction_at >= first_paid_at THEN 1 END) AS firstTransaction
       FROM user`
      ).first()
    )
  } catch {
    return new Response(null, { status: 503 })
  }
}
