/**
 * The Start instance.
 *
 * It exists as its own module because `tsr.config.json` registers its options type onto
 * `@tanstack/react-start`'s `Register` interface from the generated route tree, and because it is
 * where global server-function middleware is registered. There is one: the failure redaction
 * boundary, which every `createServerFn` call site runs behind. Registering it here rather than per
 * call site is the whole reason this seam exists - "a diagnostic never reaches the browser" has to
 * be true in one place, not in every handler, and a function added tomorrow cannot forget it.
 * Global function middleware runs before a function's own, so the boundary also wraps the auth
 * guards. It covers server functions only; see the header of `#/server/errors/middleware`.
 * Request middleware rejects cross-site server-function calls before those handlers run.
 *
 * The other entry is the serialization adapter that carries the boundary's envelope to the browser:
 * the framework's default plugin writes only the `message` of an `Error`, so without it the envelope
 * would stop at the server. It is consulted before the default plugins and matches one class.
 */

import { createCsrfMiddleware, createStart } from '@tanstack/react-start'

import { publicFailureAdapter } from '#/lib/public-failure'
import { failureRedactionMiddleware } from '#/server/errors/middleware'

export const startInstance = createStart(() => ({
  requestMiddleware: [
    createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === 'serverFn' }),
  ],
  functionMiddleware: [failureRedactionMiddleware],
  serializationAdapters: [publicFailureAdapter],
}))
