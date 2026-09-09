import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { MoreHorizontal, UserPlus } from 'lucide-react'

import { ErrorPanel } from '#/components/app/accounts'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Cell,
  Column,
  Link,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  Row,
  Skeleton,
  Table,
  TableBody,
  TableContainer,
  TableHeader,
  toast,
} from '#/components/ui'
import { UNLIMITED } from '#/lib/plans'
import { useLocale, useTranslate } from '#/lib/i18n'
import { formatCalendarDate, formatNumber } from '#/lib/i18n/format'
import {
  changeMemberRole,
  inviteMember,
  leaveWorkspace,
  loadMembers,
  removeMember,
  resendInvitation,
  revokeInvitation,
} from '#/server/fns/members'

import { ConfirmDialog } from '../accounts/-ui/confirm-dialog'
import { utcDay } from './-ui/format-day'
import { InviteDialog } from './-ui/invite-dialog'

import type { WorkspaceRole } from '#/components/app/shell'
import type { MessageKey } from '#/lib/i18n'
import type { WorkspaceMember } from '#/server/repos/members'
import { pageHead } from '#/routes/-lib/page-title'

/**
 * `/settings/members` — who shares this household, and who may change that.
 *
 * ## A real table, because it is one
 *
 * Four columns of the same four facts per person. A stack of divs would lose the row headers a
 * screen reader navigates by, and the name is the row header here: "Remove Anna Kowalska" is what
 * every action must be announced as, never a bare "Remove" repeated eight times down the column.
 *
 * ## Pending invitations are their own group
 *
 * An invited person is not a member — they hold a seat and nothing else — so they sit in a separate
 * section with the day the link dies, and the two actions that make sense there: send it again, or
 * withdraw it.
 *
 * ## The seat figure comes from the resolver
 *
 * `seatsUsed` counts memberships **plus** pending invitations, which is what the invite path meters
 * against. Counting members here instead would let the screen say "3 of 6" while the server refuses
 * the fourth invitation, and a person told two different numbers by one product trusts neither.
 */

export const Route = createFileRoute('/_app/settings/members')({
  loader: async () => ({ members: await loadMembers() }),
  pendingComponent: MembersSkeleton,
  errorComponent: MembersError,
  head: ({ matches }) => pageHead(matches, (t) => t('members.title')),
  component: MembersRoute,
})

function MembersSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden="true">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

function MembersError({ error, reset }: { error: Error; reset: () => void }) {
  const t = useTranslate()
  return (
    <ErrorPanel
      title={t('members.error.title')}
      body={t('empty.error.body')}
      detail={error.message}
      onRetry={reset}
    />
  )
}

const ROLE_LABEL: Readonly<Record<WorkspaceRole, MessageKey>> = {
  owner: 'app.workspace.role.owner',
  admin: 'app.workspace.role.admin',
  member: 'app.workspace.role.member',
}

type Pending =
  | { kind: 'none' }
  | { kind: 'invite' }
  | { kind: 'remove'; member: WorkspaceMember }
  | { kind: 'leave' }

function MembersRoute() {
  const t = useTranslate()
  const locale = useLocale()
  const { members } = Route.useLoaderData()
  const { shell } = Route.useRouteContext()
  const router = useRouter()
  const [pending, setPending] = useState<Pending>({ kind: 'none' })

  const canManage = members.role !== 'member'
  const seatsLeft = members.seatLimit - members.seatsUsed
  const close = () => setPending({ kind: 'none' })
  const refresh = () => void router.invalidate()

  const day = (value: Date) => formatCalendarDate(locale, utcDay(value))
  const seatLimitLabel =
    members.seatLimit === UNLIMITED
      ? '∞'
      : formatNumber(locale, members.seatLimit)

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-title font-bold text-ink">
            {t('members.title')}
          </h1>
          <p className="mt-1 max-w-[68ch] text-body text-ink-2">
            {t('members.subtitle')}
          </p>
        </div>
        {canManage ? (
          <Button
            variant="primary"
            icon={<UserPlus aria-hidden="true" />}
            isDisabled={seatsLeft <= 0}
            onPress={() => setPending({ kind: 'invite' })}
          >
            {t('members.invite.action')}
          </Button>
        ) : null}
      </header>

      <Card padding="lg" as="section" aria-label={t('members.seats.title')}>
        <CardHeader headingLevel={2} title={t('members.seats.title')} />
        <CardBody className="flex flex-col gap-2">
          <p className="text-body tabular-nums text-ink">
            {t('members.seats.value', {
              used: formatNumber(locale, members.seatsUsed),
              limit: seatLimitLabel,
            })}
          </p>
          {seatsLeft > 0 ? null : (
            <p className="flex flex-wrap items-center gap-2 text-body text-ink-2">
              {t('members.seats.full')}
              <Link href="/settings/billing">{t('members.seats.upgrade')}</Link>
            </p>
          )}
        </CardBody>
      </Card>

      <Card padding="lg" as="section" aria-label={t('members.list.title')}>
        <CardHeader headingLevel={2} title={t('members.list.title')} />
        <CardBody>
          <TableContainer>
            <Table aria-label={t('members.list.title')}>
              {/* Widths below which a column stops being readable, so the table outgrows a phone
                  and its container scrolls instead of dividing 328px four ways - the same fault
                  the category rows had, in a table. */}
              <TableHeader>
                <Column isRowHeader minWidth={190}>
                  {t('members.column.person')}
                </Column>
                <Column minWidth={120}>{t('members.column.role')}</Column>
                <Column minWidth={120}>{t('members.column.joined')}</Column>
                <Column align="end" minWidth={68}>
                  {t('members.column.actions')}
                </Column>
              </TableHeader>
              <TableBody>
                {members.members.map((person) => (
                  <Row key={person.memberId}>
                    <Cell>
                      <span className="flex flex-col">
                        <span className="font-medium text-ink">
                          {person.name}
                          {person.userId === shell.user.id ? (
                            <span className="ms-2 text-caption text-ink-2">
                              {t('members.you')}
                            </span>
                          ) : null}
                        </span>
                        <span className="text-caption text-ink-2">
                          {person.email}
                        </span>
                      </span>
                    </Cell>
                    <Cell>
                      <Badge
                        tone={person.role === 'owner' ? 'brand' : 'neutral'}
                      >
                        {t(ROLE_LABEL[person.role])}
                      </Badge>
                    </Cell>
                    <Cell>{day(person.joinedAt)}</Cell>
                    <Cell align="end">
                      <PersonActions
                        person={person}
                        isYou={person.userId === shell.user.id}
                        canManage={canManage}
                        isOwner={members.role === 'owner'}
                        onChangeRole={(role) => {
                          void changeMemberRole({
                            data: { memberId: person.memberId, role },
                          }).then(refresh, (error: Error) => {
                            toast.error(error.message)
                          })
                        }}
                        onRemove={() =>
                          setPending({ kind: 'remove', member: person })
                        }
                        onLeave={() => setPending({ kind: 'leave' })}
                      />
                    </Cell>
                  </Row>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {members.members.length > 1 ? null : (
            <p className="mt-4 text-body text-ink-2">{t('members.alone')}</p>
          )}
        </CardBody>
      </Card>

      <Card padding="lg" as="section" aria-label={t('members.pending.title')}>
        <CardHeader headingLevel={2} title={t('members.pending.title')} />
        <CardBody className="flex flex-col gap-3">
          {members.invitations.length === 0 ? (
            <p className="text-body text-ink-2">{t('members.pending.empty')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border-subtle">
              {members.invitations.map((invitation) => (
                <li
                  key={invitation.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-body text-ink">
                      {invitation.email}
                    </span>
                    <span className="text-caption text-ink-2">
                      {invitation.expiresAt.getTime() <= Date.now()
                        ? t('members.pending.expired')
                        : t('members.pending.expires', {
                            date: day(invitation.expiresAt),
                          })}
                    </span>
                  </span>

                  {canManage ? (
                    <span className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onPress={() => {
                          void resendInvitation({
                            data: { invitationId: invitation.id },
                          }).then(() => {
                            toast.success(t('members.pending.resent'))
                            refresh()
                          }, reportFailure)
                        }}
                      >
                        {t('members.pending.resend')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onPress={() => {
                          void revokeInvitation({
                            data: { invitationId: invitation.id },
                          }).then(() => {
                            toast.success(t('members.pending.revoked'))
                            refresh()
                          }, reportFailure)
                        }}
                      >
                        {t('members.pending.revoke')}
                      </Button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <InviteDialog
        isOpen={pending.kind === 'invite'}
        onOpenChange={(open) => (open ? undefined : close())}
        onInvite={async (input) => {
          const result = await inviteMember({ data: input })
          toast.success(t('members.invite.sent', { email: result.email }))
          refresh()
        }}
      />

      <ConfirmDialog
        isOpen={pending.kind === 'remove'}
        onOpenChange={(open) => (open ? undefined : close())}
        isDestructive
        title={t('members.remove.title', {
          name: pending.kind === 'remove' ? pending.member.name : '',
        })}
        body={t('members.remove.body')}
        confirmLabel={t('members.remove.confirm')}
        errorTitle={t('members.error.title')}
        errorBody={t('members.error.generic')}
        onConfirm={async () => {
          if (pending.kind !== 'remove') return
          const name = pending.member.name
          await removeMember({ data: { memberId: pending.member.memberId } })
          toast.success(t('members.removed', { name }))
          refresh()
        }}
      />

      <ConfirmDialog
        isOpen={pending.kind === 'leave'}
        onOpenChange={(open) => (open ? undefined : close())}
        isDestructive
        title={t('members.leave.title')}
        body={t('members.leave.body')}
        confirmLabel={t('members.leave.confirm')}
        errorTitle={t('members.error.title')}
        errorBody={t('members.error.generic')}
        onConfirm={async () => {
          await leaveWorkspace()
          // A person who has just left this workspace may no longer read anything in it, so the
          // whole document is reloaded rather than the route invalidated: the shell itself has to
          // be rebuilt against whichever workspace the session lands in next.
          window.location.assign('/dashboard')
        }}
      />
    </div>
  )
}

function reportFailure(error: unknown): void {
  toast.error(error instanceof Error ? error.message : String(error))
}

/**
 * The per-row menu: change a role, remove somebody, or leave.
 *
 * Every item's accessible name carries the person it acts on. The owner rules are mirrored from
 * `repos/members.ts` — an admin may not act on an owner and may not create one — so a person is
 * never offered an action the server is about to refuse. The server refuses it anyway.
 */
function PersonActions({
  person,
  isYou,
  canManage,
  isOwner,
  onChangeRole,
  onRemove,
  onLeave,
}: {
  person: WorkspaceMember
  isYou: boolean
  canManage: boolean
  isOwner: boolean
  onChangeRole: (role: WorkspaceRole) => void
  onRemove: () => void
  onLeave: () => void
}) {
  const t = useTranslate()
  const mayActOnThem = canManage && (isOwner || person.role !== 'owner')

  if (!mayActOnThem && !isYou) return null

  return (
    <MenuTrigger>
      <Button
        variant="ghost"
        shape="icon"
        size="sm"
        label={t('members.role.change', { name: person.name })}
        icon={<MoreHorizontal aria-hidden="true" />}
      />
      <Popover>
        <Menu>
          {mayActOnThem && person.role !== 'member' ? (
            <MenuItem onAction={() => onChangeRole('member')}>
              {t('app.workspace.role.member')}
            </MenuItem>
          ) : null}
          {mayActOnThem && person.role !== 'admin' ? (
            <MenuItem onAction={() => onChangeRole('admin')}>
              {t('app.workspace.role.admin')}
            </MenuItem>
          ) : null}
          {isOwner && person.role !== 'owner' ? (
            <MenuItem onAction={() => onChangeRole('owner')}>
              {t('app.workspace.role.owner')}
            </MenuItem>
          ) : null}
          {isYou ? (
            <MenuItem isDestructive onAction={onLeave}>
              {t('members.leave.action')}
            </MenuItem>
          ) : mayActOnThem ? (
            <MenuItem isDestructive onAction={onRemove}>
              {t('members.remove.action', { name: person.name })}
            </MenuItem>
          ) : null}
        </Menu>
      </Popover>
    </MenuTrigger>
  )
}
