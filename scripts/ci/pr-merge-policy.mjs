/** Pure decisions for the required PR merge check. GitHub metadata is fetched separately. */

const RISK_LABELS = ['risk-low', 'risk-medium', 'risk-high']
const HARD_BLOCKS = [
  'blocked',
  'do-not-merge',
  'qa-failed',
  'in-progress',
  'review',
  'changes-requested',
  'qa',
]
const HIGH_RISK_FILES = new Set([
  '.ai/agentic.config.json',
  '.ai/specs/product-brief.md',
  '.github/CODEOWNERS',
  '.github/labels.yml',
  'AGENTS.md',
  'BACKWARD_COMPATIBILITY.md',
  'CODE_REVIEW.md',
  'DESIGN.md',
  'SDLC.md',
  'docs/ACCESSIBILITY.md',
  'docs/MONEY.md',
  'docs/DEPLOY.md',
  'docs/SECURITY.md',
  'docs/SPEC.md',
  'package.json',
  'pnpm-lock.yaml',
  'wrangler.jsonc',
  'src/lib/plans.ts',
  'src/server/queue/messages.ts',
])
const HIGH_RISK_PREFIXES = [
  '.ai/cezar/workflows/',
  '.ai/skills/om-auto-review-pr/',
  '.ai/skills/om-approve-merge-pr/',
  '.claude/hooks/',
  '.github/workflows/',
  'docs/adr/',
  'drizzle/',
  'src/lib/money/',
  'src/server/auth/',
  'src/server/billing/',
  'src/server/db/',
  'src/server/do/',
  'src/server/import/',
  'src/server/ledger/',
  'src/server/repos/',
  'scripts/ci/',
]
const SECOND_REVIEW_PREFIXES = [
  'src/lib/money/',
  'src/server/auth/',
  'src/server/ledger/',
]
const SECOND_REVIEW_FILES = new Set(['docs/MONEY.md'])

function paths(files) {
  return files.flatMap(({ filename, previous_filename: previous }) =>
    previous ? [filename, previous] : [filename],
  )
}

function isHighRiskPath(path) {
  return (
    HIGH_RISK_FILES.has(path) ||
    HIGH_RISK_PREFIXES.some((prefix) => path.startsWith(prefix))
  )
}

function needsSecondReview(path) {
  return (
    SECOND_REVIEW_FILES.has(path) ||
    SECOND_REVIEW_PREFIXES.some((prefix) => path.startsWith(prefix))
  )
}

function hasHeadComment(comments, prefix, headSha, approvers) {
  const receipt = `${prefix}: ${headSha}`
  return comments.some(
    ({ body, user }) =>
      user?.type === 'User' &&
      approvers.includes(user.login) &&
      body?.split(/\r?\n/).some((line) => line === receipt),
  )
}

function hasSecondApproval(reviews, headSha, author, approvers) {
  const latestByReviewer = new Map()
  for (const review of reviews) {
    const login = review.user?.login
    if (
      review.user?.type !== 'User' ||
      login === author ||
      !approvers.includes(login)
    )
      continue
    const previous = latestByReviewer.get(login)
    if (
      !previous ||
      (review.submitted_at ?? '') >= (previous.submitted_at ?? '')
    )
      latestByReviewer.set(login, review)
  }
  return [...latestByReviewer.values()].some(
    ({ state, commit_id: commitId }) =>
      state === 'APPROVED' && commitId === headSha,
  )
}

export function decidePullRequest({
  labels,
  headSha,
  author,
  files,
  comments,
  reviews,
  approvers,
  qaApprovers = approvers,
}) {
  if (
    !Array.isArray(labels) ||
    !Array.isArray(files) ||
    !Array.isArray(comments) ||
    !Array.isArray(reviews) ||
    !Array.isArray(approvers) ||
    !Array.isArray(qaApprovers) ||
    !headSha ||
    !author ||
    files.length === 0
  )
    return { ok: false, reason: 'pull request metadata is incomplete' }

  const carried = new Set(labels)
  const blocking = HARD_BLOCKS.filter((label) => carried.has(label))
  if (blocking.length > 0)
    return { ok: false, reason: `pull request carries ${blocking.join(', ')}` }

  const risks = RISK_LABELS.filter((label) => carried.has(label))
  if (risks.length !== 1)
    return { ok: false, reason: 'pull request needs exactly one risk label' }

  const touched = paths(files)
  if (
    risks[0] !== 'risk-high' &&
    (carried.has('security') || touched.some(isHighRiskPath))
  )
    return { ok: false, reason: 'protected path requires risk-high' }

  if (carried.has('needs-qa')) {
    if (!carried.has('qa-approved'))
      return { ok: false, reason: 'needs-qa lacks qa-approved' }
    if (!hasHeadComment(comments, 'QA head', headSha, qaApprovers))
      return { ok: false, reason: 'QA evidence does not name the current head' }
  }

  if (risks[0] === 'risk-high') {
    if (
      !carried.has('risk-approved') ||
      !hasHeadComment(comments, 'Risk approval', headSha, approvers)
    )
      return {
        ok: false,
        reason: 'risk-high needs human approval for the current head',
      }

    if (
      touched.some(needsSecondReview) &&
      !hasSecondApproval(reviews, headSha, author, approvers)
    )
      return {
        ok: false,
        reason: 'auth or money change needs a second human reviewer',
      }
  }

  return { ok: true, reason: 'risk, QA, and hard-block policy passed' }
}

export function hasCezarReview(comments, headSha, reviewerActors) {
  return hasHeadComment(comments, 'Cezar review', headSha, reviewerActors)
}

export function mayAutoMerge({ base, draft, labels, policy, reviewedHead }) {
  const carried = new Set(labels)
  return (
    base === 'develop' &&
    !draft &&
    policy.ok &&
    reviewedHead === true &&
    carried.has('merge-queue') &&
    !HARD_BLOCKS.some((label) => carried.has(label)) &&
    !carried.has('risk-high') &&
    !carried.has('needs-qa')
  )
}
