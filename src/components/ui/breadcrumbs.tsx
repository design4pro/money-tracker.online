import {
  Breadcrumb as RACBreadcrumb,
  Breadcrumbs as RACBreadcrumbs,
} from 'react-aria-components/Breadcrumbs'
import { ChevronRight } from 'lucide-react'

import { Link } from './link'
import { composeTw } from './shared'

import { cn } from '#/lib/cn'

import type {
  BreadcrumbProps as RACBreadcrumbProps,
  BreadcrumbsProps as RACBreadcrumbsProps,
} from 'react-aria-components'
import type { ReactNode } from 'react'

export interface BreadcrumbsProps<
  T extends object,
> extends RACBreadcrumbsProps<T> {
  /** Accessible name for the trail. Localised by the caller. */
  label?: string
}

/**
 * The trail to the current page.
 *
 * React Aria renders an ordered list inside a `nav`, and marks the last item
 * `aria-current="page"` — which is what tells a reader they have reached the
 * end of the trail rather than merely run out of links. The separator is a
 * `::before` on each item after the first, so it is never announced.
 */
export function Breadcrumbs<T extends object>({
  className,
  label = 'Breadcrumbs',
  ...props
}: BreadcrumbsProps<T>) {
  return (
    <RACBreadcrumbs
      {...props}
      aria-label={props['aria-label'] ?? label}
      // `cn` rather than `composeTw`: React Aria's `Breadcrumbs` has no render props, so its
      // `className` is a plain string and handing it a render function would not typecheck.
      className={cn(
        'flex flex-wrap items-center gap-1 text-caption text-ink-2',
        className,
      )}
    />
  )
}

export interface BreadcrumbProps extends RACBreadcrumbProps {
  /** Where this crumb goes. Omit on the final crumb — it is the current page. */
  href?: string
  children: ReactNode
}

export function Breadcrumb({
  className,
  href,
  children,
  ...props
}: BreadcrumbProps) {
  return (
    <RACBreadcrumb
      {...props}
      className={composeTw(
        className,
        // The separator is an `aria-hidden` glyph rather than a text node. A
        // literal `/` in the DOM is read aloud, and a five-crumb trail becomes
        // "Home slash Accounts slash Current".
        'flex items-center gap-1',
      )}
    >
      {href === undefined ? (
        <span className="font-medium text-ink">{children}</span>
      ) : (
        <>
          <Link href={href} variant="quiet" size="sm">
            {children}
          </Link>
          <ChevronRight aria-hidden="true" className="size-3.5 text-ink-2" />
        </>
      )}
    </RACBreadcrumb>
  )
}
