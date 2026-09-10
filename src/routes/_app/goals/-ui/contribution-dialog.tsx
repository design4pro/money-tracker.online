import { useEffect, useState } from 'react'

import { ErrorPanel } from '#/components/app/accounts'
import { FormModal } from '#/components/app/shell'
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Form,
  Select,
  SelectItem,
  Spinner,
} from '#/components/ui'
import { formatCalendarDate, useLocale, useTranslate } from '#/lib/i18n'
import { formatMoney, makeMoney } from '#/lib/money'
import {
  addGoalContribution,
  loadContributionCandidates,
} from '#/server/fns/goals'

import type { Key } from 'react-aria-components'
import type { Transaction } from '#/server/db/types'
import type { GoalSummary } from '#/server/goals/summary'

/**
 * Counting an existing transaction towards a goal.
 *
 * ## What this dialog is careful not to imply
 *
 * A savings goal does not hold money. Contributing to one creates nothing, moves nothing and
 * changes no balance — it records that a transaction which already happened was *for* this goal.
 * Every sentence in here is written to keep that clear, because the mental model people arrive
 * with is a jar they put coins in, and a form with an amount field would confirm it. So there is
 * no amount field. There is a list of transactions, and you pick one.
 *
 * ## The picker only offers what the repository would accept
 *
 * `listContributionCandidates` filters to the goal's currency, to the direction its first
 * contribution established, and to rows not already linked. That is not belt-and-braces over the
 * repository's refusals — it is the difference between a control that cannot be chosen and a
 * control that can be chosen and then fails. The two refusals still have copy here, because the
 * list can go stale between the fetch and the press.
 *
 * ## The candidates are fetched on mount, not with the page
 *
 * A picker's worth of transactions is a real query and the detail screen does not need it until
 * this opens. The dialog owns the fetch, shows a spinner while it runs and its own empty state if
 * nothing comes back.
 */

export interface ContributionDialogProps {
  readonly isOpen: boolean
  readonly onOpenChange: (isOpen: boolean) => void
  readonly goal: GoalSummary
  /** Called once the link is written. `reached` is true only on the crossing. */
  readonly onAdded: (reached: boolean) => void
}

export function ContributionDialog({
  isOpen,
  onOpenChange,
  goal,
  onAdded,
}: ContributionDialogProps) {
  const t = useTranslate()

  const [candidates, setCandidates] =
    useState<ReadonlyArray<Transaction> | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  // Validation appears after the first submit, never while somebody is still choosing. The submit
  // button stays enabled for the same reason it does everywhere else in this product: a disabled
  // control gives no reason, and a keyboard user pressing it learns nothing.
  const [hasTriedToSubmit, setHasTriedToSubmit] = useState(false)

  // The whole form is one choice, so having made it is the whole of "dirty". The successful path
  // never reaches the guard: `submit` closes through `onOpenChange`, the prop, not through the
  // render-prop `close`.
  const isDirty = selected !== null

  useEffect(() => {
    let cancelled = false
    void loadContributionCandidates({ data: { goalId: goal.id } })
      .then((rows) => {
        if (!cancelled) setCandidates(rows)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setCandidates([])
        setFailure(error instanceof Error ? error.message : String(error))
      })
    return () => {
      cancelled = true
    }
  }, [goal.id])

  async function submit(transactionId: string) {
    setIsSaving(true)
    setFailure(null)
    try {
      const result = await addGoalContribution({
        data: { goalId: goal.id, transactionId },
      })
      onAdded(result.becameReached)
      onOpenChange(false)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <FormModal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size="md"
      isDirty={isDirty}
    >
      <Dialog>
        {({ close }) => (
          <>
            <DialogHeader
              title={t('goals.contribute.title', { name: goal.name })}
              description={t('goals.contribute.description')}
              closeLabel={t('action.close')}
              onClose={close}
            />

            <Form
              onSubmit={(event) => {
                event.preventDefault()
                setHasTriedToSubmit(true)
                if (selected !== null && !isSaving) void submit(selected)
              }}
              className="contents"
            >
              <DialogBody className="flex flex-col gap-5">
                {failure === null ? null : (
                  <ErrorPanel
                    title={t('goals.contribute.error')}
                    body={t('empty.error.body')}
                    detail={failure}
                  />
                )}

                <Picker
                  candidates={candidates}
                  currencyCode={goal.currencyCode}
                  selected={selected}
                  onSelect={setSelected}
                  errorMessage={
                    hasTriedToSubmit && selected === null
                      ? t('goals.contribute.field')
                      : undefined
                  }
                />
              </DialogBody>

              <DialogFooter>
                <Button variant="ghost" onPress={close}>
                  {t('goals.contribute.cancel')}
                </Button>
                <Button type="submit" variant="primary" isPending={isSaving}>
                  {t('goals.contribute.submit')}
                </Button>
              </DialogFooter>
            </Form>
          </>
        )}
      </Dialog>
    </FormModal>
  )
}

/**
 * The three states the picker can be in, kept out of the form so the JSX stays one branch deep.
 *
 * `null` candidates is *still loading*; an empty array is *nothing to offer*, which is a real
 * answer with its own sentence rather than an empty dropdown.
 */
function Picker({
  candidates,
  currencyCode,
  selected,
  onSelect,
  errorMessage,
}: {
  readonly candidates: ReadonlyArray<Transaction> | null
  readonly currencyCode: string
  readonly selected: string | null
  readonly onSelect: (id: string | null) => void
  readonly errorMessage: string | undefined
}) {
  const t = useTranslate()
  const locale = useLocale()

  if (candidates === null) {
    return (
      <p className="flex items-center gap-2 text-caption text-ink-2">
        <Spinner label={null} />
        {t('goals.detail.loading')}
      </p>
    )
  }

  if (candidates.length === 0) {
    return (
      <p className="prose-measure text-body text-ink-2">
        {t('goals.contribute.empty', { currency: currencyCode })}
      </p>
    )
  }

  return (
    <Select
      label={t('goals.contribute.field')}
      description={t('goals.contribute.field.help', {
        currency: currencyCode,
      })}
      selectedKey={selected}
      errorMessage={errorMessage}
      onSelectionChange={(key: Key | null) => {
        onSelect(key === null ? null : String(key))
      }}
    >
      {candidates.map((transaction) => (
        <SelectItem key={transaction.id} id={transaction.id}>
          {t('goals.contribute.option', {
            date: formatCalendarDate(locale, transaction.bookedOn, 'medium'),
            amount: formatMoney(
              locale,
              makeMoney(transaction.amountMinor, currencyCode),
            ),
          })}
        </SelectItem>
      ))}
    </Select>
  )
}
