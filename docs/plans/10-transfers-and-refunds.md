# 10 — Transfers and refunds

## Area brief

A transfer is **two transactions sharing a `transfer_id`** — one `expense` on the source account, one
`income` on the destination. There is no third direction and no separate transfer entity. Every
downstream consumer (budgets, category stats, cash flow) sees only income and expense and needs no
exception branch.

`transfer_kind` answers only _"is this a transfer and how many legs"_: `none`, `internal` (the only
two-leg kind), `external_out`, `external_in`. Link targets are separate nullable FKs. Collapsing
those two questions into one column is the modelling flaw this product does not inherit.

The **four ref-amount cases** (`docs/MONEY.md` §4) are the arithmetic core of this plan, and the
invariant they exist to hold is: _an internal transfer's net effect on net worth in base currency is
zero whenever either leg is in base._

**Nature changes are unlink-first.** There is no path that flips a leg's kind in place. That is a
day-one decision rather than a repair, because in-place flipping is where the reference behaviour is
admitted to be unintuitive.

---

## Stage 10-S1 — The transfer write path and the four ref-amount cases

### Stage id

`10-S1` · Wave 3 · effort **XL**.

### Reference rows

`XFER-01 missing → done` — two-leg internal transfers with paired create, edit and delete.
`XFER-02 missing → done` — one-leg `external_out` / `external_in`.
`XFER-03 missing → done` — the four ref-amount cases.
`XFER-04 missing → done` — unlink-first nature changes.

### Owned paths

- `src/server/transfers/create.ts` — new
- `src/server/transfers/pair.ts` — new
- `src/server/transfers/ref-amount-cases.ts` — new
- `src/server/repos/transfers.ts` — new
- `src/server/fns/transfers.ts` — new
- `src/server/transfers/__tests__/ref-amount-cases.test.ts` — new
- `src/server/repos/__tests__/transfers.test.ts` — new

### Data and migration

`transactions.transfer_kind` and `transfer_id` exist from `00-S5`. No schema change.

An `internal` transfer is two rows with the same `transfer_id` and opposite directions; there is no
`transfers` table, because a transfer has no attributes of its own that its legs do not carry. A
table would be a third place for the pair to disagree.

### Server (repo, server function, Zod)

- **Repository.** `transfers.ts`: `createTransfer`, `updateTransfer`, `deleteTransfer`,
  `getTransferPair(transferId)`, `unlinkTransfer(transferId)`, `convertToTransfer({ transactionId,
kind, counterAccountId? })`.
- **Pairing rules**, each of which is a refusal somewhere:
  1. Editing one leg propagates to the other, in one `db.batch`.
  2. **Amounts may differ** (different currencies); **dates may not**. A date edit writes both legs.
  3. Deleting one leg deletes the other. There is no orphan-leg state, and
     `07-S1`'s `deleteTransaction` already refuses a bare leg delete and points here.
  4. **A transaction with splits cannot become a transfer**, and a transfer leg cannot gain splits.
     Refused in both directions, with the message naming which rule applied.
  5. A leg with an active refund link cannot be unlinked until the refund link is removed.
- **`ref-amount-cases.ts`** implements `docs/MONEY.md` §4 verbatim:
  1. source in base, destination not → destination's `ref_amount` **is** the source's.
  2. source not in base, destination in base → **the source's `ref_amount` is updated** to the
     destination amount; both equal.
  3. both in base → both equal.
  4. neither in base → each computes independently, and the resulting FX difference is real and is
     **surfaced** rather than hidden.
- **Server function.** One per repository export.
- **Zod.** `createTransfer` takes a discriminated union on `kind`: `internal` requires both
  `sourceAccountId` and `destinationAccountId` and refuses them being equal; `external_out` /
  `external_in` take exactly one account. The shape makes an impossible transfer unrepresentable.
- **Authorisation.** `requireOrg()`; both account ids are scoped in the repository.
- **Ledger batching.** Every transfer write runs inside `runWithLedgerBatch`, and a two-leg write
  touches **two** accounts, so the batch enqueues two rebuilds — one per account, once each.

### UI (route, components)

- **Route.** None of its own; the transfer form is a mode of `07-S3`'s entry form and the pair is
  shown on `07-S3`'s detail screen. This stage owns the **write path**; the surfaces belong to the
  stages that already own those files. That split is deliberate: two stages editing
  `transaction-form.tsx` in one wave would collide.
- **Components.** None.
- **States.** Not applicable.
- **Tokens.** None.
- **Accessibility.** Requirement recorded for `10-S2`: case 4's FX difference must be **text**, not a
  colour or an icon.

### Quota

No countable row: a transfer is transactions, and transactions are unmetered (`07-S1`).

### Tenant isolation test

Added to `tenant-isolation.test.ts`: A, in A's scope, attempts `createTransfer` with B's
`destinationAccountId`, `getTransferPair` on B's `transfer_id`, `updateTransfer` and `deleteTransfer`
on B's pair, and `convertToTransfer` on B's transaction. Every one is a `NotFoundError`; B's pairs are
intact. Functions covered: all six exports.

**The sharpest case:** an `internal` transfer whose source is A's account and whose destination is
B's must not create a **one-legged** row in A. It creates nothing, and A's account has no new
transaction afterwards.

### Money invariant

**The zero-net property is this stage's reason to exist.** Cases in `money-invariants.test.ts`:

- _case 1_: source EUR (base), destination PLN → destination's `ref_amount_minor` equals the source's
  exactly, and the pair's net effect on base net worth is **exactly zero**.
- _case 2_: source PLN, destination EUR (base) → the **source's** `ref_amount_minor` is updated to
  equal the destination's, and the net is zero.
- _case 3_: both base → equal, net zero.
- _case 4_: PLN → USD, neither base → each computes independently, the net is **non-zero**, and the
  difference equals the arithmetic difference of the two conversions to the minor unit. This case
  asserts the difference is _correct_, not that it is absent.
- _a transfer never appears in a category total_, because both legs carry `transfer_kind !== 'none'`
  and every category aggregation excludes them by policy.
- _a date edit moves both legs and recomputes both `ref_amount_minor` at the new date's rate_, so the
  pair never straddles two rate days.
- _deleting one leg deletes both and enqueues two rebuilds_.

### Verification

- Command gate.
- `ref-amount-cases.test.ts`: the four cases with hand-computed integers, at 2-, 0- and 3-digit
  currencies, and at a boundary where half-to-even rounding matters (a rate producing exactly `.5` of
  a minor unit).
- `transfers.test.ts`: the five pairing refusals; the ledger batch enqueues two rebuilds; the
  isolation cases.
- No browser evidence and no axe run: this stage ships no surface, and says so.

### Definition of done

§7 items 1–3 and 5–7. Item 4 does not apply (no surface).

### Blockers

None.

---

## Stage 10-S2 — Refunds

### Stage id

`10-S2` · Wave 3 · effort **L**.

### Reference rows

`XFER-05 missing → done` — refunds, including split-level and external-origin.
`XFER-06 missing → done` — the refund UI on the transaction detail screen.

### Owned paths

- `src/server/repos/refunds.ts` — new
- `src/server/fns/refunds.ts` — new
- `src/routes/_app/transactions/-ui/refund-panel.tsx` — new
- `src/routes/_app/transactions/-ui/refund-dialog.tsx` — new
- `src/server/repos/__tests__/refunds.test.ts` — new
- `e2e/refunds.visual.spec.ts` — new

### Data and migration

`refunds` exists from `00-S5`: `original_transaction_id NULL` (null = a refund of something outside
the system), `refund_transaction_id UNIQUE`, `split_id NULL`, `amount_minor`. No schema change.

`refund_transaction_id` is **unique**: one transaction is a refund of at most one thing. The reverse
is not unique — one purchase can be refunded in parts.

### Server (repo, server function, Zod)

- **Repository.** `refunds.ts`: `listRefundsFor(transactionId)`, `linkRefund({ refundTransactionId,
originalTransactionId?, splitId? })`, `unlinkRefund(id)`, `suggestRefundTargets({
refundTransactionId })`.
- **Refusals:**
  - The refund and the original must have **opposite directions**. Linking two expenses is a
    `ConflictError`.
  - The sum of linked refunds may not exceed the original's amount, checked **in the original's own
    currency** in the repository.
  - `07-S1`'s `deleteTransaction` already refuses to delete a transaction with `refund_linked = true`;
    this stage owns the corresponding `unlinkRefund` that clears it.
- `suggestRefundTargets` looks for same-payee, opposite-direction transactions within 90 days whose
  amount is ≥ the refund's, ranked by closeness. It **suggests**; it never links.
- **Zod.** `linkRefund` is a discriminated union: either `originalTransactionId`, or `splitId`, or
  neither (external origin) — never both.
- **Authorisation.** `requireOrg()`.
- **Ledger batching.** Linking a refund changes no amount, so **no rebuild is enqueued**, and the
  stage says so rather than batching defensively. The refund transaction itself was created through
  `07-S1` and already caused its own rebuild.

### UI (route, components)

- **Route.** None new; `refund-panel.tsx` renders inside `07-S3`'s detail screen through a slot that
  stage exposes.
- **Components.** Reuses `Dialog`, `ComboBox`, `MoneyField`, `Table`, `Badge`, `Button`. New:
  `refund-panel.tsx`, `refund-dialog.tsx`.
- **States.** Empty: _"No refunds linked"_ with a Link refund action. Skeleton: two rows. Error:
  `ErrorPanel` inline in the panel, so the rest of the detail screen survives.
- **Tokens.** None new.
- **Accessibility.** The panel states the **effective amount** as text — _"Original 240,00 zł, refunded
  90,00 zł, effective 150,00 zł"_ — because that arithmetic is the reason the feature exists and
  making a reader compute it from three chips is a failure. The suggestion list's ranking is explained
  in text, not implied by order alone.

### Quota

No countable row.

### Tenant isolation test

Added to `tenant-isolation.test.ts`: A attempts `linkRefund` with B's `originalTransactionId`, with
B's `splitId`, and with B's `refundTransactionId`; `unlinkRefund` on B's link; and
`suggestRefundTargets` for B's transaction. Every one is a `NotFoundError`, and
`suggestRefundTargets` in A's scope never returns B's transactions even when they match perfectly.
Functions covered: all four exports.

### Money invariant

_A refund reduces the effective amount and never rewrites the original._ Cases:

- _the original's `amount_minor` and `ref_amount_minor` are unchanged by linking a refund_ — the
  effective amount is computed, never stored on the original.
- _over-refunding is refused_: linking refunds summing to more than the original is a
  `ConflictError`, checked in the original's currency and in integer minor units.
- _a partial refund of a split reduces that split's effective amount only_, and `Σ splits` against the
  parent is unaffected (that invariant belongs to `11-S1` and this case asserts they compose).
- _an external-origin refund (no `original_transaction_id`) contributes to income normally_ and is not
  netted against anything.
- _a refund in a different currency from its original is refused_ — netting across currencies would
  need a rate and a date the person never chose. The error names both currencies.

### Verification

- Command gate.
- `refunds.test.ts`: the direction refusal, the over-refund refusal, the cross-currency refusal, the
  external-origin case, the suggestion ranking, and the isolation cases.
- Browser evidence: `/transactions/$id` for a transaction with **two partial refunds**, both themes, at
  360 / 1280 / 2560 px, plus the **link dialog with suggestions listed** and the **over-refund error**
  — the error is the point of the stage.
- `e2e/refunds.visual.spec.ts` runs axe on the detail route with the panel populated and the dialog
  open: zero `serious`, zero `critical`.
- Console silent.

### Definition of done

All seven §7 items and all ten §2 clauses.

### Blockers

None.

---

## Stage 10-S3 — Transfer-pair and duplicate suggestions

### Stage id

`10-S3` · Wave 3 · effort **M**.

### Reference rows

`XFER-07 missing → done` — transfer-pair detection with dismissals.
`XFER-08 missing → done` — duplicate detection with dismissals.
`XFER-09 missing → done` — the suggestions screen.

### Owned paths

- `src/server/suggestions/transfer-pairs.ts` — new
- `src/server/suggestions/duplicates.ts` — new
- `src/server/repos/suggestion-dismissals.ts` — new
- `src/server/fns/suggestions.ts` — new
- `src/routes/_app/transactions/suggestions.tsx` — new
- `src/routes/_app/transactions/-ui/suggestion-card.tsx` — new
- `src/server/suggestions/__tests__/transfer-pairs.test.ts` — new
- `src/server/suggestions/__tests__/duplicates.test.ts` — new
- `e2e/suggestions.visual.spec.ts` — new

### Data and migration

`suggestion_dismissals` does **not** exist and is a **`00-foundations.md` requirement stated here**:
`(organization_id, kind, fingerprint)` unique, `dismissed_at`, `dismissed_by_user_id`, where
`fingerprint` is a stable hash of the suggestion's participants. It is minted as a stage in
`00-foundations.md`'s wave-3 schema stage (`00-S9`) and this stage does not touch `schema.ts`.

A dismissal keyed on a **fingerprint** rather than on row ids is deliberate: re-importing the same
file produces new row ids, and a dismissal that does not survive that is a dismissal that reappears
every month.

### Server (repo, server function, Zod)

- **`transfer-pairs.ts`**: finds candidate pairs — opposite directions, different accounts, dates
  within 3 days, and **amounts equal after conversion to base** within one minor unit of tolerance for
  the rounding of two independent conversions. Ranked by date proximity then amount exactness.
- **`duplicates.ts`**: same account, same direction, same `booked_on`, same `amount_minor` and same
  currency, differing only in id — plus the import path's own `import_source_hash` match, which is
  exact rather than heuristic.
- Both return suggestions **excluding anything with a matching dismissal fingerprint**.
- Accepting a transfer-pair suggestion calls `10-S1`'s `convertToTransfer`; accepting a duplicate
  suggestion deletes the newer row through `07-S1`. Neither module writes a transaction itself.
- **Zod.** Dismissals take `{ kind, fingerprint }`.
- **Authorisation.** `requireOrg()`.
- **Ledger batching.** Accepting a suggestion writes through `10-S1` or `07-S1`, both of which batch.
  The suggestion modules themselves are pure reads.

### UI (route, components)

- **Route.** `/transactions/suggestions`, SSR default.
- **Components.** Reuses `Card`, `Button`, `Badge`, `Table`. New: `suggestion-card.tsx`.
- **States.** Empty: _"Nothing to review"_ — and this is the **desired** state, so the copy says so
  rather than reading as a failure. Skeleton: three cards. Error: `ErrorPanel` retryable, per section,
  so a failing duplicate scan does not hide the transfer suggestions.
- **Tokens.** None new.
- **Accessibility.** Each suggestion states **why it was suggested** in text — _"Same amount, opposite
  direction, 1 day apart"_ — because an unexplained suggestion in a finance product is one a careful
  person will not accept. Accept and Dismiss are both real buttons with distinct accessible names
  including the participants; there is no swipe-only affordance.

### Quota

No countable row. The scan's cost is bounded by running it **on demand** for the route, over a rolling
90-day window, rather than on a cron.

### Tenant isolation test

Added to `tenant-isolation.test.ts`: both suggestion scans in A's scope return only A's transactions
even when B has a perfect matching pair; a dismissal written by A does not suppress B's identical
suggestion; `dismiss` with B's fingerprint writes into A's tenant and does not touch B's row.
Functions covered: `findTransferPairs`, `findDuplicates`, `dismissSuggestion`, `listDismissals`.

### Money invariant

_Suggestion matching converts to base for comparison and never writes a converted value._ Cases:

- _a transfer pair across two currencies is suggested when the base-converted amounts agree within one
  minor unit_, and the tolerance is exactly one minor unit — not a percentage, which would match
  unrelated large transactions.
- _accepting a suggestion produces a transfer whose ref-amounts follow the four cases of `10-S1`_, not
  the amounts the suggestion compared. The comparison is a heuristic; the write is the contract.
- _duplicate detection compares `amount_minor` and `currency_code`_, never base-converted values —
  two different-currency transactions of equal base value are not duplicates.

### Verification

- Command gate.
- `transfer-pairs.test.ts` and `duplicates.test.ts`: the matching rules, the one-minor-unit tolerance,
  the dismissal fingerprint surviving a re-import, and the money cases.
- Browser evidence: `/transactions/suggestions` with three transfer pairs and two duplicates, both
  themes, at 360 / 1280 / 2560 px, plus the **empty "nothing to review" state** and a card **after
  dismissal** — the transition is the point.
- `e2e/suggestions.visual.spec.ts` runs axe on the route: zero `serious`, zero `critical`.
- Console silent through accept and dismiss.

### Definition of done

All seven §7 items and all ten §2 clauses.

### Blockers

**A schema requirement**: `suggestion_dismissals` must land in `00-S9` before this stage runs. Stated
under Data and migration; it is a foundations requisition, not a blocker on a decision.
