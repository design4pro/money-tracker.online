/**
 * The open backlog's `child → parent` sub-issue edges.
 *
 * Its own module because `main.ts` is a top-level script - importing it runs a whole AFK loop - and
 * this is the part that has to be tested. It shipped broken once for exactly that reason.
 */

import type { SandcastleEdge } from '../src/server/do/sandcastle-protocol'

/**
 * The `gh --jq` filter, and the doubled backslash is the whole point.
 *
 * jq's string interpolation is `\(...)`. `\(` is not a valid escape in a JS string literal, so it
 * collapses to a bare `(` and jq reads the result as literal text: every edge came back as the
 * string `(.number) (.parent.number)`, which survives a two-token split and then fails the
 * registry's issue-id regex. The first claim against any backlog with sub-issues - the normal case
 * for this repo's PRD to vertical-slice workflow - was answered 400, and a 4xx is final, so the run
 * died before it built anything.
 */
export const EDGE_JQ =
  '.[] | select(.parent != null) | "\\(.number) \\(.parent.number)"'

/** The command, assembled here so the filter and its quoting are tested together. */
export const EDGE_COMMAND = `gh issue list --state open --limit 500 --json number,parent --jq '${EDGE_JQ}'`

/**
 * Parse the filter's output.
 *
 * Strict, and loudly so: a line this cannot read means the filter is broken, and dropping it would
 * under-report a closure. That is the one direction that lets two runs collide, so a bad line stops
 * the run instead of shrinking the lock.
 */
export function parseEdgeLines(stdout: string): Array<SandcastleEdge> {
  const edges: Array<SandcastleEdge> = []
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    const pair = trimmed.split(' ')
    if (pair.length !== 2 || !pair.every((id) => /^[1-9][0-9]*$/.test(id))) {
      throw new Error(
        `gh returned an issue edge this run cannot read: ${JSON.stringify(trimmed)}. ` +
          `A partial sub-issue tree under-reports a closure, which is what lets two runs collide.`,
      )
    }
    edges.push({ child: pair[0], parent: pair[1] })
  }
  return edges
}
