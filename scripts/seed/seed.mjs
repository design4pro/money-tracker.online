#!/usr/bin/env node

/**
 * Demo-data seeder.
 *
 *   node scripts/seed/seed.mjs [--force] [--email <address>] [--url <origin>] [--today <day>] [--status]
 *
 * The seed itself runs *inside* the Worker, at `POST /api/internal/seed`, because that is the only
 * place the D1 binding, the Drizzle client and the tenant repositories all exist at once. This
 * script is only the trigger: it finds the running dev server, posts to the endpoint, and prints the
 * report.
 *
 * ./README.md is the contract — the exact request and response shapes the Worker side must
 * implement, and the dataset the fixture is required to write. Read it before changing anything
 * here: this file and that endpoint are two halves of one interface, and they are deployed apart.
 */

/**
 * Origins probed when neither `--url` nor `$SEED_URL` says where the server is.
 *
 * Two ranges, in this order and for two different readers. 3000-3005 is where `vite dev` lands for a
 * person working on the project, and it is tried first because that person did not pass a flag.
 * 3010-3020 is the range `playwright.config.ts` reserves for an automated round and refuses to run
 * outside of; a round that seeds without `--url` should still find its own server rather than
 * silently rebuild somebody else's workspace, which is the accident the port guard exists to stop.
 *
 * Neither range is safe to guess at when two checkouts are up at once. Pass `--url` — the reserved
 * range in particular is shared between worktrees, and this script has no way to tell one from
 * another.
 */
const DEFAULT_PORTS = [
  3000, 3001, 3002, 3003, 3004, 3005, 3010, 3011, 3012, 3013, 3014, 3015,
]

/**
 * Password for the demo owner's account, used only when that account does not exist yet.
 *
 * This is a fixture credential for a local database, not a secret: it is committed on purpose so
 * that a fresh clone can reach the authenticated screens with one command, and so the e2e suite has
 * a deterministic account to sign in as. Override it with DEMO_PASSWORD (or E2E_PASSWORD) if you
 * would rather it were not written down. Nothing reachable from a production build reads it —
 * `/api/internal/seed` is compiled out by `import.meta.env.DEV`.
 */
const DEFAULT_DEMO_PASSWORD = 'money-demo-2026'

function demoPassword(explicit) {
  return (
    explicit ??
    process.env.DEMO_PASSWORD ??
    process.env.E2E_PASSWORD ??
    DEFAULT_DEMO_PASSWORD
  )
}

const ENDPOINT = '/api/internal/seed'

/**
 * The header `serverToday()` reads on a development request, and the whole of `--today`.
 *
 * The seeded rows must not depend on what day the Worker thinks it is: every date the fixture writes
 * is an offset from the dataset's own anchor, and nothing in the seed path reads a clock. `--today`
 * is how that claim is falsifiable rather than merely asserted — seed under three widely separated
 * days, run the visual gate against the same baselines after each, and a fixture that had smuggled a
 * clock in shows up as a red frame.
 *
 * It matters more here than in most products. Every screen this app has is a function of a date
 * range: the dashboard reads the current month, the upcoming rail reads forward from today, a budget
 * bar divides by days elapsed. A fixture that drifts with the calendar does not fail — it quietly
 * photographs a different month every morning.
 */
const SERVER_TODAY_HEADER = 'x-mt-server-today'
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/
const PROBE_TIMEOUT_MS = 1500
const SEED_TIMEOUT_MS = 300_000

function out(text) {
  process.stdout.write(`${text}\n`)
}

function fail(text) {
  process.stderr.write(`${text}\n`)
  process.exitCode = 1
}

function parseArgs(argv) {
  const options = {
    force: false,
    status: false,
    email: null,
    url: null,
    password: null,
    keepPassword: false,
    today: null,
    help: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--force' || arg === '-f') {
      options.force = true
    } else if (arg === '--status' || arg === '-s') {
      options.status = true
    } else if (arg === '--email' || arg === '-e') {
      index += 1
      options.email = argv[index] ?? null
    } else if (arg === '--today' || arg === '-t') {
      index += 1
      options.today = argv[index] ?? null
      if (options.today === null || !CALENDAR_DAY.test(options.today)) {
        throw new Error('--today needs a calendar day, as YYYY-MM-DD.')
      }
    } else if (arg === '--keep-password') {
      options.keepPassword = true
    } else if (arg === '--password' || arg === '-p') {
      index += 1
      options.password = argv[index] ?? null
    } else if (arg === '--url' || arg === '-u') {
      index += 1
      options.url = argv[index] ?? null
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return options
}

/** True when this origin answers the seed endpoint's GET probe. */
async function responds(origin) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const response = await fetch(`${origin}${ENDPOINT}`, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) return false
    const body = await response.json()
    return body?.ok === true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Locates the dev server. An explicit `--url` or `SEED_URL` wins; otherwise the usual Vite ports are
 * probed in order, because `vite dev` silently moves to the next free port when 3000 is taken.
 */
async function findOrigin(explicit) {
  const configured = explicit ?? process.env.SEED_URL ?? null
  if (configured !== null) {
    const origin = configured.replace(/\/+$/, '')
    if (await responds(origin)) return origin
    throw new Error(
      `${origin}${ENDPOINT} did not answer. Is the dev server running there, and is it a dev build?`,
    )
  }

  for (const port of DEFAULT_PORTS) {
    const origin = `http://localhost:${port}`
    if (await responds(origin)) return origin
  }
  throw new Error(
    `No dev server answered ${ENDPOINT} on ports ${DEFAULT_PORTS.join(', ')}.\n` +
      'Start one with `pnpm exec vite dev --port 3010 --strictPort --host`, or pass\n' +
      '--url http://localhost:<port>.',
  )
}

/** Plain English for what the seed did to the owner's password. */
function describeCredential(report) {
  if (report.createdOwner === true)
    return 'account created — sign in with the seed password'
  switch (report.credential) {
    case 'created':
      return 'credential added to an existing account — sign in with the seed password'
    case 'reset':
      return 'reset to the seed password'
    case 'unchanged':
      return 'already the seed password'
    default:
      return 'left as it was (--keep-password, or no password supplied)'
  }
}

/**
 * The order the counts are printed in, which is the order the README declares them.
 *
 * Fixed rather than derived from `Object.keys`, so a run that is missing a counter prints a gap
 * instead of a shorter list nobody notices.
 */
const COUNT_ORDER = [
  'accounts',
  'accountGroups',
  'currencies',
  'categories',
  'payees',
  'payeeAliases',
  'tags',
  'transactions',
  'transferPairs',
  'splitTransactions',
  'splitRows',
  'refundLinks',
  'plannedTransactions',
  'budgets',
  'budgetPeriods',
  'recurringSeries',
  'recurringPeriods',
  'goals',
  'rules',
  'importBatches',
  'importRows',
  'attachments',
  'notifications',
  'members',
]

function printReport(report) {
  if (report.skipped) {
    out('Already seeded — nothing to do.')
    out(`  dataset version  ${report.datasetVersion}`)
    out(`  workspace        ${report.organizationId}`)
    // The password is reconciled before the marker check, so it is up to date even
    // on a run that wrote no data — which is the run people make most often.
    out(`  owner            ${report.ownerEmail}`)
    out(`  password         ${describeCredential(report)}`)
    out('')
    out('Re-run with --force to rebuild the demo workspace from the dataset.')
    return
  }

  out('Seeded.')
  out('')
  out(`  dataset version  ${report.datasetVersion}`)
  out(`  workspace        ${report.organizationId}`)
  out(`  base currency    ${report.baseCurrency}`)
  out(`  anchor day       ${report.anchorDate}`)
  out(`  owner            ${report.ownerEmail} (${report.ownerUserId})`)
  out(`  password         ${describeCredential(report)}`)
  out('')
  out('  Rows')
  for (const key of COUNT_ORDER) {
    const value = report.counts?.[key]
    out(`    ${key.padEnd(20)} ${value ?? 'MISSING'}`)
  }
  const extra = Object.keys(report.counts ?? {}).filter(
    (key) => !COUNT_ORDER.includes(key),
  )
  for (const key of extra) {
    out(
      `    ${key.padEnd(20)} ${report.counts[key]}  (not in the declared order)`,
    )
  }
  out('')
  out(
    `  dated ${report.dateSpan?.earliest ?? '?'} → ${report.dateSpan?.latest ?? '?'}`,
  )
  out(`  done in ${report.durationMs}ms`)
  out('')
  out('Check it with: node scripts/seed/verify.mjs')
}

/**
 * A rebuild mints a new organization id, so any session cached from the previous dataset now points
 * at a membership that no longer exists. Playwright caches exactly one such session in
 * `e2e/.auth/demo.json`, and a run that inherits it does not skip — it renders a 500 on the first
 * authenticated route and reports it as a failing route.
 *
 * It runs on **every** seed rather than only on `--force`. Better Auth's secondary storage keeps a
 * copy of the whole `user` row inside each cached session blob and answers from that blob in
 * preference to D1, so a warm reseed that touches the demo owner's row leaves every already-minted
 * session carrying the values the account held *before* it. Dropping the file forces one fresh
 * sign-in, which reads the row and writes a blob that agrees with it.
 */
async function dropCachedVisualSession() {
  const { rm } = await import('node:fs/promises')
  await rm('e2e/.auth/demo.json', { force: true })
}

async function main() {
  const options = parseArgs(process.argv.slice(2))

  if (options.help === true) {
    out(
      'Usage: node scripts/seed/seed.mjs [--force] [--email <address>] [--password <secret>]',
    )
    out(
      '                [--keep-password] [--url <origin>] [--today <YYYY-MM-DD>] [--status]',
    )
    out('')
    out(
      '  --force     Rebuild the demo workspace even if it has already been seeded.',
    )
    out(
      '  --email     Workspace owner to seed. Defaults to the address in ./README.md.',
    )
    out(
      '  --password  Password the owner account should have. Created when the account does not',
    )
    out(
      '              exist, reconciled when it does, left alone when it already works. Defaults',
    )
    out(
      '              to $DEMO_PASSWORD, then $E2E_PASSWORD, then the committed fixture.',
    )
    out('  --keep-password  Never overwrite a password that is already set.')
    out(
      '  --url       Dev-server origin. Defaults to $SEED_URL, then localhost:3000-3005 and',
    )
    out('              the reserved automation range, localhost:3010-3015.')
    out(
      '  --today     Tell the Worker what day it is for the duration of the seed request, as',
    )
    out(
      '              YYYY-MM-DD. The fixture is anchored, so the rows written must not change;',
    )
    out(
      '              this exists so that claim can be tested rather than trusted.',
    )
    out(
      '  --status    Report whether the workspace is seeded, and write nothing.',
    )
    return
  }

  const origin = await findOrigin(options.url)
  const url = new URL(`${origin}${ENDPOINT}`)
  if (options.email !== null) url.searchParams.set('email', options.email)
  if (options.force) url.searchParams.set('force', '1')

  const clockPin =
    options.today === null ? {} : { [SERVER_TODAY_HEADER]: options.today }

  if (options.status) {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
    })
    const body = await response.json()
    out(body.seeded ? 'Seeded.' : 'Not seeded.')
    if (body.marker != null) out(JSON.stringify(body.marker, null, 2))
    return
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SEED_TIMEOUT_MS)
  let body
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...clockPin,
      },
      // In the body, not the query string, so it stays out of request logs.
      body: JSON.stringify({
        password: demoPassword(options.password),
        keepPassword: options.keepPassword,
      }),
      signal: controller.signal,
    })
    body = await response.json()
    if (!response.ok || body?.ok !== true) {
      fail(
        `Seed failed (HTTP ${response.status}): ${body?.error ?? 'unknown error'}`,
      )
      return
    }
  } finally {
    clearTimeout(timer)
  }

  await dropCachedVisualSession()
  printReport(body)
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})
