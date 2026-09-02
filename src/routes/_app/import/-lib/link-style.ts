import { cn } from '#/lib/cn'
import { focusRing } from '#/components/ui'

/**
 * How a link inside the import flow is drawn.
 *
 * The links here are TanStack Router's rather than the design system's, for the reason
 * `components/app/dashboard/widget-link.tsx` states: no React Aria `RouterProvider` is mounted in
 * this app, so a `ui` link would do a full document load. That matters more in this flow than
 * anywhere else — the stepper's back and forward **are** links, and a document load between two
 * steps would drop the parsed file this browser is holding.
 *
 * It is a class string rather than a wrapper component because the router's `Link` is generic over
 * the route tree, and wrapping it without `createLink` erases the typed `to`, `params` and `search`
 * that make a mistyped step a compile error.
 *
 * The rules are written out rather than taken from `linkVariants`, which is keyed on React Aria's
 * `data-hovered` and would style nothing on a plain anchor. The underline is present at rest: colour
 * alone does not distinguish a link from the prose around it (1.4.1).
 */
export const importLinkClass = cn(
  'relative inline-flex items-center gap-1.5 text-brand underline decoration-brand/40 underline-offset-4 target-min hover:decoration-brand',
  focusRing,
)
