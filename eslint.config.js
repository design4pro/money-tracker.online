//  @ts-check

import { tanstackConfig } from '@tanstack/eslint-config'

export default [
  ...tanstackConfig,
  {
    rules: {
      'import/no-cycle': 'off',
      'import/order': 'off',
      'sort-imports': 'off',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/require-await': 'off',
      'pnpm/json-enforce-catalog': 'off',
    },
  },
  {
    // Layering law: all SQL lives in server/repos (the currency/locale catalog is the single
    // stated exception). Client-side layers never see drizzle-orm.
    files: ['src/components/**', 'src/lib/**', 'src/routes/**'],
    ignores: ['src/routes/api/dev/-seed/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'drizzle-orm',
              message:
                'SQL lives in server/repos via the tenant base repository. Call a server function instead.',
            },
          ],
          patterns: [
            {
              group: ['drizzle-orm/*'],
              message:
                'SQL lives in server/repos via the tenant base repository. Call a server function instead.',
            },
            {
              // The schema module carries every table and drizzle-orm with it; a value import
              // from client code put both into the chunk every visitor downloads. The tuples
              // live in src/lib/enums and the types are free to import from either.
              group: ['#/server/db/schema', '**/server/db/schema'],
              allowTypeImports: true,
              message:
                'The enumerated tuples live in #/lib/enums. A value import of the schema ships every table and drizzle-orm to the browser.',
            },
          ],
        },
      ],
    },
  },
  {
    // Layering law: design-system primitives never reach the server layer. Last so it overrides
    // (and therefore must repeat) the drizzle-orm restriction above — flat config replaces a
    // rule's options wholesale, it does not merge them.
    files: ['src/components/ui/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'drizzle-orm',
              message:
                'SQL lives in server/repos via the tenant base repository. Call a server function instead.',
            },
          ],
          patterns: [
            {
              group: ['#/server/*', '**/server/*'],
              message:
                'components/ui never imports from server/. Pass data in as props.',
            },
            {
              group: ['drizzle-orm/*'],
              message:
                'SQL lives in server/repos via the tenant base repository. Call a server function instead.',
            },
          ],
        },
      ],
    },
  },
  {
    // Money never leaves integer minor units. `toFixed` on a Number is the exact operation that
    // turns a minor-unit integer into a float and back, and it is how the reference product
    // acquired its rounding bugs. Formatting goes through `@internationalized/number` with the
    // currency's own `digits`, in src/lib/money.
    files: ['src/**'],
    ignores: ['src/**/*.test.{ts,tsx}', 'src/**/__tests__/**'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          property: 'toFixed',
          message:
            'Money stays in integer minor units. Format through src/lib/money (Intl + the currency’s own digits) instead of toFixed.',
        },
      ],
    },
  },
  {
    // `.claude/workflows/*.js` are Claude Code orchestration scripts: plain JS run against a
    // bespoke global environment, not part of the TypeScript project and not shipped.
    //
    // The build and test artefacts are here for a sharper reason: they are in no tsconfig, so
    // the typed parser rejects every file in them, and one Playwright run is enough to turn
    // `pnpm lint` red on bundled report assets nobody wrote. A gate that breaks itself by being
    // exercised is worse than no gate. These are the same paths .gitignore refuses to track.
    ignores: [
      'eslint.config.js',
      'prettier.config.js',
      // Ignored one level at a time, and not with `'.claude/**'` plus a negation: these are
      // gitignore semantics, so a path inside an excluded *directory* can never be re-included -
      // the directory is pruned before the negation is read. The shorter form silently ignores
      // the hook tests below.
      '.claude/*',
      '!.claude/hooks',
      '.claude/hooks/*',
      // The hook tests are the carve-out. The rationale for the rest of this tree is that it is
      // not written against the project's tsconfig - which stopped being true of them when that
      // `include` was added, and without this they sit outside `pnpm lint` and Prettier.
      '!.claude/hooks/__tests__',
      // A cezar run worktree is a second checkout of this repository nested inside it. Linting it
      // reports every file twice, against a tsconfig it is not part of, and on a host with a few
      // of them eslint exhausts the heap before it finishes. `.ai/cezar/.gitignore` already keeps
      // them out of git.
      '.ai/cezar/worktrees/**',
      // Agent tooling that GitHub's own surfaces read — skills, agent definitions, hooks. Same
      // reason as `.claude/**`: vendored configuration for tools around the project, written
      // against no tsconfig of ours.
      '.github/**',
      'dist/**',
      'drizzle/**',
      'playwright-report/**',
      'blob-report/**',
      'test-results/**',
      '.wrangler/**',
      '.tanstack/**',
      'coverage/**',
    ],
  },
]
