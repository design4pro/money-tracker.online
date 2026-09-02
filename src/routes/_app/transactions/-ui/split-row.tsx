import { ChevronDown, ChevronUp, X } from 'lucide-react'

import { AmountField } from '#/components/app/accounts'
import { Button, Select, SelectItem, TextField } from '#/components/ui'

import type { Key } from 'react-aria-components'
import type { CategoryOption } from '#/components/app/transactions'
import type { Locale, Translate } from '#/lib/i18n'
import type { Minor } from '#/lib/money'

/**
 * One line of a split, as the editor holds it before it is written.
 *
 * `amountMinor` is `Minor | null` — integer minor units or an empty box, never a float and never a
 * string that some later layer has to parse. `key` is a client-side identity that survives a
 * reorder and a removal, and is deliberately **not** the row id: a line that has never been saved
 * has no id, and using the array index instead would make React reuse the box somebody was typing
 * in for a different line.
 */
export interface SplitDraft {
  readonly key: string
  readonly categoryId: string | null
  readonly amountMinor: Minor | null
  readonly note: string
}

/** The sentinel the category picker uses for "no category", because a `Select` key cannot be null. */
export const NO_CATEGORY = '__none__'

export interface SplitRowProps {
  /** One-based, because it is read out loud: _"Line 2"_, not _"Line 1"_ for the second one. */
  readonly position: number
  readonly count: number
  readonly value: SplitDraft
  readonly categories: ReadonlyArray<CategoryOption>
  readonly currencyCode: string
  readonly locale: Locale
  readonly t: Translate
  readonly isDisabled: boolean
  readonly onChange: (next: SplitDraft) => void
  readonly onRemove: () => void
  /** `-1` up, `1` down. The editor owns the bounds; the buttons here are simply hidden at them. */
  readonly onMove: (direction: -1 | 1) => void
  /** Tells the editor which line **Assign the remainder** should land on. */
  readonly onActivate: () => void
}

/**
 * A row is a `<fieldset>` with a legend, not a table row.
 *
 * A table of editable controls announces "row 2, column 3" and leaves the reader to work out which
 * line they are in; a fieldset announces _"Line 2"_ around every control it holds, which is the
 * thing they actually needed. It also degrades correctly at 360 px, where the three fields stack
 * and a table would not.
 *
 * Every control carries a **visible** label. Three visible labels per line is more ink than a
 * placeholder-only row, and it is the difference between a form somebody can fill in and one they
 * have to guess at once the placeholder disappears under their own typing.
 *
 * Reordering is two buttons rather than a drag handle. Drag is a pointer gesture with no keyboard
 * equivalent unless one is built, and the keyboard equivalent *is* these buttons — so they are the
 * control, and there is one way to do it rather than two that can disagree.
 */
export function SplitRow({
  position,
  count,
  value,
  categories,
  currencyCode,
  locale,
  t,
  isDisabled,
  onChange,
  onRemove,
  onMove,
  onActivate,
}: SplitRowProps) {
  return (
    <fieldset
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface-2 p-3 sm:flex-row sm:items-end"
      onFocus={onActivate}
      disabled={isDisabled}
    >
      <legend className="sr-only">
        {t('splits.row.legend', { position })}
      </legend>

      <Select
        label={t('splits.row.category')}
        className="sm:flex-1"
        selectedKey={value.categoryId ?? NO_CATEGORY}
        onSelectionChange={(key: Key | null) => {
          if (key === null) return
          const categoryId = key === NO_CATEGORY ? null : String(key)
          onChange({ ...value, categoryId })
        }}
      >
        <SelectItem id={NO_CATEGORY}>
          {t('splits.row.category.none')}
        </SelectItem>
        {categories.map((category) => (
          <SelectItem key={category.id} id={category.id}>
            {category.name}
          </SelectItem>
        ))}
      </Select>

      <AmountField
        locale={locale}
        label={t('splits.row.amount')}
        currencyCode={currencyCode}
        value={value.amountMinor}
        onChange={(amountMinor) => onChange({ ...value, amountMinor })}
        invalidMessage={t('validation.amount.invalid')}
        className="sm:w-40"
      />

      <TextField
        label={t('splits.row.note')}
        value={value.note}
        onChange={(note) => onChange({ ...value, note })}
        maxLength={140}
        className="sm:flex-1"
      />

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          shape="icon"
          size="sm"
          icon={<ChevronUp />}
          label={t('splits.row.moveUp', { position })}
          isDisabled={position === 1}
          onPress={() => onMove(-1)}
        />
        <Button
          variant="ghost"
          shape="icon"
          size="sm"
          icon={<ChevronDown />}
          label={t('splits.row.moveDown', { position })}
          isDisabled={position === count}
          onPress={() => onMove(1)}
        />
        <Button
          variant="ghost"
          shape="icon"
          size="sm"
          icon={<X />}
          label={t('splits.row.remove', { position })}
          // Two lines is the minimum a split can be: removing one of two is "remove the split",
          // which is its own button under the editor rather than a surprise consequence of this one.
          isDisabled={count <= 2}
          onPress={onRemove}
        />
      </div>
    </fieldset>
  )
}
