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
  Radio,
  RadioGroup,
  TextField,
} from '#/components/ui'
import { useTranslate } from '#/lib/i18n'

import type { FormEvent } from 'react'

/**
 * Invite one address into the workspace.
 *
 * ## The role is a radio group, not a select
 *
 * There are two choices and each needs a sentence explaining what it lets somebody do to a
 * household's money. A `select` hides both sentences behind a click; a radio group states them
 * where the decision is made, and it is one tab stop with arrow keys inside it.
 *
 * ## The failure stays in the dialog
 *
 * "That address already has an invitation waiting" and "this plan has no seat left" are facts the
 * person has to read and act on, so they render in the dialog beside the form and wait, rather than
 * appearing as a toast that vanishes while they are still reading the address they typed.
 */

export type InviteRole = 'admin' | 'member'

export interface InviteDialogProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  /** Resolves when the invitation is away; rejects with the message the dialog shows. */
  onInvite: (input: { email: string; role: InviteRole }) => Promise<unknown>
}

export function InviteDialog({
  isOpen,
  onOpenChange,
  onInvite,
}: InviteDialogProps) {
  const t = useTranslate()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<InviteRole>('member')
  const [isWorking, setWorking] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>, close: () => void) {
    event.preventDefault()
    setWorking(true)
    setFailure(null)
    try {
      await onInvite({ email, role })
      setEmail('')
      setRole('member')
      close()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setWorking(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="sm">
      <Dialog>
        {({ close }) => (
          <Form onSubmit={(event) => void submit(event, close)}>
            <DialogHeader
              title={t('members.invite.title')}
              description={t('members.invite.description')}
              closeLabel={t('action.close')}
              onClose={close}
            />
            <DialogBody className="flex flex-col gap-5">
              <TextField
                isRequired
                type="email"
                autoComplete="email"
                label={t('members.invite.email')}
                value={email}
                onChange={setEmail}
              />

              <RadioGroup
                label={t('members.invite.role')}
                value={role}
                onChange={(next) => setRole(next as InviteRole)}
              >
                <Radio
                  value="member"
                  description={t('members.role.description.member')}
                >
                  {t('app.workspace.role.member')}
                </Radio>
                <Radio
                  value="admin"
                  description={t('members.role.description.admin')}
                >
                  {t('app.workspace.role.admin')}
                </Radio>
              </RadioGroup>

              {failure === null ? null : (
                <ErrorPanel
                  title={t('members.error.title')}
                  body={t('members.error.generic')}
                  detail={failure}
                />
              )}
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onPress={close}>
                {t('action.cancel')}
              </Button>
              <Button type="submit" variant="primary" isPending={isWorking}>
                {t('members.invite.submit')}
              </Button>
            </DialogFooter>
          </Form>
        )}
      </Dialog>
    </Modal>
  )
}
