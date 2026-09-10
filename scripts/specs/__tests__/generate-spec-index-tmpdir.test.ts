import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

/**
 * Rung 4 of the gate - `pnpm generate-spec-index` - has to run wherever the pipeline runs, and
 * where the pipeline runs is a Cezar worktree with a `TMPDIR` 104 characters deep inside the
 * repository.
 *
 * The `tsx` CLI opens an IPC unix socket at `$TMPDIR/tsx-<uid>/<pid>.pipe` before it loads a
 * single line of the script. A unix socket address carries its path in `sun_path`, which holds
 * 104 bytes on macOS and 108 on Linux, so a `TMPDIR` already at that ceiling has no suffix short
 * enough to fit and `listen` answers `EINVAL` - "invalid argument", naming no length, which reads
 * like a bug in `tsx` rather than like a path that does not fit. That is #221: the rung failed on
 * every machine the pipeline runs on and on none of the CI runners, whose `TMPDIR` is the system
 * default and whose checkout is not nested that deep.
 *
 * `node --import tsx` is the same compiler reached through Node's own module hooks instead of
 * through the CLI wrapper, so no IPC server is opened and no socket path is constructed. This case
 * asserts that: it runs the script the way `pnpm run` would, under a `TMPDIR` too long for either
 * platform's `sun_path`, and fails if the command ever goes back to a form that needs the socket.
 *
 * The command comes out of `package.json` rather than being spelled out here, because the
 * invariant belongs to the script the gate actually invokes - a copy of it in this file would keep
 * passing after someone edited the real one.
 *
 * Running the real command means the real generator writes `.ai/specs/README.md`, so the case puts
 * the file back byte for byte afterwards: `pnpm test` leaves the working tree exactly as it found
 * it, and a developer never has to wonder why a run they did not ask for touched a tracked file.
 * What is under test is that the command runs at all; what it produces is rung 4's own
 * `git diff --exit-code`.
 *
 * @see package.json - the `generate-spec-index` script
 * @see https://github.com/design4pro/money-tracker.online/issues/221
 */
const root = resolve(__dirname, '../../..')

/**
 * Long enough that the socket path would not fit on either platform: 104 bytes on macOS, 108 on
 * Linux, both including the terminator, and `tsx` appends `/tsx-<uid>/<pid>.pipe` on top.
 */
const MIN_TMPDIR_LENGTH = 120

const sandboxes: Array<string> = []

const longTmpdir = (): string => {
  const base = mkdtempSync(join(tmpdir(), 'mt-sun-path-'))
  sandboxes.push(base)

  let dir = base
  while (dir.length < MIN_TMPDIR_LENGTH) dir = join(dir, 'nested')
  mkdirSync(dir, { recursive: true })
  return dir
}

afterAll(() => {
  for (const sandbox of sandboxes)
    rmSync(sandbox, { recursive: true, force: true })
})

describe('pnpm generate-spec-index', () => {
  it('runs under a TMPDIR too long for a unix socket path', () => {
    const { scripts } = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> }

    const index = join(root, '.ai', 'specs', 'README.md')
    const before = readFileSync(index)

    let result
    try {
      result = spawnSync(scripts['generate-spec-index'], {
        cwd: root,
        shell: true,
        encoding: 'utf8',
        env: {
          ...process.env,
          // What `pnpm run` puts there, so a command reaching for a `node_modules` binary resolves
          // it and fails on the path length rather than on `command not found`.
          PATH: `${join(root, 'node_modules', '.bin')}${delimiter}${process.env.PATH ?? ''}`,
          TMPDIR: longTmpdir(),
        },
      })
    } finally {
      writeFileSync(index, before)
    }

    expect(result.stderr, result.stderr).not.toContain('EINVAL')
    expect(result.status, result.stderr).toBe(0)
  })
})
