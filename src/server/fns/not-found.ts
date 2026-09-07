/**
 * The one place a repository's "no such row" becomes the router's "not here".
 *
 * ## Why this needs a translation at all
 *
 * `src/server/repos/errors.ts` already classifies the refusal exactly — `NotFoundError` carries
 * `code: 'NOT_FOUND'` — and its header is explicit that the messages it writes are developer-facing
 * and that "customer-facing copy is chosen by the surface from `code`". The router classifies it
 * too, and disagrees about the representation: `notFoundComponent` and the 404 status key off
 * `isNotFound()`, which is true for the plain `{ isNotFound: true }` object `notFound()` returns
 * and for nothing else. A `NotFoundError` is not that object, so before this module a missing id
 * reached the route's `errorComponent` as an unclassified failure: HTTP 500, "try again" over a row
 * that will never come back, and the repository's English sentence rendered inside a Polish panel.
 *
 * ## Why the server function and not the loader
 *
 * The error does not survive the server-function boundary as itself. What a loader catches during a
 * client navigation has been through `JSON`/seroval and arrives as a bare `Error` with a message
 * and no `code`, so `isRepositoryError` cannot answer there. The handler is the last layer that
 * still holds the real instance — and it is also the layer TanStack Start already understands:
 * a `notFound()` thrown from a handler is answered `404` with `{ isNotFound: true }` as the body,
 * and the client fetcher recognises that payload and rethrows it. One throw covers the SSR pass and
 * a client navigation, with no serialization work.
 *
 * ## Why one function rather than seven catches
 *
 * The refusal taxonomy is centralised precisely so a route, a server function and a queue handler
 * describe the same refusal in the same vocabulary. Its translation to a router sentinel is part of
 * that vocabulary, so it is centralised too. `src/routes/api/files/$id.ts` performs the same
 * discrimination for the one non-page endpoint that needed it — a `Response` there, a sentinel
 * here, the same `code` check in both.
 *
 * ## What it deliberately does not do
 *
 * It does not classify anything but `NOT_FOUND`, and it does not carry `data` into the sentinel. A
 * `FORBIDDEN`, a `CONFLICT` or a dropped connection is a real failure and the error panel's "try
 * again" is true advice there, so those leave untouched — as the same object, not a re-wrapped one,
 * because the layers above still switch on `code`. And nothing the repository wrote may travel with
 * the sentinel: the reader's copy is `empty.notFound.*`, resolved in their own locale by the root's
 * `notFoundComponent`.
 *
 * ## The tenant boundary this must not weaken
 *
 * A cross-tenant read is a `NotFoundError` and never a `ForbiddenError`, because a 403 confirms the
 * row exists and turns a guessed id into an oracle. Both ids therefore arrive here as the same
 * error and leave as the same sentinel: an id belonging to another workspace answers exactly what a
 * wholly non-existent one answers. `e2e/not-found.spec.ts` and `e2e/tenant-isolation.spec.ts`
 * compare the two responses rather than asserting each alone.
 */

import { notFound } from '@tanstack/react-router'

import { isRepositoryError } from '#/server/repos/errors'

/**
 * Rethrow `error`, as the router's not-found sentinel when it is a repository `NOT_FOUND`.
 *
 * Never returns. Written to be passed straight to `.catch()` at a call site that reads as one line:
 *
 * ```ts
 * const account = await getAccount(scope, data.accountId).catch(rethrowAsNotFound)
 * ```
 *
 * The `never` return type is what keeps that call site honest — it collapses out of the
 * `Promise<T | never>` `.catch()` produces, so the resolved type is unchanged and a caller cannot
 * accidentally treat a refusal as a row.
 */
export function rethrowAsNotFound(error: unknown): never {
  if (isRepositoryError(error) && error.code === 'NOT_FOUND') {
    throw notFound()
  }
  throw error
}
