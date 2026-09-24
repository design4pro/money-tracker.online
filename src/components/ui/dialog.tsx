import { Heading as RACHeading } from 'react-aria-components/Calendar'
import {
  Dialog as RACDialog,
  DialogTrigger as RACDialogTrigger,
} from 'react-aria-components/Dialog'
import {
  Modal as RACModal,
  ModalOverlay as RACModalOverlay,
} from 'react-aria-components/Modal'
import { createContext, useContext, useEffect, useId, useState } from 'react'
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
    'relative flex w-full flex-col bg-surface-raised text-ink shadow-modal',
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
        /**
         * `max-h` is what makes `DialogBody` a scroll port at all: `Dialog`
         * takes its bound from this box, so without one the body's `flex-1`
         * has an unbounded column to fill and its `overflow-y-auto` never has
         * anything to do — the scrim scrolls instead, and a centred flex child
         * cannot be scrolled back to in the block-start direction.
         *
         * `my-auto` rather than `items-center` on the scrim, because auto
         * margins in the cross axis centre while there is free space and
         * collapse to zero when there is none. That keeps the block-start
         * overflow reachable in the residual case where a panel refuses to
         * shrink below the viewport.
         */
        center: 'rounded-xl my-auto max-h-[calc(100dvh-2rem)]',
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
  /**
   * Consulted before every close, and a `false` return leaves the dialog open.
   *
   * Every close React Aria performs — a press on the scrim, Escape, and the
   * `close` from `Dialog`'s render props, which is what the header's X and
   * every footer button in this repository call — ends in the overlay state's
   * `close()`. On a **controlled** overlay that calls `onOpenChange(false)` and
   * changes nothing itself, so wrapping `onOpenChange` once covers every path.
   *
   * It therefore only holds for a controlled `Modal`. Inside a `DialogTrigger`
   * the state is React Aria's own and closes whatever this returns.
   *
   * The mechanism lives here; what a refusal *means* does not. `components/ui`
   * carries no copy — see `DialogHeader`'s `closeLabel` — so the
   * unsaved-changes guard that uses this is `components/app/shell/form-modal`.
   */
  canClose?: () => boolean
}

/**
 * The overlay + panel pair.
 *
 * React Aria owns the parts that are hard and invisible: the focus trap, the
 * `inert` it puts on the rest of the document so a screen reader cannot swipe
 * out of the dialog, the scroll lock (including the iOS rubber-band case), the
 * Escape handler and the focus restore on close.
 *
 * `isDismissable` defaults to `true` here. A dialog that would lose the user's
 * work takes {@link ModalProps.canClose} instead of turning it off: an
 * accidental click on the scrim is not consent to discard, but neither is a
 * dialog with nothing in it worth walling somebody into.
 */
export function Modal({
  children,
  className,
  overlayClassName,
  size,
  placement,
  isDismissable = true,
  canClose,
  onOpenChange,
  ...props
}: ModalProps) {
  const docked = placement === 'drawer' || placement === 'drawer-end'

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen && canClose !== undefined && !canClose()) return
    onOpenChange?.(isOpen)
  }

  // Handed over only when there is something to hand over. React Aria warns —
  // "This modals state is controlled by a trigger, place onOpenChange on the
  // trigger instead" — for any `Modal` inside a `DialogTrigger` that is given
  // one, and `docs/SPEC.md` §2.10 turns a console line red. An uncontrolled
  // modal has no `canClose` to honour either: the guard needs the open state to
  // refuse to change, and inside a trigger that state is not the caller's.
  const controlled =
    canClose === undefined && onOpenChange === undefined
      ? {}
      : { onOpenChange: handleOpenChange }

  return (
    <RACModalOverlay
      {...props}
      {...controlled}
      isDismissable={isDismissable}
      data-scrim=""
      className={composeTw(
        overlayClassName,
        scrimSurface,
        'flex p-4',
        docked ? 'p-0' : 'justify-center overflow-y-auto',
      )}
    >
      <RACModal
        data-motion-transform=""
        className={cn(modalVariants({ size, placement }), className)}
      >
        {children}
      </RACModal>
    </RACModalOverlay>
  )
}

export interface DialogProps extends Omit<RACDialogProps, 'className'> {
  className?: string
}

/**
 * How the header's description reaches the dialog that has to point
 * `aria-describedby` at it.
 *
 * The id has to travel **upward**: the paragraph is rendered by `DialogHeader`,
 * a child of the element carrying the attribute, and whether there is a
 * description at all is something only the header knows. React Aria does expose
 * a description slot, but `useDialog` mints that id for `role="alertdialog"`
 * only, so an ordinary dialog would still describe nothing.
 *
 * `null` outside a `Dialog`, where there is nothing to describe.
 */
const DialogDescriptionContext = createContext<
  ((id: string | undefined) => void) | null
>(null)

/**
 * The dialog body. Always inside a `Modal`.
 *
 * `role` defaults to `dialog`; pass `role="alertdialog"` for a destructive
 * confirmation, which is the one case where interrupting the reader is correct.
 *
 * It is a **flex item** of the panel's column rather than a box that inherits
 * the panel's `max-height`. `max-height: inherit` took the parent's *computed*
 * value, so it read `none` wherever the panel set no bound of its own — which
 * was every centred dialog, and `drawer-end`, whose `max-h-none` says so
 * explicitly. `min-h-0 flex-1` needs no bound to be inherited: the panel's own
 * height is the constraint, whichever variant supplied it.
 */
export function Dialog({ className, children, ...props }: DialogProps) {
  const [describedBy, setDescribedBy] = useState<string>()

  return (
    <RACDialog
      // Before the spread, so a caller passing its own `aria-describedby` still
      // wins over the header's.
      aria-describedby={describedBy}
      {...props}
      className={cn('flex min-h-0 flex-1 flex-col outline-hidden', className)}
    >
      {(renderProps) => (
        <DialogDescriptionContext.Provider value={setDescribedBy}>
          {typeof children === 'function' ? children(renderProps) : children}
        </DialogDescriptionContext.Provider>
      )}
    </RACDialog>
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
  const descriptionId = useId()
  const registerDescription = useContext(DialogDescriptionContext)
  const hasDescription = Boolean(description)

  useEffect(() => {
    if (registerDescription === null) return
    registerDescription(hasDescription ? descriptionId : undefined)
    return () => registerDescription(undefined)
  }, [registerDescription, descriptionId, hasDescription])

  return (
    <div
      className={cn(
        'flex shrink-0 items-start justify-between gap-4 border-b border-border-subtle px-5 py-4',
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
          <p id={descriptionId} className="mt-1 text-caption text-ink-2">
            {description}
          </p>
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
        //
        // `relative` is what keeps it the containing block for its own
        // absolutely positioned descendants. React Aria hides the real input of
        // a `Switch`, a `Select` and a `RadioGroup` inside a `VisuallyHidden`,
        // which is `position: absolute` — and with no positioned ancestor
        // nearer than the panel, those boxes sat outside this scroll port and
        // outside its clip, giving the scrim hundreds of pixels of scroll range
        // that moved the panel's header off the top of the screen.
        'relative min-h-0 flex-1 overflow-y-auto px-5 py-4 focus-safe',
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
        'flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border-subtle px-5 py-4',
        className,
      )}
    />
  )
}
