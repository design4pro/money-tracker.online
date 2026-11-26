import { createAuth, verifiedUser } from "./auth"
import {
  access,
  catalog,
  checkout,
  getEntitlement,
  portal,
  refreshStaleEntitlement,
} from "./billing"
import { readLedger, RequestError, writeLedger } from "./ledger"
import type { Env } from "./env"

export function json(body: unknown, status = 200, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers)
  responseHeaders.set("Cache-Control", "no-store")
  return Response.json(body, { status, headers: responseHeaders })
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    throw new RequestError("Expected JSON.", 415)
  }
  const value: unknown = await request.json().catch(() => null)
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestError("Invalid request.")
  }
  return value as Record<string, unknown>
}

export async function pilotApi(
  request: Request,
  env: Env,
  auth: ReturnType<typeof createAuth> = createAuth(env)
) {
  const { pathname } = new URL(request.url)
  const method = request.method
  const db = env.DB
  try {
    if (
      method === "POST" &&
      request.headers.get("origin") !== new URL(env.APP_ORIGIN).origin
    ) {
      throw new RequestError("Invalid request origin.", 403)
    }
    const user = await verifiedUser(auth, request.headers)
    if (!user)
      throw new RequestError("Sign in with a verified email to continue.", 401)

    if (pathname === "/api/pilot/export" && method === "GET") {
      return json(
        {
          version: 1,
          exportedAt: new Date().toISOString(),
          ...(await readLedger(db, user.id)),
        },
        200,
        { "Content-Disposition": 'attachment; filename="money-tracker.json"' }
      )
    }

    if (pathname === "/api/pilot/portal" && method === "POST") {
      return json({ url: await portal(env, user.id) })
    }

    let entitlement = await getEntitlement(db, user.id)
    if (
      (pathname === "/api/pilot/status" && method === "GET") ||
      (pathname === "/api/pilot/ledger" &&
        (method === "GET" || method === "POST"))
    ) {
      entitlement = await refreshStaleEntitlement(env, user.id, entitlement)
    }
    const status = access(entitlement)

    if (pathname === "/api/pilot/status" && method === "GET") {
      return json({ status, expiresAt: entitlement?.expires_at || null })
    }

    if (pathname === "/api/pilot/catalog" && method === "GET") {
      return json({ plans: await catalog(env) })
    }

    if (pathname === "/api/pilot/checkout" && method === "POST") {
      const { plan } = await readBody(request)
      if (plan !== "monthly" && plan !== "yearly")
        throw new RequestError("Choose a billing period.")
      if (status === "active" || status === "stale") {
        throw new RequestError(
          "Manage your existing subscription in the billing portal.",
          409
        )
      }
      return json({ url: await checkout(env, user.id, plan) })
    }

    if (
      pathname === "/api/pilot/ledger" &&
      (method === "GET" || method === "POST")
    ) {
      if (status !== "active")
        throw new RequestError("An active subscription is required.", 403)
      if (method === "POST") {
        await writeLedger(db, user.id, await readBody(request))
        return json({ ok: true })
      }
      return json(await readLedger(db, user.id))
    }
    return json({ message: "Endpoint not found." }, 404)
  } catch (error) {
    if (error instanceof RequestError)
      return json({ message: error.message }, error.status)
    console.error("Pilot API request failed", pathname)
    return json(
      {
        message: "This service is temporarily unavailable. Try again shortly.",
      },
      503
    )
  }
}
