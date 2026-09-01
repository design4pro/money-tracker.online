# 08 — Classification

## Area brief

Three vocabularies a person builds for themselves: **categories** (a two-level tree, one per
transaction or per split), **tags** (many per transaction, with reminders), and **payees** (with
aliases, ignored names and a categorisation mode).

They are separate concepts on purpose and `CONTEXT.md` forbids using one word for another: a tag is
not a category, and a payee is not a merchant record we own. The `_Avoid_` clauses there are the
contract this plan implements.

Two deliberate constraints, both repository invariants rather than schema `CHECK`s so they can move
without a migration: **category depth is capped at 2**, and a category's colour is inherited by its
children unless overridden.

---

## Stage 08-S1 — Categories

### Stage id

`08-S1` · Wave 2 · effort **L**.

### Reference rows

`CLS-01 missing → done` — the categories repository with the depth cap and colour inheritance.
`CLS-02 missing → done` — the category tree screen with drag **and** keyboard reorder.
`CLS-03 missing → done` — archive rather than delete when a category has transactions.

### Owned paths

- `src/server/repos/categories.ts` — new
- `src/server/fns/categories.ts` — new
- `src/routes/_app/settings/categories.tsx` — new
- `src/routes/_app/settings/-ui/category-tree.tsx` — new
- `src/routes/_app/settings/-ui/category-form.tsx` — new
- `src/server/repos/__tests__/categories.test.ts` — new
- `e2e/categories.visual.spec.ts` — new

### Data and migration

`categories` exists from `00-S5`: `name`, `slug`, `icon text(50)`, `color text(7) NOT NULL`, `kind`
(`expense|income|both`), `parent_id`, `is_system boolean`, `position`, `archived_at`. No schema
change.

A **seed set** of system categories is created with the workspace (`04-S1` provisioning calls into
this repository once it exists; until then a workspace starts empty and `26-S1`'s onboarding offers
the set). `is_system` categories may be renamed and re-coloured but not deleted, because the import
mappers and the rule engine reference them by slug.

### Server (repo, server function, Zod)

- **Repository.** `categories.ts`: `listCategories({ includeArchived })`, `getCategory`,
  `createCategory`, `updateCategory`, `archiveCategory`, `restoreCategory`, `deleteCategory`,
  `reorderCategories`, `moveCategory({ id, parentId, position })`.
- **Depth cap.** `createCategory` and `moveCategory` refuse a `parent_id` whose own `parent_id` is
  not null, with a message naming the two categories. Asserted in the repository, on every write —
  including the import path, which is the one that would otherwise create depth 3.
- **`deleteCategory` refuses when the category has transactions or splits**, naming the count, and
  offers archive instead. `archiveCategory` cascades to descendants; restoring restores only the
  category asked for, not the subtree, because a subtree that archived together did not necessarily
  become relevant together.
- **Colour inheritance** is resolved in the repository on read: a child with a null override returns
  its parent's colour. Resolving it in the UI means two components disagree.
- **Server function.** One per repository export.
- **Zod.** `color` is `z.string().regex(/^#[0-9a-f]{6}$/i)`; `icon` is a member of the icon-name
  tuple, not free text, so a rename in `lucide-react` is a type error rather than a blank square.
- **Authorisation.** `requireOrg()`; writes require `owner | admin` in a multi-member workspace.
- **Ledger batching.** None: categories carry no amount and no balance. Archiving a category does not
  touch a transaction row.

### UI (route, components)

- **Route.** `/settings/categories`, SSR default.
- **Components.** Reuses `GridList`, `Dialog`, `ColorSwatch`, `Select`, `TextField`, `Menu`,
  `reorder-menu` (`00-S8`), `Badge`. New: `category-tree.tsx`, `category-form.tsx`.
- **States.** Empty: _"No categories yet"_ with **Add the standard set** as the primary action and
  Add category as secondary — the standard set is what almost everyone wants, so it is the default
  path rather than a hidden option. Skeleton: eight tree rows. Error: `ErrorPanel` retryable.
- **Tokens.** None new. The category colour is rendered as a swatch **beside** the name, never as the
  row's background — a coloured row background cannot hold 7:1 text contrast across an arbitrary
  user-chosen hue.
- **Accessibility.** Reordering and re-parenting are available from `reorder-menu`'s _Move up / down /
  to top / to bottom / Move to…_ **and** by drag. Each colour swatch has an accessible name that
  includes the colour's contrast-safe label, because a swatch alone tells a colour-blind reader
  nothing. The depth-cap refusal is announced in a live region, not only shown as a toast.

### Quota

Categories are **not metered**. They are the vocabulary a person needs to make the product useful,
and rationing them would make the free tier actively worse at its one job. Stated explicitly.

### Tenant isolation test

Added to `tenant-isolation.test.ts`: A, in A's scope, attempts `getCategory`, `updateCategory`,
`archiveCategory`, `deleteCategory`, `reorderCategories` on B's ids, and `createCategory` /
`moveCategory` with B's `parent_id`. Every one is a `NotFoundError`; B's tree is unchanged. Functions
covered: all nine exports.

### Money invariant

This stage writes no amount, and that is the answer — but it is not the whole answer. Categories are
the **grouping key** for every category-based report, so the invariant it must not break is that
re-parenting or archiving a category **never changes a stored `ref_amount_minor`**. Case in
`money-invariants.test.ts`: _category writes do not touch `transactions`_ — asserted by a query spy
across all nine exports, because a well-meaning "re-categorise descendants" implementation is exactly
how a category edit would start rewriting the ledger.

### Verification

- Command gate.
- `categories.test.ts`: the depth cap on create, move and the import path; delete refuses with
  history; colour inheritance resolves on read; archive cascades and restore does not; the money case.
- Browser evidence: `/settings/categories` with a two-level tree of twelve categories, both themes, at
  **360 / 1280 / 2560 px**, plus the **empty state**, the **Move to… menu open**, and the **depth-cap
  refusal message** — the refusal is the point of `CLS-01` and a resting tree is not evidence about
  it.
- `e2e/categories.visual.spec.ts` runs axe on `/settings/categories`: zero `serious`, zero `critical`.
- Console silent through reorder and re-parent.

### Definition of done

All six §7 items and all ten §2 clauses.

### Blockers

None.

---

## Stage 08-S2 — Tags and tag reminders

### Stage id

`08-S2` · Wave 2 · effort **M**.

### Reference rows

`CLS-04 missing → done` — tags, and the many-to-many with transactions.
`CLS-05 missing → done` — tag reminders (`amount_threshold` and `absence`).

### Owned paths

- `src/server/repos/tags.ts` — new
- `src/server/repos/tag-reminders.ts` — new
- `src/server/fns/tags.ts` — new
- `src/routes/_app/settings/tags.tsx` — new
- `src/routes/_app/settings/-ui/tag-list.tsx` — new
- `src/routes/_app/settings/-ui/tag-reminder-form.tsx` — new
- `src/server/repos/__tests__/tags.test.ts` — new
- `e2e/tags.visual.spec.ts` — new

### Data and migration

`tags`, `transaction_tags` and `tag_reminders` exist from `00-S5`. No schema change.

`tag_reminders` carries `kind` (`amount_threshold|absence`), `threshold_minor`, `frequency`
(`daily|weekly|monthly|quarterly|yearly|immediate`) and `is_active`.

### Server (repo, server function, Zod)

- **Repository.** `tags.ts`: `listTags`, `createTag`, `updateTag`, `deleteTag`, `mergeTags({ from,
into })`, `setTransactionTags({ transactionId, tagIds })`. `tag-reminders.ts`:
  `listReminders`, `upsertReminder`, `deleteReminder`, `findDueReminders({ now })`.
- **`deleteTag` is allowed with history** — unlike a category, a tag carries no reporting structure,
  so removing it removes an annotation. `mergeTags` is offered as the alternative and moves the
  `transaction_tags` rows in one batch.
- `findDueReminders` is called by the `*/15 * * * *` cron branch (owned by `21-S3`, which dispatches
  the notification). It **scans**, deliberately, rather than maintaining a scheduled index: the row
  count is small, a scan is one query, and an index has to be maintained correctly on every write —
  the same reasoning `docs/adr/0005`-shaped decisions use elsewhere in the product.
- **Server function.** One per repository export except `findDueReminders`, which has no request path.
- **Zod.** `threshold_minor` is `z.number().int().nonnegative()` and is **required when `kind` is
  `amount_threshold`**, expressed as a discriminated union so an `absence` reminder cannot carry a
  threshold and vice versa.
- **Authorisation.** `requireOrg()`.
- **Ledger batching.** None: tags carry no amount.

### UI (route, components)

- **Route.** `/settings/tags`, SSR default.
- **Components.** Reuses `TagGroup`, `Dialog`, `ColorSwatch`, `Select`, `MoneyField`, `Switch`,
  `Table`. New: `tag-list.tsx`, `tag-reminder-form.tsx`.
- **States.** Empty: _"No tags yet"_ with an explanation of how a tag differs from a category, because
  the distinction is the thing people get wrong. Skeleton: six tag chips. Error: `ErrorPanel`.
- **Tokens.** None new.
- **Accessibility.** A tag chip carries its name as text; the colour is decoration. The reminder form
  states the rule in a sentence that updates live — _"Notify me when tagged spending passes 500,00 zł
  in a month"_ — so the person reads the rule rather than assembling it from three controls.

### Quota

Tags are **not metered**, for the same reason as categories.

### Tenant isolation test

Added to `tenant-isolation.test.ts`: A attempts `updateTag`, `deleteTag`, `mergeTags` (both
directions) and `upsertReminder` on B's ids, and `setTransactionTags` with B's `transactionId` and
with B's `tagIds` on A's transaction. Every one is a `NotFoundError`; B's tags and links are
unchanged. Functions covered: all six of `tags.ts` and all four of `tag-reminders.ts`.

`findDueReminders` gets its own case: called with A's scope it returns only A's reminders, even
though the cron's natural implementation is a cross-tenant scan — the cron iterates workspaces and
calls it **per scope**, never once globally.

### Money invariant

_`threshold_minor` is an integer in a stated currency, and a threshold comparison is integer
comparison._ Cases in `money-invariants.test.ts`:

- _the threshold is compared against summed `ref_amount_minor`_, in the workspace base, never against
  a mixture of native amounts.
- _a threshold in a workspace whose base currency changes is not silently reinterpreted_ — the
  reminder stores the currency it was set in, and a base change marks affected reminders for review
  rather than converting them, because converting a round number like "500" into "2 137" is a rule
  the person never wrote.

### Verification

- Command gate.
- `tags.test.ts`: merge moves links in one batch and deletes the source; the discriminated-union
  schema rejects a threshold on an `absence` reminder; `findDueReminders` respects the frequency
  window; the two money cases.
- Browser evidence: `/settings/tags` with twenty tags and two reminders, both themes, at 360 / 1280 /
  2560 px, plus the **reminder form with its live rule sentence** and the **merge confirmation**.
- `e2e/tags.visual.spec.ts` runs axe on `/settings/tags`: zero `serious`, zero `critical`.
- Console silent.

### Definition of done

All six §7 items and all ten §2 clauses.

### Blockers

None.

---

## Stage 08-S3 — Payees, aliases and categorisation mode

### Stage id

`08-S3` · Wave 2 · effort **L**.

### Reference rows

`CLS-06 missing → done` — payees with a default category and a categorisation mode.
`CLS-07 missing → done` — aliases and ignored names, and the normalisation that drives matching.
`CLS-08 missing → done` — the payee list and detail screens with logo resolution.

### Owned paths

- `src/server/repos/payees.ts` — new
- `src/server/payees/normalize.ts` — new
- `src/server/payees/logo.ts` — new
- `src/server/fns/payees.ts` — new
- `src/routes/_app/settings/payees/index.tsx` — new
- `src/routes/_app/settings/payees/$payeeId.tsx` — new
- `src/routes/_app/settings/payees/-ui/payee-form.tsx` — new
- `src/routes/_app/settings/payees/-ui/alias-list.tsx` — new
- `src/server/repos/__tests__/payees.test.ts` — new
- `src/server/payees/__tests__/normalize.test.ts` — new
- `e2e/payees.visual.spec.ts` — new

### Data and migration

`payees`, `payee_aliases`, `payee_ignored_names` and `payee_tags` exist from `00-S5`.
`payee_aliases` is unique on `(organization_id, normalized_name)`. No schema change.

`brand_logos` is a **global catalogue** table (`00-S1`) and is read through `src/server/catalog`, not
through a tenant repository. Writes to it are `requirePermission` + audited, like every other
catalogue write.

### Server (repo, server function, Zod)

- **Repository.** `payees.ts`: `listPayees`, `getPayee`, `createPayee`, `updatePayee`, `deletePayee`,
  `mergePayees({ from, into })`, `addAlias`, `removeAlias`, `addIgnoredName`, `removeIgnoredName`,
  `resolvePayee({ rawName })`.
- **`normalize.ts`** is the matching key: lowercase, strip diacritics, collapse whitespace, remove a
  fixed list of payment-processor noise tokens and trailing reference numbers. It is a **pure
  function with its own test file**, because every import batch and every rule evaluation goes through
  it and a change to it changes historical matching behaviour.
- `resolvePayee` returns `{ payeeId, source: 'exact' | 'alias' | 'none' }` and **never creates** a
  payee as a side effect of a lookup. Creation is explicit, from the import preview or the form.
- `categorization_mode` is `enforce | hint | off`: `enforce` sets the category on every matching
  transaction and locks it (`payee_locked`), `hint` pre-fills and leaves it editable, `off` does
  nothing. The three modes are applied in `07-S1`'s create path via a call into this repository.
- `logo.ts` resolves a logo from `logo_domain` through the `brand_logos` catalogue, falling back to
  `logo_initials` + `logo_color`. **The fallback is always sufficient** — there is no state in which a
  payee has no visual, and no outbound fetch happens in a request path (a cache miss enqueues a
  refresh on `TASKS` and renders initials now).
- **Zod.** `z.strictObject`; `logo_domain` is validated as a hostname, not a URL, so nobody stores a
  full link.
- **Authorisation.** `requireOrg()`.
- **Ledger batching.** `mergePayees` and a `categorization_mode` change to `enforce` **do** rewrite
  `category_id` on existing transactions, which does not change any amount — so **no ledger rebuild
  is enqueued**, and the stage says so explicitly rather than batching defensively. A rebuild that
  runs for a categorisation change is wasted work at exactly the scale where it hurts.

### UI (route, components)

- **Route.** `/settings/payees` and `/settings/payees/$payeeId`, SSR default.
- **Components.** Reuses `data-table`, `ComboBox`, `Dialog`, `Avatar`, `Select`, `TagGroup`,
  `TextField`. New: `payee-form.tsx`, `alias-list.tsx`.
- **States.** Empty: _"No payees yet"_ explaining that payees appear as you record transactions or
  import a file. Skeleton: ten table rows. Error: `ErrorPanel` retryable; a failed logo renders
  initials, never a broken image.
- **Tokens.** None new.
- **Accessibility.** A payee's avatar is `aria-hidden` and the name is the accessible label — a logo
  is never the only identification. The categorisation mode is a `RadioGroup` with a one-line
  description per option, because "enforce" and "hint" mean nothing without them.

### Quota

Payees are **not metered**. What is bounded is `payee_aliases` per payee (50) and
`payee_ignored_names` per workspace (500), as repository invariants, to stop an import loop from
generating an unbounded alias table. Exceeding either is a `ConflictError` naming the limit, not a
`QuotaExceededError` — it is a sanity bound, not a plan feature, and conflating the two would put an
upgrade prompt in front of a bug.

### Tenant isolation test

Added to `tenant-isolation.test.ts`: A attempts `getPayee`, `updatePayee`, `deletePayee`,
`mergePayees`, `addAlias`, `removeAlias` on B's ids, and `resolvePayee` with a raw name whose alias
exists **only in B**. The last one must return `{ source: 'none' }` — not B's payee — which is the
case that matters, because alias matching is the natural place for a cross-tenant lookup to sneak in.
Functions covered: all eleven exports.

### Money invariant

This stage writes no amount. Its money-adjacent responsibility is that **`categorization_mode:
enforce` never changes a transaction's amount, currency, `ref_amount_minor` or `rate_e10`** while
rewriting its `category_id`. Case in `money-invariants.test.ts`: _applying enforce to 200 historical
transactions leaves every amount column byte-identical_, asserted by a full-column comparison before
and after, because a bulk update is where a stray `SET` clause does the most damage.

### Verification

- Command gate.
- `normalize.test.ts`: diacritics, case, whitespace, the noise-token list, a trailing reference
  number, and **idempotence** (`normalize(normalize(x)) === normalize(x)`).
- `payees.test.ts`: `resolvePayee` never creates; the three categorisation modes; merge moves aliases
  and transactions in one batch; the alias and ignored-name bounds; the money case.
- Browser evidence: `/settings/payees` with twenty payees, both themes, at 360 / 1280 / 2560 px, plus
  `/settings/payees/$id` with **five aliases and enforce mode selected**, and the **merge dialog**.
- `e2e/payees.visual.spec.ts` runs axe on both routes: zero `serious`, zero `critical`.
- Console silent, including on a logo cache miss.

### Definition of done

All six §7 items and all ten §2 clauses.

### Blockers

None.
