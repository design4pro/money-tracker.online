/**
 * Installs the three notification dispatchers. Imported for its side effect only.
 *
 * Three seams, three `NOOP_*` defaults, one place that replaces them — in the style of
 * `#/server/billing/install`, and imported by the Worker entry beside it. Module level rather than
 * per request, because two of the three producers only ever run on a scheduled invocation, which
 * loads no server function: an installation done anywhere in the request path would leave the crons
 * dispatching into the no-ops forever, and `dispatcherInstalled: false` in the run summary is
 * exactly the symptom that would report.
 *
 * **The import direction matters.** The three producers know nothing about notifications — their
 * seams are `(scope, event)` function types and nothing more — and `./adapters` knows about both.
 * Reversing that would put the notification store into the budget, recurring and goal modules'
 * import graphs to satisfy a type, and `#/server/budgets/thresholds` is imported by the budget
 * repository.
 */

import { setBudgetAlertDispatcher } from '#/server/budgets/thresholds'
import { setGoalReachedDispatcher } from '#/server/goals/reached'
import { setRecurringReminderDispatcher } from '#/server/recurring/reminders'

import {
  notifyBudgetAlerts,
  notifyGoalReached,
  notifyRecurringReminders,
} from './adapters'

setBudgetAlertDispatcher(notifyBudgetAlerts)
setRecurringReminderDispatcher(notifyRecurringReminders)
setGoalReachedDispatcher(notifyGoalReached)
