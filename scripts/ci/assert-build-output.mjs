#!/usr/bin/env node

/**
 * Checks the two things `pnpm build` must leave true, which `ci.yml` asserted after its build
 * step and the agent gate (ADR 0033) now asserts here. Run it straight after `pnpm build`:
 *
 *   node scripts/ci/assert-build-output.mjs
 *
 *   1. The build left `src/routeTree.gen.ts` alone. The TanStack Start plugin writes the same
 *      file `tsr generate` does; if the two ever drift, the build dirties the committed tree.
 *   2. The production build carries no end-to-end day pin. The plain build folds
 *      `__E2E_SERVER_TODAY__` to `undefined`; if the define leaked, the app would serve the
 *      baseline day as today's date while the suite, which pins that same day, kept passing.
 *      The day is read from `e2e/baseline-day.ts`, the one module that owns it.
 *
 * Exit 0 when both hold, 1 with the offending files otherwise.
 */

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DEFINE = '__E2E_SERVER_TODAY__'

/**
 * @param {string} source contents of e2e/baseline-day.ts
 * @returns {string}
 */
export function baselineDay(source) {
  const match = source.match(/^export const BASELINE_DAY = '(.*)'$/m)
  if (!match) throw new Error('BASELINE_DAY not found in e2e/baseline-day.ts')
  return match[1]
}

/**
 * @param {string} dir
 * @param {string} day
 * @returns {string[]} files under `dir` that contain the day or the define placeholder
 */
export function filesCarryingPin(dir, day) {
  const hits = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      hits.push(...filesCarryingPin(path, day))
      continue
    }
    const text = readFileSync(path, 'latin1')
    if (text.includes(day) || text.includes(DEFINE)) hits.push(path)
  }
  return hits
}

function main() {
  const faults = []
  try {
    execFileSync('git', ['diff', '--exit-code', '--', 'src/routeTree.gen.ts'], {
      cwd: ROOT,
      stdio: 'pipe',
    })
  } catch {
    faults.push(
      'the build changed src/routeTree.gen.ts (run pnpm generate-routes)',
    )
  }
  const day = baselineDay(
    readFileSync(join(ROOT, 'e2e', 'baseline-day.ts'), 'utf8'),
  )
  for (const file of filesCarryingPin(join(ROOT, 'dist'), day)) {
    faults.push(`${file} carries the end-to-end day pin (${day})`)
  }
  if (faults.length > 0) {
    for (const f of faults) console.error(f)
    process.exit(1)
  }
  console.log('build left the route tree alone and carries no pinned day')
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main()
}
