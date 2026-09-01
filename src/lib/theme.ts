import { useCallback, useSyncExternalStore } from 'react'

/**
 * Light / dark / system, applied without a flash on first paint.
 *
 * The token layer already handles "follow the OS" in pure CSS: every colour is
 * declared under `@media (prefers-color-scheme: dark)` guarded by
 * `:root:not([data-theme="light"])`. So `system` is expressed by *removing* the
 * `data-theme` attribute rather than by setting it — the browser then resolves
 * the palette before a single byte of JavaScript runs, which is the only way to
 * make the system case flash-free for a user with JS still in flight.
 *
 * The two explicit modes need an attribute, and therefore need the inline
 * bootstrap below.
 */
export type ThemeMode = 'light' | 'dark' | 'system'

/** What the user actually sees once `system` has been resolved. */
export type ResolvedTheme = 'light' | 'dark'

export interface ThemeState {
  readonly mode: ThemeMode
  readonly resolved: ResolvedTheme
}

export const THEME_STORAGE_KEY = 'money-tracker.theme'

export const THEME_MODES: ReadonlyArray<ThemeMode> = ['light', 'dark', 'system']

const DARK_QUERY = '(prefers-color-scheme: dark)'

/**
 * Runs synchronously in `<head>`, before the first paint, so the correct
 * palette is committed with the very first frame — no flash of the wrong
 * theme, no layout shift, no hydration mismatch.
 *
 * Deliberately tiny and dependency-free, and it must never throw: reading
 * `localStorage` is itself a security error in Safari private browsing and in
 * any browser configured to block site data, and an exception here would abort
 * the whole inline script and leave `<html>` unstyled.
 *
 * `colorScheme` is set alongside the attribute so form controls, scrollbars and
 * the canvas the browser paints behind the document all switch in the same
 * frame as our own tokens.
 */
export const themeBootstrapScript = `(function(){try{var m=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(m==="dark"||m==="light"){var r=document.documentElement;r.setAttribute("data-theme",m);r.style.colorScheme=m}}catch(e){}})();`

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system'
}

/**
 * Stable identity, so `useSyncExternalStore` does not loop during hydration and
 * the server render is deterministic. The server cannot know the OS preference,
 * and guessing would produce exactly the mismatch the bootstrap script exists to
 * avoid, so it reports the neutral case and the client corrects it after mount.
 */
const SERVER_STATE: ThemeState = { mode: 'system', resolved: 'light' }

let state: ThemeState = SERVER_STATE
let started = false

const listeners = new Set<() => void>()

function readSystemTheme(): ResolvedTheme {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return 'light'
  }
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

function readStoredMode(): ThemeMode {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isThemeMode(raw) ? raw : 'system'
  } catch {
    // Storage unavailable (private browsing, blocked site data). The session
    // still works; the preference simply will not survive a reload.
    return 'system'
  }
}

function resolve(mode: ThemeMode): ThemeState {
  return { mode, resolved: mode === 'system' ? readSystemTheme() : mode }
}

function applyToDocument(next: ThemeState): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (next.mode === 'system') {
    root.removeAttribute('data-theme')
    root.style.colorScheme = 'light dark'
  } else {
    root.setAttribute('data-theme', next.mode)
    root.style.colorScheme = next.mode
  }
}

function emit(): void {
  for (const listener of listeners) listener()
}

function commit(next: ThemeState): void {
  if (next.mode === state.mode && next.resolved === state.resolved) return
  state = next
  emit()
}

function handleSystemChange(): void {
  if (state.mode !== 'system') return
  commit(resolve('system'))
}

/** Keeps two tabs of the app in step when the preference changes in one of them. */
function handleStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== THEME_STORAGE_KEY) return
  const next = resolve(readStoredMode())
  applyToDocument(next)
  commit(next)
}

/**
 * Idempotent client bootstrap, called from `subscribe` — that is, after
 * hydration — so the first client render still matches the server markup
 * exactly and React never reports a mismatch.
 */
function start(): void {
  if (started || typeof window === 'undefined') return
  started = true
  state = resolve(readStoredMode())
  applyToDocument(state)
  window.matchMedia(DARK_QUERY).addEventListener('change', handleSystemChange)
  window.addEventListener('storage', handleStorage)
}

function subscribe(listener: () => void): () => void {
  start()
  listeners.add(listener)
  // The bootstrap above may already have moved us off the server snapshot.
  listener()
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): ThemeState {
  return state
}

function getServerSnapshot(): ThemeState {
  return SERVER_STATE
}

/** Persist and apply a theme choice. Safe to call from an event handler. */
export function setThemeMode(mode: ThemeMode): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode)
  } catch {
    // See readStoredMode: the choice applies to this session regardless.
  }
  const next = resolve(mode)
  applyToDocument(next)
  commit(next)
}

/** Read the current theme without subscribing — useful outside React. */
export function getThemeState(): ThemeState {
  return state
}

export interface UseThemeResult extends ThemeState {
  setMode: (mode: ThemeMode) => void
  /** Flip to the opposite of what is currently on screen. */
  toggle: () => void
}

export function useTheme(): UseThemeResult {
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  )

  const setMode = useCallback((mode: ThemeMode) => {
    setThemeMode(mode)
  }, [])

  const toggle = useCallback(() => {
    setThemeMode(getThemeState().resolved === 'dark' ? 'light' : 'dark')
  }, [])

  return {
    mode: snapshot.mode,
    resolved: snapshot.resolved,
    setMode,
    toggle,
  }
}

/**
 * Test-only reset. The module keeps process-wide state so that every consumer
 * reads one theme; a test file that renders twice needs a way back to the
 * server snapshot without reloading the module registry.
 */
export function resetThemeForTests(): void {
  started = false
  state = SERVER_STATE
  listeners.clear()
}
