// One-shot bootstrap: record the `-linux` Playwright baselines inside a
// sandbox and commit them to the CURRENT branch.
//
//   pnpm sandcastle:baselines
//
// The sandbox image is byte-identical to CI's e2e gate image
// (mcr.microsoft.com/playwright:v1.62.1-noble), so the recorded pixels are
// exactly what update-snapshots.yml would produce — without Actions minutes.
// The human gate is unchanged: the PNGs land in a commit a PR reviewer sees.
//
// Note: branchStrategy here is the sandbox default (a work branch off the
// current branch); the commit is cherry-picked back onto the host branch at
// the end, because the worktree is torn down on close().

import { execSync } from 'node:child_process'

import * as sandcastle from '@ai-hero/sandcastle'

import { docker } from './sandbox'

const hostBranch = execSync('git rev-parse --abbrev-ref HEAD', {
  encoding: 'utf8',
}).trim()
const workBranch = `sandcastle/record-baselines-${Date.now()}`

const sandbox = await sandcastle.createSandbox({
  branch: workBranch,
  sandbox: docker(),
  hooks: {
    sandbox: {
      onSandboxReady: [
        { command: 'pnpm install --frozen-lockfile', timeoutMs: 600_000 },
      ],
    },
  },
})

let recordedSha = ''
try {
  const run = async (label: string, command: string) => {
    console.log(`==> ${label}`)
    const result = await sandbox.exec(command, {
      onLine: (line) => console.log(`   ${line}`),
    })
    if (result.exitCode !== 0) {
      throw new Error(
        `${label} failed (exit ${result.exitCode}):\n${result.stderr.slice(-2000)}`,
      )
    }
    return result
  }

  await run('e2e environment', 'bash .sandcastle/setup-e2e.sh')
  // Scoped to visual.spec.ts: that is the only file that owns baselines. The
  // i18n runtime-parity spec is a functional cross-runtime assertion — a red
  // there is a real finding, but it must not abort a baseline recording.
  await run(
    'record baselines (both projects, both themes)',
    `PLAYWRIGHT_BASE_URL=http://localhost:3010 pnpm exec playwright test visual.spec.ts --update-snapshots --workers=${process.env.E2E_WORKERS ?? '4'} --reporter=line`,
  )
  await run(
    'commit',
    // The container's `agent` user has no git identity; set it per-command.
    `git add e2e/__screenshots__ && git -c user.name=sandcastle -c user.email=sandcastle@money-tracker.online commit -m "test(e2e): record -linux baselines in the CI-identical sandbox image"`,
  )
  recordedSha = (await run('read sha', 'git rev-parse HEAD')).stdout.trim()
} finally {
  await sandbox.close()
}

console.log(`==> cherry-picking ${recordedSha} onto ${hostBranch}`)
execSync(`git cherry-pick ${recordedSha}`, { stdio: 'inherit' })
console.log('Done. Review the PNGs, then push.')
