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

export { AriaI18nProvider } from './aria-i18n'
export { AriaRouterProvider } from './aria-router'

export { BrandMark, Wordmark } from './brand-mark'
export type { WordmarkProps } from './brand-mark'

export { ErrorPanel } from './error-panel'
export type { ErrorPanelProps } from './error-panel'

export { FailurePanel } from './failure-panel'
export type { FailurePanelProps, Recovery } from './failure-panel'

export { FormModal, useIsDirty } from './form-modal'
export type { FormModalProps } from './form-modal'

export {
  LOCALE_COOKIE,
  readLocaleCookieValue,
  switchLocale,
  writeLocaleCookie,
} from './locale-cookie'
export { LocaleSwitcher } from './locale-switcher'

export { MAIN_CONTENT_ID } from './main-content'

export { NotFound } from './not-found'

export { RouteAnnouncer } from './route-announcer'

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
