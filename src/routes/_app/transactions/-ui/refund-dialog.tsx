import { useEffect, useState } from 'react'

import { FailurePanel, FormModal } from '#/components/app/shell'
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Form,
  Radio,
  RadioGroup,
  Spinner,
} from '#/components/ui'
import { failureOf } from '#/lib/failure'
import { formatCalendarDate, useLocale, useTranslate } from '#/lib/i18n'
import { formatMoney, makeMoney } from '#/lib/money'
import { linkRefund, suggestRefundTargets } from '#/server/fns/refunds'

import type { FailureEnvelope } from '#/lib/failure-envelope'
import type { Locale, Translate } from '#/lib/i18n'
import type { RefundTarget } from '#/server/repos/refunds'

/**
 * Saying what a refund gives back.
 *
 * ## The list explains itself, in text
 *
 * Every option carries the reason it is on the list — _"Same payee, 12,00 zł larger than this
 * refund, booked 3 days earlier"_ — and the group carries the ranking rule above them. A ranking
 * conveyed by order alone is conveyed to nobody reading with a screen reader, and an unexplained
 * suggestion in a finance product is one a careful person will not accept. The suggestions are a
 * heuristic; the link is a commitment, and the copy keeps the two apart.
 *
 * ## Radios rather than a picker
 *
 * A `Select` or a `ComboBox` shows one option at a time and has nowhere to put the sentence that
 * justifies it. The candidate set here is at most five, already ranked, and every one of them needs
 * a line of prose beside it — which is a radio group, arrowed through as a single tab stop.
 *
 * ## "Outside this workspace" is an option, not the absence of one
 *
 * A return of something bought before the workspace existed is still money arriving. It is offered
 * as a choice with its own explanation, because leaving it as "pick nothing and press the button"
 * is how somebody links the wrong original instead.
 *
 * ## The candidates are fetched when the dialog opens
 *
 * The detail screen does not need a 90-day scan until somebody asks for one. The dialog owns the
 * fetch, shows a spinner while it runs, and has its own empty state when nothing matches.
 */

export interface RefundDialogProps {
  readonly isOpen: boolean
  readonly onOpenChange: (isOpen: boolean) => void
  /** The transaction being recorded as a refund — the row whose detail screen this is. */
  readonly refundTransactionId: string
  /** Called once the link is written, so the host can reload what it is showing. */
  readonly onLinked: () => void
}

/** The radio value for "a refund of something outside the system", which is `original = NULL`. */
const EXTERNAL = 'external'

export function RefundDialog({
  isOpen,
  onOpenChange,
  refundTransactionId,
  onLinked,
}: RefundDialogProps) {
  const t = useTranslate()
  const locale = useLocale()

  // `null` is *still loading*; an empty array is *nothing to offer*, which is a real answer with
  // its own sentence rather than an empty list.
  const [targets, setTargets] = useState<ReadonlyArray<RefundTarget> | null>(
    null,
  )
  const [selected, setSelected] = useState<string>(EXTERNAL)
  const [isSaving, setIsSaving] = useState(false)
  const [failure, setFailure] = useState<FailureEnvelope | null>(null)

  // `EXTERNAL` is what the group is seeded with, so it is the pristine value rather than a choice
  // anybody made. Moving off it is the only edit this form has to lose.
  const isDirty = selected !== EXTERNAL

  useEffect(() => {
    let cancelled = false
    void suggestRefundTargets({ data: { refundTransactionId } })
      .then((rows) => {
        if (!cancelled) setTargets(rows)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setTargets([])
        setFailure(failureOf(error))
      })
    return () => {
      cancelled = true
    }
  }, [refundTransactionId])

  async function submit() {
    setIsSaving(true)
    setFailure(null)
    try {
      await linkRefund({
        data:
          selected === EXTERNAL
            ? { target: 'external', refundTransactionId }
            : {
                target: 'transaction',
                refundTransactionId,
                originalTransactionId: selected,
              },
      })
      onLinked()
      onOpenChange(false)
    } catch (error) {
      // The over-refund and cross-currency refusals land here, and they are the point of the
      // stage: the dialog stays open with the reason on it rather than closing on a failure.
      setFailure(failureOf(error))
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
              title={t('refunds.dialog.title')}
              description={t('refunds.dialog.description')}
              closeLabel={t('action.close')}
              onClose={close}
            />

            <Form
              onSubmit={(event) => {
                event.preventDefault()
                if (!isSaving) void submit()
              }}
              className="contents"
            >
              <DialogBody className="flex flex-col gap-5">
                {failure === null ? null : (
                  <FailurePanel
                    failure={failure}
                    placement="after-action"
                    title={t('refunds.dialog.error.title')}
                    // A refused link (over-refund, another currency, the wrong direction) is a
                    // conflict or a validation failure, and the kind sentence alone would say
                    // "reload": the dialog's own sentence says what to change instead.
                    body={
                      failure.kind === 'conflict' ||
                      failure.kind === 'validation'
                        ? t('refunds.dialog.error.refused')
                        : undefined
                    }
                  />
                )}

                {targets === null ? (
                  <p className="flex items-center gap-2 text-caption text-ink-2">
                    <Spinner label={null} />
                    {t('refunds.suggest.loading')}
                  </p>
                ) : (
                  <RadioGroup
                    label={t('refunds.dialog.field')}
                    description={t('refunds.dialog.ranking')}
                    value={selected}
                    onChange={setSelected}
                    isDisabled={isSaving}
                  >
                    {targets.map((target) => (
                      <Radio
                        key={target.transaction.id}
                        value={target.transaction.id}
                        description={describe(t, locale, target)}
                      >
                        {t('refunds.dialog.option', {
                          amount: formatMoney(
                            locale,
                            makeMoney(
                              target.transaction.amountMinor,
                              target.transaction.currencyCode,
                            ),
                          ),
                          date: formatCalendarDate(
                            locale,
                            target.transaction.bookedOn,
                            'medium',
                          ),
                        })}
                      </Radio>
                    ))}

                    <Radio
                      value={EXTERNAL}
                      description={t('refunds.dialog.external.help')}
                    >
                      {t('refunds.dialog.external')}
                    </Radio>
                  </RadioGroup>
                )}

                {targets !== null && targets.length === 0 ? (
                  <p className="prose-measure text-caption text-ink-2">
                    {t('refunds.suggest.empty')}
                  </p>
                ) : null}
              </DialogBody>

              <DialogFooter>
                <Button variant="ghost" onPress={close}>
                  {t('refunds.dialog.cancel')}
                </Button>
                <Button type="submit" variant="primary" isPending={isSaving}>
                  {t('refunds.dialog.submit')}
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
 * Why this suggestion is on the list, as one sentence.
 *
 * Built from the figures the repository ranked on — the surplus and the day count — so the
 * explanation cannot drift away from the ordering it explains. What is already refunded is added
 * only when there is some, because "0,00 zł of it is already refunded" is noise on the nine
 * suggestions out of ten where nothing is.
 */
function describe(t: Translate, locale: Locale, target: RefundTarget): string {
  const money = (minor: number) =>
    formatMoney(locale, makeMoney(minor, target.transaction.currencyCode))

  const when =
    target.daysApart === 0
      ? t('refunds.suggest.when.sameDay')
      : t('refunds.suggest.when.earlier', { count: target.daysApart })

  const reason =
    target.surplusMinor === 0
      ? t('refunds.suggest.reason.exact', { when })
      : t('refunds.suggest.reason.larger', {
          surplus: money(target.surplusMinor),
          when,
        })

  return target.alreadyRefundedMinor === 0
    ? reason
    : `${reason} ${t('refunds.suggest.alreadyRefunded', {
        amount: money(target.alreadyRefundedMinor),
      })}`
}
