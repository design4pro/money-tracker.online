# Domain docs

Where domain truth lives for an agent working in a fresh context. Read in this order.

- **Names** — `CONTEXT.md` at the repository root. A pure glossary, updated inline during grilling
  sessions. Challenge a fuzzy term against it; when a term is missing, pin it down and add it there.
  The `_Avoid_` clause on an entry is the load-bearing part: it names the wrong usage explicitly.
- **Arithmetic** — `docs/MONEY.md`. Minor units, `digits`, rounding, rates, `ref_amount`, the four
  transfer cases, the balance-history rebuild, the timezone rule, and a failure gallery of fourteen
  real bugs the rules prevent. **Read it in full before touching an amount, a rate, a currency or a
  date bucket.** It wins over `docs/SPEC.md` on any point of arithmetic.
- **Boundaries** — `docs/SPEC.md` §5 (architecture and the tenancy contract) and §6 (layering).
  §7 is the definition of done and §8 is the decomposition rule; both are inherited unchanged by
  every stage.
- **Conformance** — `docs/ACCESSIBILITY.md`. What is claimed, what is not, and what may never be
  written. It wins over every other document and over all copy.
- **Why** — `docs/adr/NNNN-slug.md`. Written only when a decision is all three of hard to reverse,
  surprising without context, and the result of a real trade-off. ADRs are append-only; a superseded
  one is marked superseded, never deleted or edited in place.
- **What to build next** — `docs/plans/`. `README.md` is the registry and the wave order,
  `TEMPLATE.md` is the stage shape, and a stage's **Owned paths** list is the whole permitted diff.

None of these is a glossary except `CONTEXT.md`, and none of them is arithmetic except
`docs/MONEY.md`. Vocabulary goes to one; numbers go to the other; neither restates the other.
