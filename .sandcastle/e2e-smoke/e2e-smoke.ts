// Smoke-test of the sandbox e2e path — setup-e2e.sh, the seeded demo
// workspace, Playwright. Verification only; nothing is committed.
//
//   pnpm exec tsx .sandcastle/e2e-smoke/e2e-smoke.ts
//
// Mirrors the loop's sandbox configuration (the same image, the same install
// hook) so a green run here means the real implementer sandboxes can run
// Playwright the same way.

import * as sandcastle from '@ai-hero/sandcastle'
import { docker } from '@ai-hero/sandcastle/sandboxes/docker'

const result = await sandcastle.run({
  sandbox: docker(),
  name: 'e2e-smoke',
  // A separate worktree, like the loop's per-issue sandboxes. The default
  // 'head' strategy bind-mounts the host working directory, which forbids
  // copyToWorktree — and would let the install hook rewrite the host's
  // darwin node_modules with linux binaries.
  //
  // Named, not the bare string this used to pass: a string has no `.type`, so
  // the library read `undefined` and fell through to a generated temp branch.
  // It happened to give this file the worktree it wanted, by accident and
  // under a different name every run.
  branchStrategy: { type: 'branch', branch: 'sandcastle/e2e-smoke' },
  maxIterations: 1,
  agent: sandcastle.claudeCode('claude-opus-5'),
  promptFile: './.sandcastle/e2e-smoke/prompt.md',
  hooks: {
    sandbox: {
      onSandboxReady: [
        { command: 'pnpm install --frozen-lockfile', timeoutMs: 600_000 },
      ],
    },
  },
  // Nothing is copied in: a fresh linux install is ~13 s, while reconciling a
  // copied darwin node_modules over the bind mount takes 10+ min, and the e2e
  // ladder needs no downloaded asset.
})

const smoke = result.stdout.match(/<smoke>([\s\S]*?)<\/smoke>/)?.[1]

if (smoke === undefined) {
  console.error('No <smoke> block found in agent output. Full stdout follows:')
  console.error(result.stdout)
  process.exit(1)
}

console.log(smoke.trim())
