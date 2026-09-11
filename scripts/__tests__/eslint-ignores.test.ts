import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

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
 * #229 was the same failure one directory over, for the `.ai/qa/artifacts_<run>` trees a UI QA run
 * writes. A third one is what `gitignoredDirectoriesUnderAi` below exists to prevent: the two
 * lists are reconciled by deriving one of them here, rather than by asking the next author to
 * remember both.
 *
 * The assertions go through the real `ESLint` class against the real config rather than matching
 * strings in the file, because the failure mode is a glob that does not cover what its author
 * thought it covered - which a `toContain` over the source reports as green.
 *
 * @see eslint.config.js
 * @see https://github.com/design4pro/money-tracker.online/issues/203
 * @see https://github.com/design4pro/money-tracker.online/issues/229
 */
const root = resolve(__dirname, '../..')

const eslint = new ESLint({ cwd: root })

/**
 * Every directory under `.ai/` that git refuses to track, read out of the `.gitignore` files that
 * govern it: the root one, plus the per-directory files git reads on the way down.
 *
 * `git ls-files` rather than a directory walk, because `.ai/cezar/worktrees/` holds full second
 * checkouts of this repository - walking it would descend into their `node_modules`.
 *
 * Only directory entries (a trailing `/`) qualify: a single ignored *file* cannot hold a stray
 * source, and `isPathIgnored` reports a `.json` or a `.log` as walked whether or not it is a file
 * eslint would ever parse.
 */
const gitignoredDirectoriesUnderAi = execFileSync(
  'git',
  ['ls-files', '--', '*.gitignore'],
  { cwd: root, encoding: 'utf8' },
)
  .split('\n')
  .filter((file) => file === '.gitignore' || file.startsWith('.ai/'))
  .flatMap((file) => {
    const base = dirname(file)
    return (
      readFileSync(resolve(root, file), 'utf8')
        .split('\n')
        .map((line) => line.trim())
        // A comment is not an entry, and a negation (`!frames/`) re-includes a directory rather
        // than ignoring it - reading either as ignored would fail this test for a path eslint is
        // right to walk.
        .filter(
          (line) =>
            line.endsWith('/') &&
            !line.startsWith('#') &&
            !line.startsWith('!'),
        )
        .map((entry) => (base === '.' ? entry : `${base}/${entry}`))
    )
  })
  .filter((path) => path.startsWith('.ai/'))

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

  // The same two shapes for the QA artefacts directory, with the filenames `om-auto-qa-pr`
  // actually wrote when it turned `pnpm lint` red (#229): a Playwright config and a spec, both
  // TypeScript, both in no tsconfig.
  it.each([
    '.ai/qa/artifacts_qa-pr-206/playwright.qa.config.ts',
    '.ai/qa/artifacts_issue-18/frames/dashboard/capture.ts',
  ])(
    'does not walk %s, the throwaway evidence a UI QA run writes under .ai/qa/',
    async (path) => {
      await expect(eslint.isPathIgnored(path)).resolves.toBe(true)
    },
  )

  // The reconciliation itself: not "these two paths are listed", but "whatever `.gitignore` says
  // is untracked under `.ai/` is also unwalked". A fourth artefact directory added to a
  // `.gitignore` and forgotten in `eslint.config.js` fails here rather than on someone's machine.
  it.each(gitignoredDirectoriesUnderAi)(
    'does not walk %s, which .gitignore refuses to track',
    async (directory) => {
      await expect(
        // A directory is only a failure once a file lands in it, and the `*` in an entry like
        // `.ai/qa/artifacts_*/` has to be resolved to probe the glob that shadows it.
        eslint.isPathIgnored(`${directory.replaceAll('*', 'probe')}probe.ts`),
      ).resolves.toBe(true)
    },
  )

  // The derivation is only a guard while it finds something: a `.gitignore` rewritten into a
  // shape the parse above does not recognise would otherwise leave the block above green and
  // empty.
  it('reads the ignored directories out of .gitignore', () => {
    expect(gitignoredDirectoriesUnderAi).toEqual(
      expect.arrayContaining(['.ai/qa/artifacts_*/', '.ai/tmp/']),
    )
  })

  // The premise the assertions above rest on. An ignore wide enough to cover `.ai/tmp/` must stay
  // narrow enough to leave the sources the gate exists for - and the hook tests the `.claude`
  // entries deliberately carve back in - being linted.
  //
  // `.ai/scripts/agent-kit-check.mjs` is the case that matters most here: it is the only tracked
  // file eslint parses that lives under `.ai/` at all, so it is the one an entry widened by a
  // future author could shadow without anything else noticing.
  it.each([
    'src/lib/money/format.ts',
    'scripts/__tests__/eslint-ignores.test.ts',
    '.claude/hooks/__tests__/hooks.test.ts',
    '.ai/scripts/agent-kit-check.mjs',
  ])('still lints %s', async (path) => {
    await expect(eslint.isPathIgnored(path)).resolves.toBe(false)
  })
})
