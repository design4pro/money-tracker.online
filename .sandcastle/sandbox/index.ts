// Shared sandbox configuration: the image pin, the bind-mounts that carry data
// between runs, and the env every container needs.
//
// main.ts, triage.ts and record-baselines.ts all build their sandbox from here
// so the three cannot drift: before this module the first two duplicated the
// image pin verbatim and the third omitted it.

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import {
  defaultImageName,
  docker as dockerProvider,
} from '@ai-hero/sandcastle/sandboxes/docker'

// Host-side cache shared by every sandbox and kept across runs — unlike the
// worktrees, which are removed once a run finishes. Gitignored.
const SANDBOX_DATA = join('.sandcastle', 'sandbox', 'data')

// pnpm's store inside the container. Without it pnpm falls back to
// <mount-root>/.pnpm-store — the worktree root — because its default
// (~/.local/share/pnpm) sits on the container overlay while the project is a
// bind mount, and pnpm puts the store on the project's filesystem. That
// fallback re-downloaded the whole store per run AND left the worktree dirty,
// which is what stopped sandcastle from removing it.
const STORE_DIR = '/home/agent/.pnpm-store'

const PNPM_STORE = join(SANDBOX_DATA, 'pnpm-store')

// Mounts fail hard on a missing hostPath — resolveUserMounts throws inside the
// docker() constructor — unlike copyToWorktree, which skips absent sources.
for (const dir of [PNPM_STORE]) mkdirSync(dir, { recursive: true })

// docker() derives its default image tag from the directory the sandbox
// anchors at — since the createWorktree refactor that is the dated worktree
// (`sandcastle:sandcastle-run-<date>-<n>`), not the repo root that `sandcastle
// docker build-image` tagged. Pin the repo-root tag every sandbox should use.
const imageName = defaultImageName(process.cwd())

export const docker = () =>
  dockerProvider({
    imageName,
    mounts: [{ hostPath: PNPM_STORE, sandboxPath: STORE_DIR }],
    // Container-wide, so it covers any pnpm the agent runs itself, not just
    // the install hook.
    env: { npm_config_store_dir: STORE_DIR },
  })
