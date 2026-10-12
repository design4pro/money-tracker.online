import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { toast } from '#/components/ui'
import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'

import { useRecurringAction } from '../use-recurring-action'

import type { ReactNode } from 'react'
import type { Catalogue } from '#/lib/i18n'

/**
 * The failure policy of the recurring period and series actions, asserted without a route.
 *
 * What matters is the order and the two outcomes: the server call, then its toast, then the refresh
 * - and the refresh on **both** outcomes, because a refusal ("settled in another tab") is exactly
 * when the row on screen is stale. The other thing that matters is that a refusal never escapes as
 * a rejection: the call sites fire these with `void`, and an unhandled rejection has no toast.
 */

function wrapper({ children }: { readonly children: ReactNode }) {
  return (
    <I18nProvider locale="en" messages={en as Catalogue}>
      {children}
    </I18nProvider>
  )
}

function setup() {
  const order: string[] = []
  vi.spyOn(toast, 'success').mockImplementation(() => {
    order.push('success')
    return 1
  })
  vi.spyOn(toast, 'error').mockImplementation(() => {
    order.push('error')
    return 1
  })
  const refresh = vi.fn(() => {
    order.push('refresh')
    return Promise.resolve()
  })
  const { result } = renderHook(() => useRecurringAction(refresh), { wrapper })
  return { run: result.current, refresh, order }
}

describe('useRecurringAction', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls the server once with no arguments, toasts the success message, then refreshes', async () => {
    const { run, refresh, order } = setup()
    const call = vi.fn(() => {
      order.push('call')
      return Promise.resolve('stored')
    })

    await run(call, 'Period skipped')

    expect(call).toHaveBeenCalledTimes(1)
    expect(call).toHaveBeenCalledWith()
    expect(toast.success).toHaveBeenCalledExactlyOnceWith('Period skipped')
    expect(toast.error).not.toHaveBeenCalled()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['call', 'success', 'refresh'])
  })

  it('shows the failure toast on a refusal, refreshes anyway and does not reject', async () => {
    const { run, refresh, order } = setup()
    const call = vi.fn(() => {
      order.push('call')
      return Promise.reject(new Error('already paid'))
    })

    await expect(run(call, 'Period skipped')).resolves.toBeUndefined()

    expect(toast.error).toHaveBeenCalledExactlyOnceWith(
      en['recurring.toast.failed'],
    )
    expect(toast.success).not.toHaveBeenCalled()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['call', 'error', 'refresh'])
  })

  it('treats a call that throws synchronously as a refusal', async () => {
    const { run, refresh } = setup()

    await expect(
      run(() => {
        throw new Error('before the request left')
      }, 'Period skipped'),
    ).resolves.toBeUndefined()

    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
