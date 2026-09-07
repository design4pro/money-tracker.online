# Out of scope

Requests this product has already decided against. `om-prepare-issue` checks this register before
creating anything (`.ai/skills/om-prepare-issue/SKILL.md`), so a rejected idea is not re-litigated
by a new issue in different words.

A row is added when a human rejects a request on scope grounds, not when an issue is merely closed.
A row is removed only by the decision that reverses it, and that decision is an ADR.

| request                                                       | decided    | where                                 |
| ------------------------------------------------------------- | ---------- | ------------------------------------- |
| Automatic import from a bank via a connector or aggregator    | 2026-09-01 | `docs/adr/0008-no-bank-connectors.md` |
| A feature copied from the reference product because it has it | 2026-09-02 | `docs/agents/reference.md` (clause 7) |
