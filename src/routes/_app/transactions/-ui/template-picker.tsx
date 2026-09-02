import { useState } from 'react'

import { ErrorPanel } from '#/components/app/accounts'
import { Badge, Button, Card, toast } from '#/components/ui'
import { useLocale, useTranslate } from '#/lib/i18n'
import { formatMoney, makeMoney } from '#/lib/money'
import { applyTemplate } from '#/server/fns/transaction-groups'

import type {
  TransactionDraft,
  TransactionTemplateSummary,
} from '#/server/repos/transaction-templates'

/**
 * The template picker: saved shapes for the entry form, and the one thing pressing them does not
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
 * ## What each button says
 *
 * A template with an amount prints it with its currency; one without says *"you type the
 * amount"* — which is half the point of a template and reads as a promise rather than as a
 * missing value. Both are text on the button, so a screen reader's element list is a list of
 * different templates rather than seven buttons called "Use".
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

  /** The amount on the button, or the promise that stands in for it. */
  function amountOf(template: TransactionTemplateSummary): string {
    if (template.amountMinor === null || template.currencyCode === null) {
      return t('templates.picker.noAmount')
    }
    return formatMoney(
      locale,
      makeMoney(template.amountMinor, template.currencyCode),
    )
  }

  return (
    <Card
      as="section"
      aria-labelledby="template-picker-heading"
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1">
        <h2
          id="template-picker-heading"
          className="text-body font-semibold text-ink"
        >
          {t('templates.picker.title')}
        </h2>
        <p className="text-caption text-ink-2">
          {t('templates.picker.description')}
        </p>
      </div>

      {failure === null ? null : (
        <ErrorPanel
          title={t('templates.picker.error.title')}
          body={t('empty.error.body')}
          detail={failure}
        />
      )}

      <ul
        aria-label={t('templates.picker.label')}
        className="flex flex-wrap gap-2"
      >
        {templates.map((template) => (
          <li key={template.id}>
            <Button
              variant="secondary"
              size="sm"
              isPending={pending === template.id}
              isDisabled={isDisabled}
              onPress={() => void apply(template)}
            >
              <span className="flex items-center gap-2">
                <span>{template.name}</span>
                <Badge tone="neutral" size="sm">
                  {amountOf(template)}
                </Badge>
              </span>
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  )
}
