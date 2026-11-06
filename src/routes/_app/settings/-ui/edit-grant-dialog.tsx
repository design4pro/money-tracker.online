import { useState } from 'react'

import {
  AgentScopePicker,
  selectedAgentScopes,
} from '#/components/app/agent-scope-picker'
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
import { failureOf } from '#/lib/failure'
import { useLocale, useTranslate } from '#/lib/i18n'
import { formatCalendarDate } from '#/lib/i18n/format'

import { utcDay } from './format-day'

import type { FailureEnvelope } from '#/lib/failure-envelope'
import type { AgentScope } from '#/lib/agent-scopes'
import type { AgentGrantView } from '#/server/repos/agent-grants'
import type { FormEvent } from 'react'
import type { MessageKey } from '#/lib/i18n'

const KIND_LABEL: Readonly<Record<'pat' | 'oauth', MessageKey>> = {
  pat: 'settings.agents.kind.pat',
  oauth: 'settings.agents.kind.oauth',
}

export interface EditGrantDialogProps {
  grant: AgentGrantView | null
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  onUpdate: (input: {
    grantId: string
    name: string
    scopes: ReadonlyArray<AgentScope>
  }) => Promise<unknown>
}

export function EditGrantDialog({
  grant,
  isOpen,
  onOpenChange,
  onUpdate,
}: EditGrantDialogProps) {
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="md">
      <Dialog>
        {({ close }) =>
          grant === null ? null : (
            <EditGrantForm
              key={grant.id}
              grant={grant}
              close={close}
              onUpdate={onUpdate}
            />
          )
        }
      </Dialog>
    </Modal>
  )
}

function EditGrantForm({
  grant,
  close,
  onUpdate,
}: {
  readonly grant: AgentGrantView
  readonly close: () => void
  readonly onUpdate: EditGrantDialogProps['onUpdate']
}) {
  const t = useTranslate()
  const locale = useLocale()
  const [name, setName] = useState(grant.name)
  const [scopes, setScopes] = useState<ReadonlyArray<string>>([...grant.scopes])
  const [scopesError, setScopesError] = useState(false)
  const [isWorking, setIsWorking] = useState(false)
  const [failure, setFailure] = useState<FailureEnvelope | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const selected = selectedAgentScopes(scopes)
    if (selected.length === 0) {
      setScopesError(true)
      return
    }
    setScopesError(false)
    setIsWorking(true)
    setFailure(null)
    try {
      await onUpdate({ grantId: grant.id, name, scopes: selected })
      close()
    } catch (error) {
      setFailure(failureOf(error))
    } finally {
      setIsWorking(false)
    }
  }

  const lastUsed =
    grant.lastUsedAt == null
      ? t('settings.agents.neverUsed')
      : formatCalendarDate(locale, utcDay(asDate(grant.lastUsedAt)))

  return (
    <Form onSubmit={(event) => void submit(event)} className="contents">
      <DialogHeader
        title={t('settings.agents.edit.title', { name: grant.name })}
        closeLabel={t('action.close')}
        onClose={close}
      />
      <DialogBody className="flex flex-col gap-5">
        <p className="text-caption text-ink-2">
          {t(grant.kind === 'oauth' ? KIND_LABEL.oauth : KIND_LABEL.pat)}
          {grant.tokenPrefix === null ? null : ` · ${grant.tokenPrefix}`}
          {` · ${t('settings.agents.column.lastUsed')} ${lastUsed}`}
        </p>
        <TextField
          isRequired
          label={t('settings.agents.tokenName')}
          value={name}
          onChange={setName}
          autoComplete="off"
        />
        <AgentScopePicker
          label={t('settings.agents.scopesLabel')}
          value={scopes}
          onChange={(next) => {
            setScopes(next)
            if (selectedAgentScopes(next).length > 0) setScopesError(false)
          }}
          errorMessage={
            scopesError ? t('settings.agents.edit.scopesRequired') : undefined
          }
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
          {t('action.save')}
        </Button>
      </DialogFooter>
    </Form>
  )
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}
