/**
 * How wide the budget list lays itself out, given how many budgets are in it.
 *
 * Two or more pair: `lg:grid-cols-2` halves the row to ~570px, which is what closes the ~1000px of
 * empty rule a full-width budget row drew at 1440 without changing the budget object itself.
 *
 * **One does not.** A lone card in a two-column grid is a card in the left half of the page with
 * the right half empty — the same void the pairing exists to remove, moved rather than closed. So a
 * single budget takes the list band instead, which is the answer `/categories` and
 * `/transactions/groups` already give for a screen that is one column of content.
 *
 * A function rather than a ternary at the call site because the decision is the interesting part
 * and it is the part a test can hold: the arrangement of a screen should not be something you have
 * to render a route to find out.
 */
export function budgetListClass(count: number): string {
  return count === 1
    ? 'grid max-w-list items-start gap-4'
    : 'grid items-start gap-4 lg:grid-cols-2'
}
