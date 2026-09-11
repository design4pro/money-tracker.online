import { ChevronDown, ChevronUp, X } from 'lucide-react'

import {
  Button,
  ComboBox,
  ComboBoxItem,
  MoneyField,
  Select,
  SelectItem,
  TextAreaField,
  TextField,
} from '#/components/ui'
import {
  MAX_IDS_PER_CONDITION,
  MAX_KEYWORDS_PER_CONDITION,
  MAX_KEYWORD_LENGTH,
  RULE_CONDITION_FIELDS,
} from '#/server/rules/schema'

import {
  OPERATORS_BY_SHAPE,
  conditionShapeOf,
  defaultOperatorFor,
} from '../-lib/draft'

import type { Key } from 'react-aria-components'
import type { Locale, MessageKey, Translate } from '#/lib/i18n'
import type { RuleConditionField } from '#/server/rules/schema'
import type { ConditionDraft, DraftOperator } from '../-lib/draft'

/**
 * One `when` row: a field, a comparison, and whatever that pairing needs.
 *
 * ---------------------------------------------------------------------------
 * NINE FIELDS, FIVE LAYOUTS
 * ---------------------------------------------------------------------------
 *
 * The operator vocabulary is closed **per field type**, not per field (`-lib/draft.ts`), so this
 * component renders five value layouts rather than nine: keywords, an id set, a day list, an
 * amount, and a direction. Switching the field keeps everything the person had typed — the draft is
 * one flat record for exactly that reason — so choosing `payee` after typing two keywords under
 * `note` loses nothing.
 *
 * `direction` renders **no comparison control at all**. With two directions "is not income" is a
 * second spelling of "is expense", so the schema gives it no operator and the row shows none —
 * rather than a disabled picker that invites somebody to wonder what it would have done.
 *
 * ---------------------------------------------------------------------------
 * A FIELDSET, NOT A TABLE ROW
 * ---------------------------------------------------------------------------
 *
 * A table of editable controls announces "row 2, column 3" and leaves the reader to work out which
 * condition they are in; a `<fieldset>` with a legend announces _"Condition 2"_ around every control
 * it holds. It also stacks correctly at 360 px, which a table does not.
 *
 * Reordering is two buttons rather than a drag handle. A condition list's order does not change
 * what it means — `all` and `any` are both commutative — so the buttons are a convenience for
 * reading, and building a drag path beside them would be two implementations of one thing.
 */
export interface ConditionRowProps {
  /** One-based, because it is read aloud: _"Condition 2"_. */
  readonly position: number
  readonly count: number
  readonly value: ConditionDraft
  readonly reference: ConditionReference
  readonly locale: Locale
  readonly t: Translate
  readonly isDisabled: boolean
  readonly onChange: (next: ConditionDraft) => void
  readonly onRemove: () => void
  /** `-1` up, `1` down. The editor owns the bounds; the buttons are disabled at them. */
  readonly onMove: (direction: -1 | 1) => void
}

/** The four id vocabularies a condition can name, plus the currencies an amount may be written in. */
export interface ConditionReference {
  readonly accounts: ReadonlyArray<NamedOption>
  readonly accountGroups: ReadonlyArray<NamedOption>
  readonly categories: ReadonlyArray<NamedOption>
  readonly tags: ReadonlyArray<NamedOption>
  readonly currencyCodes: ReadonlyArray<string>
}

export interface NamedOption {
  readonly id: string
  readonly name: string
}

/** Each field's label, as a table so a tenth field is a compile error rather than a blank option. */
const FIELD_LABEL: Readonly<Record<RuleConditionField, MessageKey>> = {
  note: 'rules.field.note',
  payee: 'rules.field.payee',
  account: 'rules.field.account',
  account_group: 'rules.field.account_group',
  amount: 'rules.field.amount',
  direction: 'rules.field.direction',
  day_of_month: 'rules.field.day_of_month',
  tag: 'rules.field.tag',
  category: 'rules.field.category',
}

const OPERATOR_LABEL: Readonly<Record<DraftOperator, MessageKey>> = {
  contains: 'rules.operator.contains',
  not_contains: 'rules.operator.not_contains',
  is_any_of: 'rules.operator.is_any_of',
  is_none_of: 'rules.operator.is_none_of',
  eq: 'rules.operator.eq',
  gt: 'rules.operator.gt',
  gte: 'rules.operator.gte',
  lt: 'rules.operator.lt',
  lte: 'rules.operator.lte',
}

export function ConditionRow({
  position,
  count,
  value,
  reference,
  locale,
  t,
  isDisabled,
  onChange,
  onRemove,
  onMove,
}: ConditionRowProps) {
  const shape = conditionShapeOf(value.field)
  const operators = OPERATORS_BY_SHAPE[shape]

  return (
    <fieldset
      className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-sunken p-3"
      disabled={isDisabled}
    >
      <legend className="sr-only">
        {t('rules.condition.legend', { position })}
      </legend>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Select
          label={t('rules.condition.field')}
          className="sm:w-48"
          selectedKey={value.field}
          onSelectionChange={(key: Key | null) => {
            if (key === null) return
            const field = key as RuleConditionField
            // The operator has to move with the field: a text row switched onto `amount` would
            // otherwise carry `contains`, which `toCondition` would silently reinterpret.
            onChange({ ...value, field, operator: defaultOperatorFor(field) })
          }}
        >
          {RULE_CONDITION_FIELDS.map((field) => (
            <SelectItem
              key={field}
              id={field}
              textValue={t(FIELD_LABEL[field])}
            >
              {t(FIELD_LABEL[field])}
            </SelectItem>
          ))}
        </Select>

        {operators.length === 0 ? null : (
          <Select
            label={t('rules.condition.operator')}
            className="sm:w-44"
            selectedKey={value.operator}
            onSelectionChange={(key: Key | null) => {
              if (key === null) return
              onChange({ ...value, operator: key as DraftOperator })
            }}
          >
            {operators.map((operator) => (
              <SelectItem
                key={operator}
                id={operator}
                textValue={t(OPERATOR_LABEL[operator])}
              >
                {t(OPERATOR_LABEL[operator])}
              </SelectItem>
            ))}
          </Select>
        )}

        <div className="flex items-center gap-1 sm:ms-auto sm:pb-1">
          <Button
            variant="ghost"
            shape="icon"
            size="sm"
            icon={<ChevronUp aria-hidden="true" />}
            label={t('rules.condition.moveUp', { position })}
            isDisabled={position === 1}
            onPress={() => onMove(-1)}
          />
          <Button
            variant="ghost"
            shape="icon"
            size="sm"
            icon={<ChevronDown aria-hidden="true" />}
            label={t('rules.condition.moveDown', { position })}
            isDisabled={position === count}
            onPress={() => onMove(1)}
          />
          <Button
            variant="ghost"
            shape="icon"
            size="sm"
            icon={<X aria-hidden="true" />}
            label={t('rules.condition.remove', { position })}
            onPress={onRemove}
          />
        </div>
      </div>

      <ConditionValue
        value={value}
        reference={reference}
        locale={locale}
        t={t}
        onChange={onChange}
      />
    </fieldset>
  )
}

/* -------------------------------------------------------------------------- */
/* The five value layouts                                                     */
/* -------------------------------------------------------------------------- */

function ConditionValue({
  value,
  reference,
  locale,
  t,
  onChange,
}: {
  readonly value: ConditionDraft
  readonly reference: ConditionReference
  readonly locale: Locale
  readonly t: Translate
  readonly onChange: (next: ConditionDraft) => void
}) {
  switch (conditionShapeOf(value.field)) {
    case 'text':
      return (
        <TextAreaField
          label={t('rules.condition.keywords')}
          // One per line rather than comma-separated: a merchant string can contain a comma, and a
          // separator that appears inside the values is a parser nobody can predict.
          description={t('rules.condition.keywords.description')}
          rows={2}
          value={value.keywords.join('\n')}
          onChange={(text) =>
            onChange({
              ...value,
              keywords: text
                .split('\n')
                .map((line) => line.slice(0, MAX_KEYWORD_LENGTH))
                .slice(0, MAX_KEYWORDS_PER_CONDITION),
            })
          }
        />
      )

    case 'ids':
      return (
        <IdPicker
          label={t('rules.condition.values')}
          options={optionsFor(value.field, reference)}
          selected={value.ids}
          t={t}
          onChange={(ids) => onChange({ ...value, ids })}
        />
      )

    case 'days':
      return (
        <TextField
          label={t('rules.condition.days')}
          description={t('rules.condition.days.description')}
          value={value.daysText}
          inputMode="numeric"
          autoComplete="off"
          isInvalid={value.days.length === 0 && value.daysText.trim() !== ''}
          errorMessage={t('rules.condition.days.invalid')}
          onChange={(text) => onChange({ ...value, ...parseDays(text) })}
        />
      )

    case 'amount':
      return (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <MoneyField
            locale={locale}
            label={t('rules.condition.amount')}
            currencyCode={value.currencyCode}
            value={value.amountMinor}
            onChange={(amountMinor) => onChange({ ...value, amountMinor })}
            invalidMessage={t('validation.amount.invalid')}
            className="sm:w-44"
          />
          <Select
            label={t('rules.condition.currency')}
            description={t('rules.condition.currency.description')}
            className="sm:w-44"
            selectedKey={value.currencyCode}
            onSelectionChange={(key: Key | null) => {
              if (key === null) return
              onChange({ ...value, currencyCode: String(key) })
            }}
          >
            {reference.currencyCodes.map((code) => (
              <SelectItem key={code} id={code} textValue={code}>
                {code}
              </SelectItem>
            ))}
          </Select>
        </div>
      )

    case 'enum':
      return (
        <Select
          label={t('rules.condition.direction')}
          className="sm:w-44"
          selectedKey={value.direction}
          onSelectionChange={(key: Key | null) => {
            if (key === null) return
            onChange({
              ...value,
              direction: key === 'income' ? 'income' : 'expense',
            })
          }}
        >
          <SelectItem
            id="expense"
            textValue={t('rules.condition.direction.expense')}
          >
            {t('rules.condition.direction.expense')}
          </SelectItem>
          <SelectItem
            id="income"
            textValue={t('rules.condition.direction.income')}
          >
            {t('rules.condition.direction.income')}
          </SelectItem>
        </Select>
      )
  }
}

/** Which vocabulary an id condition draws from. */
function optionsFor(
  field: RuleConditionField,
  reference: ConditionReference,
): ReadonlyArray<NamedOption> {
  switch (field) {
    case 'account':
      return reference.accounts
    case 'account_group':
      return reference.accountGroups
    case 'category':
      return reference.categories
    case 'tag':
      return reference.tags
    default:
      return []
  }
}

/**
 * `"1, 15, 31"` → the days, and the text as typed.
 *
 * Both are kept: the days are what the condition means, and the raw text is what lets somebody type
 * a comma without the field rewriting itself under their cursor. A token that is not 1–31 is
 * dropped from the days and the field reports itself invalid — it does not clamp, because a rule
 * that fired on the 30th because somebody typed 35 is a rule they did not write.
 */
function parseDays(text: string): {
  readonly days: ReadonlyArray<number>
  readonly daysText: string
} {
  const days = text
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token !== '')
    .map((token) => Number(token))
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= 31)
  return { days: [...new Set(days)], daysText: text }
}

/* -------------------------------------------------------------------------- */
/* The id picker                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Up to twenty ids, added one at a time and removed individually.
 *
 * A `ComboBox` rather than a multi-select list, because the vocabularies are open-ended — a
 * workspace can hold fifty categories — and a list of fifty checkboxes inside a condition row is
 * not a control anybody can use. The chosen values are rendered as their own removable buttons
 * below it, each named after what it removes, so the set is readable and editable without opening
 * the picker again.
 *
 * An empty vocabulary says so rather than offering a picker that can only be opened to find
 * nothing.
 */
function IdPicker({
  label,
  options,
  selected,
  t,
  onChange,
}: {
  readonly label: string
  readonly options: ReadonlyArray<NamedOption>
  readonly selected: ReadonlyArray<string>
  readonly t: Translate
  readonly onChange: (ids: ReadonlyArray<string>) => void
}) {
  const chosen = new Set(selected)
  const available = options.filter((option) => !chosen.has(option.id))
  const isFull = selected.length >= MAX_IDS_PER_CONDITION
  const nameOf = new Map(options.map((option) => [option.id, option.name]))

  if (options.length === 0) {
    return (
      <p className="text-caption text-ink-2">
        {t('rules.condition.values.empty')}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <ComboBox
        label={label}
        toggleLabel={t('rules.condition.values.toggle')}
        placeholder={t('rules.condition.values.add')}
        description={
          isFull
            ? t('rules.condition.values.full', {
                count: MAX_IDS_PER_CONDITION,
              })
            : undefined
        }
        isDisabled={isFull}
        // The box empties itself after each pick, so the next value is one keystroke away rather
        // than behind a manual clear.
        selectedKey={null}
        items={available}
        emptyState={t('rules.condition.values.noMatch')}
        onSelectionChange={(key: Key | null) => {
          if (key === null) return
          onChange([...selected, String(key)])
        }}
      >
        {(option: NamedOption) => (
          <ComboBoxItem id={option.id} textValue={option.name}>
            {option.name}
          </ComboBoxItem>
        )}
      </ComboBox>

      {selected.length === 0 ? (
        <p className="text-caption text-ink-2">
          {t('rules.condition.values.none')}
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {selected.map((id) => {
            const name = nameOf.get(id) ?? id
            return (
              <li key={id}>
                <Button
                  variant="secondary"
                  size="sm"
                  iconAfter={<X aria-hidden="true" />}
                  onPress={() =>
                    onChange(selected.filter((candidate) => candidate !== id))
                  }
                >
                  <span className="sr-only">
                    {t('rules.condition.values.remove', { name })}
                  </span>
                  <span aria-hidden="true">{name}</span>
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
