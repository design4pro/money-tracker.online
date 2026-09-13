/**
 * Who to blame when a navigation does not finish.
 *
 * A `page.goto` that times out says one thing — `Timeout 20000ms exceeded` — for two situations a
 * reader has to tell apart: the application is broken or slow, or the browser has lost its route to
 * an application that is answering perfectly well. The second one has happened in CI, and the cost
 * of the ambiguity is on the record: #83 read a wall of these on run 34144653183 and concluded the
 * preview server never came up, when the server log for that run shows every one of its 4288
 * requests answered, none of them 5xx, and the last one `GET /dashboard 200 OK (51ms)`. The wedged
 * navigations produced no server-side record at all — the browser started one request per test and
 * never got a byte back, while the same server kept answering anything else that asked.
 *
 * So the suite asks the question itself, once, at the moment the navigation gives up: is the server
 * answering this very path right now? The answer goes on the end of the timeout message, which
 * turns twenty identical errors into twenty errors that name the culprit.
 *
 * Nothing here imports Playwright — the same split `./console-policy.ts` makes, and for the same
 * reason: the wording is the part worth pinning, and pinning it in the vitest `tooling` project is
 * faster and more honest than discovering a broken diagnostic during the outage it exists for.
 */

/** What a direct request to the path found, made after the browser's navigation had given up. */
export type ServerProbe =
  /** The server answered. `status` is the HTTP status, `durationMs` how long it took. */
  | {
      readonly answered: true
      readonly status: number
      readonly durationMs: number
    }
  /** The server did not answer. `reason` is the transport error, already trimmed to one line. */
  | { readonly answered: false; readonly reason: string }

/** The ticket that owns this signature, so a reader lands on the evidence rather than on a guess. */
const TICKET = 'https://github.com/design4pro/money-tracker.online/issues/189'

/**
 * The sentence appended to a navigation failure, given what the probe found.
 *
 * Both branches are deliberately blunt about *what was measured* rather than about what to do:
 * the probe distinguishes the two situations and says which one it saw, and the reader decides.
 * It never softens the original error — the caller appends this, it does not replace anything.
 */
export function describeNavigationFailure(
  path: string,
  probe: ServerProbe,
): string {
  if (probe.answered) {
    return (
      `The navigation to \`${path}\` never finished, but the server answered the same path ` +
      `directly, outside the page, moments later: HTTP ${String(probe.status)} in ` +
      `${String(probe.durationMs)}ms. The application is up and is not the slow party — what ` +
      `failed is the browser's access to it. Do not read this as a product defect; see ${TICKET}.`
    )
  }

  return (
    `The navigation to \`${path}\` never finished, and the server did not answer the same path ` +
    `directly either: ${probe.reason}. The application itself is unreachable, so every test ` +
    `after this one will fail the same way. See ${TICKET}.`
  )
}
