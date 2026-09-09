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
 * pushing the rail off the row; a fixed `28rem` for the rail so an empty `Due soon` cannot collapse
 * the column; `items-start` so the rail ends at its own last row instead of being stretched to the
 * height of a list that may hold twenty series.
 *
 * ## Why `28rem`, and why `xl` rather than `lg`
 *
 * Both numbers are measurements rather than taste. `Due soon` is a table, and a table has a width
 * below which it stops being one: measured at 1440x900 it needs 290px (`en`) / 298px (`pl`) for its
 * three ordinary columns and 406px once a late period adds the status column. A `20rem` track left
 * it 278px to do that in, so the rail arrived on a desktop already scrolling sideways. `28rem`
 * leaves 406px, which is the smallest track that holds the widest state.
 *
 * A rail that wide cannot start at `lg`. The page column is 740px at 1024px of viewport, so a
 * 28rem aside there would leave the series list 268px - the phone-list-in-a-desktop-band this
 * whole spec exists to remove, reintroduced on the pane that matters. Below `xl` the rail stacks
 * under the list instead and takes the full column, where its table has more room than it can use.
 */
export const RECURRING_PANES =
  'grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_28rem]'
