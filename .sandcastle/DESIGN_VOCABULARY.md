# Design vocabulary (shared by the deep-review and architecture-review stages)

The language for talking about code structure in this repo. Use these terms exactly.
Do not substitute "component", "service", "API" or "boundary" — consistent language is
the whole point, and those four are overloaded elsewhere.

## Glossary

- **Module** — anything with an interface and an implementation. Deliberately
  scale-agnostic: a function, a file, a directory, or a tier-spanning slice.
- **Interface** — everything a caller must know to use the module correctly: the type
  signature, but also invariants, ordering constraints, error modes, required
  configuration and performance characteristics. Wider than "the exported types".
- **Implementation** — what is inside a module. Distinct from **adapter**: a thing can be
  a small adapter with a large implementation (the D1 repo) or a large adapter with a
  small one (an in-memory fake).
- **Depth** — leverage at the interface: how much behaviour a caller or a test can
  exercise per unit of interface it must learn. **Deep** = a lot of behaviour behind a
  small interface. **Shallow** = the interface is nearly as complex as the implementation.
- **Seam** — a place where behaviour can be altered without editing in that place; the
  _location_ at which a module's interface lives. Where the seam goes is a separate
  decision from what sits behind it.
- **Adapter** — a concrete thing satisfying an interface at a seam. Describes the role it
  fills, not what is inside it.
- **Leverage** — what callers get from depth: more capability per unit of interface
  learned. One implementation pays back across N call sites and M tests.
- **Locality** — what maintainers get from depth: change, bugs and verification
  concentrate in one place instead of spreading across callers. Fix once, fixed everywhere.

## Principles

- **The deletion test.** Imagine deleting the module. If complexity vanishes, it was a
  pass-through and should go. If complexity reappears across N callers, it was earning
  its keep. "Concentrates complexity" is the signal worth acting on.
- **The interface is the test surface.** Callers and tests cross the same seam. Wanting
  to test _past_ an interface means the module is the wrong shape.
- **One adapter is a hypothetical seam, two is a real one.** Do not introduce a seam
  unless something actually varies across it.
- **Depth is a property of the interface, not the implementation.** A deep module may be
  internally composed of small swappable parts; they just are not part of its interface.

## The archetype in this repo

The tenant-scoped base repository (docs/adr/0002) is the reference deep module: every
tenant-scoped query passes through one narrow interface whose tenant filter cannot be
removed, so the isolation guarantee is verified once rather than at each call site.
`src/server/repos/__tests__/tenant-isolation.test.ts` is that interface's test surface.
