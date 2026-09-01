/**
 * Setup for the `ui` Vitest project (jsdom).
 *
 * jsdom has no layout engine, so the browser APIs our motion- and measurement-aware components
 * depend on are stubbed here rather than guarded for in component code. `matchMedia` reports
 * "no preference", which is the branch a default-theme, motion-enabled user takes; a test that
 * cares about reduced motion or dark mode overrides it for itself.
 */

import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

class TestResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

class TestIntersectionObserver implements IntersectionObserver {
  readonly root: Element | null = null
  readonly rootMargin: string = '0px'
  readonly scrollMargin: string = '0px'
  readonly thresholds: ReadonlyArray<number> = [0]
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): Array<IntersectionObserverEntry> {
    return []
  }
}

if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = TestResizeObserver
}

if (!('IntersectionObserver' in globalThis)) {
  globalThis.IntersectionObserver = TestIntersectionObserver
}

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}

// React Testing Library does not auto-clean when `globals` is off.
afterEach(() => {
  cleanup()
})
