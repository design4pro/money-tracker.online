// TEMPORARY probe for #649 - never committed.
import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'

import {
  probeAuth,
  probeHandler,
  probeOk,
  probeRawNotFound,
  probeSentinel,
  probeValidate,
} from '#/server/fns/probe649'

export const Route = createFileRoute('/probe649/')({ component: Probe })

function Probe() {
  useEffect(() => {
    ;(window as unknown as Record<string, unknown>).__probe = {
      handler: () => probeHandler(),
      auth: () => probeAuth(),
      validate: () => probeValidate({ data: { count: 'twelve' } as never }),
      rawNotFound: () => probeRawNotFound(),
      sentinel: () => probeSentinel(),
      ok: () => probeOk(),
    }
  }, [])
  return <main>probe649</main>
}
