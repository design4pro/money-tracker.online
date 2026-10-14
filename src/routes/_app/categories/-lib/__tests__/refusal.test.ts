import { describe, expect, it } from 'vitest'

import { refusalOf } from '../refusal'

import type { FailureEnvelope } from '#/lib/failure-envelope'

/**
 * What the categories screen makes of a failed write.
 *
 * The fixtures are what the client rebuilds from the wire: an `Error` carrying the public failure
 * envelope and nothing the repository said. The failure middleware drops a repository error's own
 * `code`, `childCount` and message before it leaves the Worker, so the only fact the browser has
 * is the envelope's `kind` - and the reader must work from that alone.
 */

function wireError(kind: FailureEnvelope['kind'], message = 'This failed.') {
  const envelope: FailureEnvelope = {
    v: 1,
    kind,
    message: { key: `failure.${kind}` as FailureEnvelope['message']['key'] },
  }
  return Object.assign(new Error(message), { envelope })
}

const NAMES = { category: 'Codzienne', parent: 'Dom' } as const

describe('refusalOf', () => {
  it('reads a conflict on a move as the depth refusal, carrying both names', () => {
    expect(
      refusalOf(wireError('conflict'), { call: 'move', ...NAMES }),
    ).toEqual({ kind: 'nest', call: 'move', ...NAMES })
  })

  it.each(['reorder', 'restore'] as const)(
    'never reads a conflict on %s as the depth refusal',
    (call) => {
      expect(refusalOf(wireError('conflict'), { call, ...NAMES })).toEqual({
        kind: 'generic',
        call,
      })
    },
  )

  it.each([
    ['no category name', { call: 'move', parent: 'Dom' }],
    ['no parent name', { call: 'move', category: 'Codzienne' }],
    ['neither name', { call: 'move' }],
  ] as const)(
    'falls back to the generic refusal with %s',
    (_label, context) => {
      expect(refusalOf(wireError('conflict'), context)).toEqual({
        kind: 'generic',
        call: 'move',
      })
    },
  )

  it.each(['move', 'reorder', 'restore'] as const)(
    'reads a forbidden failure on %s as forbidden',
    (call) => {
      expect(refusalOf(wireError('forbidden'), { call, ...NAMES })).toEqual({
        kind: 'forbidden',
        call,
      })
    },
  )

  it.each(['not_found', 'validation', 'upstream', 'internal'] as const)(
    'reads a %s failure as generic',
    (kind) => {
      expect(refusalOf(wireError(kind), { call: 'move', ...NAMES })).toEqual({
        kind: 'generic',
        call: 'move',
      })
    },
  )

  it.each([
    ['null', null],
    ['a string', 'boom'],
    ['a plain error', new Error('boom')],
    ['an object without an envelope', { code: 'CONFLICT', childCount: 2 }],
    [
      'an unknown envelope version',
      Object.assign(new Error('x'), { envelope: { v: 2 } }),
    ],
  ])('reads %s as generic', (_label, error) => {
    expect(refusalOf(error, { call: 'move', ...NAMES })).toEqual({
      kind: 'generic',
      call: 'move',
    })
  })

  it('never lets the error’s own text or properties choose the kind', () => {
    const lookalike = Object.assign(
      new Error('Categories nest two levels; "a" cannot sit inside "b"'),
      { code: 'CONFLICT', childCount: 3, categoryId: 'a', parentId: 'b' },
    )
    expect(refusalOf(lookalike, { call: 'move', ...NAMES })).toEqual({
      kind: 'generic',
      call: 'move',
    })
  })
})
