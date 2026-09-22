import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

type SourceFile = {
  path: string
  text: string
}

type AnimationSite = {
  file: string
  utility: string
  tag: string
}

const stylesDir = fileURLToPath(new URL('..', import.meta.url))
const srcDir = fileURLToPath(new URL('../..', import.meta.url))

/**
 * Keeps the reduced-motion transform reset honest.
 *
 * This reads the stylesheet rather than carrying a list of components: a keyframe that changes
 * `transform` becomes relevant when an animation utility references it, and every JSX element using
 * that utility must state where it rests. It either carries `data-motion-transform`, promising an
 * identity transform, or carries a static transform utility of its own, as the skeleton sheen does.
 *
 * ## What this cannot check
 *
 * An interpolated class name such as `` `animate-${name}` `` is invisible to this source scan. The
 * product has no such animation class today; a new one still needs review alongside this guard.
 */

function sourceFiles(): Array<SourceFile> {
  const files: Array<SourceFile> = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') walk(full)
      } else if (/\.tsx?$/.test(entry.name)) {
        files.push({ path: full, text: readFileSync(full, 'utf8') })
      }
    }
  }

  walk(srcDir)
  return files
}

function blockBody(source: string, start: number): string {
  const open = source.indexOf('{', start)
  let depth = 0

  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') depth -= 1
    if (depth === 0) return source.slice(open + 1, index)
  }

  return ''
}

function transformKeyframes(css: string): Set<string> {
  return new Set(
    [...css.matchAll(/@keyframes\s+([\w-]+)/g)]
      .filter((match) => blockBody(css, match.index).includes('transform:'))
      .map((match) => match[1]),
  )
}

function transformUtilities(css: string): Set<string> {
  const keyframes = transformKeyframes(css)

  return new Set(
    [...css.matchAll(/^\s*--animate-([\w-]+):\s*([^;]+);/gm)]
      .filter(([, , animation]) =>
        [...keyframes].some((keyframe) =>
          new RegExp(`\\b${keyframe}\\b`).test(animation),
        ),
      )
      .map(([, utility]) => utility),
  )
}

function openingTagAt(source: string, index: number): string | undefined {
  const start = source.lastIndexOf('<', index)
  if (start === -1) return undefined

  let quote: string | undefined
  let braces = 0
  for (let cursor = start; cursor < source.length; cursor += 1) {
    const character = source[cursor]
    if (quote) {
      if (character === quote && source[cursor - 1] !== '\\') quote = undefined
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (character === '{') {
      braces += 1
    } else if (character === '}') {
      braces -= 1
    } else if (character === '>' && braces === 0) {
      if (cursor < index) return undefined
      return source.slice(start, cursor + 1)
    }
  }

  return undefined
}

function declarationEnd(source: string, start: number): number {
  let quote: string | undefined
  let parentheses = 0
  let brackets = 0
  let braces = 0
  let sawValue = false

  for (let cursor = start; cursor < source.length; cursor += 1) {
    const character = source[cursor]
    if (quote) {
      if (character === quote && source[cursor - 1] !== '\\') quote = undefined
      continue
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character
      sawValue = true
    } else if (character === '(') {
      parentheses += 1
      sawValue = true
    } else if (character === ')') {
      parentheses -= 1
    } else if (character === '[') {
      brackets += 1
      sawValue = true
    } else if (character === ']') {
      brackets -= 1
    } else if (character === '{') {
      braces += 1
      sawValue = true
    } else if (character === '}') {
      braces -= 1
    } else if (!/\s/.test(character)) {
      sawValue = true
    }

    if (
      character === '\n' &&
      sawValue &&
      parentheses === 0 &&
      brackets === 0 &&
      braces === 0
    ) {
      return cursor
    }
  }

  return source.length
}

function declarationName(source: string, index: number): string | undefined {
  const prefix = source.slice(Math.max(0, index - 2_000), index)
  const match = [...prefix.matchAll(/(?:export\s+)?const\s+(\w+)\s*=/g)].at(-1)

  if (!match) return undefined

  const declarationStart = Math.max(0, index - 2_000) + match.index
  return index < declarationEnd(source, declarationStart) ? match[1] : undefined
}

function hasStaticTransform(tag: string): boolean {
  return /(?:^|[\s'"`])-?(?:translate|rotate|scale|skew)-|(?:^|[\s'"`])transform-/.test(
    tag,
  )
}

function animationSites(
  files: Array<SourceFile>,
  utility: string,
): Array<AnimationSite> {
  const pattern = new RegExp(`(?<![\\w-])animate-${utility}(?![\\w-])`, 'g')
  const sites: Array<AnimationSite> = []
  const seen = new Set<string>()

  for (const file of files) {
    for (const match of file.text.matchAll(pattern)) {
      const index = match.index + match[0].lastIndexOf('animate-')
      const owner = declarationName(file.text, index)
      const references = [
        { file, index },
        ...(owner
          ? files.flatMap((candidate) =>
              [
                ...candidate.text.matchAll(new RegExp(`\\b${owner}\\b`, 'g')),
              ].map((reference) => ({
                file: candidate,
                index: reference.index,
              })),
            )
          : []),
      ]

      for (const reference of references) {
        const tag = openingTagAt(reference.file.text, reference.index)
        const key = `${reference.file.path}:${tag}`
        if (tag?.includes('className') && !seen.has(key)) {
          seen.add(key)
          sites.push({ file: reference.file.path, utility, tag })
        }
      }
    }
  }

  return sites
}

function driftMessages(files: Array<SourceFile>): Array<string> {
  const css = readFileSync(path.join(stylesDir, 'app.css'), 'utf8')
  const messages: Array<string> = []

  for (const utility of transformUtilities(css)) {
    for (const site of animationSites(files, utility)) {
      if (
        !site.tag.includes('data-motion-transform') &&
        !hasStaticTransform(site.tag)
      ) {
        messages.push(
          `${path.relative(process.cwd(), site.file)}: animate-${site.utility} must either carry ` +
            '`data-motion-transform` (it rests at identity) or a static transform utility (it rests elsewhere).',
        )
      }
    }
  }

  return messages
}

it('makes every transform animation declare where its element rests', () => {
  expect(driftMessages(sourceFiles())).toEqual([])
})

it('rejects a popover whose shared animation loses the reduced-motion hook', () => {
  const files = sourceFiles().map((file) =>
    file.path.endsWith('/popover.tsx')
      ? { ...file, text: file.text.replace('data-motion-transform=""\n', '') }
      : file,
  )

  expect(driftMessages(files)).toEqual([
    'src/components/ui/popover.tsx: animate-pop-in must either carry ' +
      '`data-motion-transform` (it rests at identity) or a static transform utility (it rests elsewhere).',
    'src/components/ui/popover.tsx: animate-pop-out must either carry ' +
      '`data-motion-transform` (it rests at identity) or a static transform utility (it rests elsewhere).',
  ])
})

it('rejects an unprefixed transform animation whose hook is removed', () => {
  const files = sourceFiles().map((file) =>
    file.path.endsWith('/spinner.tsx')
      ? { ...file, text: file.text.replace('data-motion-transform=""\n', '') }
      : file,
  )

  expect(driftMessages(files)).toContain(
    'src/components/ui/spinner.tsx: animate-spin-slow must either carry ' +
      '`data-motion-transform` (it rests at identity) or a static transform utility (it rests elsewhere).',
  )
})

it('requires a static transform when the skeleton sheen declines the hook', () => {
  const files = sourceFiles().map((file) =>
    file.path.endsWith('/skeleton.tsx')
      ? { ...file, text: file.text.replace('-translate-x-full ', '') }
      : file,
  )

  expect(driftMessages(files)).toContain(
    'src/components/ui/skeleton.tsx: animate-shimmer must either carry ' +
      '`data-motion-transform` (it rests at identity) or a static transform utility (it rests elsewhere).',
  )
})
