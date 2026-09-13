import { useState } from 'react'

import { ErrorPanel } from '#/components/app/shell'
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from '#/components/ui'
import { useTranslate } from '#/lib/i18n'

import type { ReactNode } from 'react'

/**
 * The one confirmation used by archive, restore and delete.
 *
 * ## `role="alertdialog"`, and only here
 *
 * Interrupting a reader is almost always the wrong move; a question whose wrong answer destroys
 * data is the exception the role exists for. It makes assistive technology announce the body text
 * with the title instead of waiting to be asked, which matters because the body is where the
 * consequence is written — "its transactions stay where they are", "this cannot be undone".
 *
 * ## The failure stays on screen
 *
 * A rejected delete is not a toast. `deleteAccount` refuses when transactions exist, and the
 * reason is a fact the person has to read, weigh and act on — so it renders into the dialog and
 * waits, while the dialog stays open with its buttons live. A message that vanishes on a timer
 * would leave someone pressing a button that keeps quietly failing.
 */
export interface ConfirmDialogProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  title: string
  body: ReactNode
  /** The word on the button that does the thing. Never "OK". */
  confirmLabel: string
  /** Paints the confirm button as destructive. Archiving is not; deleting is. */
  isDestructive?: boolean
  /** Title for the panel shown when the server refuses. */
  errorTitle: string
  /**
   * Prose shown above the raw error — the *likely* reason, in the caller's words. Delete passes
   * "this account still has 42 transactions"; archive has no such case and passes the generic one.
   */
  errorBody: ReactNode
  onConfirm: () => Promise<unknown>
}

export function ConfirmDialog({
  isOpen,
  onOpenChange,
  title,
  body,
  confirmLabel,
  isDestructive = false,
  errorTitle,
  errorBody,
  onConfirm,
}: ConfirmDialogProps) {
  const t = useTranslate()
  const [isWorking, setIsWorking] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  async function confirm(close: () => void) {
    setIsWorking(true)
    setFailure(null)
    try {
      await onConfirm()
      close()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setIsWorking(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="sm">
      <Dialog role="alertdialog">
        {({ close }) => (
          <>
            <DialogHeader
              title={title}
              closeLabel={t('action.close')}
              onClose={close}
            />
            <DialogBody className="flex flex-col gap-4">
              <div className="text-body text-ink-2">{body}</div>
              {failure === null ? null : (
                <ErrorPanel
                  title={errorTitle}
                  body={errorBody}
                  detail={failure}
                />
              )}
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onPress={close}>
                {t('action.cancel')}
              </Button>
              <Button
                variant={isDestructive ? 'danger' : 'primary'}
                isPending={isWorking}
                onPress={() => {
                  void confirm(close)
                }}
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
