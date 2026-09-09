import { Button as RACButton } from 'react-aria-components'
import { cva } from 'class-variance-authority'

import { cn } from '#/lib/cn'
import { Spinner } from './spinner'
import {
  composeTw,
  controlWash,
  disabledLabelled,
  focusRing,
  transitionBase,
} from './shared'

import type { ButtonProps as RACButtonProps } from 'react-aria-components'
import type { VariantProps } from 'class-variance-authority'
import type { ReactNode } from 'react'

export const buttonVariants = cva(
  [
    'relative inline-flex shrink-0 items-center justify-center whitespace-nowrap',
    'font-semibold select-none cursor-pointer',
    focusRing,
    transitionBase,
    disabledLabelled,
    // A 1px press, never a bounce or a scale. The shadow steps down with it, so
    // the control reads as pushed into the page rather than as shrinking.
    'data-[pressed]:translate-y-px',
    // WCAG 2.2 §2.5.5 (AAA): the hit area is grown to 44px by a pseudo-element
    // while the visual box stays on the size scale below.
    'target-min',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        /** Near-black in light, near-white in dark. One per decision. */
        primary:
          'bg-accent text-on-accent shadow-card data-[hovered]:bg-accent-hover data-[hovered]:shadow-elevated data-[pressed]:bg-accent-press data-[pressed]:shadow-card data-[disabled]:bg-surface-sunken data-[disabled]:text-ink-2',
        /** Hairline on a sheet. The default for anything that is not the main action. */
        secondary:
          'border border-border-strong bg-surface text-ink shadow-card data-[hovered]:border-ink-2 data-[hovered]:bg-surface-sunken data-[pressed]:bg-surface-sunken data-[pressed]:shadow-none data-[disabled]:border-border-subtle data-[disabled]:bg-surface-sunken data-[disabled]:text-ink-2',
        /** No chrome until touched. Toolbars, table rows, card affordances. */
        ghost: `text-ink-2 ${controlWash} data-[disabled]:text-ink-2 data-[disabled]:opacity-60`,
        /** A quiet filled chip that sits inside a card without competing with it. */
        subtle:
          'bg-surface-sunken text-ink data-[hovered]:bg-hover data-[pressed]:bg-press data-[disabled]:text-ink-2 data-[disabled]:opacity-60',
        /** Brand fill. Marketing and onboarding calls to action. */
        brand:
          'bg-brand text-on-brand shadow-card data-[hovered]:bg-brand-hover data-[hovered]:shadow-elevated data-[pressed]:shadow-card data-[disabled]:bg-surface-sunken data-[disabled]:text-ink-2',
        /** Destructive confirmation. Never the resting state of a row action. */
        danger:
          'bg-negative text-on-negative shadow-card data-[hovered]:brightness-110 data-[hovered]:shadow-elevated data-[pressed]:shadow-card data-[disabled]:bg-surface-sunken data-[disabled]:text-ink-2',
        /** Reads as a link, behaves as a button. */
        link: 'text-brand underline decoration-brand/40 underline-offset-4 data-[hovered]:decoration-brand data-[pressed]:translate-y-0 data-[disabled]:text-ink-2 data-[disabled]:no-underline',
      },
      size: {
        sm: 'h-8 gap-1.5 rounded-sm px-3 text-caption',
        md: 'h-10 gap-2 rounded-md px-4 text-label',
        lg: 'h-12 gap-2.5 rounded-md px-5 text-body',
      },
      shape: {
        default: '',
        /** Square-ish, for an icon-only control. */
        icon: 'px-0 aspect-square',
        pill: 'rounded-full',
      },
      block: { true: 'w-full', false: '' },
    },
    compoundVariants: [
      // A link-shaped button is text: it has no box to give a height to, and a
      // height would push the underline away from the words.
      { variant: 'link', class: 'h-auto px-0 shadow-none' },
    ],
    defaultVariants: {
      variant: 'secondary',
      size: 'md',
      shape: 'default',
      block: false,
    },
  },
)

export type ButtonVariant = NonNullable<
  VariantProps<typeof buttonVariants>['variant']
>
export type ButtonSize = NonNullable<
  VariantProps<typeof buttonVariants>['size']
>

export interface ButtonProps
  extends
    Omit<RACButtonProps, 'className' | 'children'>,
    VariantProps<typeof buttonVariants> {
  className?: RACButtonProps['className']
  children?: ReactNode
  /** Leading glyph. Sized by the button, so pass a bare `lucide-react` icon. */
  icon?: ReactNode
  /** Trailing glyph — a chevron, a count, an external-link mark. */
  iconAfter?: ReactNode
  /**
   * Required when `shape="icon"`: an icon-only control has no accessible name
   * of its own. It is a separate prop rather than a bare `aria-label` so the
   * type system can make it non-optional at the call site.
   */
  label?: string
}

/**
 * The product's button.
 *
 * ## Pending, not disabled
 *
 * `isPending` is React Aria's own: it keeps the control focusable, sets
 * `aria-disabled` rather than `disabled`, and announces the state change
 * politely. That combination is why we do not disable a submit button while its
 * request is in flight — a `disabled` element loses focus the moment it is
 * disabled, dumping a keyboard user back at the top of the document with no
 * announcement of why.
 *
 * The label is kept in the DOM under the spinner with `invisible` rather than
 * removed, so the button holds its measured width and a pending action never
 * reflows the row it sits in.
 */
export function Button({
  className,
  variant,
  size,
  shape,
  block,
  icon,
  iconAfter,
  label,
  children,
  isPending,
  ...props
}: ButtonProps) {
  const iconOnly = shape === 'icon'

  return (
    <RACButton
      {...props}
      isPending={isPending}
      aria-label={props['aria-label'] ?? (iconOnly ? label : undefined)}
      className={composeTw(
        className,
        buttonVariants({ variant, size, shape, block }),
      )}
    >
      {(renderProps) => (
        <>
          {renderProps.isPending ? (
            <span className="absolute inset-0 flex items-center justify-center">
              <Spinner label={null} />
            </span>
          ) : null}
          <span
            className={cn(
              'inline-flex items-center gap-[inherit]',
              renderProps.isPending && 'invisible',
            )}
          >
            {icon}
            {iconOnly ? null : children}
            {iconAfter}
          </span>
        </>
      )}
    </RACButton>
  )
}
