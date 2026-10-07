#!/usr/bin/env node

/**
 * Writes the one test-report comment a pull request carries, and keeps it current.
 *
 *   PR_NUMBER=<n> HEAD_SHA=<sha> RUN_URL=<url> UNIT_RESULT=<result> E2E_RESULT=<result> \
 *     GH_TOKEN=<token> GH_REPO=<owner/repo> node scripts/ci/test-report.mjs merged-results.json
 *
 * The comment is the evidence a reviewer reads instead of the checks tab: which commit it speaks
 * for, whether the unit suite passed, and how many browser journeys passed, failed, were flaky or
 * skipped, counted from Playwright's merged JSON report. It is found again by `MARKER` and edited
 * in place, so a pull request never collects one comment per push. Nothing gates on it.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const MARKER = '<!-- ci-test-report -->'

const ICON = { success: '✅', failure: '❌', cancelled: '⚪', skipped: '⏭️' }

/** `needs.<job>.result` as one cell: an icon and the word, unknown values shown as they are. */
export function describeResult(result) {
  if (!result) return 'no result'
  return `${ICON[result] ?? '❔'} ${result}`
}

/**
 * Counts from Playwright's JSON report (`stats`), or null when there is none to read. A missing
 * file means the legs produced no blob, which the comment says rather than hides.
 */
export function readStats(report) {
  const stats = report?.stats
  if (!stats) return null
  return {
    passed: stats.expected ?? 0,
    failed: stats.unexpected ?? 0,
    flaky: stats.flaky ?? 0,
    skipped: stats.skipped ?? 0,
  }
}

/** The comment body. Same sections in every repository that carries this script. */
export function renderComment({ sha, runUrl, unitResult, e2eResult, stats }) {
  const e2e = stats
    ? `${describeResult(e2eResult)} - ${stats.passed} passed, ${stats.failed} failed, ${stats.flaky} flaky, ${stats.skipped} skipped`
    : `${describeResult(e2eResult)} - no report was produced`
  return [
    MARKER,
    '### Test report',
    '',
    `Commit \`${sha.slice(0, 7)}\` ([run](${runUrl}))`,
    '',
    '| Suite | Result |',
    '| --- | --- |',
    `| Unit tests · coverage | ${describeResult(unitResult)} |`,
    `| E2E journeys | ${e2e} |`,
    '',
  ].join('\n')
}

function gh(args, input) {
  return execFileSync('gh', args, { encoding: 'utf8', input })
}

function main(reportPath) {
  const { PR_NUMBER, HEAD_SHA, RUN_URL, UNIT_RESULT, E2E_RESULT, GH_REPO } =
    process.env
  let report = null
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'))
  } catch {
    // No report: the body says so.
  }
  const body = renderComment({
    sha: HEAD_SHA,
    runUrl: RUN_URL,
    unitResult: UNIT_RESULT,
    e2eResult: E2E_RESULT,
    stats: readStats(report),
  })

  const comments = JSON.parse(
    gh([
      'api',
      '--paginate',
      '--slurp',
      `repos/${GH_REPO}/issues/${PR_NUMBER}/comments`,
    ]),
  ).flat()
  const existing = comments.find((comment) => comment.body?.startsWith(MARKER))
  const payload = JSON.stringify({ body })
  if (existing) {
    gh(
      [
        'api',
        '-X',
        'PATCH',
        `repos/${GH_REPO}/issues/comments/${existing.id}`,
        '--input',
        '-',
      ],
      payload,
    )
  } else {
    gh(
      [
        'api',
        '-X',
        'POST',
        `repos/${GH_REPO}/issues/${PR_NUMBER}/comments`,
        '--input',
        '-',
      ],
      payload,
    )
  }
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  main(process.argv[2])
}
