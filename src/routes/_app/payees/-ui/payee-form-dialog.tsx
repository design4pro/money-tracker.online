import { useState } from 'react'

import { ErrorPanel } from '#/components/app/accounts'
import {
  CATEGORIZATION_MODES,
  isCategorizationMode,
} from '#/components/app/payees'
import { FormModal, useIsDirty } from '#/components/app/shell'
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Form,
  Radio,
  RadioGroup,
  Select,
  SelectItem,
  TextAreaField,
  TextField,
} from '#/components/ui'
import { useTranslate } from '#/lib/i18n'
import { createPayee, updatePayee } from '#/server/fns/payees'

import type { Key } from 'react-aria-components'
import type { PayeeCategorizationMode, PayeeRow } from '#/server/db/schema'

/**
 * Creating a payee and editing one, in a single dialog.
 *
 * ## The mode picker says what it will do, before it does it
 *
 * Turning `enforce` on re-files every transaction already filed under this payee. That is a real
 * consequence and the radio's description is where it is written, in the same breath as the choice
 * - not in a toast afterwards, when the rows have already moved.
 *
 * ## The logo field takes a domain, not a link
 *
 * `zabka.pl`, not `https://zabka.pl/sklepy`. The repository's schema rejects the second, so the
 * help text says which one is wanted rather than letting somebody discover it from a validation
 * error.
 */
export interface PayeeFormDialogProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  /** `null` creates; a payee edits it. */
  payee: PayeeRow | null
  /** Live categories, for the default-category picker. */
  categoryOptions: ReadonlyArray<{ readonly id: string; readonly name: string }>
  onSaved: (payee: PayeeRow, mode: 'created' | 'updated') => void
}

/** The reserved Select key for "suggest nothing". Never a category id. */
const NO_CATEGORY = '__no_category__'

interface Draft {
  name: string
  defaultCategoryId: string | null
  categorizationMode: PayeeCategorizationMode
  logoDomain: string
  note: string
}

function draftFrom(payee: PayeeRow | null): Draft {
  if (payee === null) {
    return {
      name: '',
      defaultCategoryId: null,
      categorizationMode: 'hint',
      logoDomain: '',
      note: '',
    }
  }
  return {
    name: payee.name,
    defaultCategoryId: payee.defaultCategoryId,
    categorizationMode: isCategorizationMode(payee.categorizationMode)
      ? payee.categorizationMode
      : 'hint',
    logoDomain: payee.logoDomain ?? '',
    note: payee.note ?? '',
  }
}

export function PayeeFormDialog({
  isOpen,
  onOpenChange,
  payee,
  categoryOptions,
  onSaved,
}: PayeeFormDialogProps) {
  const t = useTranslate()
  const isEdit = payee !== null

  const [draft, setDraft] = useState<Draft>(() => draftFrom(payee))
  const [isSaving, setIsSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [hasTriedToSubmit, setHasTriedToSubmit] = useState(false)

  const trimmedName = draft.name.trim()

  const isDirty = useIsDirty(draft)

  function patch(change: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...change }))
  }

  async function submit() {
    setIsSaving(true)
    setFailure(null)
    const logoDomain =
      draft.logoDomain.trim() === '' ? null : draft.logoDomain.trim()
    const note = draft.note.trim() === '' ? null : draft.note.trim()
    try {
      if (payee === null) {
        const created = await createPayee({
          data: {
            name: trimmedName,
            defaultCategoryId: draft.defaultCategoryId,
            categorizationMode: draft.categorizationMode,
            logoDomain,
            note,
          },
        })
        onSaved(created, 'created')
      } else {
        const saved = await updatePayee({
          data: {
            payeeId: payee.id,
            patch: {
              name: trimmedName,
              defaultCategoryId: draft.defaultCategoryId,
              categorizationMode: draft.categorizationMode,
              logoDomain,
              note,
            },
          },
        })
        onSaved(saved, 'updated')
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
              title={t(isEdit ? 'payees.edit' : 'payees.create')}
              description={t(
                isEdit ? 'payees.form.edit.body' : 'payees.form.create.body',
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
                  <ErrorPanel
                    title={t('payees.form.error.title')}
                    body={t('empty.error.body')}
                    detail={failure}
                  />
                )}

                <TextField
                  name="name"
                  label={t('common.name')}
                  description={t('payees.field.name.help')}
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

                <Select
                  label={t('payees.field.defaultCategory')}
                  description={t('payees.field.defaultCategory.help')}
                  selectedKey={draft.defaultCategoryId ?? NO_CATEGORY}
                  onSelectionChange={(key: Key | null) => {
                    if (key === null) return
                    patch({
                      defaultCategoryId:
                        key === NO_CATEGORY ? null : String(key),
                    })
                  }}
                >
                  <SelectItem id={NO_CATEGORY}>{t('common.none')}</SelectItem>
                  {categoryOptions.map((category) => (
                    <SelectItem key={category.id} id={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </Select>

                <RadioGroup
                  label={t('payees.field.mode')}
                  value={draft.categorizationMode}
                  onChange={(value) => {
                    if (isCategorizationMode(value)) {
                      patch({ categorizationMode: value })
                    }
                  }}
                >
                  {CATEGORIZATION_MODES.map((option) => (
                    <Radio
                      key={option.mode}
                      value={option.mode}
                      description={t(option.descriptionKey)}
                      isDisabled={
                        option.mode !== 'off' &&
                        draft.defaultCategoryId === null
                      }
                    >
                      {t(option.labelKey)}
                    </Radio>
                  ))}
                </RadioGroup>

                <TextField
                  name="logoDomain"
                  label={t('payees.field.logoDomain')}
                  description={t('payees.field.logoDomain.help')}
                  value={draft.logoDomain}
                  onChange={(logoDomain) => patch({ logoDomain })}
                  maxLength={100}
                />

                <TextAreaField
                  name="note"
                  label={t('common.note')}
                  value={draft.note}
                  onChange={(note) => patch({ note })}
                  maxLength={500}
                  rows={3}
                />
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
