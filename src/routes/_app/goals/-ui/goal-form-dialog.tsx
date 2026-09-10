import { useState } from 'react'
import { parseDate, today } from '@internationalized/date'

import { AmountField, ErrorPanel } from '#/components/app/accounts'
import { FormModal, useIsDirty } from '#/components/app/shell'
import {
  Button,
  DatePicker,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Form,
  Select,
  SelectItem,
  TextField,
} from '#/components/ui'
import { useLocale, useTranslate } from '#/lib/i18n'
import { currencyName } from '#/lib/money'
import { createGoal, updateGoal } from '#/server/fns/goals'

import type { CalendarDate } from '@internationalized/date'
import type { Key } from 'react-aria-components'
import type { Minor } from '#/lib/money'
import type { Account } from '#/server/db/types'
import type { GoalSummary } from '#/server/goals/summary'

/**
 * Creating a goal and editing one, in a single dialog.
 *
 * One component because it is one form. Splitting it would give two places for *"the target is
 * typed as minor units"* to be true, and one of them would eventually stop being.
 *
 * ## The currency is chosen once and then stated, never offered again
 *
 * `updateGoalSchema` has no `currencyCode` field, and the reason is not a limitation to work
 * around: every linked contribution was accepted *because* it matched the goal's currency, so
 * changing it afterwards would leave behind a set of links no rule in the repository would have
 * allowed. On edit the picker is replaced by the code and a sentence saying it was fixed at
 * creation, which is more honest than a disabled control that looks like it might become enabled.
 *
 * ## The target date is optional and the help text says why
 *
 * *"I want 20 000,00 zł eventually"* is a real goal. Forcing a date on it manufactures a deadline
 * the person did not choose and then judges them against it — the screen would start saying "past
 * its date" about a plan that never had one.
 *
 * ## The two accounts are independent, and both are optional
 *
 * *Funded from* and *held in* are what make automatic suggestions possible, and a goal with
 * neither still works — it simply gets no offers. Neither is a requirement of the other, so
 * neither disables the other.
 *
 * ## The target never becomes a float
 *
 * {@link AmountField} emits integer minor units and nothing else, and the payload carries those
 * integers straight through. `createGoalSchema` is `z.number().int().positive()` at the boundary
 * and again in the repository, so a client that ever sent `1234.5` is rejected before any
 * arithmetic happens rather than silently rounded.
 */

export interface GoalFormDialogProps {
  readonly isOpen: boolean
  readonly onOpenChange: (isOpen: boolean) => void
  /** `null` creates; a summary edits it. */
  readonly goal: GoalSummary | null
  readonly accounts: ReadonlyArray<Account>
  readonly currencyOptions: ReadonlyArray<string>
  readonly baseCurrencyCode: string
  readonly onSaved: (mode: 'created' | 'updated') => void
}

/** The `id` a `Select` uses for "no account", since `null` is not a React Aria key. */
const NO_ACCOUNT = '__none__'

interface Draft {
  name: string
  targetMinor: Minor | null
  currencyCode: string
  targetDate: CalendarDate | null
  accountId: string
  linkedAccountId: string
}

function draftFrom(goal: GoalSummary | null, baseCurrencyCode: string): Draft {
  if (goal === null) {
    return {
      name: '',
      targetMinor: null,
      currencyCode: baseCurrencyCode,
      targetDate: null,
      accountId: NO_ACCOUNT,
      linkedAccountId: NO_ACCOUNT,
    }
  }
  return {
    name: goal.name,
    targetMinor: goal.targetMinor,
    currencyCode: goal.currencyCode,
    targetDate: goal.targetDate === null ? null : parseDate(goal.targetDate),
    accountId: goal.accountId ?? NO_ACCOUNT,
    linkedAccountId: goal.linkedAccountId ?? NO_ACCOUNT,
  }
}

/** `'__none__'` back to the `null` the schema wants. */
function accountOrNull(value: string): string | null {
  return value === NO_ACCOUNT ? null : value
}

export function GoalFormDialog({
  isOpen,
  onOpenChange,
  goal,
  accounts,
  currencyOptions,
  baseCurrencyCode,
  onSaved,
}: GoalFormDialogProps) {
  const t = useTranslate()
  const locale = useLocale()
  const isEdit = goal !== null

  // Seeded once and never synchronised: the route mounts this only while the dialog is open and
  // keys it by the goal it is editing, so a fresh open is a fresh component.
  const [draft, setDraft] = useState<Draft>(() =>
    draftFrom(goal, baseCurrencyCode),
  )
  const [isSaving, setIsSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  // Validation appears after the first submit, never while somebody is still filling the form in.
  const [hasTriedToSubmit, setHasTriedToSubmit] = useState(false)

  const trimmedName = draft.name.trim()
  const hasTarget = draft.targetMinor !== null && draft.targetMinor > 0
  const isValid = trimmedName !== '' && hasTarget

  const isDirty = useIsDirty(draft)

  function patch(change: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...change }))
  }

  async function submit() {
    setIsSaving(true)
    setFailure(null)
    try {
      const shared = {
        name: trimmedName,
        targetMinor: draft.targetMinor ?? 0,
        targetDate: draft.targetDate?.toString() ?? null,
        accountId: accountOrNull(draft.accountId),
        linkedAccountId: accountOrNull(draft.linkedAccountId),
      }
      if (goal === null) {
        await createGoal({
          data: { ...shared, currencyCode: draft.currencyCode },
        })
        onSaved('created')
      } else {
        await updateGoal({ data: { goalId: goal.id, patch: shared } })
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
                isEdit ? 'goals.form.edit.title' : 'goals.form.create.title',
              )}
              description={t('goals.form.description')}
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
                    title={t('goals.form.error')}
                    body={t('empty.error.body')}
                    detail={failure}
                  />
                )}

                <TextField
                  name="name"
                  label={t('goals.form.name')}
                  placeholder={t('goals.form.name.placeholder')}
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
                  <AmountField
                    locale={locale}
                    name="targetMinor"
                    label={t('goals.form.target')}
                    currencyCode={draft.currencyCode}
                    value={draft.targetMinor}
                    onChange={(targetMinor) => patch({ targetMinor })}
                    invalidMessage={t('validation.amount.invalid')}
                    isRequired
                  />

                  {isEdit ? (
                    /*
                      Stated, not offered. A disabled `Select` looks like a control that might
                      become enabled; a read-only line with a sentence under it says what actually
                      happened — the currency was fixed when the goal was created, and the honest
                      way to change it is a new goal.
                    */
                    <div className="flex flex-col gap-1">
                      <p className="text-caption font-medium text-ink-2">
                        {t('goals.form.currency')}
                      </p>
                      <p className="text-body font-semibold text-ink">
                        {`${draft.currencyCode} · ${currencyName(draft.currencyCode, locale)}`}
                      </p>
                      <p className="text-caption text-ink-2">
                        {t('goals.form.currency.locked')}
                      </p>
                    </div>
                  ) : (
                    <Select
                      label={t('goals.form.currency')}
                      description={t('goals.form.currency.help')}
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

                <DatePicker
                  label={t('goals.form.targetDate')}
                  description={t('goals.form.targetDate.help')}
                  calendarLabel={t('common.date')}
                  minValue={today('UTC')}
                  value={draft.targetDate}
                  onChange={(targetDate) => patch({ targetDate })}
                />

                <div className="grid gap-5 sm:grid-cols-2">
                  <AccountSelect
                    label={t('goals.form.fromAccount')}
                    description={t('goals.form.fromAccount.help')}
                    noneLabel={t('goals.accounts.unset')}
                    accounts={accounts}
                    value={draft.accountId}
                    onChange={(accountId) => patch({ accountId })}
                  />
                  <AccountSelect
                    label={t('goals.form.heldAccount')}
                    description={t('goals.form.heldAccount.help')}
                    noneLabel={t('goals.accounts.unset')}
                    accounts={accounts}
                    value={draft.linkedAccountId}
                    onChange={(linkedAccountId) => patch({ linkedAccountId })}
                  />
                </div>
              </DialogBody>

              <DialogFooter>
                <Button variant="ghost" onPress={close}>
                  {t('goals.form.cancel')}
                </Button>
                <Button type="submit" variant="primary" isPending={isSaving}>
                  {t(
                    isEdit
                      ? 'goals.form.submit.save'
                      : 'goals.form.submit.create',
                  )}
                </Button>
              </DialogFooter>
            </Form>
          </>
        )}
      </Dialog>
    </FormModal>
  )
}

/** The two account pickers, which differ only in their copy. */
function AccountSelect({
  label,
  description,
  noneLabel,
  accounts,
  value,
  onChange,
}: {
  readonly label: string
  readonly description: string
  readonly noneLabel: string
  readonly accounts: ReadonlyArray<Account>
  readonly value: string
  readonly onChange: (value: string) => void
}) {
  return (
    <Select
      label={label}
      description={description}
      selectedKey={value}
      onSelectionChange={(key: Key | null) => {
        if (key !== null) onChange(String(key))
      }}
    >
      <SelectItem id={NO_ACCOUNT}>{noneLabel}</SelectItem>
      {accounts.map((account) => (
        <SelectItem key={account.id} id={account.id}>
          {`${account.name} · ${account.currencyCode}`}
        </SelectItem>
      ))}
    </Select>
  )
}
