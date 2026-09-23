import { expect, test } from './support/console'

import { LABELS, gotoApp, useLocale, useTheme } from './support/app'
import { storageStateFor } from './support/session'
import en from '#/lib/i18n/messages/en'

import type { AppTheme } from './support/app'
import type { Locator, Page } from '@playwright/test'

/**
 * Reduced motion leaves every overlay at rest on the first painted frame.
 *
 * `src/styles/tokens.css` answers `prefers-reduced-motion: reduce` twice: the `*` sweep collapses
 * every animation to `0.01ms` and one iteration, and `[data-motion-transform]` resets `transform`
 * on the elements whose transform is owned by an animation and whose resting transform is the
 * identity. Both are stylesheet claims, and this file is what turns them into something that can go
 * red (spec `.ai/specs/implemented/2026-09-11-reduced-motion-transform-reset.md`, Phase 2).
 *
 * ## Four assertions per overlay
 *
 * 1. **Right after the overlay appears nothing is animating, and a second later it has not moved.**
 *    No animation in the document is still running past the sweep's collapse, and the overlay's box
 *    and opacity read the same as they do a second later. Nothing here takes a picture: ADR 0016
 *    keeps every screenshot comparison out of CI, so "at rest" is read from the state that paints
 *    the frame rather than from the frame.
 * 2. **Every hooked element holding the overlay computes an identity transform with its entrance
 *    held at its first keyframe.** Read after the entrance has finished, the transform is `none`
 *    with or without the reset, because nothing else sets one; so the entrance is restarted and
 *    paused at `currentTime` 0, the one instant the reset has anything to override.
 * 3. **The overlay itself sits inside a hooked element that has an entrance to hold**, counted, so a
 *    renamed or dropped hook or entrance turns this file red instead of letting assertion 2 pass
 *    over nothing.
 * 4. **Escape closes the overlay and it detaches.** The sweep collapses durations rather than
 *    killing animation because React Aria unmounts an exiting overlay on `animationend`; an
 *    animation that never ends is a dialog that never closes, and this is the assertion that says so.
 *
 * ## Which overlays, where
 *
 * The centred modal is the **New account** form on every project. The docked sheet is the bottom
 * navigation's **More** sheet on the phone projects — the account form never docks, it is centred at
 * every width (the Phase 1 execution plan, correction 2). The popover is the shell's **Appearance**
 * menu on the desktop projects, where the bottom navigation does not exist.
 *
 * A console error fails the run: `test` comes from `./support/console`.
 */

// `reducedMotion` is a context option this Playwright exposes only through `contextOptions`.
test.use({
  storageState: storageStateFor('demo'),
  contextOptions: { reducedMotion: 'reduce' },
})

const THEMES: readonly AppTheme[] = ['light', 'dark']

/** How long the second reading waits after the first: far longer than any animation token. */
const SETTLE_MS = 1_000

/** The longest an animation the sweep collapsed can last: its `0.01ms`, with room to spare. */
const COLLAPSED_MS = 1

/**
 * One overlay: the control that opens it, and the element that must appear and detach.
 *
 * The trigger is activated from the keyboard, never by pointer. A click leaves the pointer resting
 * on the page, and a hover transition started under it is motion this file did not ask about.
 */
interface Overlay {
  readonly name: string
  readonly trigger: (page: Page) => Locator
  readonly locate: (page: Page) => Locator
}

const MODAL: Overlay = {
  name: 'the New account modal',
  trigger: (page) => page.getByRole('button', { name: LABELS.en.newAccount }),
  locate: (page) => page.getByRole('dialog'),
}

const POPOVER: Overlay = {
  name: 'the Appearance menu popover',
  trigger: (page) => page.getByRole('button', { name: en['app.theme.label'] }),
  locate: (page) => page.getByRole('menu', { name: en['app.theme.label'] }),
}

const SHEET: Overlay = {
  name: 'the bottom-nav More sheet',
  trigger: (page) =>
    page.getByRole('button', { name: en['app.nav.more'], exact: true }),
  locate: (page) => page.getByRole('dialog'),
}

/**
 * Every running animation or transition in the document that the sweep did not collapse.
 *
 * A collapsed one lasts 0.01ms and can still read `running` for the frame it lands on - measured on
 * `chromium`, a colour transition started as focus moves into the modal - but it cannot move
 * anything. Longer than {@link COLLAPSED_MS} is motion the preference failed to stop.
 */
async function motionStillRunning(page: Page): Promise<string[]> {
  return page.evaluate(
    (collapsedMs) =>
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.playState === 'running' &&
            Number(animation.effect?.getComputedTiming().duration) >
              collapsedMs,
        )
        .map((animation) =>
          animation instanceof CSSAnimation
            ? animation.animationName
            : animation instanceof CSSTransition
              ? `transition of ${animation.transitionProperty}`
              : animation.id || 'a script animation',
        ),
    COLLAPSED_MS,
  )
}

/** Where the overlay is and how opaque it is: what a frame would show moving, without the frame. */
async function overlayState(element: Locator) {
  return element.evaluate((node) => {
    const { x, y, width, height } = node.getBoundingClientRect()
    return { x, y, width, height, opacity: getComputedStyle(node).opacity }
  })
}

/**
 * The transform each hooked element computes with its own entrance held at its first keyframe.
 *
 * The entrance is the product's: setting `data-entering` matches the same `data-[entering]:animate-*`
 * class React Aria matched when the overlay opened, and `getAnimations()` hands back the animation
 * that started. Paused at `currentTime` 0 it applies its `from` keyframe — `translateY(8px)
 * scale(0.985)`, `translateY(100%)` — unless the `[data-motion-transform]` reset outranks it. The
 * attribute and the animation are removed again before anything else reads the page.
 *
 * Identity is decided with `DOMMatrixReadOnly` rather than by string, because an engine may
 * serialise the identity as `matrix(1, 0, 0, 1, 0, 0)` rather than `none`.
 */
async function transformsAtFirstKeyframe(
  hooks: Locator,
): Promise<Array<{ entrance: boolean; transform: string; identity: boolean }>> {
  return hooks.evaluateAll((elements) =>
    elements.map((element) => {
      element.setAttribute('data-entering', '')
      const animations = element.getAnimations()
      for (const animation of animations) {
        animation.pause()
        animation.currentTime = 0
      }
      const { transform } = window.getComputedStyle(element)
      for (const animation of animations) animation.cancel()
      element.removeAttribute('data-entering')
      return {
        entrance: animations.length > 0,
        transform,
        identity:
          transform === 'none' || new DOMMatrixReadOnly(transform).isIdentity,
      }
    }),
  )
}

for (const theme of THEMES) {
  test.describe(`reduced motion, ${theme} theme`, () => {
    test.beforeEach(async ({ page, context }) => {
      await useLocale(context, 'en')
      await useTheme(page, theme)
    })

    for (const overlay of [MODAL, POPOVER, SHEET]) {
      test(`${overlay.name} is at rest on its first frame`, async ({
        page,
        isMobile,
      }) => {
        test.skip(
          (overlay === POPOVER && isMobile) || (overlay === SHEET && !isMobile),
          'the popover is proved on the desktop projects, the docked sheet on the phone projects',
        )

        await gotoApp(page, '/accounts')
        // Without the preference every assertion below could pass on a fast machine for the wrong
        // reason, so the emulation is checked rather than trusted.
        expect(
          await page.evaluate(
            () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
          ),
        ).toBe(true)

        await overlay.trigger(page).focus()
        await page.keyboard.press('Enter')
        const element = overlay.locate(page)
        await expect(element).toBeVisible()

        // The sweep shortens every animation and transition to 0.01ms; it does not remove them. A
        // colour transition started by the same state change that opened the overlay is still
        // `running` at `currentTime` 0 when the overlay first becomes visible, and lands on the next
        // frame - measured on both engines. So the first reading is taken two animation frames in:
        // enough for anything the sweep collapsed to finish, far too short for motion.
        await page.evaluate(
          () =>
            new Promise<void>((resolve) => {
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  resolve()
                })
              })
            }),
        )
        expect(
          await motionStillRunning(page),
          `animations still running two frames after ${overlay.name} appeared`,
        ).toEqual([])
        const first = await overlayState(element)
        await page.waitForTimeout(SETTLE_MS)
        expect(
          await overlayState(element),
          `${overlay.name} moved or faded between its first frame and ${SETTLE_MS} ms later`,
        ).toEqual(first)

        const hooks = page
          .locator('[data-motion-transform]')
          .filter({ has: element })
        const held = await transformsAtFirstKeyframe(hooks)
        expect(
          held.filter(({ entrance }) => entrance).length,
          `${overlay.name} is not inside a [data-motion-transform] element with an entrance; the hook or the entrance was renamed or dropped`,
        ).toBeGreaterThan(0)
        for (const { transform, identity } of held) {
          expect(
            identity,
            `a [data-motion-transform] element held at its first keyframe computes transform: ${transform}`,
          ).toBe(true)
        }

        await page.keyboard.press('Escape')
        await expect(element).not.toBeAttached()
        await expect(hooks).toHaveCount(0)
      })
    }
  })
}
