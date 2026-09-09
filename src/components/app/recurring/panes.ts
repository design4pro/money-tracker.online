/**
 * The two-pane geometry `/recurring` uses from `lg` up.
 *
 * Written once because two files have to agree on it to the pixel: the screen itself and the
 * loading picture that stands in for it. A skeleton laid out one column wide would hand the reader
 * a full-width list and then take a third of it away the moment the data arrived, which is the
 * horizontal version of the jump a skeleton exists to prevent - and a class string copied into two
 * files is a jump waiting for somebody to change one of them.
 *
 * `minmax(0,1fr)` for the series list so a long series name shrinks its own pane rather than
 * pushing the rail off the row; a fixed `20rem` for the rail so an empty `Due soon` cannot collapse
 * the column; `items-start` so the rail ends at its own last row instead of being stretched to the
 * height of a list that may hold twenty series.
 */
export const RECURRING_PANES =
  'grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]'
