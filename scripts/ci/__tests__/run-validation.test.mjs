import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { CONFIG_PATH, readCommands, runAll } from '../run-validation.mjs'

describe('readCommands', () => {
  it('returns the configured list in the order it is written', () => {
    const json = { validation: { commands: ['first', 'second', 'third'] } }
    expect(readCommands(json)).toEqual(['first', 'second', 'third'])
  })

  it("reads this repository's own config, which is the only source of the gate", () => {
    const commands = readCommands(JSON.parse(readFileSync(CONFIG_PATH, 'utf8')))
    expect(commands.length).toBeGreaterThan(0)
    expect(
      commands.every((c) => typeof c === 'string' && c.trim() !== ''),
    ).toBe(true)
  })

  it.each([
    ['a config with no validation block', {}],
    ['a validation block with no commands', { validation: {} }],
    ['an empty command list', { validation: { commands: [] } }],
    ['a list that is not a list', { validation: { commands: 'pnpm test' } }],
  ])('refuses %s rather than passing a gate it never ran', (_label, json) => {
    expect(() => readCommands(json)).toThrow(/validation\.commands/)
  })

  it.each([
    ['an empty string', ['pnpm test', '']],
    ['whitespace', ['pnpm test', '   ']],
    ['a non-string', ['pnpm test', 42]],
  ])(
    'refuses %s as a command, which would silently pass',
    (_label, commands) => {
      expect(() => readCommands({ validation: { commands } })).toThrow(
        /non-empty string/,
      )
    },
  )
})

describe('runAll', () => {
  it('runs commands from the repository root even when invoked elsewhere', () => {
    const cwd = fileURLToPath(new URL('../../../', import.meta.url))
    const received = []
    runAll(['pnpm test'], {
      run: (command, options) => {
        received.push({ command, ...options })
        return 0
      },
    })
    expect(received).toEqual([{ command: 'pnpm test', cwd }])
  })

  it('runs every command in order when they all pass', () => {
    const ran = []
    const failure = runAll(['a', 'b', 'c'], {
      run: (command) => {
        ran.push(command)
        return 0
      },
    })
    expect(failure).toBeNull()
    expect(ran).toEqual(['a', 'b', 'c'])
  })

  it('stops at the first failure rather than proving things about a rejected tree', () => {
    const ran = []
    const failure = runAll(['a', 'b', 'c'], {
      run: (command) => {
        ran.push(command)
        return command === 'b' ? 3 : 0
      },
    })
    expect(failure).toEqual({ index: 1, command: 'b', status: 3 })
    expect(ran).toEqual(['a', 'b'])
  })

  it('names the failing command by its position, which is what a run log needs', () => {
    const lines = []
    runAll(['first', 'second'], {
      run: () => 0,
      log: (line) => lines.push(line),
    })
    expect(lines).toEqual(['[1/2] first', '[2/2] second'])
  })
})
