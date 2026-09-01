import { createServerFn } from '@tanstack/react-start'

/**
 * What the auth screens need to know before they can draw themselves.
 *
 * Two facts, both of which only the server holds:
 *
 * 1. **Which social providers are actually configured.** A "Continue with Google" button on a
 *    deployment with no `GOOGLE_CLIENT_ID` is a button that ends at a Better Auth 400. The
 *    credentials themselves never cross the wire — only the list of provider names does, which is
 *    public knowledge the moment the button is on screen.
 * 2. **Whether this visitor already has a usable session.** Somebody who is signed in and lands on
 *    `/login` (from a bookmark, or the browser's back button after signing in) should be put back
 *    into the product rather than shown a form for an account they are already using.
 */

/** The social providers this product can be configured with. */
export type AuthProvider = 'google' | 'apple'

export interface AuthConfig {
  /** Configured providers, in the order they are offered. Empty on a password-only deployment. */
  readonly providers: ReadonlyArray<AuthProvider>
  /**
   * True only when the session would also satisfy the guarded shell.
   *
   * The stricter reading is deliberate and the looser one is a redirect loop. `src/routes/_app.tsx`
   * sends a visitor here whenever it cannot build a shell — no session, a suspended account, or a
   * session with no workspace membership — and this route sends a signed-in visitor back there.
   * If the two disagreed about what "signed in" means, a reader in the disagreement would be
   * bounced between them until the browser gave up. So this answers the same question `loadShell`
   * asks, with the same guard, rather than a cheaper approximation of it.
   */
  readonly signedIn: boolean
}

export const loadAuthConfig = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AuthConfig> => {
    // Dynamic, for the same reason `src/routes/_app.tsx` does it: these modules lead to
    // `cloudflare:workers` and the D1 schema, and neither may be reachable from the client graph.
    const [{ appleCredentials, googleCredentials }, { getSession }, guards] =
      await Promise.all([
        import('#/server/auth/env'),
        import('#/server/auth/index'),
        import('#/server/auth/guards'),
      ])

    const providers: Array<AuthProvider> = []
    if (googleCredentials() !== null) providers.push('google')
    if (appleCredentials() !== null) providers.push('apple')

    const session = await getSession()
    if (!session || session.user.banned) return { providers, signedIn: false }

    try {
      await guards.requireOrg()
      return { providers, signedIn: true }
    } catch (error) {
      // A signed-in reader with no membership belongs on this screen, not in a loop.
      if (guards.isAuthRequirementError(error)) {
        return { providers, signedIn: false }
      }
      throw error
    }
  },
)
