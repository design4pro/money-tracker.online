import { useState } from 'react'

import { ErrorPanel } from '#/components/app/accounts'
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Form,
  Modal,
  Select,
  SelectItem,
} from '#/components/ui'
import { useTranslate } from '#/lib/i18n'
import { mergePayees } from '#/server/fns/payees'

import type { Key } from 'react-aria-components'

/**
 * Folding one payee into another.
 *
 * ## The direction is stated in words, not implied by two pickers
 *
 * "Everything filed under **Zabka sp. z o.o.** moves to **Żabka**, and the old name is kept as an
 * alias so future imports still match it." A merge is not reversible from this screen, so the
 * sentence that says which name survives is the most important thing in the dialog - not a label
 * on a select that reads "From" and "Into".
 *
 * ## `role="alertdialog"`
 *
 * Interrupting a reader is usually the wrong move; a question whose wrong answer silently rewrites
 * a payee's whole history is the exception the role exists for.
 */
export interface MergePayeesDialogProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  /** The payee that disappears. */
  from: { readonly id: string; readonly name: string }
  /** Every other payee in the workspace, as merge targets. */
  candidates: ReadonlyArray<{ readonly id: string; readonly name: string }>
  onMerged: (survivingName: string, mergedName: string) => void
}

export function MergePayeesDialog({
  isOpen,
  onOpenChange,
  from,
  candidates,
  onMerged,
}: MergePayeesDialogProps) {
  const t = useTranslate()
  const [into, setInto] = useState<string | null>(
    candidates.length === 0 ? null : candidates[0].id,
  )
  const [isWorking, setIsWorking] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const target = candidates.find((candidate) => candidate.id === into) ?? null

  async function submit(close: () => void) {
    if (target === null) return
    setIsWorking(true)
    setFailure(null)
    try {
      await mergePayees({ data: { from: from.id, into: target.id } })
      onMerged(target.name, from.name)
      close()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setIsWorking(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="md">
      <Dialog role="alertdialog">
        {({ close }) => (
          <>
            <DialogHeader
              title={t('payees.merge.title', { name: from.name })}
              closeLabel={t('action.close')}
              onClose={close}
            />
            <Form
              onSubmit={(event) => {
                event.preventDefault()
                if (!isWorking) void submit(close)
              }}
              className="contents"
            >
              <DialogBody className="flex flex-col gap-4">
                {candidates.length === 0 ? (
                  <p className="text-body text-ink-2">
                    {t('payees.merge.noTargets')}
                  </p>
                ) : (
                  <>
                    <Select
                      label={t('payees.merge.into')}
                      selectedKey={into}
                      onSelectionChange={(key: Key | null) => {
                        setInto(key === null ? null : String(key))
                      }}
                    >
                      {candidates.map((candidate) => (
                        <SelectItem key={candidate.id} id={candidate.id}>
                          {candidate.name}
                        </SelectItem>
                      ))}
                    </Select>
                    <p className="text-body text-ink-2">
                      {target === null
                        ? null
                        : t('payees.merge.body', {
                            from: from.name,
                            into: target.name,
                          })}
                    </p>
                  </>
                )}
                {failure === null ? null : (
                  <ErrorPanel
                    title={t('payees.merge.failed')}
                    body={t('empty.error.body')}
                    detail={failure}
                  />
                )}
              </DialogBody>
              <DialogFooter>
                <Button variant="ghost" onPress={close}>
                  {t('action.cancel')}
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  isPending={isWorking}
                  isDisabled={target === null}
                >
                  {t('payees.merge.action')}
                </Button>
              </DialogFooter>
            </Form>
          </>
        )}
      </Dialog>
    </Modal>
  )
}
