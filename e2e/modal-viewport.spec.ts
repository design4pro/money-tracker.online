import { expect, test } from './support/console'

import { gotoApp, useLocale } from './support/app'
import { storageStateFor } from './support/session'

import type { Page } from '@playwright/test'

/**
 * A dialog fits the screen it is drawn on, and its body is what scrolls.
 *
 * ## The fault this file exists to catch
 *
 * `placement: 'center'` set no `max-height`, so a form taller than the viewport grew past it and
 * the **scrim** became the scroll container. The scrim centres its child, and a centred flex child
 * cannot be scrolled back to in the block-start direction: the overflow above the top edge has no
 * scroll range mapped to it, so the title, the lead line and the close control are simply gone. On
 * a 470px-tall viewport that was 128px of unreachable panel — the whole `DialogHeader`.
 *
 * `.github/a11y/axe-scan.mjs:229-238` classifies a focused control with all four corners off screen
 * as **WCAG 2.2 §2.4.11 Focus Not Obscured (Minimum), Level AA**. That probe walks routes and never
 * opens an overlay, so the failure lived on the one surface it does not reach. This file is what
 * reaches it.
 *
 * ## Three properties, measured rather than photographed
 *
 * ADR 0016 retired screenshot baselines, and none of these needs a reference image to be true:
 *
 * 1. The panel's bounding box is inside the viewport — and stays inside it after the scrim has been
 *    driven to the end of whatever scroll range it has. That second half is the assertion, not the
 *    first: a scrim that scrolls the panel is exactly how the header left the screen.
 * 2. The title and the submit control are both fully visible with no scrolling.
 * 3. What overflows is `DialogBody`, the element the dialog primitive already reserves focus room
 *    in (§2.4.12).
 *
 * The scrim's raw `scrollHeight` is deliberately **not** asserted to equal its `clientHeight`. A
 * React Aria `Switch` renders its input inside an absolutely positioned, visually hidden span, and
 * `DialogBody` is `position: static`, so that span's containing block is the panel rather than the
 * scroll port and it adds a few pixels of range the reader can neither see nor reach anything with.
 * Asserting against it would fail on a hidden input rather than on a layout.
 *
 * ## Docked placements
 *
 * The bottom sheet (`drawer`) already had a bound — `max-h-[92dvh]` — which is why it behaved while
 * the centred dialog did not. The side drawer (`drawer-end`) did **not**: `h-full` is a height, and
 * its `max-h-none` cancelled the `max-height: inherit` that `Dialog` used to take its bound from, so
 * its body never scrolled either and its content simply spilled past the panel. Both are asserted
 * here — the sheet because the fix edits the cva base it shares with `center`, the side drawer
 * because the same fix repairs it.
 */

test.use({ storageState: storageStateFor('demo') })

/** The panel geometry, and which box in the overlay is actually scrolling. */
interface DialogMeasurement {
  readonly panelTop: number
  readonly panelBottom: number
  readonly viewportHeight: number
  /** Whether the dialog exposes a body with `overflow-y: auto` — the scroll port. */
  readonly hasScrollPort: boolean
  readonly scrollPortOverflows: boolean
  /**
   * The bottom of the `role="dialog"` box itself.
   *
   * A dialog taller than its panel is the docked form of the same fault: `drawer-end` set
   * `max-h-none`, so `Dialog` had no bound to inherit, grew to its content and spilled out of a
   * panel that `overflow: visible` never clipped.
   */
  readonly dialogBottom: number
}

/**
 * Waits for the entrance animation to finish before anything is measured.
 *
 * `toBeVisible` is satisfied on the first frame, and on that frame the bottom sheet is still
 * translated a full panel-height below the fold — a geometry assertion taken there reads a panel
 * outside the viewport and blames the layout for the animation. React Aria's own `data-entering`
 * marker is the signal, and the running-animation check covers the frame between the attribute
 * being dropped and the transform landing.
 */
async function waitForOverlaySettled(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    if (document.querySelector('[data-entering], [data-exiting]') !== null) {
      return false
    }
    const scrim = document.querySelector('[data-scrim]')
    if (scrim === null) return false
    return scrim
      .getAnimations({ subtree: true })
      .every((animation) => animation.playState !== 'running')
  })
}

/**
 * Measures the open dialog from inside the page.
 *
 * The scroll port is found by computed style rather than by class name: the assertion is that *the
 * element the primitive made scrollable* is the one that scrolls, and a selector spelling
 * `overflow-y-auto` would pass on a stylesheet that no longer applies it. It is looked up across the
 * subtree rather than among the dialog's own children because several of these forms wrap their body
 * and footer in a `<form class="contents">`, which is a DOM parent that is not a layout box.
 */
async function measureDialog(page: Page): Promise<DialogMeasurement> {
  await waitForOverlaySettled(page)

  return page.evaluate(() => {
    const dialog = document.querySelector(
      '[role="dialog"], [role="alertdialog"]',
    )
    if (dialog === null) throw new Error('no dialog is open')

    const panel = dialog.parentElement
    if (panel === null) {
      throw new Error('the dialog is not inside a Modal/ModalOverlay pair')
    }

    const scrollPort = Array.from(dialog.querySelectorAll('*')).find(
      (element) => window.getComputedStyle(element).overflowY === 'auto',
    )
    const box = panel.getBoundingClientRect()

    return {
      panelTop: box.top,
      panelBottom: box.bottom,
      viewportHeight: window.innerHeight,
      hasScrollPort: scrollPort !== undefined,
      // One pixel of slack absorbs the sub-pixel rounding a fractional layout leaves behind on an
      // integer property.
      scrollPortOverflows:
        scrollPort !== undefined &&
        scrollPort.scrollHeight - scrollPort.clientHeight > 1,
      dialogBottom: dialog.getBoundingClientRect().bottom,
    }
  })
}

/**
 * The properties every open dialog must have, whatever its placement.
 *
 * The scrim is driven to the end of its range before the second measurement, because the fault is
 * not that the scrim has a range — it is that scrolling that range takes the panel's header off the
 * top of the screen, where no gesture brings it back.
 */
async function expectPanelInsideViewport(page: Page): Promise<void> {
  const atRest = await measureDialog(page)

  expect(
    atRest.dialogBottom,
    'The dialog is taller than the panel it is in, so its content has escaped the box the placement gave it.',
  ).toBeLessThanOrEqual(atRest.panelBottom + 1)

  await page.evaluate(() => {
    document.querySelector('[data-scrim]')?.scrollTo({ top: 1e6 })
  })
  const scrolled = await measureDialog(page)

  for (const [state, measured] of [
    ['at rest', atRest],
    ['after the scrim was scrolled to its end', scrolled],
  ] as const) {
    expect(
      measured.panelTop,
      `${state}: the panel starts above the top of the viewport, which is the part no scroll gesture can reach.`,
    ).toBeGreaterThanOrEqual(-1)
    expect(
      measured.panelBottom,
      `${state}: the panel ends below the bottom of the viewport.`,
    ).toBeLessThanOrEqual(measured.viewportHeight + 1)
  }
}

test.describe('a centred dialog', () => {
  test.describe('on a laptop', () => {
    test.use({ viewport: { width: 1280, height: 720 } })

    test('the accounts form fits the viewport and scrolls its own body', async ({
      page,
      context,
    }) => {
      await useLocale(context, 'en')
      await gotoApp(page, '/accounts')
      await page.getByRole('button', { name: 'New account' }).click()

      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()

      await expectPanelInsideViewport(page)
      await expect(
        dialog.getByRole('heading', { name: 'New account' }),
      ).toBeInViewport({ ratio: 1 })
      await expect(
        dialog.getByRole('button', { name: 'Create', exact: true }),
      ).toBeInViewport({ ratio: 1 })
    })
  })

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 360, height: 640 } })

    test('the accounts form keeps its title and its submit on screen', async ({
      page,
      context,
    }) => {
      await useLocale(context, 'en')
      await gotoApp(page, '/accounts')
      await page.getByRole('button', { name: 'New account' }).click()

      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()

      await expectPanelInsideViewport(page)
      await expect(
        dialog.getByRole('heading', { name: 'New account' }),
      ).toBeInViewport({ ratio: 1 })
      await expect(
        dialog.getByRole('button', { name: 'Create', exact: true }),
      ).toBeInViewport({ ratio: 1 })

      // The longest form in the product at the narrowest supported width: if anything is going to
      // need a scroll port, it is this one, and the port has to be the body.
      const measured = await measureDialog(page)
      expect(
        measured.hasScrollPort,
        'DialogBody is missing its overflow rule.',
      ).toBe(true)
      expect(
        measured.scrollPortOverflows,
        'Nothing scrolled. The accounts form is taller than a 640px phone, so DialogBody should be the box with the overflow.',
      ).toBe(true)
    })

    test('the recurring series form scrolls its body rather than the scrim', async ({
      page,
      context,
    }) => {
      await useLocale(context, 'en')
      await gotoApp(page, '/recurring')
      await page.getByRole('button', { name: 'New series' }).click()

      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()

      await expectPanelInsideViewport(page)
      await expect(
        dialog.getByRole('heading', { name: 'New recurring series' }),
      ).toBeInViewport({ ratio: 1 })
      await expect(
        dialog.getByRole('button', { name: 'Create', exact: true }),
      ).toBeInViewport({ ratio: 1 })

      const measured = await measureDialog(page)
      expect(
        measured.scrollPortOverflows,
        'The longest form in the product did not scroll its body.',
      ).toBe(true)
    })
  })
})

test.describe('a docked drawer keeps behaving', () => {
  test.describe('the transactions filter drawer', () => {
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 360, height: 640 },
    ]) {
      test(`fits the viewport at ${String(viewport.width)}px`, async ({
        page,
        context,
      }) => {
        await page.setViewportSize(viewport)
        await useLocale(context, 'en')
        await gotoApp(page, '/transactions')
        await page.getByRole('button', { name: /^Filters/ }).click()

        const dialog = page.getByRole('dialog')
        await expect(dialog).toBeVisible()

        await expectPanelInsideViewport(page)
        await expect(
          dialog.getByRole('heading', { name: 'Filters' }),
        ).toBeInViewport({ ratio: 1 })
        await expect(
          dialog.getByRole('button', { name: 'Apply', exact: true }),
        ).toBeInViewport({ ratio: 1 })
      })
    }
  })

  test.describe('the bottom-nav More sheet', () => {
    test.use({ viewport: { width: 360, height: 640 } })

    test('fits the viewport', async ({ page, context }) => {
      await useLocale(context, 'en')
      await gotoApp(page, '/dashboard')
      await page.getByRole('button', { name: 'More', exact: true }).click()

      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()

      await expectPanelInsideViewport(page)
      await expect(
        dialog.getByRole('heading', { name: 'More destinations' }),
      ).toBeInViewport({ ratio: 1 })
    })
  })
})

/**
 * The two dialogs that put a `<Form>` between `Dialog` and its parts.
 *
 * Ten of the twelve in-dialog forms carry `className="contents"`, which makes the form a DOM parent
 * that is not a layout box, so `DialogHeader`, `DialogBody` and `DialogFooter` stay direct flex
 * items of the panel's column. These two did not, and under the contract this file asserts that is
 * no longer a cosmetic difference: a `<Form>` is `flex flex-col` with the default automatic minimum
 * size, so it refuses to shrink below its content height. The panel now has a hard cap and nothing
 * in the chain clips, so the form renders straight through the bottom of the rounded box, over the
 * scrim, with no scroll anywhere to bring it back.
 *
 * A landscape phone is the honest viewport for this: it is short enough that a two-field dialog
 * exceeds the cap, and it is a real orientation rather than a contrived one.
 *
 * The group form is the case here; `settings/-ui/invite-dialog` is the other one and is not, because
 * its trigger is `isDisabled={seatsLeft <= 0}` and the demo workspace's plan has no seat to spare, so
 * the dialog cannot be opened at all from the fixture this suite signs in as. It carries the same
 * one-line correction, and the mechanism it depends on is the one measured below.
 */
test.describe('a dialog whose form is its own layout box', () => {
  test.use({ viewport: { width: 740, height: 360 } })

  test('the group form keeps its content inside the panel', async ({
    page,
    context,
  }) => {
    await useLocale(context, 'en')
    await gotoApp(page, '/transactions/groups')
    await page.getByRole('button', { name: 'New group' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    await expectPanelInsideViewport(page)
    await expect(
      dialog.getByRole('heading', { name: 'New group' }),
    ).toBeInViewport({ ratio: 1 })
    await expect(
      dialog.getByRole('button', { name: 'Create', exact: true }),
    ).toBeInViewport({ ratio: 1 })

    // And the overflow has to land in the body, not on the scrim. A form that is its own layout box
    // takes the bound away from `DialogBody`'s `flex-1`, so the port exists and never has anything
    // to do while the panel grows past the screen instead.
    const measured = await measureDialog(page)
    expect(
      measured.scrollPortOverflows,
      'The group form is taller than a 360px-tall viewport, so DialogBody should be the box with the overflow.',
    ).toBe(true)
  })
})
