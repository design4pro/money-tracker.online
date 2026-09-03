#!/usr/bin/env node
/**
 * The accessibility gate.
 *
 * Walks every route in `.github/a11y/routes.json` and runs two passes over each one:
 *
 *   1. The gate. axe-core restricted to the WCAG 2.2 A and AA rule sets, at desktop width, in
 *      both colour schemes. Any violation fails the build. Dark mode is not optional here: it
 *      is where contrast regressions actually happen, and a light-only scan is a scan of half
 *      the product.
 *
 *   2. The advisory pass. The named AAA criteria this product holds itself to, at mobile width:
 *      2.5.5 target size (44px), 2.4.11/2.4.12 focus not obscured, 1.4.8 visual presentation,
 *      2.2.6 timeouts, 3.3.9 accessible authentication (enhanced) - plus axe's own AAA-tagged
 *      rules, which is where 1.4.6 enhanced contrast (7:1) is measured. None of this fails the
 *      build. It is reported so a regression is visible while it is still cheap, and so the
 *      claim we make internally has evidence behind it.
 *
 * The distinction is deliberate and it is a promise about our marketing copy: AA is the hard
 * gate, the AAA criteria above are a named list we hold ourselves to, and neither adds up to a
 * blanket "WCAG 2.2 AAA compliant" claim.
 *
 * Four of the five AAA probes are heuristics rather than proofs - a machine cannot see whether a
 * 32px icon button is "in a sentence" or whether a session warning is adjustable - so they are
 * advisory by construction, not by leniency. 2.2.6 cannot be automated at all and says so.
 *
 * Usage:  node .github/a11y/axe-scan.mjs
 * Env:    A11Y_BASE_URL (or PLAYWRIGHT_BASE_URL)  default http://localhost:3010
 *         A11Y_OUT_DIR                            default a11y-report
 *         A11Y_USER_EMAIL / A11Y_USER_PASSWORD    the seeded demo account
 *         A11Y_THEMES                             default light,dark
 * Exit:   0 when no A/AA violation was found, 1 otherwise (2 on a setup failure).
 */

import { chromium } from '@playwright/test'
import axePlaywright from '@axe-core/playwright'
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

// The package is CommonJS and publishes the builder as both a default and a named export;
// which one a plain .mjs import resolves to depends on the interop path, so accept either.
const AxeBuilder =
  axePlaywright.default ?? axePlaywright.AxeBuilder ?? axePlaywright

const BASE_URL = (
  process.env.A11Y_BASE_URL ??
  process.env.PLAYWRIGHT_BASE_URL ??
  'http://localhost:3010'
).replace(/\/$/, '')
const OUT_DIR = process.env.A11Y_OUT_DIR ?? 'a11y-report'
// `||`, not `??`: an unset GitHub variable arrives as an empty string, and falling through to the
// seed's own default is what makes the workflow run on a fork that has configured nothing.
//
// Both defaults are copies of `scripts/seed/seed.mjs`, and copies drift: the password here read
// `demo-password-1234` while the seed wrote `money-demo-2026`, so sign-in answered 403 and this
// gate failed on every run from the day it was added - on `develop` too - without auditing a
// single page. A gate that always fails stops being read, which is why three days passed; and a
// scan that never ran reports the same red as a scan that found a violation. If you change either
// literal, change it in the seed and here, or the next reader inherits the same silence.
const EMAIL = process.env.A11Y_USER_EMAIL || 'demo@money-tracker.online'
const PASSWORD = process.env.A11Y_USER_PASSWORD || 'money-demo-2026'
const THEMES = (process.env.A11Y_THEMES ?? 'light,dark')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean)

const DESKTOP = { width: 1440, height: 900 }
const MOBILE = { width: 393, height: 852 }

/**
 * The same clock pin `playwright.config.ts` sends, for the same reason: the dashboard, the
 * upcoming rail and the budget bars all pick their rows by comparing a fixture date against the
 * server's own `new Date()`, so an unpinned scan looks at a different page every day. Honoured
 * only under `import.meta.env.DEV`, so it is inert against anything but a dev server.
 */
const CLOCK_PIN = { 'x-mt-server-today': '2026-08-20' }

/**
 * axe tags for the gate. `wcag22a` carries no rules today (2.2 added no level-A criterion axe
 * can test) and is listed anyway, so a future axe release starts failing us without an edit here.
 */
const GATE_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22a',
  'wcag22aa',
]
const ADVISORY_TAGS = ['wcag2aaa', 'wcag21aaa', 'wcag22aaa']

/** Every finding, gate and advisory alike, in one flat list. */
const findings = []
/** One entry per page actually visited, so the report can prove what was covered. */
const visited = []

const record = (f) => findings.push(f)

// ─── the page probes ─────────────────────────────────────────────────────────────────────────
// Everything below `probePage` runs inside the browser. It is one function rather than five so
// that a page is walked once, and it returns plain data so nothing crosses the boundary but JSON.

/* c8 ignore start - executed in the page, not in this process */
function probePage({ isAuthForm }) {
  const INTERACTIVE = [
    'a[href]',
    'button',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    'summary',
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="menuitemcheckbox"]',
    '[role="menuitemradio"]',
    '[role="option"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(', ')

  const out = []

  const visible = (el) => {
    const cs = getComputedStyle(el)
    if (
      cs.display === 'none' ||
      cs.visibility === 'hidden' ||
      Number(cs.opacity) === 0
    ) {
      return false
    }
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }

  const disabled = (el) =>
    el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true'

  /** A short, human-readable pointer. Not a stable selector - a label for a report. */
  const label = (el) => {
    const id = el.id ? `#${el.id}` : ''
    const cls = el.classList.length
      ? `.${[...el.classList].slice(0, 2).join('.')}`
      : ''
    const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)
    return `${el.tagName.toLowerCase()}${id}${cls}${text ? ` "${text}"` : ''}`
  }

  const push = (criterion, summary, el, detail) =>
    out.push({ criterion, summary, target: label(el), detail })

  // ── 2.5.5 Target Size (Enhanced) - 44 CSS px on the smaller edge ───────────────────────────
  // The standard's exceptions that can be detected are honoured: an inline control sitting
  // inside a longer run of text (the "in sentence" exception), and anything the source has
  // explicitly marked essential with data-a11y-target-exempt.
  const seenTargets = new Set()
  for (const el of document.querySelectorAll(INTERACTIVE)) {
    if (!visible(el) || disabled(el)) continue
    if (el.closest('[data-a11y-target-exempt]')) continue

    const cs = getComputedStyle(el)
    const sentence = el.closest('p, li, dd, blockquote, td, figcaption')
    const ownText = (el.textContent ?? '').trim().length
    const hostText = sentence ? (sentence.textContent ?? '').trim().length : 0
    if (cs.display.startsWith('inline') && sentence && hostText > ownText + 10)
      continue

    const r = el.getBoundingClientRect()
    const smaller = Math.min(r.width, r.height)
    if (smaller >= 44) continue

    const key = label(el)
    if (seenTargets.has(key)) continue
    seenTargets.add(key)
    push(
      '2.5.5 Target Size (Enhanced)',
      'Interactive target is smaller than 44x44 CSS pixels.',
      el,
      `${Math.round(r.width)}x${Math.round(r.height)}px`,
    )
    if (seenTargets.size >= 25) break
  }

  // ── 2.4.11 / 2.4.12 Focus Not Obscured ─────────────────────────────────────────────────────
  // Focus each control in turn and ask the document what is actually painted at the corners of
  // the focused box. A sticky header, a cookie bar or a bottom action bar is exactly the thing
  // this catches, and it is the one an automated pass can catch honestly.
  const focusables = [...document.querySelectorAll(INTERACTIVE)].filter(
    (el) => visible(el) && !disabled(el),
  )
  let obscuredReported = 0
  for (const el of focusables.slice(0, 80)) {
    try {
      el.focus()
    } catch {
      continue
    }
    if (document.activeElement !== el) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue

    const corners = [
      [r.left + 2, r.top + 2],
      [r.right - 2, r.top + 2],
      [r.left + 2, r.bottom - 2],
      [r.right - 2, r.bottom - 2],
    ]
    let covered = 0
    for (const [x, y] of corners) {
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) {
        covered += 1
        continue
      }
      const hit = document.elementFromPoint(x, y)
      if (!hit || !(hit === el || el.contains(hit) || hit.contains(el)))
        covered += 1
    }
    if (covered === 0) continue

    obscuredReported += 1
    push(
      covered === 4
        ? '2.4.11 Focus Not Obscured (Minimum)'
        : '2.4.12 Focus Not Obscured (Enhanced)',
      covered === 4
        ? 'The focused control is entirely hidden behind other content or off-screen.'
        : 'Part of the focused control is hidden behind other content or off-screen.',
      el,
      `${covered} of 4 corners obscured`,
    )
    if (obscuredReported >= 15) break
  }
  document.activeElement?.blur?.()

  // ── 1.4.8 Visual Presentation ──────────────────────────────────────────────────────────────
  // Line height at least 1.5, spacing after a paragraph at least 1.5x the line spacing, lines no
  // wider than 80 characters, text not justified. Line length is estimated from the average
  // glyph width of the computed font size, which is close enough to spot a 140-character measure
  // and not close enough to argue about 81.
  let presentationReported = 0
  for (const el of document.querySelectorAll('p, li, dd, blockquote')) {
    if (presentationReported >= 20) break
    if (!visible(el)) continue
    const text = (el.textContent ?? '').trim()
    if (text.length < 60) continue

    const cs = getComputedStyle(el)
    const fontSize = Number.parseFloat(cs.fontSize)
    const lineHeight =
      cs.lineHeight === 'normal'
        ? fontSize * 1.2
        : Number.parseFloat(cs.lineHeight)
    const r = el.getBoundingClientRect()

    if (lineHeight / fontSize < 1.5) {
      push(
        '1.4.8 Visual Presentation',
        'Line height is below 1.5x the font size.',
        el,
        `${(lineHeight / fontSize).toFixed(2)}x`,
      )
      presentationReported += 1
    }
    if (cs.textAlign === 'justify') {
      push('1.4.8 Visual Presentation', 'Text is justified.', el, cs.textAlign)
      presentationReported += 1
    }
    const estimatedChars = r.width / (fontSize * 0.5)
    if (estimatedChars > 80) {
      push(
        '1.4.8 Visual Presentation',
        'Line length is above 80 characters.',
        el,
        `~${Math.round(estimatedChars)} characters`,
      )
      presentationReported += 1
    }
    if (el.tagName === 'P') {
      const marginBottom = Number.parseFloat(cs.marginBottom) || 0
      if (marginBottom < lineHeight * 1.5) {
        push(
          '1.4.8 Visual Presentation',
          'Spacing after the paragraph is below 1.5x the line spacing.',
          el,
          `${Math.round(marginBottom)}px after ${Math.round(lineHeight)}px lines`,
        )
        presentationReported += 1
      }
    }
  }

  // ── 3.3.9 Accessible Authentication (Enhanced) ─────────────────────────────────────────────
  // Only on the authentication screens. What is testable is whether the browser and the password
  // manager can do the remembering for the user: the right autocomplete tokens, a paste that is
  // not blocked, and no puzzle standing between them and the account.
  if (isAuthForm) {
    const passwords = [
      ...document.querySelectorAll('input[type="password"]'),
    ].filter(visible)
    for (const el of passwords) {
      const ac = (el.getAttribute('autocomplete') ?? '').toLowerCase()
      if (!/current-password|new-password/.test(ac)) {
        push(
          '3.3.9 Accessible Authentication (Enhanced)',
          'Password field carries no current-password/new-password autocomplete token, so a password manager cannot fill it.',
          el,
          ac || '(absent)',
        )
      }
      if (el.getAttribute('onpaste')) {
        push(
          '3.3.9 Accessible Authentication (Enhanced)',
          'Password field installs an onpaste handler; pasting a generated password must not be blocked.',
          el,
          el.getAttribute('onpaste') ?? '',
        )
      }
    }

    const identifiers = [
      ...document.querySelectorAll(
        'input[type="email"], input[name*="email" i], input[name*="user" i]',
      ),
    ].filter(visible)
    for (const el of identifiers) {
      const ac = (el.getAttribute('autocomplete') ?? '').toLowerCase()
      if (!/username|email/.test(ac)) {
        push(
          '3.3.9 Accessible Authentication (Enhanced)',
          'Identifier field carries no username/email autocomplete token.',
          el,
          ac || '(absent)',
        )
      }
    }

    const puzzle = document.querySelector(
      '[class*="captcha" i], [id*="captcha" i], iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"]',
    )
    if (puzzle && visible(puzzle)) {
      push(
        '3.3.9 Accessible Authentication (Enhanced)',
        'A challenge widget is present. Enhanced accessible authentication allows no cognitive function test at any step, with no exception for object recognition.',
        puzzle,
        puzzle.tagName.toLowerCase(),
      )
    }
  }

  return out
}
/* c8 ignore stop */

// ─── driving ─────────────────────────────────────────────────────────────────────────────────

const readRoutes = async () => {
  const file = path.join(process.cwd(), '.github', 'a11y', 'routes.json')
  const parsed = JSON.parse(await readFile(file, 'utf8'))
  if (!Array.isArray(parsed.routes) || parsed.routes.length === 0) {
    throw new Error(`${file} lists no routes`)
  }
  return parsed.routes
}

/**
 * Sign in through Better Auth's own endpoint rather than through the form.
 *
 * The form is the thing being audited and its markup is expected to change; the endpoint is a
 * contract. `context.request` shares the context's cookie jar, so the session cookie the call
 * sets is the session every page in that context is then loaded with.
 */
const signIn = async (context) => {
  const res = await context.request.post(`${BASE_URL}/api/auth/sign-in/email`, {
    // Better Auth rejects a cross-site POST it cannot attribute, and a request issued by the
    // API client rather than by a page carries no `Origin` of its own - so without this the
    // endpoint answers 403 `MISSING_OR_NULL_ORIGIN` before it ever looks at the credentials.
    // That is what this gate had been failing on, and the shape of the error is why it went
    // unread: 403 reads as "these credentials were refused" when it means "this request was
    // never asked about credentials".
    headers: { origin: BASE_URL },
    data: { email: EMAIL, password: PASSWORD },
    failOnStatusCode: false,
  })
  if (!res.ok()) {
    throw new Error(
      `sign-in failed for ${EMAIL}: HTTP ${res.status()}. The scan cannot audit the signed-in ` +
        `surface without it. 401 is the password: check it against the one ` +
        `\`scripts/seed/seed.mjs\` writes, or set A11Y_USER_EMAIL / A11Y_USER_PASSWORD. ` +
        `403 is not the password - the request was refused before them.`,
    )
  }
}

const newContext = async (browser, { viewport, authed }) => {
  const context = await browser.newContext({
    viewport,
    locale: 'en-GB',
    timezoneId: 'UTC',
    extraHTTPHeaders: CLOCK_PIN,
    reducedMotion: 'reduce',
  })
  if (authed) await signIn(context)
  return context
}

/** Navigate and let hydration settle. Returns null when the page did not come up as itself. */
const open = async (page, route, { theme, viewportName }) => {
  const url = `${BASE_URL}${route.path}`
  const response = await page.goto(url, { waitUntil: 'load', timeout: 30_000 })
  await page.waitForLoadState('domcontentloaded')
  // Hydration attaches the interactive layer, and every probe below asks about focus and
  // pointer targets - both of which are wrong on a server-rendered shell that has not booted.
  await page.waitForTimeout(600)

  const status = response?.status() ?? 0
  const landed = new URL(page.url()).pathname

  if (status >= 400) {
    record({
      level: 'AA',
      route: route.path,
      theme,
      viewport: viewportName,
      criterion: 'Navigation',
      id: 'route-unavailable',
      impact: 'critical',
      summary: `${route.path} answered HTTP ${status}; nothing was scanned.`,
      nodes: [],
    })
    return null
  }
  // A session route that lands on /login means the sign-in did not stick, and scanning the login
  // page forty times would report green for a surface nobody looked at.
  if (route.access === 'session' && /^\/(login|register)/.test(landed)) {
    record({
      level: 'AA',
      route: route.path,
      theme,
      viewport: viewportName,
      criterion: 'Navigation',
      id: 'session-lost',
      impact: 'critical',
      summary: `${route.path} redirected to ${landed}; the signed-in surface was not scanned.`,
      nodes: [],
    })
    return null
  }
  visited.push({
    route: route.path,
    theme,
    viewport: viewportName,
    status,
    landed,
  })
  return page
}

// The excluded region is React Aria's global live announcer, not ours: `LiveAnnouncer.mjs:51`
// stamps `data-live-announcer` on a container it keeps on `document.body`, and a pending `Button`
// leaves `role="img"` nodes there whose `aria-labelledby` outlives the control it names. Axe is
// right about them and nothing in this repository can fix them. `e2e/support/budgets.ts` excludes
// the same region for the same reason - the two scanners have to agree, or a page passes one gate
// and fails the other.
const runAxe = async (page, tags) =>
  new AxeBuilder({ page })
    .withTags(tags)
    .exclude('[data-live-announcer]')
    .analyze()

const collectAxe = (results, { level, route, theme, viewportName }) => {
  for (const v of results.violations) {
    record({
      level,
      route,
      theme,
      viewport: viewportName,
      criterion: v.tags.filter((t) => t.startsWith('wcag')).join(' ') || v.id,
      id: v.id,
      impact: v.impact ?? 'unknown',
      summary: v.help,
      helpUrl: v.helpUrl,
      nodes: v.nodes.slice(0, 5).map((n) => ({
        target: n.target.join(' '),
        html: n.html.slice(0, 300),
        summary: (n.failureSummary ?? '').slice(0, 500),
      })),
    })
  }
}

const main = async () => {
  const routes = await readRoutes()
  const browser = await chromium.launch()

  try {
    // ── pass 1: the gate ─────────────────────────────────────────────────────────────────────
    for (const theme of THEMES) {
      const anon = await newContext(browser, {
        viewport: DESKTOP,
        authed: false,
      })
      const authed = await newContext(browser, {
        viewport: DESKTOP,
        authed: true,
      })
      try {
        for (const route of routes) {
          const context = route.access === 'session' ? authed : anon
          const page = await context.newPage()
          await page.emulateMedia({ colorScheme: theme })
          try {
            if (await open(page, route, { theme, viewportName: 'desktop' })) {
              const results = await runAxe(page, GATE_TAGS)
              collectAxe(results, {
                level: 'AA',
                route: route.path,
                theme,
                viewportName: 'desktop',
              })
            }
          } finally {
            await page.close()
          }
        }
      } finally {
        await anon.close()
        await authed.close()
      }
    }

    // ── pass 2: the named AAA criteria, at the width where they bite ─────────────────────────
    // Mobile, because 2.5.5 is a thumb criterion and a 32px icon button that is comfortable with
    // a mouse is the one people miss on a phone. Light theme only: this pass is advisory, and a
    // second colour scheme would double its cost for findings the gate already covers.
    const anonM = await newContext(browser, { viewport: MOBILE, authed: false })
    const authedM = await newContext(browser, {
      viewport: MOBILE,
      authed: true,
    })
    try {
      for (const route of routes) {
        const context = route.access === 'session' ? authedM : anonM
        const page = await context.newPage()
        await page.emulateMedia({ colorScheme: 'light' })
        try {
          if (
            !(await open(page, route, {
              theme: 'light',
              viewportName: 'mobile',
            }))
          )
            continue

          const probes = await page.evaluate(probePage, {
            isAuthForm: route.access === 'form',
          })
          for (const p of probes) {
            record({
              level: 'AAA',
              route: route.path,
              theme: 'light',
              viewport: 'mobile',
              criterion: p.criterion,
              id: p.criterion.split(' ')[0],
              impact: 'advisory',
              summary: p.summary,
              nodes: [{ target: p.target, html: '', summary: p.detail ?? '' }],
            })
          }

          const results = await runAxe(page, ADVISORY_TAGS)
          collectAxe(results, {
            level: 'AAA',
            route: route.path,
            theme: 'light',
            viewportName: 'mobile',
          })
        } finally {
          await page.close()
        }
      }
    } finally {
      await anonM.close()
      await authedM.close()
    }
  } finally {
    await browser.close()
  }

  // 2.2.6 has no automated form. A session that expires can only be judged against what the
  // product promises the user beforehand, and that promise is prose.
  record({
    level: 'manual',
    route: '(product-wide)',
    theme: '-',
    viewport: '-',
    criterion: '2.2.6 Timeouts',
    id: '2.2.6',
    impact: 'manual',
    summary:
      'Users must be warned of any data loss from a period of inactivity of 20 hours or less, ' +
      'unless the data is preserved. Verify by hand whenever session lifetime, the idle warning ' +
      'or draft persistence changes.',
    nodes: [],
  })

  // ── report ───────────────────────────────────────────────────────────────────────────────
  const gate = findings.filter((f) => f.level === 'AA')
  const advisory = findings.filter((f) => f.level === 'AAA')
  const manual = findings.filter((f) => f.level === 'manual')

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    themes: THEMES,
    routesScanned: routes.length,
    pagesVisited: visited.length,
    summary: {
      wcag22AaViolations: gate.length,
      aaaAdvisories: advisory.length,
      manualChecks: manual.length,
    },
    visited,
    findings,
  }

  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(
    path.join(OUT_DIR, 'axe-results.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )

  for (const f of gate) {
    console.log(
      `::error title=a11y ${f.id} (${f.route})::[${f.theme}] ${f.summary}${
        f.nodes[0] ? ` - ${f.nodes[0].target}` : ''
      }`,
    )
  }

  const byCriterion = (list) => {
    const counts = new Map()
    for (const f of list)
      counts.set(f.criterion, (counts.get(f.criterion) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }

  const lines = [
    '## Accessibility gate',
    '',
    `Base URL \`${BASE_URL}\` · ${routes.length} routes · ${visited.length} page loads · themes: ${THEMES.join(', ')}`,
    '',
    gate.length === 0
      ? '**WCAG 2.2 A/AA: clean.**'
      : `**WCAG 2.2 A/AA: ${gate.length} violation(s) — the build fails.**`,
    '',
  ]
  if (gate.length > 0) {
    lines.push(
      '| Rule | Route | Theme | Impact | Issue |',
      '| --- | --- | --- | --- | --- |',
    )
    for (const f of gate.slice(0, 60)) {
      lines.push(
        `| \`${f.id}\` | \`${f.route}\` | ${f.theme} | ${f.impact} | ${f.summary} |`,
      )
    }
    if (gate.length > 60)
      lines.push('', `…and ${gate.length - 60} more in the artifact.`)
    lines.push('')
  }
  lines.push(
    '### Held to AAA (reported, not gated)',
    '',
    'Target size 44px · focus not obscured · visual presentation · timeouts · accessible authentication, plus axe’s AAA rules including 1.4.6 enhanced contrast.',
    '',
    '| Criterion | Findings |',
    '| --- | --- |',
  )
  for (const [criterion, count] of byCriterion(advisory)) {
    lines.push(`| ${criterion} | ${count} |`)
  }
  if (advisory.length === 0) lines.push('| — | none |')
  lines.push(
    '',
    `${manual.length} criterion requires manual verification (2.2.6 Timeouts).`,
    '',
    'Full detail, node by node, is in the `a11y-axe-results` artifact.',
    '',
  )

  const summary = `${lines.join('\n')}\n`
  console.log(summary)
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary)
  }

  return gate.length === 0 ? 0 : 1
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.log(
      `::error title=a11y scan failed::${error instanceof Error ? error.message : error}`,
    )
    console.error(error)
    process.exit(2)
  },
)
