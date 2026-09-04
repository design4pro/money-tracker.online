# 23 — Settings

## Area brief

The settings shell and the screens that no other plan owns. Several `/settings/*` routes already
exist by the time this plan runs — `03-S3` built `/settings/currencies`, `20-S2` built
`/settings/data`, `21-S3` built `/settings/notifications`, `22-S3` built `/settings/billing`. This
plan builds the **shell they all live in**, plus profile, workspace, members and security.

That ordering is deliberate and it is the reason plan 23 sits in wave 5: a shell built first would be
guessed at, and every later screen would bend to fit it. Built last, it is fitted to six real
screens. Adding the layout route is additive — the children need no edit to sit inside it — so
`23-S1` names only the two **earlier-wave** siblings it actually touches (`/settings/currencies`
from wave 1 and `/settings/data` from wave 4). The two **wave-5** siblings, `/settings/notifications`
(`21-S3`) and `/settings/billing` (`22-S3`), are not named at all, because two stages in one wave may
not own the same file.

The area's rule: **settings are per-scope and the scope is always visible.** A control that changes
something for everyone in the workspace and a control that changes something for you alone must never
sit in the same unlabelled group. Every section states whose setting it is.

---

## Stage 23-S1 — The settings shell and the profile screen

### Stage id

`23-S1` · Wave 5 · effort **M**.

### Reference rows

`SET-01 missing → done` — the `/settings` layout route with its navigation.
`SET-02 missing → done` — `/settings/profile`: name, email, locale, time zone, theme.

### Owned paths

- `src/routes/_app/settings/route.tsx` — new
- `src/routes/_app/settings/index.tsx` — new
- `src/routes/_app/settings/profile.tsx` — new
- `src/routes/_app/settings/-ui/settings-nav.tsx` — new
- `src/routes/_app/settings/currencies.tsx` — edit
- `src/routes/_app/settings/data.tsx` — edit
- `e2e/settings.spec.ts` — new

### Data and migration

`users` already carries `name`, `email`, `image` (Better Auth, `04-S1`). This stage requisitions
`user_preferences` into `00-S14`: `user_id` (primary key), `locale`, `time_zone`, `theme`
(`system|light|dark`), `date_format`, `first_day_of_week`, `updated_at`.

**Preferences are per user, not per workspace.** A person who is a member of two workspaces reads the
product in one language. The workspace's locale (`02-S1`) is the **default for a new member and the
language of workspace-wide emails**; a person's own preference wins for their own surfaces.

### Server (repo, server function, Zod)

- `createProfileRepository(scope)` — `get()`, `updateProfile`, `updatePreferences`. It reads and
  writes rows keyed by `user_id`, and it is **the one repository whose scope is the user, not the
  workspace**; the file's header says so, and `createTenantRepository` is deliberately not used
  because it would filter on a column these tables do not have.
- `profileSchema` — name 1–80 after trim; `image` is not editable here in v1 (BND: no avatar upload
  in v1, the initials avatar from `04-S3` stands).
- `preferencesSchema` — `locale` from the supported set (`en`, `pl`); `time_zone` from the IANA list
  validated against `Intl.supportedValuesOf('timeZone')`; `theme` enum; `date_format` from a named
  enum, never a free-form pattern; `first_day_of_week` 0–6.
- **Email changes are out of scope here** and route to `23-S3`'s security screen, because changing an
  email is an authentication event with a verification step, not a profile field. The profile screen
  displays the email with a link to that screen.

### UI (route, components)

- **Route.** `/settings` (a layout with the nav and an outlet), `/settings/` (an index that redirects
  to `/settings/profile`), `/settings/profile`.
- **Components.** `settings-nav.tsx` — a two-group nav: **You** (Profile, Notifications, Security) and
  **Workspace** (General, Members, Currencies, Data, Billing), with the group headings carrying the
  scope distinction that the area's rule demands. The titled-section primitive
  (`src/components/ui/section.tsx` — a `<section>` with a heading, a description and a form region) is
  a **shared path** and is therefore **requisitioned into `00-S6`** rather than built here; every
  settings screen composes it, so the screens are consistent by construction instead of by rewrite.
- **Wave discipline on the sibling routes.** `/settings/notifications` (`21-S3`) and
  `/settings/billing` (`22-S3`) are **wave-5 stages like this one**, so this stage does **not** name
  their files — two stages in one wave may not own the same path. They compose the foundations
  primitive and drop into the layout with no edit from here. Only the two **earlier-wave** routes need
  an edit: `/settings/currencies` (`03-S3`, wave 1) and `/settings/data` (`20-S2`, wave 4). Those
  edits are limited to removing their own page chrome and a now-duplicated heading — no logic, no
  loader and no test changes, and `e2e/settings.spec.ts` re-asserts each still functions.
- **States.** Idle; dirty (a save bar appears, and **navigating away with unsaved changes prompts** —
  React Router's blocker, with a real dialog, not `beforeunload` alone); saving; saved (a polite
  status, not a toast that disappears before a screen reader reaches it); error.
- **Accessibility.** The nav is a `<nav>` with a list and `aria-current="page"`. At 360px it collapses
  to a horizontally scrollable tab strip that keeps every item reachable — never a "More" menu hiding
  half the settings. Each form field has a persistent visible label and a persistent help text; help
  text is not a placeholder. The theme control is a `RadioGroup` including **System**, and choosing it
  takes effect immediately without a reload. Changing locale re-renders in the new language and
  announces the change.

### Quota

No countable row.

### Tenant isolation test

In `tenant-isolation.test.ts`: `updateProfile` and `updatePreferences` write only the **session's**
user row; a forged `userId` in the payload is ignored, not honoured; and a member of two workspaces
sees one set of preferences regardless of the active workspace, asserted by switching and re-reading.

### Money invariant

_Preferences change presentation, never value._ Case in `money-invariants.test.ts`: _switching a
person's locale from `en` to `pl` changes the formatted output of a fixture transaction and leaves
`amount_minor`, `currency` and `ref_amount_minor` byte-identical in the database_, asserted by
reading the row before and after. The related case: _`date_format` and `first_day_of_week` never
affect `booked_on`_, which is stored as a date, not a rendering.

### Verification

- Command gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- Unit: the schemas' rejections (an invalid IANA zone, an unsupported locale, a 0-length name);
  the redirect from `/settings/`.
- `e2e/settings.spec.ts`: the nav's keyboard path and `aria-current`; the unsaved-changes blocker
  including its cancel path; a locale change taking effect on the same screen; the theme switch;
  **and a smoke pass over all six sibling routes** — the two edited here and the four that merely
  drop into the layout — proving the shell broke nothing.
- Browser evidence at the pinned clock: `/settings/profile` in both themes at
  **360 / 1280 / 2560 px** (the 360px capture must show the tab strip, scrolled to reveal the last
  item), plus the **dirty state with the save bar**, the **unsaved-changes dialog**, and the
  **nav with a focused item**.
- axe on `/settings/profile` and one sibling route: zero `serious`, zero `critical`.
- Console silent.

### Definition of done

All seven §7 items and all ten §2 clauses.

### Blockers

None.

---

## Stage 23-S2 — Workspace general and members

### Stage id

`23-S2` · Wave 5 · effort **L**.

### Reference rows

`SET-03 missing → done` — `/settings/workspace`: name, base currency, time zone, week start, fiscal
month start.
`SET-04 missing → done` — `/settings/members`: the member list, roles and removal.
`SET-05 missing → done` — invitations: create, resend, revoke, accept.

### Owned paths

- `src/routes/_app/settings/workspace.tsx` — new
- `src/routes/_app/settings/members.tsx` — new
- `src/routes/_app/settings/-ui/invite-dialog.tsx` — new
- `src/routes/_app/settings/-ui/member-row.tsx` — new
- `src/routes/invite.$token.tsx` — new
- `src/server/repos/members.ts` — new
- `src/server/repos/__tests__/members.test.ts` — new
- `src/server/repos/workspace-settings.ts` — new
- `src/server/repos/__tests__/workspace-settings.test.ts` — new

### Data and migration

`organization`, `member` and `invitation` come from Better Auth's organization plugin (`04-S1`).
This stage requisitions `workspace_settings` into `00-S14`: `workspace_id` (primary key),
`base_currency`, `time_zone`, `first_day_of_week`, `fiscal_month_start_day`, `updated_at`.

**Base currency is set once, at creation, and is not editable in v1.** Changing it would require
recomputing every `ref_amount_minor` in the workspace at each transaction's historical rate — which is
possible, is a long queued job, and is a feature, not a settings field. The screen displays it as a
**read-only value with an explanation and a link to export-and-recreate**, which is honest. This is
recorded here rather than discovered later, and `workspace-settings.test.ts` asserts the field is
rejected by the update schema.

### Server (repo, server function, Zod)

- `createWorkspaceSettingsRepository(scope)` — `get`, `update` (owner or admin via
  `requirePermission`). `updateSchema` omits `base_currency` entirely, so it cannot be sent.
- `createMembersRepository(scope)` — `list`, `invite`, `resendInvite`, `revokeInvite`, `changeRole`,
  `remove`, `leave`.
- **Role rules**, each with a named test: the **last owner cannot be removed or demoted**; an admin
  cannot change an owner's role; a person can always `leave` unless they are the last owner; removing
  a member does **not** delete the rows they created, which stay with the workspace, and the UI says
  so before confirming.
- **Invitations.** A signed token with a **7-day** expiry, emailed through plan 21's
  `member.invited`. Accepting requires a session: an invited person with no account signs up first and
  is returned to the invite by `safeRedirect` (`04-S3`), which is why the accept route validates the
  token **again** after authentication rather than trusting the pre-auth check.
- **Invite address matching.** The token names an email; accepting with a different signed-in address
  is **refused with an explanation**, not silently bound. An invite that any authenticated person can
  redeem by holding the link is an access-control hole.

### UI (route, components)

- **Route.** `/settings/workspace`, `/settings/members`, `/invite/$token` (outside `_app`, since the
  acceptor may not be a member yet).
- **Components.** `member-row.tsx` (avatar, name, email, role `Select`, actions menu);
  `invite-dialog.tsx` (email, role, and a preview of what the invitee will receive).
- **States.** Members: loading; list; **only you**; pending invites (a distinct group with expiry
  countdowns and resend/revoke); **at seat limit** (invite disabled with the count and a link to
  billing). Invite acceptance: valid; expired; revoked; **already a member**; **wrong account**
  (naming the invited address and offering a sign-out-and-switch); workspace deleted.
- **Accessibility.** The member list is a real `<table>` with row headers, not a stack of divs — role
  and actions must be announced with the person they belong to. Every action's accessible name
  includes the member ("Remove Anna Kowalska"), never a bare "Remove" repeated eight times.
  Destructive actions are `AlertDialog`s naming the person and the consequence. The role `Select`
  announces the change politely and reverts visibly on failure.

### Quota

`assertWithinLimit('members', ...)` inside `invite`, **counting members plus pending invites** —
counting only accepted members lets a workspace hold twenty outstanding invites past a five-seat
ceiling and blow through it in an afternoon. The per-plan number is `OPEN-1`; the household-granularity
question is `OPEN-2` and affects whether seats are the right unit at all.

### Tenant isolation test

In `tenant-isolation.test.ts`: A's admin cannot list, invite into, or modify B's members; a token
signed for B does not join A; `changeRole` and `remove` re-read the caller's role from `member` inside
the scope on every call (never from the session cache), asserted by demoting a caller mid-flight and
confirming their next write is refused; and `leave` on a workspace the caller is not in is a
not-found.

### Money invariant

_Membership changes never touch money._ Cases:

- _removing a member leaves every transaction, balance and `ref_amount_minor` unchanged_, asserted by
  capturing every account balance before and after, with `created_by` preserved on their rows.
- _`fiscal_month_start_day` changes which period a date falls in but never a stored amount_ —
  budget and recurring period boundaries recompute, and the test asserts the underlying transactions
  are untouched while `budget_periods` are regenerated.
- _the update schema rejects `base_currency`_, the case that protects every `ref_amount_minor` in the
  workspace from a one-click rewrite.

### Verification

- Command gate.
- `members.test.ts`: the last-owner rules; admin-vs-owner limits; invite expiry, revoke, resend; the
  wrong-account refusal; the seat count including pending invites; the mid-flight demotion.
- `workspace-settings.test.ts`: the base-currency rejection; `fiscal_month_start_day` regenerating
  periods without touching transactions; an invalid time zone rejected.
- Browser evidence at the pinned clock: `/settings/workspace` and `/settings/members` in both themes
  at **360 / 1280 / 2560 px**, plus the **invite dialog**, the **remove-member dialog**, the **pending
  invites group**, the **at-seat-limit state**, and `/invite/$token` in its **expired** and **wrong
  account** states.
- axe on both settings screens and the invite route: zero `serious`, zero `critical`.
- Console silent.

### Definition of done

All seven §7 items and all ten §2 clauses.

### Blockers

`OPEN-1` — the seat ceiling per plan. `OPEN-2` — whether a household is modelled as seats in one
workspace or linked workspaces; this stage implements seats in one workspace, which is the simpler
model and the one every other plan assumes, and `99-boundaries-and-blockers.md` records that choosing
otherwise later is a migration, not a toggle.

---

## Stage 23-S3 — Security, sessions and workspace deletion

### Stage id

`23-S3` · Wave 5 · effort **M**.

### Reference rows

`SET-06 missing → done` — `/settings/security`: password change, email change with verification,
active sessions.
`SET-07 missing → done` — workspace deletion with a typed confirmation and a queued purge.

### Owned paths

- `src/routes/_app/settings/security.tsx` — new
- `src/routes/_app/settings/-ui/session-list.tsx` — new
- `src/routes/_app/settings/-ui/danger-zone.tsx` — new
- `src/server/repos/workspace-lifecycle.ts` — new
- `src/server/repos/__tests__/workspace-lifecycle.test.ts` — new
- `src/server/queue/handlers/workspace-purge.ts` — new
- `src/server/queue/handlers/__tests__/workspace-purge.test.ts` — new

### Data and migration

Requisitions into `00-S14`: `workspace_deletions` (`workspace_id`, `requested_by`, `requested_at`,
`purge_after`, `status` in `pending|purging|purged|cancelled`, `error_code`).

**Deletion is soft for 30 days, then purged.** `purge_after` is `requested_at + 30 days`; during that
window the workspace is inaccessible to members but fully restorable by the operator. Immediate
irreversible deletion of a person's entire financial history behind one dialog is a mistake waiting
to happen, and the 30-day window has resolved every such mistake in every product that has one.

### Server (repo, server function, Zod)

- **Password and email** go through Better Auth's own endpoints — this screen calls them, it does not
  reimplement them. Changing an email sends a verification to the **new** address and a notice to the
  old one, and the change applies only on verification. Changing a password **revokes other sessions**
  and says so before you confirm.
- **Sessions.** Better Auth stores sessions in KV (`04-S1`); this screen lists them with their
  created time, last seen, approximate location from the CF request properties, and user agent
  family, and revokes one or all-but-current. **The current session is labelled and cannot be revoked
  from the list** — a person who revokes their own session and is thrown out mid-task learns nothing
  useful; sign out is the affordance for that and it is adjacent.
- **Deletion.** Owner only. It requires typing the **workspace name exactly** (not "DELETE", which
  people type without reading), states the row counts that will be destroyed, and warns that an
  active subscription must be cancelled separately — with a link, and with the cancellation **not**
  performed automatically, because cancelling someone's billing as a side effect of a delete they can
  still undo is worse than asking.
- **Purge** is a queue job walking every table in dependency order in chunks, deleting the R2 prefix
  for the workspace, and finally the org and member rows. It is resumable, records its cursor, and
  ends by writing a single retained `workspace_deletions` row with `status = 'purged'` — the record
  that the data is gone is not itself deleted.

### UI (route, components)

- **Route.** `/settings/security`.
- **Components.** `session-list.tsx`; `danger-zone.tsx` (visually distinct, at the page's end, never
  adjacent to a routine control).
- **States.** Password: idle, invalid current password, weak new password (with the requirement stated
  before submission, not after), success with the revocation notice. Email: idle, verification sent
  (with a resend that has a cooldown and a visible timer), verified. Sessions: current, others, none.
  Deletion: idle; confirmation with the name mismatch state; **pending deletion** (a banner across the
  app with the purge date and a cancel action); purging; purged.
- **Accessibility.** The password field pair has a show/hide control with a proper `aria-pressed`
  name; the field allows **paste** and does not disable autofill — 3.3.9 AAA, held here, and blocking
  paste in a password field is the specific practice that criterion exists to forbid. Requirements are
  associated with the field via `aria-describedby` and validated on blur, never only on submit. The
  deletion dialog's confirm button stays disabled until the typed name matches, and the mismatch is
  announced rather than only shown in red.

### Quota

No countable row.

### Tenant isolation test

In `tenant-isolation.test.ts`: an admin who is not an owner cannot request deletion; a deletion
request for B from A is a not-found; the purge job validates the message's workspace against the
`workspace_deletions` row and DLQs a mismatch; the purge deletes **only** the named workspace's rows,
asserted by seeding two full workspaces, purging one, and comparing the other's complete row counts
before and after, table by table.

### Money invariant

_A purge removes money rows completely, and a pending deletion removes none._ Cases in
`workspace-purge.test.ts`:

- _during the pending window every amount is unchanged and fully restorable_, asserted by comparing a
  full export before the request and after cancelling it — byte-identical.
- _after a purge, no transaction, split, balance snapshot, budget period or attachment for that
  workspace remains_, asserted by counting every table.
- _the sibling workspace's account balances are identical before and after the purge_, recomputed by
  the ledger rather than read from a cache, which is the assertion that would catch an unscoped
  `DELETE`.
- _a resumed purge after an interrupted run removes exactly the remainder_, with no double-delete
  error and no orphan left behind.

### Verification

- Command gate.
- `workspace-lifecycle.test.ts`: owner-only; the name-match requirement; cancel during the window;
  the subscription warning present when a subscription is active.
- `workspace-purge.test.ts`: the four money cases; chunked resumption; the R2 prefix deletion; the
  retained `purged` record.
- Session tests: revoke-others on password change; the current session not revocable from the list.
- Browser evidence at the pinned clock: `/settings/security` in both themes at
  **360 / 1280 / 2560 px**, plus the **session list with the current session labelled**, the **danger
  zone**, the **deletion dialog with a name mismatch**, and the **pending-deletion banner in the app
  shell**.
- axe on `/settings/security` with the deletion dialog open: zero `serious`, zero `critical`.
- Console silent.

### Definition of done

All seven §7 items and all ten §2 clauses.

### Blockers

`OPEN-8` — the published retention statement must match the 30-day window and the purge's coverage.
The implementation is complete and the number is a constant; the DPA text is the blocked artefact.
