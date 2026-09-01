# 0001. Record architecture decisions

Status: accepted
Date: 2026-09-01

## Context

This repository is worked by agents in fresh contexts as much as by people. Decisions that are not
written down are re-derived, and re-derivation produces contradictions: two rounding helpers, two
opinions about whether a historical conversion may be recomputed, two answers to "may a stage edit
the schema module". Prose scattered across a spec, pull-request descriptions and orchestrator state
is not a durable record of _why_.

## Decision

We record architecture decisions as ADRs in `docs/adr/NNNN-slug.md`.

The format is fixed by this record: a title that is the decision stated as a declarative sentence,
then `Status`, `Date`, an optional `Supersedes` / `Superseded by`, then `## Context`, `## Decision`
and `## Consequences`.

**An ADR exists only when a decision is all three of: hard to reverse, surprising without context,
and the result of a real trade-off.** Everything else stays in code, in `docs/SPEC.md`, or in
`CONTEXT.md`. A record that documents an obvious choice dilutes the set until nobody reads it.

ADRs are **append-only**. An amendment is appended to the record it amends; a reversed decision gets
a new ADR marking the old one superseded. Nothing is edited in place and nothing is deleted.

## Consequences

Fresh-context agents and new contributors can read the "why" without archaeology, and a reviewer can
answer "was this considered?" with a link rather than an opinion.

The cost is discipline: the three-part test has to be applied honestly, or the directory fills with
records of choices nobody was going to question, and the signal is gone. The other cost is that
`Consequences` sections age — a consequence that turned out to be wrong is corrected by an
appended amendment, which makes some records longer than their decision warrants. That is the
intended trade: an accurate history beats a tidy one.
