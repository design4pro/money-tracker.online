/**
 * #87: `set_pipeline_label` must split `$PIPELINE_LABELS` the same way in zsh, bash and
 * sh. An unquoted `for label in $PIPELINE_LABELS` iterates once under zsh (no word-split
 * on unquoted expansion), so competing pipeline labels are never removed.
 *
 * Two copies of the function exist: the installed descriptor and the om-setup-agent-pipeline
 * install source. They have to stay the same, or the next reinstall restores the bug.
 *
 * The count in the issue's table is competing labels (every pipeline label except the one
 * being set). `blocked` / `do-not-merge` are skipped later as a person's hold; that is a
 * different rule and is not what this file measures.
 *
 * zsh is the shell that made the bug live, but GitHub-hosted ubuntu-latest has no
 * `/bin/zsh`. Bash and sh always run. zsh cases run when `/bin/zsh` or `zsh` on PATH
 * exists; otherwise they skip with that ENOENT reason.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const INSTALLED = resolve(import.meta.dirname, '../../trackers/github.md')
const SOURCE = resolve(
  import.meta.dirname,
  '../../../.claude/skills/om-setup-agent-pipeline/references/trackers/github.md',
)

const PIPELINE_LABELS =
  'review changes-requested qa qa-failed merge-queue blocked do-not-merge'
const INCOMING = 'merge-queue'
const COMPETING = 6

const PORTABLE_SPLIT = `printf '%s\\n' "$PIPELINE_LABELS" | tr ' ' '\\n' | while IFS= read -r label; do`

const UNQUOTED_FOR_DO = 'for label in $PIPELINE_LABELS; do'

const REQUIRED_SHELLS = {
  bash: '/bin/bash',
  sh: '/bin/sh',
}

const ZSH_MISSING =
  'zsh is not installed (/bin/zsh ENOENT and zsh is not on PATH); GitHub-hosted ubuntu-latest has no zsh, so the #87 zsh table cannot run here'

const resolveZsh = () => {
  if (existsSync('/bin/zsh')) return '/bin/zsh'
  const which = spawnSync('sh', ['-c', 'command -v zsh'], { encoding: 'utf8' })
  const path = which.status === 0 ? which.stdout.trim() : ''
  return path && existsSync(path) ? path : undefined
}

const ZSH = resolveZsh()

const extractSetPipelineLabel = (markdown) => {
  const start = markdown.indexOf('set_pipeline_label() {')
  if (start < 0) {
    throw new Error('set_pipeline_label is missing')
  }
  let depth = 0
  for (let i = start; i < markdown.length; i += 1) {
    if (markdown[i] === '{') depth += 1
    if (markdown[i] === '}') {
      depth -= 1
      if (depth === 0) return markdown.slice(start, i + 1)
    }
  }
  throw new Error('set_pipeline_label is unclosed')
}

const run = (shell, script) => {
  const result = spawnSync(shell, ['-c', script], { encoding: 'utf8' })
  if (result.error?.code === 'ENOENT') {
    throw result.error
  }
  expect(result.error, `${shell}: ${result.error}`).toBeUndefined()
  expect(result.status, `${shell} stderr:\n${result.stderr}`).toBe(0)
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

const competingScript = (loopBody) => `PIPELINE_LABELS='${PIPELINE_LABELS}'
incoming='${INCOMING}'
${loopBody}
`

const competingFromPortableLoop = (shell, name) => {
  const labels = run(
    shell,
    competingScript(`${PORTABLE_SPLIT}
  [ -z "$label" ] && continue
  [ "$label" = "$incoming" ] && continue
  printf '%s\\n' "$label"
done
`),
  )
  expect(labels, name).toHaveLength(COMPETING)
  expect(labels).toEqual([
    'review',
    'changes-requested',
    'qa',
    'qa-failed',
    'blocked',
    'do-not-merge',
  ])
}

describe('set_pipeline_label word-split (#87)', () => {
  const installed = readFileSync(INSTALLED, 'utf8')
  const source = readFileSync(SOURCE, 'utf8')
  const installedFn = extractSetPipelineLabel(installed)
  const sourceFn = extractSetPipelineLabel(source)

  it('keeps the installed descriptor and the install source on the same function body', () => {
    expect(sourceFn).toBe(installedFn)
  })

  it('does not ship the unquoted for-loop that zsh iterates once', () => {
    expect(installedFn).not.toContain(UNQUOTED_FOR_DO)
    expect(sourceFn).not.toContain(UNQUOTED_FOR_DO)
    expect(installed).not.toContain(UNQUOTED_FOR_DO)
    expect(source).not.toContain(UNQUOTED_FOR_DO)
  })

  it('uses the portable printf | tr | read split in both copies', () => {
    expect(installedFn).toContain(
      `printf '%s\\n' "$PIPELINE_LABELS" | tr ' ' '\\n' | while IFS= read -r label; do`,
    )
    expect(sourceFn).toContain(
      `printf '%s\\n' "$PIPELINE_LABELS" | tr ' ' '\\n' | while IFS= read -r label; do`,
    )
  })

  it.each(Object.entries(REQUIRED_SHELLS))(
    'under %s the portable loop removes 6 competing labels',
    (name, shell) => {
      competingFromPortableLoop(shell, name)
    },
  )

  it('under zsh the portable loop removes 6 competing labels', ({ skip }) => {
    if (!ZSH) {
      skip(ZSH_MISSING)
      return
    }
    competingFromPortableLoop(ZSH, 'zsh')
  })

  it('under zsh the unquoted for-loop still iterates once (the bug #86/#87 fixed)', ({
    skip,
  }) => {
    if (!ZSH) {
      skip(ZSH_MISSING)
      return
    }
    const labels = run(
      ZSH,
      competingScript(`for label in $PIPELINE_LABELS; do
  [ "$label" = "$incoming" ] && continue
  printf '%s\\n' "$label"
done
`),
    )
    expect(labels).toEqual([PIPELINE_LABELS])
  })
})
