/**
 * The ladder script's own regression test. It exists because the failure mode it guards is silent:
 * `validate.sh` declared `--reporter` three times, Playwright kept only the last one (`html`),
 * `test-results/results.json` was never written, and every red e2e run produced
 * `"e2e":{"failed":[]}`. Nothing complained — the fix agent was simply handed no spec names, and the
 * intended-visual-change branch in `main.ts`, which needs a non-empty `failed`, could never fire.
 *
 * So the script is driven for real: a scratch git repo, a `pnpm` stub on PATH that records the
 * argument vector Playwright would have been given and can be told to fail with or without writing
 * a results file, and the verdict JSON read back off disk. The script's text is copied, never
 * asserted on: an assertion over the source goes red on a reformat and stays green on a behaviour
 * change, which is the wrong way round for a guard against silence.
 */
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

// Every case below builds a scratch git repo and runs a shell script in it, so a case costs
// several process spawns rather than a few microseconds of JavaScript. Vitest's 5 s default is a
// bound calibrated on an idle laptop: on a busy machine — or a two-core CI runner — the spawns
// alone can outrun it, and the suite then goes red for a reason that has nothing to do with
// `validate.sh`. The generous bound is not a performance claim; it is the absence of one.
vi.setConfig({ testTimeout: 60_000 })

const VALIDATE_SH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'validate.sh',
)
const SCRIPT = readFileSync(VALIDATE_SH, 'utf8')

/** The shape `main.ts` parses out of `.sandcastle-validation.json`. Do not widen. */
type Validation = {
  uiTouched: boolean
  e2eProjects: string[]
  steps: Array<{ name: string; ok: boolean; durationMs: number }>
  e2e: {
    failed: Array<{ title: string; error: string; snapshotDiff: boolean }>
  }
  ok: boolean
}

type Run = {
  status: number
  stderr: string
  verdict: Validation
  /** What `pnpm exec …` was called with, minus the `exec`; empty when Playwright never ran. */
  pwArgs: string[]
  /** The variables the script exported for Playwright, as the stub saw them. */
  pwEnv: Record<string, string>
}

const scratchDirs: string[] = []
afterEach(() => {
  for (const dir of scratchDirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

/** A results.json in the shape the Playwright JSON reporter writes: suites nested inside suites. */
const RESULTS_FIXTURE = JSON.stringify({
  config: { version: '1.62.1' },
  suites: [
    {
      title: 'e2e/visual.spec.ts',
      file: 'e2e/visual.spec.ts',
      specs: [],
      suites: [
        {
          title: 'planner',
          specs: [
            {
              title: 'passes',
              ok: true,
              tests: [{ results: [{ status: 'passed' }] }],
            },
            {
              title:
                'the hover card never lands on the panel it would hide behind',
              ok: false,
              tests: [
                {
                  results: [
                    {
                      status: 'failed',
                      error: {
                        message:
                          'Error: expect(page).toHaveScreenshot(planner.png)\n\n  12345 pixels differ',
                      },
                    },
                  ],
                },
              ],
            },
            {
              title: 'the trip tab is remembered',
              ok: false,
              tests: [
                {
                  results: [
                    {
                      status: 'failed',
                      error: {
                        message:
                          'Error: expect(received).toBe(expected)\n\n  at e2e/trips-core.visual.spec.ts:41',
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
})

const PNPM_STUB = `#!/usr/bin/env bash
# Every ladder step is \`pnpm <script>\` and succeeds silently; only the Playwright invocation is
# interesting, so it records its own argv and the two variables the script exports for it.
# Every PW_* variable is set unconditionally by runValidate below, so this stub needs no shell
# defaults — which also keeps \`\${…}\` out of the JS template literal that carries it.
if [ "$1" = "exec" ]; then
  shift
  printf '%s\\n' "$@" > "$PW_ARGV_FILE"
  printf '%s\\n' "PLAYWRIGHT_JSON_OUTPUT_NAME=$PLAYWRIGHT_JSON_OUTPUT_NAME" \\
    "PLAYWRIGHT_BASE_URL=$PLAYWRIGHT_BASE_URL" > "$PW_ENV_FILE"
  if [ -n "$PW_RESULTS" ]; then mkdir -p test-results; cp "$PW_RESULTS" test-results/results.json; fi
  echo "Running 169 tests using 4 workers"
  exit "$PW_EXIT"
fi
exit 0
`

/**
 * The ambient environment with git neutralised, so the scratch repo cannot reach this one. A git
 * hook exports `GIT_DIR` and `GIT_INDEX_FILE`: under husky's pre-commit run the scratch `git init`
 * would otherwise land on *this* checkout's git directory — which is how `core.bare = true` gets
 * written into a repo that has a working tree. The two `GIT_CONFIG_*` overrides keep `git init`
 * and the commit off the user's global config as well, and the identity below is supplied here
 * rather than by `git config` so that the scratch commit writes nothing anywhere.
 */
const BASE_ENV: NodeJS.ProcessEnv = {
  // `Object.fromEntries` types its result as a bare string map, which drops the
  // worker keys `worker-configuration.d.ts` declares on `ProcessEnv`. Nothing
  // is actually lost — the filter only removes `GIT_*` — so the assertion
  // restores what the signature erased rather than claiming anything new.
  ...(Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  ) as NodeJS.ProcessEnv),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'Ralph',
  GIT_AUTHOR_EMAIL: 'ralph@example.com',
  GIT_COMMITTER_NAME: 'Ralph',
  GIT_COMMITTER_EMAIL: 'ralph@example.com',
}

function readLines(path: string): string[] {
  try {
    return readFileSync(path, 'utf8').split('\n').filter(Boolean)
  } catch {
    return []
  }
}

/**
 * The `KEY=value` lines the stub recorded, keyed by name — so a variable the script forgot to
 * export reads back as absent rather than shunting the next one into its place.
 */
function readEnvFile(path: string): Record<string, string> {
  return Object.fromEntries(
    readLines(path).map((line) => {
      const eq = line.indexOf('=')
      return [line.slice(0, eq), line.slice(eq + 1)]
    }),
  )
}

/**
 * Runs the real script inside a scratch repo. `pwExit` is what the Playwright stub exits with,
 * `results` is what that stub writes to `test-results/results.json`, and `staleResults` is a file
 * left behind by an earlier run before this one starts. `touch` commits those paths on a branch
 * off `main` so the UI-touched heuristic has a real diff to read; `forceE2e` defaults to true so
 * that every other test reaches the Playwright step whatever it touched, and the heuristic's own
 * tests set it false to let it decide.
 */
function runValidate(
  opts: {
    pwExit?: number
    results?: string
    staleResults?: string
    touch?: string[]
    forceE2e?: boolean
    e2eProjects?: string
    updateSnapshots?: boolean
  } = {},
): Run {
  const { forceE2e = true } = opts
  const dir = mkdtempSync(join(tmpdir(), 'validate-sh-'))
  scratchDirs.push(dir)
  // Loudly, because a git call that silently fails here leaves every later assertion reading a
  // verdict produced by a script that never got past its first step.
  const git = (...args: string[]) => {
    const out = spawnSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      env: BASE_ENV,
    })
    if (out.status !== 0)
      throw new Error(
        `git ${args.join(' ')} failed in the scratch repo: ${out.stderr}`,
      )
  }
  git('init', '-q', '-b', 'main')
  git('commit', '-q', '--allow-empty', '-m', 'base')
  // Before the harness writes its own files, so the committed diff is exactly what was asked for.
  if (opts.touch?.length) {
    git('checkout', '-q', '-b', 'work')
    for (const path of opts.touch) {
      mkdirSync(join(dir, dirname(path)), { recursive: true })
      writeFileSync(join(dir, path), '// touched\n')
    }
    git('add', '-A')
    git('commit', '-q', '-m', 'touch')
  }

  mkdirSync(join(dir, '.sandcastle'))
  writeFileSync(join(dir, '.sandcastle', 'validate.sh'), SCRIPT)
  writeFileSync(
    join(dir, '.sandcastle', 'setup-e2e.sh'),
    '#!/usr/bin/env bash\nexit 0\n',
  )

  const bin = join(dir, 'bin')
  mkdirSync(bin)
  const stub = join(bin, 'pnpm')
  writeFileSync(stub, PNPM_STUB)
  chmodSync(stub, 0o755)

  const argvFile = join(dir, 'pw-argv.txt')
  const envFile = join(dir, 'pw-env.txt')
  let resultsFile = ''
  if (opts.results !== undefined) {
    resultsFile = join(dir, 'results-fixture.json')
    writeFileSync(resultsFile, opts.results)
  }
  if (opts.staleResults !== undefined) {
    mkdirSync(join(dir, 'test-results'))
    writeFileSync(join(dir, 'test-results', 'results.json'), opts.staleResults)
  }

  const run = spawnSync(
    'bash',
    [
      '.sandcastle/validate.sh',
      '--json-out',
      '.sandcastle-validation.json',
      ...(forceE2e ? ['--force-e2e'] : []),
      ...(opts.e2eProjects === undefined
        ? []
        : ['--e2e-projects', opts.e2eProjects]),
      ...(opts.updateSnapshots === true ? ['--update-snapshots'] : []),
    ],
    {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...BASE_ENV,
        PATH: `${bin}:${BASE_ENV.PATH ?? ''}`,
        TARGET_BRANCH: 'main',
        PW_ARGV_FILE: argvFile,
        PW_ENV_FILE: envFile,
        PW_EXIT: String(opts.pwExit ?? 0),
        PW_RESULTS: resultsFile,
      },
    },
  )

  return {
    status: run.status ?? -1,
    stderr: run.stderr,
    verdict: JSON.parse(
      readFileSync(join(dir, '.sandcastle-validation.json'), 'utf8'),
    ) as Validation,
    pwArgs: readLines(argvFile),
    pwEnv: readEnvFile(envFile),
  }
}

describe('the Playwright reporter declaration', () => {
  it('reaches the runner as a single argument, alongside the JSON output path', () => {
    // Playwright's CLI takes `--reporter <reporter>` as one comma-separated value, so a repeated
    // flag is not a list: the last occurrence wins and the others are dropped. Asserted on the
    // argv the runner was handed, which is the thing that decides whether results.json is written
    // — a second declaration anywhere in the script would show up here as a second element.
    const run = runValidate()
    expect(run.pwArgs.filter((a) => a.startsWith('--reporter'))).toEqual([
      '--reporter=line,json,html',
    ])
    expect(run.pwArgs).toContain('--workers=4')
    expect(run.pwEnv).toEqual({
      PLAYWRIGHT_JSON_OUTPUT_NAME: 'test-results/results.json',
      PLAYWRIGHT_BASE_URL: 'http://localhost:3010',
    })
  })
})

describe('the verdict of a red e2e step', () => {
  it('names every failing spec with its first error line and a snapshot flag', () => {
    const run = runValidate({ pwExit: 1, results: RESULTS_FIXTURE })

    expect(run.verdict.e2e.failed).toEqual([
      {
        title: 'the hover card never lands on the panel it would hide behind',
        error: 'Error: expect(page).toHaveScreenshot(planner.png)',
        snapshotDiff: true,
      },
      {
        title: 'the trip tab is remembered',
        error: 'Error: expect(received).toBe(expected)',
        snapshotDiff: false,
      },
    ])
    expect(run.verdict.ok).toBe(false)
    expect(run.status).toBe(1)
    expect(run.stderr).not.toMatch(/WARN: e2e/)
  })

  it('keeps the shape main.ts parses, and mirrors the verdict in its exit code', () => {
    const run = runValidate({ pwExit: 1, results: RESULTS_FIXTURE })

    expect(run.verdict.uiTouched).toBe(true)
    expect(run.verdict.steps.map((s) => s.name)).toEqual([
      'route-tree',
      'db-drift',
      'typecheck',
      'lint',
      'vitest',
      'e2e-env',
      'route-tree-after-dev',
      'e2e',
    ])
    expect(run.verdict.steps.filter((s) => !s.ok).map((s) => s.name)).toEqual([
      'e2e',
    ])
    for (const step of run.verdict.steps)
      expect(typeof step.durationMs).toBe('number')
  })

  it('warns on stderr, naming the file, when no results.json was written', () => {
    const run = runValidate({ pwExit: 1 })

    expect(run.stderr).toContain('test-results/results.json')
    expect(run.stderr).toMatch(/WARN/)
    expect(run.verdict.e2e.failed).toEqual([])
    expect(run.verdict.ok).toBe(false)
    expect(run.status).toBe(1)
  })

  it('ignores a results.json left behind by an earlier run', () => {
    // Playwright writes the file at the end of a run, so a crash before the reporter fires would
    // otherwise leave the previous iteration's failures standing in for this one's.
    const run = runValidate({ pwExit: 1, staleResults: RESULTS_FIXTURE })

    expect(run.verdict.e2e.failed).toEqual([])
    expect(run.stderr).toContain('test-results/results.json')
  })
})

describe('a green e2e step', () => {
  it('says nothing extra and exits zero', () => {
    const run = runValidate({ pwExit: 0 })

    expect(run.stderr).not.toMatch(/WARN/)
    expect(run.verdict).toMatchObject({ ok: true, e2e: { failed: [] } })
    expect(run.status).toBe(0)
  })
})

describe('the e2e rung', () => {
  it('is announced, and tails its log when red, like every other step', () => {
    // It used to be a hand-copy of run_step: its own `date` pair, its own tail redirect, its own
    // record_step call and its own failure header. Two copies of how a step is run is how they
    // drift, so this pins the observable half of the shared path — the announcement on both sides
    // and the log tail on the red one.
    const green = runValidate({ pwExit: 0 })
    expect(green.stderr).toContain('==> e2e OK')

    const red = runValidate({ pwExit: 1, results: RESULTS_FIXTURE })
    expect(red.stderr).toContain('==> STEP FAILED: e2e')
    // The tail is the line reporter's own output, which is what the warning points at when the
    // verdict can name nothing.
    expect(red.stderr).toContain('Running 169 tests using 4 workers')
  })
})

describe('the UI-touched heuristic', () => {
  // Untested until now, and its failure mode is the same silence #97 was: a path drops out of the
  // glob, e2e quietly stops running for a whole class of change, and the verdict is green.
  it('runs the suite for a change under src/components', () => {
    const run = runValidate({
      touch: ['src/components/trip-card.tsx'],
      forceE2e: false,
    })

    expect(run.verdict.uiTouched).toBe(true)
    expect(run.verdict.steps.map((s) => s.name)).toContain('e2e')
    expect(run.pwArgs).toContain('--workers=4')
  })

  it('skips it for a server-only change', () => {
    // Deliberate: server-only issues get vitest here and the full suite once per iteration from
    // the Auditor. See the heuristic's own comment.
    const run = runValidate({
      touch: ['src/server/repos/trips.ts'],
      forceE2e: false,
    })

    expect(run.verdict.uiTouched).toBe(false)
    expect(run.verdict.steps.map((s) => s.name)).toEqual([
      'route-tree',
      'db-drift',
      'typecheck',
      'lint',
      'vitest',
    ])
    expect(run.pwArgs).toEqual([])
    expect(run.status).toBe(0)
  })
})

/**
 * The fix loop re-validates on chromium alone and gates on mobile-safari once, so the flag that
 * narrows the matrix has to reach Playwright as a real project list — and the step has to say
 * which browsers it covered, or a verdict read hours later cannot be told from a full run.
 */
describe('--e2e-projects', () => {
  it('is absent by default, and the step is named `e2e`', () => {
    const run = runValidate()
    expect(run.pwArgs.filter((a) => a.startsWith('--project'))).toEqual([])
    expect(run.verdict.e2eProjects).toEqual([])
    expect(run.verdict.steps.map((s) => s.name)).toContain('e2e')
  })

  it('passes one --project per name and names the step after them', () => {
    // Repeated `--project` IS a list here, unlike `--reporter` above: Playwright declares it as
    // `--project <project-name...>`.
    const run = runValidate({ e2eProjects: 'chromium' })
    expect(run.pwArgs.filter((a) => a.startsWith('--project'))).toEqual([
      '--project=chromium',
    ])
    expect(run.verdict.e2eProjects).toEqual(['chromium'])
    expect(run.verdict.steps.map((s) => s.name)).toContain('e2e:chromium')
    expect(run.verdict.steps.map((s) => s.name)).not.toContain('e2e')
  })

  it('splits a comma-separated list', () => {
    const run = runValidate({ e2eProjects: 'chromium,mobile-safari' })
    expect(run.pwArgs.filter((a) => a.startsWith('--project'))).toEqual([
      '--project=chromium',
      '--project=mobile-safari',
    ])
    expect(run.verdict.e2eProjects).toEqual(['chromium', 'mobile-safari'])
  })

  it('still coexists with --update-snapshots', () => {
    // The re-record path runs the whole matrix, but nothing in the script should stop the two
    // flags being combined — and a future caller narrowing a re-record must not silently lose one.
    const run = runValidate({
      e2eProjects: 'mobile-safari',
      updateSnapshots: true,
    })
    expect(run.pwArgs).toContain('--update-snapshots')
    expect(run.pwArgs).toContain('--project=mobile-safari')
  })
})
