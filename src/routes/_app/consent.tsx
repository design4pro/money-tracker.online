import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { ErrorPanel } from '#/components/app/shell'
import { Skeleton } from '#/components/ui'
import { authClient } from '#/lib/auth-client'
import { useTranslate } from '#/lib/i18n'
import { pageHead } from '#/routes/-lib/page-title'
import { loadConsentPage, recordOauthGrant } from '#/server/fns/agent-grants'

import { ConsentPage } from './-ui/consent-page'

const searchSchema = z
  .object({
    client_id: z.string().optional(),
    scope: z.string().optional(),
    claims: z.string().optional(),
    code: z.string().optional(),
  })
  .passthrough()

export const Route = createFileRoute('/_app/consent')({
  validateSearch: searchSchema,
  loader: async () => ({ consent: await loadConsentPage() }),
  pendingComponent: ConsentSkeleton,
  errorComponent: ConsentError,
  head: ({ matches }) => pageHead(matches, (t) => t('oauth.consent.requested')),
  component: ConsentRoute,
})

function ConsentSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden="true">
      <Skeleton className="h-9 w-72" />
      <Skeleton className="h-48 w-full" />
    </div>
  )
}

function ConsentError({ reset }: { readonly reset: () => void }) {
  const t = useTranslate()
  return (
    <ErrorPanel
      title={t('oauth.consent.error.title')}
      body={t('empty.error.body')}
      onRetry={reset}
    />
  )
}

function ConsentRoute() {
  const { consent } = Route.useLoaderData()
  const search = Route.useSearch()

  return (
    <ConsentPage
      consent={consent}
      clientId={search.client_id ?? ''}
      onAllow={async (input) => {
        await recordOauthGrant({
          data: {
            name: input.name,
            clientId: input.clientId,
            scopes: [...input.scopes],
          },
        })
      }}
      onDecide={async (accept) => {
        const result = await authClient.$fetch<{
          redirect?: boolean
          url?: string
        }>('/oauth2/consent', {
          method: 'POST',
          body: { accept },
        })
        const url =
          result.data && typeof result.data.url === 'string'
            ? result.data.url
            : null
        if (url) {
          window.location.assign(url)
          return
        }
        if (result.error) {
          throw result.error
        }
      }}
    />
  )
}
