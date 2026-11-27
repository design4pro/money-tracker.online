import handler from "@tanstack/react-start/server-entry"
import { createAuth, verifiedUser } from "./server/auth"
import { pilotApi } from "./server/api"
import { receiveWebhook, reconcile, recheck } from "./server/billing"
import { health } from "./server/health"
import { operations } from "./server/ops"
import type { Env, PolarEvent } from "./server/env"

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)
    if (pathname === "/ops/polar-lag" || pathname === "/ops/pilot-milestones") {
      return operations(request, env, pathname)
    }
    if (pathname === "/health" && request.method === "GET") return health(env)
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
    if (pathname === "/billing" && ["GET", "HEAD"].includes(request.method)) {
      if (!(await verifiedUser(createAuth(env), request.headers))) {
        return new Response(null, {
          status: 302,
          headers: { Location: "/login", "Cache-Control": "no-store" },
        })
      }
    }
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
