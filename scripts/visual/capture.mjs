/**
 * Take the frames a blind A/B pair is made of.
 *
 * The sandcastle loop's neutral capture step runs this — see `.sandcastle/pixel-capture-prompt.md`
 * — and so does anyone checking a visual change by hand. The script exists so the capture procedure
 * is not re-derived from prose by every capture agent: a theme switched the wrong way, a frame shot
 * before the chart finished its entrance, a screen photographed at rest when the thing under
 * judgement was a hover state, and scratch PNGs left at the repository root are all defects of the
 * capture, and every one of them gets reported to the critic as a defect of the product.
 *
 * The seams it closes:
 *
 *   - the theme is selected with `page.emulateMedia({ colorScheme })` and nothing else. Writing
 *     `data-theme` fights the app's own theme script, and driving the app's theme MENU only opens a
 *     dropdown — which is how a half-dark frame comes to be reported as a product defect;
 *   - entrance motion and transitions are stopped before the shutter, so a number is never caught
 *     mid-count-up and text is never caught at 20% opacity;
 *   - `--auth` is refused outright for a screen only a signed-out visitor can see, because the frame
 *     would be of the wrong screen under the right filename. Which screens and why:
 *     ./anonymous-only.mjs.
 *
 * CLEAN ROOM. This script points a browser at a URL and photographs what it paints. That is the
 * whole of its contract with anything that is not ours: it never reads the reference product's DOM,
 * never records its network traffic, and never writes its name into a filename. See
 * `docs/agents/reference.md`.
 *
 * It deliberately does NOT record anything under `e2e/__screenshots__`. Those baselines are compared
 * pixel for pixel across machines and belong to Playwright's own projects; this script writes only
 * into the `--out` directory it is given, for a blind critic to look at.
 *
 * Usage:
 *   node scripts/visual/capture.mjs \
 *     --url http://localhost:3010/dashboard \
 *     --out .sandcastle-shots/issue-<n> \
 *     --label A \
 *     --viewports 1440x900,360x800 \
 *     --themes light,dark \
 *     [--auth] [--state hover-row] \
 *     [--hover 'selector'] [--click 'selector'] [--settle 800]
 *
 * Prints one JSON object on stdout: `{ requestedUrl, files, console, warnings, captureValid }`. Each
 * file records the URL the browser actually landed on, so a redirect the refusal list does not know
 * about — a role-gated route, a screen not yet written — is still visible to whoever reads this.
 * Copy it into your result.
 */

import { existsSync } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

import { chromium } from '@playwright/test'

import { anonymousOnlyRefusal } from './anonymous-only.mjs'

const AUTH_STATE = 'e2e/.auth/demo.json'
const DEV_TOOLBAR = '[data-testid="tanstack_devtools"]'

/**
 * The server-clock header, and the same day `playwright.config.ts` pins the suite to.
 *
 * Every screen in this product picks which rows it shows by comparing a date against the server's
 * own `new Date()` — the dashboard reads the current month, the upcoming rail reads forward from
 * today, a budget bar divides by days elapsed. Without the pin, two frames taken either side of
 * midnight are of different data, and the critic is handed a calendar rollover as a design finding.
 */
const SERVER_TODAY_HEADER = 'x-mt-server-today'
const SERVER_TODAY = process.env.MT_SERVER_TODAY ?? '2026-08-20'

/**
 * Console output that is the toolchain talking, not the application.
 *
 * Narrower than it looks, and anchored on WHERE the message came from rather than on what it says:
 * only a message whose own stack frame is a Vite dev-server namespace is let through. An error the
 * app raises is still fatal even when it quotes one of these word for word.
 *
 * This list is NOT the e2e gate's list. What fails a Playwright run must stay as strict as it is; a
 * dev-client HMR handler cannot reach the gate at all, because the gate does not run one.
 */
const NOT_THE_APP = [
  {
    why: "Vite's dev client and HMR machinery",
    url: /\/@vite\/|\/@react-refresh|\/@id\/|\/@fs\//,
  },
  { why: 'the React DevTools bridge', url: /react[-_]devtools/i },
]

/**
 * The dev server's dependency optimiser has gone stale, which is neither the app's fault nor
 * something to excuse.
 *
 * Excusing it would be worse than failing on it. When `/node_modules/.vite/deps/*` answers 504 the
 * dynamic import of the shell route fails, every `_app` route renders its error boundary, and a
 * capture that swallowed the message would file eight photographs of an error screen as a clean
 * result. So it gets its own verdict: the CAPTURE is invalid, the item is unjudged, and the fix is
 * named.
 */
const TOOLCHAIN_BROKEN = [
  {
    why: 'the Vite dependency optimiser is stale — `rm -rf node_modules/.vite` and restart the dev server, then re-capture. The page renders its error boundary until you do, so any frame taken now is worthless.',
    url: /\/node_modules\/\.vite\/deps\//,
    text: /504|Outdated Optimize Dep/i,
  },
]

function args() {
  const out = {}
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    if (!key.startsWith('--')) continue
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[key.slice(2)] = true
    else {
      out[key.slice(2)] = next
      i++
    }
  }
  return out
}

const opt = args()
const need = (k) => {
  const v = opt[k]
  if (typeof v !== 'string') {
    console.error(`capture: --${k} is required`)
    process.exit(2)
  }
  return v
}
/** A bare `--flag` parses as `true`, an explicit `--flag true` as the string. Both mean yes. */
const flag = (k) => opt[k] === true || opt[k] === 'true'

const url = need('url')
const outDir = resolve(need('out'))
const label = need('label')
const viewports = String(opt.viewports ?? '1440x900,768x1024,360x800,2560x1440')
  .split(',')
  .map((v) => {
    const [w, h] = v.trim().split('x').map(Number)
    return { w, h, name: String(w) }
  })
const themes = String(opt.themes ?? 'light,dark')
  .split(',')
  .map((t) => t.trim())
/**
 * A name for the interaction state these frames are of, prefixed onto every filename.
 *
 * Without it a `--hover` run overwrites the at-rest run's frames, and the critic compares a hover
 * state against a resting one without being able to see that it is doing so.
 */
const statePrefix = typeof opt.state === 'string' ? `${opt.state}-` : ''
const settleMs = Number(opt.settle ?? 600)

if (!Number.isFinite(settleMs) || settleMs < 0) {
  console.error(
    'capture: --settle must be a non-negative number of milliseconds',
  )
  process.exit(2)
}
if (viewports.some((v) => !Number.isFinite(v.w) || !Number.isFinite(v.h))) {
  console.error(
    'capture: --viewports must be a comma-separated list of WxH, e.g. 1440x900,360x800',
  )
  process.exit(2)
}
if (themes.some((t) => t !== 'light' && t !== 'dark')) {
  console.error("capture: --themes takes only 'light' and 'dark'")
  process.exit(2)
}
if (/[/\\]/.test(label) || /[/\\]/.test(statePrefix)) {
  console.error(
    'capture: --label and --state must not contain a path separator',
  )
  process.exit(2)
}

const warnings = []
const consoleMessages = []

/**
 * The verdict a console message earns, and the reason to print beside it.
 *
 * `toolchain-broken` is checked first because it is the stricter verdict: it invalidates the whole
 * capture, where `not-the-app` only excuses one message. Should a message ever match both lists, the
 * order is what stops a stale-optimiser 504 being excused and its error-boundary frames filed as a
 * clean result.
 */
function classify(from, text) {
  const broken = TOOLCHAIN_BROKEN.find(
    (rule) => rule.url.test(from) && rule.text.test(text),
  )
  if (broken) return { verdict: 'toolchain-broken', why: broken.why }

  const excused = NOT_THE_APP.find((rule) => rule.url.test(from))
  if (excused) return { verdict: 'not-the-app', why: excused.why }

  return { verdict: 'fatal', why: undefined }
}

/** Stop entrance motion, and hide tooling that is not the product. */
async function quiesce(page) {
  await page.addStyleTag({
    content:
      '*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}',
  })
  await page.evaluate((sel) => {
    for (const el of document.querySelectorAll(sel)) el.remove()
  }, DEV_TOOLBAR)
}

/**
 * Wait for the frame a reader actually sees.
 *
 * Ordered so each wait is meaningful: the document, then the network, then the fonts — a chart's
 * axis labels reflow when the real face arrives, and a frame taken before that is of a different
 * layout. `networkidle` is allowed to time out rather than fail: a page holding a long-poll open
 * never reaches it, and that is not a reason to file no frame.
 */
async function settle(page) {
  await page.waitForLoadState('domcontentloaded')
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.evaluate(() => document.fonts.ready).catch(() => {})
  await page.waitForTimeout(settleMs)
  await page.evaluate(() => window.scrollTo(0, 0))
}

async function main() {
  const wantsAuth = flag('auth')

  // Both refusals come before anything is created or launched: once a frame exists there is
  // nothing left downstream to tell a redirect target apart from the product. Which screens are
  // anonymous-only, and why that list is short: ./anonymous-only.mjs.
  const refusal = wantsAuth ? anonymousOnlyRefusal(url) : undefined
  if (refusal) {
    console.error(`capture: ${refusal}`)
    process.exit(2)
  }

  if (wantsAuth && !existsSync(AUTH_STATE)) {
    console.error(
      `capture: --auth was asked for but ${AUTH_STATE} does not exist. ` +
        `Run the Playwright setup project first: pnpm exec playwright test --project=setup`,
    )
    process.exit(2)
  }

  await mkdir(outDir, { recursive: true })

  const browser = await chromium.launch()
  const context = await browser.newContext({
    storageState: wantsAuth ? AUTH_STATE : undefined,
    deviceScaleFactor: 1,
    locale: 'en-GB',
    timezoneId: 'UTC',
  })

  // The clock the Worker reads, pinned to the same day as the baselines. Scoped to this origin by
  // hand rather than set context-wide: a custom header on a cross-origin request turns a font or
  // icon fetch into a preflight the third party rejects, and every frame then records the fallback
  // face. The reference host never sees it either, which is the point — it is our own dev-only
  // header and means nothing to anyone else.
  const origin = new URL(url).origin
  await context.route('**/*', async (route) => {
    const target = route.request().url()
    if (!target.startsWith(origin)) return route.continue()
    return route.continue({
      headers: {
        ...route.request().headers(),
        [SERVER_TODAY_HEADER]: SERVER_TODAY,
      },
    })
  })

  const page = await context.newPage()
  page.on('console', (msg) => {
    const type = msg.type()
    if (type !== 'error' && type !== 'warning') return
    const from = msg.location()?.url ?? ''
    const text = msg.text().slice(0, 400)
    consoleMessages.push({ type, text, from, ...classify(from, text) })
  })

  const files = []

  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.w, height: vp.h })
    for (const theme of themes) {
      await page.emulateMedia({ colorScheme: theme })
      await page.goto(url, { waitUntil: 'commit', timeout: 45_000 })

      // A cached session that has expired does not fail — it redirects, and the frame filed is the
      // login screen. A critic handed that reports the product as having no content at all. Refuse
      // it here, where the fix is one command, rather than downstream where it is a wasted round.
      if (wantsAuth && new URL(page.url()).pathname.startsWith('/login')) {
        throw new Error(
          `--auth was asked for but ${url} redirected to ${page.url()}. The cached session in ` +
            `${AUTH_STATE} is stale or the workspace is unseeded. Refresh it with: ` +
            `PLAYWRIGHT_BASE_URL=${origin} pnpm exec playwright test --project=setup`,
        )
      }

      await settle(page)
      await quiesce(page)

      if (typeof opt.hover === 'string') {
        await page.locator(opt.hover).first().hover({ timeout: 15_000 })
        await page.waitForTimeout(settleMs)
      }
      if (typeof opt.click === 'string') {
        await page.locator(opt.click).first().click({ timeout: 15_000 })
        await page.waitForTimeout(settleMs)
      }

      // Read the viewport back. A frame whose measured size is not the one intended sends the
      // critic after a responsive defect that does not exist.
      const measured = await page.evaluate(() => ({
        w: window.innerWidth,
        h: window.innerHeight,
      }))
      if (measured.w !== vp.w) {
        warnings.push(
          `viewport ${vp.w} measured as ${measured.w} — frame not filed`,
        )
        continue
      }

      const name = `${statePrefix}${vp.name}-${theme}-${label}.png`
      const path = `${outDir}/${name}`
      await page.screenshot({
        path,
        fullPage: true,
        animations: 'disabled',
        caret: 'hide',
      })
      const { size } = await stat(path)

      // A flat frame compresses to almost nothing. This is the cheap version of "did the page
      // finish drawing", and on a product made of charts it is the failure worth catching.
      if (size < 15_000 && vp.w >= 768) {
        warnings.push(
          `${name} is ${Math.round(size / 1024)}KB — ` +
            `suspiciously flat for a ${vp.w}px frame, likely shot before the page finished painting`,
        )
      }
      // Read back at the shutter rather than at the response, so a redirect the app makes after
      // hydration — and a `--click` that navigates — is the URL reported for this frame.
      files.push({
        viewport: vp.name,
        theme,
        landedUrl: page.url(),
        path,
        bytes: size,
      })
    }
  }

  await context.close()
  await browser.close()

  const fatal = consoleMessages.filter((m) => m.verdict === 'fatal')
  const excused = consoleMessages.filter((m) => m.verdict === 'not-the-app')
  const broken = consoleMessages.filter((m) => m.verdict === 'toolchain-broken')
  const brokenReasons = [...new Set(broken.map((m) => m.why))]
  console.log(
    JSON.stringify(
      {
        requestedUrl: url,
        files,
        console: {
          fatal: fatal.map(
            (m) => `${m.type}: ${m.text}${m.from ? ` — at ${m.from}` : ''}`,
          ),
          notTheApp: excused.map((m) => `${m.text.slice(0, 120)} (${m.why})`),
          toolchainBroken: brokenReasons,
        },
        warnings,
        captureValid: broken.length === 0,
      },
      null,
      2,
    ),
  )
  if (broken.length) {
    console.error(
      `capture: THESE FRAMES ARE INVALID — ${brokenReasons.join(' ')}`,
    )
    process.exit(2)
  }
}

main().catch((error) => {
  console.error(
    `capture: ${error instanceof Error ? error.message : String(error)}`,
  )
  process.exit(1)
})
