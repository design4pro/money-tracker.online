import { Radio, RadioGroup } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'

import { CategorySwatch } from './category-swatch'
import { CATEGORY_HUES, hueLabelKey } from './palette'

export interface CategoryColourFieldProps {
  /** The stored colour, as the repository holds it. Never empty. */
  readonly value: string
  readonly onChange: (value: string) => void
}

/**
 * The colour a category is painted with, as a radio group.
 *
 * ## Why the stored colour is always one of the options
 *
 * The eight named hues are what this product *offers* (see `palette.ts`), but not what it
 * *accepts* — an imported category carries whatever colour it came with. Offering only the eight
 * while the group's value was a ninth colour did not merely look odd: React Aria derives a radio
 * group's single tab stop from the selected value, and when the value matches no option **every**
 * radio gets `tabIndex="-1"`. Tab skipped the whole group and the arrow keys did nothing, so a
 * keyboard user editing an imported category could not change its colour at all. That is WCAG 2.2
 * §2.1.1 Keyboard, level A — the control was operable with a mouse and not with a keyboard.
 *
 * So a colour outside the eight is rendered as a ninth option, present only while it is the stored
 * value. The group always has a selected member, which restores the tab stop; the reader sees the
 * colour their data actually has rather than a group where nothing is chosen; and nobody gains the
 * ability to *pick* an arbitrary colour, because the option exists only for a value already saved.
 *
 * Its name is the hex itself. `hueLabelKey` returns `null` here by design — this product has no
 * honest word for `#4c6ef5` — and a hex is at least a fact the reader can act on.
 */
export function CategoryColourField({
  value,
  onChange,
}: CategoryColourFieldProps) {
  const t = useTranslate()
  const custom = hueLabelKey(value) === null ? value : null

  return (
    <RadioGroup
      label={t('common.colour')}
      description={t('categories.field.colour.help')}
      orientation="horizontal"
      value={value}
      onChange={onChange}
    >
      {CATEGORY_HUES.map((hue) => (
        <Radio key={hue.value} value={hue.value}>
          <span className="inline-flex items-center gap-2">
            <CategorySwatch color={hue.value} isLabelledBeside />
            {t(hue.labelKey)}
          </span>
        </Radio>
      ))}
      {custom === null ? null : (
        <Radio value={custom}>
          <span className="inline-flex items-center gap-2">
            <CategorySwatch color={custom} isLabelledBeside />
            <span className="tabular-nums">{custom}</span>
          </span>
        </Radio>
      )}
    </RadioGroup>
  )
}
