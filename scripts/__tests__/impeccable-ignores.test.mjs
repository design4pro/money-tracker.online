import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { loadKnownRuleIds } from '../../.claude/skills/impeccable/scripts/lib/staleness-deep.mjs'

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
 * The upstream half - teaching `checkDetectorIgnores` to validate the second list the way it
 * already validates the first - stays outstanding on #165. The vendored copy under `.claude/` is
 * not a path an agent run may edit, and this repository is the thing at risk either way.
 *
 * @see .impeccable/config.json
 * @see .claude/skills/impeccable/scripts/lib/staleness-deep.mjs
 * @see https://github.com/design4pro/money-tracker.online/issues/165
 */
const root = fileURLToPath(new URL('../../', import.meta.url))

const detector =
  JSON.parse(
    readFileSync(
      new URL('../../.impeccable/config.json', import.meta.url),
      'utf8',
    ),
  ).detector ?? {}

const knownRuleIds = await loadKnownRuleIds(
  `${root}.claude/skills/impeccable/scripts`,
)

// The same normalization the matcher applies before comparing, so casing or stray whitespace in
// the config reads here exactly as it reads there.
const normalize = (rule) =>
  String(rule || '')
    .trim()
    .toLowerCase()

const unknown = (rules) =>
  rules
    .map(normalize)
    .filter((rule) => rule && rule !== '*' && !knownRuleIds?.has(rule))

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
    expect(unknown(detector.ignoreRules ?? [])).toEqual([])
  })

  // The list the upstream check skips, and the reason this file exists.
  it('ignores no value under a rule id the detector does not have', () => {
    expect(
      unknown((detector.ignoreValues ?? []).map((entry) => entry?.rule)),
    ).toEqual([])
  })
})
