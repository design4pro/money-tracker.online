// The label protocol of ADR 0014 as pure decisions: given a snapshot of GitHub and of
// cezar's run list, which invariants are broken and which mechanical fixes follow.
// No I/O here, `now` is a parameter, so vitest can pin every rule (state.test.ts);
// sweep.mjs gathers the snapshot and applies the fixes.
//
// Snapshot shape (sweep.mjs builds it, tests hand-write it):
//   issues[]: { number, state: 'OPEN'|'CLOSED', title, labels: string[], parent: number|null,
//               subIssues: { total, completed }, blockedBy: [{ number, state }],
//               claim: { runId, heartbeatAt: ISO|null }|null, runLabeledAt: ISO|null,
//               ownedPaths: string[] }
//   prs[]:    { number, state: 'OPEN'|'MERGED'|'CLOSED', labels: string[], refs: number[] }
//   runs:     [{ id, status, autoResumeAt, task }] | null   (null = cezar unreachable)

export const STATUS_LABELS = [
  'status: triage',
  'status: needs-info',
  'status: backlog',
  'status: queued',
  'status: ready',
  'status: in-progress',
  'status: review',
  'status: needs-human',
]
export const RUN_LABELS = ['run: triage', 'run: implement']
export const TYPE_LABELS = [
  'type: bug',
  'type: feature',
  'type: enhancement',
  'type: maintenance',
]

const MINUTE = 60_000
export const RUN_LABEL_WARN_MS = 30 * MINUTE
export const RUN_LABEL_ESCALATE_MS = 120 * MINUTE
export const HEARTBEAT_STALE_MS = 180 * MINUTE

// A run still counts as "held" while cezar can resume it on its own.
const ACTIVE_RUN = new Set(['queued', 'running', 'waiting', 'review'])

export const statusOf = (labels) =>
  labels.filter((l) => l.startsWith('status: '))
export const has = (issue, label) => issue.labels.includes(label)
const isOpen = (issue) => issue.state === 'OPEN'
const isTicket = (issue) => issue.parent != null
const isPrd = (issue) => has(issue, 'prd') || issue.subIssues.total > 0

export function issueOfTask(task) {
  const m = /\d+/.exec(task ?? '')
  return m ? Number(m[0]) : null
}

export function activeRunFor(issue, runs) {
  if (!runs) return null
  return (
    runs.find(
      (r) =>
        issueOfTask(r.task) === issue.number &&
        (ACTIVE_RUN.has(r.status) || (r.status === 'failed' && r.autoResumeAt)),
    ) ?? null
  )
}

const ageMs = (iso, now) => (iso ? now - Date.parse(iso) : Infinity)

// Two Owned paths overlap when one is the other or a directory above it.
export function pathsOverlap(a, b) {
  const norm = (p) => p.replace(/\/+$/, '')
  const [x, y] = [norm(a), norm(b)]
  return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`)
}

export function sweep(snapshot, now) {
  const { issues, prs, runs } = snapshot
  const byNumber = new Map(issues.map((i) => [i.number, i]))
  const violations = []
  const actions = []
  const report = (code, issue, message) =>
    violations.push({ code, issue: issue.number, message })
  const swap = (issue, to, code, reason) =>
    actions.push({
      code,
      issue: issue.number,
      op: 'swap',
      from: statusOf(issue.labels),
      to,
      reason,
    })
  const add = (issue, label, code, reason) =>
    actions.push({ code, issue: issue.number, op: 'add', label, reason })
  const remove = (issue, label, code, reason) =>
    actions.push({ code, issue: issue.number, op: 'remove', label, reason })
  const comment = (issue, code, body) =>
    actions.push({ code, issue: issue.number, op: 'comment', body })
  const close = (issue, code, reason) =>
    actions.push({ code, issue: issue.number, op: 'close', reason })

  // Transitions driven by pull requests come first so the invariants below see the
  // closes they imply (a merged ticket unblocks its siblings in the same pass).
  const closing = new Set()
  for (const issue of issues.filter(isOpen)) {
    const mine = prs.filter(
      (pr) => pr.labels.includes('agent-pr') && pr.refs.includes(issue.number),
    )
    if (mine.some((pr) => pr.state === 'OPEN')) continue
    const merged = mine.find((pr) => pr.state === 'MERGED')
    if (merged) {
      closing.add(issue.number)
      close(issue, 'PR-merged', `PR #${merged.number} merged`)
      continue
    }
    const abandoned = mine.find((pr) => pr.state === 'CLOSED')
    if (abandoned && has(issue, 'status: review')) {
      swap(
        issue,
        'status: needs-human',
        'PR-closed',
        `PR #${abandoned.number} closed without merge`,
      )
      comment(
        issue,
        'PR-closed',
        `PR #${abandoned.number} was closed without a merge; a human decides what happens to this ticket.`,
      )
    }
  }
  const openAfter = (n) => {
    const i = byNumber.get(n)
    return i ? isOpen(i) && !closing.has(n) : false
  }

  for (const issue of issues) {
    const status = statusOf(issue.labels)
    const runLabels = issue.labels.filter((l) => l.startsWith('run: '))

    if (!isOpen(issue)) {
      // I-8: a closed issue carries no command.
      for (const l of runLabels)
        remove(issue, l, 'I-8', 'closed issue carries a run: label')
      // I-9 (closed half): auto-advance lives on an open PRD only.
      if (has(issue, 'auto-advance'))
        remove(issue, 'auto-advance', 'I-9', 'auto-advance on a closed issue')
      continue
    }
    if (closing.has(issue.number)) continue

    // I-1
    if (status.length !== 1)
      report(
        'I-1',
        issue,
        `expected exactly one status label, found ${status.length}`,
      )
    // I-2
    const types = issue.labels.filter((l) => l.startsWith('type: '))
    if (!isTicket(issue) && types.length === 0)
      report('I-2', issue, 'issue without a parent needs a type: label')
    if (isTicket(issue) && types.length > 0)
      report('I-2', issue, 'ticket (has a parent) carries a type: label')
    // I-3
    if (issue.subIssues.total > 0 && !has(issue, 'prd'))
      add(issue, 'prd', 'I-3', 'has sub-issues')
    if (has(issue, 'prd') && !issue.title.startsWith('PRD:'))
      report('I-3', issue, 'prd label but the title does not start with "PRD:"')
    // I-9 (open half)
    if (has(issue, 'auto-advance') && !isPrd(issue))
      remove(issue, 'auto-advance', 'I-9', 'auto-advance on a non-PRD')

    const run = activeRunFor(issue, runs)

    // I-4: a command nobody claimed.
    if (runLabels.length > 0 && !run) {
      if (runs === null) {
        report(
          'I-4',
          issue,
          'run: label present and cezar unreachable; not escalating',
        )
      } else {
        const age = ageMs(issue.runLabeledAt, now)
        if (age > RUN_LABEL_ESCALATE_MS) {
          for (const l of runLabels)
            remove(issue, l, 'I-4', 'unclaimed for more than 2 h')
          swap(
            issue,
            'status: needs-human',
            'I-4',
            'run: label unclaimed for more than 2 h',
          )
          comment(
            issue,
            'I-4',
            'The run: label sat for more than 2 h without a claim (is the cezar automation enabled?). Removed it and marked the issue needs-human.',
          )
        } else if (age > RUN_LABEL_WARN_MS) {
          comment(
            issue,
            'I-4',
            'The run: label has waited more than 30 min without a claim; check the cezar automations.',
          )
        }
      }
    }

    // I-5: queued means "an open blocker exists".
    if (isTicket(issue)) {
      const openBlockers = issue.blockedBy.filter(
        (b) =>
          openAfter(b.number) ||
          (!byNumber.has(b.number) && b.state === 'OPEN'),
      )
      if (has(issue, 'status: queued') && openBlockers.length === 0) {
        swap(issue, 'status: ready', 'I-5', 'no open blocker left')
        const parent = byNumber.get(issue.parent)
        if (
          parent &&
          isOpen(parent) &&
          has(parent, 'auto-advance') &&
          runLabels.length === 0
        ) {
          add(
            issue,
            'run: implement',
            'auto-advance',
            `PRD #${parent.number} carries auto-advance`,
          )
        }
      }
      if (has(issue, 'status: ready') && openBlockers.length > 0) {
        swap(
          issue,
          'status: queued',
          'I-5',
          `blocked by ${openBlockers.map((b) => `#${b.number}`).join(', ')}`,
        )
      }
      if (
        (has(issue, 'status: in-progress') || has(issue, 'status: review')) &&
        openBlockers.length > 0
      ) {
        report(
          'I-5',
          issue,
          `${status[0]} with open blockers ${openBlockers.map((b) => `#${b.number}`).join(', ')}`,
        )
      }
    }

    // I-6: in-progress needs a living run.
    if (has(issue, 'status: in-progress')) {
      if (isPrd(issue) && issue.subIssues.total > 0) {
        // A PRD with tickets is "in progress" while they are; the sweeper closes it below.
      } else if (runs === null) {
        report(
          'I-6',
          issue,
          'in-progress and cezar unreachable; not escalating',
        )
      } else if (isTicket(issue)) {
        const stale = ageMs(issue.claim?.heartbeatAt, now) > HEARTBEAT_STALE_MS
        if (stale && !run) {
          swap(
            issue,
            'status: needs-human',
            'I-6',
            'no heartbeat for 3 h and no active run',
          )
          comment(
            issue,
            'I-6',
            `No heartbeat for 3 h and cezar holds no run for this ticket${issue.claim ? ` (last run ${issue.claim.runId.slice(0, 8)}; its branch is claude/issue-${issue.number}-${issue.claim.runId.slice(0, 8)})` : ''}. Marked needs-human.`,
          )
        }
      } else if (!run) {
        swap(
          issue,
          'status: needs-human',
          'I-6',
          'planning run gone from cezar',
        )
        comment(
          issue,
          'I-6',
          'This issue is in-progress but cezar holds no run (active or parked) for it. Marked needs-human; hand it to the agent again from the cockpit to continue.',
        )
      }
    }

    // PRD whose children are all closed closes itself.
    if (isPrd(issue) && issue.subIssues.total > 0) {
      const children = issues.filter((c) => c.parent === issue.number)
      const allDone =
        children.length > 0 &&
        children.every((c) => !isOpen(c) || closing.has(c.number))
      if (allDone) close(issue, 'PRD-done', 'every sub-issue is closed')
    }

    // I-7: review on a ticket means an open agent PR exists.
    if (isTicket(issue) && has(issue, 'status: review')) {
      const open = prs.some(
        (pr) =>
          pr.state === 'OPEN' &&
          pr.labels.includes('agent-pr') &&
          pr.refs.includes(issue.number),
      )
      if (!open)
        report('I-7', issue, 'ticket in review without an open agent-pr PR')
    }
  }

  // I-7 (other direction): an open agent PR whose ticket is not in review.
  for (const pr of prs.filter(
    (p) => p.state === 'OPEN' && p.labels.includes('agent-pr'),
  )) {
    for (const n of pr.refs) {
      const issue = byNumber.get(n)
      if (
        issue &&
        isOpen(issue) &&
        !has(issue, 'status: review') &&
        !has(issue, 'status: needs-human')
      ) {
        report(
          'I-7',
          issue,
          `open agent PR #${pr.number} but status is ${statusOf(issue.labels)[0] ?? 'missing'}`,
        )
      }
    }
  }

  // I-10: siblings in progress must not own the same paths.
  const inProgressTickets = issues.filter(
    (i) => isOpen(i) && isTicket(i) && has(i, 'status: in-progress'),
  )
  for (let a = 0; a < inProgressTickets.length; a++) {
    for (let b = a + 1; b < inProgressTickets.length; b++) {
      const x = inProgressTickets[a]
      const y = inProgressTickets[b]
      if (x.parent !== y.parent) continue
      const clash = x.ownedPaths.filter((p) =>
        y.ownedPaths.some((q) => pathsOverlap(p, q)),
      )
      if (clash.length > 0)
        report(
          'I-10',
          x,
          `owned paths overlap with #${y.number}: ${clash.join(', ')}`,
        )
    }
  }

  return { violations, actions }
}

// Owned paths are the backticked paths in the ticket body's "## Owned paths" section.
export function ownedPathsOf(body) {
  const section = /^## Owned paths\s*\n([\s\S]*?)(?=^## |\s*$(?![\s\S]))/m.exec(
    body ?? '',
  )
  if (!section) return []
  return [...section[1].matchAll(/`([^`\n]+)`/g)]
    .map((m) => m[1].trim())
    .filter((p) => /^[\w.@/-]+$/.test(p))
}
