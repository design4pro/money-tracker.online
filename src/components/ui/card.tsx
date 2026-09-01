import { cva } from 'class-variance-authority'

import { cn } from '#/lib/cn'

import type { VariantProps } from 'class-variance-authority'
import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react'

export const cardVariants = cva('rounded-xl', {
  variants: {
    variant: {
      /** A sheet on the page. The default unit of composition. */
      default: 'border border-border-subtle bg-surface shadow-card',
      /** Recessed. For a panel nested inside another card. */
      inset: 'rounded-lg bg-surface-sunken',
      /** A tinted invitation — an upsell, an empty-state prompt. */
      brand: 'border border-brand/25 bg-brand-soft',
      /** The "create something here" affordance. */
      dashed: 'border border-dashed border-border-strong/60 bg-transparent',
      /** No chrome. For a group that needs padding but not a boundary. */
      plain: 'bg-transparent',
    },
    padding: {
      none: 'p-0',
      sm: 'p-4',
      md: 'p-5',
      lg: 'p-6',
    },
  },
  defaultVariants: { variant: 'default', padding: 'md' },
})

export interface CardProps
  extends ComponentPropsWithoutRef<'div'>, VariantProps<typeof cardVariants> {
  /**
   * Render as a different element. Use `as="section"` or `as="article"` when
   * the card is a landmark region — and give it an `aria-labelledby` pointing
   * at its own heading when you do, because an unlabelled `section` is a
   * landmark that tells a reader nothing.
   */
  as?: ElementType
}

/**
 * The sheet.
 *
 * Flat at rest: depth comes from the surface ladder and a hairline, not from a
 * shadow. `--shadow-card` is 4–5% alpha in light and exists only to keep a
 * white sheet from dissolving into the warm canvas behind it.
 *
 * A card is **not** interactive by default and there is deliberately no
 * `isInteractive` prop. A clickable card is a `Button` or a `Link` wrapping a
 * card, so the thing that takes the press is the thing that takes focus, is
 * announced with a role, and answers Enter.
 */
export function Card({
  className,
  variant,
  padding,
  as: Component = 'div',
  ...props
}: CardProps) {
  return (
    <Component
      {...props}
      className={cn(cardVariants({ variant, padding }), className)}
    />
  )
}

// `title` is omitted from the div props before being redeclared: the DOM one is the tooltip
// attribute and is a `string`, while a card's title is a rendered node. Extending without the
// omit is a type error, and silently keeping the DOM meaning would put the heading text into a
// hover tooltip as well as into the heading.
export interface CardHeaderProps extends Omit<
  ComponentPropsWithoutRef<'div'>,
  'title'
> {
  /** The quiet uppercase opener. 11px, the smallest type in the system. */
  eyebrow?: ReactNode
  title?: ReactNode
  description?: ReactNode
  /** Trailing controls — a menu button, a period selector. */
  action?: ReactNode
  /** Heading level. Pick whatever keeps the page outline correct. */
  headingLevel?: 2 | 3 | 4 | 5 | 6
}

export function CardHeader({
  className,
  eyebrow,
  title,
  description,
  action,
  headingLevel = 3,
  children,
  ...props
}: CardHeaderProps) {
  const Heading = `h${headingLevel}` as ElementType

  return (
    <div
      {...props}
      className={cn('flex items-start justify-between gap-3', className)}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-micro tracking-label uppercase text-ink-2">
            {eyebrow}
          </p>
        ) : null}
        {title ? (
          <Heading className="text-subtitle font-semibold text-ink">
            {title}
          </Heading>
        ) : null}
        {description ? (
          <p className="mt-1 text-caption text-ink-2">{description}</p>
        ) : null}
        {children}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

export function CardBody({
  className,
  ...props
}: ComponentPropsWithoutRef<'div'>) {
  return <div {...props} className={cn('mt-4', className)} />
}

export function CardFooter({
  className,
  ...props
}: ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      {...props}
      className={cn(
        'mt-4 flex flex-wrap items-center gap-2 border-t border-border-subtle pt-4',
        className,
      )}
    />
  )
}
