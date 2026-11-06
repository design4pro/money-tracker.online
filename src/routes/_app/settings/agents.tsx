import { createFileRoute, useRouter } from '@tanstack/react-router'

import { ErrorPanel } from '#/components/app/shell'
import { Skeleton } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'
import { pageHead } from '#/routes/-lib/page-title'
import {
  loadAgentsPage,
  mintAgentPat,
  revokeAgentGrant,
  updateAgentGrant,
} from '#/server/fns/agent-grants'

import { AgentsPage } from './-ui/agents-page'

import type { AgentScope } from '#/lib/agent-scopes'

export const Route = createFileRoute('/_app/settings/agents')({
  loader: async () => ({ page: await loadAgentsPage() }),
  pendingComponent: AgentsSkeleton,
  errorComponent: AgentsError,
  head: ({ matches }) => pageHead(matches, (t) => t('settings.agents.title')),
  component: AgentsRoute,
})

function AgentsSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden="true">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

function AgentsError({ reset }: { readonly reset: () => void }) {
  const t = useTranslate()
  return (
    <ErrorPanel
      title={t('settings.agents.error.title')}
      body={t('empty.error.body')}
      onRetry={reset}
    />
  )
}

function AgentsRoute() {
  const { page } = Route.useLoaderData()
  const router = useRouter()

  return (
    <AgentsPage
      page={page}
      onMint={async (input: {
        name: string
        scopes: ReadonlyArray<AgentScope>
      }) => {
        const minted = await mintAgentPat({
          data: { name: input.name, scopes: [...input.scopes] },
        })
        await router.invalidate()
        return minted
      }}
      onRevoke={async (grantId) => {
        await revokeAgentGrant({ data: { grantId } })
        await router.invalidate()
      }}
      onUpdate={async (input) => {
        await updateAgentGrant({
          data: {
            grantId: input.grantId,
            name: input.name,
            scopes: [...input.scopes],
          },
        })
        await router.invalidate()
      }}
    />
  )
}
