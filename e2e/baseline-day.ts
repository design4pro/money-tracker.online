/**
 * The day the browser suite photographs the fixture at.
 *
 * The seed is anchored to a constant and reads no clock, so the fixture itself never moves. The
 * *comparison* does: the dashboard opens on the current month, the upcoming rail reads forward from
 * today, budget bars divide by days elapsed. Left to the wall clock a baseline recorded one evening
 * photographs a different application the next morning, and no pixel tolerance absorbs that - a row
 * leaving a list moves everything below it.
 *
 * It lives alone in this file because three unrelated places need the same date and a second copy
 * would be wrong for months before anybody noticed: `playwright.config.ts` sends it as the
 * `x-mt-server-today` header, `vite.config.ts` folds it into an end-to-end build as
 * `__E2E_SERVER_TODAY__`, and every `e2e/__screenshots__` baseline was recorded against it.
 *
 * Changing it re-records every visual baseline. That is a deliberate act, not a maintenance chore.
 */
export const BASELINE_DAY = '2026-08-20'
