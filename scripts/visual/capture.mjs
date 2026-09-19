/**
 * Take the frames a blind A/B pair is made of.
 *
 * The neutral capture step of a blind comparison round runs this, and so does anyone checking a
 * visual change by hand (`docs/agents/reference.md`). The script exists so the capture procedure
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
 *     ./anonymous-only.mjs;
 *   - `--enter` takes the one click that a public demo puts between a visitor and the surface worth
 *     photographing, for a reference that no longer sits at a URL of its own. One rule governs it:
 *     the click must be one that NAVIGATES, never one that MUTATES what the next visitor sees. It is
 *     somebody else's shop window — a control that signs up, saves, deletes or submits is not an
 *     entry point and is never what this flag is pointed at.
 *   - `--enter-from` says the entry control lives on a different page from the screen being
 *     photographed. The run lands there, clicks once, and only then asks for `--url` — which is how
 *     a surface deeper than the demo's own front door gets photographed at all, since the session
 *     the click grants exists only inside the context that clicked and does not survive to the next
 *     invocation. Without it, `--url` must itself be the page carrying the control.
 *   - `--force-state loading|error` photographs a state that would otherwise need a slow morning or
 *     a broken server. See {@link forceServerFns} for how, and why it needs `--force-from`.
 *
 * CLEAN ROOM. This script points a browser at a URL and photographs what it paints. That is the
 * whole of its contract with anything that is not ours: it never reads the reference product's DOM,
 * never records its network traffic, and never writes its name into a filename. See
 * `docs/agents/reference.md`.
 *
 * Nothing in this repository compares a screenshot (ADR 0016), and this script is what took the
 * comparison's place: it writes only into the `--out` directory it is given, outside the
 * repository, for a blind critic to look at. A frame it takes is evidence for a human, never an
 * assertion.
 *
 * Usage:
 *   node scripts/visual/capture.mjs \
 *     --url http://localhost:3010/dashboard \
 *     --out .visual-shots/issue-<n> \
 *     --label A \
 *     --viewports 1440x900,360x800 \
 *     --themes light,dark \
 *     [--auth] [--auth empty] [--state hover-row] \
 *     [--hover 'selector'] [--click 'selector'] [--settle 800] \
 *     [--enter 'selector'] [--enter-from https://host/] [--viewport-only] \
 *     [--force-state loading|error] [--force-from http://localhost:3010/accounts]
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

/**
 * Where the Playwright setup project caches its signed-in sessions.
 *
 * `--auth` replays `demo`, the seeded workspace, which is what almost every capture wants. `--auth
 * <name>` replays a different one — `empty` is how an empty state gets photographed at all, since
 * the screens that have one only show it to a workspace with nothing in it.
 */
const AUTH_DIR = 'e2e/.auth'
const DEFAULT_SESSION = 'demo'
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
/**
 * Photograph the viewport instead of the whole document.
 *
 * A full-page frame is the right default for judging a screen's whole composition, and it is the
 * wrong one the moment a product pins chrome to the viewport. `position: fixed` resolves against
 * the viewport, so in a 4000px full-page image a mobile tab bar is not at the bottom - it is
 * stranded a fifth of the way down, cutting through whatever content is behind it.
 *
 * That would merely be ugly if it hit both sides of a pair equally. It does not. A layout that
 * scrolls the document produces a tall frame with the artefact in it; a layout that scrolls an
 * inner container produces a viewport-height frame with its chrome exactly where a visitor sees
 * it. Handed to a blind critic, the pair reads as one product having a broken navigation bar, and
 * the finding is entirely an invention of the shutter.
 *
 * So a comparison at a viewport where either side pins anything is shot viewport-only: identical
 * treatment, and the frame is what a visitor actually arrives at.
 */
const viewportOnly = flag('viewport-only')

/**
 * The state to force, and the page to reach it from. Both or neither.
 *
 * `--force-state` composes with `--state`, and normally should: `--state loading` names what the
 * frame is of, `--force-state loading` is how it was made to happen. They are separate flags
 * because a frame's name is for the reader and the interception is for the browser, and a run
 * photographing an error screen under a filename saying `hover-row` should stay possible to spot.
 */
const forceState =
  typeof opt['force-state'] === 'string' ? opt['force-state'] : undefined
const forceFrom =
  typeof opt['force-from'] === 'string' ? opt['force-from'] : undefined

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
if (
  forceState !== undefined &&
  forceState !== 'loading' &&
  forceState !== 'error'
) {
  console.error("capture: --force-state takes only 'loading' and 'error'")
  process.exit(2)
}
if ((forceState === undefined) !== (forceFrom === undefined)) {
  console.error(
    'capture: --force-state and --force-from go together — the first says which state to force, ' +
      'the second names a page that links to --url, because only a client-side navigation asks ' +
      'the browser for anything an interception can hold.',
  )
  process.exit(2)
}
if (
  forceFrom !== undefined &&
  new URL(forceFrom).origin !== new URL(url).origin
) {
  console.error(
    'capture: --force-from must be on the same origin as --url — the link is clicked inside the ' +
      'running application, not across products.',
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

/**
 * The interception behind `--force-state`, and the three facts it is built on.
 *
 * These four constants are the same ones `e2e/support/states.ts` holds, and they are written twice
 * on purpose: `tsconfig.json` compiles only `.ts`/`.tsx`, so a shared module would either be a
 * `.mjs` this repository's typechecker cannot see or a `.ts` `node scripts/visual/capture.mjs`
 * cannot load. The e2e file is the original — it carries the measurement and the reasoning, and it
 * is the copy a test fails on if any of this stops being true.
 *
 *   1. A `page.goto` produces no `/_serverFn/*` request at all. TanStack Start resolves the loader
 *      during SSR, so the browser is handed a finished document and there is nothing to intercept.
 *      Every forced state therefore needs a CLIENT-SIDE navigation, which is what `--force-from`
 *      is: land on a page that links to the target, install this, then click the link.
 *   2. The application shell's own read is let through. `_app.beforeLoad` awaits the shell, and the
 *      router resolves `beforeLoad` before it will render any match's pending component. Since #230
 *      a client-side navigation answers it from the cache the SSR pass primed, so there is usually
 *      no shell request to see; a stale shell is refreshed behind the navigation, and letting that
 *      refresh through is harmless. Before #230 holding it froze the run one step before the state
 *      it came to photograph, with the previous screen still on the page.
 *   3. The shell is readable from the URL: TanStack Start base64-encodes `{"file":…,"export":…}`
 *      into the path.
 */
const SERVER_FN_PATTERN = '**/_serverFn/**'
const APP_SHELL_MODULE = '/src/routes/_app.tsx'
const INTERNAL_SERVER_ERROR = {
  status: 500,
  contentType: 'application/json',
  body: JSON.stringify({
    error: 'deliberate failure from --force-state error',
  }),
}

/** The module a server-function URL names, or `''` when the path is not one this build wrote. */
function moduleOf(target) {
  const parts = new URL(target).pathname.split('/_serverFn/')
  if (parts.length < 2) return ''
  try {
    return Buffer.from(decodeURIComponent(parts[1]), 'base64').toString('utf8')
  } catch {
    return ''
  }
}

/**
 * Hold every server function open (`loading`) or answer them all `500` (`error`), until released.
 *
 * The returned `release` lets the held requests through, waits for them, and only then unroutes —
 * Playwright throws `Route is already handled!` when a route is removed while its handler is still
 * suspended. It is installed and released once per frame, because each frame re-navigates.
 *
 * A forced `error` run reports console errors in its JSON, and they are real: they are the app
 * reacting to the failure this flag caused. Read them as part of the evidence rather than as a
 * defect — the same messages are declared as `DELIBERATE_SERVER_FAILURE` in `e2e/support/`.
 */
async function forceServerFns(page, mode) {
  let open = () => {}
  const isReleased = new Promise((resolve) => {
    open = resolve
  })
  const started = new Set()

  const handler = (route) => {
    const work = (async () => {
      if (moduleOf(route.request().url()).includes(APP_SHELL_MODULE)) {
        await route.continue().catch(() => {})
        return
      }
      if (mode === 'error') {
        await route.fulfill(INTERNAL_SERVER_ERROR).catch(() => {})
        return
      }
      await isReleased
      await route.continue().catch(() => {})
    })()
    started.add(work)
    return work.finally(() => started.delete(work))
  }

  await page.route(SERVER_FN_PATTERN, handler)

  return async () => {
    open()
    await Promise.allSettled([...started])
    await page.unroute(SERVER_FN_PATTERN, handler)
  }
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

/**
 * The same wait, minus the one that cannot happen while a request is being held.
 *
 * A forced `loading` frame is taken with a request deliberately open, so `networkidle` never
 * arrives — `settle` would spend its full 30s timeout per frame and report nothing for it. There is
 * no document load to wait for either: the navigation was client-side, so the document is the one
 * already on screen. What is left is worth keeping: the fonts, the settle delay, and the scroll.
 */
async function settleForced(page) {
  await page.evaluate(() => document.fonts.ready).catch(() => {})
  await page.waitForTimeout(settleMs)
  await page.evaluate(() => window.scrollTo(0, 0))
}

async function main() {
  // A bare `--auth`, `--auth true` and `--auth demo` mean the same thing; `--auth <name>` picks
  // another cached session. `--auth false` still means no.
  const authArg = opt.auth
  const wantsAuth = authArg !== undefined && authArg !== 'false'
  const session =
    typeof authArg === 'string' && authArg !== 'true'
      ? authArg
      : DEFAULT_SESSION
  if (/[/\\]/.test(session)) {
    console.error('capture: --auth must name a session, not a path')
    process.exit(2)
  }
  const authState = `${AUTH_DIR}/${session}.json`
  const enter = typeof opt.enter === 'string' ? opt.enter : undefined
  const enterFrom =
    typeof opt['enter-from'] === 'string' ? opt['enter-from'] : undefined

  // The two flags belong to opposite sides of the pair. `--auth` replays OUR app's cached session;
  // an entry click is how somebody else's public demo lets an anonymous visitor in. Asking for both
  // in one run means the caller has lost track of which side is being photographed, and either flag
  // aimed at the other side's host does something nobody wants.
  if (enter && wantsAuth) {
    console.error(
      "capture: --enter and --auth cannot be combined. --auth replays our own app's cached " +
        "session; --enter clicks the entry control on somebody else's public demo. One run " +
        'photographs one side — drop whichever flag is not the side of this URL.',
    )
    process.exit(2)
  }

  // `--enter-from` is the entry click and the destination pulled apart. A demo that hands an
  // anonymous visitor a session on one control leaves every other surface reachable by URL, but
  // only from inside the context that clicked - so photographing the third screen in means landing
  // on the door, opening it, and only then asking for the room. Without `--enter` there is no door
  // to open and the flag is a plain redirect with extra steps.
  if (enterFrom && !enter) {
    console.error(
      'capture: --enter-from needs --enter — it names where the entry control lives.',
    )
    process.exit(2)
  }

  // Same reason as `--enter` + `--auth`: `--enter` photographs the other side of the pair, and
  // there is nothing there for an interception of *our* server functions to hold.
  if (forceState && enter) {
    console.error(
      'capture: --force-state and --enter cannot be combined. --force-state drives our own app; ' +
        "--enter opens somebody else's public demo.",
    )
    process.exit(2)
  }

  // Both refusals come before anything is created or launched: once a frame exists there is
  // nothing left downstream to tell a redirect target apart from the product. Which screens are
  // anonymous-only, and why that list is short: ./anonymous-only.mjs.
  const refusal = wantsAuth ? anonymousOnlyRefusal(url) : undefined
  if (refusal) {
    console.error(`capture: ${refusal}`)
    process.exit(2)
  }

  if (wantsAuth && !existsSync(authState)) {
    console.error(
      `capture: --auth was asked for but ${authState} does not exist. ` +
        `Run the Playwright setup project first: pnpm exec playwright test --project=setup`,
    )
    process.exit(2)
  }

  await mkdir(outDir, { recursive: true })

  const browser = await chromium.launch()
  const context = await browser.newContext({
    storageState: wantsAuth ? authState : undefined,
    deviceScaleFactor: 1,
    locale: 'en-GB',
    timezoneId: 'UTC',
  })

  // The clock the Worker reads, pinned to the same day the browser suite pins. Scoped to this origin by
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
  /**
   * An entry control that never appeared is a property of the run, not of one frame.
   *
   * There is no viewport and no theme for which it would suddenly be there, so the run stops at the
   * first miss rather than spending another seven fifteen-second waits on the same answer. No frame
   * is filed: the warning travels in the JSON and the capture is reported as skipped, because this
   * stage is advisory and a photograph of the front door filed under the dashboard's name is worse
   * than no photograph at all.
   */
  let entryMissing = false

  /**
   * The same, for a `--force-from` page that does not link to `--url`.
   *
   * Also a property of the run rather than of one frame: a link that is absent at 1440 light is
   * absent at 360 dark, and the fix is a different `--force-from`, not another wait.
   */
  let forcedLinkMissing = false

  /** Quiesce, apply the interaction flags, check the viewport, and file one frame. */
  async function shoot(vp, theme) {
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
      return
    }

    const name = `${statePrefix}${vp.name}-${theme}-${label}.png`
    const path = `${outDir}/${name}`
    await page.screenshot({
      path,
      fullPage: !viewportOnly,
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
    // hydration, an `--enter` or `--click` that navigates, or a `--force-state` link click — is
    // the URL reported for this frame.
    files.push({
      viewport: vp.name,
      theme,
      landedUrl: page.url(),
      path,
      bytes: size,
    })
  }

  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.w, height: vp.h })
    for (const theme of themes) {
      await page.emulateMedia({ colorScheme: theme })
      await page.goto(forceFrom ?? enterFrom ?? url, {
        waitUntil: 'commit',
        timeout: 45_000,
      })

      // A cached session that has expired does not fail — it redirects, and the frame filed is the
      // login screen. A critic handed that reports the product as having no content at all. Refuse
      // it here, where the fix is one command, rather than downstream where it is a wasted round.
      if (wantsAuth && new URL(page.url()).pathname.startsWith('/login')) {
        throw new Error(
          `--auth was asked for but ${url} redirected to ${page.url()}. The cached session in ` +
            `${authState} is stale or the workspace is unseeded. Refresh it with: ` +
            `PLAYWRIGHT_BASE_URL=${origin} pnpm exec playwright test --project=setup`,
        )
      }

      await settle(page)

      // Exactly one click, and then the same wait the first navigation got, because the click is a
      // navigation: the destination is where every frame of this run is taken. It is not a login,
      // not a form and not a route — a surface two clicks in is a different conversation.
      if (enter) {
        const entered = await page
          .locator(enter)
          .first()
          .click({ timeout: 15_000 })
          .then(
            () => true,
            () => false,
          )
        if (!entered) {
          warnings.push(
            `--enter '${enter}' never appeared on ${url} within 15s — the entry control is gone, ` +
              `renamed, or behind something else; no frame filed`,
          )
          entryMissing = true
          break
        }
        await settle(page)

        // The click bought a session, not a destination. Ask for the screen this run is actually
        // about, in the context that now has one.
        if (enterFrom) {
          await page.goto(url, { waitUntil: 'commit', timeout: 45_000 })
          await settle(page)

          // The click is asynchronous on the far side: a demo provisions a workspace before it
          // hands over a session, and asking for a deep path too early bounces to a sign-in screen
          // that photographs perfectly well. That frame is the most dangerous artefact this script
          // can produce - it is sharp, it is complete, and it is of somebody's front door filed
          // under a feature's name. A critic handed it reports the product as having no screen
          // there at all, which is exactly what happened the first time this ran.
          //
          // The path is the test, not the whole URL: a screen that answers on its own and then
          // appends its default query has not gone anywhere.
          const landed = new URL(page.url()).pathname
          const wanted = new URL(url).pathname
          if (landed !== wanted) {
            warnings.push(
              `${vp.name}-${theme}-${label} asked for ${wanted} and landed on ${landed} - the ` +
                `entry click did not carry a session to this path ` +
                `(a longer --settle usually fixes it); no frame filed`,
            )
            continue
          }
        }
      }

      // `--force-state` is the whole of this branch: get to `--url` the one way that asks the
      // browser for data, with the interception already installed. See {@link forceServerFns}.
      if (forceState) {
        const release = await forceServerFns(page, forceState)
        try {
          const wanted = new URL(url).pathname
          // Inside `main`, and it stays there now that the rail is client-side too (#245). The
          // reason changed rather than expiring: a rail row exists on every screen, so matching it
          // would make `--force-from` meaningless and turn "point --force-from at a page that
          // links there" below into advice for a failure that could no longer happen.
          const link = page.locator(`main a[href="${wanted}"]`).first()
          const clicked = await link.click({ timeout: 15_000 }).then(
            () => true,
            () => false,
          )
          if (!clicked) {
            warnings.push(
              `--force-state ${forceState} found no client-side link to ${wanted} in main on ` +
                `${forceFrom} within 15s — point --force-from at a page that links there; ` +
                `no frame filed`,
            )
            forcedLinkMissing = true
            break
          }
          await settleForced(page)
          await shoot(vp, theme)
        } finally {
          await release()
        }
        continue
      }

      await shoot(vp, theme)
    }
    if (entryMissing || forcedLinkMissing) break
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
