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

// Every test here runs the real script: bash, a scratch `git init`, a commit and a stub, several
// processes per case. That is comfortably under a second on an idle machine and well past vitest's
// 5 s default when the full suite runs it alongside everything else - a busy machine reading as a
// broken ladder. The budget is generous on purpose: what is being guarded here is the verdict, and
// nothing about how long bash took to produce it.
vi.setConfig({ testTimeout: 60_000 })

const VALIDATE_SH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'validate.sh',
)
const SCRIPT = readFileSync(VALIDATE_SH, 'utf8')

/** The shape `cez-ladder.sh` parses out of the verdict file. Do not widen. */
type Validation = {
  uiTouched: boolean
  e2eProjects: string[]
  steps: Array<{ name: string; ok: boolean; durationMs: number }>
  e2e: {
    failed: Array<{ title: string; error: string; snapshotDiff: boolean }>
  }
  infra: string | null
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
  /** One line per dev-server probe; empty when the ladder never asked. */
  curlCalls: string[]
}

const scratchDirs: string[] = []
afterEach(() => {
  for (const dir of scratchDirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

/** A results.json in the shape the Playwright JSON reporter writes: suites nested inside suites. */
function resultsJson(specs: Array<Record<string, unknown>>): string {
  return JSON.stringify({
    config: { version: '1.62.1' },
    suites: [
      {
        title: 'e2e/visual.spec.ts',
        file: 'e2e/visual.spec.ts',
        specs: [],
        suites: [{ title: 'planner', specs }],
      },
    ],
  })
}

/**
 * One spec as the reporter records it. `attempts` becomes its `results` array — one entry per
 * attempt, oldest first, each either `'passed'` or the message the attempt failed with — while
 * `ok` stays an explicit argument because it is the reporter's own verdict over all of them and
 * the one field the jq walk selects on.
 */
function spec(
  title: string,
  ok: boolean,
  attempts: Array<'passed' | { failedWith: string }>,
): Record<string, unknown> {
  return {
    title,
    ok,
    tests: [
      {
        results: attempts.map((attempt) =>
          attempt === 'passed'
            ? { status: 'passed' }
            : { status: 'failed', error: { message: attempt.failedWith } },
        ),
      },
    ],
  }
}

/** The failures the fixtures below are built from; the verdict quotes the first line of each. */
const PLANNER_PIXEL_DIFF =
  'Error: expect(page).toHaveScreenshot(planner.png)\n\n  12345 pixels differ'
const ITINERARY_PIXEL_DIFF =
  'Error: expect(page).toHaveScreenshot(itinerary.png)\n\n  99 pixels differ'
const ASSERTION_DIFF =
  'Error: expect(received).toBe(expected)\n\n  at e2e/trips-core.visual.spec.ts:41'
const CONNECTION_REFUSED =
  'Error: page.goto: Connection refused\n  at e2e/trips-core.visual.spec.ts:41'
const SOCKET_HANG_UP =
  'Error: page.goto: socket hang up\n  at e2e/trips-core.visual.spec.ts:41'

const RESULTS_FIXTURE = resultsJson([
  spec('passes', true, ['passed']),
  spec('the hover card never lands on the panel it would hide behind', false, [
    { failedWith: PLANNER_PIXEL_DIFF },
  ]),
  spec('the trip tab is remembered', false, [{ failedWith: ASSERTION_DIFF }]),
])

/**
 * A retried run, as the reporter records it: `results` grows one entry per attempt, oldest first,
 * and the spec's own `ok` is the verdict over all of them. The dev-server blip passes on its
 * second attempt; the pixel diff below does not.
 */
const RETRIED_BLIP = spec('the trip tab is remembered', true, [
  { failedWith: CONNECTION_REFUSED },
  'passed',
])

const RETRIED_REGRESSION = spec(
  'the hover card never lands on the panel it would hide behind',
  false,
  [{ failedWith: PLANNER_PIXEL_DIFF }, { failedWith: PLANNER_PIXEL_DIFF }],
)

/**
 * The mixed case the retry makes possible: a spec whose first attempt died on the transport and
 * whose second failed for real. Only the last attempt describes why the spec is red.
 */
const BLIPPED_THEN_REGRESSED = spec(
  'the itinerary day list keeps its order',
  false,
  [{ failedWith: SOCKET_HANG_UP }, { failedWith: ITINERARY_PIXEL_DIFF }],
)

/**
 * The dev-server probe the ladder runs after a red e2e rung. `CURL_EXIT` is what it reports:
 * 0 for a server that answered, non-zero for one that did not. Nothing else in the script calls
 * curl — `setup-e2e.sh` is stubbed out — so this stands in for exactly one question.
 */
const CURL_STUB = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$CURL_CALLS_FILE"
exit "$CURL_EXIT"
`

const PNPM_STUB = `#!/usr/bin/env bash
# Every ladder step is \`pnpm <script>\` and succeeds silently; only the Playwright invocation is
# interesting, so it records its own argv and the variables the script's environment carries into
# it. CI is among them because playwright.config.ts keys retries, workers, globalTimeout, the
# reporter list and the port guard off it: the script must set it for nothing, and an empty value
# here is how that reads back (runValidate strips CI from the ambient environment).
# Every PW_* variable is set unconditionally by runValidate below, so this stub needs no shell
# defaults — which also keeps \`\${…}\` out of the JS template literal that carries it.
if [ "$1" = "exec" ]; then
  shift
  printf '%s\\n' "$@" > "$PW_ARGV_FILE"
  printf '%s\\n' "PLAYWRIGHT_JSON_OUTPUT_NAME=$PLAYWRIGHT_JSON_OUTPUT_NAME" \\
    "PLAYWRIGHT_BASE_URL=$PLAYWRIGHT_BASE_URL" "CI=$CI" > "$PW_ENV_FILE"
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
 *
 * `CI` and `E2E_*` go for a different reason: they are the inputs under test. This suite runs on a
 * runner that sets `CI=true`, and inheriting it would make "the script sets CI for nothing"
 * unfalsifiable — every run would see one whether or not the script set it. Stripped here, anything
 * the stub reports came from the script.
 */
const isNeutralised = (key: string) =>
  key.startsWith('GIT_') || key.startsWith('E2E_') || key === 'CI'

const BASE_ENV: NodeJS.ProcessEnv = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !isNeutralised(key)),
  ),
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
 * tests set it false to let it decide. `env` is what an operator would put in front of the script.
 */
function runValidate(
  opts: {
    pwExit?: number
    results?: string
    staleResults?: string
    touch?: string[]
    forceE2e?: boolean
    e2eProjects?: string
    e2eGrep?: string
    updateSnapshots?: boolean
    env?: Record<string, string>
    /** Whether the dev-server probe finds anything answering; defaults to yes. */
    devServerUp?: boolean
    /**
     * Where both scripts are placed, relative to the scratch repo. The default is where the branch
     * keeps them; main.ts ships them to a directory outside the worktree, and the ladder must find
     * its sibling there too.
     */
    scriptDir?: string
  } = {},
): Run {
  const { forceE2e = true, scriptDir = 'scripts/agent' } = opts
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

  mkdirSync(join(dir, scriptDir), { recursive: true })
  writeFileSync(join(dir, scriptDir, 'validate.sh'), SCRIPT)
  writeFileSync(
    join(dir, scriptDir, 'setup-e2e.sh'),
    '#!/usr/bin/env bash\nexit 0\n',
  )

  const bin = join(dir, 'bin')
  mkdirSync(bin)
  const stub = join(bin, 'pnpm')
  writeFileSync(stub, PNPM_STUB)
  chmodSync(stub, 0o755)
  const curlStub = join(bin, 'curl')
  writeFileSync(curlStub, CURL_STUB)
  chmodSync(curlStub, 0o755)

  const argvFile = join(dir, 'pw-argv.txt')
  const envFile = join(dir, 'pw-env.txt')
  const curlCallsFile = join(dir, 'curl-calls.txt')
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
      `${scriptDir}/validate.sh`,
      '--json-out',
      '.agent-validation.json',
      ...(forceE2e ? ['--force-e2e'] : []),
      ...(opts.e2eProjects === undefined
        ? []
        : ['--e2e-projects', opts.e2eProjects]),
      ...(opts.e2eGrep === undefined ? [] : ['--e2e-grep', opts.e2eGrep]),
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
        ...opts.env,
        CURL_CALLS_FILE: curlCallsFile,
        CURL_EXIT: opts.devServerUp === false ? '7' : '0',
      },
    },
  )

  return {
    status: run.status ?? -1,
    stderr: run.stderr,
    verdict: JSON.parse(
      readFileSync(join(dir, '.agent-validation.json'), 'utf8'),
    ) as Validation,
    pwArgs: readLines(argvFile),
    pwEnv: readEnvFile(envFile),
    curlCalls: readLines(curlCallsFile),
  }
}

describe('the dev-server probe', () => {
  it('reports a server that stopped answering as infra rather than as a red branch', () => {
    // The failure this exists for: a dev server that ran out of heap mid-suite reddens the rung
    // with specs that never reached it, and `main.ts` spends a fix attempt on the phantom.
    const run = runValidate({
      pwExit: 1,
      results: RESULTS_FIXTURE,
      e2eProjects: 'chromium',
      devServerUp: false,
    })

    expect(run.verdict.ok).toBe(false)
    expect(run.verdict.infra).toMatch(/stopped answering during e2e:chromium/)
    // Named so a reader of the verdict alone knows which server is meant.
    expect(run.verdict.infra).toContain('http://127.0.0.1:3010')
    expect(run.stderr).toContain('INFRA:')
  })

  it('leaves a red rung red when the server is still there', () => {
    // The ordinary regression: the suite failed, the environment is fine, and the fix loop should
    // do exactly what it did before this probe existed.
    const run = runValidate({ pwExit: 1, results: RESULTS_FIXTURE })

    expect(run.verdict.ok).toBe(false)
    expect(run.verdict.infra).toBeNull()
    expect(run.verdict.e2e.failed).toHaveLength(2)
    expect(run.curlCalls).toHaveLength(1)
  })

  it('does not ask after a green rung', () => {
    // A suite that passed proves the server was up; asking again would spend a round trip to
    // learn nothing, and would let a server that died *after* the last spec redden a green run.
    const run = runValidate({ pwExit: 0, results: RESULTS_FIXTURE })

    expect(run.verdict.ok).toBe(true)
    expect(run.verdict.infra).toBeNull()
    expect(run.curlCalls).toEqual([])
  })

  it('reports no infra on a ladder that never ran e2e', () => {
    const run = runValidate({
      forceE2e: false,
      touch: ['src/server/repos/x.ts'],
    })

    expect(run.verdict.uiTouched).toBe(false)
    expect(run.verdict.infra).toBeNull()
    expect(run.curlCalls).toEqual([])
  })
})

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
    // The sandbox is not CI, so playwright.config.ts gives the suite no retries of its own; the
    // one that keeps a machine-load timeout from spending a fix attempt has to come from here.
    expect(run.pwArgs).toContain('--retries=1')
    expect(run.pwEnv).toEqual({
      PLAYWRIGHT_JSON_OUTPUT_NAME: 'test-results/results.json',
      PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:3010',
      CI: '',
    })
  })
})

describe('the e2e rung against a dev server that drops a connection', () => {
  // Four of the six failures on the run that filed issue #143 were transport, not product:
  // `page.goto: Connection refused`, `socket hang up`, `Connection reset by peer` — all of them
  // green on a re-run against the same server. The rung ran at four workers and zero retries,
  // strictly less tolerant than CI, which runs one worker with two.
  it('asks for a retry on the argv, and sets CI for no step', () => {
    const run = runValidate()

    expect(run.pwArgs).toContain('--retries=1')
    // Not `CI=1`: playwright.config.ts sells the retry bundled with the port guard its own comment
    // calls "a hard stop rather than a warning" and with a globalTimeout sized for one of ci.yml's
    // twelve shards. Empty because the harness strips CI, so a value here could only be the
    // script's.
    expect(run.pwEnv.CI).toBe('')
  })

  it('takes the count from E2E_RETRIES, including a deliberate zero', () => {
    // Same override convention as E2E_WORKERS. Zero has to be expressible: a run measuring flake
    // wants the intolerant gate back.
    expect(runValidate({ env: { E2E_RETRIES: '0' } }).pwArgs).toContain(
      '--retries=0',
    )
    expect(runValidate({ env: { E2E_RETRIES: '2' } }).pwArgs).toContain(
      '--retries=2',
    )
  })

  it('leaves the rung green when the retry passed, and names nothing', () => {
    // The blip is in results.json either way — the reporter keeps the failed first attempt — so
    // what decides is the spec's own `ok`, which the jq walk selects on.
    const run = runValidate({ pwExit: 0, results: resultsJson([RETRIED_BLIP]) })

    expect(run.verdict.e2e.failed).toEqual([])
    expect(run.verdict.ok).toBe(true)
    expect(run.status).toBe(0)
    expect(run.stderr).not.toMatch(/WARN/)
  })

  it('still fails, and still names, a spec that failed every attempt', () => {
    const run = runValidate({
      pwExit: 1,
      results: resultsJson([RETRIED_BLIP, RETRIED_REGRESSION]),
    })

    expect(run.verdict.e2e.failed).toEqual([
      {
        title: 'the hover card never lands on the panel it would hide behind',
        error: 'Error: expect(page).toHaveScreenshot(planner.png)',
        snapshotDiff: true,
      },
    ])
    expect(run.verdict.ok).toBe(false)
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('==> STEP FAILED: e2e')
  })

  it('describes a failing spec by its last attempt, not its first', () => {
    // The attempt that decided `ok == false` is the last one. Naming the first would hand the fix
    // agent the transport blip this rung now tolerates and clear `snapshotDiff`, sending it to
    // look at the dev server for what is a snapshot regression.
    const run = runValidate({
      pwExit: 1,
      results: resultsJson([BLIPPED_THEN_REGRESSED]),
    })

    expect(run.verdict.e2e.failed).toEqual([
      {
        title: 'the itinerary day list keeps its order',
        error: 'Error: expect(page).toHaveScreenshot(itinerary.png)',
        snapshotDiff: true,
      },
    ])
  })
})

describe('the ladder shipped outside the worktree', () => {
  it('finds setup-e2e.sh beside itself, not under a fixed repo path', () => {
    // A ladder copied out of the worktree runs validate.sh from wherever it landed, so a
    // `bash scripts/agent/setup-e2e.sh` spelled as a repo-relative path would run the branch's
    // copy - or nothing at all, which is what this stands in for: the scratch repo has no
    // scripts/agent/ and the ladder lives in `ladder/`.
    const run = runValidate({ scriptDir: 'ladder' })

    expect(run.verdict.steps.find((s) => s.name === 'e2e-env')?.ok).toBe(true)
    expect(run.verdict.ok).toBe(true)
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

/**
 * The fix loop's cheap first pass: re-run the specs the fix was supposed to repair, and only then
 * the suite. The script's whole job here is to hand the regex to Playwright untouched and to say in
 * the step name that the run was partial - `main.ts` owns the rule that such a run may not decide
 * green, but it can only apply it if the verdict admits what happened.
 */
describe('--e2e-grep', () => {
  it('is absent by default', () => {
    const run = runValidate()
    expect(run.pwArgs).not.toContain('-g')
    expect(run.verdict.steps.map((s) => s.name)).toContain('e2e')
  })

  it('passes the pattern through as one argument and marks the step narrowed', () => {
    const run = runValidate({
      e2eProjects: 'chromium',
      e2eGrep: "the trip's tab|the hover card",
    })
    expect(run.pwArgs).toContain('-g')
    expect(run.pwArgs[run.pwArgs.indexOf('-g') + 1]).toBe(
      "the trip's tab|the hover card",
    )
    expect(run.verdict.steps.map((s) => s.name)).toContain(
      'e2e:chromium (narrowed)',
    )
  })

  it('narrows the full matrix too, so the step name stays the only difference', () => {
    const run = runValidate({ e2eGrep: 'passes' })
    expect(run.pwArgs).toContain('-g')
    expect(run.verdict.steps.map((s) => s.name)).toContain('e2e (narrowed)')
  })
})
