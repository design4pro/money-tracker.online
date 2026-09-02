import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from '#/components/ui'
import { useTranslate } from '#/lib/i18n'

/**
 * The one thing on this surface that cannot be undone, asked about before it happens.
 *
 * `role="alertdialog"` rather than `dialog`: the two differ in what a screen reader reads on open —
 * an alert dialog announces its description immediately, so the sentence explaining that the
 * deletion is permanent is heard before the buttons are reached rather than after somebody has gone
 * looking for it.
 *
 * The dialog is not dismissable by clicking outside. Escape still closes it, because a destructive
 * prompt that traps somebody is worse than one that is easy to dismiss — but a stray click on the
 * page behind should not be the gesture that decides.
 *
 * The confirming button is `danger` and carries the count in its own label, so the destructive
 * choice is never the one a reader lands on by pressing Enter out of habit: focus opens on Cancel.
 */

export interface ConfirmDeleteDialogProps {
  readonly isOpen: boolean
  readonly onOpenChange: (isOpen: boolean) => void
  readonly title: string
  readonly body: string
  readonly confirmLabel: string
  readonly onConfirm: () => void
  readonly isPending: boolean
}

export function ConfirmDeleteDialog({
  isOpen,
  onOpenChange,
  title,
  body,
  confirmLabel,
  onConfirm,
  isPending,
}: ConfirmDeleteDialogProps) {
  const t = useTranslate()

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} isDismissable={false}>
      <Dialog role="alertdialog">
        {({ close }) => (
          <>
            <DialogHeader
              title={title}
              description={body}
              closeLabel={t('action.close')}
              onClose={close}
            />
            <DialogBody />
            <DialogFooter>
              <Button
                variant="secondary"
                autoFocus
                isDisabled={isPending}
                onPress={close}
              >
                {t('action.cancel')}
              </Button>
              <Button
                variant="danger"
                isPending={isPending}
                onPress={onConfirm}
              >
                {confirmLabel}
              </Button>
            </DialogFooter>
          </>
        )}
      </Dialog>
    </Modal>
  )
}
