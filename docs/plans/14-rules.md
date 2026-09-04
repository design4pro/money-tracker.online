# 14 — Rules

## Area brief

The automation engine: ordered when/then rules that categorise, tag, rename and flag transactions on
manual create, on import and on edit.

Every limit here is copied forward deliberately, because they are load-bearing against a runaway rule
engine rather than arbitrary: **100 rules, 10 conditions per rule, 20 keywords of 64 characters, 20
ids per id-condition, 4 actions, a 200-character note**. A rule engine with no ceilings turns one
import into a quadratic evaluation.

`bank_connection` is **not** a condition field. There are no connections.

The feature's worst failure mode is a rule that silently stops matching because its category was
deleted, so `paused_reason` is a first-class column and self-pausing is a shipped behaviour, not a
nicety.

---

## Stage 14-S1 — The engine: conditions, actions and evaluation

### Stage id

`14-S1` · Wave 3 · effort **XL**.

### Reference rows

`RULE-01 missing → done` — the condition and action schema with every limit enforced.
`RULE-02 missing → done` — the evaluator, ordered by `position`, with `match_mode`.
`RULE-03 missing → done` — the run-on triggers (`manual_create`, `import`, `edit`).

### Owned paths

- `src/server/rules/schema.ts` — new
- `src/server/rules/evaluate.ts` — new
- `src/server/rules/apply.ts` — new
- `src/server/repos/rules.ts` — new
- `src/server/fns/rules.ts` — new
- `src/server/rules/__tests__/evaluate.test.ts` — new
- `src/server/rules/__tests__/apply.test.ts` — new
- `src/server/repos/__tests__/rules.test.ts` — new

### Data and migration

`rules` exists from `00-S7`: `name`, `position integer`, `match_mode` (`all|any`), `conditions` JSON,
`actions` JSON, `is_active`, `paused_reason` JSON, `match_count`, `last_matched_at`, `run_on` JSON.
No schema change.

**Condition fields:** `note`, `payee`, `account`, `account_group`, `amount`, `direction`,
`day_of_month`, `tag`, `category`. Nine, and the list is closed — a tenth is a schema change and a
migration, not a JSON addition, so that the evaluator's type is exhaustive.

**Action kinds:** `set_category`, `set_payee`, `add_tag`, `remove_tag`, `set_note`,
`set_payment_method`, `mark_planned`, `set_excluded`.

### Server (repo, server function, Zod)

- **`schema.ts`** is the Zod definition of a rule's `conditions` and `actions`, and **every limit
  above is expressed in it**: `.max(10)` on conditions, `.max(20)` on keywords with `.max(64)` per
  keyword, `.max(20)` on id arrays, `.max(4)` on actions, `.max(200)` on the note. A limit enforced in
  the UI and not in the schema is not a limit.
- **`evaluate.ts`** is a **pure function**: `evaluateRule(rule, transaction, context) → boolean`. No
  database access, no async. It is pure so it can be run over a 5 000-row import preview without a
  query per row, and so its tests are exhaustive rather than illustrative.
  - `amount` conditions compare **integer minor units in the transaction's own currency**, and the
    condition stores the currency it was written in. Comparing across currencies without a rate is
    wrong; comparing with a rate makes a rule's behaviour depend on the day it runs. So: a rule with
    an amount condition in EUR simply does not match a PLN transaction, and the rule editor says so.
  - `note` and `payee` keyword matching goes through `08-S3`'s `normalize()`, so a rule written
    against "Żabka" matches "ZABKA 4471".
- **`apply.ts`** runs the active rules **in `position` order** and applies actions cumulatively; a
  later rule can overwrite an earlier rule's category. It stops after the last rule — there is no
  re-run loop, because a rule set that reacts to its own output does not terminate predictably.
- **`run_on`** gates which triggers evaluate: `manual_create`, `import`, `edit`. A rule with an empty
  `run_on` is inert and the editor shows it as such rather than pretending it is active.
- **Repository.** `rules.ts`: `listRules`, `getRule`, `createRule`, `updateRule`, `deleteRule`,
  `reorderRules`, `setRuleActive`, `recordMatch({ ruleId, count })`.
- **Authorisation.** `requireOrg()`.
- **Ledger batching.** Rules change `category_id`, `payee_id`, tags, notes and flags — **never an
  amount, a currency or a date**. So no rebuild is enqueued, and the _action_ list above is closed
  precisely so that stays true. An action that could change an amount would need a ledger batch and a
  different review.

### UI (route, components)

- **Route.** None. The editor is `14-S2`.
- **Components.** None.
- **States.** Not applicable.
- **Tokens.** None.
- **Accessibility.** None at this layer.

### Quota

`rules` is a metered metric, and it is **0 on the free plan** — automation is a paid module.
`createRule` calls `assertWithinLimit(scope, 'rules', current + 1)` **inside the repository, before
the insert**, which for a free workspace throws `FeatureLockedError` rather than
`QuotaExceededError`, because the honest message is "this is a paid feature", not "you have used your
zero rules".

### Tenant isolation test

Added to `tenant-isolation.test.ts`: A attempts every write on B's rule ids, and `createRule` with
conditions naming B's `account_id`, `category_id` and `tag_id`. Every one is a `NotFoundError`; B's
rules keep their order and their `match_count`. Functions covered: all eight exports.

**Plus:** `applyRules` in A's scope, over a transaction of A's, never evaluates a rule of B's — the
evaluator receives only rules loaded under A's scope, and the case asserts the loaded set by count.

### Money invariant

_A rule never changes an amount, a currency, a rate or a date._ Cases in
`money-invariants.test.ts`:

- _applying every action kind to a transaction leaves `amount_minor`, `currency_code`,
  `ref_amount_minor`, `rate_e10`, `booked_on` and `booked_at` byte-identical_ — asserted by a
  full-column comparison across all eight action kinds, because this is the property that lets rules
  skip the ledger batch entirely.
- _an amount condition compares integers in one currency_ and does not match across currencies.
- _an amount condition's boundary is inclusive as documented_ — `>= 10000` matches exactly `10000`,
  asserted so the editor's copy and the evaluator agree.

### Verification

- Command gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- `evaluate.test.ts`: every condition field, both `match_mode` values, the normalisation path, the
  cross-currency non-match, and every limit in `schema.ts` rejecting one over.
- `apply.test.ts`: position ordering with an overwrite; `run_on` gating; no re-run loop; the
  full-column money case.
- `rules.test.ts`: the quota call site and its `FeatureLockedError` on free; the isolation cases.
- A performance case: 100 rules × 5 000 transactions evaluates within the Worker CPU budget, asserted
  as a wall-clock bound in the test rather than assumed — this is the number that decides whether the
  import preview is usable.
- No browser evidence and no axe run: no surface.

### Definition of done

§7 items 1–3 and 5–7. Item 4 does not apply (no surface).

### Blockers

None.

---

## Stage 14-S2 — The rule editor and the live preview

### Stage id

`14-S2` · Wave 3 · effort **L**.

### Reference rows

`RULE-04 missing → done` — the rule list with drag **and** keyboard reorder.
`RULE-05 missing → done` — the when/then editor.
`RULE-06 missing → done` — the live preview (`matchedCount`, `scannedCount`, sample matches).

### Owned paths

- `src/routes/_app/transactions/rules/index.tsx` — new
- `src/routes/_app/transactions/rules/new.tsx` — new
- `src/routes/_app/transactions/rules/$ruleId.tsx` — new
- `src/routes/_app/transactions/rules/-ui/condition-row.tsx` — new
- `src/routes/_app/transactions/rules/-ui/action-row.tsx` — new
- `src/routes/_app/transactions/rules/-ui/rule-preview.tsx` — new
- `src/routes/_app/transactions/rules/-server/preview.ts` — new
- `e2e/rules.visual.spec.ts` — new

### Data and migration

None.

### Server (repo, server function, Zod)

- **Server function.** `previewRule({ rule })` (POST) evaluates an **unsaved** rule against the most
  recent `scannedCount` transactions (capped at 2 000) and returns `{ matchedCount, scannedCount,
samples }` where `samples` is at most 10 rows. It **never writes**.
- Returning **both** counts is the point: "12 matches" is meaningless without "out of 2 000 scanned",
  and a preview that silently scans a subset while implying a full scan is worse than no preview.
- **Zod.** The unsaved rule is parsed by `14-S1`'s `schema.ts`, so the preview cannot evaluate a rule
  the save path would reject.
- **Authorisation.** `requireOrg()`.
- **Ledger batching.** None; reads only.

### UI (route, components)

- **Route.** `/transactions/rules`, `/transactions/rules/new`, `/transactions/rules/$ruleId`, SSR
  default.
- **Components.** Reuses `data-table`, `Select`, `ComboBox`, `MoneyField`, `TextField`, `TagGroup`,
  `Switch`, `Button`, `Badge`, `reorder-menu` (`00-S8`). New: `condition-row.tsx`, `action-row.tsx`,
  `rule-preview.tsx`.
- **States.** Empty (no rules): _"No rules yet"_ with an explanation and, for a free workspace, the
  upgrade path rather than a disabled button that explains nothing. Empty (preview, no matches):
  _"No matches in the last 2 000 transactions"_ — not a blank panel. Skeleton: the preview's three
  sample rows. Error: `ErrorPanel` inline in the preview, so an invalid rule does not blank the
  editor.
- **Tokens.** None new.
- **Accessibility.** The rule reads as a **sentence** above the controls — _"When the note contains
  'Żabka' and the amount is over 50,00 zł, set the category to Groceries"_ — updating live, so the
  person verifies meaning rather than assembling it from six dropdowns. Reordering is drag **and**
  `reorder-menu`; order matters here more than anywhere else in the product, so the keyboard path is
  not optional. The preview announces its counts in a polite live region as the rule changes,
  debounced, so a screen-reader user is not read a new number on every keystroke.

### Quota

No new metric; the rule was counted at creation (`14-S1`). The preview consumes nothing and is capped
at 2 000 rows so it cannot become an expensive endpoint.

### Tenant isolation test

Added to `tenant-isolation.test.ts`: `previewRule` in A's scope, with a rule naming B's `account_id`,
returns `matchedCount: 0` over A's transactions and never reads B's rows. Function covered:
`previewRule`.

### Money invariant

_The preview's amount conditions behave exactly as the saved rule's will._ Case in
`money-invariants.test.ts`: _preview and apply agree_ — for a fixture of 200 transactions and a rule
with an amount condition, the set of ids `previewRule` reports matching is identical to the set
`applyRules` acts on. A preview that uses different arithmetic from the engine is worse than no
preview, because the person trusts it.

The rule sentence renders amounts through `formatAmount`, so the condition the person reads is in
their locale and currency and cannot show a raw minor-unit integer.

### Verification

- Command gate.
- Unit: the preview/apply agreement case; the sentence renderer for every condition and action kind
  in both locales; the debounce not dropping the final state.
- Browser evidence: `/transactions/rules` with **six rules including one paused**, both themes, at
  **360 / 1280 / 2560 px**, plus the editor with **a four-condition rule and its live preview showing
  matches**, the **no-match preview state**, and the **reorder menu open**.
- `e2e/rules.visual.spec.ts` runs axe on all three routes: zero `serious`, zero `critical`.
- Console silent through every keystroke in the editor, including the debounced preview.

### Definition of done

All seven §7 items and all ten §2 clauses.

### Blockers

**`OPEN-1`** — whether automation is a paid module at all. The empty state's upgrade path depends on
it. The stage ships both branches behind the entitlement check, so the answer is a catalogue value
(`00-S15`), not a rewrite.

---

## Stage 14-S3 — Self-pausing and match accounting

### Stage id

`14-S3` · Wave 3 · effort **M**. The stage that makes a broken rule visible instead of silent.

### Reference rows

`RULE-07 missing → done` — `paused_reason` written when a referenced entity disappears.
`RULE-08 missing → done` — `match_count` and `last_matched_at` accounting.
`RULE-09 missing → done` — the paused-rule surface and its resolution flow.

### Owned paths

- `src/server/rules/integrity.ts` — new
- `src/routes/_app/transactions/rules/-ui/paused-banner.tsx` — new
- `src/server/rules/__tests__/integrity.test.ts` — new

### Data and migration

None. `paused_reason` is JSON `{ kind: 'missing_reference', ref_type, ref_id, label, at }` — and it
carries **`label`**, the human name of the thing that vanished, captured at pause time. By the time a
person reads the banner the referenced row is gone, so an id alone would be unresolvable.

### Server (repo, server function, Zod)

- **`integrity.ts`** exports `checkRuleIntegrity({ scope })` and `pauseRulesReferencing({ scope,
refType, refId, label })`.
- The **pause is written by the deleting operation**, synchronously, in the same batch: deleting a
  category, tag, payee, account or account group pauses every rule that references it. Doing it in a
  batch rather than on a later scan means there is no window in which a rule silently no-ops.
  `08-S1`, `08-S2`, `08-S3`, `06-S1` and `06-S3` each call into this module from their delete paths —
  a requirement recorded here and in each of those stages' Server headings.
- `checkRuleIntegrity` is a **belt-and-braces sweep** run from the weekly `17 4 * * 1` cron, catching
  anything a write path missed. It is expected to find nothing, and finding something is logged at
  `warn` with the rule id, because it means a delete path is missing a call.
- **`recordMatch`** (`14-S1`) increments `match_count` and sets `last_matched_at` in a **single
  batched update per apply run**, not per matched transaction — an import of 5 000 rows must not
  produce 5 000 counter updates.
- **Authorisation.** Cron principal for the sweep; the write path inherits the caller's scope.
- **Ledger batching.** None; no amount changes.

### UI (route, components)

- **Route.** None new; the banner renders on `14-S2`'s list and detail routes through a slot that
  stage exposes.
- **Components.** Reuses `Card`, `Badge`, `Button`, `Select`. New: `paused-banner.tsx`.
- **States.** The banner **is** a state, and it has exactly one shape: what broke (`label` and
  `ref_type`), when, and two actions — **Pick a replacement** (a `Select` of live entities of the same
  type, which resumes the rule in one step) and **Delete this rule**. A banner that only says "paused"
  makes the person hunt for the cause.
- **Tokens.** None new; the `warning` family, not `danger` — a paused rule is a warning, and using the
  danger colour for it devalues the colour where it matters.
- **Accessibility.** The banner is a `role="status"` region on load (not an alert — it is not new
  information at that moment) and is announced when a rule pauses live. The replacement `Select` has
  a label naming the rule, so a person with three paused rules can tell the controls apart.

### Quota

No countable row.

### Tenant isolation test

Added to `tenant-isolation.test.ts`: `pauseRulesReferencing` in A's scope, given a `refId` belonging
to B, pauses **nothing** — neither A's rules nor B's. `checkRuleIntegrity` iterates per scope and
never reads across tenants. Functions covered: both exports.

### Money invariant

This stage touches no amount, and the honest answer is one sentence: it manages rule metadata. The
money-adjacent property it does protect is that **a paused rule stops applying immediately** — a rule
whose category was deleted must not keep writing a dangling `category_id` onto new transactions,
which would corrupt every category report until somebody noticed. Held by
`integrity.test.ts` → _a paused rule is excluded from `applyRules` on the very next transaction_.

### Verification

- Command gate.
- `integrity.test.ts`: deleting each of the five referenced entity types pauses the referencing rules
  in the same batch; `label` is captured at pause time; the weekly sweep finds nothing on a healthy
  fixture and logs a warning when a pause was missed; a paused rule does not apply; `match_count` is
  one update per run, not per row.
- Browser evidence: `/transactions/rules` with **two paused rules**, both themes, at 360 / 1280 /
  2560 px, plus the **banner with its replacement `Select` open** and the state **after resuming** —
  the resolution flow is the point of the stage.
- axe on the list route with banners present: zero `serious`, zero `critical`.
- Console silent.

### Definition of done

All seven §7 items and all ten §2 clauses.

### Blockers

None.
