# 0034. An account's currency is locked once it has transactions

Status: accepted
Date: 2026-11-02

## Context

`updateAccount` used to accept a `currency_code` patch on an account that already had history. The
account row's own opening `ref_` columns were re-derived; booked transactions were left in the old
currency. That mixed currencies under one account, and `docs/plans/06-accounts.md` had claimed the
change would rewrite every `ref_` in history — which contradicts `docs/MONEY.md` §3.1
(`ref_amount_minor` is historical and never recomputed). Re-denominating booked rows to match the
new account currency would be a silent rewrite of `amount_minor` / `currency_code` /
`ref_amount_minor`. The workspace-base re-denomination job is a different, audited operation and is
out of scope here.

#695 reports rows whose `currency_code` already disagrees with their account. Repairing those rows
is a separate decision.

## Decision

- Refuse changing an account's currency once that account has any transactions. Empty accounts may
  still change currency; that path re-derives only the account row's opening `ref_` columns.
- Do not rewrite booked `amount_minor`, `currency_code`, or `ref_amount_minor` when an account
  currency change is requested.
- Keep mismatch detection (#695) as detect/report only. Do not backfill or repair from this change.

Owner: Grosik, 2026-11-02.

## Consequences

- The previous `accounts.test.ts` currency-change case, which asserted a successful re-valuation
  without history, was rewritten to assert the lock when transactions exist. Empty-account
  re-valuation remains a separate case.
- The account form states the lock in EN and PL, and the detail screen disables the currency picker
  when the account already has entries. The failure envelope still classifies the refusal as
  `conflict`; the form maps that to the locked-currency sentence when the submitted currency
  differed.
- Plan `06-accounts.md` matches `docs/MONEY.md` §3.1 on this point.
