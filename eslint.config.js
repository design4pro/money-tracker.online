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
      '.claude/**',
      // Agent tooling that GitHub's own surfaces read — skills, agent definitions, hooks. Same
      // reason as `.claude/**`: vendored configuration for tools around the project, written
      // against no tsconfig of ours.
      '.github/**',
      '.sandcastle/**',
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
