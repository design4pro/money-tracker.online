import { useId, useState } from 'react'

import { ErrorPanel } from '#/components/app/shell'
import { Button, toast } from '#/components/ui'
import { useLocale, useTranslate } from '#/lib/i18n'
import { formatMoney, makeMoney } from '#/lib/money'
import { applyTemplate } from '#/server/fns/transaction-groups'

import type {
  TransactionDraft,
  TransactionTemplateSummary,
} from '#/server/repos/transaction-templates'

/**
 * The template row: saved shapes for the entry form, and the one thing pressing them does not
 * do.
 *
 * ## Choosing a template fills a form. It never books a transaction.
 *
 * `applyTemplate` returns a **draft**, and this component hands that draft to its host through
 * {@link TemplatePickerProps.onApply}. Nothing here writes. A template that posted on selection
 * would have created a transaction nobody confirmed — with today's date and last month's amount —
 * and it would already be in the balance by the time it was noticed. So the toast says *the form
 * is filled in, nothing is saved yet*, in the same words for everybody, rather than leaving the
 * reader to work out whether a row now exists.
 *
 * ## One row of chips under the amount, not a card above it
 *
 * The row is a shortcut, so it takes one line: a caption at the start and one chip per template,
 * scrolling sideways on a phone rather than pushing the amount field down the page, and wrapping
 * where there is room. A chip is
 * the template's name and, when the template fixes one, its amount in the second ink; a template
 * that leaves the amount to the person says nothing about it, because an empty amount box under
 * a chip already says that. Both are text on the button, so a screen reader's element list is a
 * list of different templates rather than seven buttons called "Use".
 *
 * ## It holds no data of its own
 *
 * The templates arrive as a prop. There is no local copy to drift out of step with the list
 * behind it, and the picker renders nothing at all when the workspace has none — a control that
 * can only be opened to find it empty is worse than no control.
 */

export interface TemplatePickerProps {
  /** Every saved shape, in display order — `listTemplates()`. Empty renders nothing. */
  readonly templates: ReadonlyArray<TransactionTemplateSummary>
  /**
   * Called with the draft the server built. **The host fills its form from this and saves
   * nothing**: a draft carries no reference amount and no booking date, because both are decided
   * at write time against the day the person picks.
   */
  readonly onApply: (draft: TransactionDraft) => void
  /** Set while the host's form is submitting, so a template cannot land mid-save. */
  readonly isDisabled?: boolean
}

export function TemplatePicker({
  templates,
  onApply,
  isDisabled = false,
}: TemplatePickerProps) {
  const t = useTranslate()
  const locale = useLocale()
  const labelId = useId()

  const [pending, setPending] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  if (templates.length === 0) return null

  async function apply(template: TransactionTemplateSummary) {
    setPending(template.id)
    setFailure(null)
    try {
      const draft = await applyTemplate({ data: { templateId: template.id } })
      onApply(draft)
      // The sentence a person needs after pressing this: the form moved, the ledger did not.
      toast.success(t('templates.applied', { name: template.name }))
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setPending(null)
    }
  }

  /** The amount on the chip, or nothing when the template leaves it to the person. */
  function amountOf(template: TransactionTemplateSummary): string | null {
    if (template.amountMinor === null || template.currencyCode === null) {
      return null
    }
    return formatMoney(
      locale,
      makeMoney(template.amountMinor, template.currencyCode),
    )
  }

  return (
    <section
      aria-label={t('templates.picker.title')}
      className="flex flex-col gap-2"
    >
      <div className="flex items-start gap-3">
        {/* The caption is centred on the first 40px chip row, not on the block, so it stays put
            when the row wraps. */}
        <span
          id={labelId}
          className="flex h-10 shrink-0 items-center text-caption text-ink-2"
        >
          {t('templates.picker.label')}
        </span>
        {/* One sideways-scrolling line on a phone, a wrapping row from `sm`. `focus-safe`
            reserves room for a chip's focus ring inside the scroller; the negative margin gives
            that room back so the first chip lines up with the field above. */}
        <ul
          aria-labelledby={labelId}
          className="-m-1 flex min-w-0 flex-1 gap-2 overflow-x-auto focus-safe sm:flex-wrap"
        >
          {templates.map((template) => {
            const amount = amountOf(template)
            return (
              <li key={template.id} className="shrink-0">
                <Button
                  variant="secondary"
                  isPending={pending === template.id}
                  isDisabled={isDisabled}
                  onPress={() => void apply(template)}
                >
                  {template.name}
                  {amount === null ? null : (
                    <span className="tabular text-ink-2">{amount}</span>
                  )}
                </Button>
              </li>
            )
          })}
        </ul>
      </div>

      {failure === null ? null : (
        <ErrorPanel
          title={t('templates.picker.error.title')}
          body={t('empty.error.body')}
          detail={failure}
        />
      )}
    </section>
  )
}
