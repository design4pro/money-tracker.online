# 11 — Splits, groups and attachments

## Area brief

Three ways one transaction becomes more than one thing: **splits** (one payment across several
categories), **groups** (several transactions a person wants to read together), and **attachments**
(the receipt behind the row). Templates ride along because they are the same shape as a transaction
draft.

The split model has a surrogate `id` PK rather than `(transaction_id, category_id)`, so a receipt
with two "Groceries" lines is representable. The cost — stated once, here — is that every aggregation
over splits must group explicitly, and the category-budget attribution of a transaction with two
lines in one category needs a stated rule (`99-boundaries-and-blockers.md` `OPEN-7`).

The one invariant that must never bend: **`Σ splits.amount_minor = parent.amount_minor`**, asserted
in the repository on every write. SQL cannot express it across rows, so the repository is the only
place it can live, and a write path that bypasses the repository is how it breaks.

---

## Stage 11-S1 — Splits

### Stage id

`11-S1` · Wave 3 · effort **L**.

### Reference rows

`SPLIT-01 missing → done` — the splits repository with the sum invariant.
`SPLIT-02 missing → done` — the split editor on the transaction detail screen.

### Owned paths

- `src/server/repos/splits.ts` — new
- `src/server/fns/splits.ts` — new
- `src/routes/_app/transactions/-ui/split-editor.tsx` — new
- `src/routes/_app/transactions/-ui/split-row.tsx` — new
- `src/server/repos/__tests__/splits.test.ts` — new
- `e2e/splits.visual.spec.ts` — new

### Data and migration

`transaction_splits` exists from `00-S5`: surrogate `id` PK, `organization_id`, `transaction_id`,
`category_id`, `amount_minor`, `ref_amount_minor`, `note text(140)`, `position`. No schema change.

### Server (repo, server function, Zod)

- **Repository.** `splits.ts`: `listSplits(transactionId)`, `setSplits({ transactionId, splits })`,
  `clearSplits(transactionId)`. **`setSplits` replaces the whole set in one `db.batch`** — there is no
  add-one-split call, because an incremental API cannot enforce the sum invariant at any single point.
- **`assertSplitSum`** runs inside `setSplits` before the write: `Σ splits.amount_minor` must equal
  the parent's `amount_minor` exactly, in integer minor units, and each split's `ref_amount_minor` is
  derived from the parent's `rate_e10` rather than re-resolved — the parent already fixed the rate for
  that date, and re-resolving would make the parts disagree with the whole by a rounding step.
- **Rounding of the derived `ref_amount_minor`** uses the **largest-remainder method** so the parts
  sum exactly to the parent's `ref_amount_minor`. Rounding each split independently leaves a
  one-minor-unit residue that shows up as an off-by-one in every category report.
- **Refusals:** a transfer leg cannot gain splits (paired with `10-S1`'s rule); a split's category
  must belong to the scope; fewer than two splits is a `clearSplits`, not a split set.
- **Server function.** `listSplits` (GET), `setSplits`, `clearSplits` (POST).
- **Zod.** `splits` is `z.array(...).min(2)`, each with `amount_minor: z.number().int().positive()`.
  The sum is **not** checked in Zod — it is a data invariant against a row the client does not hold,
  so it belongs in the repository.
- **Authorisation.** `requireOrg()`.
- **Ledger batching.** Splitting changes **no amount on the parent**, so no rebuild is enqueued. Stated
  explicitly, because "we touched a transaction" is the reflex that would batch here unnecessarily.

### UI (route, components)

- **Route.** None new; the editor renders inside `07-S3`'s detail screen through its slot.
- **Components.** Reuses `MoneyField`, `Select`, `TextField`, `Button`, `Table`, `reorder-menu`. New:
  `split-editor.tsx`, `split-row.tsx`.
- **States.** Empty: the editor's initial state is two rows, the first pre-filled with the full amount
  — starting from zero rows makes the person do arithmetic the product could do. Skeleton: not
  applicable (the data arrives with the parent). Error: the sum mismatch is an inline
  `role="status"` message, not a submit-time failure.
- **Tokens.** None new; amounts `tabular-nums`, end-aligned.
- **Accessibility.** **The remainder is always visible as text** — _"120,00 zł left to assign"_ —
  updating in a polite live region as the person types, and an **Assign remainder** button puts it on
  the focused row. A split editor that only complains at submit is the accessibility failure this
  design avoids: the person is doing arithmetic and the product should be doing it with them.

### Quota

No countable row: splits are a property of a transaction, and transactions are unmetered (`07-S1`).

### Tenant isolation test

Added to `tenant-isolation.test.ts`: A attempts `listSplits` and `setSplits` on B's `transactionId`,
and `setSplits` on A's transaction with B's `category_id`. Both are `NotFoundError`; B's splits are
unchanged. Functions covered: all three exports.

### Money invariant

**`Σ splits.amount_minor = parent.amount_minor`, and the same for `ref_amount_minor`.** Cases in
`money-invariants.test.ts`:

- _splits sum to parent_ — the core case, named exactly that in the suite.
- _the derived `ref_amount_minor` values sum to the parent's exactly_, verified for a parent whose
  amount does not divide evenly (three splits of a 100,01 unit parent), which is where the
  largest-remainder method earns its place.
- _a split set is written atomically_: a `setSplits` that would violate the sum writes nothing, and
  the previous set survives intact.
- _the parent's `rate_e10` is reused, never re-resolved_ — asserted by a query spy showing no
  `resolveRate` call in `setSplits`.
- _two splits in the same category are allowed and are not merged_ — the modelling decision, asserted
  so a later "optimisation" cannot quietly collapse them.
- _editing the parent's amount invalidates the split set_: the repository refuses the parent edit
  while splits exist, and the error tells the person to re-split. Silently rescaling somebody's
  category allocation is not a decision the product gets to make.

### Verification

- Command gate.
- `splits.test.ts`: the six money cases, the transfer-leg refusal, the minimum of two, the atomicity
  case.
- Browser evidence: `/transactions/$id` with the **split editor open showing a non-zero remainder**,
  with a **balanced three-way split**, and with **two rows in the same category**, both themes, at
  360 / 1280 / 2560 px.
- `e2e/splits.visual.spec.ts` runs axe on the detail route with the editor open: zero `serious`, zero
  `critical`.
- Console silent through every keystroke in the editor.

### Definition of done

All six §7 items and all ten §2 clauses.

### Blockers

**`OPEN-7`** — how a category budget attributes a transaction with two splits in the same category.
The **data** is unambiguous (two rows); what needs deciding is whether `12-S2` sums them as one
contribution or two, which changes the budget detail screen. This stage ships the data model and names
the open question rather than choosing.

---

## Stage 11-S2 — Transaction groups and templates

### Stage id

`11-S2` · Wave 3 · effort **M**.

### Reference rows

`SPLIT-03 missing → done` — manual transaction groups with auto-dissolve below two members.
`SPLIT-04 missing → done` — transaction templates.

### Owned paths

- `src/server/repos/transaction-groups.ts` — new
- `src/server/repos/transaction-templates.ts` — new
- `src/server/fns/transaction-groups.ts` — new
- `src/routes/_app/transactions/groups.tsx` — new
- `src/routes/_app/transactions/-ui/group-panel.tsx` — new
- `src/routes/_app/transactions/-ui/template-picker.tsx` — new
- `src/server/repos/__tests__/transaction-groups.test.ts` — new
- `e2e/transaction-groups.visual.spec.ts` — new

### Data and migration

`transaction_groups`, `transaction_group_items`, `transaction_templates` and
`transaction_template_tags` exist from `00-S5`. No schema change.

### Server (repo, server function, Zod)

- **Repository.** `transaction-groups.ts`: `listGroups`, `createGroup`, `renameGroup`,
  `addToGroup`, `removeFromGroup`, `deleteGroup`. `transaction-templates.ts`: `listTemplates`,
  `createTemplate`, `updateTemplate`, `deleteTemplate`, `applyTemplate({ templateId })` which returns a
  **draft**, never a written transaction.
- **Auto-dissolve.** `removeFromGroup` deletes the group when it would drop below two members, in the
  same batch. A one-member group is a group that is lying about being a grouping, and leaving it
  around means every consumer needs a `length > 1` branch.
- **Server function.** One per export.
- **Zod.** `addToGroup` takes an array of transaction ids, deduplicated at parse.
- **Authorisation.** `requireOrg()`.
- **Ledger batching.** Grouping and templating change no amount and touch no account balance. **No
  rebuild is enqueued**, stated explicitly.

### UI (route, components)

- **Route.** `/transactions/groups`, SSR default. The group panel also renders on `07-S3`'s detail
  screen and the template picker on `07-S3`'s entry form, both through slots those stages expose.
- **Components.** Reuses `data-table`, `Dialog`, `TextField`, `Menu`, `Badge`. New: `group-panel.tsx`,
  `template-picker.tsx`.
- **States.** Empty: _"No groups yet"_ explaining what grouping is for with an example (a holiday, a
  renovation). Skeleton: four rows. Error: `ErrorPanel` retryable.
- **Tokens.** None new.
- **Accessibility.** A group's total is a real `<caption>`-adjacent summary with its currency, not a
  floating number. Adding to a group from the list uses the bulk-select flow of `07-S2`, so there is
  one selection model in the product rather than two.

### Quota

Groups and templates are **not metered**. They are organisation, like account groups (`06-S3`), and
the same one-sentence reasoning applies.

### Tenant isolation test

Added to `tenant-isolation.test.ts`: A attempts every write on B's group and template ids, and
`addToGroup` with B's transaction ids onto A's group. Every one is a `NotFoundError`; B's groups keep
their membership. Functions covered: all eleven exports.

### Money invariant

_A group's total is a sum of `ref_amount_minor` over its members, computed in SQL as an integer, and
is never stored._ Cases:

- _the group total equals the integer sum of its members' `ref_amount_minor`_, recomputed on read, so
  editing a member's amount changes the total without a second write path.
- _a group containing both legs of an internal transfer totals zero in base_, which is the correct
  answer and is asserted so nobody "fixes" it into the gross amount.
- _`applyTemplate` returns a draft with no `ref_amount_minor`_ — the ref amount is computed at write
  time against the date the person picks, not at template creation. A template that carried a frozen
  ref amount would post March's rate in June.

### Verification

- Command gate.
- `transaction-groups.test.ts`: auto-dissolve at one member; deduplication on add; the three money
  cases; the isolation cases.
- Browser evidence: `/transactions/groups` with three groups, both themes, at 360 / 1280 / 2560 px,
  plus the **auto-dissolve transition** (a two-member group after removing one member) and the
  template picker open on the entry form.
- `e2e/transaction-groups.visual.spec.ts` runs axe on the route and on the open picker: zero
  `serious`, zero `critical`.
- Console silent.

### Definition of done

All six §7 items and all ten §2 clauses.

### Blockers

None.

---

## Stage 11-S3 — Attachments

### Stage id

`11-S3` · Wave 3 · effort **L**.

### Reference rows

`SPLIT-05 missing → done` — R2 receipt attachments with upload, listing and delete.
`SPLIT-06 missing → done` — `/api/files/$id` as the only read path, tenant-checked, `Range`-capable.

### Owned paths

- `src/server/repos/attachments.ts` — new
- `src/server/files/upload.ts` — new
- `src/server/fns/attachments.ts` — new
- `src/routes/api/files/$id.ts` — new
- `src/routes/_app/transactions/-ui/attachment-list.tsx` — new
- `src/routes/_app/transactions/-ui/attachment-dropzone.tsx` — new
- `src/server/repos/__tests__/attachments.test.ts` — new
- `e2e/attachments.visual.spec.ts` — new

### Data and migration

`attachments` exists from `00-S5`: `transaction_id`, `r2_key`, `content_type`, `byte_size`,
`original_name`, `uploaded_by`. No schema change.

The R2 key layout is fixed by `00-S12`: `attachments/<orgId>/<transactionId>/<attachmentId>`. The
`orgId` is the second segment so a tenant sweep is a prefix list.

### Server (repo, server function, Zod)

- **Repository.** `attachments.ts`: `listAttachments(transactionId)`, `createAttachment`,
  `deleteAttachment`, `getAttachmentForRead(id)`.
- **`src/server/files/upload.ts`** handles the multipart body: it **validates the content type against
  an allow-list** (`image/jpeg`, `image/png`, `image/webp`, `image/heic`, `application/pdf`) by
  **sniffing the magic bytes**, not by trusting the declared type or the extension, and rejects
  anything else. A receipt store that accepts arbitrary bytes is an arbitrary file host.
- **`/api/files/$id`** is the only read path. It calls `requireOrg()`, loads the row through the tenant
  repository, and **only then** streams from R2. It supports `Range` for PDF viewers. A **public
  bucket URL is never issued**, and there is no signed-URL path — a signed URL outlives the
  authorisation decision that produced it.
- Response headers: `Content-Disposition: attachment` for PDFs, `inline` for images,
  `X-Content-Type-Options: nosniff`, and a `Cache-Control: private, max-age=0, must-revalidate`.
- **Zod.** `z.strictObject({ transactionId, contentType, byteSize })` on the metadata; the body is a
  stream and is not parsed by Zod.
- **Authorisation.** `requireOrg()` in the upload function **and** in the read route.
- **Ledger batching.** Attachments carry no amount. No rebuild, stated explicitly.

### UI (route, components)

- **Route.** `src/routes/api/files/$id.ts` (server-only). The UI renders inside `07-S3`'s detail
  screen.
- **Components.** Reuses `FileTrigger`, `Button`, `Dialog`, `Card`. New: `attachment-list.tsx`,
  `attachment-dropzone.tsx`.
- **States.** Empty: _"No receipts attached"_ with an Attach action. Uploading: a determinate
  `ProgressBar` per file with the file name. Error: per-file inline error naming the reason (too
  large, wrong type), never a single banner for a multi-file failure.
- **Tokens.** None new.
- **Accessibility.** `FileTrigger` gives a real button, so upload is **not drag-only** — the dropzone
  is an enhancement over a button, never a replacement. Each attachment's link text is the original
  file name plus its size and type, so a link list is readable out of context. Deleting asks for
  confirmation naming the file.

### Quota

**`storageBytes` is metered here**, and this is the stage that establishes the order every R2 write in
the product follows: **object first, assert second, compensating delete on throw**. Writing the object
first means a quota failure never leaves a row pointing at nothing; the compensating delete means it
never leaves an object nobody references. `assertWithinLimit(scope, 'storageBytes', current +
byteSize)` sits between the two. A per-file ceiling (10 MB) is a repository invariant on top, so a
single file cannot consume a whole plan's allowance in one request.

### Tenant isolation test

Added to `tenant-isolation.test.ts`, and this is the case the R2 key layout exists for:

- A requests `/api/files/$id` for B's attachment id → `NotFoundError`, and **no R2 read is issued**
  (asserted on the binding spy, because a 404 after a successful fetch still moved the bytes).
- A calls `createAttachment` with B's `transactionId` → `NotFoundError`, and no object is written.
- A calls `deleteAttachment` on B's id → `NotFoundError`, and B's object still exists.

Functions covered: all four exports plus the route handler.

### Money invariant

Attachments carry no amount. What this stage owes the money path is the **negative** property: an
attachment's `byte_size` is a byte count and must never be formatted through `src/lib/money.ts` —
a size is not an amount, and a shared formatter would eventually apply a currency's `digits` to a
file size. Held by `attachments.test.ts` → _byte sizes are formatted by `formatBytes`, not
`formatAmount`_, asserted by an import check on the component.

### Verification

- Command gate.
- `attachments.test.ts`: magic-byte sniffing rejects a renamed executable; the quota order (object,
  assert, compensating delete) verified by forcing the assert to throw and checking R2 is empty
  afterwards; `Range` returns 206 with the right bytes; the isolation cases.
- Browser evidence: `/transactions/$id` with **three attachments including a PDF**, both themes, at
  360 / 1280 / 2560 px, plus the **upload-in-progress state** and a **per-file rejection error**.
- `e2e/attachments.visual.spec.ts` runs axe on the detail route with attachments present: zero
  `serious`, zero `critical`.
- Console silent through upload, including the progress updates.

### Definition of done

All six §7 items and all ten §2 clauses.

### Blockers

None.
