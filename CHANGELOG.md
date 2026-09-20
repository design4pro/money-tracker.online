# Changelog

Releases of money-tracker.online. A release is a `develop → main` promotion; there are no git tags
and `package.json` carries no `version`, so **the topmost heading below is the version of record** -
it is what `om-auto-update-changelog` reads to resolve `--since last-release`, and what a human
bumps when cutting the next one.

New entries are written by `om-auto-update-changelog` in the format below and land as an ordinary
docs pull request. The seed entry is the exception and says so in its own note.

---

# 0.1.0 (2026-09-20)

## Highlights

The first three weeks: a multi-tenant personal finance manager on Cloudflare Workers, from an empty
repository to accounts, transactions, transfers, splits, refunds, rules, budgets, recurring
entries, savings goals, a statement importer, notifications, transactional email, billing on Polar,
and the passbook design system the whole surface is drawn in. Money is integer minor units at every
layer, every query is tenant-scoped, and the accessibility gate is WCAG 2.2 AA.

> **About this entry.** It is a seed, derived from the titles of the 185 pull requests merged into
> `develop` between 2026-09-02 and 2026-09-20 - 27 `feat`, 32 `fix`, 47 `chore`, 46 `docs`, 15
> `ci`, 15 `test` and 3 `refactor`. Only the two user-visible categories are itemised; the rest are
> the agent layer, the delivery process, the test net and the documentation, which a reader of a
> changelog does not need line by line. It carries no `*(@handle)*` credits because it did not go
> through the Supersede Credit Rule's verification pass - entries from 0.2.0 on do.

## ✨ Features

- ✨ Categories, payees, a11y fixes, e2e regression net. (#5)
- ✨ Wave 3 - budgets, recurring transactions, savings goals. (#6)
- ✨ Add the weekly budget period. (#7)
- ✨ Transfers, splits and a rules engine. (#9)
- ✨ Refunds, groups, attachments and a rule editor. (#11)
- ✨ Refunds, splits, rules, attachments, groups and the statement importer. (#14)
- ✨ A landing page that shows the product, in household words. (#41)
- ✨ Plan catalogue, Polar subscriptions and workspace sharing. (#44)
- ✨ Seed the cockpit's plan-mode prompt templates from the repo. (#45)
- ✨ Replace the visual world with the passbook. (#50)
- ✨ Close the passbook page and stamp the settled line. (#53)
- ✨ Install the om skill pipeline beside the bespoke layer. (#58)
- ✨ Switch the delivery process over to the om skills. (#59)
- ✨ Passbook ledger, distilled entry form and quieter shell from the critique. (#67)
- ✨ Replace isDismissable={false} with an unsaved-changes guard. (#175)
- ✨ Every surface either earns its width or stops growing (fixes #18). (#156)
- ✨ Record a spec's state where a reader looks, and guard the record. (#202)
- ✨ The notification dispatcher, the store and per-user preferences. (#224)
- ✨ Designed empty, loading and error states on every surface. (#206)
- ✨ Reset a parked transform under reduced motion. (#254)
- ✨ Let an archived spec say what superseded it. (#259)
- ✨ The design-system link navigates through the router. (#264)
- ✨ Reject a shared path under Owned paths outside the foundations plan (fixes #321). (#322)
- ✨ Prime the shell cache so the first client-side navigation draws its loading state. (#338)
- ✨ 21-S2 phase 1 — Resend transport, React Email templates and the auth migration. (#349)
- ✨ The mark becomes parameterisable (badge pen, phase 1). (#370)
- ✨ The pen palette (badge pen, phase 2). (#373)

## 🐛 Fixes

- 🐛 Keep the amount live while the entry form saves. (#28)
- 🐛 Point the cezar scripts at the project id the cockpit holds. (#47)
- 🐛 Accept both of Polar's webhook key derivations. (#49)
- 🐛 Landing scope list and 44px collection rows. (#55)
- 🐛 Skip the pre-commit hook inside cezar runs. (#66)
- 🐛 Answer 404 when a detail id names no row. (#64)
- 🐛 Make the includePullRequests host patch idempotent. (#81)
- 🐛 Make set_pipeline_label word-split under zsh. (#86)
- 🐛 Read a newline as a command separator in git-guardrails. (#96)
- 🐛 Scope the PR label poll with is:pr instead of the mixed family. (#140)
- 🐛 Let decoration yield its width before content does at 360px (fixes #17). (#152)
- 🐛 Give dark its own measured rule ladder so surfaces separate (fixes #19). (#150)
- 🐛 Hold the rebuild lock in memory, not in storage (fixes #22). (#154)
- 🐛 Open a transaction, not the button that creates one. (#158)
- 🐛 Hold the 7:1 text floor on the ground a hovered row actually has (fixes #20). (#159)
- 🐛 Add a loud danger grade so dark stops reading as salmon (fixes #151). (#170)
- 🐛 Bound the modal panel to the viewport so its body is the scroll port (fixes #167). (#172)
- 🐛 Scrub the inherited git environment in the guard-diff fixture. (#179)
- 🐛 Give the orphan guard-diff fixture a repository of its own. (#184)
- 🐛 Walk every page of review threads, not just the first. (#185)
- 🐛 Wait out a locked D1 file instead of failing the audit on it. (#187)
- 🐛 Read dangerAt so one over-limit verdict is one red (fixes #180). (#197)
- 🐛 Recompute the meter's ok-state contrast figures (fixes #199). (#209)
- 🐛 Ignore .ai/tmp/ so a stray run directory no longer fails pnpm lint (fixes #203). (#207)
- 🐛 Wire DialogHeader's description to aria-describedby. (#225)
- 🐛 Run the spec-index generator through node --import tsx (fixes #221). (#226)
- 🐛 Stop eslint walking the gitignored artefact trees under .ai/. (#237)
- 🐛 Give the caution tone a fill grade so dark stops reading as gold (fixes #171). (#242)
- 🐛 Stop two screens skipping a heading level, and widen the guard. (#241)
- 🐛 Tell a wedged browser apart from a slow application. (#268)
- 🐛 Compose date ranges instead of asking Intl for an interval (fixes #163). (#269)
- 🐛 Remount the root outlet when the top-level layout changes (fixes #339). (#340)

## 👥 Contributors

- @rafalwolak
