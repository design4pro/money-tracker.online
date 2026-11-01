import { useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { z } from 'zod'

import {
  AccountCard,
  AccountEmptyState,
  AccountListSkeleton,
  AccountOverviewCard,
  CurrencyTotalsCard,
  totalsByCurrency,
} from '#/components/app/accounts'
import { SegmentedFilter } from '#/components/app/nav'
import { ErrorPanel } from '#/components/app/shell'
import { Button, Card, buttonVariants, toast } from '#/components/ui'
import { formatNumber, useLocale, useTranslate } from '#/lib/i18n'
import {
  archiveAccount,
  listAccountGroups,
  listAccounts,
  restoreAccount,
} from '#/server/fns/accounts'

import { useDataRefresh } from '../-lib/refresh'
import { AccountActionsMenu } from './-ui/account-actions-menu'
import { AccountFormDialog } from './-ui/account-form-dialog'
import { AdjustBalanceDialog } from './-ui/adjust-balance-dialog'
import { ConfirmDialog } from './-ui/confirm-dialog'

import type { AccountCategory } from '#/server/db/schema'
import type { Account } from '#/server/db/types'
import type { AccountGroupWithMembers } from '#/server/repos/accounts'
import { pageHead } from '#/routes/-lib/page-title'

/**
 * `/accounts` — the list.
 *
 * ## The filter lives in the URL, not in a `useState`
 *
 * `?status=archived` is a bookmark, a back button and a link somebody can send. Holding it in
 * component state would make all three lie: the back button would leave the page instead of
 * leaving the filter, and a reload would silently drop the reader back into a different view from
 * the one they were reading. `loaderDeps` ties the loader to it, so changing the filter refetches
 * without a manual invalidate.
 *
 * ## One request for the figures and the rows
 *
 * `listAccounts` returns the overview totals with the accounts, so the header does not cost a
 * second round trip and cannot disagree with the list beneath it. The groups come alongside it,
 * and grouping is done here rather than server-side because it is presentation: the same two
 * responses would drive a flat list or a board.
 *
 * ## Totals are per currency, and nothing is converted in this component
 *
 * The overview's net worth is converted **by the repository**, at rates it owns. The per-currency
 * card sums each currency in its own units and says so. A component that divided by a rate to
 * fill a gap would be inventing a number, and this file has no rate to divide by on purpose.
 */

const searchSchema = z.object({
  status: z.enum(['active', 'archived', 'all']).default('active'),
})

type StatusFilter = z.infer<typeof searchSchema>['status']

export const Route = createFileRoute('/_app/accounts/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ status: search.status }),
  loader: async ({ deps }) => {
    const [list, groups] = await Promise.all([
      listAccounts({
        data:
          deps.status === 'all'
            ? { includeExcluded: true }
            : { status: deps.status, includeExcluded: true },
      }),
      listAccountGroups(),
    ])
    return { list, groups }
  },
  pendingComponent: AccountListSkeleton,
  errorComponent: AccountsListError,
  head: ({ matches }) => pageHead(matches, (t) => t('accounts.title')),
  component: AccountsListRoute,
})

function AccountsListError({ reset }: { reset: () => void }) {
  const t = useTranslate()
  return (
    <ErrorPanel
      title={t('accounts.error.title')}
      body={t('accounts.error.body')}
      onRetry={reset}
    />
  )
}

/** What the route is currently asking the reader to confirm, if anything. */
type Pending =
  | { kind: 'none' }
  | { kind: 'form'; account: Account | null; category?: AccountCategory }
  | { kind: 'adjust'; account: Account }
  | { kind: 'archive'; account: Account }
  | { kind: 'restore'; account: Account }

function AccountsListRoute() {
  const t = useTranslate()
  const locale = useLocale()
  const { list, groups } = Route.useLoaderData()
  const { status } = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const refreshCaches = useDataRefresh()

  const [pending, setPending] = useState<Pending>({ kind: 'none' })
  const close = () => setPending({ kind: 'none' })

  /**
   * Every write ends here: the loader reruns, so the totals and the rows move together — and the
   * React Query reference set the transaction form holds for five minutes (the account list it
   * offers) is marked stale in the same breath, so a newly created account is selectable
   * immediately rather than after the cache expires.
   */
  const refresh = () => void Promise.all([router.invalidate(), refreshCaches()])

  const { accounts, overview } = list
  const totals = totalsByCurrency(accounts)
  const sections = groupAccounts(
    accounts,
    groups,
    t('accounts.group.ungrouped'),
  )

  function actionsFor(account: Account) {
    return (
      <AccountActionsMenu
        account={account}
        onEdit={() => setPending({ kind: 'form', account })}
        onAdjustBalance={() => setPending({ kind: 'adjust', account })}
        onArchive={() => setPending({ kind: 'archive', account })}
        onRestore={() => setPending({ kind: 'restore', account })}
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/*
        Deliberately not `flex-wrap`. Wrapping put "New account" on a row of its own on a phone,
        and that row plus the overview card was enough to push every single account below the
        fold on the screen whose subject is the accounts. It is a 40px icon-and-label button
        opposite the title at every width; the title block shrinks instead.
      */}
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-title font-bold text-ink">
            {t('accounts.title')}
          </h1>
          <p className="mt-1 max-w-prose text-body text-ink-2">
            {t('accounts.subtitle')}
          </p>
          {/*
            A link under the subtitle rather than a second button beside "New account": the header
            is deliberately one row at every width, and a second 40px button would take the title
            block's room on a phone.
          */}
          <Link
            to="/accounts/groups"
            className={buttonVariants({ variant: 'link', size: 'sm' })}
          >
            {t('accounts.groups.manage')}
          </Link>
        </div>
        <Button
          variant="primary"
          icon={<Plus aria-hidden="true" />}
          onPress={() => setPending({ kind: 'form', account: null })}
        >
          {t('accounts.create')}
        </Button>
      </header>

      {overview.totalAccounts === 0 ? (
        <AccountEmptyState
          onCreate={(category) =>
            setPending({
              kind: 'form',
              account: null,
              ...(category ? { category } : {}),
            })
          }
        />
      ) : (
        <>
          <div className="grid items-start gap-4 lg:grid-cols-[2fr_1fr]">
            <AccountOverviewCard
              overview={overview}
              headingId="accounts-overview"
            />
            {totals.length > 1 ? (
              <CurrencyTotalsCard
                totals={totals}
                headingId="accounts-by-currency"
              />
            ) : null}
          </div>

          {/*
            The filter's band earns its width rather than ending in ~900px of nothing: the
            segmented control keeps the start, the count takes the end. It is a counterweight, not
            a new figure - it counts rows already rendered on this screen against a total the
            loader already returns, so nothing is fetched and nothing is computed twice.

            It appears only while the filter is actually narrowing the list. "Showing 12 of 12
            accounts" tells a reader nothing and takes a line to do it, and on a phone that line
            is an account row pushed below the fold - which is the mistake the `<header>` above
            already records having made once.

            The hairline belongs to this row rather than to the control. `SegmentedFilter` draws
            its own `border-b`, and as a flex item it is only as wide as its three words - so the
            rule that the first group below sits on (`first:border-t-0`, and the comment there)
            would end at x~690 in a 1156px band instead of spanning it.
          */}
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-border-subtle">
            <SegmentedFilter
              className="border-b-0"
              label={t('accounts.filter.label')}
              value={status}
              options={[
                { id: 'active', label: t('accounts.filter.active') },
                { id: 'archived', label: t('accounts.filter.archived') },
                { id: 'all', label: t('accounts.filter.all') },
              ]}
              onChange={(next: StatusFilter) => {
                void navigate({ search: { status: next } })
              }}
            />
            {accounts.length < overview.totalAccounts ? (
              <p className="text-caption text-ink-2">
                {t('accounts.filter.count', {
                  // The plural agrees with the total, so the total drives the branch; `shown` and
                  // `total` arrive pre-formatted because `interpolate` stringifies with `String()`.
                  count: overview.totalAccounts,
                  shown: formatNumber(locale, accounts.length),
                  total: formatNumber(locale, overview.totalAccounts),
                })}
              </p>
            ) : null}
          </div>

          {accounts.length === 0 ? (
            <FilteredEmpty status={status} />
          ) : (
            /* 24px between groups, and nothing between the rows inside one. The group's name
               is written by hand on a rule above its rows - a heading over a body with a
               hairline above it - not typed in caps, and not floating. The first group sits on
               the filter's rule rather than drawing a second one 16px under it. */
            <div className="flex flex-col gap-6">
              {sections.map((section) => (
                <section
                  key={section.id}
                  aria-labelledby={`group-${section.id}`}
                  className="border-t border-border-subtle pt-2 first:border-t-0 first:pt-0"
                >
                  <h2
                    id={`group-${section.id}`}
                    className="mb-2 text-subtitle font-bold text-ink"
                  >
                    {section.name}
                  </h2>
                  {/*
                    One card per group, with the rows divided by a hairline they draw themselves
                    (`border-t` on every row but the first). No `overflow-hidden`: a focus ring in
                    this product is an `outline`, and nothing may clip one — the rows round their
                    own first and last corners instead.
                  */}
                  <ul className="rounded-xl border border-border-subtle bg-surface shadow-card">
                    {section.accounts.map((account) => (
                      <AccountCard
                        key={account.id}
                        account={account}
                        baseCurrencyCode={overview.baseCurrencyCode}
                        actions={actionsFor(account)}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      {pending.kind === 'form' ? (
        <AccountFormDialog
          key={pending.account?.id ?? 'new'}
          isOpen
          onOpenChange={(open) => {
            if (!open) close()
          }}
          account={pending.account}
          {...(pending.category ? { initialCategory: pending.category } : {})}
          currencyOptions={currencyOptions(overview.baseCurrencyCode, accounts)}
          baseCurrencyCode={overview.baseCurrencyCode}
          onSaved={(saved, mode) => {
            toast.success(
              t(
                mode === 'created'
                  ? 'accounts.toast.created'
                  : 'accounts.toast.updated',
                {
                  name: saved.name,
                },
              ),
            )
            close()
            void refresh()
          }}
        />
      ) : null}

      {pending.kind === 'adjust' ? (
        <AdjustBalanceDialog
          key={pending.account.id}
          isOpen
          onOpenChange={(open) => {
            if (!open) {
              close()
              void refresh()
            }
          }}
          account={pending.account}
          onRecorded={() => void refresh()}
        />
      ) : null}

      {pending.kind === 'archive' ? (
        <ConfirmDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) close()
          }}
          title={t('accounts.archive.title', { name: pending.account.name })}
          body={t('accounts.archive.body')}
          confirmLabel={t('accounts.archive.action')}
          errorTitle={t('accounts.error.title')}
          errorBody={t('accounts.error.body')}
          onConfirm={async () => {
            const name = pending.account.name
            await archiveAccount({ data: { accountId: pending.account.id } })
            toast.success(t('accounts.toast.archived', { name }))
            close()
            void refresh()
          }}
        />
      ) : null}

      {pending.kind === 'restore' ? (
        <ConfirmDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) close()
          }}
          title={t('accounts.restore.action')}
          body={t('accounts.archive.body')}
          confirmLabel={t('accounts.restore.action')}
          errorTitle={t('accounts.error.title')}
          errorBody={t('accounts.error.body')}
          onConfirm={async () => {
            const name = pending.account.name
            await restoreAccount({ data: { accountId: pending.account.id } })
            toast.success(t('accounts.toast.restored', { name }))
            close()
            void refresh()
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * The list is empty but the workspace is not — so this is a filter result, not a first run.
 *
 * Saying "no accounts yet" here would be a lie that sends somebody looking for a bug. The two
 * cases get their own sentences, and each names the way out.
 */
function FilteredEmpty({ status }: { status: StatusFilter }) {
  const t = useTranslate()
  const isArchived = status === 'archived'
  return (
    <Card variant="inset" className="text-center">
      <p className="text-subtitle font-semibold text-ink">
        {t(
          isArchived
            ? 'accounts.archived.empty.title'
            : 'accounts.active.empty.title',
        )}
      </p>
      <p className="mx-auto mt-2 prose-measure text-body text-ink-2">
        {t(
          isArchived
            ? 'accounts.archived.empty.body'
            : 'accounts.active.empty.body',
        )}
      </p>
    </Card>
  )
}

interface Section {
  readonly id: string
  readonly name: string
  readonly accounts: ReadonlyArray<Account>
}

/**
 * Splits the accounts into their groups, keeping each group's own order.
 *
 * An account can be a member of more than one group in the data model; it is shown under the
 * first that claims it, because the same balance appearing twice in a list of balances reads as
 * money that exists twice. Anything unclaimed lands in "Not in a group", which is only drawn when
 * something is actually in it.
 */
function groupAccounts(
  accounts: ReadonlyArray<Account>,
  groups: ReadonlyArray<AccountGroupWithMembers>,
  ungroupedName: string,
): ReadonlyArray<Section> {
  const byId = new Map(accounts.map((account) => [account.id, account]))
  const claimed = new Set<string>()
  const sections: Array<Section> = []

  for (const entry of groups) {
    const members: Array<Account> = []
    for (const id of entry.accountIds) {
      const account = byId.get(id)
      if (account !== undefined && !claimed.has(id)) {
        claimed.add(id)
        members.push(account)
      }
    }
    if (members.length > 0) {
      sections.push({
        id: entry.group.id,
        name: entry.group.name,
        accounts: members,
      })
    }
  }

  const rest = accounts.filter((account) => !claimed.has(account.id))
  if (rest.length > 0) {
    sections.push({ id: 'ungrouped', name: ungroupedName, accounts: rest })
  }
  return sections
}

/**
 * The currencies the form may offer: the base, plus every currency already in use.
 *
 * Each of those is necessarily one the workspace holds a rate for, so the picker cannot produce a
 * `CurrencyNotHeldError`. When the workspace-currency server function lands, this is the function
 * it replaces.
 */
function currencyOptions(
  baseCurrencyCode: string,
  accounts: ReadonlyArray<Account>,
): ReadonlyArray<string> {
  const codes = new Set<string>([baseCurrencyCode])
  for (const account of accounts) {
    codes.add(account.currencyCode)
  }
  return [...codes].sort((left, right) => left.localeCompare(right))
}
