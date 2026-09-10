import { useState } from 'react'
import { parseDate, today as todayIn } from '@internationalized/date'

import { ErrorPanel } from '#/components/app/accounts'
import { FormModal, useIsDirty } from '#/components/app/shell'
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
  MoneyField,
  NumberField,
  Radio,
  RadioGroup,
  Select,
  SelectItem,
  Switch,
  TextField,
} from '#/components/ui'
import { useLocale, useTranslate } from '#/lib/i18n'
import { currencyName } from '#/lib/money'
import { createSeries, updateSeries } from '#/server/fns/recurring'
import { occurrences } from '#/server/recurring/schedule'

import type { CalendarDate } from '@internationalized/date'
import type { Key } from 'react-aria-components'
import type { Minor } from '#/lib/money'
import type {
  CategoryRow,
  RecurringFrequency,
  RecurringKind,
  TransactionDirection,
} from '#/server/db/schema'
import type {
  CreateSeriesInput,
  RemindBeforeOffset,
} from '#/server/repos/recurring'
import type { RecurringSeries } from '#/server/db/types'

/**
 * Creating a series and editing one, in a single dialog.
 *
 * One component because it is one form. Splitting it would give two places for *"the amount is
 * typed as minor units"* to be true, and one of them would eventually stop being.
 *
 * ## Four decisions this form makes visible rather than defaulting silently
 *
 * **Automation is a radio group of three, not a switch.** *Off*, *record it for me* and *match
 * what I record* are three different contracts with the person's money, and the schema's
 * `recurring_series_auto_record_excludes_matching_rules_check` says the last two are mutually
 * exclusive. A radio group makes that exclusivity structural: the form cannot express the pair, so
 * it cannot submit it, so the `CHECK` never has to refuse anything. A switch plus a rules panel
 * would let somebody tick both and find out from a server error.
 *
 * **The termination is a radio group of three**, and each of the two bounded options carries its
 * own field. `{ kind: 'endDate' }` and `{ kind: 'maxOccurrences' }` are a discriminated union all
 * the way from this form to the database columns, so "ends on a date *and* after twelve times" is
 * unrepresentable rather than merely rejected.
 *
 * **The anchor day is offered only where it means something.** A weekly series has no day of the
 * month, and a control that silently does nothing is worse than one that is absent.
 *
 * **The currency and the direction are fixed after creation.** Both rewrite the meaning of every
 * period already materialised - an income series that becomes an expense claims its whole history
 * moved the other way. `updateSeriesSchema` does not carry either field, and the form says why
 * rather than greying a control with no explanation.
 *
 * ## The amount never becomes a float
 *
 * {@link MoneyField} emits integer minor units and nothing else, and the payload carries those
 * integers straight through. `createSeriesSchema` is `z.number().int().positive()` at the boundary
 * and again in the repository, so a client that ever sent `1234.5` is rejected before any
 * arithmetic happens rather than silently rounded. The matching tolerance is the same: minor
 * units, typed as an amount, compared as an integer.
 */

export interface SeriesFormDialogProps {
  readonly isOpen: boolean
  readonly onOpenChange: (isOpen: boolean) => void
  /** `null` creates; a series edits it. */
  readonly series: RecurringSeries | null
  readonly accounts: ReadonlyArray<{
    readonly id: string
    readonly name: string
  }>
  readonly categories: ReadonlyArray<CategoryRow>
  readonly payees: ReadonlyArray<{ readonly id: string; readonly name: string }>
  readonly currencyOptions: ReadonlyArray<string>
  readonly baseCurrencyCode: string
  /** Prefills the form from an accepted suggestion. */
  readonly initial?: Partial<Draft>
  /**
   * Replaces the create call.
   *
   * The candidates screen passes {@link acceptCandidate}, which creates the series **and** marks
   * the proposal accepted in one call. Doing that as two calls from the browser would leave a
   * window in which the series exists and the proposal is still pending. It throws on failure,
   * like `createSeries`, so the dialog's own error panel handles both the same way.
   */
  readonly onCreate?: (input: CreateSeriesInput) => Promise<void>
  readonly onSaved: (mode: 'created' | 'updated') => void
}

const KINDS: ReadonlyArray<RecurringKind> = [
  'subscription',
  'bill',
  'installment',
  'income',
]

const FREQUENCIES: ReadonlyArray<RecurringFrequency> = [
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'semi_annual',
  'annual',
]

/** The eight presets `13-S2` names, in the order they read as a ladder. */
const REMIND_OFFSETS: ReadonlyArray<RemindBeforeOffset> = [
  '0d',
  '1d',
  '2d',
  '3d',
  '5d',
  '1w',
  '2w',
  '1m',
]

/** Three is the cap. A fourth reminder about one bill is noise, and the repository refuses it. */
const MAX_REMINDERS = 3

/** Only these steps land on a day of the month. A weekly series has no anchor. */
const MONTH_SHAPED: ReadonlySet<string> = new Set([
  'monthly',
  'quarterly',
  'semi_annual',
  'annual',
])

type Automation = 'none' | 'auto' | 'match'
type TerminationKind = 'open' | 'endDate' | 'maxOccurrences'

export interface Draft {
  name: string
  kind: RecurringKind
  direction: TransactionDirection
  expectedAmountMinor: Minor | null
  currencyCode: string
  frequency: RecurringFrequency
  anchorDay: number | null
  startDate: CalendarDate
  terminationKind: TerminationKind
  endDate: CalendarDate | null
  maxOccurrences: number
  accountId: string | null
  categoryId: string | null
  payeeId: string | null
  automation: Automation
  matchPayee: string
  matchAccountId: string | null
  matchToleranceMinor: Minor | null
  matchDayWindow: number
  remindBefore: ReadonlyArray<string>
  notifyEmail: boolean
  showInWidget: boolean
}

function draftFrom(
  series: RecurringSeries | null,
  baseCurrencyCode: string,
): Draft {
  const base: Draft = {
    name: '',
    kind: 'subscription',
    direction: 'expense',
    expectedAmountMinor: null,
    currencyCode: baseCurrencyCode,
    frequency: 'monthly',
    anchorDay: null,
    startDate: todayIn('UTC'),
    terminationKind: 'open',
    endDate: null,
    maxOccurrences: 12,
    accountId: null,
    categoryId: null,
    payeeId: null,
    automation: 'none',
    matchPayee: '',
    matchAccountId: null,
    matchToleranceMinor: null,
    matchDayWindow: 5,
    remindBefore: [],
    notifyEmail: false,
    showInWidget: true,
  }
  if (series === null) return base

  return {
    ...base,
    name: series.name,
    kind: series.kind as RecurringKind,
    direction: series.direction as TransactionDirection,
    expectedAmountMinor: series.expectedAmountMinor,
    currencyCode: series.expectedCurrencyCode,
    frequency: series.frequency as RecurringFrequency,
    anchorDay: series.anchorDay,
    startDate: parseDate(series.startDate),
    terminationKind:
      series.endDate !== null
        ? 'endDate'
        : series.maxOccurrences !== null
          ? 'maxOccurrences'
          : 'open',
    endDate: series.endDate === null ? null : parseDate(series.endDate),
    maxOccurrences: series.maxOccurrences ?? 12,
    accountId: series.accountId,
    categoryId: series.categoryId,
    payeeId: series.payeeId,
    automation: series.autoRecord
      ? 'auto'
      : series.matchingRules === null
        ? 'none'
        : 'match',
    remindBefore: readOffsets(series.remindBefore),
    notifyEmail: series.notifyEmail,
    showInWidget: series.showInWidget,
  }
}

/** The stored `remind_before` JSON, tolerantly. A malformed column must not break the form. */
function readOffsets(stored: string | null): ReadonlyArray<string> {
  if (stored === null) return []
  try {
    const parsed: unknown = JSON.parse(stored)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

export function SeriesFormDialog({
  isOpen,
  onOpenChange,
  series,
  accounts,
  categories,
  payees,
  currencyOptions,
  baseCurrencyCode,
  initial,
  onCreate,
  onSaved,
}: SeriesFormDialogProps) {
  const t = useTranslate()
  const locale = useLocale()
  const isEdit = series !== null

  // Seeded once and never synchronised: the route mounts this only while the dialog is open and
  // keys it by the series it is editing, so a fresh open is a fresh component.
  const [draft, setDraft] = useState<Draft>(() => ({
    ...draftFrom(series, baseCurrencyCode),
    ...initial,
  }))
  const [isSaving, setIsSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  // Validation appears after the first submit, never while somebody is still filling the form in.
  const [hasTriedToSubmit, setHasTriedToSubmit] = useState(false)

  const trimmedName = draft.name.trim()
  const hasAmount =
    draft.expectedAmountMinor !== null && draft.expectedAmountMinor > 0
  const needsAccount = draft.automation === 'auto' && draft.accountId === null
  const isValid = trimmedName !== '' && hasAmount && !needsAccount

  const isDirty = useIsDirty(draft)

  function patch(change: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...change }))
  }

  const termination =
    draft.terminationKind === 'endDate' && draft.endDate !== null
      ? ({ kind: 'endDate', endDate: draft.endDate.toString() } as const)
      : draft.terminationKind === 'maxOccurrences'
        ? ({
            kind: 'maxOccurrences',
            maxOccurrences: draft.maxOccurrences,
          } as const)
        : ({ kind: 'open' } as const)

  const matchingRules =
    draft.automation === 'match'
      ? {
          payee: draft.matchPayee
            .split(',')
            .map((word) => word.trim())
            .filter((word) => word !== '')
            .slice(0, 10),
          accountId: draft.matchAccountId,
          amountToleranceMinor: draft.matchToleranceMinor ?? 0,
          dayWindow: draft.matchDayWindow,
        }
      : null

  async function submit() {
    setIsSaving(true)
    setFailure(null)
    try {
      const shared = {
        name: trimmedName,
        kind: draft.kind,
        expectedAmountMinor: draft.expectedAmountMinor ?? 0,
        frequency: draft.frequency,
        anchorDay: MONTH_SHAPED.has(draft.frequency) ? draft.anchorDay : null,
        termination,
        accountId: draft.accountId,
        categoryId: draft.categoryId,
        payeeId: draft.payeeId,
        autoRecord: draft.automation === 'auto',
        matchingRules,
        remindBefore: [...draft.remindBefore] as Array<RemindBeforeOffset>,
        notifyEmail: draft.notifyEmail,
        showInWidget: draft.showInWidget,
      }

      if (series === null) {
        const input = {
          ...shared,
          direction: draft.direction,
          expectedCurrencyCode: draft.currencyCode,
          startDate: draft.startDate.toString(),
        }
        if (onCreate === undefined) await createSeries({ data: input })
        else await onCreate(input)
        onSaved('created')
      } else {
        await updateSeries({
          data: { seriesId: series.id, patch: shared },
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
    <FormModal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size="lg"
      isDirty={isDirty}
    >
      <Dialog>
        {({ close }) => (
          <>
            <DialogHeader
              title={t(
                isEdit
                  ? 'recurring.form.edit.title'
                  : 'recurring.form.create.title',
              )}
              description={t(`recurring.kind.${draft.kind}`)}
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
                    title={t('recurring.form.error')}
                    body={t('empty.error.body')}
                    detail={failure}
                  />
                )}

                <TextField
                  name="name"
                  label={t('recurring.form.name')}
                  placeholder={t('recurring.form.name.placeholder')}
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

                <div className="grid gap-5 sm:grid-cols-2">
                  <Select
                    label={t('recurring.kind.label')}
                    selectedKey={draft.kind}
                    onSelectionChange={(key: Key | null) => {
                      if (key !== null) patch({ kind: key as RecurringKind })
                    }}
                  >
                    {KINDS.map((kind) => (
                      <SelectItem key={kind} id={kind}>
                        {t(`recurring.kind.${kind}`)}
                      </SelectItem>
                    ))}
                  </Select>

                  <Select
                    label={t('recurring.frequency.label')}
                    selectedKey={draft.frequency}
                    onSelectionChange={(key: Key | null) => {
                      if (key !== null) {
                        patch({ frequency: key as RecurringFrequency })
                      }
                    }}
                  >
                    {FREQUENCIES.map((frequency) => (
                      <SelectItem key={frequency} id={frequency}>
                        {t(`recurring.frequency.${frequency}`)}
                      </SelectItem>
                    ))}
                  </Select>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <MoneyField
                    locale={locale}
                    name="expectedAmountMinor"
                    label={t('recurring.form.amount')}
                    currencyCode={draft.currencyCode}
                    value={draft.expectedAmountMinor}
                    onChange={(expectedAmountMinor) =>
                      patch({ expectedAmountMinor })
                    }
                    isRequired
                  />

                  {isEdit ? null : (
                    <Select
                      label={t('recurring.form.currency')}
                      description={t('recurring.form.currency.locked')}
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
                    <>
                      <Select
                        label={t('recurring.direction.label')}
                        description={t('recurring.form.direction.locked')}
                        selectedKey={draft.direction}
                        onSelectionChange={(key: Key | null) => {
                          if (key !== null) {
                            patch({ direction: key as TransactionDirection })
                          }
                        }}
                      >
                        <SelectItem id="expense">
                          {t('recurring.direction.expense')}
                        </SelectItem>
                        <SelectItem id="income">
                          {t('recurring.direction.income')}
                        </SelectItem>
                      </Select>

                      <DatePicker
                        label={t('recurring.form.startDate')}
                        description={t('recurring.form.startDate.help')}
                        calendarLabel={t('common.date')}
                        value={draft.startDate}
                        onChange={(value) => {
                          if (value !== null) patch({ startDate: value })
                        }}
                      />
                    </>
                  )}

                  {/* Offered only where it means something: a weekly series has no day of the
                      month, and a control that silently does nothing is worse than an absent one. */}
                  {MONTH_SHAPED.has(draft.frequency) ? (
                    <Select
                      label={t('recurring.form.anchorDay')}
                      description={t('recurring.form.anchorDay.help')}
                      selectedKey={
                        draft.anchorDay === null
                          ? 'auto'
                          : String(draft.anchorDay)
                      }
                      onSelectionChange={(key: Key | null) => {
                        if (key === null) return
                        patch({
                          anchorDay: key === 'auto' ? null : Number(key),
                        })
                      }}
                    >
                      {[
                        <SelectItem key="auto" id="auto">
                          {t('recurring.form.anchorDay.auto')}
                        </SelectItem>,
                        ...Array.from({ length: 31 }, (_, index) => (
                          <SelectItem
                            key={String(index + 1)}
                            id={String(index + 1)}
                          >
                            {String(index + 1)}
                          </SelectItem>
                        )),
                      ]}
                    </Select>
                  ) : null}
                </div>

                <RadioGroup
                  label={t('recurring.termination.label')}
                  value={draft.terminationKind}
                  onChange={(value) =>
                    patch({ terminationKind: value as TerminationKind })
                  }
                >
                  <Radio value="open">{t('recurring.termination.open')}</Radio>
                  <Radio
                    value="endDate"
                    description={t('recurring.termination.endDate.help')}
                  >
                    {t('recurring.termination.endDate')}
                  </Radio>
                  <Radio
                    value="maxOccurrences"
                    description={t('recurring.termination.maxOccurrences.help')}
                  >
                    {t('recurring.termination.maxOccurrences')}
                  </Radio>
                </RadioGroup>

                {draft.terminationKind === 'endDate' ? (
                  <DatePicker
                    label={t('recurring.termination.endDate.field')}
                    calendarLabel={t('common.date')}
                    value={draft.endDate}
                    minValue={draft.startDate}
                    onChange={(endDate) => patch({ endDate })}
                  />
                ) : null}

                {draft.terminationKind === 'maxOccurrences' ? (
                  <NumberField
                    label={t('recurring.termination.maxOccurrences.field')}
                    value={draft.maxOccurrences}
                    minValue={1}
                    maxValue={10_000}
                    step={1}
                    onChange={(maxOccurrences) => patch({ maxOccurrences })}
                  />
                ) : null}

                <SchedulePreview draft={draft} />

                <div className="grid gap-5 sm:grid-cols-2">
                  <Select
                    label={t('recurring.form.account')}
                    selectedKey={draft.accountId ?? 'none'}
                    errorMessage={
                      hasTriedToSubmit && needsAccount
                        ? t('recurring.automation.needsAccount')
                        : undefined
                    }
                    onSelectionChange={(key: Key | null) => {
                      if (key === null) return
                      patch({ accountId: key === 'none' ? null : String(key) })
                    }}
                  >
                    {[
                      <SelectItem key="none" id="none">
                        {t('recurring.form.account.none')}
                      </SelectItem>,
                      ...accounts.map((account) => (
                        <SelectItem key={account.id} id={account.id}>
                          {account.name}
                        </SelectItem>
                      )),
                    ]}
                  </Select>

                  <Select
                    label={t('recurring.form.category')}
                    selectedKey={draft.categoryId ?? 'none'}
                    onSelectionChange={(key: Key | null) => {
                      if (key === null) return
                      patch({ categoryId: key === 'none' ? null : String(key) })
                    }}
                  >
                    {[
                      <SelectItem key="none" id="none">
                        {t('recurring.form.category.none')}
                      </SelectItem>,
                      ...categories.map((category) => (
                        <SelectItem key={category.id} id={category.id}>
                          {category.name}
                        </SelectItem>
                      )),
                    ]}
                  </Select>
                </div>

                <Select
                  label={t('recurring.form.payee')}
                  selectedKey={draft.payeeId ?? 'none'}
                  onSelectionChange={(key: Key | null) => {
                    if (key === null) return
                    patch({ payeeId: key === 'none' ? null : String(key) })
                  }}
                >
                  {[
                    <SelectItem key="none" id="none">
                      {t('recurring.form.payee.none')}
                    </SelectItem>,
                    ...payees.map((payee) => (
                      <SelectItem key={payee.id} id={payee.id}>
                        {payee.name}
                      </SelectItem>
                    )),
                  ]}
                </Select>

                {/* Three options, never two switches: the schema forbids `auto_record` together
                    with `matching_rules`, and a radio group makes that pair unrepresentable rather
                    than merely rejected. */}
                <RadioGroup
                  label={t('recurring.automation.label')}
                  description={t('recurring.automation.exclusive')}
                  value={draft.automation}
                  onChange={(value) =>
                    patch({ automation: value as Automation })
                  }
                >
                  <Radio
                    value="none"
                    description={t('recurring.automation.none.help')}
                  >
                    {t('recurring.automation.none')}
                  </Radio>
                  <Radio
                    value="auto"
                    description={t('recurring.automation.auto.help')}
                  >
                    {t('recurring.automation.auto')}
                  </Radio>
                  <Radio
                    value="match"
                    description={t('recurring.automation.match.help')}
                  >
                    {t('recurring.automation.match')}
                  </Radio>
                </RadioGroup>

                {draft.automation === 'match' ? (
                  <div className="flex flex-col gap-5 rounded-lg border border-border-subtle p-4">
                    <TextField
                      label={t('recurring.match.payee')}
                      description={t('recurring.match.payee.help')}
                      value={draft.matchPayee}
                      onChange={(matchPayee) => patch({ matchPayee })}
                      maxLength={400}
                    />
                    <div className="grid gap-5 sm:grid-cols-2">
                      <MoneyField
                        locale={locale}
                        label={t('recurring.match.tolerance')}
                        description={t('recurring.match.tolerance.help')}
                        currencyCode={draft.currencyCode}
                        value={draft.matchToleranceMinor}
                        onChange={(matchToleranceMinor) =>
                          patch({ matchToleranceMinor })
                        }
                      />
                      <NumberField
                        label={t('recurring.match.window')}
                        value={draft.matchDayWindow}
                        minValue={0}
                        maxValue={31}
                        step={1}
                        onChange={(matchDayWindow) => patch({ matchDayWindow })}
                      />
                    </div>
                  </div>
                ) : null}

                <CheckboxGroup
                  label={t('recurring.reminders.label')}
                  description={t('recurring.reminders.help')}
                  value={[...draft.remindBefore]}
                  onChange={(remindBefore) =>
                    patch({
                      remindBefore: remindBefore.slice(0, MAX_REMINDERS),
                    })
                  }
                  errorMessage={
                    draft.remindBefore.length >= MAX_REMINDERS
                      ? t('recurring.reminders.max')
                      : undefined
                  }
                >
                  {REMIND_OFFSETS.map((offset) => (
                    <Checkbox
                      key={offset}
                      value={offset}
                      isDisabled={
                        draft.remindBefore.length >= MAX_REMINDERS &&
                        !draft.remindBefore.includes(offset)
                      }
                    >
                      {t(`recurring.reminders.${offset}`)}
                    </Checkbox>
                  ))}
                </CheckboxGroup>

                <p className="text-caption text-ink-2">
                  {t('recurring.reminders.pending')}
                </p>

                <Switch
                  isSelected={draft.notifyEmail}
                  onChange={(notifyEmail) => patch({ notifyEmail })}
                >
                  {t('recurring.reminders.email')}
                </Switch>

                <Switch
                  isSelected={draft.showInWidget}
                  onChange={(showInWidget) => patch({ showInWidget })}
                >
                  {t('recurring.form.widget')}
                </Switch>
              </DialogBody>

              <DialogFooter>
                <Button
                  variant="secondary"
                  onPress={close}
                  isDisabled={isSaving}
                >
                  {t('action.cancel')}
                </Button>
                <Button type="submit" variant="primary" isPending={isSaving}>
                  {t(isEdit ? 'action.saveChanges' : 'action.create')}
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
 * The next few dates this schedule produces.
 *
 * Shown because month-end anchoring is the one thing about a recurring series people get wrong,
 * and a list of five dates settles *"what happens in February"* before it becomes a support
 * question. `occurrences` is the same pure function the materialiser runs, so what the preview
 * shows is what will be written - not a second implementation that drifts from it.
 */
function SchedulePreview({ draft }: { readonly draft: Draft }) {
  const t = useTranslate()
  const locale = useLocale()

  const dates = occurrences(
    {
      frequency: draft.frequency,
      anchorDay: MONTH_SHAPED.has(draft.frequency) ? draft.anchorDay : null,
      startDate: draft.startDate.toString(),
      endDate:
        draft.terminationKind === 'endDate'
          ? (draft.endDate?.toString() ?? null)
          : null,
      maxOccurrences:
        draft.terminationKind === 'maxOccurrences'
          ? draft.maxOccurrences
          : null,
    },
    { count: 5 },
  )

  if (dates.length === 0) return null

  return (
    <section className="rounded-lg bg-surface-sunken p-4">
      <h3 className="text-label font-medium text-ink">
        {t('recurring.preview.title')}
      </h3>
      <p className="mt-1 text-caption text-ink-2">
        {t('recurring.preview.help')}
      </p>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-caption tabular text-ink-2">
        {dates.map((occurrence) => (
          <li key={occurrence.periodStart}>
            {new Intl.DateTimeFormat(locale, {
              dateStyle: 'medium',
              timeZone: 'UTC',
            }).format(new Date(`${occurrence.dueOn}T00:00:00Z`))}
          </li>
        ))}
      </ul>
    </section>
  )
}
