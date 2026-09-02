import { useState } from 'react'
import { Plus } from 'lucide-react'

import { ErrorPanel } from '#/components/app/accounts'
import { Button, Card, toast } from '#/components/ui'
import { useLocale, useTranslate } from '#/lib/i18n'
import { asMinor, formatMoney, makeMoney } from '#/lib/money'
import { clearSplits, setSplits } from '#/server/fns/splits'

import { SplitRow } from './split-row'

import type { CategoryOption } from '#/components/app/transactions'
import type { Minor } from '#/lib/money'
import type { TransactionSplit } from '#/server/db/types'
import type { SplitDraft } from './split-row'

/**
 * The split editor: one payment divided across several categories, with the arithmetic done for
 * the person rather than demanded of them.
 *
 * ## The remainder is the whole point, and it is text
 *
 * `Σ lines = the transaction` is a rule the repository enforces, and an editor that only reports it
 * at submit time makes somebody do mental arithmetic and then punishes them for getting it wrong.
 * So the running total and what is still unassigned are **always on screen as a sentence** —
 * _"120,00 zł left to assign"_ — in a polite live region that re-announces as the amounts change,
 * and **Assign the remainder** puts the difference on the line the person was last in. Nothing here
 * conveys the state by colour alone: the colour is a second signal on a sentence that already says
 * it, which is what WCAG 2.2 1.4.1 asks for and what a colour-blind reader needs anyway.
 *
 * ## It never holds a float
 *
 * Every amount in this component is `Minor | null` — integer minor units in the parent's own
 * currency, at that currency's `digits` scale. {@link AmountField} parses and formats; the editor
 * adds and subtracts integers. The one figure it does *not* compute is `ref_amount_minor`: the
 * lines are allocated from the parent's own converted figure by the repository, at the rate the
 * parent already fixed, so the parts cannot disagree with the whole by a rounding step.
 *
 * ## What it does not decide
 *
 * Two lines in the same category are allowed and are two lines. How a category budget attributes
 * them is `OPEN-7` in `docs/plans/99-boundaries-and-blockers.md` and is not this component's to
 * answer — it neither merges them nor warns about them.
 */

export interface SplitEditorProps {
  readonly transactionId: string
  /** The parent's own amount: strictly positive minor units. The lines must add up to exactly this. */
  readonly amountMinor: Minor
  /** The parent's currency. Every line is denominated in it; there is no per-line conversion. */
  readonly currencyCode: string
  /** The stored set in position order, empty when the transaction is not split. */
  readonly splits: ReadonlyArray<TransactionSplit>
  /** The vocabulary the pickers offer — the detail screen's `reference.categories`, unchanged. */
  readonly categories: ReadonlyArray<CategoryOption>
  /**
   * `transferKind !== 'none'`. A transfer leg cannot be split, and the panel says so in place of
   * offering an editor that the repository would refuse.
   */
  readonly isTransferLeg?: boolean
  /** Called after a successful save or clear, so the host can refetch what it loaded. */
  readonly onSaved: () => void
}

let nextKey = 0
function freshKey(): string {
  nextKey += 1
  return `line-${nextKey}`
}

/**
 * The starting rows.
 *
 * A stored set is edited as it stands. An unsplit transaction opens on **two rows with the whole
 * amount already on the first**, because starting from zero rows makes the person do the one piece
 * of arithmetic the product is perfectly able to do for them: whatever they type on the second line
 * is subtracted from the first by {@link SplitEditor}'s remainder, and they are never asked what
 * two numbers add up to a third they can already see.
 */
function draftsFrom(
  splits: ReadonlyArray<TransactionSplit>,
  amountMinor: Minor,
): ReadonlyArray<SplitDraft> {
  if (splits.length >= 2) {
    return splits.map((line) => ({
      key: line.id,
      categoryId: line.categoryId,
      amountMinor: line.amountMinor,
      note: line.note ?? '',
    }))
  }
  return [
    { key: freshKey(), categoryId: null, amountMinor, note: '' },
    { key: freshKey(), categoryId: null, amountMinor: null, note: '' },
  ]
}

export function SplitEditor({
  transactionId,
  amountMinor,
  currencyCode,
  splits,
  categories,
  isTransferLeg = false,
  onSaved,
}: SplitEditorProps) {
  const t = useTranslate()
  const locale = useLocale()

  // Seeded once. The host remounts this panel when it reloads the transaction behind it, so a
  // synchronising effect would only be a way for a half-typed line to disappear under somebody.
  const [rows, setRows] = useState<ReadonlyArray<SplitDraft>>(() =>
    draftsFrom(splits, amountMinor),
  )
  const [activeIndex, setActiveIndex] = useState(0)
  const [isSaving, setIsSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const money = (value: number) =>
    formatMoney(locale, makeMoney(asMinor(value), currencyCode))

  // Integer arithmetic, start to finish: an empty box contributes nothing rather than a `NaN`.
  const assigned = rows.reduce((sum, row) => sum + (row.amountMinor ?? 0), 0)
  const remainder = amountMinor - assigned
  const hasEveryAmount = rows.every(
    (row) => row.amountMinor !== null && row.amountMinor > 0,
  )
  const isBalanced = remainder === 0 && hasEveryAmount

  function patch(index: number, next: SplitDraft) {
    setRows((current) => current.map((row, at) => (at === index ? next : row)))
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction
    setRows((current) => {
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      const [row] = next.splice(index, 1)
      next.splice(target, 0, row)
      return next
    })
    setActiveIndex(Math.min(Math.max(target, 0), rows.length - 1))
  }

  /**
   * Puts what is unassigned on the line the person was last in.
   *
   * It adds rather than replaces, so pressing it on a line that already carries something tops that
   * line up — which is what somebody who has filled in every line but one means by it.
   */
  function assignRemainder() {
    setRows((current) =>
      current.map((row, at) =>
        at === activeIndex
          ? { ...row, amountMinor: asMinor((row.amountMinor ?? 0) + remainder) }
          : row,
      ),
    )
  }

  async function save() {
    setIsSaving(true)
    setFailure(null)
    try {
      await setSplits({
        data: {
          transactionId,
          splits: rows.map((row) => ({
            categoryId: row.categoryId,
            amountMinor: row.amountMinor ?? 0,
            note: row.note.trim() === '' ? null : row.note.trim(),
          })),
        },
      })
      toast.success(t('splits.saved'))
      onSaved()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSaving(false)
    }
  }

  async function clear() {
    setIsSaving(true)
    setFailure(null)
    try {
      await clearSplits({ data: { transactionId } })
      toast.success(t('splits.cleared'))
      onSaved()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSaving(false)
    }
  }

  if (isTransferLeg) {
    return (
      <Card className="flex flex-col gap-2">
        <h2 className="text-body font-semibold text-ink">
          {t('splits.transfer.title')}
        </h2>
        <p className="text-caption text-ink-2">{t('splits.transfer.body')}</p>
      </Card>
    )
  }

  return (
    <Card
      as="section"
      aria-labelledby="split-editor-heading"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <h2
          id="split-editor-heading"
          className="text-body font-semibold text-ink"
        >
          {t('splits.title')}
        </h2>
        <p className="text-caption text-ink-2">{t('splits.description')}</p>
      </div>

      {failure === null ? null : (
        <ErrorPanel
          title={t('splits.error.title')}
          body={t('empty.error.body')}
          detail={failure}
        />
      )}

      <ul aria-label={t('splits.lines.label')} className="flex flex-col gap-3">
        {rows.map((row, index) => (
          <li key={row.key}>
            <SplitRow
              position={index + 1}
              count={rows.length}
              value={row}
              categories={categories}
              currencyCode={currencyCode}
              locale={locale}
              t={t}
              isDisabled={isSaving}
              onChange={(next) => patch(index, next)}
              onRemove={() =>
                setRows((current) => current.filter((_, at) => at !== index))
              }
              onMove={(direction) => move(index, direction)}
              onActivate={() => setActiveIndex(index)}
            />
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="secondary"
          icon={<Plus />}
          isDisabled={isSaving}
          onPress={() =>
            setRows((current) => [
              ...current,
              {
                key: freshKey(),
                categoryId: null,
                amountMinor: null,
                note: '',
              },
            ])
          }
        >
          {t('splits.add')}
        </Button>

        {remainder === 0 ? null : (
          <Button
            variant="secondary"
            isDisabled={isSaving}
            onPress={assignRemainder}
          >
            {t('splits.assignRemainder')}
          </Button>
        )}
      </div>

      {/*
        The running total and the remainder, always present and always text. `role="status"` is a
        polite live region, so it re-announces as somebody types instead of interrupting them, and
        the sentence is the same one a sighted reader gets rather than a screen-reader-only variant
        that can drift away from it.
      */}
      <p role="status" className="text-caption text-ink-2 tabular">
        <span>
          {t('splits.assigned', {
            assigned: money(assigned),
            total: money(amountMinor),
          })}{' '}
        </span>
        <span className={remainder === 0 ? 'text-positive' : 'text-ink'}>
          {remainder === 0
            ? t('splits.balanced')
            : remainder > 0
              ? t('splits.remaining', { amount: money(remainder) })
              : t('splits.over', { amount: money(-remainder) })}
        </span>
        {hasEveryAmount ? null : <span> {t('splits.error.amounts')}</span>}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          isPending={isSaving}
          isDisabled={!isBalanced}
          onPress={() => void save()}
        >
          {t('splits.save')}
        </Button>
        {splits.length >= 2 ? (
          <Button
            variant="ghost"
            isDisabled={isSaving}
            onPress={() => void clear()}
          >
            {t('splits.clear')}
          </Button>
        ) : null}
      </div>
    </Card>
  )
}
