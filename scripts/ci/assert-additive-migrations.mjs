#!/usr/bin/env node

/**
 * Asserts the committed drizzle journal is a unique sequential chain and that SQL this branch
 * adds (relative to BASE, default origin/develop) is additive: no DROP TABLE rebuild, no DROP
 * COLUMN. Snapshot N's prevId must equal snapshot N-1's id — the defect stacked PRs hit when
 * two migrations fork from the same parent (#759: rebase then `pnpm db:generate`).
 *
 *   node scripts/ci/assert-additive-migrations.mjs
 *   BASE=origin/develop node scripts/ci/assert-additive-migrations.mjs
 *
 * Exit 0 when the tree is clean, 1 with a readable list of faults.
 */

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DRIZZLE = join(ROOT, 'drizzle')
const JOURNAL = join(DRIZZLE, 'meta', '_journal.json')

// `DROP TABLE` opens a statement, but `DROP COLUMN` follows `ALTER TABLE <name>`, so the match is
// not anchored to the start of a line. Comments are stripped first: drizzle's own rebuild notes
// quote `DROP TABLE` in prose.
const DROP_RE = /\bDROP\s+(TABLE|COLUMN)\b/i
const SQL_LINE_COMMENT_RE = /--.*$/gm

/**
 * @param {string} journalJson
 * @returns {string[]}
 */
export function journalFaults(journalJson) {
  const faults = []
  const journal = JSON.parse(journalJson)
  const entries = journal.entries
  if (!Array.isArray(entries) || entries.length === 0) {
    return ['drizzle/meta/_journal.json has no entries']
  }
  const idxs = entries.map((e) => e.idx)
  const tags = entries.map((e) => e.tag)
  const uniqueIdx = new Set(idxs)
  if (uniqueIdx.size !== idxs.length) {
    faults.push(`journal idx is not unique: ${idxs.join(', ')}`)
  }
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].idx !== i) {
      faults.push(
        `journal idx ${entries[i].idx} at position ${i}; expected ${i}`,
      )
    }
  }
  const uniqueTags = new Set(tags)
  if (uniqueTags.size !== tags.length) {
    faults.push(`journal tag is not unique: ${tags.join(', ')}`)
  }
  return faults
}

/**
 * @param {Array<{ file: string, id: string, prevId: string }>} snapshots oldest-first
 * @returns {string[]}
 */
export function snapshotChainFaults(snapshots) {
  const faults = []
  if (snapshots.length === 0) return ['no drizzle/meta/*_snapshot.json files']
  const ZERO = '00000000-0000-0000-0000-000000000000'
  if (snapshots[0].prevId !== ZERO) {
    faults.push(
      `${snapshots[0].file} prevId is ${snapshots[0].prevId}; expected the zero UUID`,
    )
  }
  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1]
    const cur = snapshots[i]
    if (cur.prevId !== prev.id) {
      faults.push(
        `${cur.file} prevId is ${cur.prevId}; expected ${prev.id} from ${prev.file}. Rebase onto the base branch and run pnpm db:generate.`,
      )
    }
  }
  return faults
}

/**
 * @param {string} sql
 * @param {string} file
 * @returns {string[]}
 */
export function sqlAdditiveFaults(sql, file) {
  const faults = []
  if (DROP_RE.test(sql.replace(SQL_LINE_COMMENT_RE, ''))) {
    faults.push(
      `${file} contains DROP TABLE or DROP COLUMN; migrations are additive (docs/DEPLOY.md §4.1). A rebuild belongs on a later release after readers have moved.`,
    )
  }
  return faults
}

function git(args) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function addedSqlFiles(base) {
  let out
  try {
    out = git([
      'diff',
      '--name-only',
      '--diff-filter=A',
      `${base}...HEAD`,
      '--',
      'drizzle',
    ])
  } catch (error) {
    // A gate that cannot see the diff must not pass: an empty list would read as "no SQL added".
    console.error(
      `cannot diff ${base}...HEAD (fetch the base branch or set BASE): ${error.message}`,
    )
    process.exit(1)
  }
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.endsWith('.sql'))
}

export function loadSnapshots(drizzleDir = DRIZZLE) {
  const meta = join(drizzleDir, 'meta')
  return readdirSync(meta)
    .filter((f) => f.endsWith('_snapshot.json'))
    .sort()
    .map((file) => {
      const snap = JSON.parse(readFileSync(join(meta, file), 'utf8'))
      return { file, id: snap.id, prevId: snap.prevId }
    })
}

function main() {
  const faults = []
  faults.push(...journalFaults(readFileSync(JOURNAL, 'utf8')))
  faults.push(...snapshotChainFaults(loadSnapshots()))
  const base = process.env.BASE || 'origin/develop'
  for (const file of addedSqlFiles(base)) {
    faults.push(
      ...sqlAdditiveFaults(readFileSync(join(ROOT, file), 'utf8'), file),
    )
  }
  if (faults.length > 0) {
    for (const f of faults) console.error(f)
    process.exit(1)
  }
  console.log('drizzle journal, snapshot chain and added SQL are additive')
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main()
}
