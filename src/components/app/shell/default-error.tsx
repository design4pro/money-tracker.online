import { useMatches } from '@tanstack/react-router'

import { MAIN_CONTENT_ID } from './main-content'
import { RouteError } from './route-error'

import type { ErrorComponentProps } from '@tanstack/react-router'
import type { FileRouteTypes } from '#/routeTree.gen'

/** The signed-in layout, which renders the shell and its `<main>`. */
const SHELL_ROUTE_ID = '/_app' satisfies FileRouteTypes['id']
/** The signed-out group, whose frame renders its own `<main>`. */
const SIGNED_OUT_ROUTE_ID = '/(auth)' satisfies FileRouteTypes['id']

/**
 * The router's `defaultErrorComponent`, as a module of its own so `src/router.tsx` can load it
 * on demand.
 *
 * {@link RouteError} is built on the design system's `Button`, and the router module is in the
 * entry chunk every visitor downloads. Imported statically there, the button primitive - and
 * React Aria with it - would ship to the marketing page, which renders no primitive at all. The
 * router's own code splitting already loads every route-level `errorComponent` this way, so a
 * failure that reaches this floor pays the same one extra fetch those do.
 *
 * ## It places itself
 *
 * TanStack Router gives every match its own boundary, `route.errorComponent ??
 * defaultErrorComponent`, so a child of the signed-in layout that throws is rendered here, inside
 * that layout's content area, and not by the layout's own `CatchBoundary`. What surrounds the
 * error therefore differs by where the route sits, and this component reads that from the ids of
 * the matched routes:
 *
 * | Under              | `<main>`                              | Way back to the dashboard |
 * | ------------------ | ------------------------------------- | ------------------------- |
 * | the signed-in shell | none, the shell has one              | yes                       |
 * | the signed-out group | none, its frame has one            | no                        |
 * | anywhere else      | its own, with the main-content id     | no                        |
 *
 * So exactly one `<main>` and one main-content id exist on every page it renders. The link is
 * offered only under the shell, where the reader is known to be signed in: a signed-out reader
 * sent to the dashboard is bounced through sign-in.
 *
 * It does not set the document title; see {@link RouteError}.
 */
export function DefaultRouteError({ reset }: ErrorComponentProps) {
  const routeIds = useMatches({
    select: (matches) => matches.map((match) => match.routeId),
  })
  const underShell = routeIds.includes(SHELL_ROUTE_ID)
  const underSignedOut = routeIds.includes(SIGNED_OUT_ROUTE_ID)

  const error = (
    <div className="mx-auto w-full max-w-3xl px-4 py-16">
      <RouteError
        onRetry={reset}
        homeHref={underShell ? '/dashboard' : undefined}
      />
    </div>
  )

  if (underShell || underSignedOut) return error

  return (
    <main id={MAIN_CONTENT_ID} tabIndex={-1} className="outline-none">
      {error}
    </main>
  )
}
