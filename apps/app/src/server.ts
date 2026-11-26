import handler from "@tanstack/react-start/server-entry"
import { pilotApi, json } from "./server/api"
import { receiveWebhook, reconcile, recheck } from "./server/billing"
import type { Env, PolarEvent } from "./server/env"

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)
    if (pathname === "/health" && request.method === "GET") {
      const sourceSha = env.SOURCE_SHA || null
      try {
        const tables = await env.DB.prepare(
          `
          SELECT count(*) AS total FROM sqlite_schema
          WHERE name IN ('user', 'session', 'account', 'verification', 'rateLimit',
            'ledger_account', 'ledger_category', 'ledger_transaction', 'entitlement', 'polar_event')
        `
        ).first<number>("total")
        const ok = tables === 10
        return json({ ok, sourceSha }, ok ? 200 : 503)
      } catch {
        return json({ ok: false, sourceSha }, 503)
      }
    }
    if (pathname === "/api/webhooks/polar") {
      if (request.method !== "POST")
        return new Response(null, { status: 405, headers: { Allow: "POST" } })
      try {
        return await receiveWebhook(request, env)
      } catch {
        return new Response(null, { status: 503 })
      }
    }
    if (pathname.startsWith("/api/pilot/")) return pilotApi(request, env)
    const response = await handler.fetch(request)
    if (!pathname.startsWith("/api/auth/")) return response
    const uncached = new Response(response.body, response)
    uncached.headers.set("Cache-Control", "no-store")
    uncached.headers.set("Referrer-Policy", "no-referrer")
    return uncached
  },
  async queue(batch, env) {
    for (const message of batch.messages) {
      try {
        await reconcile(env, message.body.userId, message.body.eventId)
        message.ack()
      } catch {
        console.error("Polar state could not be reconciled")
        message.retry()
      }
    }
  },
  async scheduled(_event, env) {
    await recheck(env)
  },
} satisfies ExportedHandler<Env, PolarEvent>
