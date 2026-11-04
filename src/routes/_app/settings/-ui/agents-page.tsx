import { useState } from 'react'

import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Cell,
  Column,
  EmptyState,
  Link,
  Row,
  Table,
  TableBody,
  TableContainer,
  TableHeader,
  toast,
} from '#/components/ui'
import { scopeMessageKey } from '#/lib/agent-scopes'
import { useLocale, useTranslate } from '#/lib/i18n'
import { formatCalendarDate } from '#/lib/i18n/format'

import { ConfirmDialog } from '../../accounts/-ui/confirm-dialog'
import { utcDay } from './format-day'
import { MintTokenDialog } from './mint-token-dialog'

import type { AgentsPageView } from '#/server/fns/agent-grants'
import type { AgentGrantView, MintedPat } from '#/server/repos/agent-grants'
import type { AgentScope } from '#/lib/agent-scopes'
import type { MessageKey } from '#/lib/i18n'

const KIND_LABEL: Readonly<Record<'pat' | 'oauth', MessageKey>> = {
  pat: 'settings.agents.kind.pat',
  oauth: 'settings.agents.kind.oauth',
}

export interface AgentsPageProps {
  page: AgentsPageView
  onMint: (input: {
    name: string
    scopes: ReadonlyArray<AgentScope>
  }) => Promise<MintedPat>
  onRevoke: (grantId: string) => Promise<unknown>
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

export function AgentsPage({ page, onMint, onRevoke }: AgentsPageProps) {
  const t = useTranslate()
  const locale = useLocale()
  const [isMintOpen, setMintOpen] = useState(false)
  const [secret, setSecret] = useState<string | null>(null)
  const [pending, setPending] = useState<AgentGrantView | null>(null)

  const grants = page.kind === 'member' ? [] : page.grants

  async function mint(input: {
    name: string
    scopes: ReadonlyArray<AgentScope>
  }): Promise<MintedPat> {
    const minted = await onMint(input)
    setSecret(minted.secret)
    return minted
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-micro tracking-label uppercase text-ink-2">
          {t('settings.scope.workspace')}
        </p>
        <h1 className="text-title font-bold text-ink">
          {t('settings.agents.title')}
        </h1>
        <p className="max-w-[68ch] text-body text-ink-2">
          {t('settings.agents.subtitle')}
        </p>
      </header>

      {page.kind === 'member' ? (
        <EmptyState headingLevel={2} title={t('settings.agents.membersOnly')} />
      ) : null}

      {page.kind === 'locked' ? (
        <Card padding="lg" as="section">
          <CardHeader headingLevel={2} title={t('settings.agents.locked')} />
          <CardBody>
            <Link href="/settings/billing">
              {t('settings.agents.locked.cta')}
            </Link>
          </CardBody>
        </Card>
      ) : null}

      {page.kind === 'member' ? null : (
        <>
          <Card padding="lg" as="section">
            <CardHeader headingLevel={2} title={t('settings.agents.mcpUrl')} />
            <CardBody className="flex flex-wrap items-center gap-3">
              <code className="min-w-0 break-all text-caption text-ink">
                {page.mcpUrl}
              </code>
              <CopyButton value={page.mcpUrl} />
            </CardBody>
          </Card>

          {secret === null ? null : <TokenOnceFlash secret={secret} />}

          {page.kind === 'ready' ? (
            <div>
              <Button variant="primary" onPress={() => setMintOpen(true)}>
                {t('settings.agents.createToken')}
              </Button>
            </div>
          ) : null}

          {grants.length === 0 ? (
            <EmptyState headingLevel={2} title={t('settings.agents.empty')} />
          ) : (
            <TableContainer>
              <Table aria-label={t('settings.agents.list.label')}>
                <TableHeader>
                  <Column isRowHeader>
                    {t('settings.agents.column.name')}
                  </Column>
                  <Column>{t('settings.agents.column.kind')}</Column>
                  <Column>{t('settings.agents.column.scopes')}</Column>
                  <Column>{t('settings.agents.column.lastUsed')}</Column>
                  <Column>{t('settings.agents.revoke')}</Column>
                </TableHeader>
                <TableBody>
                  {grants.map((grant) => (
                    <Row key={grant.id}>
                      <Cell>
                        <span className="font-medium text-ink">
                          {grant.name}
                        </span>
                        {grant.tokenPrefix === null ? null : (
                          <span className="mt-0.5 block text-caption text-ink-2">
                            {grant.tokenPrefix}
                          </span>
                        )}
                      </Cell>
                      <Cell>
                        <Badge tone="neutral">
                          {t(
                            grant.kind === 'oauth'
                              ? KIND_LABEL.oauth
                              : KIND_LABEL.pat,
                          )}
                        </Badge>
                      </Cell>
                      <Cell>
                        <ul className="flex flex-col gap-0.5">
                          {grant.scopes.map((scope) => (
                            <li key={scope}>{t(scopeMessageKey(scope))}</li>
                          ))}
                        </ul>
                      </Cell>
                      <Cell>
                        {grant.lastUsedAt == null
                          ? t('settings.agents.neverUsed')
                          : formatCalendarDate(
                              locale,
                              utcDay(asDate(grant.lastUsedAt)),
                            )}
                      </Cell>
                      <Cell align="end">
                        <Button
                          variant="danger"
                          size="sm"
                          onPress={() => setPending(grant)}
                        >
                          {t('settings.agents.revoke')}
                        </Button>
                      </Cell>
                    </Row>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </>
      )}

      <MintTokenDialog
        isOpen={isMintOpen}
        onOpenChange={setMintOpen}
        onMint={mint}
      />

      <ConfirmDialog
        isOpen={pending !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setPending(null)
        }}
        title={t('settings.agents.revoke.title', {
          name: pending?.name ?? '',
        })}
        body={t('settings.agents.revoke.body')}
        confirmLabel={t('settings.agents.revoke.confirm')}
        isDestructive
        errorTitle={t('settings.agents.error.title')}
        errorBody={t('empty.error.body')}
        onConfirm={async () => {
          if (pending === null) return
          await onRevoke(pending.id)
          toast.success(t('settings.agents.revoked', { name: pending.name }))
        }}
      />
    </div>
  )
}

function TokenOnceFlash({ secret }: { readonly secret: string }) {
  const t = useTranslate()
  return (
    <Card
      padding="lg"
      as="section"
      aria-label={t('settings.agents.tokenOnce')}
      className="border-warning/40 bg-warning-soft"
    >
      <CardBody className="flex flex-col gap-3">
        <p className="text-body text-ink">{t('settings.agents.tokenOnce')}</p>
        <code className="break-all text-caption text-ink">{secret}</code>
        <CopyButton value={secret} />
      </CardBody>
    </Card>
  )
}

function CopyButton({ value }: { readonly value: string }) {
  const t = useTranslate()
  const [copied, setCopied] = useState(false)

  return (
    <Button
      variant="secondary"
      size="sm"
      onPress={() => {
        void navigator.clipboard.writeText(value).then(
          () => {
            setCopied(true)
            toast.success(t('action.copied'))
          },
          () => {
            toast.error(t('failure.reference.copyFailed'))
          },
        )
      }}
    >
      {copied ? t('action.copied') : t('action.copy')}
    </Button>
  )
}
