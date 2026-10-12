# money-tracker.online — Security

This product stores financial records for people in the EU. The security posture is written down
because "we are careful" is not a control.

---

## 1. Reporting a vulnerability

**Do not open a public GitHub issue.**

Email the address published on the Security page of the site, or open a private security advisory on
`design4pro/money-tracker.online`. Include what you did, what happened, and what you expected. We
aim to acknowledge within two business days.

Please do not test against other people's workspaces, do not run automated scanners against
production, and do not access, modify or exfiltrate data that is not yours. Testing against a
workspace you created yourself, on staging, is welcome.

---

## 2. The threat model, briefly

What we are actually defending:

1. **Tenant isolation.** One workspace reading, counting or inferring the existence of another
   workspace's rows. This is the highest-severity class in the product.
2. **Account takeover.** Credential stuffing, session theft, an OAuth flow that can be redirected.
3. **Data exfiltration through a legitimate feature** — an export, a file link, an error message, a
   Sentry event, an email to the wrong recipient.
4. **Privilege confusion.** A workspace `admin` acquiring platform authority, or a platform actor
   acting without an audit trail.
5. **Billing manipulation.** A crafted checkout that buys the wrong product, a replayed webhook, a
   quota that is displayed but not enforced.

What we are explicitly **not** defending, because it does not exist: banking credentials, OAuth
tokens for a financial institution, and any aggregator session. **We never ask for them and never
hold them.** That is the single largest reduction in this product's attack surface and it is a
product decision (`docs/adr/0008-no-bank-connectors.md`), not a control we could relax.

---

## 3. Tenant isolation

- Every product table carries `organization_id`, and it is the **leading column of every composite
  index** — so the tenant predicate is always index-satisfiable and is never the thing a query plan
  drops.
- All SQL lives in `src/server/repos` and passes through the tenant-scoped base repository, which
  appends the predicate from a `TenantScope`. **Callers can add predicates; they cannot remove that
  one.** Forgetting the tenant filter is not expressible.
- `insertMany` **stamps** `organizationId` from the scope, so a payload cannot set it.
- `TenantPatch` omits `organizationId`, so an update cannot move a row between tenants.
- `assertScopedWrite` throws when a write composes to an empty predicate list.
- **A foreign id answers `NotFoundError`, never `ForbiddenError`.** A 403 tells an attacker the row
  exists. Not seeing must be indistinguishable from not existing, including in counts, aggregates,
  list totals and response timing.
- `src/server/catalog` is a carve-out (global tables), guarded by `requirePermission` plus a
  `platform_audit_log` write. `billing_events` and the insert-only `organization_currencies` write
  in the workspace-creation batch (`src/server/auth/organization.ts`) are the other two (`docs/SPEC.md` §5.2).
- **Every repository function has a tenant-isolation case** in
  `src/server/repos/__tests__/tenant-isolation.test.ts`: workspace A asks, in A's scope, to read,
  list, update and delete B's rows by id and to parent new rows onto B's rows. Every one must be
  `NotFoundError`, and B's data must be untouched afterwards. A repository function without one is
  not done.

---

## 4. Authentication

Better Auth, with sessions in the `SESSIONS` KV namespace. Sessions live there only: a session that
has expired or been evicted means signing in again, and D1 holds the verification rows and the other
auth tables, not the session (ADR 0011, Amendment).

- **No cookie session cache.** Better Auth's `cookieCache` puts a signed session snapshot in a
  cookie; that is a five-minute window in which a banned account, or one whose role was just
  reduced, keeps its old authority. Without it, the workspace role is read from the `member` row on
  every call, so a demotion applies to the next call. A ban and the platform role are read from the
  session record held in KV, so they take effect when Better Auth rewrites or deletes that record,
  bounded by KV propagation.
- **Verification records are stored in the database**, not held in a cookie.
- **Rate limits are per path**, seven rules on top of a global default of 100 per 60s:
  `/sign-in/email` 10 per 60s, `/sign-up/email` 5 per 300s, `/request-password-reset` 5 per 300s,
  `/reset-password` 10 per 300s, `/send-verification-email` 5 per 300s, `/two-factor/verify-totp`
  10 per 60s and `/two-factor/verify-backup-code` 5 per 300s. Counters live in KV with a 60s TTL
  floor and are approximate: a courtesy guard that can undercount, not a hard limit.
- **Passkeys** (WebAuthn): the passkey plugin is not installed yet and arrives with `04-S4`; the
  plugins today are `admin`, `twoFactor` and `organization`. **TOTP two-factor** is available and
  its recovery codes are shown once.
- **There is no CAPTCHA anywhere**, which is both an accessibility commitment
  (`docs/ACCESSIBILITY.md` §3.5) and a deliberate choice to rate-limit server-side instead.
- Cookie prefix `mtr`, `Secure`, `HttpOnly`, `SameSite=Lax`.
- `disabledPaths` is configured at the **top level** of the auth config, not inside a plugin, because
  a path disabled inside a plugin is only disabled for that plugin's routes. It lists the `admin`
  plugin's paths and `/organization/create`: no screen creates an organization over HTTP, and
  workspaces are created in-process, which `disabledPaths` does not reach.
- **After a successful sign-in the client does a full document load**, not a client-side navigation,
  so the shell loader sees the session cookie on its first run rather than rendering a signed-out
  shell and correcting it.
- `safeRedirect()` guards every `?redirect=` parameter: it must start with a single `/`, and `//`,
  `/\`, control characters and a loop back to `/login` are all rejected. An open redirect on a
  sign-in page is a credential-phishing primitive.
- **The unsubscribe token sits in a query string.** `/unsubscribe?t=` and `/api/unsubscribe?t=`
  work without a session, so the signed token reaches Cloudflare's request logs. That is accepted
  because what a captured token gives away is bounded: it can turn one kind of email off for the
  person it names, and its page shows the topic and the workspace name and, by rendering invalid
  once the person has left, whether they are still a member. It exposes no address, no amount and
  no other member. Our own logger never records the query string of either route: nothing logs
  the request URL, and `requestFields` records the path only if it is ever wired in
  (`src/server/observability/__tests__/request-fields.test.ts`). Replacing
  `UNSUBSCRIBE_TOKEN_SECRET` without carrying the old value into
  `UNSUBSCRIBE_TOKEN_SECRET_PREVIOUS` revokes every outstanding link at once.

---

## 5. Authorisation

Two role dictionaries that are never mixed:

| Dictionary     | Values                     | Source           | Used for                        |
| -------------- | -------------------------- | ---------------- | ------------------------------- |
| Workspace role | `owner`, `admin`, `member` | the `member` row | everything inside one workspace |
| Platform role  | `admin`, `curator`, `user` | `user.role`      | acting across workspaces        |

- `requireOrg()` **re-reads the workspace role from the membership row** on every request. A session
  claim is not authority.
- Platform permissions are built from a permission statement and `requirePermission` is a pure
  predicate over it. **The UI's render flags derive from the same helper as the guard**, so a button
  cannot appear for an action the server will refuse — and, more importantly, cannot be hidden for
  one the server would allow, which is how permission drift hides.
- **Server functions are public endpoints.** `beforeLoad` is UX. A well-formed id from a client is
  not an authorised id; it is re-resolved inside the caller's scope, and a foreign one is a
  `NotFoundError`.
- **Impersonation** by a platform actor is audited on entry and exit, is visibly banded in the UI in
  a way that cannot be covered by any layer, and cannot be used to change billing or to delete a
  workspace.

---

## 6. Data protection

### 6.1 What Sentry may never see

**No amount, no payee name, no account name, no transaction note, no email address and no attachment
filename leaves this system in an error report.**

- `failureRedactionMiddleware` scrubs by key against a money- and PII-aware deny list before an
  event is constructed.
- The **public failure envelope** is built from typed error codes and parameters, never from an
  interpolated message. `classifyFailure` maps every thrown error to a stable code.
- The failure boundary replaces the value a server function throws, so neither the message nor the
  stack reaches the browser; the envelope crosses the wire through a serialization adapter that
  carries the validated envelope and nothing else. **Not covered:** a failure thrown outside a
  server function (a route loader, `beforeLoad`, the framework's outer `catch`, a failure before the
  chain runs) still serialises its `message`, and the API routes, the queue handlers and the
  Durable Object log through the raw logger until the Sentry stage routes them through the same
  scrubber.
- An exception message that embeds an amount is a data-protection incident, not a debugging
  convenience. This is checked in review and is the reason error constructors take structured
  fields rather than template strings.

### 6.2 File access

Every object in R2 is served **only** through `/api/files/$id`, which resolves the row in the
caller's tenant scope and then streams from R2, supporting `Range`. **No bucket has public access and
none ever gets it.** A public bucket URL is a tenancy bypass with no audit trail and no revocation.

The row's stored key is checked as well as the row: a read or a delete of an attachment whose key is
not under the caller's own `attachments/<workspace>/` prefix is a not-found, the same as an id that
does not exist, and is logged with the attachment id only (`getAttachmentForRead`, `deleteAttachment`
in `src/server/repos/attachments.ts`). A key with a `.` or `..` segment after the prefix is refused
the same way.

A refused row has **no in-app repair**: the attachment delete refuses it, and it keeps counting
toward the workspace's storage quota until it is repaired. The one application path that removes it
is deleting its parent transaction, which cascades the row (never the object) and takes the whole
transaction with it. Repair is an operator action on D1 and R2. The log line is
`attachment key is outside the workspace prefix` and carries the attachment id only. The
orphaned-object sweep does not repair it: that sweep is not built yet, and when it is, it is
planned to work from objects, not from rows.

1. Establish which workspace owns the object the key points at. Neither audit log records R2 keys,
   so the evidence is the workspace segment of the key and the `attachments` rows that reference it.
   Check as well that the object exists at all.
2. **Never delete the R2 object**: it may be another workspace's live receipt.
3. If the object belongs to another workspace, or does not exist, delete only the poisoned D1 row.
4. If the object is the owner's, R2 has no rename: copy it to a key under the owner's own
   `attachments/<workspace>/` prefix, check the size and content type against the row, and only
   then repoint `r2_key`. Repointing the row alone leaves it naming an object that is not there
   (the file route answers 502) and the real object unreferenced. The old object stays, per step 2.
5. The D1 write is a cross-workspace action with no audit entry of its own: record it in the
   platform audit log or the incident record.

Uploads are content-type checked, size-capped by the workspace's storage quota, and stored under a
tenant-prefixed key. For R2 writes the order is **object first, quota assert second, compensating
delete on throw** — the reverse leaves a quota consumed by an object that does not exist.

### 6.3 Export

Full JSON and CSV export is available on **every plan including free**, with no upsell in the path.
An export artefact lands in R2 with an `expires_at`, is served through a tenant-checked route, and
is pruned by the nightly cron. An export link is not a capability URL: it re-checks the session.

### 6.4 Retention and deletion

| Data                | Retention                                                                 |
| ------------------- | ------------------------------------------------------------------------- |
| Workspace data      | Until deleted by the workspace, or 30 days after the workspace is deleted |
| Export artefacts    | Until `expires_at`, then pruned nightly                                   |
| Import source files | 30 days after the batch completes or is reverted                          |
| Nightly D1 backups  | `BACKUP_RETENTION_DAYS` — 30 production, 7 staging                        |
| Tenant audit log    | With the workspace                                                        |
| Platform audit log  | 400 days, pruned weekly                                                   |
| Dead-letter bodies  | 30 days                                                                   |
| Sessions            | Until expiry or sign-out; all sessions revocable from Settings → Security |

**The danger zone does what it says.** Deleting a workspace schedules a hard delete of its D1 rows
and its R2 objects on the stated schedule; it is not a soft flag that leaves the data resident
forever. Deleting an account deletes the personal workspace it owns.

### 6.5 Sub-processors

| Processor  | Purpose                                   | Data                                    |
| ---------- | ----------------------------------------- | --------------------------------------- |
| Cloudflare | Hosting, database, object storage, queues | All product data                        |
| Polar      | Subscription billing                      | Billing identity, plan, invoices        |
| Resend     | Transactional email                       | Email address, message content          |
| Sentry     | Error monitoring                          | Redacted diagnostics only — never money |

The public list lives on the Security page and in the DPA, and must be kept in step with this table.
A new sub-processor is a change to both, plus customer notice.

---

## 7. Billing integrity

- The client sends `{ planId, interval, seats? }` and **never a product id**. The UUID is resolved
  server-side; `external_customer_id` is the workspace id. A crafted request cannot buy a different
  product than the one displayed.
- Webhooks verify a Standard Webhooks HMAC-SHA256 over `${id}.${timestamp}.${raw}`, with a 300s
  tolerance, multiple `v1,<sig>` entries tolerated for rotation, and **our own constant-time
  comparison**. Unsigned is `400` and is never processed.
- Dedupe is claim-then-handle in KV, and the claim is **released on throw** so a transient failure
  does not permanently swallow an event.
- **Quotas are enforced at the repository boundary, before the write** — never in the UI. The
  published number and the enforced number come from one resolver, and a test fails when a catalogue
  metric has no resolver entry.

---

## 8. Supply chain

- `pnpm-lock.yaml` is committed and installed `--frozen-lockfile` in CI and in the agent sandbox.
- The dependency set is **frozen** (`docs/SPEC.md` §3.1). No stage installs a package; a package need
  is a recorded blocker with a disposition.
- Every dependency is pinned with a caret over a resolved version. `latest` is forbidden.
- Build-time `VITE_*` values are **inlined into the client bundle**. Nothing secret is ever a `VITE_*`
  name, and the `.dev.vars` / `.env.local` split (`docs/DEPLOY.md` §5) exists to keep that boundary
  visible.
- The agent sandbox runs in Docker with a pinned base image and no credentials beyond the ones its
  stage needs.

---

## 9. Client-side posture

- No third-party analytics, no tag manager, no session-replay tool. The only external script origins
  the app loads are its own.
- `workers_dev` and `preview_urls` are **false in both environments**: a `*.workers.dev` hostname
  serving a real session cookie is an authentication surface nobody watches.
- User content is rendered as text. There is no `dangerouslySetInnerHTML` on user content anywhere,
  and no rich-text field in v1.
- CSV export is written with a leading-formula guard (`=`, `+`, `-`, `@` prefixed cells are escaped),
  because a payee name is user content and a spreadsheet is a code execution environment.

---

## 10. Known gaps, stated rather than omitted

- **No penetration test has been commissioned.**
- **No SOC 2, ISO 27001 or any other certification is held**, and `PRODUCT.md` forbids implying one.
- **No formal incident-response runbook** beyond `docs/DEPLOY.md` §12 (rollback) and §13 (DLQ).
- **No per-account sharing model** inside a household: a member sees the whole workspace. This is
  documented as a product limitation, not sold as a security feature.
- **Backups are not restore-tested on a schedule.** The nightly logical backup exists; a periodic
  restore drill does not yet.
- **A refused attachment row has no in-app repair.** See §6.2 for the operator procedure.

Each of these is a real gap. They are listed here so that nobody has to discover them during an
incident, and so that no marketing copy implies otherwise.
