import { useState } from 'react'

import { CATEGORY_HUES, CategoryColourField } from '#/components/app/categories'
import { FailurePanel, FormModal, useIsDirty } from '#/components/app/shell'
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Form,
  Select,
  SelectItem,
  TextField,
} from '#/components/ui'
import { failureOf } from '#/lib/failure'
import { useTranslate } from '#/lib/i18n'
import { CATEGORY_KINDS } from '#/lib/enums'
import { createCategory, updateCategory } from '#/server/fns/categories'

import type { FailureEnvelope } from '#/lib/failure-envelope'
import type { Key } from 'react-aria-components'
import type { MessageKey } from '#/lib/i18n'
import type { CategoryKind } from '#/server/db/schema'
import type { Category } from '#/server/repos/categories'

/**
 * Creating a category and editing one, in a single dialog.
 *
 * ## Re-parenting is not a field here
 *
 * The parent picker appears only while creating, and it offers top-level categories alone. Moving
 * an existing category is _Move to…_ in its row menu, which is the same gesture as the drag and
 * goes through the same `moveCategory` call. Two controls that both re-file a category would be
 * two places for the depth rule to be enforced, and one of them would eventually stop enforcing it.
 *
 * ## Colour is named choices, not a picker
 *
 * See `CategoryColourField`, which owns the group and the rule that the stored colour is always
 * one of its options - including when that colour came from an import and is not one of the eight.
 *
 * ## The failure stays on screen
 *
 * A refused write renders into the dialog and waits. The depth cap and the duplicate-slug conflict
 * both come back as sentences a person has to read and act on, and a toast that disappears on a
 * timer is not a way to deliver either.
 */
export interface CategoryFormDialogProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  /** `null` creates; a category edits it. */
  category: Category | null
  /** Pre-selected parent when the dialog was opened from a row's _Add subcategory_. */
  initialParentId?: string | null
  /** Top-level categories, which are the only ones that may be a parent. */
  parentOptions: ReadonlyArray<{ readonly id: string; readonly name: string }>
  onSaved: (category: Category, mode: 'created' | 'updated') => void
}

const KIND_LABELS: Record<CategoryKind, MessageKey> = {
  expense: 'categories.kind.expense',
  income: 'categories.kind.income',
  both: 'categories.kind.both',
}

interface Draft {
  name: string
  kind: CategoryKind
  parentId: string | null
  color: string
}

function isKind(value: string): value is CategoryKind {
  return (CATEGORY_KINDS as ReadonlyArray<string>).includes(value)
}

/** The reserved Select key for "no parent". Never a category id. */
const TOP_LEVEL = '__top_level__'

function draftFrom(
  category: Category | null,
  initialParentId: string | null | undefined,
): Draft {
  const fallbackHue = CATEGORY_HUES[0].value
  if (category === null) {
    return {
      name: '',
      kind: 'expense',
      parentId: initialParentId ?? null,
      color: fallbackHue,
    }
  }
  return {
    name: category.name,
    kind: isKind(category.kind) ? category.kind : 'expense',
    parentId: category.parentId,
    color: category.color,
  }
}

export function CategoryFormDialog({
  isOpen,
  onOpenChange,
  category,
  initialParentId,
  parentOptions,
  onSaved,
}: CategoryFormDialogProps) {
  const t = useTranslate()
  const isEdit = category !== null

  // Seeded once. The route mounts this only while the dialog is open and keys it by the row being
  // edited, so a fresh open is a fresh component and there is no stale draft to synchronise.
  const [draft, setDraft] = useState<Draft>(() =>
    draftFrom(category, initialParentId),
  )
  const [isSaving, setIsSaving] = useState(false)
  const [failure, setFailure] = useState<FailureEnvelope | null>(null)
  // Validation appears after the first submit. An empty field is not a mistake until it is offered
  // as an answer.
  const [hasTriedToSubmit, setHasTriedToSubmit] = useState(false)

  const trimmedName = draft.name.trim()

  const isDirty = useIsDirty(draft)

  function patch(change: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...change }))
  }

  async function submit() {
    setIsSaving(true)
    setFailure(null)
    try {
      if (category === null) {
        const created = await createCategory({
          data: {
            name: trimmedName,
            kind: draft.kind,
            parentId: draft.parentId,
            color: draft.color,
          },
        })
        onSaved(created, 'created')
      } else {
        const saved = await updateCategory({
          data: {
            categoryId: category.id,
            patch: {
              name: trimmedName,
              kind: draft.kind,
              color: draft.color,
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
      size="md"
      isDirty={isDirty}
    >
      <Dialog>
        {({ close }) => (
          <>
            <DialogHeader
              title={t(isEdit ? 'categories.edit' : 'categories.create')}
              description={t(
                isEdit
                  ? 'categories.form.edit.body'
                  : 'categories.form.create.body',
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
                    title={t('categories.form.error.title')}
                  />
                )}

                <TextField
                  name="name"
                  label={t('common.name')}
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
                    label={t('categories.field.kind')}
                    description={t('categories.field.kind.help')}
                    selectedKey={draft.kind}
                    onSelectionChange={(key: Key | null) => {
                      const value = key === null ? null : String(key)
                      if (value !== null && isKind(value)) {
                        patch({ kind: value })
                      }
                    }}
                  >
                    {CATEGORY_KINDS.map((kind) => (
                      <SelectItem key={kind} id={kind}>
                        {t(KIND_LABELS[kind])}
                      </SelectItem>
                    ))}
                  </Select>

                  {isEdit ? null : (
                    <Select
                      label={t('categories.field.parent')}
                      description={t('categories.field.parent.help')}
                      selectedKey={draft.parentId ?? TOP_LEVEL}
                      onSelectionChange={(key: Key | null) => {
                        if (key === null) return
                        patch({
                          parentId: key === TOP_LEVEL ? null : String(key),
                        })
                      }}
                    >
                      <SelectItem id={TOP_LEVEL}>
                        {t('categories.parent.none')}
                      </SelectItem>
                      {parentOptions.map((parent) => (
                        <SelectItem key={parent.id} id={parent.id}>
                          {parent.name}
                        </SelectItem>
                      ))}
                    </Select>
                  )}
                </div>

                <CategoryColourField
                  value={draft.color}
                  onChange={(color) => patch({ color })}
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
