// The decisions the Sentry sweep makes, as pure functions.
//
// They live apart from sentry-triage.ts because they are the part that can be wrong quietly. A
// selection threshold nobody can diff, or a dedup check that silently stops matching, does not
// announce itself - it just files a duplicate every week, or stops filing anything at all. Here
// they are one module with one test file (see __tests__/policy.test.ts), and a policy change is a
// reviewable diff rather than a sentence edited in a prompt.
//
// Nothing in this file does I/O, calls an agent, or reads the clock: `now` is always a parameter.

import { z } from 'zod'

/* ------------------------------------------------------------------ schema -- */

const frameSchema = z.object({
  /** Repo-relative, e.g. `src/server/repos/trips.ts`. */
  file: z.string().min(1),
  line: z.number().int().positive(),
  fn: z.string().nullable(),
})

export const candidateSchema = z.object({
  shortId: z.string().regex(/^[A-Z0-9]+(?:-[A-Z0-9]+)+$/),
  issueUrl: z.string().url(),
  title: z.string().min(8).max(160),
  errorType: z.string().min(1),
  errorValue: z.string(),
  culprit: z.string(),
  level: z.enum(['fatal', 'error', 'warning', 'info', 'debug']),
  sentryStatus: z.enum(['unresolved', 'resolved', 'ignored', 'archived']),
  unhandled: z.boolean(),
  environments: z.array(z.enum(['production', 'staging'])).min(1),
  primaryEnvironment: z.enum(['production', 'staging']),
  firstSeen: z.string(),
  lastSeen: z.string(),
  eventCount: z.number().int().nonnegative(),
  userCount: z.number().int().nonnegative(),
  release: z.string().nullable(),
  inAppFrame: frameSchema.nullable(),
  breadcrumbs: z.array(z.string()).max(8),
  suspectedCause: z.string(),
  judgement: z.enum(['file', 'noise']),
  judgementReason: z.string(),
})

export type Candidate = z.infer<typeof candidateSchema>

export const reportSchema = z.object({
  status: z.enum(['ok', 'mcp-unavailable', 'no-data']),
  window: z.string(),
  scanned: z.object({
    production: z.number().int().nonnegative(),
    staging: z.number().int().nonnegative(),
  }),
  candidates: z.array(candidateSchema).max(12),
  skipped: z
    .array(z.object({ shortId: z.string(), reason: z.string() }))
    .max(40),
  notes: z.string(),
})

export type Report = z.infer<typeof reportSchema>

/* ------------------------------------------------------------------ marker -- */

/**
 * The marker that makes a filed issue findable again.
 *
 * Keyed on the Sentry short id rather than on the title, because a Sentry title is an error message
 * and near-duplicates are the norm - `TypeError: x is undefined` says nothing about which one. The
 * `#n` suffix counts regressions: a second ticket for the same short id after the first was fixed
 * and closed.
 */
export function renderMarker(shortId: string, sequence: number): string {
  return sequence <= 1
    ? `<!-- sentry-issue: ${shortId} -->`
    : `<!-- sentry-issue: ${shortId}#${sequence} -->`
}

const MARKER_PATTERN =
  /<!--\s*sentry-issue:\s*([A-Z0-9]+(?:-[A-Z0-9]+)+)(?:#(\d+))?\s*-->/g

export interface ParsedMarker {
  readonly shortId: string
  readonly sequence: number
}

/**
 * Every marker in an issue body.
 *
 * Deliberately anchored on the comment syntax: a short id quoted in prose ("this looks like
 * MONEY-TRACKER-4KQ") must not count as a filed ticket, or a maintainer mentioning an issue would
 * silently suppress the ticket for it.
 */
export function parseMarkers(body: string): ReadonlyArray<ParsedMarker> {
  const found: Array<ParsedMarker> = []
  for (const match of body.matchAll(MARKER_PATTERN)) {
    found.push({
      shortId: match[1],
      sequence: match[2] === undefined ? 1 : Number(match[2]),
    })
  }
  return found
}

/* ------------------------------------------------------------------ dedupe -- */

export interface TrackedIssue {
  readonly number: number
  readonly state: 'OPEN' | 'CLOSED'
  readonly closedAt: string | null
  readonly body: string
}

export interface TrackedEntry {
  readonly latestSequence: number
  readonly openNumber?: number
  readonly newestClosed?: { readonly number: number; readonly closedAt: string }
}

/**
 * Index the existing tickets by Sentry short id.
 *
 * Built from a REST listing rather than from `gh issue list --search`, and that is load-bearing:
 * GitHub's search index lags behind by seconds to minutes, so two runs close together - or a
 * scheduled run just after a manual one - would each see no match and file the same ticket twice.
 * Label filtering goes through the issues API, which is immediately consistent.
 */
export function buildTrackedIndex(
  issues: ReadonlyArray<TrackedIssue>,
): Map<string, TrackedEntry> {
  const index = new Map<string, TrackedEntry>()

  for (const issue of issues) {
    for (const marker of parseMarkers(issue.body)) {
      const existing = index.get(marker.shortId)
      const latestSequence = Math.max(
        existing?.latestSequence ?? 0,
        marker.sequence,
      )

      let openNumber = existing?.openNumber
      let newestClosed = existing?.newestClosed

      if (issue.state === 'OPEN') {
        openNumber = openNumber ?? issue.number
      } else if (issue.closedAt !== null) {
        if (
          newestClosed === undefined ||
          issue.closedAt > newestClosed.closedAt
        ) {
          newestClosed = { number: issue.number, closedAt: issue.closedAt }
        }
      }

      index.set(marker.shortId, {
        latestSequence,
        ...(openNumber === undefined ? {} : { openNumber }),
        ...(newestClosed === undefined ? {} : { newestClosed }),
      })
    }
  }

  return index
}

/**
 * A fix takes time to reach everyone. Events inside this window after a ticket closed are the tail
 * of the old release, not evidence the fix failed.
 */
export const REGRESSION_GRACE_MS = 24 * 60 * 60 * 1000

export type DedupeVerdict =
  | { readonly action: 'file'; readonly sequence: number }
  | {
      readonly action: 'file-regression'
      readonly sequence: number
      readonly previous: number
    }
  | { readonly action: 'skip'; readonly reason: string }

export function dedupeVerdict(
  candidate: Pick<Candidate, 'shortId' | 'lastSeen'>,
  tracked: ReadonlyMap<string, TrackedEntry>,
): DedupeVerdict {
  const entry = tracked.get(candidate.shortId)
  if (entry === undefined) {
    return { action: 'file', sequence: 1 }
  }

  if (entry.openNumber !== undefined) {
    return { action: 'skip', reason: `already tracked as #${entry.openNumber}` }
  }

  const closed = entry.newestClosed
  if (closed === undefined) {
    return {
      action: 'skip',
      reason: 'already filed; no open or closed record to compare against',
    }
  }

  const lastSeen = Date.parse(candidate.lastSeen)
  const closedAt = Date.parse(closed.closedAt)
  if (Number.isNaN(lastSeen) || Number.isNaN(closedAt)) {
    return {
      action: 'skip',
      reason: 'unparseable timestamp; refusing to guess',
    }
  }

  if (lastSeen <= closedAt + REGRESSION_GRACE_MS) {
    return {
      action: 'skip',
      reason: `fixed in #${closed.number}; the events since are inside the deploy grace window`,
    }
  }

  return {
    action: 'file-regression',
    sequence: entry.latestSequence + 1,
    previous: closed.number,
  }
}

/* --------------------------------------------------------------- selection -- */

/**
 * The numeric gate.
 *
 * It is here rather than in the prompt on purpose. The agent holds the Sentry data, so the prompt
 * has to gather; but if the thresholds also lived there, the candidate set would be whatever the
 * model felt like that morning and a policy change would not be reviewable. The agent's own
 * `judgement` is ANDed with this, never ORed - it can veto ("a load test is hammering staging", a
 * thing no threshold can see) and it cannot promote.
 */
export const THRESHOLDS = {
  /** Still happening, or it is history rather than a defect. */
  staleAfterMs: 48 * 60 * 60 * 1000,
  /** A single burst is an incident; a defect recurs across time. */
  minimumSpanMs: 60 * 60 * 1000,
  production: { events: 25, users: 5 },
  staging: { events: 50, users: 2 },
} as const

/**
 * Errors that are real, common, and not defects in this application: a browser quirk, a stale
 * bundle after a deploy, a navigation that cancelled its own request.
 */
const DENYLIST = [
  'ResizeObserver loop',
  'ChunkLoadError',
  'Loading chunk',
  'Loading CSS chunk',
  'AbortError',
  'The operation was aborted',
  'Failed to fetch',
  'NetworkError',
  'Non-Error promise rejection captured',
]

const FOREIGN_FRAME_PREFIXES = [
  'chrome-extension://',
  'moz-extension://',
  'safari-extension://',
]

export type SelectionVerdict =
  { readonly ok: true } | { readonly ok: false; readonly reason: string }

export function selectionVerdict(
  candidate: Candidate,
  now: number,
): SelectionVerdict {
  if (candidate.sentryStatus !== 'unresolved') {
    return {
      ok: false,
      reason: `${candidate.sentryStatus} in Sentry - a maintainer decided that`,
    }
  }
  if (candidate.level !== 'error' && candidate.level !== 'fatal') {
    return { ok: false, reason: `level ${candidate.level}` }
  }
  // No `unhandled` gate, deliberately. It reads as a proxy for "the app coped", and in this
  // codebase it is not one: `recordDiagnostic` in src/server/errors/middleware.ts is the error
  // path for EVERY server function, so it calls `captureException` from a catch block and every
  // request that fails cleanly arrives here tagged handled. Gating on it hid the whole server
  // surface - src/server/observability/sentry.ts calls that half "often the more interesting
  // one" - and left only what leaked past the middleware. What remains below still has to be
  // unresolved, at error level, recurring, over threshold and owned by a frame under src/, and
  // whatever clears all of that is filed `status: pending` for triage.yml to reproduce at HEAD
  // and promote or reject (ADR 0006). A handled error that clears those bars is a defect.

  const haystack = `${candidate.errorType} ${candidate.errorValue}`
  const denied = DENYLIST.find((entry) => haystack.includes(entry))
  if (denied !== undefined) {
    return { ok: false, reason: `known noise (${denied})` }
  }

  if (candidate.inAppFrame === null) {
    return {
      ok: false,
      reason: 'no frame in src/ - nothing to own, so no ticket to draw',
    }
  }
  const foreign = FOREIGN_FRAME_PREFIXES.find((prefix) =>
    candidate.inAppFrame?.file.startsWith(prefix),
  )
  if (foreign !== undefined) {
    return { ok: false, reason: `frame is not ours (${foreign})` }
  }

  const lastSeen = Date.parse(candidate.lastSeen)
  const firstSeen = Date.parse(candidate.firstSeen)
  if (Number.isNaN(lastSeen) || Number.isNaN(firstSeen)) {
    return { ok: false, reason: 'unparseable first/last seen' }
  }
  if (now - lastSeen > THRESHOLDS.staleAfterMs) {
    return {
      ok: false,
      reason: 'not seen recently enough to still be happening',
    }
  }
  if (lastSeen - firstSeen < THRESHOLDS.minimumSpanMs) {
    return {
      ok: false,
      reason: 'a single burst rather than a recurring defect',
    }
  }

  const { events, users } = THRESHOLDS[candidate.primaryEnvironment]
  const clears =
    candidate.primaryEnvironment === 'production'
      ? candidate.eventCount >= events || candidate.userCount >= users
      : candidate.eventCount >= events && candidate.userCount >= users

  if (!clears) {
    return {
      ok: false,
      reason: `below the ${candidate.primaryEnvironment} bar (${candidate.eventCount} events, ${candidate.userCount} users)`,
    }
  }

  return { ok: true }
}

/**
 * Production first, then by how many people it reached.
 *
 * The order is what `MAX_FILED` cuts against, so when the cap bites it is staging noise that is
 * dropped and not the production defect behind it.
 */
export function filingOrder(
  candidates: ReadonlyArray<Candidate>,
  /** A short id named with `--force`, which sorts ahead of everything else. */
  forced?: string,
): ReadonlyArray<Candidate> {
  return [...candidates].sort((a, b) => {
    // Ahead of environment and scale, because a forced candidate is small by definition - that is
    // why it needed forcing - and would otherwise sort last and be dropped by `--max` without a
    // word. The cap still holds; only the priority changes.
    if (forced !== undefined && a.shortId !== b.shortId) {
      if (a.shortId === forced) return -1
      if (b.shortId === forced) return 1
    }
    if (a.primaryEnvironment !== b.primaryEnvironment) {
      return a.primaryEnvironment === 'production' ? -1 : 1
    }
    if (b.userCount !== a.userCount) return b.userCount - a.userCount
    return b.eventCount - a.eventCount
  })
}

/* ----------------------------------------------------------------- ticket -- */

export function renderTitle(
  candidate: Candidate,
  isRegression: boolean,
): string {
  const where = candidate.inAppFrame?.file ?? candidate.culprit
  const scale = `${candidate.eventCount} events, ${candidate.userCount} users in ${candidate.primaryEnvironment}`
  return `${isRegression ? 'Sentry regression' : 'Sentry'}: ${candidate.errorType} in ${where} - ${scale}`
}

export interface RenderBodyOptions {
  readonly candidate: Candidate
  readonly sequence: number
  /** The ticket this one regressed from, if any. */
  readonly previous?: number
  readonly runLabel: string
  readonly reportPath: string
  /**
   * Why `selectionVerdict` rejected this candidate, when it was filed anyway with `--force`.
   * Absent on a ticket that cleared the gate on its own.
   */
  readonly forcedReason?: string
}

/**
 * The ticket, written for the pre-triage agent that reads it next.
 *
 * Its job is to reproduce the claim at HEAD, so what it needs is a file and a line in our code and
 * the sequence of steps that got there - not a diagnosis. `Fix direction: unverified` is therefore
 * load-bearing rather than modest: this routine has reproduced nothing, and ADR 0006 promotes on a
 * reproduction. A confident guess here would be read as evidence and would corrupt that judgement.
 */
export function renderIssueBody(options: RenderBodyOptions): string {
  const { candidate, sequence, previous, runLabel, reportPath, forcedReason } =
    options
  const frame =
    candidate.inAppFrame === null
      ? 'none in src/'
      : `${candidate.inAppFrame.file}:${String(candidate.inAppFrame.line)}` +
        (candidate.inAppFrame.fn === null ? '' : `  ${candidate.inAppFrame.fn}`)

  const opening =
    previous === undefined
      ? `\`${candidate.errorType}: ${candidate.errorValue}\` has fired ${String(candidate.eventCount)} times for ${String(candidate.userCount)} distinct users in ${candidate.primaryEnvironment}, and is still firing.`
      : `This was fixed and closed in #${String(previous)}, and Sentry has seen it ${String(candidate.eventCount)} times since - beyond the window a deploy needs to propagate. The fix that closed #${String(previous)} is either wrong or incomplete.`

  return [
    opening,
    '',
    renderMarker(candidate.shortId, sequence),
    '',
    '```',
    `Sentry issue:   ${candidate.shortId}  ${candidate.issueUrl}`,
    `Culprit:        ${candidate.culprit}`,
    `Level:          ${candidate.level}${candidate.unhandled ? ' (unhandled)' : ''}`,
    ...(forcedReason === undefined
      ? []
      : [`Policy:         FORCED - ${forcedReason}`]),
    `In-app frame:   ${frame}`,
    `Environments:   ${candidate.environments.join(', ')}`,
    `Events / users: ${String(candidate.eventCount)} / ${String(candidate.userCount)}`,
    `Release:        ${candidate.release ?? 'unknown'}`,
    `First seen:     ${candidate.firstSeen}`,
    `Last seen:      ${candidate.lastSeen}`,
    '```',
    '',
    ...(candidate.breadcrumbs.length === 0
      ? []
      : [
          'Breadcrumbs leading to the throw:',
          '',
          ...candidate.breadcrumbs.map((c) => `- ${c}`),
          '',
        ]),
    `Suspected cause (from the agent, unverified): ${candidate.suspectedCause}`,
    '',
    'Fix direction: unverified - this ticket is evidence, not a diagnosis. Pre-triage should',
    `reproduce at HEAD from ${frame} and the sequence above before any brief is written.`,
    '',
    '---',
    forcedReason === undefined
      ? `_Filed by \`pnpm sandcastle:sentry --file-issues\` (run ${runLabel}) from Sentry issue ${candidate.shortId}. Full report: ${reportPath}_`
      : `_Filed by hand with \`pnpm sandcastle:sentry --force ${candidate.shortId} --file-issues\` (run ${runLabel}), against the policy - see the FORCED line above. Full report: ${reportPath}_`,
  ].join('\n')
}
