import {
  CatchBoundary,
  Outlet,
  createFileRoute,
  redirect,
  useRouterState,
} from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

import {
  AppShell,
  AppShellFallback,
  RouteError,
  RoutePending,
} from '#/components/app/shell'
import { shellQueryOptions } from '#/components/app/shell/shell-query'

import type {
  ShellData,
  ShellWorkspace,
  WorkspaceRole,
} from '#/components/app/shell'

/**
 * The guarded layout: every screen that needs a session and a workspace is a child of this route.
 *
 * ## `beforeLoad` is UX, never a data boundary
 *
 * The redirect below stops an anonymous visitor from seeing an empty product. It stops nothing
 * else. Every server function underneath calls `requireOrg()` for itself and resolves its own
 * tenant scope, because this guard runs in a *router* — the client half of which an attacker owns
 * outright. The belief that a guarded-looking layout protects the data below it is the single most
 * common way an application of this shape leaks, so it is written here rather than assumed.
 *
 * ## One resolution, not four
 *
 * `loadShell` answers the four questions every guarded screen asks — who, which workspace, what
 * role, which other workspaces — in one request, and the result is put on the router context so no
 * screen below refetches it. It is cached through the router's own query client so a burst of
 * navigations costs one round trip rather than one each; the window is deliberately short, because
 * a shell built from a session that has since been revoked is a shell whose every data call is
 * about to fail, and the reader should find that out from the sign-in screen rather than from a
 * page of error panels.
 */

/**
 * Better Auth's organization endpoints, as the one call this route makes to them.
 *
 * `Auth` in `src/server/auth/config.ts` is `ReturnType<typeof betterAuth>` over options annotated
 * as the wide `BetterAuthOptions`, which is what keeps that module readable — and what erases the
 * organization plugin's endpoints from the type while leaving them present at runtime. Narrowing
 * the API handle here is the same boundary cast `getSession` makes one module over: an unknown
 * external shape becomes a checked internal one at the point it crosses in. The cast is on the
 * *handle* only. Every field of every row it returns is re-validated by {@link asWorkspace}, so a
 * dependency that changes its payload produces an empty switcher rather than `undefined` on screen.
 */
interface OrganizationApi {
  listOrganizations: (input: { headers: Headers }) => Promise<unknown>
}

function asWorkspace(raw: unknown): ShellWorkspace | null {
  if (typeof raw !== 'object' || raw === null) return null
  const candidate = raw as Record<string, unknown>
  if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') {
    return null
  }
  return {
    id: candidate.id,
    name: candidate.name,
    slug: typeof candidate.slug === 'string' ? candidate.slug : candidate.id,
    logo: typeof candidate.logo === 'string' ? candidate.logo : null,
  }
}

/**
 * The session, the workspace and the membership, resolved on the server.
 *
 * `null` means "not signed in, or signed in with nothing this shell can render" — a suspended
 * account, or one whose membership has been removed. All of those end at the sign-in screen, which
 * is the one surface that can explain the difference; distinguishing them here would only produce a
 * redirect loop between a layout that refuses and a login screen that thinks you are signed in.
 *
 * The server modules are reached with **dynamic** imports for the same reason `src/server/auth/
 * guards.ts` does it: they lead to `cloudflare:workers` and to the D1 schema, and keeping them out
 * of this module's static graph means nothing about them can be dragged into the browser bundle by
 * a future refactor of the compiler's function splitting.
 */
const loadShell = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ShellData | null> => {
    const [{ getAuth, getSession }, { requireOrg, isAuthRequirementError }] =
      await Promise.all([
        import('#/server/auth/index'),
        import('#/server/auth/guards'),
      ])
    const { getRequest } = await import('@tanstack/react-start/server')

    const session = await getSession()
    if (!session || session.user.banned) return null

    try {
      // The scope is the authority on both the workspace and the role: it re-reads the `member`
      // row rather than trusting the session's claim, so a member demoted a minute ago sees the
      // member's chrome now and not at their next sign-in.
      const scope = await requireOrg()

      const api = getAuth().api as unknown as OrganizationApi
      const listed = await api.listOrganizations({
        headers: getRequest().headers,
      })

      const workspaces = (Array.isArray(listed) ? listed : [])
        .map(asWorkspace)
        .filter((workspace): workspace is ShellWorkspace => workspace !== null)

      const active = workspaces.find(
        (workspace) => workspace.id === scope.ctx.organizationId,
      )
      // The membership exists — `requireOrg` just proved it — so a workspace missing from the list
      // is a listing that lagged, not an absent workspace. Fall back to the scope's own id rather
      // than signing a legitimate reader out.
      const workspace: ShellWorkspace = active ?? {
        id: scope.ctx.organizationId,
        name: session.user.name,
        slug: scope.ctx.organizationId,
        logo: null,
      }

      return {
        user: {
          id: session.user.id,
          name: session.user.name,
          email: session.user.email,
          image: session.user.image,
        },
        workspace,
        role: scope.ctx.role satisfies WorkspaceRole,
        workspaces: active ? workspaces : [workspace, ...workspaces],
      }
    } catch (error) {
      if (isAuthRequirementError(error)) return null
      throw error
    }
  },
)

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
    const shell = await context.queryClient.ensureQueryData(
      shellQueryOptions({ queryFn: () => loadShell() }),
    )

    if (!shell) {
      // `location.href` is path + search + hash, which is exactly what the sign-in screen's
      // `safeRedirect` expects and exactly what it refuses to accept from anywhere else.
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }

    return { shell }
  },

  /**
   * Shown while the guard above is in flight. It is the shell's geometry with a content skeleton
   * in it, not a spinner: the reader sees the page they are about to get, at the size they are
   * about to get it, so nothing moves when it arrives.
   */
  pendingComponent: () => (
    <AppShellFallback>
      <RoutePending />
    </AppShellFallback>
  ),

  /**
   * Reached only when the guard itself failed — the session could not be resolved at all. There is
   * no shell to render around the message in that case, so the fallback frame carries it. A failure
   * *below* this route is caught by the boundary inside {@link AppLayout}, which keeps the real
   * shell on screen.
   */
  errorComponent: ({ reset }) => (
    <AppShellFallback>
      <RouteError onRetry={reset} />
    </AppShellFallback>
  ),

  component: AppLayout,
})

function AppLayout() {
  const { shell } = Route.useRouteContext()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  return (
    <AppShell shell={shell} pathname={pathname}>
      {/*
        The boundary is *inside* the shell on purpose. A route that throws should cost the reader
        that route, not the product: the rail, the workspace switcher and the sign-out control all
        stay usable, so somebody whose reports page failed can still reach their accounts.
        `getResetKey` is the pathname, so navigating away clears the error rather than carrying it
        to the next screen.
      */}
      <CatchBoundary
        getResetKey={() => pathname}
        errorComponent={({ reset }) => <RouteError onRetry={reset} />}
      >
        <Outlet />
      </CatchBoundary>
    </AppShell>
  )
}
