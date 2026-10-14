#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'

// Remove fenced blocks before inline spans. Matching delimiter lengths matter: a shorter
// backtick run inside a span or fence cannot end it and expose an example closing keyword.
// Non-whitespace placeholders prevent removed code from joining a keyword to a distant #N.
function prose(text) {
  let fence
  const lines = String(text ?? '')
    .split('\n')
    .map((line) => {
      const content = line.replace(/^(?: {0,3}> ?)+/, '')
      const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(content)
      if (fence) {
        if (
          delimiter &&
          delimiter[1][0] === fence[0] &&
          delimiter[1].length >= fence.length &&
          !delimiter[2].trim()
        )
          fence = undefined
        return '\uFFFC'
      }
      if (delimiter) {
        fence = delimiter[1]
        return '\uFFFC'
      }
      if (/^(?: {4}| *\t)/.test(content)) return '\uFFFC'
      return line
    })
    .join('\n')
  const runs = [...lines.matchAll(/`+/g)]
  const nextByLength = new Map()
  const closing = new Map()
  for (let i = runs.length - 1; i >= 0; i--) {
    const length = runs[i][0].length
    closing.set(i, nextByLength.get(length))
    nextByLength.set(length, i)
  }
  let result = ''
  let cursor = 0
  for (let i = 0; i < runs.length; i++) {
    const end = closing.get(i)
    if (end === undefined) continue
    result += lines.slice(cursor, runs[i].index) + '\uFFFC'
    cursor = runs[end].index + runs[end][0].length
    i = end
  }
  return result + lines.slice(cursor)
}

export function parseCloseLinks({ title, body }) {
  const numbers = new Set()
  for (const text of [title, body]) {
    for (const match of prose(text).matchAll(
      /(?:^|[^\p{L}\p{N}_])(?:fix|fixes|fixed|close|closes|closed|resolve|resolves|resolved)\s+#(\d+)/giu,
    )) {
      const number = Number(match[1])
      if (Number.isSafeInteger(number) && number > 0) numbers.add(number)
    }
  }
  return [...numbers]
}

export function planClose(pr, issue, { baseBranch, repo }) {
  if (
    issue.url &&
    issue.url !== `https://github.com/${repo}/issues/${issue.number}`
  )
    return {
      action: 'skip',
      reason: 'The reference is not an issue in the selected repository.',
    }
  if (pr.headRefName?.startsWith('spec/'))
    return {
      action: 'skip',
      reason: 'The PR is design-only; its implementation issue must stay open.',
    }
  if (!pr.mergedAt || pr.isDraft)
    return { action: 'skip', reason: 'The PR is not a merged, non-draft PR.' }
  if (!parseCloseLinks(pr).includes(issue.number))
    return {
      action: 'skip',
      reason: 'The PR has no explicit closing keyword for this issue.',
    }
  if (issue.state !== 'OPEN')
    return { action: 'skip', reason: 'The issue is already closed.' }
  const label = issue.labels.find(({ name }) =>
    ['do-not-close', 'blocked', 'in-progress'].includes(name),
  )
  if (label)
    return {
      action: 'skip',
      reason: `The issue carries the ${label.name} label.`,
    }
  return pr.baseRefName === baseBranch
    ? {
        action: 'close',
        reason: 'The PR merged into the configured base branch.',
      }
    : {
        action: 'comment',
        reason: 'The PR merged into a different branch; the issue stays open.',
      }
}

function issueComment(pr, { repo, baseBranch }, action) {
  const url = `https://github.com/${repo}/pull/${pr.number}`
  const marker = `<!-- om-close-fixed-issues:pr-${pr.number}:${action} -->`
  const body =
    action === 'close'
      ? `✅ Fixed by #${pr.number} (${url}) — merged at ${pr.mergedAt} (commit \`${pr.mergeCommit.oid.slice(0, 7)}\`).\n\nClosed automatically by the \`om-close-fixed-issues\` skill.\n\nIf this is incorrect, reopen the issue and add the \`do-not-close\` label so future runs leave it alone.`
      : `ℹ️ #${pr.number} (${url}) references this issue and was merged into \`${pr.baseRefName}\`, which is not the configured base branch (\`${baseBranch}\`). Leaving this issue open until the change lands on \`${baseBranch}\`.\n\nPosted automatically by the \`om-close-fixed-issues\` skill.`
  return { marker, body: `${body}\n\n${marker}` }
}

export function reconcilePair(pr, number, options, tracker) {
  // Re-read each pair, including repeated references in the same sweep, to honor fresh locks.
  const issue = tracker.getIssue(number)
  const plan = planClose(pr, issue, options)
  if (plan.action === 'skip') return plan
  const { marker, body } = issueComment(pr, options, plan.action)
  const posted = issue.comments.some(
    (comment) =>
      comment.author?.login === options.currentUser &&
      comment.body.includes(marker),
  )
  if (options.apply) {
    // Comment first: if closing fails, retry only the close; closed issues never lack context.
    if (!posted) tracker.comment(number, body)
    if (plan.action === 'close') tracker.close(number)
  }
  return { ...plan, commentNeeded: !posted }
}

function validDate(value) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  )
}

export function latestReleaseDate(changelog) {
  const heading = changelog.match(/^# \d+\.\d+\.\d+[^\n]*$/m)?.[0]
  const date = heading?.match(/\((\d{4}-\d{2}-\d{2})\)\s*$/)?.[1]
  if (!date || !validDate(date))
    throw new Error(
      'Cannot resolve the latest release date from CHANGELOG.md; pass --since YYYY-MM-DD explicitly.',
    )
  return date
}

export function parseOptions(args) {
  const { values } = parseArgs({
    args,
    options: {
      apply: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      since: { type: 'string' },
      limit: { type: 'string', default: '100' },
      repo: { type: 'string' },
    },
  })
  const since = values.since ?? 'last-release'
  if (since !== 'last-release' && !validDate(since))
    throw new Error('--since must be last-release or a valid YYYY-MM-DD date.')
  if (
    !/^[1-9]\d*$/.test(values.limit) ||
    !Number.isSafeInteger(Number(values.limit))
  )
    throw new Error('--limit must be a positive integer.')
  if (values.repo && !/^[\w.-]+\/[\w.-]+$/.test(values.repo))
    throw new Error('--repo must be owner/name.')
  return {
    since,
    limit: values.limit,
    repo: values.repo,
    apply: Boolean(values.apply && !values['dry-run']),
  }
}

function main() {
  const options = parseOptions(process.argv.slice(2))
  if (options.since === 'last-release') {
    let changelog
    try {
      changelog = readFileSync(
        new URL('../../CHANGELOG.md', import.meta.url),
        'utf8',
      )
    } catch {
      throw new Error(
        'Cannot read CHANGELOG.md; pass --since YYYY-MM-DD explicitly.',
      )
    }
    options.since = latestReleaseDate(changelog)
  }
  const config = JSON.parse(
    readFileSync(
      new URL('../../.ai/agentic.config.json', import.meta.url),
      'utf8',
    ),
  )
  if (typeof config.baseBranch !== 'string' || !config.baseBranch)
    throw new Error('Missing configured baseBranch.')
  options.baseBranch = config.baseBranch
  const gh = (args, input) => {
    try {
      return execFileSync('gh', args, {
        encoding: 'utf8',
        input,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch {
      // Never echo command payloads or upstream errors: either can include tracker secrets.
      throw new Error(`GitHub operation failed: ${args.slice(0, 2).join(' ')}`)
    }
  }
  options.repo ??= JSON.parse(
    gh(['repo', 'view', '--json', 'nameWithOwner']),
  ).nameWithOwner
  options.currentUser = gh(['api', 'user', '--jq', '.login']).trim()
  const scope = ['--repo', options.repo]
  console.log(
    `${options.apply ? 'APPLY' : 'DRY-RUN'}: ${options.repo}, base ${options.baseBranch}, since ${options.since}, limit ${options.limit}`,
  )
  const prs = JSON.parse(
    gh([
      'pr',
      'list',
      ...scope,
      '--state',
      'merged',
      '--search',
      `merged:>=${options.since}`,
      '--limit',
      options.limit,
      '--json',
      'number,title,body,mergedAt,mergeCommit,baseRefName,headRefName,isDraft',
    ]),
  )
  if (prs.length === Number(options.limit))
    console.log(
      'The PR limit was reached; increase --limit to inspect the complete window.',
    )
  const tracker = {
    getIssue: (number) =>
      JSON.parse(
        gh([
          'issue',
          'view',
          String(number),
          ...scope,
          '--json',
          'number,state,url,labels,comments',
        ]),
      ),
    comment: (number, body) =>
      gh(
        ['issue', 'comment', String(number), ...scope, '--body-file', '-'],
        body,
      ),
    close: (number) =>
      gh(['issue', 'close', String(number), ...scope, '--reason', 'completed']),
  }
  let failed = 0
  for (const pr of prs) {
    const numbers = parseCloseLinks(pr)
    if (!numbers.length)
      console.log(
        `#${pr.number}: skipped; no explicit closing keywords outside code.`,
      )
    for (const number of numbers) {
      try {
        const plan = reconcilePair(pr, number, options, tracker)
        console.log(
          `#${pr.number} → #${number}: ${plan.action}. ${plan.reason}`,
        )
        if (!options.apply) {
          if (plan.commentNeeded)
            console.log(
              `DRY-RUN: comment on #${number} with the link to PR #${pr.number}.`,
            )
          if (plan.action === 'close')
            console.log(`DRY-RUN: close #${number} with reason completed.`)
        }
      } catch (error) {
        failed++
        console.error(`#${pr.number} → #${number}: ${error.message}`)
      }
    }
  }
  console.log(
    `close-fixed-issues: ${prs.length} merged PR(s) inspected, ${failed} failure(s).`,
  )
  if (failed) process.exitCode = 1
}

// Imports are pure: only direct execution may access the tracker.
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
