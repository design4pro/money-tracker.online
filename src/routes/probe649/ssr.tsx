// TEMPORARY probe for #649 - never committed.
import { createFileRoute } from '@tanstack/react-router'

import { probeHandler } from '#/server/fns/probe649'

export const Route = createFileRoute('/probe649/ssr')({
  loader: () => probeHandler(),
  errorComponent: () => <main>ssr-error-panel</main>,
  component: () => <main>never</main>,
})
