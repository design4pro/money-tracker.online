import { seriesVarForHex } from '#/components/app/categories'
import { Button } from '#/components/ui'
import { cn } from '#/lib/cn'
import { useTranslate } from '#/lib/i18n'

import type { BudgetSummary } from '#/server/budgets/summary'

/**
 * What this budget is allocated to: the categories it follows, or the note that it does not
 * follow any.
 *
 * ## The chip carries the category's own colour, and never only that
 *
 * The swatch is a 8px dot next to the name, not a coloured pill the name sits inside. A category
 * identified by hue alone is unreadable to a reader with deuteranopia and invisible in a
 * forced-colours theme; the name is always there, at full contrast, and the dot is the second
 * channel rather than the first. It is `aria-hidden` for the same reason — announcing "teal" to a
 * screen reader adds nothing the name has not said.
 *
 * ## Subcategories are covered and are not listed
 *
 * A budget on *Food* counts *Food → Groceries* too. Listing every child would turn a four-chip
 * row into a twenty-chip wall that says the same thing, so the sentence above the chips states
 * the rule once and the chips list what was actually chosen.
 */

export interface CategoryAllocationProps {
  readonly kind: BudgetSummary['kind']
  readonly categories: BudgetSummary['categories']
  /** Opens the category picker. Omitted on an archived budget, which is read-only in practice. */
  readonly onEdit?: () => void
  readonly className?: string
}

export function CategoryAllocation({
  kind,
  categories,
  onEdit,
  className,
}: CategoryAllocationProps) {
  const t = useTranslate()

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <p className="text-body text-ink-2">
        {kind === 'manual'
          ? t('budgets.allocation.manual')
          : t('budgets.allocation.body')}
      </p>

      {kind === 'category' ? (
        categories.length === 0 ? (
          <p className="text-caption text-ink-2">
            {t('budgets.categories.none')}
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <li
                key={category.id}
                className="inline-flex items-center gap-2 rounded-full border border-border-strong bg-surface px-2.5 py-1 text-caption text-ink"
              >
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={{
                    backgroundColor:
                      seriesVarForHex(category.color) ?? category.color,
                  }}
                />
                {category.name}
              </li>
            ))}
          </ul>
        )
      ) : null}

      {kind === 'category' && onEdit !== undefined ? (
        <div>
          <Button variant="secondary" size="sm" onPress={onEdit}>
            {t('budgets.allocation.edit')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
