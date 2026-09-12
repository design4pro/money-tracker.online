import { Link as RACLink } from 'react-aria-components'
import { cva } from 'class-variance-authority'

import {
  composeTw,
  disabledLabelled,
  focusRing,
  transitionBase,
} from './shared'

import type { LinkProps as RACLinkProps } from 'react-aria-components'
import type { VariantProps } from 'class-variance-authority'

export const linkVariants = cva(
  [
    'inline-flex items-center gap-1.5 cursor-pointer',
    focusRing,
    transitionBase,
    disabledLabelled,
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        /**
         * Underlined by default, not on hover.
         *
         * A link inside a block of text that is distinguished only by colour
         * fails WCAG 1.4.1 unless the colour difference against the surrounding
         * text also reaches 3:1 — and brand-on-ink here is 1.9:1. The underline
         * is the non-colour channel, so it is present at rest and merely
         * deepens on hover.
         */
        default:
          'text-brand underline decoration-brand/40 underline-offset-4 data-[hovered]:decoration-brand data-[disabled]:text-ink-2 data-[disabled]:no-underline',
        /** For navigation chrome, where position already identifies the link. */
        quiet:
          'text-ink-2 no-underline data-[hovered]:text-ink data-[hovered]:underline data-[hovered]:underline-offset-4 data-[disabled]:text-ink-2',
        /** Inherits its surroundings — a card whose whole face is the link. */
        unstyled: 'text-inherit no-underline',
      },
      size: {
        inherit: '',
        sm: 'text-caption',
        md: 'text-label',
        lg: 'text-body',
        /**
         * The "see all of this" link in a panel's corner.
         *
         * A pairing rather than a plain type step, which is why it sits beside the sizes rather
         * than beside the variants: it is `sm` with the weight and the pointer target the corner
         * of a widget needs. `target-min` is what makes the 44px target real without inflating
         * the text's line box — it grows a pseudo-element around the link rather than the link
         * itself — and the tighter gap is what keeps a caption-sized glyph beside a caption-sized
         * word. It carries no colour of its own, so it composes with any variant; the dashboard
         * pairs it with `default`.
         */
        widget: 'gap-1 text-caption font-medium target-min',
      },
    },
    defaultVariants: { variant: 'default', size: 'inherit' },
  },
)

export interface LinkProps
  extends Omit<RACLinkProps, 'className'>, VariantProps<typeof linkVariants> {
  className?: RACLinkProps['className']
}

/**
 * A navigation link.
 *
 * React Aria's `Link` renders a real `<a>` when it is given an `href` and a
 * `<span role="link">` when it is not, and in the second case it wires the
 * keyboard behaviour an anchor would have had. It also routes through the
 * app-level `RouterProvider`, which is what lets a client-side navigation keep
 * the focus and announcement behaviour of a document load.
 *
 * A disabled link is `data-disabled` plus `aria-disabled` rather than a removed
 * `href`: dropping the href would take the element out of the tab order without
 * telling anyone why it went.
 */
export function Link({ className, variant, size, ...props }: LinkProps) {
  return (
    <RACLink
      {...props}
      className={composeTw(className, linkVariants({ variant, size }))}
    />
  )
}
