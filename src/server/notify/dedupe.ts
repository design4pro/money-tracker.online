/**
 * The one dedupe key this stage has to invent.
 *
 * Two of the three producers already build theirs, because both re-evaluate on a timer and both
 * need a memory of what they have already said: `crossingMarkerKey` in
 * `#/server/budgets/thresholds` and `reminderMarkerKey` in `#/server/recurring/markers`. The
 * adapters reuse those verbatim, so the `notifications` row and the KV marker agree by
 * construction rather than by two similar-looking template strings.
 *
 * `goal.reached` has neither, because it is not swept: `#/server/fns/goals` dispatches it once, on
 * the transition, inside the request that caused it. But `dedupe_key` is `NOT NULL`, and the column
 * has to mean something for this kind too — so it means "this goal has been reached", keyed on
 * nothing but the goal.
 *
 * **Keyed on the goal alone, deliberately.** Not on the transaction, and not on the moment: a goal
 * that is reached, un-reached by a removed contribution and reached again is the same news the
 * second time, and a household does not want to hear it twice. Once ever is the right answer, and
 * the scoped unique index is what enforces it.
 *
 * Versioned like its two siblings, for the same reason they give: if what "reached" means changes,
 * the new rule must announce itself rather than inherit rows written under the old one.
 */

export function goalReachedDedupeKey(input: {
  readonly goalId: string
}): string {
  return `goal:reached:v1:${input.goalId}`
}
