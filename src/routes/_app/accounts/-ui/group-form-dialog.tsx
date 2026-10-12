import { useState } from 'react'

import { ErrorPanel, FormModal, useIsDirty } from '#/components/app/shell'
import { hasChildren } from '#/components/app/tree'
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
import { useTranslate } from '#/lib/i18n'

import { refusalFor } from './group-refusal'

import type { Key } from 'react-aria-components'

import type { GroupItem } from './group-rows'

/**
 * Creating a group, renaming one and filing it inside another, in a single dialog.
 *
 * ## The Inside field, and the rule it carries
 *
 * Groups nest one level. A group that already holds sub-groups cannot sit inside another, so for
 * it the field is **disabled with the reason written under it** rather than left out: a missing
 * field is a question nobody can ask. It lists top-level groups only, and never the group itself.
 *
 * ## The refusal stays in the dialog
 *
 * A refused save renders into the dialog and waits, as a catalogue sentence chosen by the kind of
 * failure (`refusalFor`). The server's own message is never shown: it is English, names an id, and
 * for a database failure may carry SQL.
 */
export interface GroupFormValues {
  readonly name: string
  readonly parentId: string | null
}

export interface GroupFormDialogProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  /** `null` creates; a group edits it. */
  group: GroupItem | null
  /** Pre-selected parent when the dialog was opened from a row's _Add sub-group_. */
  initialParentId?: string | null
  groups: ReadonlyArray<GroupItem>
  /** Rejects when the server refuses; the dialog shows the sentence and stays open. */
  onSubmit: (values: GroupFormValues) => Promise<void>
}

/** The reserved Select key for "no parent". Never a group id. */
const TOP_LEVEL = '__top_level__'

export function GroupFormDialog({
  isOpen,
  onOpenChange,
  group,
  initialParentId,
  groups,
  onSubmit,
}: GroupFormDialogProps) {
  const t = useTranslate()
  const isEdit = group !== null

  // Seeded once. The route mounts this only while the dialog is open and keys it by the group
  // being edited, so a fresh open is a fresh component and there is no stale draft to synchronise.
  const [draft, setDraft] = useState<GroupFormValues>(() => ({
    name: group?.name ?? '',
    parentId: group === null ? (initialParentId ?? null) : group.parentId,
  }))
  const [isSaving, setIsSaving] = useState(false)
  const [failure, setFailure] = useState<ReturnType<typeof refusalFor> | null>(
    null,
  )
  // Validation appears after the first submit: an empty field is not a mistake until it is offered.
  const [hasTriedToSubmit, setHasTriedToSubmit] = useState(false)

  const trimmedName = draft.name.trim()
  const isDirty = useIsDirty(draft)

  const canBeNested = group === null || !hasChildren(groups, group.id)
  const parentOptions = groups.filter(
    (candidate) => candidate.parentId === null && candidate.id !== group?.id,
  )

  async function submit() {
    setIsSaving(true)
    setFailure(null)
    try {
      await onSubmit({ name: trimmedName, parentId: draft.parentId })
      onOpenChange(false)
    } catch (error) {
      setFailure(refusalFor(error))
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
              title={t(
                isEdit ? 'accounts.group.rename' : 'accounts.group.create',
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
                    mode="region"
                    title={t('accounts.group.form.error.title')}
                    body={t(failure.messageKey)}
                  />
                )}

                <TextField
                  name="name"
                  label={t('accounts.group.field.name')}
                  value={draft.name}
                  onChange={(name) =>
                    setDraft((current) => ({ ...current, name }))
                  }
                  isRequired
                  autoFocus
                  maxLength={100}
                  errorMessage={
                    hasTriedToSubmit && trimmedName === ''
                      ? t('validation.name.required')
                      : undefined
                  }
                />

                <Select
                  label={t('accounts.group.field.parent')}
                  description={
                    canBeNested
                      ? undefined
                      : t('accounts.group.field.parent.hasChildren')
                  }
                  isDisabled={!canBeNested}
                  selectedKey={draft.parentId ?? TOP_LEVEL}
                  onSelectionChange={(key: Key | null) => {
                    if (key === null) return
                    setDraft((current) => ({
                      ...current,
                      parentId: key === TOP_LEVEL ? null : String(key),
                    }))
                  }}
                >
                  <SelectItem id={TOP_LEVEL}>
                    {t('accounts.group.parent.none')}
                  </SelectItem>
                  {parentOptions.map((parent) => (
                    <SelectItem key={parent.id} id={parent.id}>
                      {parent.name}
                    </SelectItem>
                  ))}
                </Select>
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
