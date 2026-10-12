// TEMPORARY probe for #649 - never committed.
import { createFileRoute } from '@tanstack/react-router'

import { probeRawNotFound } from '#/server/fns/probe649'

export const Route = createFileRoute('/probe649/ssr-not-found')({
  loader: () => probeRawNotFound(),
  errorComponent: () => <main>ssr-raw-notfound-panel</main>,
  component: () => <main>never</main>,
})
