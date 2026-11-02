import { Button as RACButton } from 'react-aria-components/Button'

import { buttonVariants } from './button'
import { composeTw } from './shared'

import type { ButtonProps as RACButtonProps } from 'react-aria-components'
import type { ReactNode } from 'react'

export interface KindTileProps extends Omit<
  RACButtonProps,
  'className' | 'children'
> {
  className?: RACButtonProps['className']
  /** Decorative glyph. Never the only carrier of the name. */
  icon: ReactNode
  title: ReactNode
  /** Optional second line; included in the accessible name when present. */
  help?: ReactNode
}

/**
 * A "pick this kind" tile on an empty list.
 *
 * `/accounts` and `/budgets` both offer shortcuts that open a create form with
 * a kind already chosen. The shared {@link Button} wraps its children in an
 * inner row, so a `flex-col` passed to it never stacks the glyph, the title
 * and the help. This tile takes the secondary-button paint and is the
 * interactive element itself, so those three are its direct children.
 *
 * It creates nothing. The caller decides what `onPress` does; both screens
 * open a form.
 */
export function KindTile({
  className,
  icon,
  title,
  help,
  ...props
}: KindTileProps) {
  return (
    <RACButton
      {...props}
      className={composeTw(
        className,
        buttonVariants({
          variant: 'secondary',
          size: 'lg',
          block: true,
        }),
        'h-auto flex-col items-start justify-start gap-1.5 whitespace-normal py-4 text-start',
      )}
    >
      <span aria-hidden="true" className="[&_svg]:size-5 [&_svg]:text-ink-2">
        {icon}
      </span>
      <span className="text-label font-semibold text-ink">{title}</span>
      {help ? (
        <span className="text-caption font-normal text-ink-2">{help}</span>
      ) : null}
    </RACButton>
  )
}
