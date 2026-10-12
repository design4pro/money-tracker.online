// TEMPORARY probe for #649 - never committed.
import { createFileRoute } from '@tanstack/react-router'

import { probeHandler } from '#/server/fns/probe649'

export const Route = createFileRoute('/probe649/swallowed')({
  loader: async () => {
    try {
      await probeHandler()
    } catch {
      return { recovered: true }
    }
    return { recovered: false }
  },
  component: () => <main>swallowed-recovered</main>,
})
