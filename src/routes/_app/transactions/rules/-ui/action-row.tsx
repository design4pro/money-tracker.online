import { ChevronDown, ChevronUp, X } from 'lucide-react'

import { PAYMENT_METHOD_KEY } from '#/components/app/transactions'
import {
  Button,
  ComboBox,
  ComboBoxItem,
  Select,
  SelectItem,
  Switch,
  TextField,
} from '#/components/ui'
import { PAYMENT_METHODS } from '#/lib/enums'
import {
  MAX_ACTION_NOTE_LENGTH,
  RULE_ACTION_KINDS,
} from '#/server/rules/schema'

import type { Key } from 'react-aria-components'
import type { MessageKey, Translate } from '#/lib/i18n'
import type { PaymentMethod } from '#/server/db/schema'
import type { RuleActionKind } from '#/server/rules/schema'
import type { ActionDraft } from '../-lib/draft'
import type { NamedOption } from './condition-row'

/**
 * One `then` row: what the rule does when it matches.
 *
 * ---------------------------------------------------------------------------
 * EIGHT KINDS, AND NOT ONE OF THEM TOUCHES AN AMOUNT
 * ---------------------------------------------------------------------------
 *
 * The list comes from `#/server/rules/schema` and is closed at eight precisely so a rule run can
 * skip the ledger batch: a category, a payee, two tag operations, a note, a payment method and two
 * flags. There is deliberately no control here for an amount, a currency or a date, and adding one
 * would be a schema change and a different review — see `src/server/rules/apply.ts`.
 *
 * ---------------------------------------------------------------------------
 * THE TWO FLAGS ARE SWITCHES, BOTH WAYS
 * ---------------------------------------------------------------------------
 *
 * `mark_planned` and `set_excluded` each carry a boolean rather than being one-way. A rule that can
 * only ever set a flag cannot undo what an earlier rule set, and "unplan this" is a real thing to
 * want. The `Switch` reads its state as a position as well as a colour, which is what keeps it
 * legible when the colour is not.
 *
 * Structure and reordering follow `condition-row.tsx` exactly: a `<fieldset>` with a legend, two
 * move buttons and a remove button, all named after the position they act on.
 */
export interface ActionRowProps {
  readonly position: number
  readonly count: number
  readonly value: ActionDraft
  readonly reference: ActionReference
  readonly t: Translate
  readonly isDisabled: boolean
  readonly onChange: (next: ActionDraft) => void
  readonly onRemove: () => void
  readonly onMove: (direction: -1 | 1) => void
}

/** The three vocabularies an action can name. */
export interface ActionReference {
  readonly categories: ReadonlyArray<NamedOption>
  readonly payees: ReadonlyArray<NamedOption>
  readonly tags: ReadonlyArray<NamedOption>
}

/** One label per kind. A ninth kind is a compile error rather than a blank option. */
const KIND_LABEL: Readonly<Record<RuleActionKind, MessageKey>> = {
  set_category: 'rules.action.set_category',
  set_payee: 'rules.action.set_payee',
  add_tag: 'rules.action.add_tag',
  remove_tag: 'rules.action.remove_tag',
  set_note: 'rules.action.set_note',
  set_payment_method: 'rules.action.set_payment_method',
  mark_planned: 'rules.action.mark_planned',
  set_excluded: 'rules.action.set_excluded',
}

export function ActionRow({
  position,
  count,
  value,
  reference,
  t,
  isDisabled,
  onChange,
  onRemove,
  onMove,
}: ActionRowProps) {
  return (
    <fieldset
      className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-sunken p-3 sm:flex-row sm:items-end"
      disabled={isDisabled}
    >
      <legend className="sr-only">
        {t('rules.action.legend', { position })}
      </legend>

      <Select
        label={t('rules.action.kind')}
        className="sm:w-56"
        selectedKey={value.kind}
        onSelectionChange={(key: Key | null) => {
          if (key === null) return
          onChange({ ...value, kind: key as RuleActionKind })
        }}
      >
        {RULE_ACTION_KINDS.map((kind) => (
          <SelectItem key={kind} id={kind} textValue={t(KIND_LABEL[kind])}>
            {t(KIND_LABEL[kind])}
          </SelectItem>
        ))}
      </Select>

      <div className="min-w-0 sm:flex-1">
        <ActionValue
          value={value}
          reference={reference}
          t={t}
          onChange={onChange}
        />
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          shape="icon"
          size="sm"
          icon={<ChevronUp aria-hidden="true" />}
          label={t('rules.action.moveUp', { position })}
          isDisabled={position === 1}
          onPress={() => onMove(-1)}
        />
        <Button
          variant="ghost"
          shape="icon"
          size="sm"
          icon={<ChevronDown aria-hidden="true" />}
          label={t('rules.action.moveDown', { position })}
          isDisabled={position === count}
          onPress={() => onMove(1)}
        />
        <Button
          variant="ghost"
          shape="icon"
          size="sm"
          icon={<X aria-hidden="true" />}
          label={t('rules.action.remove', { position })}
          onPress={onRemove}
        />
      </div>
    </fieldset>
  )
}

/** The one value control each kind needs. Exhaustive over the eight. */
function ActionValue({
  value,
  reference,
  t,
  onChange,
}: {
  readonly value: ActionDraft
  readonly reference: ActionReference
  readonly t: Translate
  readonly onChange: (next: ActionDraft) => void
}) {
  switch (value.kind) {
    case 'set_category':
      return (
        <OnePicker
          label={t('rules.action.value.category')}
          options={reference.categories}
          selected={value.categoryId}
          t={t}
          onChange={(categoryId) => onChange({ ...value, categoryId })}
        />
      )
    case 'set_payee':
      return (
        <OnePicker
          label={t('rules.action.value.payee')}
          options={reference.payees}
          selected={value.payeeId}
          t={t}
          onChange={(payeeId) => onChange({ ...value, payeeId })}
        />
      )
    case 'add_tag':
    case 'remove_tag':
      return (
        <OnePicker
          label={t('rules.action.value.tag')}
          options={reference.tags}
          selected={value.tagId}
          t={t}
          onChange={(tagId) => onChange({ ...value, tagId })}
        />
      )
    case 'set_note':
      return (
        <TextField
          label={t('rules.action.value.note')}
          value={value.note}
          maxLength={MAX_ACTION_NOTE_LENGTH}
          onChange={(note) => onChange({ ...value, note })}
        />
      )
    case 'set_payment_method':
      return (
        <Select
          label={t('rules.action.value.paymentMethod')}
          selectedKey={value.paymentMethod}
          onSelectionChange={(key: Key | null) => {
            if (key === null) return
            onChange({ ...value, paymentMethod: key as PaymentMethod })
          }}
        >
          {PAYMENT_METHODS.map((method) => (
            <SelectItem
              key={method}
              id={method}
              textValue={t(PAYMENT_METHOD_KEY[method])}
            >
              {t(PAYMENT_METHOD_KEY[method])}
            </SelectItem>
          ))}
        </Select>
      )
    case 'mark_planned':
      return (
        <Switch
          isSelected={value.flag}
          onChange={(flag) => onChange({ ...value, flag })}
          // Un-planning settles a row, which the booking rule refuses for a future date: say so
          // in text, where the rule asks for it (`#/server/rules/apply`).
          description={
            value.flag
              ? undefined
              : t('rules.action.value.planned.waitsForDate')
          }
        >
          {t('rules.action.value.planned')}
        </Switch>
      )
    case 'set_excluded':
      return (
        <Switch
          isSelected={value.flag}
          onChange={(flag) => onChange({ ...value, flag })}
        >
          {t('rules.action.value.excluded')}
        </Switch>
      )
  }
}

/**
 * One id from a vocabulary.
 *
 * A `ComboBox` for the same reason the condition row uses one: fifty categories is a list somebody
 * types into, not one they scroll. An empty vocabulary says so rather than rendering a picker that
 * can only be opened to find nothing — which is the correct behaviour for a workspace that has
 * never made a tag, as well as for the one where tags are not built yet.
 */
function OnePicker({
  label,
  options,
  selected,
  t,
  onChange,
}: {
  readonly label: string
  readonly options: ReadonlyArray<NamedOption>
  readonly selected: string
  readonly t: Translate
  readonly onChange: (id: string) => void
}) {
  if (options.length === 0) {
    return (
      <p className="text-caption text-ink-2">{t('rules.action.value.empty')}</p>
    )
  }

  return (
    <ComboBox
      label={label}
      toggleLabel={t('rules.condition.values.toggle')}
      items={options}
      selectedKey={selected === '' ? null : selected}
      emptyState={t('rules.condition.values.noMatch')}
      onSelectionChange={(key: Key | null) =>
        onChange(key === null ? '' : String(key))
      }
    >
      {(option: NamedOption) => (
        <ComboBoxItem id={option.id} textValue={option.name}>
          {option.name}
        </ComboBoxItem>
      )}
    </ComboBox>
  )
}
