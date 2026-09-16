---
name: afk-codebase-design
description: Shared vocabulary and rules for designing deep modules in money-tracker.online - module, interface, depth, seam, adapter, leverage, locality, the deletion test. Use when designing or changing a module's interface, choosing where a seam or test goes, judging whether an abstraction earns its keep, or when another skill (afk-architecture-review, afk-to-tickets) needs this vocabulary.
---

# AFK codebase design

**These instructions are already in your system prompt.** Never call the `Skill` tool for an `afk-*` skill - a repo-local skill is not in the agent's registry, so the call fails with `Unknown skill`.

Adapted from mattpocock/skills `codebase-design` for unattended runs. Use these words exactly in designs, briefs, review findings and PR bodies. Do not substitute "component", "service", "API" or "boundary".

## Vocabulary

- **Module**: anything with an interface and an implementation, at any scale: a function, a file, a route, a repository.
- **Interface**: everything a caller must know to use the module correctly: types, invariants, ordering, error modes, required state, performance. Not just the TypeScript signature.
- **Implementation**: the code behind the interface.
- **Depth**: behaviour a caller or test can exercise per unit of interface it must learn. Deep = small interface, lots of behaviour. Shallow = interface nearly as complex as what it hides.
- **Seam**: the place where behaviour can change without editing that place; where an interface lives.
- **Adapter**: a concrete thing that fills a seam.
- **Leverage**: what callers gain from depth.
- **Locality**: what maintainers gain from depth: change, bugs and verification concentrate in one place.

## Rules

- **Deletion test.** Imagine deleting the module. If the complexity vanishes, it was a pass-through: inline it. If the complexity reappears across callers, it earns its keep.
- **The interface is the test surface.** Tests cross the same seam callers do. Needing to test past the interface means the module is the wrong shape.
- **One adapter is a hypothetical seam; two adapters are a real one.** Do not add a seam until something actually varies across it.
- **Accept dependencies, return results.** Pass collaborators in and return values rather than mutating shared state, so the seam is testable.
- **Replace, don't layer.** When you deepen a module, delete the shallow tests it makes redundant instead of keeping both.

## The house idiom: ports passed in, never looked up

This repo's seams are **narrow structural types passed as arguments**, not modules reached through an import. `LedgerBatchPorts` (`src/server/ledger/batch.ts`) is the shape to copy: the batch logic names exactly what it needs, and the caller supplies it.

Two conventions come with it:

- **Time is a dependency.** `src/server/clock.ts` exists so that no module reads the wall clock directly. A function whose result depends on "now" takes it as an argument.
- **Name the port for the role, not the vendor.** `PolarClient` (`src/server/billing/polar-client.ts`) is the exception that proves it - it is named for the vendor because it models that vendor's API surface, and everything above it speaks in roles.

**There is no DI container.** Dependencies are plain object literals passed as arguments. Do not introduce a framework-level injection mechanism.

## Money is the load-bearing constraint

`docs/MONEY.md` is not background reading. Money in this repo has rules about representation, rounding and currency that a plausible-looking change breaks silently, and SDLC.md lists money among the `risk-high` areas for that reason. Read it before touching any amount, and prefer the existing helpers in `src/lib/money/` to arithmetic you write yourself.

CODE_REVIEW.md makes this mechanical: **a money-touching write path needs its own test.**

## Dependency categories (where to put the seam)

| Category             | Example in money-tracker.online                                                                                                       | Test with                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| In-process           | enum tuples (`src/lib/enums.ts`), money types and arithmetic (`src/lib/money/`), i18n catalogue loading (`src/lib/i18n/catalogue.ts`) | the real code                                       |
| Local, substitutable | the D1 handle, R2, KV, the clock (`src/server/clock.ts`)                                                                              | an injected fake; the clock takes an explicit value |
| Remote you own       | the task queue (`TaskMessage`, `src/server/queue/messages.ts`)                                                                        | the zod envelope plus a handler called directly     |
| True external        | Polar (`PolarClient`), email delivery (`NotificationEmailEnqueuer`, `src/server/notify/email.ts`)                                     | the port, filled with a stub                        |

## Seams money-tracker.online already has

Build on these before inventing new ones.

| Seam                                                                                          | What varies across it                                                                         |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `TenantScope` (`src/server/repos/scope.ts`) / `TenantRepository` (`src/server/repos/base.ts`) | the database handle. **Not** the tenant filter - that boundary is the subject of ADR 0002     |
| `LimitResolver` (`src/server/repos/base.ts`)                                                  | how a plan limit is resolved, without the repository knowing about plans                      |
| `LedgerBatchPorts` (`src/server/ledger/batch.ts`)                                             | everything a ledger batch needs, named explicitly                                             |
| `ParserRegistry` (`src/server/import/registry.ts`)                                            | a statement format is one registered parser                                                   |
| `PolarClient` (`src/server/billing/polar-client.ts`)                                          | the payment provider                                                                          |
| `NotificationEmailEnqueuer` (`src/server/notify/email.ts`)                                    | how a notification becomes a queued email                                                     |
| `TaskMessage` (`src/server/queue/messages.ts`)                                                | a job kind is one member of the zod envelope plus its handler in `src/server/queue/handlers/` |
| `CatalogueLoader` (`src/lib/i18n/catalogue.ts`)                                               | where translation catalogues come from                                                        |

## Where the tests go

Four Vitest projects, and they are not interchangeable:

- `ui` - jsdom, for components.
- `server` - plain Node, for `src/server/**` with bindings passed in.
- `workerd` - the real Workers runtime, for what genuinely needs it.
- `tooling` - policy outside `src/**`: scripts, hooks, config.

Choosing `workerd` when `server` would do makes a slow test that hides a missing seam. Reach for it only when the behaviour under test _is_ the runtime.

## What is risk-high here

From SDLC.md: **auth, sessions, data scoping, money, schema migrations, shared contract surfaces, or broad cross-cutting edits.** When signals conflict, pick the higher label and say why. `qaGate` is on: a PR carrying `needs-qa` does not merge without `qa-approved`.

Layering rules that are blockers in CODE_REVIEW.md, and so constrain where a seam may go:

- Every query goes through the tenant-scoped base repository. **A new repository function needs its tenant-isolation case.**
- A server function validates its input with Zod at the boundary **and parses it a second time in the handler**. Both are required; removing either is a blocker.
- `components/ui` holds React Aria primitives that never fetch and never import from the server.
- A money-touching write path has its own test.

## Design it twice (risk-high interfaces only)

Use this when a new or changed interface touches the tenant repository base, a ledger or money path, a D1 migration, the queue envelope or auth.

1. Dispatch two child tasks with `cez task create`. Constrain one to the smallest possible interface and the other to the most common caller's convenience.
2. Compare their designs on depth, locality and seam placement. Pick one, or a merge of both.
3. Record the choice and the rejected design as a row in the Resolved assumptions table.

If dispatch is unavailable, write both designs yourself, in sequence, before choosing.

## Done when

The design or finding names the module, its interface, and its seam in these terms, and states which rule above justifies the change.
