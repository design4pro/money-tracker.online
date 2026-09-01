# 0006. Money is stored as integer minor units scaled by the currency's own digits

Status: accepted
Date: 2026-09-01

## Context

A personal finance product's whole value is that its numbers are right. There are three plausible
representations of an amount:

1. **A floating-point number of major units** (`12.34`). Simple, universally understood, and wrong:
   `0.1 + 0.2 !== 0.3`, and a sum over a year of transactions accumulates error that shows up as a
   balance that disagrees with its own transaction list by a grosz.
2. **A decimal string or a decimal library.** Correct, but every arithmetic operation is a function
   call, comparisons and sorting in SQL need care, and D1/SQLite has no decimal type — so it is a
   `TEXT` column that cannot be summed by the database.
3. **An integer number of minor units.** Exact, natively summable and sortable in SQL, and the
   representation every payment system already uses.

There is a fourth decision hiding inside the third, and it is the one products get wrong: **what is
the scale?** Assuming 100 is correct for the majority of currencies and catastrophically wrong for
the rest. JPY and KRW have zero minor digits, so a "cents" assumption inflates every yen amount by
a hundred. KWD and BHD have three, so the same assumption divides every dinar by ten.

## Decision

Money is an `integer` count of minor units, paired with a `text(3)` ISO 4217 currency code, and
**the scale is `currencies.digits`, read from the catalogue, never a hard-coded 2**.

- No float arithmetic on an amount at any layer — not in the database, not in a server function's
  return, not in a chart datum, not in a tooltip, not in an export row, not in a test fixture.
- Direction is a column (`income` / `expense`); stored amounts are non-negative.
- Rounding is `roundHalfToEven`, and it happens exactly once, at the boundary where a value is
  converted or allocated. One rounding function exists; a second is a defect.
- Exchange rates are integers too: `rate_e10`, the rate × 10^10 (see ADR 0006's sibling discussion in
  `docs/MONEY.md` §2).
- Conversion between currencies with different `digits` carries the scale term
  `10^(digits(to) − digits(from))`; omitting it is a hundred-fold error that every same-digit test
  passes over.
- TypeScript brands the boundary types (`Minor`, `RateE10`) so a bare `number` cannot be passed where
  an amount is expected.
- Splits allocate by the **largest remainder method**, so `Σ splits = parent` holds exactly for any
  line count and any currency scale.

The full contract is `docs/MONEY.md`, which wins over `docs/SPEC.md` on any point of arithmetic.

## Consequences

Every amount that crosses a boundary — a form input, a CSV cell, an API payload, a chart datum —
needs an explicit conversion, and each of those conversions is a place to get the scale wrong. The
mitigation is that exactly one module (`src/lib/money.ts`) knows about scale at all, and everything
else calls it.

Reading raw rows in a database console is less pleasant: `123456` requires knowing the currency to
mean anything. Debugging output therefore formats amounts, and a raw dump of the transactions table
is not human-readable without a join.

Zero-decimal currencies break UI assumptions that are easy to make: a field that always renders a
decimal separator looks broken for JPY. That is the formatter's responsibility, not the caller's, and
it is why the formatter takes the currency rather than a locale alone.

The largest cost is cultural: this rule has to be enforced in review forever, because the
single-float shortcut is always locally convenient and always looks harmless. `CONTRIBUTING.md`
lists it first among the things that get a change rejected, and
`src/server/repos/__tests__/money-invariants.test.ts` is a test surface every money-touching write
path must add to.

In exchange, the fourteen failure modes in `docs/MONEY.md` §8 are unreachable rather than merely
unlikely.
