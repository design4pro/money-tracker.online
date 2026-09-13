import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'

import { ErrorPanel } from '#/components/app/shell'
import {
  Button,
  Card,
  Checkbox,
  CheckboxGroup,
  Select,
  SelectItem,
  TextField,
} from '#/components/ui'
import { useLocale, useTranslate } from '#/lib/i18n'
import {
  MAX_ACTIONS_PER_RULE,
  MAX_CONDITIONS_PER_RULE,
  RULE_TRIGGERS,
  ruleDefinitionSchema,
} from '#/server/rules/schema'

import {
  actionDraftFrom,
  actionsOf,
  amountRangeDrafts,
  blankAction,
  blankCondition,
  conditionDraftFrom,
  conditionsOf,
} from '../-lib/draft'
import { ruleSentence } from '../-lib/sentence'
import { ActionRow } from './action-row'
import { ConditionRow } from './condition-row'
import { RulePreview } from './rule-preview'

import type { Key } from 'react-aria-components'
import type { TransactionReference } from '#/components/app/transactions'
import type { MessageKey } from '#/lib/i18n'
import type {
  RuleDefinition,
  RuleMatchMode,
  RuleTrigger,
} from '#/server/rules/schema'
import type { ActionDraft, ConditionDraft } from '../-lib/draft'
import type { ActionReference } from './action-row'
import type { ConditionReference, NamedOption } from './condition-row'

/**
 * The when/then editor, shared by `/transactions/rules/new` and `/transactions/rules/$ruleId`.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS ONE COMPONENT AND TWO ROUTES
 * ---------------------------------------------------------------------------
 *
 * Creating a rule and editing one differ in exactly three things: what the drafts start as, what
 * the save button calls, and whether there is a delete. Everything else — six controls, two lists,
 * the sentence, the preview and every ceiling — is one screen, and two copies of it would drift the
 * first time a condition field is added. So the routes own the server calls and this owns the form.
 *
 * ---------------------------------------------------------------------------
 * THE SENTENCE IS ABOVE THE CONTROLS, NOT UNDER THEM
 * ---------------------------------------------------------------------------
 *
 * A rule's meaning is not in any one control, and six correct pickers can add up to a rule nobody
 * meant — `all` and `any` change what the same six mean. The sentence sits above them and updates
 * as they change, so the person verifies meaning rather than reassembling it from the controls.
 * It is **not** a live region: the preview beside it already announces, and two regions competing
 * on every keystroke is noise. See `-lib/sentence.ts`.
 *
 * ---------------------------------------------------------------------------
 * "BETWEEN" IS A BUTTON THAT ADDS TWO CONDITIONS
 * ---------------------------------------------------------------------------
 *
 * The schema has five amount operators and no `between`, on purpose. **Add an amount range** appends
 * `at least` and `at most` as two ordinary conditions, and the sentence immediately reads them back
 * as two — so nobody is surprised to find two rows where they pressed one button. It is offered only
 * under `Every condition`: under `Any condition` those two rows mean "at least 10 **or** at most 50",
 * which is every amount there is.
 *
 * ---------------------------------------------------------------------------
 * INCOMPLETE IS A STATE, NOT AN ERROR
 * ---------------------------------------------------------------------------
 *
 * A half-filled row contributes nothing to the sentence and nothing to the preview, and is not
 * scolded. The **save** is where incompleteness becomes a refusal, and it refuses through
 * `ruleDefinitionSchema` — the same schema the repository re-parses with — rather than through a
 * second opinion written here.
 */
export interface RuleEditorProps {
  readonly title: string
  readonly initial: RuleEditorInitialValue
  readonly reference: RuleEditorReference
  readonly isSaving: boolean
  /** The failure of the last save attempt, as a sentence. `null` when there has not been one. */
  readonly saveError: string | null
  readonly onSave: (definition: RuleDefinition) => void
  readonly onCancel: () => void
  /** Absent on the create route: there is nothing to delete yet. */
  readonly onDelete?: () => void
}

/** What the editor opens on. `null` conditions and actions mean "a fresh rule". */
export interface RuleEditorInitialValue {
  readonly name: string
  readonly matchMode: RuleMatchMode
  readonly conditions: RuleDefinition['conditions'] | null
  readonly actions: RuleDefinition['actions'] | null
  readonly runOn: ReadonlyArray<RuleTrigger>
}

export interface RuleEditorReference
  extends ConditionReference, ActionReference {
  readonly payees: ReadonlyArray<NamedOption>
  /** What a new amount condition is denominated in until somebody changes it. */
  readonly baseCurrencyCode: string
}

const TRIGGER_LABEL: Readonly<Record<RuleTrigger, MessageKey>> = {
  manual_create: 'rules.editor.runOn.manual_create',
  import: 'rules.editor.runOn.import',
  edit: 'rules.editor.runOn.edit',
}

export function RuleEditor({
  title,
  initial,
  reference,
  isSaving,
  saveError,
  onSave,
  onCancel,
  onDelete,
}: RuleEditorProps) {
  const t = useTranslate()
  const locale = useLocale()

  const [name, setName] = useState(initial.name)
  const [matchMode, setMatchMode] = useState<RuleMatchMode>(initial.matchMode)
  const [runOn, setRunOn] = useState<ReadonlyArray<RuleTrigger>>(initial.runOn)
  // Seeded once. The routes remount this on a reload, so a synchronising effect would only be a
  // way for a half-written rule to vanish under somebody.
  const [conditions, setConditions] = useState<ReadonlyArray<ConditionDraft>>(
    () =>
      initial.conditions === null
        ? [blankCondition('note', reference.baseCurrencyCode)]
        : initial.conditions.map((condition) =>
            conditionDraftFrom(condition, reference.baseCurrencyCode),
          ),
  )
  const [actions, setActions] = useState<ReadonlyArray<ActionDraft>>(() =>
    initial.actions === null
      ? [blankAction('set_category')]
      : initial.actions.map(actionDraftFrom),
  )

  const parsedConditions = conditionsOf(conditions)
  const parsedActions = actionsOf(actions)

  const names = useMemo(
    () => ({
      accounts: new Map(reference.accounts.map((o) => [o.id, o.name])),
      accountGroups: new Map(
        reference.accountGroups.map((o) => [o.id, o.name]),
      ),
      categories: new Map(reference.categories.map((o) => [o.id, o.name])),
      tags: new Map(reference.tags.map((o) => [o.id, o.name])),
      payees: new Map(reference.payees.map((o) => [o.id, o.name])),
    }),
    [reference],
  )

  const sentence = ruleSentence(
    { matchMode, conditions: parsedConditions, actions: parsedActions },
    { t, locale, names },
  )

  // The preview evaluates only a rule the save path would accept, because it parses with the very
  // schema the repository re-parses with. A draft that would be refused previews nothing.
  const candidate = ruleDefinitionSchema.safeParse({
    name: name.trim() === '' ? 'preview' : name,
    matchMode,
    conditions: parsedConditions,
    actions: parsedActions,
    runOn,
  })

  function save() {
    const parsed = ruleDefinitionSchema.safeParse({
      name,
      matchMode,
      conditions: parsedConditions,
      actions: parsedActions,
      runOn,
    })
    if (parsed.success) onSave(parsed.data)
  }

  function moveIn<T>(
    rows: ReadonlyArray<T>,
    index: number,
    direction: -1 | 1,
  ): ReadonlyArray<T> {
    const target = index + direction
    if (target < 0 || target >= rows.length) return rows
    const next = [...rows]
    const [row] = next.splice(index, 1)
    next.splice(target, 0, row)
    return next
  }

  const isValid = candidate.success && name.trim() !== ''

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-title font-bold text-ink">{title}</h1>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onPress={onCancel}>
            {t('action.cancel')}
          </Button>
          <Button
            variant="primary"
            isPending={isSaving}
            isDisabled={!isValid}
            onPress={save}
          >
            {t('rules.editor.save')}
          </Button>
        </div>
      </header>

      {saveError === null ? null : (
        <ErrorPanel
          title={t('rules.editor.error.title')}
          body={t('rules.error.body')}
          detail={saveError}
        />
      )}

      {/* The rule, in words, above every control that shapes it. */}
      <Card className="flex flex-col gap-1">
        <h2 className="text-caption font-medium uppercase tracking-wide text-ink-2">
          {t('rules.editor.sentence.label')}
        </h2>
        <p className="text-body text-ink">{sentence}</p>
      </Card>

      <Card className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <TextField
            label={t('rules.editor.name')}
            description={t('rules.editor.name.description')}
            value={name}
            onChange={setName}
            maxLength={200}
            isRequired
            className="sm:flex-1"
          />
          <Select
            label={t('rules.editor.matchMode')}
            className="sm:w-48"
            selectedKey={matchMode}
            onSelectionChange={(key: Key | null) => {
              if (key === null) return
              setMatchMode(key === 'any' ? 'any' : 'all')
            }}
          >
            <SelectItem id="all" textValue={t('rules.editor.matchMode.all')}>
              {t('rules.editor.matchMode.all')}
            </SelectItem>
            <SelectItem id="any" textValue={t('rules.editor.matchMode.any')}>
              {t('rules.editor.matchMode.any')}
            </SelectItem>
          </Select>
        </div>

        <CheckboxGroup
          label={t('rules.editor.runOn')}
          orientation="horizontal"
          value={[...runOn]}
          description={
            runOn.length === 0 ? t('rules.editor.runOn.none') : undefined
          }
          onChange={(next) => setRunOn(next as ReadonlyArray<RuleTrigger>)}
        >
          {RULE_TRIGGERS.map((trigger) => (
            <Checkbox key={trigger} value={trigger}>
              {t(TRIGGER_LABEL[trigger])}
            </Checkbox>
          ))}
        </CheckboxGroup>
      </Card>

      <section aria-labelledby="rules-when" className="flex flex-col gap-3">
        <h2 id="rules-when" className="text-subtitle font-semibold text-ink">
          {t('rules.editor.when')}
        </h2>

        <ul
          aria-label={t('rules.editor.conditions.label')}
          className="flex flex-col gap-3"
        >
          {conditions.map((condition, index) => (
            <li key={condition.key}>
              <ConditionRow
                position={index + 1}
                count={conditions.length}
                value={condition}
                reference={reference}
                locale={locale}
                t={t}
                isDisabled={isSaving}
                onChange={(next) =>
                  setConditions((rows) =>
                    rows.map((row, at) => (at === index ? next : row)),
                  )
                }
                onRemove={() =>
                  setConditions((rows) => rows.filter((_, at) => at !== index))
                }
                onMove={(direction) =>
                  setConditions((rows) => moveIn(rows, index, direction))
                }
              />
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus aria-hidden="true" />}
            isDisabled={conditions.length >= MAX_CONDITIONS_PER_RULE}
            onPress={() =>
              setConditions((rows) => [
                ...rows,
                blankCondition('note', reference.baseCurrencyCode),
              ])
            }
          >
            {t('rules.editor.addCondition')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Plus aria-hidden="true" />}
            isDisabled={
              matchMode !== 'all' ||
              conditions.length + 2 > MAX_CONDITIONS_PER_RULE
            }
            onPress={() =>
              setConditions((rows) => [
                ...rows,
                ...amountRangeDrafts(reference.baseCurrencyCode),
              ])
            }
          >
            {t('rules.editor.addRange')}
          </Button>
        </div>
        <p className="text-caption text-ink-2">
          {matchMode === 'all'
            ? t('rules.editor.conditions.full', {
                count: MAX_CONDITIONS_PER_RULE,
              })
            : t('rules.editor.addRange.description')}
        </p>
      </section>

      <section aria-labelledby="rules-then" className="flex flex-col gap-3">
        <h2 id="rules-then" className="text-subtitle font-semibold text-ink">
          {t('rules.editor.then')}
        </h2>

        <ul
          aria-label={t('rules.editor.actions.label')}
          className="flex flex-col gap-3"
        >
          {actions.map((action, index) => (
            <li key={action.key}>
              <ActionRow
                position={index + 1}
                count={actions.length}
                value={action}
                reference={reference}
                t={t}
                isDisabled={isSaving}
                onChange={(next) =>
                  setActions((rows) =>
                    rows.map((row, at) => (at === index ? next : row)),
                  )
                }
                onRemove={() =>
                  setActions((rows) => rows.filter((_, at) => at !== index))
                }
                onMove={(direction) =>
                  setActions((rows) => moveIn(rows, index, direction))
                }
              />
            </li>
          ))}
        </ul>

        <div>
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus aria-hidden="true" />}
            isDisabled={actions.length >= MAX_ACTIONS_PER_RULE}
            onPress={() =>
              setActions((rows) => [...rows, blankAction('set_category')])
            }
          >
            {t('rules.editor.addAction')}
          </Button>
        </div>
        <p className="text-caption text-ink-2">
          {t('rules.editor.actions.full', { count: MAX_ACTIONS_PER_RULE })}
        </p>
      </section>

      <RulePreview rule={candidate.success ? candidate.data : null} />

      {onDelete === undefined ? null : (
        <div>
          <Button variant="danger" onPress={onDelete}>
            {t('rules.editor.delete')}
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * The ledger's vocabularies, narrowed to what a rule can name.
 *
 * One function rather than the same six lines in both routes. `currencyCodes` is every currency the
 * workspace actually holds an account in, base first: an amount condition is compared in one
 * currency and never converted, so offering a currency nobody banks in would only produce rules
 * that match nothing.
 */
export function ruleEditorReference(
  reference: TransactionReference,
): RuleEditorReference {
  return {
    accounts: reference.accounts.map((account) => ({
      id: account.id,
      name: account.name,
    })),
    accountGroups: reference.accountGroups,
    categories: reference.categories.map((category) => ({
      id: category.id,
      name: category.name,
    })),
    tags: reference.tags,
    payees: reference.payees,
    baseCurrencyCode: reference.baseCurrencyCode,
    currencyCodes: [
      ...new Set([
        reference.baseCurrencyCode,
        ...reference.accounts.map((account) => account.currencyCode),
      ]),
    ],
  }
}
