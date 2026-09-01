/**
 * The Start instance.
 *
 * It exists as its own module because `tsr.config.json` registers its options type onto
 * `@tanstack/react-start`'s `Register` interface from the generated route tree, and because it is
 * where global server-function middleware is registered when there is any. There is none yet:
 * the redaction boundary that every `createServerFn` call site will run behind belongs with the
 * error layer, which lands with the finance domain. Registering it here rather than per call site
 * is the whole reason this seam is created up front — "a diagnostic never reaches the browser"
 * has to be true in one place, not in every handler.
 */

import { createStart } from '@tanstack/react-start'

export const startInstance = createStart(() => ({}))
