import { Toaster as SonnerToaster, toast } from 'sonner'
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'

import { useTheme } from '#/lib/theme'

import type { ToasterProps as SonnerToasterProps } from 'sonner'

export { toast }

/**
 * The close button is a real 44x44 box (WCAG 2.2 §2.5.5) pinned inside the toast's inline-end
 * corner, with the 20px chip drawn by `::before`. Sonner's own rule floats a 20px circle over the
 * corner; its stylesheet is unlayered, so every override here is important to win over it
 * (#730). `left`/`right` read the opposite direction variable, which puts the box at the
 * inline-end edge in both LTR and RTL.
 */
const CLOSE_BUTTON_CLASSES = [
  'size-11! left-(--toast-close-button-end)! right-(--toast-close-button-start)! transform-none!',
  'rounded-md! border-0! bg-transparent! text-ink-2! focus-ring focus-visible:shadow-none!',
  "before:absolute before:-z-10 before:size-5 before:rounded-full before:border before:border-border-subtle before:bg-surface before:content-['']",
  'hover:bg-transparent! hover:before:bg-hover',
].join(' ')

export interface ToastHostProps extends Omit<
  SonnerToasterProps,
  'theme' | 'toastOptions'
> {
  /** Accessible name for the toast region. Localised by the caller. */
  regionLabel?: string
  /** Localised label for the per-toast close button. */
  closeLabel?: string
}

/**
 * The single toast region. Mounted once, in the app shell.
 *
 * ## Politeness
 *
 * Every toast is announced **politely**. A toast interrupts nothing: it is by
 * definition information the user did not ask for at that moment, and
 * `aria-live="assertive"` would cut across whatever they were reading or
 * typing. The one thing that legitimately interrupts is an error that blocks
 * the current action — and that is a dialog or an inline `FieldError`, not a
 * toast.
 *
 * ## What must never be a toast
 *
 * Anything the user has to act on, and anything they would need to read twice.
 * A toast is dismissed on a timer, which conflicts head-on with WCAG 2.2 §2.2.1
 * unless the content is purely informational — so a failed import belongs in the
 * import screen's own error panel, with the toast reduced to "Import failed"
 * plus a link. `duration` here is 8 seconds rather than sonner's 4: reading a
 * sentence, deciding it matters and moving a pointer to it takes longer than
 * four seconds for most people, and every toast also carries a close button so
 * a reader can end it early.
 *
 * Sonner's `hotkey` (Alt+T by default) moves focus into the region, which is the
 * keyboard path to a toast's own controls. It is left at the default so it
 * matches what a user of the library elsewhere already knows.
 *
 * ## Icons
 *
 * Each kind carries a glyph. A green bar and a red bar are the same bar to a
 * third of colour-blind readers, and this is the one surface in the product
 * where the reader has no time to look for a second cue.
 */
export function ToastHost({
  regionLabel = 'Notifications',
  closeLabel = 'Dismiss notification',
  position = 'bottom-right',
  duration = 8000,
  ...props
}: ToastHostProps) {
  const { resolved } = useTheme()

  return (
    <SonnerToaster
      {...props}
      theme={resolved}
      position={position}
      duration={duration}
      closeButton
      containerAriaLabel={regionLabel}
      icons={{
        success: <CheckCircle2 className="size-4 text-positive" />,
        error: <XCircle className="size-4 text-negative" />,
        warning: <AlertTriangle className="size-4 text-warning" />,
        info: <Info className="size-4 text-info" />,
      }}
      toastOptions={{
        closeButtonAriaLabel: closeLabel,
        // Painted entirely from our tokens rather than from sonner's own CSS
        // variables, so a toast is subject to the same 7:1 contract as every
        // other surface — including in dark, where sonner's defaults are a
        // near-black panel with a mid-grey body line.
        classNames: {
          toast:
            'group flex w-full items-start gap-3 rounded-lg border border-border-subtle bg-surface-raised p-3.5 shadow-popover',
          title: 'text-label font-semibold text-ink',
          description: 'text-caption text-ink-2',
          actionButton:
            'rounded-md bg-accent px-2.5 py-1 text-caption font-semibold text-on-accent',
          cancelButton:
            'rounded-md bg-surface-sunken px-2.5 py-1 text-caption font-semibold text-ink',
          closeButton: CLOSE_BUTTON_CLASSES,
          content: 'pe-7',
          icon: 'shrink-0',
        },
      }}
    />
  )
}
