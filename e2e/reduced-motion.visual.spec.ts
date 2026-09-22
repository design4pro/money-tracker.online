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
 * red (spec `.ai/specs/2026-09-11-reduced-motion-transform-reset.md`, Phase 2).
 *
 * ## Four assertions per overlay
 *
 * 1. **A frame right after the overlay appears equals one taken a second later.** Motion still
 *    running is the only thing that can make them differ. The frames are compared against each
 *    other inside the run: no stored baseline (ADR 0016) and nothing written into the repository,
 *    so machine speed moves *when* the frames are taken and not what they contain. "Equal" is
 *    pixel for pixel, with {@link RASTER_NOISE} as the only allowance.
 * 2. **Every hooked element on the page computes an identity transform** — pixel identity proves
 *    motion stopped, only the computed transform proves it stopped in the right place.
 * 3. **The overlay itself sits inside a hooked element**, counted, so a renamed or dropped hook turns
 *    this file red instead of letting assertion 2 pass over zero elements.
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

/** How long the second frame waits after the first: far longer than any animation token. */
const SETTLE_MS = 1_000

/**
 * The largest per-channel difference, out of 255, that two frames may show at one pixel.
 *
 * Not a tolerance for motion. Measured while writing this file: on `chromium` a static glyph in the
 * freshly opened modal is sometimes re-rasterised after the first frame, and the two frames then
 * differ at 7 anti-aliased pixels by at most 9 — with every element on the page computing the same
 * style in both. Anything that moves or fades changes a pixel by far more than 16: the smallest
 * entrance in the product, `pop-in`, starts at opacity 0.
 */
const RASTER_NOISE = 16

/**
 * One overlay: the control that opens it, and the element that must appear and detach.
 *
 * The trigger is activated from the keyboard, never by pointer. A click leaves the pointer resting
 * on the page, and the frame pair then records the product catching up with it rather than motion:
 * measured while writing this file, desktop WebKit painted the trigger under the scrim in its
 * pressed colour on the first frame and its hover colour a second later, and `mobile-safari` gave
 * the More sheet's row under the tap point its hover fill only on the second frame.
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

/** `btoa` in slices: the repository's type set has no Node `Buffer#toString('base64')`. */
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  }
  return btoa(binary)
}

/**
 * How many pixels differ between two PNG frames by more than {@link RASTER_NOISE} in any channel.
 *
 * Decoded in the page because the browser is the PNG decoder this suite already has. Both frames go
 * through the same canvas, so whatever colour handling it applies, it applies to both.
 */
async function differingPixels(
  page: Page,
  first: Buffer,
  later: Buffer,
): Promise<number> {
  return page.evaluate(
    async ([a, b, noise]) => {
      const decode = async (base64: string) => {
        const bytes = Uint8Array.from(atob(base64), (char) =>
          char.charCodeAt(0),
        )
        const bitmap = await createImageBitmap(
          new Blob([bytes], { type: 'image/png' }),
        )
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
        const context = canvas.getContext('2d')
        if (context === null) throw new Error('no 2d context to decode a frame')
        context.drawImage(bitmap, 0, 0)
        return context.getImageData(0, 0, bitmap.width, bitmap.height).data
      }
      const [pixelsA, pixelsB] = await Promise.all([decode(a), decode(b)])
      if (pixelsA.length !== pixelsB.length) return Number.POSITIVE_INFINITY
      let differing = 0
      for (let index = 0; index < pixelsA.length; index += 4) {
        for (let channel = 0; channel < 4; channel += 1) {
          const delta = Math.abs(
            (pixelsA[index + channel] ?? 0) - (pixelsB[index + channel] ?? 0),
          )
          if (delta > noise) {
            differing += 1
            break
          }
        }
      }
      return differing
    },
    [toBase64(first), toBase64(later), RASTER_NOISE] as const,
  )
}

/**
 * The transform every hooked element on the page computes, as `none` or as a matrix.
 *
 * Identity is decided with `DOMMatrixReadOnly` rather than by string, because an engine may
 * serialise the identity as `matrix(1, 0, 0, 1, 0, 0)` rather than `none`.
 */
async function hookedTransforms(
  page: Page,
): Promise<Array<{ transform: string; identity: boolean }>> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-motion-transform]')).map(
      (element) => {
        const { transform } = window.getComputedStyle(element)
        return {
          transform,
          identity:
            transform === 'none' || new DOMMatrixReadOnly(transform).isIdentity,
        }
      },
    ),
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
      }, testInfo) => {
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
        // frame - measured on both engines, and desktop WebKit repainted the menu trigger's glyph in
        // its new colour only after the first frame. So the first frame is taken two animation
        // frames in: enough for anything the sweep collapsed to finish, far too short for motion.
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
        const first = await page.screenshot()
        await page.waitForTimeout(SETTLE_MS)
        const later = await page.screenshot()
        const differing = await differingPixels(page, first, later)
        if (differing > 0) {
          // Evidence goes to the test's output directory, never into the repository.
          await testInfo.attach('first-frame', {
            body: first,
            contentType: 'image/png',
          })
          await testInfo.attach('frame-one-second-later', {
            body: later,
            contentType: 'image/png',
          })
        }
        expect(
          differing,
          `pixels that differ between the first frame of ${overlay.name} and one ${SETTLE_MS} ms later: motion was still running`,
        ).toBe(0)

        const hooks = page
          .locator('[data-motion-transform]')
          .filter({ has: element })
        expect(
          await hooks.count(),
          `${overlay.name} is not inside a [data-motion-transform] element; the hook was renamed or dropped`,
        ).toBeGreaterThan(0)
        for (const { transform, identity } of await hookedTransforms(page)) {
          expect(
            identity,
            `a [data-motion-transform] element computes transform: ${transform}`,
          ).toBe(true)
        }

        await page.keyboard.press('Escape')
        await expect(element).not.toBeAttached()
        await expect(hooks).toHaveCount(0)
      })
    }
  })
}
