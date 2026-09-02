/**
 * The authenticated shell.
 *
 * Everything here takes its data as props. The loader that produces `ShellData` lives in
 * `src/routes/_app.tsx`; nothing in this directory fetches, so the whole shell can be rendered in a
 * test from a literal and reviewed without a session.
 */

export { AppShell, AppShellFallback } from './app-shell'
export type { AppShellFallbackProps, AppShellProps } from './app-shell'

export { AppHeader } from './app-header'
export type { AppHeaderProps } from './app-header'

export { BrandMark, Wordmark } from './brand-mark'
export type { WordmarkProps } from './brand-mark'

export {
  LOCALE_COOKIE,
  readLocaleCookieValue,
  writeLocaleCookie,
} from './locale-cookie'
export { LocaleSwitcher } from './locale-switcher'

export { MAIN_CONTENT_ID } from './main-content'

export { RouteError } from './route-error'
export type { RouteErrorProps } from './route-error'

export { RoutePending } from './route-pending'
export type { RoutePendingProps } from './route-pending'

export { ThemeMenu } from './theme-menu'

export { UserMenu } from './user-menu'
export type { UserMenuProps } from './user-menu'

export { WorkspaceSwitcher } from './workspace-switcher'
export type { WorkspaceSwitcherProps } from './workspace-switcher'

export type {
  ShellData,
  ShellUser,
  ShellWorkspace,
  WorkspaceRole,
} from './types'
