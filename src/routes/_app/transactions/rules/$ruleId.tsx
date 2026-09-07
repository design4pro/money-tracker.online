import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'

import { ErrorPanel } from '#/components/app/accounts'
import { toast } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'
import { deleteRule, loadRule, updateRule } from '#/server/fns/rules'

import { useDataRefresh } from '../../-lib/refresh'
import { ConfirmDialog } from '../../accounts/-ui/confirm-dialog'
import { loadTransactionReference } from '../-server/list'
import { RuleEditor, ruleEditorReference } from './-ui/rule-editor'

import type { RuleDefinition } from '#/server/rules/schema'
import { pageHead } from '#/routes/-lib/page-title'

/**
 * `/transactions/rules/$ruleId` — one rule, open for editing.
 *
 * The same editor as `/new`; the three differences are the drafts it opens on, the call the save
 * makes, and the delete this route has and that one does not.
 *
 * ## The id in the URL is not an authorised id
 *
 * `loadRule` decides that, tenant-scoped, in the repository: another workspace's rule is a
 * `NotFoundError` and never a `ForbiddenError`, because a 403 would confirm the row exists
 * somewhere. There is no `beforeLoad` guard here — a route guard is UX, and this is the boundary.
 *
 * ## Saving clears a pause, and that is the resolution
 *
 * A rule is paused because it named something that no longer exists (`14-S3`). `updateRule` clears
 * `paused_reason` on every edit, so replacing the broken reference **is** the fix and needs no
 * second control. The banner offers the same resolution as one press and lands in the same place.
 *
 * ## Two conditions become one paragraph
 *
 * An amount range opened here reads back as two conditions in the sentence, because that is what it
 * is — the editor never re-collapses two rows into a `between` that the schema has no operator for.
 */
export const Route = createFileRoute('/_app/transactions/rules/$ruleId')({
  loader: async ({ params }) => {
    const [rule, reference] = await Promise.all([
      loadRule({ data: { ruleId: params.ruleId } }),
      loadTransactionReference(),
    ])
    return { rule, reference }
  },
  errorComponent: RuleDetailError,
  head: ({ matches, loaderData }) =>
    pageHead(
      matches,
      (t) => loaderData?.rule.name ?? t('rules.editor.edit.title'),
    ),
  component: RuleDetailRoute,
})

function RuleDetailError({
  error,
  reset,
}: {
  readonly error: Error
  readonly reset: () => void
}) {
  const t = useTranslate()
  return (
    <ErrorPanel
      title={t('rules.error.title')}
      body={t('rules.error.body')}
      detail={error.message}
      onRetry={reset}
    />
  )
}

function RuleDetailRoute() {
  const t = useTranslate()
  const { rule, reference } = Route.useLoaderData()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const refreshCaches = useDataRefresh()

  const [isSaving, setIsSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)

  async function save(definition: RuleDefinition) {
    setIsSaving(true)
    setFailure(null)
    try {
      await updateRule({ data: { ruleId: rule.id, patch: definition } })
      toast.success(t('rules.toast.saved'))
      await Promise.all([router.invalidate(), refreshCaches()])
      await navigate({ to: '/transactions/rules' })
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <>
      {/*
        14-S3 SLOT — the paused-rule banner for this one rule renders here, above the editor:

          <PausedBanner rules={[rule]} reference={reference} onResolved={refresh} />

        The same component and the same props as the list route's slot, given a one-element array,
        so the banner has one shape and one owner rather than a list variant and a detail variant.
        It renders nothing when the rule is not paused.
      */}

      <RuleEditor
        title={t('rules.editor.edit.title')}
        initial={{
          name: rule.name,
          matchMode: rule.matchMode,
          conditions: [...rule.conditions],
          actions: [...rule.actions],
          runOn: rule.runOn,
        }}
        reference={ruleEditorReference(reference)}
        isSaving={isSaving}
        saveError={failure}
        onSave={save}
        onCancel={() => void navigate({ to: '/transactions/rules' })}
        onDelete={() => setIsConfirmingDelete(true)}
      />

      {isConfirmingDelete ? (
        <ConfirmDialog
          isOpen
          onOpenChange={setIsConfirmingDelete}
          title={t('rules.confirm.delete.title')}
          body={t('rules.confirm.delete.body')}
          confirmLabel={t('rules.confirm.delete.action')}
          isDestructive
          errorTitle={t('rules.toast.failed')}
          errorBody={t('rules.error.body')}
          onConfirm={async () => {
            await deleteRule({ data: { ruleId: rule.id } })
            toast.success(t('rules.toast.deleted'))
            setIsConfirmingDelete(false)
            await Promise.all([router.invalidate(), refreshCaches()])
            await navigate({ to: '/transactions/rules' })
          }}
        />
      ) : null}
    </>
  )
}
