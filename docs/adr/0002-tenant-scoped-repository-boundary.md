# 0002. Tenant isolation is enforced at the repository boundary

Status: accepted
Date: 2026-09-01

## Context

Every product table in this system carries an `organization_id`. A single forgotten
`WHERE organization_id = ?` is a cross-tenant leak of somebody's financial records — the highest
severity failure this product has. Prose rules ("always filter by tenant") do not survive hundreds
of agent sessions and dozens of new repository functions, and code review catches the omission only
when the reviewer happens to look at the right line.

D1 has no row-level security to fall back on.

## Decision

All SQL lives in `src/server/repos`, and every query passes through a tenant-scoped base repository
which appends the tenant predicate from a `TenantScope`. **Callers may add predicates; they cannot
remove that one.** Forgetting the tenant filter is not expressible in the type system we expose.

Concretely:

- `createScope(db, context)` is the only constructor of a `TenantScope`.
- `insertMany` **stamps** `organizationId` from the scope, so a payload cannot set it.
- `TenantPatch<T>` omits `organizationId`, `id` and `createdAt`, so an update cannot move a row
  between tenants.
- `assertScopedWrite` throws when a write composes to an empty predicate list.
- A foreign id answers `NotFoundError`, never `ForbiddenError`: not seeing must be indistinguishable
  from not existing, including in counts, aggregates and totals.
- `organization_id` is the **leading column of every composite index**, so the predicate is always
  index-satisfiable and never the thing a query plan drops.
- `src/server/catalog` is the stated exception — global tables with no `organization_id`
  (currencies, exchange rates, brand logos) — guarded instead by `requirePermission` plus a
  `platform_audit_log` write. Two more exceptions have been recorded since; see the Amendment.
- Quota is enforced at the same boundary, inside the repository, before the write.

Considered and rejected: enforcing tenancy in a service layer above the repositories. It reads
better and it fails the same way — the enforcement is one call site away from being skipped, and
"skipped" is silent.

## Consequences

The repository layer is the deep module of this codebase: a small interface hiding tenancy, quota
and SQL. `src/server/repos/__tests__/tenant-isolation.test.ts` wraps that boundary, and **a
repository function without an isolation case is not done**.

The costs are real. Queries that would be natural as a join across a tenant boundary — a platform
console listing every workspace's currency usage — cannot be written in the ordinary way and must go
through the catalogue carve-out with its audit write. Some genuinely global reads are more awkward
than they would be with ad-hoc SQL. And the base repository is a piece of infrastructure that has to
be understood before anyone can write a query at all, which is a real onboarding cost.

We accept all of that, because the alternative failure is unrecoverable: a customer's transactions
shown to a stranger cannot be un-shown.

## Amendment

Date: 2026-10-09. Written against the code of stages `04-S1` and `22-S1`. The decision of 2026-09-01
above is unchanged apart from one pointer to this section; where it disagrees with what follows,
this section is the record of what the code does. It adds nothing to the Decision: it records two exceptions the Decision does not
name, and `docs/SPEC.md` §5.2 is the canonical statement of all three.

- **Reconciled with SPEC §5.2.** The Decision names `src/server/catalog` only. SPEC §5.2 also lists
  `billing_events` (`docs/plans/22-billing.md`, stage `22-S1`): a webhook delivery arrives before
  its workspace is known, so `organization_id` is nullable and the two writes that record and close
  a delivery take a bare `Database`. The ADR did not carry that exception; it does now.
- **A third exception: the workspace-creation write.** The `organization_currencies` insert inside
  the `db.batch` in `src/server/auth/organization.ts` is written outside `src/server/repos`. It is
  insert-only, it sits in the same batch as the `organization` and owner `member` inserts, and its
  `organizationId` is derived server-side from the authenticated user id and shared by the three
  inserts, never taken from a request. The currency codes are server constants. No `TenantScope`
  exists before the workspace does, and the write cannot be split off, because a workspace without
  a base currency leaves `conversionContextFor`, and so every `ref_amount_minor`, undefined. The
  module's other statements touch only the Better Auth tables (`organization`, `member`, `user`),
  which are not product tables in the sense of SPEC §5.2 and are guarded by ADR 0011; it reads and
  writes no product table other than this one insert.
- **What the third exception does not cover.** No read, update or delete, and no other product
  table. It is not inherited: the writes plan stage `26-S1` makes at workspace creation
  (`organization_currencies` with a base currency the person chooses, `workspace_settings`, preset
  categories and budgets) need their own recorded decision in that ticket.
- **Considered and rejected for now:** moving the write behind the repository layer. It needs a
  bootstrap-scope concept in the tenancy layer, which is heavier and harder to reverse than
  recording what the code does; the rule text contradicting the code was the worse state.
