#!/usr/bin/env node

/**
 * Answers one question: is this repository's shared region of `SDLC.md` still identical to its
 * siblings'?
 *
 *   node scripts/docs/sdlc-shared-region.mjs        # or: pnpm sdlc:parity
 *
 * `SDLC.md` above the `BEGIN per-repo` marker is one document living in three repositories, and
 * `SDLC.md` itself is where that is written down: "a change above the marker is a change to every
 * repository that shares this document. Make it in all of them, or make it in `## This repository`
 * instead." Nothing enforced it, and the invariant has already failed silently - on the
 * convergence heads of #319 and design4pro/cezar#24 the three regions were 231 lines each and two
 * of them differed at line 132, which is a difference no size or line-count check can see. What
 * drifted was load-bearing: two of the three cited a spec file that exists in only one of them, so
 * an unattended agent in the other two followed that path to nothing. A reviewer reading the prose
 * caught it. A tool never would have, because there was no tool.
 *
 * ── Two things the ticket asked for that had to change (#323) ─────────────────────────────────
 *
 * **The truncation.** #323 names `sed '/BEGIN per-repo/,$d'` as "the existing truncation, the same
 * one the rule names". On the real file that pattern stops at line 7: `SDLC.md:7` and `:232` both
 * mention `BEGIN per-repo` in backticks, above the marker itself on line 236. So the recipe
 * compares six lines instead of 235 and reports green over any drift below them - worse than no
 * check, because it looks like coverage. `SDLC.md:232` names that trap in prose ("a second literal
 * copy of it above the real one is a false cut point") without noticing its own two mentions are
 * already it. The cut here is therefore the full literal marker line and nothing else, and
 * `sharedRegion` is the function that says so.
 *
 * **Which branch of a sibling to read.** #323 says "their own default branches (`develop` and
 * `design4pro`)". GitHub reports planned.travel's `default_branch` as `main`, not `develop`;
 * `develop` is its `baseBranch`. Taken literally the ticket would have this repository's `develop`
 * compared against planned.travel's released `main`, which lags by the whole promotion cycle and
 * would go red for the length of it. So the ref is read out of each sibling's own
 * `.ai/agentic.config.json` - the branch a shared-region change actually lands on first, named by
 * the repository it belongs to - and falls back to whatever GitHub calls default when that file is
 * unreadable. A table of branch names kept here would encode our belief about somebody else's
 * repository and go stale silently, which is exactly how the ticket came to state the wrong one.
 *
 * ── Failing, and when not to ──────────────────────────────────────────────────────────────────
 *
 * Drift exits 1. A sibling that cannot be read - private with no token, renamed, network down,
 * no marker in its file - is a **skip with its reason printed**, never a failure: this check
 * knows nothing about those repositories' availability and must not turn an outage into a red
 * build.
 *
 * The convergence window is handled by where the job sits, not by softening the verdict. While a
 * trio of shared-region pull requests is landing the regions legitimately differ, so this runs as
 * a **non-required** check: red is advisory, informs the reviewer, and blocks no merge. That keeps
 * the later promotion to a required check a ruleset edit rather than a code change, which a
 * warn-only script would not. Comparing against the pull request's base instead of the sibling tip
 * was the alternative and is worse: it answers "did this pull request introduce drift", and would
 * have stayed green through the entire period the three repositories actually were drifted.
 *
 * @see SDLC.md - the invariant, in the document it governs
 * @see https://github.com/design4pro/money-tracker.online/issues/323
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * The cut point: the whole literal line, never the bare phrase. `SDLC.md` mentions the phrase in
 * prose twice above this line on purpose, and matching the phrase would cut at the first of them.
 */
export const SHARED_REGION_MARKER = '<!-- BEGIN per-repo -->'

/** The repositories that share the region, `owner/name`. */
export const SIBLINGS = ['design4pro/planned.travel', 'design4pro/cezar']

/** Where each repository keeps the branch a shared-region change lands on first. */
const AGENTIC_CONFIG = '.ai/agentic.config.json'

/**
 * The shared region: every line above the marker line.
 *
 * @param {string} text a whole `SDLC.md`
 * @returns {string[] | null} the lines above the marker, or `null` when the file has no marker -
 *   which is a file this check cannot judge, not a file that fails it.
 */
export function sharedRegion(text) {
  const lines = text.split('\n')
  const marker = lines.findIndex((line) => line.trim() === SHARED_REGION_MARKER)
  return marker === -1 ? null : lines.slice(0, marker)
}

/**
 * The first line on which two regions disagree.
 *
 * Equal line counts are the case that matters: the drift that shipped had them, so comparing
 * lengths first - the tempting cheap check - would have passed it.
 *
 * @param {string[]} ours
 * @param {string[]} theirs
 * @returns {{ line: number, ours: string | null, theirs: string | null } | null} `null` when the
 *   regions are identical; otherwise the 1-based line and both texts, `null` on whichever side
 *   ran out of lines first.
 */
export function firstDifference(ours, theirs) {
  const length = Math.max(ours.length, theirs.length)
  for (let index = 0; index < length; index += 1) {
    if (ours[index] === theirs[index]) continue
    return {
      line: index + 1,
      ours: ours[index] ?? null,
      theirs: theirs[index] ?? null,
    }
  }
  return null
}

/**
 * The branch of a sibling to read, from its own `.ai/agentic.config.json`.
 *
 * @param {string | null} config the file's contents, or `null` when it could not be fetched
 * @returns {string | null} the branch named there, or `null` to mean "whatever GitHub calls this
 *   repository's default branch" - the honest fallback, since a sibling that keeps no such config
 *   has told us nothing to prefer over it.
 */
export function siblingRef(config) {
  if (!config) return null
  try {
    return JSON.parse(config).baseBranch ?? null
  } catch {
    return null
  }
}

/** A line of a region as it reads in a report; the side that ran out of lines says so. */
const show = (line) =>
  line === null ? '(end of region)' : JSON.stringify(line)

/**
 * What to say about one sibling.
 *
 * @param {string} repo `owner/name`
 * @param {string[]} ours this repository's shared region
 * @param {{ text: string } | { error: string }} fetched its `SDLC.md`, or why there is none
 * @returns {{ status: 'match' | 'drift' | 'skip', message: string }}
 */
export function verdict(repo, ours, fetched) {
  if ('error' in fetched && fetched.error)
    return { status: 'skip', message: `${repo} skipped: ${fetched.error}` }

  const theirs = sharedRegion(fetched.text)
  if (theirs === null)
    return {
      status: 'skip',
      message: `${repo} skipped: its SDLC.md carries no ${SHARED_REGION_MARKER} line, so it has no shared region to compare.`,
    }

  const difference = firstDifference(ours, theirs)
  if (!difference)
    return {
      status: 'match',
      message: `${repo} matches: ${ours.length} shared lines, identical.`,
    }

  return {
    status: 'drift',
    message: [
      `${repo} differs at line ${difference.line}:`,
      `  here:  ${show(difference.ours)}`,
      `  there: ${show(difference.theirs)}`,
    ].join('\n'),
  }
}

/**
 * One file from a sibling, through `gh` so the token and the API version are its problem.
 *
 * @returns {{ text: string } | { error: string }} every failure is data, because every failure
 *   here is a skip.
 */
function fetchFile(repo, path, ref) {
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : ''
  try {
    return {
      text: execFileSync(
        'gh',
        [
          'api',
          `repos/${repo}/contents/${path}${query}`,
          '-H',
          'Accept: application/vnd.github.raw',
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      ),
    }
  } catch (error) {
    const said = String(error.stderr || error.message || error)
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean)
    return { error: said ?? 'gh could not read it' }
  }
}

/** A GitHub Actions annotation; newlines have to be escaped or only the first line survives. */
function annotate(level, message) {
  const escaped = message.replaceAll('%', '%25').replaceAll('\n', '%0A')
  console.log(`::${level} title=SDLC shared region::${escaped}`)
}

const LEVELS = { match: 'notice', skip: 'warning', drift: 'error' }

function main() {
  const own = sharedRegion(readFileSync('SDLC.md', 'utf8'))
  if (own === null) {
    // Not a skip: our own file is the one file this repository is answerable for, and a missing
    // marker in it means the region has no boundary rather than that a sibling is unreachable.
    annotate(
      'error',
      `SDLC.md carries no ${SHARED_REGION_MARKER} line, so there is no shared region to compare.`,
    )
    return 1
  }

  console.log(
    `Comparing ${own.length} shared lines of SDLC.md against ${SIBLINGS.length} siblings.`,
  )

  let drifted = 0
  for (const repo of SIBLINGS) {
    const config = fetchFile(repo, AGENTIC_CONFIG, null)
    const ref = siblingRef('text' in config ? config.text : null)
    const { status, message } = verdict(
      repo,
      own,
      fetchFile(repo, 'SDLC.md', ref),
    )
    annotate(LEVELS[status], ref ? `${message}\n  (read from ${ref})` : message)
    if (status === 'drift') drifted += 1
  }

  if (drifted)
    console.log(
      'Make the change in every repository that shares the region, or move it below the marker into `## This repository` (SDLC.md, "Amending this process").',
    )
  return drifted ? 1 : 0
}

// Importing this file for its pure functions must not run the comparison - the same guard, for the
// same reason, as `scripts/ci/merge-gate.mjs`.
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
)
  process.exitCode = main()
