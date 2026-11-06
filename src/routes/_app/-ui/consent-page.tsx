import { useId, useLayoutEffect, useRef, useState } from 'react'

import {
  AgentScopePicker,
  selectedAgentScopes,
} from '#/components/app/agent-scope-picker'
import { ErrorPanel, FailurePanel } from '#/components/app/shell'
import { Button, Card, CardBody } from '#/components/ui'
import { READ_SCOPES } from '#/lib/agent-scopes'
import { failureOf } from '#/lib/failure'
import { useTranslate } from '#/lib/i18n'

import type { FailureEnvelope } from '#/lib/failure-envelope'
import type { ConsentPageView } from '#/server/fns/agent-grants'
import type { AgentScope } from '#/lib/agent-scopes'

export interface ConsentPageProps {
  consent: ConsentPageView
  clientId: string
  onAllow: (input: {
    name: string
    clientId: string
    scopes: ReadonlyArray<AgentScope>
  }) => Promise<void>
  onDecide: (accept: boolean) => Promise<void>
}

export function ConsentPage({
  consent,
  clientId,
  onAllow,
  onDecide,
}: ConsentPageProps) {
  const t = useTranslate()
  const headingId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [scopes, setScopes] = useState<ReadonlyArray<string>>([...READ_SCOPES])
  const [isWorking, setIsWorking] = useState(false)
  const [failure, setFailure] = useState<FailureEnvelope | null>(null)

  const trimmedClientId = clientId.trim()
  const clientName =
    trimmedClientId.length > 0 ? trimmedClientId : t('common.unknown')
  const selected = selectedAgentScopes(scopes)

  useLayoutEffect(() => {
    headingRef.current?.focus()
  }, [])

  if (!consent.canManage) {
    return (
      <Card padding="lg" as="section">
        <CardBody>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-title font-bold text-ink outline-hidden"
          >
            {t('settings.agents.membersOnly')}
          </h1>
        </CardBody>
      </Card>
    )
  }

  if (trimmedClientId.length === 0) {
    return (
      <ErrorPanel
        mode="region"
        title={t('oauth.consent.error.title')}
        body={t('oauth.consent.missingClient')}
      />
    )
  }

  async function finish(accept: boolean) {
    setIsWorking(true)
    setFailure(null)
    try {
      if (accept) {
        if (selected.length === 0) return
        await onAllow({
          name: clientName.slice(0, 80),
          clientId: trimmedClientId,
          scopes: selected,
        })
      }
      await onDecide(accept)
    } catch (error) {
      setFailure(failureOf(error))
    } finally {
      setIsWorking(false)
    }
  }

  return (
    <Card padding="lg" as="section" aria-labelledby={headingId}>
      <CardBody className="flex max-w-[36rem] flex-col gap-5">
        <h1
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="text-title font-bold text-ink outline-hidden"
        >
          {t('oauth.consent.title', { clientName })}
        </h1>
        <p className="text-body text-ink-2">
          {t('oauth.consent.body', {
            workspaceName: consent.workspaceName,
          })}
        </p>
        <AgentScopePicker
          isRequired
          label={t('oauth.consent.requested')}
          description={t('oauth.consent.scopeHint')}
          value={scopes}
          onChange={setScopes}
        />
        <p className="text-caption text-ink-2">
          {t('oauth.consent.revokeHint')}
        </p>
        {consent.mcpEnabled ? null : (
          <p className="text-body text-ink">{t('settings.agents.locked')}</p>
        )}
        {failure === null ? null : (
          <FailurePanel
            failure={failure}
            placement="after-action"
            title={t('oauth.consent.error.title')}
          />
        )}
        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            size="lg"
            isPending={isWorking}
            onPress={() => void finish(false)}
          >
            {t('oauth.consent.deny')}
          </Button>
          <Button
            variant="primary"
            size="lg"
            isPending={isWorking}
            isDisabled={!consent.mcpEnabled || selected.length === 0}
            onPress={() => void finish(true)}
          >
            {t('oauth.consent.allow')}
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}
