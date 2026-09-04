# Blind comparison round, 2026-09-03

Seven surfaces, photographed against the reference demo at 1440x900 and 360x800, in light and
dark, and handed to seven critics who had the eight PNGs and nothing else. Each critic saw the two
products as `A` and `B` and did not know which label was ours. This file unseals the labels.

The round is the part of the founding brief that had never actually been executed, and the reason
was structural rather than negligent: the capture script could only photograph the reference's
front door, so every surface past the dashboard was unreachable. Three harness defects had to be
fixed before a single verdict could be trusted. They are recorded in `docs/agents/reference.md`
under "Two ways the shutter invents a finding" and in the commit that added the landing guard.

## Result: 5-2

| Surface                | Ours | Reference | Winner      | Our count     | Their count   |
| ---------------------- | ---- | --------- | ----------- | ------------- | ------------- |
| `/dashboard`           | B    | A         | **ours**    | 4 maj / 5 min | 7 maj / 3 min |
| `/accounts`            | A    | B         | **ours**    | 1 maj / 6 min | 6 maj / 4 min |
| `/transactions`        | A    | B         | **ours**    | 1 maj / 5 min | 7 maj / 5 min |
| `/budgets`             | B    | A         | **ours**    | 3 maj / 7 min | 5 maj / 5 min |
| `/recurring`           | A    | B         | _reference_ | 5 maj / 4 min | 3 maj / 6 min |
| `/categories`          | B    | A         | _reference_ | 4 maj / 5 min | 6 maj / 3 min |
| `/transactions/groups` | B    | A         | **ours**    | 2 maj / 3 min | 4 maj / 3 min |

The raw finding counts and the verdicts agree everywhere except `/categories`, where we carry
four majors against their six and still lost. That inversion was deliberate on the critic's part
and it is the most useful sentence of the round:

> A wygrywa nie urodą, tylko tym, że nigdzie nie niszczy własnej treści.

Their six majors are chrome around the content - a clipped settings gear, a floating badge over a
list, a half-rendered sidebar row, dead canvas. Our four destroy the content itself: on a 360px
category manager the category names render as `C.`, `M.`, `Z.`, `R.` while a `MONEY OUT` badge that
is identical on all eleven rows keeps its full width. A screen that cannot show its own subject
loses to a screen that shows its subject badly.

## What the round cannot tell us

**Blind labelling hides which side the critic is on. It does not hide which brand is which.** Both
products paint their own wordmark in the sidebar, and every one of the seven critics recognised
ours, said so unprompted, and stated that it moved neither direction. That disclosure is the only
integrity control available here short of cropping the chrome out, which would remove navigation
from the judgement. Read every verdict with that caveat attached rather than filed away.

Two further fixture properties were named in each brief and excluded from scoring: our frames
render Polish and theirs English (the seeded demo user's stored locale preference wins the chain in
`src/lib/i18n/negotiate.ts`), and the seed data differs on both sides.

## The five findings that repeat across surfaces

Seven critics, no contact between them, converged on the same five faults. That convergence is
worth more than any single verdict.

### 1. The desktop canvas is unused - six surfaces of seven

Dashboard (~1000px empty header strip, ~140px dead space mid-card), accounts (~850px beside a lone
filter), transactions (an empty top band holding three edge icons), budgets (~1000px of empty rule
per row), recurring (four facts spread across ~1150px), categories (~900px between badge and
overflow menu), groups (two thirds of the canvas dead below two rows).

The diagnosis is the same every time and it is not "add more content": these are mobile lists
stretched to 1440px. A row that carries four short facts does not become a desktop layout by being
given 1150px; it becomes a mobile row with a void attached. Either the row earns the width with
columns, or the container stops growing.

### 2. Narrow viewports truncate content instead of chrome - four surfaces

Transactions (category and account cut to one character plus ellipsis), categories (child names cut
to one letter), groups (`TRANS...` and names wrapped mid-phrase), recurring (action buttons painted
over the H1 so only `R` survives).

One cause underneath all four: no `min-width: 0` on the text node, and no truncation priority that
says decoration yields before content. Flex defaults hand the shrink to the label because the badge
has an intrinsic width and the text does not.

### 3. Dark theme is re-valued, not designed - five surfaces

Budgets (card surface within ~2% luminance of the page ground, so the card edge vanishes),
recurring and groups (borders and row dividers nearly gone), categories (row containment collapses
into the page, leaving indent as the only hierarchy cue), accounts (dividers and progress track
nearly invisible - "theme merely re-valued"), dashboard (a large empty black area below the
Settings divider).

The pattern is specific: our light theme separates surfaces with borders that carry enough contrast
against an off-white ground, and the dark palette re-values those same tokens without re-checking
that the separation survived. `/accounts` was the exception a critic praised for a genuine
three-step dark hierarchy, which proves the system can do it.

### 4. Secondary grey is contrast-doubtful - dashboard and accounts

The `In PLN:` conversion lines and secondary row text were called borderline against AA by two
critics independently. The project claims AAA in `docs/SPEC.md` §10. Doubt at AA on a claimed-AAA
surface is a defect regardless of what a contrast checker says, and it needs measuring rather than
arguing.

### 5. Missing designed empty, loading and error states

Named explicitly on accounts, and noted on budgets as absent from both products. A finance app is
full of screens a new user meets with nothing in them.

## Where we clearly lead

Worth recording, because the round exists to find faults and the praise is easy to lose:

- one type family and one scale, against three families and arbitrary sizes on the other side
- tabular figures that genuinely align down a column
- chart encoding by hatch _and_ hue, which survives greyscale
- full-precision amounts with a labelled conversion line, against `$49,496....` and `$5,254...`
- the budget object itself: remaining amount as the largest type in the row, and over-budget
  encoded four ways - icon, word, colour and hatch fill - against a bar where 91% and 113% render
  as the same full red track

## Reproducing this

`docs/agents/reference.md` carries the recipe, the surface map and the clean-room rule. The label
map for this round, the per-surface findings and the consolidated JSON live in the session
scratchpad and are not committed - the frames themselves are gitignored, and a critic's verdict is
evidence about a moment, not an artefact to maintain.
