import { useState } from 'react'

import { AgentScopePicker } from '#/components/app/agent-scope-picker'
import { FailurePanel } from '#/components/app/shell'
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Form,
  Modal,
  TextField,
} from '#/components/ui'
import { READ_SCOPES } from '#/lib/agent-scopes'
import { failureOf } from '#/lib/failure'
import { useTranslate } from '#/lib/i18n'

import type { FailureEnvelope } from '#/lib/failure-envelope'
import type { AgentScope } from '#/lib/agent-scopes'
import type { FormEvent } from 'react'
import type { MintedPat } from '#/server/repos/agent-grants'

export interface MintTokenDialogProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  onMint: (input: {
    name: string
    scopes: ReadonlyArray<AgentScope>
  }) => Promise<MintedPat>
}

export function MintTokenDialog({
  isOpen,
  onOpenChange,
  onMint,
}: MintTokenDialogProps) {
  const t = useTranslate()
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<ReadonlyArray<string>>([...READ_SCOPES])
  const [isWorking, setIsWorking] = useState(false)
  const [failure, setFailure] = useState<FailureEnvelope | null>(null)

  async function submit(event: FormEvent, close: () => void) {
    event.preventDefault()
    setIsWorking(true)
    setFailure(null)
    try {
      await onMint({
        name,
        scopes: scopes as Array<AgentScope>,
      })
      setName('')
      setScopes([...READ_SCOPES])
      close()
    } catch (error) {
      setFailure(failureOf(error))
    } finally {
      setIsWorking(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="md">
      <Dialog>
        {({ close }) => (
          <Form
            onSubmit={(event) => void submit(event, close)}
            className="contents"
          >
            <DialogHeader
              title={t('settings.agents.createTitle')}
              closeLabel={t('action.close')}
              onClose={close}
            />
            <DialogBody className="flex flex-col gap-5">
              <TextField
                isRequired
                label={t('settings.agents.tokenName')}
                value={name}
                onChange={setName}
                autoComplete="off"
              />
              <AgentScopePicker
                isRequired
                label={t('settings.agents.scopesLabel')}
                value={scopes}
                onChange={setScopes}
              />
              {failure === null ? null : (
                <FailurePanel
                  failure={failure}
                  placement="after-action"
                  title={t('settings.agents.error.title')}
                />
              )}
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onPress={close}>
                {t('action.cancel')}
              </Button>
              <Button type="submit" variant="primary" isPending={isWorking}>
                {t('settings.agents.createSubmit')}
              </Button>
            </DialogFooter>
          </Form>
        )}
      </Dialog>
    </Modal>
  )
}
