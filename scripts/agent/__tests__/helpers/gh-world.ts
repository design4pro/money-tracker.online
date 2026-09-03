// A throwaway world for the claim / apply scripts: a temp clone with a bare origin, a fake `gh`
// on PATH that answers reads from fixtures and logs every call on one line, CEZ_TASK_ID for the
// run id. Every git call gets a clean env: under a git hook GIT_DIR / GIT_INDEX_FILE would point
// each of them at the repo under test.
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const SCRIPTS = resolve(__dirname, '../..')
export const RUN = 'run1234567890ab'

export interface Fixture {
  state?: string
  title?: string
  body?: string
  labels?: string[]
  blockedBy?: Array<{ number: number; state: string }>
  subIssues?: number
}

export interface FakeComment {
  id: number
  body: string
}

const FAKE_GH = `#!/usr/bin/env bash
args="$*"; printf '%s\\n' "\${args//$'\\n'/ }" >> "$FAKE_GH_LOG"
case "$args" in *"--body-file -"*) cat > "$FAKE_GH_LOG.body" ;; esac
case "$1 $2" in
  "issue view")
    filter=""
    while [ $# -gt 0 ]; do
      case "$1" in --jq) filter="$2"; shift ;; esac
      shift
    done
    if [ -n "$filter" ]; then jq -r "$filter" "$FAKE_ISSUE"; else cat "$FAKE_ISSUE"; fi ;;
  "pr list")
    filter=""
    while [ $# -gt 0 ]; do
      case "$1" in --jq) filter="$2"; shift ;; esac
      shift
    done
    printf '%s' "\${FAKE_PRS:-[]}" | jq -r "$filter" ;;
  "api "*)
    case "$args" in
      *--paginate*)
        filter=""
        while [ $# -gt 0 ]; do
          case "$1" in --jq) filter="$2"; shift ;; esac
          shift
        done
        printf '%s' "\${FAKE_COMMENTS:-[]}" | jq -r "$filter" ;;
    esac ;;
esac
`

export function ghWorld(issue: number) {
  const root = mkdtempSync(join(tmpdir(), 'gh-world-'))
  const origin = join(root, 'origin.git')
  const clone = join(root, 'clone')
  const bin = join(root, 'bin')
  const log = join(root, 'gh.log')
  const fixture = join(root, 'issue.json')
  const env = {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
  } as unknown as NodeJS.ProcessEnv // the repo augments ProcessEnv with app variables
  const git = (args: string[], cwd = clone) =>
    execFileSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args],
      { cwd, encoding: 'utf8', env },
    ).trim()

  execFileSync('git', ['init', '--bare', '-q', '-b', 'develop', origin], {
    env,
  })
  execFileSync('git', ['init', '-q', '-b', 'develop', clone], { env })
  git(['remote', 'add', 'origin', origin])
  writeFileSync(join(clone, 'README.md'), 'base\n')
  git(['add', 'README.md'])
  git(['commit', '-q', '-m', 'base'])
  git(['push', '-q', '-u', 'origin', 'develop'])

  mkdirSync(bin)
  writeFileSync(join(bin, 'gh'), FAKE_GH)
  chmodSync(join(bin, 'gh'), 0o755)
  mkdirSync(join(clone, '.agent'))
  writeFileSync(join(clone, '.agent', 'issue'), `${issue}\n`)

  const setIssue = (f: Fixture) =>
    writeFileSync(
      fixture,
      JSON.stringify({
        state: f.state ?? 'OPEN',
        title: f.title ?? `Issue ${issue}`,
        body: f.body ?? 'the original report',
        labels: (f.labels ?? ['run: implement', 'status: ready']).map(
          (name) => ({ name }),
        ),
        blockedBy: {
          nodes: f.blockedBy ?? [],
          totalCount: (f.blockedBy ?? []).length,
        },
        subIssuesSummary: { total: f.subIssues ?? 0, completed: 0 },
      }),
    )

  /** Run a scripts/agent script in the clone; `extra` adds fake-gh answers. */
  const run = (
    script: string,
    args: string[] = [],
    extra: Record<string, string> = {},
  ) => {
    const r = execFileSync(
      'bash',
      [
        '-c',
        `"${join(SCRIPTS, script)}" "$@"; echo "exit=$?"`,
        'bash',
        ...args,
      ],
      {
        cwd: clone,
        encoding: 'utf8',
        env: {
          ...env,
          PATH: `${bin}:${env.PATH ?? ''}`,
          CEZ_TASK_ID: RUN,
          FAKE_GH_LOG: log,
          FAKE_ISSUE: fixture,
          ...extra,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    const status = Number(/exit=(\d+)/.exec(r)?.[1])
    const calls = existsSync(log)
      ? readFileSync(log, 'utf8').trim().split('\n')
      : []
    const body = existsSync(`${log}.body`)
      ? readFileSync(`${log}.body`, 'utf8')
      : null
    return { status, calls, body }
  }

  /** A branch a previous run pushed for this issue, cut from the same develop. */
  const pushOrphan = (name: string, file: string) => {
    const wt = join(root, `wt-${name.replace(/\//g, '_')}`)
    git(['worktree', 'add', '-q', '-b', name, wt, 'origin/develop'])
    mkdirSync(join(wt, file, '..'), { recursive: true })
    writeFileSync(join(wt, file), 'orphan\n')
    git(['add', file], wt)
    git(['commit', '-q', '-m', `orphan ${file}`], wt)
    git(['push', '-q', 'origin', name], wt)
  }

  const agentFile = (rel: string, content: string) => {
    mkdirSync(join(clone, '.agent', rel, '..'), { recursive: true })
    writeFileSync(join(clone, '.agent', rel), content)
  }

  return { root, clone, bin, git, setIssue, run, pushOrphan, agentFile }
}

export type World = ReturnType<typeof ghWorld>
export const comments = (list: FakeComment[]) => ({
  FAKE_COMMENTS: JSON.stringify(list),
})
export const editCalls = (calls: string[]) =>
  calls.filter((c) => c.startsWith('issue edit'))
export const postedComments = (calls: string[]) =>
  calls.filter((c) => c.includes('--method POST') && c.includes('/comments'))
