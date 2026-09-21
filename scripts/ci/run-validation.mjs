#!/usr/bin/env node

/**
 * Runs the validation gate, which is `validation.commands` in `.ai/agentic.config.json`, in the
 * order written there.
 *
 *   node scripts/ci/run-validation.mjs
 *
 * This file exists so that nothing else has to restate the list. `AGENTS.md` and `SDLC.md` both
 * say the gate lives in exactly one place, because a gate written down twice is a gate that
 * disagrees with itself and the copy an agent happens to read is the one that wins. Before this
 * script, `.ai/cezar/workflows/implement-ticket.yml` carried the second copy.
 *
 * Each command is a shell line, not an argv: the configured entries chain with `&&` and redirect
 * stdin, so they are handed to `sh -c` rather than split. Output is inherited, so a failing
 * command's own message is what a reader sees; this script adds one line naming which of the
 * commands failed and stops there, because a gate that keeps going past a failure wastes minutes
 * proving things about a tree that is already rejected.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const CONFIG_PATH = '.ai/agentic.config.json'

/** The configured gate, as a list of shell lines. Throws when the config cannot supply one. */
export function readCommands(json) {
  const commands = json?.validation?.commands
  if (!Array.isArray(commands) || commands.length === 0) {
    throw new Error(`${CONFIG_PATH} has no validation.commands array`)
  }
  const bad = commands.find((c) => typeof c !== 'string' || c.trim() === '')
  if (bad !== undefined) {
    throw new Error(
      `${CONFIG_PATH}: every validation command must be a non-empty string`,
    )
  }
  return commands
}

/**
 * Runs each command in order through `run`, stopping at the first non-zero status.
 * Returns the index and command that failed, or `null` when every one passed.
 */
export function runAll(commands, { run, log = () => {} }) {
  for (const [index, command] of commands.entries()) {
    log(`[${index + 1}/${commands.length}] ${command}`)
    const status = run(command)
    if (status !== 0) return { index, command, status }
  }
  return null
}

function main() {
  const commands = readCommands(JSON.parse(readFileSync(CONFIG_PATH, 'utf8')))
  const failure = runAll(commands, {
    run: (command) =>
      spawnSync(command, { shell: true, stdio: 'inherit' }).status ?? 1,
    log: (line) => console.log(`\n\u001b[1m${line}\u001b[0m`),
  })
  if (!failure) {
    console.log(`\nvalidation gate: ${commands.length} commands passed`)
    return
  }
  console.error(
    `\nvalidation gate failed at command ${failure.index + 1}/${commands.length}: ${failure.command}`,
  )
  process.exit(failure.status || 1)
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  main()
}
