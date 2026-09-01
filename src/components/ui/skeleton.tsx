import { cn } from '#/lib/cn'

import type { ComponentPropsWithoutRef } from 'react'

export interface SkeletonProps extends ComponentPropsWithoutRef<'div'> {
  /** `text` matches a line of body copy; `block` is a box you size yourself. */
  shape?: 'text' | 'block' | 'circle'
  /** Number of text lines. Only meaningful for `shape="text"`. */
  lines?: number
}

/**
 * A loading placeholder.
 *
 * `aria-hidden` on every skeleton, always. The shapes convey nothing to a
 * screen reader, and announcing eight empty boxes is worse than announcing
 * nothing — the region that owns the load is responsible for saying "Loading
 * transactions" once, in a live region, and this is only the picture of that.
 *
 * The shimmer is a `translateX` on a gradient, which composites, and it stops
 * entirely under `prefers-reduced-motion`. A still grey box is a perfectly good
 * skeleton; a pulsing one is the same information with a headache attached.
 */
export function Skeleton({
  className,
  shape = 'block',
  lines = 1,
  ...props
}: SkeletonProps) {
  if (shape === 'text' && lines > 1) {
    return (
      <div aria-hidden="true" className={cn('flex flex-col gap-2', className)}>
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton
            key={i}
            shape="text"
            // The last line is short, the way a real paragraph ends.
            className={i === lines - 1 ? 'w-3/5' : undefined}
          />
        ))}
      </div>
    )
  }

  return (
    <div
      {...props}
      aria-hidden="true"
      className={cn(
        'relative overflow-hidden bg-skeleton',
        shape === 'text' && 'h-4 w-full rounded-sm',
        shape === 'block' && 'h-full w-full rounded-md',
        shape === 'circle' && 'aspect-square rounded-full',
        className,
      )}
    >
      {/* `bg-linear-to-r` is the Tailwind v4 name; `bg-gradient-to-r` is the v3
          spelling and only survives as a compatibility alias. */}
      <span className="absolute inset-0 -translate-x-full animate-shimmer bg-linear-to-r from-transparent via-skeleton-sheen to-transparent" />
    </div>
  )
}
