import { createFileRoute } from '@tanstack/react-router'
// Loads the Start module augmentation that adds `server` to route options.
import type {} from '@tanstack/react-start'

import { isBillingInterval, isPlanId, requirePrice } from '#/lib/plans'
import { appUrl } from '#/server/auth/env'
import { isAuthRequirementError, requireOrg } from '#/server/auth/guards'
import { requirePolarClient } from '#/server/billing/env'
import { assertRole } from '#/server/repos/scope'

/**
 * `POST /api/billing/checkout` — opens a hosted checkout, and writes nothing about entitlement.
 *
 * Money leaves this product's hands at exactly one place, and this is the door to it. What the
 * route does is small on purpose:
 *
 * - **`requireOrg()` then `assertRole('admin')`.** Only an owner or a workspace admin may spend a
 *   household's money. A member gets a `403` here *and* never sees the button — the screen derives
 *   its actions from the same role, so the two cannot disagree.
 * - **The workspace comes from the session, never from the request.** `metadata.workspaceId` is
 *   `scope.ctx.organizationId`, which the guard re-read from the `member` table. A `workspaceId`
 *   in the body would be a request that says which household to bill, which is a sentence nobody
 *   should be able to write.
 * - **It grants nothing.** The subscription becomes real when the signed webhook arrives and the
 *   queue applies it. This route's only output is a redirect.
 *
 * The plan and interval arrive as form fields and are validated against the catalogue rather than
 * trusted: a product id is looked up from `#/lib/plans`, so a request naming an arbitrary product
 * cannot open a checkout for it.
 */

function seeOther(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: { location, 'cache-control': 'no-store' },
  })
}

async function post({ request }: { request: Request }): Promise<Response> {
  let scope
  try {
    scope = await requireOrg()
  } catch (error) {
    if (isAuthRequirementError(error)) {
      return new Response(null, {
        status: 401,
        headers: { 'cache-control': 'no-store' },
      })
    }
    throw error
  }

  assertRole(scope, 'start a checkout', 'admin')

  const form = await request.formData()
  const planId = form.get('planId')
  const interval = form.get('interval')
  if (!isPlanId(planId) || !isBillingInterval(interval)) {
    return seeOther('/settings/billing?billing=unknown-plan')
  }

  // Throws `MissingProductError` when the build carries no id for this line, and
  // `BillingConfigError` when the deployment has no Polar credentials at all. Both are
  // configuration faults rather than user errors, so they surface as an error boundary rather
  // than as a redirect that would look like a declined card.
  const price = requirePrice(planId, interval)
  const checkout = await requirePolarClient().createCheckout({
    productId: price.productId,
    // `{CHECKOUT_ID}` is substituted by the provider, so the return route can name the checkout
    // it is confirming without this request having to invent an id of its own.
    successUrl: `${appUrl()}/api/billing/return?checkout_id={CHECKOUT_ID}`,
    externalCustomerId: scope.ctx.organizationId,
    metadata: {
      workspaceId: scope.ctx.organizationId,
      userId: scope.ctx.userId,
      planId,
      interval,
    },
  })

  return seeOther(checkout.url)
}

export const Route = createFileRoute('/api/billing/checkout')({
  server: {
    handlers: {
      POST: post,
    },
  },
})
