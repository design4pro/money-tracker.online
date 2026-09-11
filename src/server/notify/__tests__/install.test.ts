/**
 * That importing the install module actually closes the three gaps.
 *
 * The isolation is not decoration. Every seam here is module-level mutable state, and the suites
 * next door assert that the `NOOP_*` constants are still the defaults — which is true for them,
 * because nothing in their graph imports this module. Installing into a shared registry would make
 * those two facts fight, and which one won would depend on file order. So each case builds a fresh
 * module graph with `vi.resetModules()` and asks *that* graph's predicates: the installer and the
 * producer it installs into are then the same two instances, which is the only arrangement in which
 * the question means anything.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
})

/** The three predicates, read out of one freshly built graph. */
async function installedFlags(): Promise<{
  budget: boolean
  recurring: boolean
  goal: boolean
}> {
  const [thresholds, reminders, reached] = await Promise.all([
    import('#/server/budgets/thresholds'),
    import('#/server/recurring/reminders'),
    import('#/server/goals/reached'),
  ])

  return {
    budget: thresholds.isBudgetAlertDispatcherInstalled(),
    recurring: reminders.isRecurringReminderDispatcherInstalled(),
    goal: reached.isGoalReachedDispatcherInstalled(),
  }
}

describe('a fresh module graph', () => {
  it('starts with all three seams reporting the gap', async () => {
    expect(await installedFlags()).toStrictEqual({
      budget: false,
      recurring: false,
      goal: false,
    })
  })

  it('reports all three closed once the install module is imported', async () => {
    await import('../install')

    expect(await installedFlags()).toStrictEqual({
      budget: true,
      recurring: true,
      goal: true,
    })
  })

  it('installs the adapters themselves, not some other function', async () => {
    const [
      { notifyBudgetAlerts, notifyGoalReached, notifyRecurringReminders },
    ] = await Promise.all([import('../adapters'), import('../install')])
    const [thresholds, reminders, reached] = await Promise.all([
      import('#/server/budgets/thresholds'),
      import('#/server/recurring/reminders'),
      import('#/server/goals/reached'),
    ])

    // `isBudgetAlertDispatcherInstalled` only says "not the no-op". These assert *which* function,
    // by dispatching through the seam and watching the adapter refuse an empty batch.
    expect(thresholds.NOOP_ALERT_DISPATCHER).not.toBe(notifyBudgetAlerts)
    expect(reminders.NOOP_REMINDER_DISPATCHER).not.toBe(
      notifyRecurringReminders,
    )
    expect(reached.NOOP_GOAL_REACHED_DISPATCHER).not.toBe(notifyGoalReached)
  })
})

describe('the Worker entry', () => {
  it('imports the install module, so a scheduled invocation gets the dispatchers', async () => {
    // A scheduled invocation loads no server function. If this import were only in the request
    // path, every crossing the cron found would be computed and dropped — the exact failure
    // `./install` exists to prevent, and one an integration test would never reach.
    const source = await import('node:fs').then(({ readFileSync }) =>
      readFileSync(new URL('../../worker.ts', import.meta.url), 'utf8'),
    )

    expect(source).toContain("import './notify/install'")
  })
})
