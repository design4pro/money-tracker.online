import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import {
  checkDetectorIgnores,
  loadKnownRuleIds,
} from '../../.claude/skills/impeccable/scripts/lib/staleness-deep.mjs'

/**
 * `.impeccable/config.json` carries this repository's detector suppressions, and its two lists are
 * held to very different standards by the code that reads them. `detector.ignoreRules` is checked
 * against the detector's rule registry by the skill's own doctor pass, which reports the unknown
 * ids as `detector-ignore-rules-unknown`. `detector.ignoreValues[].rule` is checked by nothing -
 * and the matcher that consumes it compares the id exactly (`entry.rule !== rule` in
 * `impeccable-config.mjs`, no wildcard on the rule half), so an entry naming a rule the detector
 * does not have suppresses nothing at all, while its `reason` field reads to the next person like
 * a working waiver.
 *
 * #162 shipped three of those - `design-system-spacing`, `design-system-shadow` and
 * `design-system-motion` - against a catalogue whose only design-system rules are
 * `design-system-color`, `-font`, `-font-size` and `-radius`. A human reviewer caught them; no
 * gate would have. This is that gate.
 *
 * The registry is loaded from the vendored engine rather than restated here, because a rule list
 * copied into a test rots the same silent way the config does: it would keep passing entries the
 * detector had already renamed away. Reading it also means this file fails loudly if the engine
 * moves, rather than quietly checking nothing - `loadKnownRuleIds` returns `null` when it cannot
 * find the detector, and a `null` registry is how the upstream check fails open today.
 *
 * The vendored doctor pass now validates the second list too (#165): `checkDetectorIgnores` reports
 * `detector-ignore-values-unknown`, and the second `describe` below holds it to that. This file
 * stays as the repository gate, because the doctor pass only runs when someone invokes the skill.
 * The vendored copy diverges from upstream impeccable until the change is sent there.
 *
 * @see .impeccable/config.json
 * @see .claude/skills/impeccable/scripts/lib/staleness-deep.mjs
 * @see https://github.com/design4pro/money-tracker.online/issues/165
 */
const fromRoot = (relative) =>
  fileURLToPath(new URL(`../../${relative}`, import.meta.url))

const detector =
  JSON.parse(readFileSync(fromRoot('.impeccable/config.json'), 'utf8'))
    .detector ?? {}

const knownRuleIds = await loadKnownRuleIds(
  fromRoot('.claude/skills/impeccable/scripts'),
)

// The same normalization the matcher applies before comparing, so casing or stray whitespace in
// the config reads here exactly as it reads there. An unloadable registry leaves every id unknown,
// which is the loud direction to fail in.
const known = knownRuleIds ?? new Set()
const normalize = (rule) =>
  String(rule ?? '')
    .trim()
    .toLowerCase()

// `*` is exempt here because the upstream check exempts it here too.
const unknownIgnoreRules = (detector.ignoreRules ?? [])
  .map(normalize)
  .filter((rule) => rule && rule !== '*' && !known.has(rule))

// Neither exemption carries over. An entry with no `rule`, or a `*` in it, is dropped or never
// matched by `normalizeIgnoreValueEntries` and the exact `entry.rule !== rule` compare that follow
// it - so it is as dead as a misspelling, and reported rather than filtered away.
const unknownIgnoreValueRules = (detector.ignoreValues ?? [])
  .map((entry) => normalize(entry?.rule))
  .filter((rule) => !known.has(rule))

describe('.impeccable/config.json detector ignores', () => {
  it('loads the rule registry from the vendored detector', () => {
    expect(knownRuleIds).not.toBeNull()
    expect(knownRuleIds.size).toBeGreaterThan(0)
  })

  // What gives the two assertions below their teeth: these are the ids #162 actually shipped, and
  // a registry that contained them would make a dead-suppression check pass on a dead suppression.
  it.each([
    'design-system-spacing',
    'design-system-shadow',
    'design-system-motion',
  ])('has no rule %s, the dead id #162 shipped', (rule) => {
    expect(knownRuleIds.has(rule)).toBe(false)
  })

  it('ignores no rule id the detector does not have', () => {
    expect(unknownIgnoreRules).toEqual([])
  })

  // The list the upstream check skips, and the reason this file exists.
  it('ignores no value under a rule id the detector does not have', () => {
    expect(unknownIgnoreValueRules).toEqual([])
  })
})

describe('checkDetectorIgnores, the vendored doctor pass', () => {
  const roots = []

  // A project root holding only the given `.impeccable` config files, as the doctor pass reads it.
  const projectWith = (configs) => {
    const root = mkdtempSync(join(tmpdir(), 'impeccable-ignores-'))
    roots.push(root)
    mkdirSync(join(root, '.impeccable'))
    for (const [name, config] of Object.entries(configs)) {
      writeFileSync(join(root, '.impeccable', name), JSON.stringify(config))
    }
    return root
  }

  const valuesFindings = (projectRoot, registry = known) =>
    checkDetectorIgnores({ projectRoot, knownRuleIds: registry }).filter(
      (finding) => finding.id === 'detector-ignore-values-unknown',
    )

  const entry = (rule) => ({ rule, value: '#fff' })

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true })
  })

  it('reports an unknown rule in detector.ignoreValues and says it never suppressed anything', () => {
    const root = projectWith({
      'config.json': {
        detector: {
          ignoreValues: [
            entry('design-system-spacing'),
            entry('design-system-color'),
          ],
        },
      },
    })

    const findings = valuesFindings(root)

    expect(findings).toHaveLength(1)
    expect(findings[0].summary).toContain('`design-system-spacing`')
    expect(findings[0].summary).not.toContain('`design-system-color`')
    expect(findings[0].summary).toContain('never suppressed anything')
  })

  it('tells the two lists apart by finding id', () => {
    const root = projectWith({
      'config.json': {
        detector: {
          ignoreRules: ['no-such-rule'],
          ignoreValues: [entry('design-system-spacing')],
        },
      },
    })

    expect(
      checkDetectorIgnores({ projectRoot: root, knownRuleIds: known }).map(
        (finding) => finding.id,
      ),
    ).toEqual([
      'detector-ignore-rules-unknown',
      'detector-ignore-values-unknown',
    ])
  })

  it('compares the rule after trim and lower-casing, as the matcher does', () => {
    const root = projectWith({
      'config.json': {
        detector: {
          ignoreValues: [
            entry('  Design-System-Color '),
            entry(' Design-System-SPACING '),
          ],
        },
      },
    })

    const [finding] = valuesFindings(root)

    expect(finding.summary).toContain('`design-system-spacing`')
    expect(finding.summary).not.toContain('`design-system-color`')
  })

  it('does not report an entry with the rule `*`', () => {
    const root = projectWith({
      'config.json': { detector: { ignoreValues: [entry('*')] } },
    })

    expect(valuesFindings(root)).toEqual([])
  })

  it('reports nothing when the rule registry could not be loaded', () => {
    const root = projectWith({
      'config.json': {
        detector: { ignoreValues: [entry('design-system-spacing')] },
      },
    })

    expect(valuesFindings(root, null)).toEqual([])
  })

  it('checks config.local.json as well as config.json', () => {
    const root = projectWith({
      'config.json': {
        detector: { ignoreValues: [entry('design-system-color')] },
      },
      'config.local.json': {
        detector: { ignoreValues: [entry('design-system-spacing')] },
      },
    })

    const findings = valuesFindings(root)

    expect(findings).toHaveLength(1)
    expect(findings[0].summary).toContain('.impeccable/config.local.json')
  })

  it('reports nothing for this repository config', () => {
    expect(
      checkDetectorIgnores({
        projectRoot: fromRoot(''),
        knownRuleIds: known,
      }).filter((finding) => finding.id.startsWith('detector-ignore-')),
    ).toEqual([])
  })
})
