/**
 * The two-pane geometry `/recurring` uses from `xl` up.
 *
 * Written once because two files have to agree on it to the pixel: the screen itself and the
 * loading picture that stands in for it. A skeleton laid out one column wide would hand the reader
 * a full-width list and then take a third of it away the moment the data arrived, which is the
 * horizontal version of the jump a skeleton exists to prevent - and a class string copied into two
 * files is a jump waiting for somebody to change one of them.
 *
 * `minmax(0,1fr)` for the series list so a long series name shrinks its own pane rather than
 * pushing the rail off the row; a fixed `30rem` for the rail so an empty `Due soon` cannot collapse
 * the column; `items-start` so the rail ends at its own last row instead of being stretched to the
 * height of a list that may hold twenty series.
 *
 * ## Why `30rem`, and why the number was measured twice
 *
 * `Due soon` is a table, and a table has a width below which it stops being one. Measured at
 * 1440x900 it needs 290px (`en`) / 298px (`pl`) for its three ordinary columns, and **419px** once
 * a late period adds the status column: `PeriodStatusBadge` renders `Badge`, which is
 * `whitespace-nowrap font-semibold` inside a border and reads `Po terminie` in Polish. A `20rem`
 * track left it 278px to do that in, so the rail arrived on a desktop already scrolling sideways.
 *
 * The first attempt at this number was `28rem`, derived against a hand-built stand-in for that
 * badge which had no `whitespace-nowrap` and carried the English word - so it measured 406px and
 * came out 13px short in the one locale that needed the room. `30rem` leaves 438px, measured
 * against markup that matches what `Badge` actually renders, in both locales.
 *
 * ## Why `xl` rather than `lg`, and why the stacked case is capped
 *
 * A rail this wide cannot start at `lg`. The page column is 740px at 1024px of viewport, so a
 * 30rem aside there would leave the series list 230px - the phone-list-in-a-desktop-band this
 * whole spec exists to remove, reintroduced on the pane that matters. At 1280 the panes are
 * 492/480, at 1440 they are 652/480.
 *
 * Below `xl` the panes stack, and a stacked pane left alone would take the whole well - which is
 * finding 1 of the issue, on the surface the issue names. So the container carries the list band
 * below the breakpoint and drops it above, where both tracks are already narrower than the band
 * and the cap would only shrink a row it is meant to leave alone.
 */
export const RECURRING_PANES =
  'grid max-w-list items-start gap-6 xl:max-w-none xl:grid-cols-[minmax(0,1fr)_30rem]'
