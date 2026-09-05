import { createFileRoute } from '@tanstack/react-router'
// Loads the Start module augmentation that adds `server` to route options.
import type {} from '@tanstack/react-start'

import { isAuthRequirementError, requireOrg } from '#/server/auth/guards'
import { requirePolarClient } from '#/server/billing/env'
import { assertRole } from '#/server/repos/scope'
import { getSubscription } from '#/server/repos/subscriptions'

/**
 * `POST /api/billing/portal` — a one-time link into the provider's own customer portal.
 *
 * Payment methods, invoices and receipts are the provider's job and stay there: re-implementing an
 * invoice list would mean holding card data adjacent to a ledger, which this product will not do.
 *
 * The customer id is read from **the workspace's own subscription row** through the tenant-scoped
 * repository, never from the request. That is what makes the route safe to expose: the worst a
 * crafted request can do is open the portal of the workspace the caller is already an admin of.
 */

function seeOther(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: { location, 'cache-control': 'no-store' },
  })
}

async function post(): Promise<Response> {
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

  assertRole(scope, 'open the billing portal', 'admin')

  const subscription = await getSubscription(scope)
  if (!subscription?.providerCustomerId) {
    // Nothing has ever been bought here, so there is no portal to open. The billing screen says so
    // rather than this route inventing a customer.
    return seeOther('/settings/billing?billing=no-customer')
  }

  const session = await requirePolarClient().createCustomerPortalSession(
    subscription.providerCustomerId,
  )
  return seeOther(session.customer_portal_url)
}

export const Route = createFileRoute('/api/billing/portal')({
  server: {
    handlers: {
      POST: post,
    },
  },
})
