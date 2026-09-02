import { useState } from 'react'
import { parseDate, today } from '@internationalized/date'

import { AmountField, ErrorPanel } from '#/components/app/accounts'
import {
  Button,
  Checkbox,
  CheckboxGroup,
  DatePicker,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Form,
  Modal,
  Radio,
  RadioGroup,
  Select,
  SelectItem,
  Switch,
  TextField,
} from '#/components/ui'
import { useLocale, useTranslate } from '#/lib/i18n'
import { currencyName } from '#/lib/money'
import { createBudget, updateBudget } from '#/server/fns/budgets'

import type { CalendarDate } from '@internationalized/date'
import type { Key } from 'react-aria-components'
import type { Minor } from '#/lib/money'
import type {
  BudgetKind,
  BudgetPeriod,
  BudgetRolloverPolicy,
  CategoryRow,
} from '#/server/db/schema'
import type { BudgetSummary } from '#/server/budgets/summary'

/**
 * Creating a budget and editing one, in a single dialog.
 *
 * One component because it is one form. Splitting it would give two places for *"the limit is
 * typed as minor units"* to be true, and one of them would eventually stop being.
 *
 * ## Three decisions this form makes visible rather than defaulting silently
 *
 * **The kind** is a radio group with a sentence under each option, and it is offered on create
 * only. Changing a budget from *categories* to *by hand* would leave its history counted by a
 * mechanism that no longer applies, so the repository refuses it and the form does not offer it.
 *
 * **The rollover policy** is a radio group, not a select, because the three options are a real
 * choice with real consequences and a collapsed control hides two thirds of it. `carry_surplus`
 * is preselected: money left in an envelope belongs to the envelope, and `carry_all` — which can
 * open a period in the red — is offered rather than assumed.
 *
 * **The alert ladder** is a checkbox group over the ladder a workspace actually uses. Over 100%
 * is legitimate and is offered, because *"tell me at 150%"* is a real request from somebody whose
 * envelope routinely overruns and who wants one notification rather than a daily one.
 *
 * ## The limit never becomes a float
 *
 * {@link AmountField} emits integer minor units and nothing else, and the payload carries those
 * integers straight through. `createBudgetSchema` is `z.number().int().positive()` at the
 * boundary and again in the repository, so a client that ever sent `1234.5` is rejected before
 * any arithmetic happens rather than silently rounded.
 */

export interface BudgetFormDialogProps {
  readonly isOpen: boolean
  readonly onOpenChange: (isOpen: boolean) => void
  /** `null` creates; a summary edits it. */
  readonly budget: BudgetSummary | null
  /** The categories it already follows. Empty on create. */
  readonly selectedCategoryIds: ReadonlyArray<string>
  /** Pre-selected kind when the create form was opened from an empty-state tile. */
  readonly initialKind?: BudgetKind
  readonly categories: ReadonlyArray<CategoryRow>
  readonly currencyOptions: ReadonlyArray<string>
  readonly baseCurrencyCode: string
  readonly onSaved: (mode: 'created' | 'updated') => void
}

const PERIODS: ReadonlyArray<BudgetPeriod> = [
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
  'one_off',
]

const POLICIES: ReadonlyArray<BudgetRolloverPolicy> = [
  'carry_surplus',
  'carry_all',
  'none',
]

/** The ladder a workspace picks from. Over 100 is deliberate — see the docblock. */
const THRESHOLD_CHOICES: ReadonlyArray<number> = [50, 75, 80, 90, 100, 120, 150]

interface Draft {
  name: string
  kind: BudgetKind
  period: BudgetPeriod
  startDate: CalendarDate
  endDate: CalendarDate | null
  limitMinor: Minor | null
  currencyCode: string
  rolloverPolicy: BudgetRolloverPolicy
  thresholds: ReadonlyArray<string>
  autoInclude: boolean
  categoryIds: ReadonlyArray<string>
}

function draftFrom(
  budget: BudgetSummary | null,
  selectedCategoryIds: ReadonlyArray<string>,
  initialKind: BudgetKind | undefined,
  baseCurrencyCode: string,
): Draft {
  if (budget === null) {
    return {
      name: '',
      kind: initialKind ?? 'category',
      period: 'monthly',
      startDate: today('UTC'),
      endDate: null,
      limitMinor: null,
      currencyCode: baseCurrencyCode,
      rolloverPolicy: 'carry_surplus',
      thresholds: ['50', '80', '100'],
      autoInclude: true,
      categoryIds: [],
    }
  }
  return {
    name: budget.name,
    kind: budget.kind,
    period: budget.period,
    startDate: parseDate(budget.startDate),
    endDate: budget.endDate === null ? null : parseDate(budget.endDate),
    limitMinor: budget.current?.limitMinor ?? null,
    currencyCode: budget.budgetCurrencyCode,
    rolloverPolicy: budget.rolloverPolicy,
    thresholds: budget.thresholds.map(String),
    autoInclude: budget.autoInclude,
    categoryIds: selectedCategoryIds,
  }
}

export function BudgetFormDialog({
  isOpen,
  onOpenChange,
  budget,
  selectedCategoryIds,
  initialKind,
  categories,
  currencyOptions,
  baseCurrencyCode,
  onSaved,
}: BudgetFormDialogProps) {
  const t = useTranslate()
  const locale = useLocale()
  const isEdit = budget !== null

  // Seeded once and never synchronised: the route mounts this only while the dialog is open and
  // keys it by the budget it is editing, so a fresh open is a fresh component.
  const [draft, setDraft] = useState<Draft>(() =>
    draftFrom(budget, selectedCategoryIds, initialKind, baseCurrencyCode),
  )
  const [isSaving, setIsSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  // Validation appears after the first submit, never while somebody is still filling the form in.
  const [hasTriedToSubmit, setHasTriedToSubmit] = useState(false)

  const trimmedName = draft.name.trim()
  const hasLimit = draft.limitMinor !== null && draft.limitMinor > 0
  const isValid = trimmedName !== '' && hasLimit && draft.thresholds.length > 0

  function patch(change: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...change }))
  }

  async function submit() {
    setIsSaving(true)
    setFailure(null)
    try {
      const thresholds = draft.thresholds
        .map(Number)
        .filter((value) => Number.isInteger(value))
      if (budget === null) {
        await createBudget({
          data: {
            name: trimmedName,
            kind: draft.kind,
            period: draft.period,
            startDate: draft.startDate.toString(),
            endDate: draft.endDate?.toString() ?? null,
            limitMinor: draft.limitMinor ?? 0,
            currencyCode: draft.currencyCode,
            autoInclude: draft.autoInclude,
            rolloverPolicy: draft.rolloverPolicy,
            alertThresholds: thresholds,
            categoryIds:
              draft.kind === 'category' ? [...draft.categoryIds] : [],
          },
        })
        onSaved('created')
      } else {
        await updateBudget({
          data: {
            budgetId: budget.id,
            patch: {
              name: trimmedName,
              period: draft.period,
              endDate: draft.endDate?.toString() ?? null,
              limitMinor: draft.limitMinor ?? 0,
              autoInclude: draft.autoInclude,
              rolloverPolicy: draft.rolloverPolicy,
              alertThresholds: thresholds,
            },
          },
        })
        onSaved('updated')
      }
      onOpenChange(false)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size="lg"
      // A half-filled budget form is work. A stray press on the scrim is not consent to lose it.
      isDismissable={false}
    >
      <Dialog>
        {({ close }) => (
          <>
            <DialogHeader
              title={t(
                isEdit
                  ? 'budgets.form.edit.title'
                  : 'budgets.form.create.title',
              )}
              description={t(
                draft.kind === 'manual'
                  ? 'budgets.kind.manual.help'
                  : 'budgets.kind.category.help',
              )}
              closeLabel={t('action.close')}
              onClose={close}
            />

            <Form
              onSubmit={(event) => {
                event.preventDefault()
                setHasTriedToSubmit(true)
                if (isValid && !isSaving) void submit()
              }}
              className="contents"
            >
              <DialogBody className="flex flex-col gap-5">
                {failure === null ? null : (
                  <ErrorPanel
                    title={t('budgets.form.error')}
                    body={t('empty.error.body')}
                    detail={failure}
                  />
                )}

                <TextField
                  name="name"
                  label={t('budgets.form.name')}
                  placeholder={t('budgets.form.name.placeholder')}
                  value={draft.name}
                  onChange={(name) => patch({ name })}
                  isRequired
                  autoFocus
                  maxLength={200}
                  errorMessage={
                    hasTriedToSubmit && trimmedName === ''
                      ? t('validation.name.required')
                      : undefined
                  }
                />

                {isEdit ? null : (
                  <RadioGroup
                    label={t('budgets.kind.label')}
                    value={draft.kind}
                    onChange={(value) => patch({ kind: value as BudgetKind })}
                  >
                    <Radio
                      value="category"
                      description={t('budgets.kind.category.help')}
                    >
                      {t('budgets.kind.category')}
                    </Radio>
                    <Radio
                      value="manual"
                      description={t('budgets.kind.manual.help')}
                    >
                      {t('budgets.kind.manual')}
                    </Radio>
                  </RadioGroup>
                )}

                <div className="grid gap-5 sm:grid-cols-2">
                  <AmountField
                    locale={locale}
                    name="limitMinor"
                    label={t('budgets.form.limit')}
                    currencyCode={draft.currencyCode}
                    value={draft.limitMinor}
                    onChange={(limitMinor) => patch({ limitMinor })}
                    invalidMessage={t('validation.amount.invalid')}
                    isRequired
                  />

                  {isEdit ? (
                    <Select
                      label={t('budgets.period.label')}
                      selectedKey={draft.period}
                      onSelectionChange={(key: Key | null) => {
                        if (key !== null) patch({ period: key as BudgetPeriod })
                      }}
                    >
                      {PERIODS.map((period) => (
                        <SelectItem key={period} id={period}>
                          {t(`budgets.period.${period}`)}
                        </SelectItem>
                      ))}
                    </Select>
                  ) : (
                    <Select
                      label={t('budgets.form.currency')}
                      selectedKey={draft.currencyCode}
                      onSelectionChange={(key: Key | null) => {
                        if (key !== null) patch({ currencyCode: String(key) })
                      }}
                    >
                      {currencyOptions.map((code) => (
                        <SelectItem key={code} id={code}>
                          {`${code} · ${currencyName(code, locale)}`}
                        </SelectItem>
                      ))}
                    </Select>
                  )}
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  {isEdit ? null : (
                    <Select
                      label={t('budgets.period.label')}
                      selectedKey={draft.period}
                      onSelectionChange={(key: Key | null) => {
                        if (key !== null) patch({ period: key as BudgetPeriod })
                      }}
                    >
                      {PERIODS.map((period) => (
                        <SelectItem key={period} id={period}>
                          {t(`budgets.period.${period}`)}
                        </SelectItem>
                      ))}
                    </Select>
                  )}

                  {isEdit ? null : (
                    <DatePicker
                      label={t('budgets.form.startDate')}
                      description={t('budgets.form.startDate.help')}
                      calendarLabel={t('common.date')}
                      value={draft.startDate}
                      onChange={(value) => {
                        if (value !== null) patch({ startDate: value })
                      }}
                    />
                  )}

                  <DatePicker
                    label={t('budgets.form.endDate')}
                    description={t('budgets.form.endDate.help')}
                    calendarLabel={t('common.date')}
                    value={draft.endDate}
                    minValue={draft.startDate}
                    onChange={(endDate) => patch({ endDate })}
                  />
                </div>

                <RadioGroup
                  label={t('budgets.rollover.label')}
                  value={draft.rolloverPolicy}
                  onChange={(value) =>
                    patch({ rolloverPolicy: value as BudgetRolloverPolicy })
                  }
                >
                  {POLICIES.map((policy) => (
                    <Radio
                      key={policy}
                      value={policy}
                      description={t(`budgets.rollover.${policy}.help`)}
                    >
                      {t(`budgets.rollover.${policy}`)}
                    </Radio>
                  ))}
                </RadioGroup>

                <CheckboxGroup
                  label={t('budgets.form.thresholds')}
                  description={t('budgets.form.thresholds.help')}
                  orientation="horizontal"
                  value={[...draft.thresholds]}
                  onChange={(thresholds) => patch({ thresholds })}
                >
                  {THRESHOLD_CHOICES.map((threshold) => (
                    <Checkbox key={threshold} value={String(threshold)}>
                      {`${threshold}%`}
                    </Checkbox>
                  ))}
                </CheckboxGroup>

                <p className="text-caption text-ink-2">
                  {t('budgets.form.thresholds.pending')}
                </p>

                {draft.kind === 'category' ? (
                  <>
                    <CheckboxGroup
                      label={t('budgets.form.categories')}
                      description={t('budgets.form.categories.help')}
                      orientation="horizontal"
                      value={[...draft.categoryIds]}
                      onChange={(categoryIds) => patch({ categoryIds })}
                      isDisabled={isEdit}
                    >
                      {categories.map((category) => (
                        <Checkbox key={category.id} value={category.id}>
                          {category.name}
                        </Checkbox>
                      ))}
                    </CheckboxGroup>

                    <Switch
                      isSelected={draft.autoInclude}
                      onChange={(autoInclude) => patch({ autoInclude })}
                    >
                      {t('budgets.autoInclude')}
                    </Switch>
                  </>
                ) : null}
              </DialogBody>

              <DialogFooter>
                <Button variant="ghost" onPress={close}>
                  {t('budgets.form.cancel')}
                </Button>
                <Button type="submit" variant="primary" isPending={isSaving}>
                  {t(
                    isEdit
                      ? 'budgets.form.submit.save'
                      : 'budgets.form.submit.create',
                  )}
                </Button>
              </DialogFooter>
            </Form>
          </>
        )}
      </Dialog>
    </Modal>
  )
}
