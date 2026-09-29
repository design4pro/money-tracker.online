import { expect, test } from './support/console'

import { gotoApp, useTheme } from './support/app'
import { storageStateFor } from './support/session'
import { badgeVariants } from '#/components/ui/badge'

import type { AppTheme } from './support/app'
import type { Page } from '@playwright/test'

/**
 * Every badge tone wears the pen mark (spec
 * `.ai/specs/implemented/2026-09-20-badge-pen-mark-every-tone.md`, Step 11; ADR 0028).
 *
 * No route renders all eight tones - `accent` has no call site at all - so the tone sheet is built
 * on the landing, which already ships the compiled stylesheet and the one `settled` stamp. Its
 * classes come from `badgeVariants` itself, imported rather than transcribed: `badge.tsx` reaches no
 * `import.meta.glob`, so the reason `desktop-density.spec.ts` quotes its literal does not apply,
 * and a sheet built from a copy would go on passing after the recipe moved.
 *
 * Nothing here takes a picture (ADR 0016). What makes a mark a mark, and a box a box, is read from
 * the computed style the frame is painted from: the word in `ink`, no fill and no visible rule on
 * the element, a run of the tone's own pen on `::before`, the roughened outline only on `settled`.
 * Reverting any one tone to its old `border-*`/`bg-*`/`text-<hue>` recipe turns this file red.
 *
 * The second half walks the landing and the densest surfaces the demo workspace badges, and
 * asserts that no ancestor clips a mark's bleed; the sheet asserts that two marks on one line never
 * overlap theirs.
 *
 * A console error fails the run: `test` comes from `./support/console`.
 */

const TONES = [
  'neutral',
  'accent',
  'brand',
  'positive',
  'negative',
  'warning',
  'info',
  'settled',
] as const

/** The wash each tone paints, as a token. `accent`/`brand` and `neutral`/`info` share one (Q10, Q11). */
const WASH: Readonly<Record<string, string>> = {
  neutral: '--color-pen-neutral',
  accent: '--color-pen-brand',
  brand: '--color-pen-brand',
  positive: '--color-pen-positive',
  negative: '--color-pen-negative',
  warning: '--color-pen-warning',
  info: '--color-pen-info',
  settled: '--color-highlighter',
}

const SIZES = ['sm', 'md'] as const
const THEMES: readonly AppTheme[] = ['light', 'dark']
const VIEWPORTS = [
  { width: 360, height: 800 },
  { width: 1280, height: 900 },
] as const

/** Puts one badge per tone and size on the page, in a row, in the order given. */
async function mountToneSheet(page: Page): Promise<void> {
  const badges = TONES.flatMap((tone) =>
    SIZES.map((size) => ({
      tone,
      size,
      className: badgeVariants({ tone, size }),
    })),
  )
  await page.evaluate((items) => {
    const sheet = document.createElement('div')
    sheet.dataset.toneSheet = ''
    sheet.style.cssText =
      'display:flex;flex-wrap:wrap;align-items:center;padding:16px'
    for (const { tone, size, className } of items) {
      const badge = document.createElement('span')
      badge.className = className
      badge.dataset.tone = tone
      badge.dataset.size = size
      badge.textContent = tone
      sheet.appendChild(badge)
    }
    document.body.insertBefore(sheet, document.body.firstChild)
  }, badges)
}

interface MarkReading {
  readonly tone: string
  readonly size: string
  readonly color: string
  readonly ink: string
  readonly background: string
  readonly borderColor: string
  readonly beforeContent: string
  readonly beforeWash: string
  readonly expectedWash: string
  readonly beforeFilter: string
}

async function readToneSheet(page: Page): Promise<MarkReading[]> {
  return page.evaluate((wash) => {
    // A token resolved the way the browser resolves it, so the comparison is colour to colour
    // rather than a custom property's text to a computed rgb().
    const resolve = (property: string, token: string) => {
      const probe = document.createElement('span')
      probe.style.setProperty(property, `var(${token})`)
      document.body.appendChild(probe)
      const value = getComputedStyle(probe).getPropertyValue(property)
      probe.remove()
      return value
    }
    return [
      ...document.querySelectorAll<HTMLElement>('[data-tone-sheet] > span'),
    ].map((badge) => {
      const own = getComputedStyle(badge)
      const before = getComputedStyle(badge, '::before')
      const tone = badge.dataset.tone ?? ''
      return {
        tone,
        size: badge.dataset.size ?? '',
        color: own.color,
        ink: resolve('color', '--color-ink'),
        background: own.backgroundColor,
        borderColor: own.borderTopColor,
        beforeContent: before.content,
        beforeWash: before.backgroundColor,
        expectedWash: resolve('background-color', wash[tone] ?? ''),
        beforeFilter: before.filter,
      }
    })
  }, WASH)
}

test.describe('the tone sheet', () => {
  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      test(`every tone is the mark at both sizes — ${theme}, ${viewport.width}px`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport)
        await useTheme(page, theme)
        await gotoApp(page, '/')
        await mountToneSheet(page)

        const readings = await readToneSheet(page)
        expect(readings).toHaveLength(TONES.length * SIZES.length)

        for (const reading of readings) {
          const label = `${reading.tone} ${reading.size}`
          // The word is ink in every tone: the hue lives in the wash.
          expect(reading.color, `${label}: word colour`).toBe(reading.ink)
          // No box: no fill and no visible rule on the element itself.
          expect(reading.background, `${label}: fill`).toBe('rgba(0, 0, 0, 0)')
          expect(reading.borderColor, `${label}: rule`).toBe('rgba(0, 0, 0, 0)')
          // A run of the tone's own pen behind the word.
          expect(reading.beforeContent, `${label}: mark`).not.toBe('none')
          expect(reading.beforeWash, `${label}: wash`).toBe(
            reading.expectedWash,
          )
          // The roughened outline stays on the lone stamp; every mark that repeats is flat.
          if (reading.tone === 'settled') {
            expect(reading.beforeFilter, `${label}: outline`).toContain('url(')
          } else {
            expect(reading.beforeFilter, `${label}: outline`).toBe('none')
          }
        }
      })
    }

    test(`two marks on one line never overlap their bleed — ${theme}`, async ({
      page,
    }) => {
      await useTheme(page, theme)
      await gotoApp(page, '/')
      await mountToneSheet(page)

      const overlaps = await page.evaluate(() => {
        const bleed = (badge: Element) => {
          const box = badge.getBoundingClientRect()
          const before = getComputedStyle(badge, '::before')
          // `left`/`right` are the used insets, negative where the run leaves the box.
          return {
            top: box.top,
            start: box.left + parseFloat(before.left),
            end: box.right - parseFloat(before.right),
          }
        }
        const badges = [
          ...document.querySelectorAll('[data-tone-sheet] > span'),
        ].map(bleed)
        const found: string[] = []
        for (let i = 1; i < badges.length; i++) {
          const [previous, current] = [badges[i - 1], badges[i]]
          if (previous === undefined || current === undefined) continue
          if (previous.top !== current.top) continue
          if (current.start <= previous.end) {
            found.push(
              `#${i - 1} ends at ${previous.end}, #${i} starts at ${current.start}`,
            )
          }
        }
        return found
      })

      expect(overlaps).toEqual([])
    })
  }

  test('forced colours draw a one-pixel system rule around every tone', async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    await gotoApp(page, '/')
    await mountToneSheet(page)

    const rules = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>('[data-tone-sheet] > span'),
      ].map((badge) => {
        const style = getComputedStyle(badge)
        return {
          tone: `${badge.dataset.tone} ${badge.dataset.size}`,
          width: style.borderTopWidth,
          style: style.borderTopStyle,
          color: style.borderTopColor,
          text: style.color,
        }
      }),
    )

    for (const rule of rules) {
      expect(rule.width, `${rule.tone}: rule width`).toBe('1px')
      expect(rule.style, `${rule.tone}: rule style`).toBe('solid')
      // `CanvasText`: the same system colour as the word, never transparent.
      expect(rule.color, `${rule.tone}: rule colour`).toBe(rule.text)
      expect(rule.color, `${rule.tone}: rule colour`).not.toBe(
        'rgba(0, 0, 0, 0)',
      )
    }
  })

  for (const viewport of VIEWPORTS) {
    test(`the landing stamp is the control: settled, roughened, unsheared — ${viewport.width}px`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await gotoApp(page, '/')
      const stamp = page.locator('main .mark-pen')
      await expect(stamp).toHaveCount(1)
      await expect(stamp).toBeVisible()
      const reading = await stamp.evaluate((badge) => {
        const probe = document.createElement('span')
        probe.style.backgroundColor = 'var(--color-highlighter)'
        document.body.appendChild(probe)
        const highlighter = getComputedStyle(probe).backgroundColor
        probe.remove()
        const before = getComputedStyle(badge, '::before')
        return {
          wash: before.backgroundColor,
          highlighter,
          filter: before.filter,
        }
      })
      expect(reading.wash).toBe(reading.highlighter)
      expect(reading.filter).toContain('url(')
      expect(await shearedMarks(page)).toEqual([])
    })
  }
})

/**
 * Every visible mark in `main` whose bleed an ancestor clips, described; empty when none is.
 *
 * An ancestor clips when its `overflow` is anything but `visible`. A scroller clips at the edges of
 * what it can scroll to rather than at its viewport, so a badge scrolled out of a wide table is not
 * a sheared one. The bleed is read from the used `::before` insets, negative where the run leaves
 * the box.
 */
async function shearedMarks(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const sheared: string[] = []
    const marks = [...document.querySelectorAll('main .mark-pen')].filter(
      (el) => el.getClientRects().length > 0,
    )
    for (const badge of marks) {
      const own = badge.getBoundingClientRect()
      const before = getComputedStyle(badge, '::before')
      const start = own.left + parseFloat(before.left)
      const end = own.right - parseFloat(before.right)
      for (
        let ancestor = badge.parentElement;
        ancestor && ancestor !== document.body;
        ancestor = ancestor.parentElement
      ) {
        const style = getComputedStyle(ancestor)
        if (style.overflowX === 'visible') continue
        const box = ancestor.getBoundingClientRect()
        const scrolls =
          style.overflowX === 'auto' || style.overflowX === 'scroll'
        const clip = scrolls
          ? {
              left: box.left - ancestor.scrollLeft,
              right: box.left - ancestor.scrollLeft + ancestor.scrollWidth,
            }
          : box
        // Half a pixel of rounding on either side.
        if (start < clip.left - 0.5 || end > clip.right + 0.5) {
          sheared.push(
            `"${badge.textContent}" bleeds ${start.toFixed(1)}-${end.toFixed(1)}, ` +
              `clipped by <${ancestor.tagName.toLowerCase()} class="${ancestor.className}"> ` +
              `at ${clip.left.toFixed(1)}-${clip.right.toFixed(1)}`,
          )
          break
        }
      }
    }
    return sheared
  })
}

/**
 * The densest surfaces the demo workspace badges: a table row and a tree row. Each must show at
 * least one mark at the widths listed, so a surface that stops rendering badges turns this red
 * rather than letting it pass over nothing. The category tree hides its kind badge below `sm`.
 */
const SURFACES = [
  { route: '/recurring', widths: [360, 1280] },
  { route: '/categories', widths: [1280] },
] as const

test.describe('marks in place', () => {
  test.use({ storageState: storageStateFor('demo') })

  for (const { route, widths } of SURFACES) {
    for (const viewport of VIEWPORTS.filter((v) =>
      (widths as readonly number[]).includes(v.width),
    )) {
      test(`no row or cell shears a mark on ${route} — ${viewport.width}px`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport)
        await gotoApp(page, route)
        await expect(
          page.locator('main .mark-pen:visible').first(),
        ).toBeVisible()
        expect(await shearedMarks(page)).toEqual([])
      })
    }
  }
})
