import { useState } from 'react'
import { X } from 'lucide-react'

import { ErrorPanel } from '#/components/app/shell'
import { Button, Card, Select, SelectItem, toast } from '#/components/ui'
import { useLocale, useTranslate } from '#/lib/i18n'
import { formatMoney, makeMoney } from '#/lib/money'
import { addToGroup, removeFromGroup } from '#/server/fns/transaction-groups'

import type { TransactionGroupSummary } from '#/server/repos/transaction-groups'

/**
 * The group panel: which groups this transaction is read as part of, and the two ways to change
 * that.
 *
 * ## A group's total is a sentence, not a floating number
 *
 * Every group listed here prints *"Sicily 2026 — 4 transactions, −2 340,00 zł"*: the name, the
 * count and the total **with its currency**, as text, in the same string a sighted reader gets.
 * A bare figure beside a name is a number whose unit the reader has to already know, and a group
 * can hold a euro receipt and a złoty one — the figure is in the workspace base currency and says
 * so, because `formatMoney` puts the currency in it.
 *
 * The total is signed: income less expense. A group holding both legs of an internal transfer
 * reads zero, which is the correct answer and is the repository's rule 2, not this component's
 * arithmetic — nothing here adds anything up.
 *
 * ## Removing a member can dissolve the group, and the panel says so
 *
 * Below two members a group is not a grouping, so the repository deletes it in the same statement
 * that empties it. That is a surprising thing to have happen to something you were only editing,
 * so the confirmation names it — *"…had only two transactions, so removing one dissolved it"* —
 * rather than letting a row quietly vanish from the list.
 *
 * ## It holds no data of its own
 *
 * Both collections arrive as props and every write ends in {@link GroupPanelProps.onChanged}, so
 * the host decides what to refetch. There is no local copy of the membership to drift out of step
 * with the row behind it.
 */

export interface GroupPanelProps {
  readonly transactionId: string
  /**
   * The groups this transaction is in — `listGroups({ transactionId })`, in the repository's
   * order. Empty is the ordinary case, not an error.
   */
  readonly memberOf: ReadonlyArray<TransactionGroupSummary>
  /**
   * Every group the workspace has — `listGroups({})`. The options the picker offers; the ones
   * already in {@link memberOf} are filtered out here rather than by the caller.
   */
  readonly allGroups: ReadonlyArray<TransactionGroupSummary>
  /** Called after a successful add or remove, so the host can refetch what it loaded. */
  readonly onChanged: () => void
}

export function GroupPanel({
  transactionId,
  memberOf,
  allGroups,
  onChanged,
}: GroupPanelProps) {
  const t = useTranslate()
  const locale = useLocale()

  const [selected, setSelected] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const inThisTransaction = new Set(memberOf.map((group) => group.id))
  const available = allGroups.filter(
    (group) => !inThisTransaction.has(group.id),
  )

  /** The name, the count and the total with its currency — one string, for everybody. */
  function summarise(group: TransactionGroupSummary): string {
    return t('groups.total.summary', {
      name: group.name,
      count: group.memberCount,
      amount: formatMoney(
        locale,
        makeMoney(group.totalMinor, group.currencyCode),
      ),
    })
  }

  async function run(work: () => Promise<void>) {
    setIsBusy(true)
    setFailure(null)
    try {
      await work()
      onChanged()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setIsBusy(false)
    }
  }

  async function add() {
    if (selected === null) return
    const target = allGroups.find((group) => group.id === selected)
    await run(async () => {
      await addToGroup({
        data: { groupId: selected, transactionIds: [transactionId] },
      })
      toast.success(t('groups.panel.added', { name: target?.name ?? '' }))
      setSelected(null)
    })
  }

  async function remove(group: TransactionGroupSummary) {
    await run(async () => {
      const result = await removeFromGroup({
        data: { groupId: group.id, transactionIds: [transactionId] },
      })
      // The dissolve is the repository's, and it is worth a different sentence: a group that was
      // only being edited has gone, and a reader who is not told will think they deleted it.
      toast.success(
        result.dissolved
          ? t('groups.panel.dissolved', { name: group.name })
          : t('groups.panel.removed', { name: group.name }),
      )
    })
  }

  return (
    <Card
      as="section"
      aria-labelledby="group-panel-heading"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <h2
          id="group-panel-heading"
          className="text-body font-semibold text-ink"
        >
          {t('groups.panel.title')}
        </h2>
        <p className="text-caption text-ink-2">
          {t('groups.panel.description')}
        </p>
      </div>

      {failure === null ? null : (
        <ErrorPanel
          title={t('groups.panel.error.title')}
          body={t('empty.error.body')}
          detail={failure}
        />
      )}

      {memberOf.length === 0 ? (
        <p className="text-body text-ink-2">{t('groups.panel.empty')}</p>
      ) : (
        <ul
          aria-label={t('groups.panel.title')}
          className="flex flex-col gap-2"
        >
          {memberOf.map((group) => (
            <li
              key={group.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-surface px-3 py-2"
            >
              {/* The whole fact, as one sentence: name, count and total with its currency. */}
              <span className="text-label text-ink tabular">
                {summarise(group)}
              </span>
              <Button
                variant="ghost"
                shape="icon"
                size="sm"
                isDisabled={isBusy}
                label={t('groups.panel.remove', { name: group.name })}
                icon={<X aria-hidden="true" />}
                onPress={() => void remove(group)}
              />
            </li>
          ))}
        </ul>
      )}

      {available.length === 0 ? (
        <p className="text-caption text-ink-2">{t('groups.panel.add.none')}</p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <Select
            label={t('groups.panel.add.label')}
            placeholder={t('groups.panel.add.placeholder')}
            selectedKey={selected}
            isDisabled={isBusy}
            onSelectionChange={(key) => setSelected(String(key))}
            className="min-w-56 flex-1"
          >
            {available.map((group) => (
              <SelectItem key={group.id} id={group.id} textValue={group.name}>
                {group.name}
              </SelectItem>
            ))}
          </Select>
          <Button
            variant="secondary"
            isPending={isBusy}
            isDisabled={selected === null}
            onPress={() => void add()}
          >
            {t('groups.panel.add.action')}
          </Button>
        </div>
      )}
    </Card>
  )
}
