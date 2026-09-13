import { cn } from '#/lib/cn'
import { focusRing } from '#/components/ui'

/**
 * How a link inside the import flow is drawn.
 *
 * The links here are TanStack Router's rather than the design system's, and they stay that way.
 * The reason this file used to give — that no React Aria `RouterProvider` was mounted, so a `ui`
 * link meant a full document load — expired with #245; the design system's `Link` is a client-side
 * navigation everywhere the shell is mounted, and the stepper would be safe on it.
 *
 * What keeps this file is the second reason, which is the stronger one. The stepper's back and
 * forward carry typed `params` and `search`, and `components/ui`'s `Link` takes a built `href`
 * string: moving the stepper onto it would turn a mistyped step from a compile error into a
 * runtime 404. So these stay TanStack's typed `Link`, and this stays a class string rather than a
 * wrapper component — wrapping a `Link` without `createLink` erases exactly the typing that is the
 * point.
 *
 * The rules are written out rather than taken from `linkVariants`, which is keyed on React Aria's
 * `data-hovered` and would style nothing on a plain anchor. The underline is present at rest: colour
 * alone does not distinguish a link from the prose around it (1.4.1).
 */
export const importLinkClass = cn(
  'relative inline-flex items-center gap-1.5 text-brand underline decoration-brand/40 underline-offset-4 target-min hover:decoration-brand',
  focusRing,
)
