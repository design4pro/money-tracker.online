# Domain glossary

A glossary and nothing else. No implementation details, no file paths, no commands. Terms are added
lazily, during grilling sessions, when they earn their place. Decisions with rationale belong in
`docs/adr/`; arithmetic belongs in `docs/MONEY.md`.

The `_Avoid_` clause on an entry does the real work: it forbids a specific wrong usage that has
already caused, or would obviously cause, two people to mean two things by one word.

- **Workspace (organization, tenant)** — the unit of isolation, billing and reporting. Every
  product row belongs to exactly one workspace; a person acts inside one workspace at a time. A
  workspace holds exactly one base currency, because a household reporting in two base currencies
  has no meaningful net-worth figure. _Avoid_: "account" for a workspace; "team".
- **Personal workspace** — the workspace provisioned automatically for a person at sign-up. Its id
  is a pure function of the user id, so the primary key lets only one of two concurrent provisions
  win, unless another workspace already holds that id. Workspaces created later keep their own random ids. _Avoid_: "default workspace".
- **Member** — a person with a login who belongs to a workspace, holding one workspace role:
  _owner_, _admin_ or _member_. _Avoid_: "user" when the workspace relationship is what is meant.
- **Account** — a place money is held or owed: cash, a current account, a card, savings, an
  investment holding, a loan, or a category of "other". It has exactly one currency, an initial
  balance, and a running current balance. Every account in this product is manual; there is no
  connected account and no account type that behaves differently because of where its rows came
  from. _Avoid_: "account" for a login or a workspace; "wallet"; "bank account".
- **Account group** — a workspace's collection of accounts, optionally inside another top-level
  group. An account can belong to several groups; moving it changes only the source membership,
  and removing it from a group neither deletes the account nor removes its other memberships.
- **Transaction** — one movement of money against one account, in one direction, on one calendar
  date. It is `income` or `expense`; there is no third direction. It is written in its account's
  currency, and the repository refuses a write in any other. Everything else the product shows
  — budgets, categories, cash flow, net worth — is a lens over transactions. _Avoid_: "entry",
  "record", "operation" as synonyms; "transaction" for a transfer as a whole.
- **Direction** — `income` or `expense`, the sign of a transaction against its account. _Avoid_:
  "type" for direction; "debit"/"credit" (they invert depending on whose books you are in).
- **Transfer** — money moved between two of the workspace's own accounts, represented as **two
  transactions** sharing one transfer id: an expense on the source and an income on the
  destination. A transfer is not a transaction direction and not a separate entity. Money that left
  or entered the tracked world without a counter-account is a **one-leg transfer**, which has one
  transaction and no pair. _Avoid_: "transfer" as a value of direction; "transfer" for a single leg
  when the pair is meant.
- **Leg** — one of the two transactions of an internal transfer. Editing one leg propagates to the
  other; deleting one deletes the other; there is no orphan leg. _Avoid_: "leg" for the transfer.
- **Balance adjustment** — a real transaction, with a date, an amount and an author, that reconciles
  an account's recorded balance to a counted one. It is never a silent overwrite of the stored
  balance. _Avoid_: "correction" as a distinct concept; "reconciliation".
- **Amount** — the value of a transaction in **its own** currency, stored as an integer number of
  that currency's minor units. _Avoid_: "amount" for the base-currency figure.
- **Reference amount** — the same transaction converted to the workspace's base currency at the
  rate that applied on its booked date. It is a **historical** value: it is recorded once and never
  recomputed, so a March expense is always counted at March's rate. Reports sum reference amounts.
  _Avoid_: "converted amount" when a live conversion is meant; using "balance" for either figure.
- **Base currency** — the single currency a workspace reports in. It belongs to the workspace, not
  to a person. _Avoid_: "default currency"; "display currency".
- **Rate** — the exchange rate between two currencies on one day, stored as an integer scaled by
  10^10, and always quoted major-per-major. A rate is attached to the transaction that used it, so
  a conversion is reproducible without a lookup. _Avoid_: "rate" for an interest rate or an APR.
- **Balance history** — the daily series of an account's value, **rebuilt** from the units held on
  each day valued at that day's rate, never accumulated from converted deltas. It is sparse: a day
  that repeats the previous day's value is not stored. _Avoid_: "balance history" for the list of
  transactions; "snapshot" for a single stored day when the series is meant.
- **Split** — one line of a transaction's breakdown across categories. A transaction's splits sum
  exactly to its amount. Two splits of one transaction may carry the same category, because a
  receipt with two grocery lines is a real receipt. _Avoid_: "split" for an expense shared between
  people (this product does not split between people).
- **Refund** — a transaction in the opposite direction linked to the transaction, or to the split,
  it gives money back for. A refund may also point at nothing, when the original purchase was never
  recorded. _Avoid_: "reversal"; "credit note".
- **Category** — a classification of what a transaction was for, at most two levels deep, with a
  colour and an icon, scoped to `expense`, `income` or both. _Avoid_: "category" for a tag, for an
  account category, or for a budget.
- **Account category** — the kind of thing an account is (`cash`, `current`, `credit_card`,
  `savings`, `investment`, `loan`, `general`, `other`). Distinct from a transaction category and
  never mixed with it. _Avoid_: "account type".
- **Tag** — a free cross-cutting label on a transaction, independent of its category. A transaction
  has one category and any number of tags. _Avoid_: "tag" as a second category; "label".
- **Payee** — who money was paid to or received from, with its own aliases so that four spellings
  from four import files resolve to one payee. A payee may enforce or merely hint a category.
  _Avoid_: "merchant"; "vendor"; "counterparty".
- **Budget** — a spending limit over a period, either a fixed set of categories or a fixed set of
  transactions, with alert thresholds and a rollover policy. A **budget period** is one
  materialised instance of it, carrying what was carried in, what was spent, and what closed.
  _Avoid_: "budget" for a period; "envelope" without saying which rollover policy is meant.
- **Failure** — a refusal or fault the server turns into a **failure kind**: one of a closed set
  (`unauthenticated`, `forbidden`, `not_found`, `validation`, `conflict`, `quota`, `feature_locked`,
  `rate_unavailable`, `rate_limited`, `upstream`, `internal`), with `internal` the default for
  anything unnamed. The browser is told the kind through the **failure envelope**, a versioned
  public shape built only from closed sets, so two failures of one kind are identical. _Avoid_:
  "envelope" alone, which also names a budget idea; "error message" for what the reader is shown,
  which is a catalogue sentence chosen by kind, never the text of the thrown value.
- **Recovery** — the way out the failure panel offers for a failure kind: `retryable` (try again),
  `quota` and `feature_locked` (go to billing) or `internal` (the sentence, with a way home and a
  reference where the caller has them). It is chosen from the kind alone, never from the message.
  _Avoid_: "error type" for a failure kind; "fallback" for a recovery.
- **Rollover** — what a budget period does with the difference between its limit and its spend:
  `none`, carry the surplus, or carry both surplus and overspend. _Avoid_: "carryover" and
  "rollover" for the same thing in different sentences.
- **Recurring series** — a repeating expected payment or receipt: a subscription, a bill, an
  instalment or recurring income. It has a frequency, an anchor, an expected amount, and it
  generates **recurring periods**, each of which is upcoming, paid, overdue or skipped. _Avoid_:
  "subscription" for a recurring series — in this repository "subscription" means the workspace's
  billing plan and nothing else.
- **Recurring forecast** — expense-series totals for spending this calendar year, unpaid
  occurrences due this year, and unpaid occurrences due in the next twelve months. Each currency
  stays separate; a paused or finished series retains its spending history and plans nothing ahead.
- **JDG duty template** — a Polish sole trader's recurring-series due-date shape, identified by
  a duty code. The person supplies the amount; the template neither calculates tax nor files a return.
  _Avoid_: "tax engine" or "tax liability" for a duty template.
- **Subscription** — the workspace's paid plan with the billing provider. One per workspace.
  _Avoid_: using it for a recurring series, a streaming service the user pays for, or a plan tier.
- **Rule** — an ordered automation: conditions over a transaction, actions applied when they match,
  and a set of triggers it runs on. A rule that references something that no longer exists pauses
  itself and says why, rather than silently ceasing to match. _Avoid_: "automation" and "rule" used
  interchangeably in one document; "filter".
- **Goal** — a savings target with an amount, an optional date, and contributions linked to real
  transactions. _Avoid_: "goal" for a budget.
- **Loan** — a borrowing drawn on one account of the `loan` category, with a principal, a nominal
  annual interest rate, a term, a payment frequency and a repayment shape. It is `active`,
  `settled` (repaid) or `closed`. The account holds the balance; the loan holds the terms. _Avoid_:
  "loan" for the account it is drawn on; "debt" and "loan" used interchangeably in one document;
  "loan" for money the workspace lent to somebody else, which this product does not model.
- **Instalment** — one row of a loan's schedule: a due date, the part of the payment that reduces
  the principal, the part that is interest, and the balance left after it. It is upcoming, paid or
  overdue, and it is **paid only by pointing at a transaction**. Overdue is derived from the due
  date, never stored. _Avoid_: "instalment" for a recurring period, which is a different table and
  a different feature; "payment" for the planned row when the real transaction is meant.
- **Interest rate** — the nominal annual rate of a loan, stored as an integer scaled by 10^10, and
  divided by the number of payments in a year to get one period's rate. It is not an exchange
  **rate** and never resolves through the rate tables; it shares only the scaling convention.
  _Avoid_: "rate" without saying which of the two; "APR", which is a different, regulated figure
  this product does not compute.
- **Extra repayment** — a transaction repaying a loan outside its schedule. It shortens the term or
  lowers the remaining instalments, at the person's choice, and it rewrites only the unpaid tail of
  the schedule. _Avoid_: "overpayment" for a payment that merely exceeded one instalment, which is
  a variance on that instalment and not this.
- **Import batch** — one file's journey from upload through parse, mapping, duplicate detection,
  preview and execution, with a per-row error register and a revert. _Avoid_: "sync"; "connection".
- **Duplicate** — a candidate transaction whose account, date, amount and normalised payee match an
  existing row closely enough to be flagged during import. Flagged, never silently dropped.
- **Plan** — a tier of the product (`free`, `plus`, `household`) with its modules and quotas.
  _Avoid_: "plan" for a budget or a financial plan.
- **Entitlement** — a capability granted by the workspace's plan. **Quota** — a numeric ceiling on
  one, enforced at the data-access boundary rather than in the UI.
- **Platform actor** — a privileged operator (`admin`, `curator`) acting across workspaces. Every
  such action is audited. Distinct from a workspace `owner` or `admin`; the two role dictionaries
  are never mixed.
- **Catalogue** — the global, non-tenant data every workspace reads: currencies with their minor
  digits, per-day exchange rates, brand logos. Written only by a platform actor, always audited.
- **Booked date** — the calendar date a transaction belongs to, chosen by the person entering it
  and defaulted from their own timezone. It is what every report groups by. Distinct from the
  instant the row was created, which exists only to order two transactions on the same day.
  _Avoid_: "date" without saying which of the two; "timestamp" for the booked date.
- **Booking cutoff** — the latest calendar date it is anywhere on Earth right now (UTC+14). A
  settled (non-planned) row may not be booked after it; a planned row may. The server enforces it
  on every writer of a settled row, and the entry form stops a settled date at the reader's own
  today, which is never later. _Avoid_: "today" for it, which is the UTC day or the reader's own;
  "max date" for the form's picker limit, which is a different (earlier) bound.
