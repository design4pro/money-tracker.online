import { useState } from 'react'
import { today } from '@internationalized/date'

import {
  ACCOUNT_CATEGORY_ORDER,
  accountCategoryFacts,
  isAccountCategory,
} from '#/components/app/accounts'
import { FailurePanel, FormModal, useIsDirty } from '#/components/app/shell'
import {
  Button,
  DatePicker,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Form,
  MoneyField,
  Select,
  SelectItem,
  Switch,
  TextAreaField,
  TextField,
} from '#/components/ui'
import { failureOf } from '#/lib/failure'
import { useLocale, useTranslate } from '#/lib/i18n'
import { ZERO_MINOR, currencyName } from '#/lib/money'
import { createAccount, updateAccount } from '#/server/fns/accounts'

import type { FailureEnvelope } from '#/lib/failure-envelope'
import type { CalendarDate } from '@internationalized/date'
import type { Key } from 'react-aria-components'
import type { Minor } from '#/lib/money'
import type { AccountCategory } from '#/server/db/schema'
import type { Account } from '#/server/db/types'

/**
 * Creating an account and editing one, in a single dialog.
 *
 * They are one component because they are one form: the same eleven fields, the same validation,
 * the same money handling. Splitting them would give two places for "the opening balance is
 * typed as minor units" to be true, and one of them would eventually stop being.
 *
 * ## Amounts never become floats, on either side of the wire
 *
 * Both money fields are {@link MoneyField}, which emits integer minor units and nothing else,
 * and the payload carries those integers straight through. `createAccountSchema` is
 * `z.number().int()` at the boundary and again in the repository, so a client that ever sent
 * `1234.5` would be rejected before any arithmetic happened rather than silently rounded.
 *
 * ## The opening date is a create-time field
 *
 * It decides which day's exchange rate values the opening balance, so it is a fact about the
 * account's beginning rather than a setting. On an edit the repository re-values against the day
 * the account already has, and the form does not offer a second opinion about it.
 *
 * ## What the currency picker offers
 *
 * The base currency plus every currency an existing account already uses. Each of those is
 * necessarily one the workspace holds, so the list cannot produce a `CurrencyNotHeldError` — the
 * failure a picker built from the full ISO table would produce on its first use. The day the
 * workspace-currency server function exists, this prop is where it plugs in.
 */
export interface AccountFormDialogProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  /** `null` creates; an account edits it. */
  account: Account | null
  /** Pre-selected kind when the create form was opened from an empty-state shortcut. */
  initialCategory?: AccountCategory
  /** Currency codes the workspace is known to hold. */
  currencyOptions: ReadonlyArray<string>
  /** The workspace base currency — the default for a new account. */
  baseCurrencyCode: string
  onSaved: (account: Account, mode: 'created' | 'updated') => void
}

interface Draft {
  name: string
  category: AccountCategory
  currencyCode: string
  initialBalanceMinor: Minor | null
  creditLimitMinor: Minor | null
  excludeFromStats: boolean
  note: string
  openedOn: CalendarDate
}

function draftFrom(
  account: Account | null,
  initialCategory: AccountCategory | undefined,
  baseCurrencyCode: string,
): Draft {
  if (account === null) {
    return {
      name: '',
      category: initialCategory ?? 'current',
      currencyCode: baseCurrencyCode,
      initialBalanceMinor: ZERO_MINOR,
      creditLimitMinor: null,
      excludeFromStats: false,
      note: '',
      openedOn: today('UTC'),
    }
  }
  return {
    name: account.name,
    category: isAccountCategory(account.category)
      ? account.category
      : 'general',
    currencyCode: account.currencyCode,
    initialBalanceMinor: account.initialBalanceMinor,
    creditLimitMinor: account.creditLimitMinor,
    excludeFromStats: account.excludeFromStats,
    note: account.note ?? '',
    openedOn: today('UTC'),
  }
}

export function AccountFormDialog({
  isOpen,
  onOpenChange,
  account,
  initialCategory,
  currencyOptions,
  baseCurrencyCode,
  onSaved,
}: AccountFormDialogProps) {
  const t = useTranslate()
  const locale = useLocale()
  const isEdit = account !== null

  // The draft is seeded once and never synchronised: the route mounts this component only while
  // the dialog is open and keys it by the account it is editing, so a fresh open is a fresh
  // component. A stale draft in a form about money is the kind of bug that surfaces as a wrong
  // opening balance three months later.
  const [draft, setDraft] = useState<Draft>(() =>
    draftFrom(account, initialCategory, baseCurrencyCode),
  )
  const [isSaving, setIsSaving] = useState(false)
  const [failure, setFailure] = useState<FailureEnvelope | null>(null)
  // Validation messages appear after the first submit, never while somebody is still filling the
  // form in. An empty field is not a mistake until it is offered as an answer.
  const [hasTriedToSubmit, setHasTriedToSubmit] = useState(false)

  const facts = accountCategoryFacts(draft.category)
  const showsCreditLimit =
    facts.carriesCreditLimit || draft.creditLimitMinor !== null
  const trimmedName = draft.name.trim()

  const isDirty = useIsDirty(draft)

  function patch(change: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...change }))
  }

  async function submit() {
    setIsSaving(true)
    setFailure(null)
    try {
      const note = draft.note.trim() === '' ? null : draft.note.trim()
      if (account === null) {
        const created = await createAccount({
          data: {
            name: trimmedName,
            category: draft.category,
            currencyCode: draft.currencyCode,
            initialBalanceMinor: draft.initialBalanceMinor ?? 0,
            creditLimitMinor: draft.creditLimitMinor,
            excludeFromStats: draft.excludeFromStats,
            note,
            openedOn: draft.openedOn.toString(),
          },
        })
        onSaved(created, 'created')
      } else {
        const saved = await updateAccount({
          data: {
            accountId: account.id,
            patch: {
              name: trimmedName,
              category: draft.category,
              currencyCode: draft.currencyCode,
              initialBalanceMinor: draft.initialBalanceMinor ?? 0,
              creditLimitMinor: draft.creditLimitMinor,
              excludeFromStats: draft.excludeFromStats,
              note,
            },
          },
        })
        onSaved(saved, 'updated')
      }
      onOpenChange(false)
    } catch (error) {
      setFailure(failureOf(error))
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
              title={t(isEdit ? 'accounts.edit' : 'accounts.create')}
              description={t(
                isEdit
                  ? 'accounts.form.edit.body'
                  : 'accounts.form.create.body',
              )}
              closeLabel={t('action.close')}
              onClose={close}
            />

            <Form
              onSubmit={(event) => {
                event.preventDefault()
                setHasTriedToSubmit(true)
                if (trimmedName !== '' && !isSaving) {
                  void submit()
                }
              }}
              className="contents"
            >
              <DialogBody className="flex flex-col gap-5">
                {failure === null ? null : (
                  <FailurePanel
                    failure={failure}
                    placement="after-action"
                    title={t('accounts.form.error.title')}
                  />
                )}

                <TextField
                  name="name"
                  label={t('accounts.field.name')}
                  value={draft.name}
                  onChange={(name) => patch({ name })}
                  isRequired
                  autoFocus
                  maxLength={100}
                  errorMessage={
                    hasTriedToSubmit && trimmedName === ''
                      ? t('validation.name.required')
                      : undefined
                  }
                />

                <div className="grid gap-5 sm:grid-cols-2">
                  <Select
                    label={t('accounts.field.category')}
                    selectedKey={draft.category}
                    onSelectionChange={(key: Key | null) => {
                      if (key !== null) {
                        patch({ category: key as AccountCategory })
                      }
                    }}
                  >
                    {ACCOUNT_CATEGORY_ORDER.map((category) => (
                      <SelectItem key={category} id={category}>
                        {t(accountCategoryFacts(category).labelKey)}
                      </SelectItem>
                    ))}
                  </Select>

                  <Select
                    label={t('accounts.field.currency')}
                    description={t('accounts.field.currency.help')}
                    selectedKey={draft.currencyCode}
                    onSelectionChange={(key: Key | null) => {
                      if (key !== null) {
                        patch({ currencyCode: String(key) })
                      }
                    }}
                  >
                    {currencyOptions.map((code) => (
                      <SelectItem key={code} id={code}>
                        {`${code} · ${currencyName(code, locale)}`}
                      </SelectItem>
                    ))}
                  </Select>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <MoneyField
                    locale={locale}
                    name="initialBalanceMinor"
                    label={t('accounts.field.initialBalance')}
                    description={t('accounts.field.initialBalance.help')}
                    currencyCode={draft.currencyCode}
                    value={draft.initialBalanceMinor}
                    onChange={(initialBalanceMinor) =>
                      patch({ initialBalanceMinor })
                    }
                    invalidMessage={t('validation.amount.invalid')}
                  />

                  {isEdit ? null : (
                    <DatePicker
                      label={t('accounts.field.openedOn')}
                      description={t('accounts.field.openedOn.help')}
                      calendarLabel={t('common.date')}
                      value={draft.openedOn}
                      maxValue={today('UTC')}
                      onChange={(value) => {
                        if (value !== null) {
                          patch({ openedOn: value })
                        }
                      }}
                    />
                  )}
                </div>

                {showsCreditLimit ? (
                  <MoneyField
                    locale={locale}
                    name="creditLimitMinor"
                    label={t('accounts.field.creditLimit')}
                    description={t('accounts.field.creditLimit.help')}
                    currencyCode={draft.currencyCode}
                    value={draft.creditLimitMinor}
                    onChange={(creditLimitMinor) => patch({ creditLimitMinor })}
                    invalidMessage={t('validation.amount.invalid')}
                  />
                ) : null}

                <TextAreaField
                  name="note"
                  label={t('accounts.field.note')}
                  value={draft.note}
                  onChange={(note) => patch({ note })}
                  maxLength={500}
                  rows={3}
                />

                <Switch
                  isSelected={draft.excludeFromStats}
                  onChange={(excludeFromStats) => patch({ excludeFromStats })}
                  description={t('accounts.field.excludeFromStats.help')}
                >
                  {t('accounts.field.excludeFromStats')}
                </Switch>
              </DialogBody>

              <DialogFooter>
                <Button variant="ghost" onPress={close}>
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
