import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'

import { ErrorPanel } from '#/components/app/shell'
import { RuleEditorSkeleton } from '#/components/app/transactions'
import { Button, Card, toast } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'
import { createRule } from '#/server/fns/rules'

import { useDataRefresh } from '../../-lib/refresh'
import { loadTransactionReference } from '../-server/list'
import { RuleEditor, ruleEditorReference } from './-ui/rule-editor'

import type { RuleDefinition } from '#/server/rules/schema'
import { pageHead } from '#/routes/-lib/page-title'

/**
 * `/transactions/rules/new` — a rule that does not exist yet.
 *
 * It owns three things and nothing else: the vocabularies the editor's pickers need, the one server
 * call that creates the rule, and where the person lands afterwards. The form itself is
 * `-ui/rule-editor.tsx`, shared with the edit route, because the two differ in exactly that list.
 *
 * ## The locked branch lives here
 *
 * `createRule` answers a `FeatureLockedError` — code `FEATURE_LOCKED` — when the workspace's
 * plan meters rules at zero, which is the only place in the product where the answer to `OPEN-1`
 * exists today. So a refusal for that reason is shown as an upgrade path rather than as a stack
 * trace: *automation is not part of this plan*, and the rule the person wrote is still on the
 * screen. Every other refusal keeps the generic panel, because a rule naming a deleted category is
 * not an entitlement problem and must not read like one.
 */
export const Route = createFileRoute('/_app/transactions/rules/new')({
  loader: async () => ({ reference: await loadTransactionReference() }),
  pendingComponent: RuleEditorSkeleton,
  errorComponent: NewRuleError,
  head: ({ matches }) => pageHead(matches, (t) => t('rules.editor.new.title')),
  component: NewRuleRoute,
})

/**
 * The editor never opened.
 *
 * Deliberately not `rules.editor.error.*`, which this screen already uses for a save that failed
 * with the person's rule still on it. That sentence — *the rule was not saved* — would be a lie
 * here: there was no rule yet. `rules.editor.load.error.*` says the editor could not be loaded and
 * that nothing was created, which is the pair of facts somebody about to try again needs.
 */
function NewRuleError({
  error,
  reset,
}: {
  readonly error: Error
  readonly reset: () => void
}) {
  const t = useTranslate()
  return (
    <ErrorPanel
      title={t('rules.editor.load.error.title')}
      body={t('rules.editor.load.error.body')}
      detail={error.message}
      onRetry={reset}
    />
  )
}

function NewRuleRoute() {
  const t = useTranslate()
  const { reference } = Route.useLoaderData()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const refreshCaches = useDataRefresh()

  const [isSaving, setIsSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [isLocked, setIsLocked] = useState(false)

  async function save(definition: RuleDefinition) {
    setIsSaving(true)
    setFailure(null)
    setIsLocked(false)
    try {
      await createRule({ data: definition })
      toast.success(t('rules.toast.created'))
      await Promise.all([router.invalidate(), refreshCaches()])
      await navigate({ to: '/transactions/rules' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('FEATURE_LOCKED')) {
        setIsLocked(true)
        setFailure(t('rules.error.locked'))
      } else {
        setFailure(message)
      }
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {isLocked ? (
        <Card className="flex flex-col gap-2">
          <h2 className="text-subtitle font-semibold text-ink">
            {t('rules.empty.locked.title')}
          </h2>
          <p className="text-body text-ink-2">{t('rules.empty.locked.body')}</p>
          <div>
            <Button
              variant="primary"
              onPress={() => void navigate({ to: '/settings' })}
            >
              {t('rules.empty.locked.action')}
            </Button>
          </div>
        </Card>
      ) : null}

      <RuleEditor
        title={t('rules.editor.new.title')}
        initial={{
          name: '',
          matchMode: 'all',
          conditions: null,
          actions: null,
          runOn: ['manual_create', 'import'],
        }}
        reference={ruleEditorReference(reference)}
        isSaving={isSaving}
        saveError={isLocked ? null : failure}
        onSave={save}
        onCancel={() => void navigate({ to: '/transactions/rules' })}
      />
    </div>
  )
}
