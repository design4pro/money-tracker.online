/**
 * The day the browser suite pins the server's clock to.
 *
 * "Baseline" here is the fixture's reference day and nothing else. It used to also name the
 * screenshot set this date was recorded against; ADR 0016 deleted those, and the constant stayed
 * because the reason for it never had anything to do with pixels.
 *
 * The seed is anchored to a constant and reads no clock, so the fixture itself never moves. What
 * moves is what the *server* selects from it: the dashboard opens on the current month, the
 * upcoming rail reads forward from today, budget bars divide by days elapsed. Left to the wall
 * clock, a spec that asserts a count, a total or an empty state passes one evening and fails the
 * next morning, and every month boundary moves the whole dashboard.
 *
 * It lives alone in this file because two unrelated places need the same date and a second copy
 * would be wrong for months before anybody noticed: `playwright.config.ts` sends it as the
 * `x-mt-server-today` header for `pnpm dev`, and `vite.config.ts` folds it into an end-to-end
 * build as `__E2E_SERVER_TODAY__`, which is what CI serves.
 *
 * Changing it moves every date-dependent assertion in the suite at once. That is a deliberate act,
 * not a maintenance chore.
 */
export const BASELINE_DAY = '2026-08-20'
