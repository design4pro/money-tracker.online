import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'

import { ErrorPanel } from '#/components/app/accounts'
import {
  Button,
  Card,
  Cell,
  Column,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  EmptyState,
  Form,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  Popover,
  Row,
  Skeleton,
  Table,
  TableBody,
  TableContainer,
  TableHeader,
  TextField,
  toast,
} from '#/components/ui'
import { useLocale, useTranslate } from '#/lib/i18n'
import { formatMoney, makeMoney } from '#/lib/money'
import {
  createGroup,
  deleteGroup,
  listGroups,
  renameGroup,
} from '#/server/fns/transaction-groups'

import { useDataRefresh } from '../-lib/refresh'
import { ConfirmDialog } from '../accounts/-ui/confirm-dialog'

import type { TransactionGroupSummary } from '#/server/repos/transaction-groups'
import { pageHead } from '#/routes/-lib/page-title'

/**
 * `/transactions/groups` — the groups a person has made, what is in them, and what they come to.
 *
 * ## The total is a summary with a currency, beside the table rather than floating in it
 *
 * A column of bare figures is a column whose unit the reader has to already know, and a group can
 * hold a euro receipt and a złoty one — the figures are in the workspace base currency, and the
 * sentence above the table says so once, in the same words for everybody. Each row's figure then
 * carries its own currency as well, from `formatMoney`, so a row read out of context is still an
 * amount rather than a number.
 *
 * The figure is **signed**: income less expense, recomputed from the members on every read. A group
 * holding both legs of an internal transfer reads zero, which is correct — the money did not leave
 * the workspace — and nothing on this screen adds anything up. See `repos/transaction-groups`
 * rule 2.
 *
 * ## Membership is not edited here
 *
 * A group's members are added from the ledger's own bulk-select flow (`07-S2`) and removed from the
 * group panel on the transaction detail screen, so the product has one selection model rather than
 * two. This screen creates, renames and deletes; it never invents a second way to pick rows.
 *
 * ## Nothing here can leave a group of one
 *
 * The repository dissolves a group the moment a removal would take it below two members, in the
 * same statement. That is why the table needs no "this group has one member" state and no
 * `length > 1` branch: the state does not exist to be rendered.
 */

export const Route = createFileRoute('/_app/transactions/groups')({
  loader: async () => ({ groups: await listGroups({ data: {} }) }),
  pendingComponent: GroupsSkeleton,
  errorComponent: GroupsError,
  head: ({ matches }) => pageHead(matches, (t) => t('groups.title')),
  component: GroupsRoute,
})

/** Four rows, which is what the list usually holds and what the plan asks for. */
function GroupsSkeleton() {
  const t = useTranslate()
  return (
    <div className="flex flex-col gap-6">
      <Skeleton shape="text" lines={2} className="max-w-md" />
      <Card aria-busy="true" aria-label={t('groups.loading')}>
        <Skeleton shape="text" lines={4} />
      </Card>
    </div>
  )
}

function GroupsError({ error, reset }: { error: Error; reset: () => void }) {
  const t = useTranslate()
  return (
    <ErrorPanel
      title={t('groups.error.title')}
      body={t('empty.error.body')}
      detail={error.message}
      onRetry={reset}
    />
  )
}

type Pending =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'rename'; group: TransactionGroupSummary }
  | { kind: 'delete'; group: TransactionGroupSummary }

function GroupsRoute() {
  const t = useTranslate()
  const locale = useLocale()
  const { groups } = Route.useLoaderData()
  const router = useRouter()
  const refreshCaches = useDataRefresh()

  const [pending, setPending] = useState<Pending>({ kind: 'none' })
  const close = () => setPending({ kind: 'none' })
  const refresh = () => void Promise.all([router.invalidate(), refreshCaches()])

  // One denomination for the whole table, named once above it. Every group's `ref_amount_minor`
  // is in the workspace base currency, so this is a fact about the data rather than a choice.
  const baseCurrency = groups.at(0)?.currencyCode ?? null

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-title font-bold text-ink">{t('groups.title')}</h1>
          <p className="mt-1 text-body text-ink-2">{t('groups.subtitle')}</p>
        </div>
        <Button
          variant="primary"
          icon={<Plus aria-hidden="true" />}
          onPress={() => setPending({ kind: 'create' })}
        >
          {t('groups.create')}
        </Button>
      </header>

      {groups.length === 0 ? (
        <EmptyState
          title={t('groups.empty.title')}
          description={t('groups.empty.body')}
          action={
            <Button
              variant="primary"
              onPress={() => setPending({ kind: 'create' })}
            >
              {t('groups.create')}
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {/*
            The summary the plan asks for: it names what the totals are denominated in, as text,
            immediately before the table it describes, and the table points at it so a screen
            reader reaches the sentence with the grid rather than after it.
          */}
          <p id="groups-total-summary" className="text-caption text-ink-2">
            {t('groups.table.summary', {
              count: groups.length,
              currency: baseCurrency ?? '',
            })}
          </p>
          <TableContainer>
            <Table
              aria-label={t('groups.table.label')}
              aria-describedby="groups-total-summary"
            >
              {/*
                Each column states the width below which it stops being readable, so on a phone
                the table outgrows its container and the container scrolls. Without them a
                `ResizableTableContainer` divides whatever width it is given between four columns
                however narrow that is, which is how a 360px page comes to show `EXPENS…` over
                group names broken across two lines. The numbers are the columns themselves: a
                name wide enough for two words, the two figures wide enough for their own headings,
                and the menu's 44px target plus its cell padding.
              */}
              <TableHeader>
                <Column isRowHeader minWidth={140}>
                  {t('groups.column.name')}
                </Column>
                <Column align="end" minWidth={110}>
                  {t('groups.column.members')}
                </Column>
                <Column align="end" minWidth={110}>
                  {t('groups.column.total')}
                </Column>
                <Column align="end" minWidth={68}>
                  {t('groups.column.actions')}
                </Column>
              </TableHeader>
              <TableBody>
                {groups.map((group) => (
                  <Row key={group.id}>
                    <Cell>{group.name}</Cell>
                    <Cell align="end" numeric>
                      {t('groups.members', { count: group.memberCount })}
                    </Cell>
                    <Cell align="end" numeric>
                      {formatMoney(
                        locale,
                        makeMoney(group.totalMinor, group.currencyCode),
                      )}
                    </Cell>
                    <Cell align="end">
                      <MenuTrigger>
                        <Button
                          variant="ghost"
                          shape="icon"
                          size="sm"
                          label={t('groups.actions.label', {
                            name: group.name,
                          })}
                          icon={<MoreHorizontal aria-hidden="true" />}
                        />
                        <Popover>
                          <Menu>
                            <MenuItem
                              icon={<Pencil aria-hidden="true" />}
                              onAction={() =>
                                setPending({ kind: 'rename', group })
                              }
                            >
                              {t('groups.rename')}
                            </MenuItem>
                            <MenuItem
                              isDestructive
                              icon={<Trash2 aria-hidden="true" />}
                              onAction={() =>
                                setPending({ kind: 'delete', group })
                              }
                            >
                              {t('groups.delete')}
                            </MenuItem>
                          </Menu>
                        </Popover>
                      </MenuTrigger>
                    </Cell>
                  </Row>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </div>
      )}

      {pending.kind === 'create' ? (
        <GroupFormDialog
          onClose={close}
          onSaved={(name) => {
            toast.success(t('groups.toast.created', { name }))
            close()
            refresh()
          }}
        />
      ) : null}

      {pending.kind === 'rename' ? (
        <GroupFormDialog
          key={pending.group.id}
          group={pending.group}
          onClose={close}
          onSaved={(name) => {
            toast.success(t('groups.toast.renamed', { name }))
            close()
            refresh()
          }}
        />
      ) : null}

      {pending.kind === 'delete' ? (
        <ConfirmDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) close()
          }}
          isDestructive
          title={t('groups.delete.title', { name: pending.group.name })}
          body={t('groups.delete.body')}
          confirmLabel={t('action.delete')}
          errorTitle={t('groups.error.title')}
          errorBody={t('empty.error.body')}
          onConfirm={async () => {
            const name = pending.group.name
            await deleteGroup({ data: { groupId: pending.group.id } })
            toast.success(t('groups.toast.deleted', { name }))
            close()
            refresh()
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * Create and rename in one dialog, because they are one form with a different button on it.
 *
 * The note and the colour are set at creation and are not editable afterwards — the repository
 * exposes `renameGroup` and only that — so the rename form shows the name alone rather than two
 * fields that would silently do nothing.
 */
function GroupFormDialog({
  group,
  onClose,
  onSaved,
}: {
  group?: TransactionGroupSummary
  onClose: () => void
  onSaved: (name: string) => void
}) {
  const t = useTranslate()
  const isRename = group !== undefined

  const [name, setName] = useState(group?.name ?? '')
  const [note, setNote] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  async function save() {
    setIsSaving(true)
    setFailure(null)
    try {
      if (group === undefined) {
        await createGroup({
          data: {
            name: name.trim(),
            note: note.trim() === '' ? null : note.trim(),
          },
        })
      } else {
        await renameGroup({ data: { groupId: group.id, name: name.trim() } })
      }
      onSaved(name.trim())
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
      setIsSaving(false)
    }
  }

  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      size="sm"
    >
      <Dialog>
        {({ close }) => (
          <Form
            onSubmit={(event) => {
              event.preventDefault()
              if (name.trim() !== '') void save()
            }}
            className="contents"
          >
            <DialogHeader
              title={
                isRename
                  ? t('groups.form.title.rename')
                  : t('groups.form.title.create')
              }
              closeLabel={t('action.close')}
              onClose={close}
            />
            <DialogBody className="flex flex-col gap-4">
              {failure === null ? null : (
                <ErrorPanel
                  title={t('groups.error.title')}
                  body={t('empty.error.body')}
                  detail={failure}
                />
              )}
              <TextField
                label={t('groups.form.name')}
                value={name}
                onChange={setName}
                maxLength={200}
                isRequired
                autoFocus
              />
              {isRename ? null : (
                <TextField
                  label={t('groups.form.note')}
                  description={t('groups.form.note.help')}
                  value={note}
                  onChange={setNote}
                  maxLength={500}
                />
              )}
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onPress={close} isDisabled={isSaving}>
                {t('action.cancel')}
              </Button>
              <Button
                type="submit"
                variant="primary"
                isPending={isSaving}
                isDisabled={name.trim() === ''}
              >
                {isRename ? t('action.save') : t('action.create')}
              </Button>
            </DialogFooter>
          </Form>
        )}
      </Dialog>
    </Modal>
  )
}
