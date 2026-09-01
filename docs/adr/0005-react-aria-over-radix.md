# 0005. Component primitives are React Aria Components, not Radix

Status: accepted
Date: 2026-09-01

## Context

The product needs a component layer in the shadcn shape: owned, copy-in components under
`src/components/ui/**` with `class-variance-authority` recipes and Tailwind tokens, rather than a
dependency we configure from the outside. That shape is not in question.

What is in question is the behaviour layer underneath it. shadcn/ui's canonical registry is built on
Radix. Radix is excellent and it is the path of least resistance: the registry, the documentation and
most of the community examples assume it.

Two things pushed against it here.

**Accessibility beyond AA.** This product commits to WCAG 2.2 AA product-wide plus five named AAA
criteria (`docs/ACCESSIBILITY.md`), and it is dense with the controls where that is hardest: a
date picker on the most-used form in the product, a virtualised table with row actions, a category
tree that reorders, a dashboard grid that rearranges, a currency combobox. Two of the claimed
criteria — 2.4.12 Focus Not Obscured (Enhanced) and 2.5.5 Target Size (Enhanced) — are properties of
focus management and hit-area composition, which is precisely what the primitive layer decides.

**Internationalisation is not a separate concern here.** The product formats money and dates on
nearly every surface, in two locales, with per-currency `digits`. React Aria's `I18nProvider` sets
locale for the whole primitive tree — including its date and number handling — in one move, and
`@internationalized/date` and `@internationalized/number` are the same family, which we need anyway
for the money layer.

**Drag-and-drop with a keyboard path.** Four surfaces reorder by dragging. Every one of them must
also work from a keyboard, and React Aria's drag-and-drop has a keyboard modality designed in rather
than bolted on.

## Decision

Component primitives are built on **`react-aria-components`**, in the shadcn shape, seeded from the
jolly-ui registry conventions where they exist. `radix-ui` is not a dependency and `vaul` is
replaced by a React Aria `Modal` variant. `tailwindcss-react-aria-components` provides the
data-attribute variants (`data-focus-visible`, `data-selected`) as Tailwind modifiers.

Direction comes from React Aria's `I18nProvider` rather than a separate direction provider. Both our
locales are LTR, so `dir` handling is a correctness detail rather than a layout one — but it is
handled in the same place as the locale, which is the point.

## Consequences

We give up the largest ecosystem advantage in this space. Every shadcn component published on the
internet is Radix-shaped, so a copy-paste is never a copy-paste: it is a translation. New primitives
cost more to write than they would have. There are more of our own lines in `components/ui/**` than
there would have been.

The API surfaces differ in ways that show up repeatedly: React Aria's render-prop children and its
collection components (`<ListBox>` with `items`) are a different mental model from Radix's compound
components, and someone who knows Radix will be slower here for a week.

Some primitives are less mature. React Aria's Toast was unstable when this was decided, which is why
`sonner` handles toasts with a polite live region — a seam that has to be revisited when Toast
stabilises, and which is the one place in the primitive layer where two systems meet.

In exchange, focus management, keyboard drag-and-drop and locale-aware date and number input are
properties of the layer rather than things each component has to get right, and the two AAA criteria
that depend on them are testable rather than aspirational.
