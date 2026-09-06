import { createFileRoute } from '@tanstack/react-router'
// Loads the Start module augmentation that adds `server` to route options.
import type {} from '@tanstack/react-start'

/**
 * `GET /api/billing/return` — a redirect, and **nothing else**.
 *
 * This is the single most important sentence in the billing area: *the return URL must never grant
 * entitlement*. It is reached by a browser following a link the provider handed it, which makes
 * every byte of it attacker-controllable — a person who types this URL with somebody else's
 * checkout id must gain exactly what they gain by typing it with a made-up one, which is nothing.
 *
 * So there is no database write here, no client call, and no read of the checkout at all. The
 * subscription becomes real when the signed webhook lands (`/api/webhooks/polar`) and the queue
 * applies it. Until then `/settings/billing` renders its **confirming** state, which polls and says
 * so honestly rather than pretending the payment has taken effect.
 *
 * The checkout id is carried through only so the screen can tell "you have just come back from a
 * checkout" from "you opened this page": it is displayed nowhere and read by nothing else.
 */

function get({ request }: { request: Request }): Response {
  const checkoutId = new URL(request.url).searchParams.get('checkout_id')
  const target =
    checkoutId === null
      ? '/settings/billing'
      : `/settings/billing?billing=confirming`

  return new Response(null, {
    status: 303,
    headers: { location: target, 'cache-control': 'no-store' },
  })
}

export const Route = createFileRoute('/api/billing/return')({
  server: {
    handlers: {
      GET: get,
    },
  },
})
