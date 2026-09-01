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
- `src/server/catalog` is the single stated exception — global tables with no `organization_id`
  (currencies, exchange rates, brand logos) — guarded instead by `requirePermission` plus a
  `platform_audit_log` write.
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
