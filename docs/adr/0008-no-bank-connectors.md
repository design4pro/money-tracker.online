# 0008. There are no bank connectors, permanently

Status: accepted
Date: 2026-09-01

## Context

Every competitor in this category either connects to banks or is judged for not doing so. Automatic
import is the single most-requested feature in personal finance software, and there are mature ways
to provide it: an aggregator (Plaid, GoCardless, Salt Edge, Tink), direct open-banking APIs under
PSD2, or screen-scraping with stored credentials.

The pull to build one will be constant, and it will come with a reasonable-sounding argument each
time: a customer asked, a competitor shipped it, an aggregator's free tier makes it cheap to try.

The costs, stated honestly rather than dismissively:

- **Regulatory.** Accessing account information under PSD2 in the EU requires authorisation as an
  Account Information Service Provider, or an agreement with a licensed aggregator that carries its
  own compliance obligations onto us. This is a licensing programme, not an integration.
- **Security.** Holding tokens that can read someone's bank account changes the threat model
  completely. We would become a target worth attacking, and a breach would be a breach of financial
  account access, not of a spending diary.
- **Cost.** Aggregators charge per connected account per month. That cost scales with usage rather
  than with revenue, and it lands hardest on exactly the power users we most want on a paid plan.
- **Reliability.** Connectors break constantly — a bank changes an auth flow, a consent expires at 90
  days, a connection silently returns partial data. In every product that has them, the support load
  is dominated by broken connections, and the trust cost of _silently missing transactions_ is worse
  than the trust cost of typing them in.
- **Product identity.** "We never ask for your banking credentials" is a position a meaningful number
  of people actively want, and it is not available to anyone who has a connector, even an optional
  one.

## Decision

**This product has no bank connectors, no screen-scraping, no aggregator integration and no
credential capture for any financial institution. Not now, and not later.**

This is a permanent product position, not a staging of work. A feature request for one is closed
with a link to this record; it does not become a backlog item, an experiment or a spike.

The value a connector provides — rows arriving without typing — is bought instead, properly:

- **Fast manual entry**, measured against a ten-second phone transaction, as a first-class
  performance target rather than a form.
- **File import**: CSV with saved column mappings by header fingerprint, OFX 1.x and 2.x, QIF, and
  migrations from two other trackers, with duplicate detection, a preview and a revertible batch.
- **Recurring series** that materialise their own periods and can auto-record.
- **Rules** that classify on arrival, so an imported row needs no touching.
- **Candidate detection** that proposes recurring series from history rather than asking for them.

## Consequences

We will lose customers to this, and we will lose some of them loudly. The comparison table on the
pricing page has a row we cannot tick, and every review of this product will mention it.

We must therefore be **conspicuously excellent** at the alternatives. Import that mangles a bank's
CSV export, or entry that takes four taps too many, is not merely a weak feature here — it is the
feature we substituted for the one we refused to build. Plans 19 (import) and 26 (onboarding) carry
that weight explicitly.

In exchange: no PSD2 licensing, no aggregator invoice that scales with usage, no stored banking
tokens, a dramatically smaller breach blast radius, no support queue dominated by broken connections,
and a marketing position — _we never ask for your banking credentials_ — that no competitor with a
connector can make.

The rule is repeated in `CLAUDE.md`, `AGENTS.md`, `PRODUCT.md` and `CONTRIBUTING.md` on purpose,
because the pressure to reverse it will be applied by people who have not read this file.
