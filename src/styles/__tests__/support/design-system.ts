import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { __unstable__loadDesignSystem } from 'tailwindcss'

const require = createRequire(import.meta.url)

const stylesDir = fileURLToPath(new URL('../..', import.meta.url))

export type DesignSystem = Awaited<
  ReturnType<typeof __unstable__loadDesignSystem>
>

let designSystemPromise: Promise<DesignSystem> | undefined

/**
 * `app.css` compiled through Tailwind's own front end, once per process.
 *
 * Loading it is the expensive part of every file that uses it - the reason
 * `vitest.config.ts` names one of them as the `server` project's slowest case -
 * so the promise is memoized rather than awaited twice.
 *
 * It lives here rather than in one test file because two files now need the
 * same compiler: `token-classes.test.ts` asks it which candidates resolve, and
 * `mark-pen.test.ts` reads the declarations one utility emits.
 */
export function designSystem(): Promise<DesignSystem> {
  designSystemPromise ??= __unstable__loadDesignSystem(
    readFileSync(path.join(stylesDir, 'app.css'), 'utf8'),
    {
      base: stylesDir,
      loadStylesheet: async (id: string, base: string) => {
        const file =
          id === 'tailwindcss'
            ? require.resolve('tailwindcss/index.css')
            : path.resolve(base, id)
        return {
          path: file,
          base: path.dirname(file),
          content: readFileSync(file, 'utf8'),
        }
      },
      loadModule: async (id: string, base: string) => ({
        path: id,
        base,
        module: (await import(id)).default,
      }),
    },
  )
  return designSystemPromise
}
