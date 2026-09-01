import {
  Dialog as RACDialog,
  DialogTrigger as RACDialogTrigger,
  Heading as RACHeading,
  Modal as RACModal,
  ModalOverlay as RACModalOverlay,
} from 'react-aria-components'
import { X } from 'lucide-react'
import { cva } from 'class-variance-authority'

import { cn } from '#/lib/cn'
import { Button } from './button'
import { composeTw, scrimSurface } from './shared'

import type {
  DialogProps as RACDialogProps,
  ModalOverlayProps as RACModalOverlayProps,
} from 'react-aria-components'
import type { VariantProps } from 'class-variance-authority'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'

export const DialogTrigger = RACDialogTrigger

const modalVariants = cva(
  [
    'relative w-full bg-surface-raised text-ink shadow-modal',
    'data-[entering]:animate-dialog-in data-[exiting]:animate-dialog-out',
  ],
  {
    variants: {
      size: {
        sm: 'max-w-sm',
        md: 'max-w-lg',
        lg: 'max-w-2xl',
        xl: 'max-w-4xl',
      },
      /**
       * `center` is the dialog; `drawer` is the same Modal docked to an edge.
       *
       * The blueprint drops `vaul` for exactly this reason: a drawer is not a
       * different accessibility contract from a dialog. It is a dialog with a
       * different transform, and a second library modelling the same focus
       * trap is a second place for that trap to be wrong.
       */
      placement: {
        center: 'rounded-xl',
        drawer:
          'rounded-t-2xl max-w-none sm:max-w-none mt-auto max-h-[92dvh] pb-[var(--safe-bottom)] data-[entering]:animate-drawer-in data-[exiting]:animate-drawer-out',
        'drawer-end':
          'rounded-s-2xl ms-auto h-full max-h-none w-full max-w-md data-[entering]:animate-fade-in data-[exiting]:animate-fade-out',
      },
    },
    defaultVariants: { size: 'md', placement: 'center' },
  },
)

export interface ModalProps
  extends
    Omit<RACModalOverlayProps, 'className' | 'children'>,
    VariantProps<typeof modalVariants> {
  children?: ReactNode
  className?: string
  /** Class on the scrim rather than on the panel. */
  overlayClassName?: string
}

/**
 * The overlay + panel pair.
 *
 * React Aria owns the parts that are hard and invisible: the focus trap, the
 * `inert` it puts on the rest of the document so a screen reader cannot swipe
 * out of the dialog, the scroll lock (including the iOS rubber-band case), the
 * Escape handler and the focus restore on close.
 *
 * `isDismissable` defaults to `true` here, and should be turned OFF for any
 * dialog that would lose the user's work — a half-finished transaction, an
 * import mapping. An accidental click on the scrim is not consent to discard.
 */
export function Modal({
  children,
  className,
  overlayClassName,
  size,
  placement,
  isDismissable = true,
  ...props
}: ModalProps) {
  const docked = placement === 'drawer' || placement === 'drawer-end'

  return (
    <RACModalOverlay
      {...props}
      isDismissable={isDismissable}
      data-scrim=""
      className={composeTw(
        overlayClassName,
        scrimSurface,
        'flex p-4',
        docked ? 'p-0' : 'items-center justify-center overflow-y-auto',
      )}
    >
      <RACModal className={cn(modalVariants({ size, placement }), className)}>
        {children}
      </RACModal>
    </RACModalOverlay>
  )
}

export interface DialogProps extends Omit<RACDialogProps, 'className'> {
  className?: string
}

/**
 * The dialog body. Always inside a `Modal`.
 *
 * `role` defaults to `dialog`; pass `role="alertdialog"` for a destructive
 * confirmation, which is the one case where interrupting the reader is correct.
 */
export function Dialog({ className, ...props }: DialogProps) {
  return (
    <RACDialog
      {...props}
      className={cn('flex max-h-[inherit] flex-col outline-hidden', className)}
    />
  )
}

export interface DialogHeaderProps {
  title: ReactNode
  description?: ReactNode
  /** Accessible name for the close button. Localised by the caller. */
  closeLabel?: string
  /** Hide the close affordance for a dialog that demands an explicit choice. */
  hideClose?: boolean
  /**
   * Pass the `close` function from the surrounding `Dialog`'s render props.
   * It is a required argument rather than a slot lookup so the close control
   * cannot silently become inert when the header is used outside a dialog.
   */
  onClose?: () => void
  className?: string
}

/**
 * Title, optional lead line, and the close control.
 *
 * The `Heading slot="title"` is what React Aria points `aria-labelledby` at. A
 * dialog whose title is a styled `div` announces as "dialog" and nothing else,
 * which is the most common failure in a copied-in modal.
 */
export function DialogHeader({
  title,
  description,
  closeLabel = 'Close',
  hideClose = false,
  onClose,
  className,
}: DialogHeaderProps) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4',
        className,
      )}
    >
      <div className="min-w-0">
        <RACHeading
          slot="title"
          className="text-subtitle font-semibold text-ink"
        >
          {title}
        </RACHeading>
        {description ? (
          <p className="mt-1 text-caption text-ink-2">{description}</p>
        ) : null}
      </div>
      {hideClose ? null : (
        <Button
          variant="ghost"
          size="sm"
          shape="icon"
          label={closeLabel}
          onPress={onClose}
          icon={<X className="size-4" />}
        />
      )}
    </div>
  )
}

export function DialogBody({
  className,
  ...props
}: ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      {...props}
      className={cn(
        // The scrollable region of a dialog, and therefore the one that has to
        // reserve room so a focused control at its edge is not clipped
        // (WCAG 2.2 §2.4.12).
        'min-h-0 flex-1 overflow-y-auto px-5 py-4 focus-safe',
        className,
      )}
    />
  )
}

export function DialogFooter({
  className,
  ...props
}: ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      {...props}
      className={cn(
        'flex flex-wrap items-center justify-end gap-2 border-t border-border-subtle px-5 py-4',
        className,
      )}
    />
  )
}
