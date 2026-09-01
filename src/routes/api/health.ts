import { createFileRoute } from '@tanstack/react-router'
// Loads the Start module augmentation that adds `server` to route options.
import type {} from '@tanstack/react-start'
import { env } from 'cloudflare:workers'

/**
 * `GET /api/health` — the one endpoint a deploy is allowed to depend on.
 *
 * Both deploy workflows call it after `wrangler deploy` and assert an exact status code, so it
 * has to answer without a database, without a session and without a binding that a
 * half-provisioned environment might not have. It reads three values out of `env` and returns
 * them; there is deliberately no D1 ping, because a health check that fails when the database is
 * slow turns a degraded deploy into a rolled-back one.
 *
 * What it *does* prove is the thing a smoke check is actually for: the Worker booted, the entry
 * module's exports resolved (a missing Durable Object class fails isolate startup, so an answer
 * here means both classes were found), the router matched a route, and the environment the build
 * baked in is the one you meant to deploy.
 *
 * `version` is the deployed version id from the `CF_VERSION_METADATA` binding — the same value
 * reported as the Sentry release, so a smoke check and a stack trace name one deploy.
 *
 * `cache-control: no-store` because every field can change between two requests to the same URL.
 */
interface HealthReport {
  readonly status: 'ok'
  readonly version: string
  readonly environment: string
}

function report(): Response {
  // Read straight off `env` with no fallback, because `worker-configuration.d.ts` declares both
  // as required and `wrangler.jsonc` binds both on every environment including the local one.
  // A `?? 'unknown'` here would be a second opinion about that contract, and the value it would
  // hide — a version metadata binding that went missing — is precisely what this endpoint exists
  // to surface.
  const body: HealthReport = {
    status: 'ok',
    version: env.CF_VERSION_METADATA.id,
    environment: env.ENVIRONMENT,
  }

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/** A monitor that sends HEAD gets the same status and headers with no body, as it should. */
function head(): Response {
  const response = report()
  return new Response(null, {
    status: response.status,
    headers: response.headers,
  })
}

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: report,
      HEAD: head,
    },
  },
})
