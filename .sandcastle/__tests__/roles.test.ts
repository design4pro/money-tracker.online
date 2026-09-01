import { describe, expect, it } from 'vitest'

import { EFFORTS, ROLES, describeRoles, resolveRole } from '../roles'

describe('resolveRole', () => {
  it('defaults to the table', () => {
    expect(resolveRole('implementer', {})).toEqual({
      model: 'claude-opus-5',
      effort: 'high',
    })
  })

  it('demotes the two mechanical roles', () => {
    // Both run one iteration and both have their output checked by something deterministic
    // downstream, so this is a cost decision and not a quality one.
    expect(resolveRole('merger', {})).toEqual({
      model: 'claude-sonnet-5',
      effort: 'low',
    })
    expect(resolveRole('pixelCapture', {}).model).toBe('claude-sonnet-5')
  })

  it('lets the environment override one role at a time', () => {
    expect(
      resolveRole('implementer', {
        SANDCASTLE_MODEL_IMPLEMENTER: 'claude-sonnet-5',
        SANDCASTLE_EFFORT_IMPLEMENTER: 'max',
      }),
    ).toEqual({ model: 'claude-sonnet-5', effort: 'max' })
  })

  it('spells a camelCase role the way the rest of SANDCASTLE_* reads', () => {
    expect(
      resolveRole('deepReview', { SANDCASTLE_EFFORT_DEEP_REVIEW: 'low' })
        .effort,
    ).toBe('low')
    expect(
      resolveRole('pixelCapture', { SANDCASTLE_MODEL_PIXEL_CAPTURE: 'x' })
        .model,
    ).toBe('x')
  })

  it('leaves an unrelated role alone', () => {
    expect(
      resolveRole('reviewer', { SANDCASTLE_EFFORT_IMPLEMENTER: 'max' }).effort,
    ).toBe('medium')
  })

  it('refuses an effort level the provider does not have', () => {
    // Same rule as an unknown flag in main.ts: a typo must cost a startup error, never a silently
    // different run.
    expect(() =>
      resolveRole('planner', { SANDCASTLE_EFFORT_PLANNER: 'highest' }),
    ).toThrow(/not an effort level/)
  })

  it('treats an empty override as absent', () => {
    expect(
      resolveRole('planner', {
        SANDCASTLE_MODEL_PLANNER: '',
        SANDCASTLE_EFFORT_PLANNER: '',
      }),
    ).toEqual({ model: 'claude-opus-5', effort: 'high' })
  })
})

describe('describeRoles', () => {
  it('resolves every role for the run header', () => {
    const described = describeRoles({
      SANDCASTLE_MODEL_MERGER: 'claude-haiku-4-5',
    })
    expect(Object.keys(described).sort()).toEqual(Object.keys(ROLES).sort())
    expect(described.merger).toEqual({
      model: 'claude-haiku-4-5',
      effort: 'low',
    })
  })

  it('only ever names an effort the provider accepts', () => {
    for (const { effort } of Object.values(describeRoles({}))) {
      expect(EFFORTS).toContain(effort)
    }
  })
})
