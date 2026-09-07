import { RouteError } from './route-error'

import type { ErrorComponentProps } from '@tanstack/react-router'

/**
 * The router's `defaultErrorComponent`, as a module of its own so `src/router.tsx` can load it
 * on demand.
 *
 * {@link RouteError} is built on the design system's `Button`, and the router module is in the
 * entry chunk every visitor downloads. Imported statically there, the button primitive - and
 * React Aria with it - would ship to the marketing page, which renders no primitive at all. The
 * router's own code splitting already loads every route-level `errorComponent` this way, so a
 * failure that reaches this floor pays the same one extra fetch those do.
 */
export function DefaultRouteError({ reset }: ErrorComponentProps) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-16">
      <RouteError onRetry={reset} />
    </div>
  )
}
