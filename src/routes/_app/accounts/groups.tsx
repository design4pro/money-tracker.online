import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'

import { ErrorPanel } from '#/components/app/shell'
import { useTranslate } from '#/lib/i18n'
import { pageHead } from '#/routes/-lib/page-title'
import { listAccountGroups, listAccounts } from '#/server/fns/accounts'

import { useDataRefresh } from '../-lib/refresh'
import { GroupsScreen } from './-ui/groups-screen'
import { GroupTreeSkeleton } from './-ui/group-states'

import type { Account } from '#/server/db/types'
import type { AccountGroupWithMembers } from '#/server/repos/accounts'

import type { GroupItem } from './-ui/group-rows'

/**
 * `/accounts/groups` - create, rename, re-parent, reorder and delete account groups.
 *
 * The route loads the two responses and hands them to {@link GroupsScreen}, which owns every write.
 * The split is what lets the screen's refusal handling be tested without a router.
 */

export const Route = createFileRoute('/_app/accounts/groups')({
  loader: async (): Promise<ReadonlyArray<GroupItem>> => {
    const [list, groups] = await Promise.all([
      // Archived accounts are listed on purpose: a group holds them too, and a count that skipped
      // them would disagree with what a delete takes out of the group.
      listAccounts({ data: { includeExcluded: true } }),
      listAccountGroups(),
    ])
    return toGroupItems(list.accounts, groups)
  },
  pendingComponent: GroupTreeSkeleton,
  errorComponent: GroupsError,
  head: ({ matches }) => pageHead(matches, (t) => t('accounts.groups.title')),
  component: GroupsRoute,
})

function GroupsError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslate()
  // The error's own message is not printed: it is English, and may name an id or carry SQL.
  return (
    <ErrorPanel
      className="max-w-list"
      title={t('accounts.groups.error.title')}
      body={t('accounts.groups.error.body')}
      onRetry={reset}
    />
  )
}

function GroupsRoute() {
  const t = useTranslate()
  const groups = Route.useLoaderData()
  const router = useRouter()
  const refreshCaches = useDataRefresh()

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/accounts"
        search={{ status: 'active' }}
        className="inline-flex items-center gap-2 self-start text-label text-ink-2 target-min-h focus-ring hover:text-ink"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t('nav.accounts')}
      </Link>
      <GroupsScreen
        groups={groups}
        onRefresh={() => Promise.all([router.invalidate(), refreshCaches()])}
      />
    </div>
  )
}

/**
 * The two server responses as the tree's rows.
 *
 * A group's accounts come in membership order. An id the account list does not hold (it was
 * removed between the two reads) is skipped rather than rendered as a nameless row.
 */
function toGroupItems(
  accounts: ReadonlyArray<Account>,
  groups: ReadonlyArray<AccountGroupWithMembers>,
): ReadonlyArray<GroupItem> {
  const byId = new Map(accounts.map((account) => [account.id, account]))
  return groups.map(({ group, accountIds }) => ({
    id: group.id,
    name: group.name,
    parentId: group.parentId,
    accounts: accountIds.flatMap((id) => {
      const account = byId.get(id)
      return account === undefined
        ? []
        : [
            {
              id: account.id,
              name: account.name,
              isArchived: account.status === 'archived',
            },
          ]
    }),
  }))
}
