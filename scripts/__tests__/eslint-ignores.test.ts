import { resolve } from 'node:path'

import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

/**
 * `pnpm lint` is rung 5 of the gate, and what makes it worth running is that it reports on the
 * repository and on nothing else. Flat config does not read `.gitignore`, so the only thing that
 * holds that is the `ignores` array in `eslint.config.js` - and an untracked working directory
 * missing from it is not a quiet gap. Every file in one sits outside every tsconfig project, so
 * the typed parser rejects it with `"parserOptions.project" has been provided ...`: the run goes
 * red, once per stray file, with an error that reads like a tsconfig misconfiguration and sends
 * the reader into `tsconfig.json` instead of into the directory.
 *
 * #203 was that, for `.ai/tmp/` - where a pipeline run parks a scratch checkout. So the gate broke
 * on the machines that run the pipeline and nowhere else: CI clones fresh and never had one.
 *
 * The assertions go through the real `ESLint` class against the real config rather than matching
 * strings in the file, because the failure mode is a glob that does not cover what its author
 * thought it covered - which a `toContain` over the source reports as green.
 *
 * @see eslint.config.js
 * @see https://github.com/design4pro/money-tracker.online/issues/203
 */
const root = resolve(__dirname, '../..')

const eslint = new ESLint({ cwd: root })

describe('eslint.config.js ignores', () => {
  // Both shapes, because a `**` that only matched nested paths would still leave a file dropped
  // at the top of the directory linted, and the entry would look present while not holding.
  it.each([
    '.ai/tmp/stray.js',
    '.ai/tmp/promote-standdown-191634/scripts/live-browser.js',
  ])(
    'does not walk %s, the scratch tree a pipeline run parks under .ai/tmp/',
    async (path) => {
      await expect(eslint.isPathIgnored(path)).resolves.toBe(true)
    },
  )

  // The premise the assertions above rest on. An ignore wide enough to cover `.ai/tmp/` must stay
  // narrow enough to leave the sources the gate exists for - and the hook tests the `.claude`
  // entries deliberately carve back in - being linted.
  it.each([
    'src/lib/money/format.ts',
    'scripts/__tests__/eslint-ignores.test.ts',
    '.claude/hooks/__tests__/hooks.test.ts',
  ])('still lints %s', async (path) => {
    await expect(eslint.isPathIgnored(path)).resolves.toBe(false)
  })
})
