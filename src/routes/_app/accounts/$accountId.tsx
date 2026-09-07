import { useMemo, useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { z } from 'zod'

import {
  AccountAvatar,
  AccountCategoryBadge,
  AccountDetailSkeleton,
  AccountStateBadges,
  Amount,
  CreditUtilisation,
  ErrorPanel,
} from '#/components/app/accounts'
import {
  Button,
  Card,
  Separator,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  toast,
} from '#/components/ui'
import { useLocale, useTranslate } from '#/lib/i18n'
import {
  archiveAccount,
  deleteAccount,
  restoreAccount,
} from '#/server/fns/accounts'
import { pageHead } from '#/routes/-lib/page-title'

import { useDataRefresh } from '../-lib/refresh'
import { EMPTY_SEARCH } from '../transactions/-lib/filters'
import { TransactionsScreen } from '../transactions/-ui/transactions-screen'
import { loadAccountDetail } from './-server/detail'
import { AccountActionsMenu } from './-ui/account-actions-menu'
import { AccountFormDialog } from './-ui/account-form-dialog'
import { AdjustBalanceDialog } from './-ui/adjust-balance-dialog'
import { ConfirmDialog } from './-ui/confirm-dialog'

import type { Key } from 'react-aria-components'
import type { TransactionPolicies } from '#/server/repos/transactions'
import type { TransactionSearch } from '../transactions/-lib/filters'

/**
 * `/accounts/$accountId` — one account.
 *
 * ## Delete is offered here and nowhere else
 *
 * `deleteAccount` refuses while any transaction points at the account, and this is the only screen
 * that knows the count. Offering the action on the list would mean offering one that may simply
 * refuse; here the confirmation can say "there are 42 transactions on this account, archive it
 * instead" *before* the press rather than after it, and archiving is one control away.
 *
 * ## The tab is in the URL
 *
 * Settings is a link somebody sends and a place the back button returns to. `?tab=settings`
 * costs one search param and buys all of that; a `useState` would make the back button leave the
 * account instead of leaving the tab.
 *
 * ## The passbook is the overview
 *
 * The overview tab is this account's page of the passbook: the same ledger as `/transactions`,
 * narrowed to the account and with the balance after every line, which the all-accounts ledger
 * cannot print because it mixes currencies. Planned lines are included here, in pencil, because a
 * passbook is read forward as well as back. Its sort lives in component state rather than the
 * URL: the tab already holds the address, and a second search param for the order of one panel
 * would give the back button two things to undo on one screen.
 */

const PASSBOOK_POLICIES: TransactionPolicies = {
  planned: 'include',
  adjustments: 'include',
  transfers: 'include',
  completeness: 'any',
}

const searchSchema = z.object({
  tab: z.enum(['overview', 'settings']).default('overview'),
})

export const Route = createFileRoute('/_app/accounts/$accountId')({
  validateSearch: searchSchema,
  loader: ({ params }) =>
    loadAccountDetail({ data: { accountId: params.accountId } }),
  pendingComponent: AccountDetailSkeleton,
  errorComponent: AccountDetailError,
  head: ({ matches, loaderData }) =>
    pageHead(matches, (t) => loaderData?.account.name ?? t('accounts.title')),
  component: AccountDetailRoute,
})

function AccountDetailError({
  error,
  reset,
}: {
  error: Error
  reset: () => void
}) {
  const t = useTranslate()
  return (
    <ErrorPanel
      title={t('accounts.detail.error.title')}
      body={t('accounts.error.body')}
      detail={error.message}
      onRetry={reset}
    />
  )
}

type Pending = 'none' | 'form' | 'adjust' | 'archive' | 'restore' | 'delete'

function AccountDetailRoute() {
  const t = useTranslate()
  const locale = useLocale()
  const router = useRouter()
  const refreshCaches = useDataRefresh()
  const { account, groupNames, transactionCount, baseCurrencyCode } =
    Route.useLoaderData()
  const { tab } = Route.useSearch()
  const navigate = Route.useNavigate()

  const [pending, setPending] = useState<Pending>('none')
  const [ledgerSearch, setLedgerSearch] =
    useState<TransactionSearch>(EMPTY_SEARCH)
  const passbookFilters = useMemo(
    () => ({ accountIds: [account.id] }),
    [account.id],
  )
  const close = () => setPending('none')
  const refresh = () => void Promise.all([router.invalidate(), refreshCaches()])

  const isArchived = account.status === 'archived'
  const canDelete = transactionCount === 0
  const isForeign = account.currencyCode !== baseCurrencyCode

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/accounts"
        search={{ status: isArchived ? 'archived' : 'active' }}
        className="inline-flex items-center gap-2 self-start text-label text-ink-2 target-min-h focus-ring hover:text-ink"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t('nav.accounts')}
      </Link>

      <Card as="header" className="flex flex-col gap-5">
        <div className="flex items-start gap-3">
          <AccountAvatar
            name={account.name}
            locale={locale}
            initials={account.logoInitials}
            color={account.logoColor}
            size="lg"
          />
          <div className="min-w-0 flex-1">
            <h1 className="text-title font-bold text-ink">{account.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <AccountCategoryBadge category={account.category} />
              <AccountStateBadges
                status={account.status}
                excludeFromStats={account.excludeFromStats}
              />
              {groupNames.map((name) => (
                <span key={name} className="text-caption text-ink-2">
                  {name}
                </span>
              ))}
            </div>
          </div>
          <AccountActionsMenu
            account={account}
            onEdit={() => setPending('form')}
            onAdjustBalance={() => setPending('adjust')}
            onArchive={() => setPending('archive')}
            onRestore={() => setPending('restore')}
            onDelete={() => setPending('delete')}
          />
        </div>

        <div>
          <p className="text-micro tracking-label uppercase text-ink-2">
            {t('accounts.detail.balanceToday')}
          </p>
          <p className="mt-1">
            <Amount
              locale={locale}
              amountMinor={account.currentBalanceMinor}
              currencyCode={account.currencyCode}
              size="xl"
              tone="value"
            />
          </p>
          {isForeign ? (
            <p className="mt-1 text-caption text-ink-2">
              {t('accounts.balance.inBase', { currency: baseCurrencyCode })}{' '}
              <Amount
                locale={locale}
                amountMinor={account.refCurrentBalanceMinor}
                currencyCode={baseCurrencyCode}
                size="sm"
              />
            </p>
          ) : null}
        </div>

        {account.creditLimitMinor === null ? null : (
          <CreditUtilisation
            balanceMinor={account.currentBalanceMinor}
            limitMinor={account.creditLimitMinor}
            currencyCode={account.currencyCode}
          />
        )}
      </Card>

      <Tabs
        selectedKey={tab}
        onSelectionChange={(key: Key) => {
          void navigate({ search: { tab: key as 'overview' | 'settings' } })
        }}
      >
        <TabList aria-label={t('accounts.title')}>
          <Tab id="overview">{t('accounts.detail.tab.overview')}</Tab>
          <Tab id="settings">{t('accounts.detail.tab.settings')}</Tab>
        </TabList>

        <TabPanel id="overview">
          <div className="flex flex-col gap-6">
            <TransactionsScreen
              policies={PASSBOOK_POLICIES}
              search={ledgerSearch}
              onSearchChange={(next) => setLedgerSearch(next)}
              fixedFilters={passbookFilters}
              hasBalance
              showFilterBar={false}
              showSummary={false}
              emptyState={
                <p className="text-body text-ink-2">
                  {t('accounts.detail.ledger.empty')}
                </p>
              }
            />
            <section className="border-t border-border-subtle pt-4">
              <h2 className="text-micro tracking-label uppercase text-ink-2">
                {t('common.note')}
              </h2>
              <p className="mt-1 prose-measure text-body text-ink">
                {account.note ?? t('accounts.detail.note.empty')}
              </p>
            </section>
          </div>
        </TabPanel>

        <TabPanel id="settings">
          <div className="flex flex-col gap-4">
            <Card className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-body text-ink-2">
                {t('accounts.balance.adjust.help')}
              </p>
              <Button variant="secondary" onPress={() => setPending('adjust')}>
                {t('accounts.balance.adjust')}
              </Button>
            </Card>

            <Card className="flex flex-col gap-4">
              <h2 className="text-subtitle font-semibold text-ink">
                {t('accounts.detail.danger')}
              </h2>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <p className="prose-measure text-body text-ink-2">
                  {t('accounts.archive.body')}
                </p>
                <Button
                  variant="secondary"
                  onPress={() => setPending(isArchived ? 'restore' : 'archive')}
                >
                  {t(
                    isArchived
                      ? 'accounts.restore.action'
                      : 'accounts.archive.action',
                  )}
                </Button>
              </div>
              <Separator />
              <div className="flex flex-wrap items-center justify-between gap-4">
                {/*
                  The blocking reason is stated here, not held back until the press. Somebody who
                  cannot delete this account should learn it from the page, decide, and reach for
                  archive — not press a button and be told no.
                */}
                <p className="prose-measure text-body text-ink-2">
                  {canDelete
                    ? t('accounts.delete.confirm', { name: account.name })
                    : t('accounts.delete.blocked', { count: transactionCount })}
                </p>
                <Button
                  variant="danger"
                  isDisabled={!canDelete}
                  onPress={() => setPending('delete')}
                >
                  {t('accounts.delete.action')}
                </Button>
              </div>
            </Card>
          </div>
        </TabPanel>
      </Tabs>

      {pending === 'form' ? (
        <AccountFormDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) close()
          }}
          account={account}
          currencyOptions={[
            ...new Set([baseCurrencyCode, account.currencyCode]),
          ].sort((left, right) => left.localeCompare(right))}
          baseCurrencyCode={baseCurrencyCode}
          onSaved={(saved) => {
            toast.success(t('accounts.toast.updated', { name: saved.name }))
            close()
            void refresh()
          }}
        />
      ) : null}

      {pending === 'adjust' ? (
        <AdjustBalanceDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) {
              close()
              void refresh()
            }
          }}
          account={account}
          onRecorded={() => void refresh()}
        />
      ) : null}

      {pending === 'archive' || pending === 'restore' ? (
        <ConfirmDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) close()
          }}
          title={
            pending === 'archive'
              ? t('accounts.archive.title', { name: account.name })
              : t('accounts.restore.action')
          }
          body={t('accounts.archive.body')}
          confirmLabel={t(
            pending === 'archive'
              ? 'accounts.archive.action'
              : 'accounts.restore.action',
          )}
          errorTitle={t('accounts.error.title')}
          errorBody={t('accounts.error.body')}
          onConfirm={async () => {
            const isArchiving = pending === 'archive'
            const call = isArchiving ? archiveAccount : restoreAccount
            await call({ data: { accountId: account.id } })
            toast.success(
              t(
                isArchiving
                  ? 'accounts.toast.archived'
                  : 'accounts.toast.restored',
                { name: account.name },
              ),
            )
            close()
            void refresh()
          }}
        />
      ) : null}

      {pending === 'delete' ? (
        <ConfirmDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) close()
          }}
          title={t('accounts.delete.title', { name: account.name })}
          body={t('accounts.delete.confirm', { name: account.name })}
          confirmLabel={t('accounts.delete.action')}
          isDestructive
          errorTitle={t('accounts.error.title')}
          errorBody={t('accounts.delete.blocked', { count: transactionCount })}
          onConfirm={async () => {
            await deleteAccount({ data: { accountId: account.id } })
            toast.success(t('accounts.toast.deleted', { name: account.name }))
            close()
            await navigate({ to: '/accounts', search: { status: 'active' } })
          }}
        />
      ) : null}
    </div>
  )
}
