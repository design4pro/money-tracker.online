# 0009. The accessibility claim is AA product-wide plus five named AAA criteria

Status: accepted
Date: 2026-09-01

## Context

The project brief set "WCAG 2.2 AAA" as the accessibility target, and the ambition behind it is
right: this product should be genuinely excellent to use with a keyboard, a screen reader, a
magnifier or reduced motion, and that ambition should be a hard gate rather than a good intention.

But **"AAA" as a published conformance claim is not achievable here**, and publishing it anyway
would be worse than publishing nothing.

Several AAA criteria are unachievable or actively product-hostile for a finance product:

- **1.4.6 Contrast (Enhanced)** cannot hold across the categorical series palette. Our own tokens
  demonstrate why chasing it would not even help: `series-2` (`#1539a8`) and `series-7` (`#7f1a55`)
  each clear **7.69:1** against the surface, and against **each other** they measure **1.00:1**.
  Contrast against the ground is silent about whether two series are distinguishable.
- **3.1.5 Reading Level** conflicts with vocabulary a finance product cannot avoid — _exchange rate_,
  _minor unit_, _reconciliation_, _amortisation_.
- **2.4.9 Link Purpose (Link Only)** is hostile to a dense ledger table, where "Edit" is the honest
  label and the row is the context. Satisfying it would make screen-reader navigation materially
  worse.
- **2.2.3 No Timing** cannot be met at all: authenticated sessions expire, which is a security
  requirement for a product holding financial records.
- **1.2.6 Sign Language** would make any future product video non-conforming.

Separately, WCAG's own guidance says a Level AAA claim is not recommended as a general policy for
entire sites, because it is not possible to satisfy every AAA criterion for all content.

And a published accessibility statement is a **representation**. This product serves EU residents; an
overstated statement is a false statement about an accessibility feature and a real legal exposure
under the European Accessibility Act, quite apart from misleading the people it would mislead.

## Decision

The claim is:

> **WCAG 2.2 Level AA, product-wide, as a hard CI gate**, plus these Level AAA success criteria:
> **1.4.8** Visual Presentation, **2.2.6** Timeouts, **2.4.12** Focus Not Obscured (Enhanced),
> **2.5.5** Target Size (Enhanced), **3.3.9** Accessible Authentication (Enhanced).
> Level AA criterion 2.4.11 is named alongside 2.4.12 because its Enhanced sibling is claimed.

The palette is nonetheless designed to a **7:1 text contrast floor** — 1.4.6's threshold — with two
named exceptions, because that is the right engineering outcome even where it is not a claimable one.

`docs/ACCESSIBILITY.md` is the authoritative statement and lists **every** AAA criterion that is not
met, each with its reason. **No blanket AAA claim may appear anywhere** — not in the product, not in
marketing copy, not in a README, not in a commit message, not in a plan, in any locale.

Enforcement: `@axe-core/playwright` runs on every route in the visual spec, in both themes, at three
widths, in both locales; `serious` and `critical` violations fail the build with no waiver list, and
a `moderate` finding must be named and justified in the stage's Verification block. Five dedicated
e2e cases hold the five claimed AAA criteria as contract tests.

## Consequences

Marketing loses a three-letter word it would very much like to use. Anyone who reads only the brief
will believe the target was missed, which is why the reasoning is written down here and in
`docs/ACCESSIBILITY.md` §2 rather than left as a decision somebody made once.

The claim is also **harder to maintain than a vague one**: each of the five AAA criteria is held by a
named automated case, and a change that breaks one breaks a published claim. That is the intended
cost — it is what makes the claim worth reading.

`docs/ACCESSIBILITY.md` also states three things we have **not** done: no assistive-technology test
pass, no third-party audit, no usability testing with disabled users. Listing gaps in a conformance
statement is unusual and it is deliberate: a statement that lists only successes is a marketing
document, and this one has to be something a reader can rely on.

Amending the claim requires a new ADR. Adding a criterion to the met list requires a passing test
that holds it, not an opinion that it probably passes.
