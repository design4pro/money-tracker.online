/**
 * The handler registry: one entry for every kind in the envelope union.
 *
 * The type (`TaskHandlers`) makes a missing kind a compile error; this is the runtime half, so the
 * list of kinds is read from the union itself rather than copied here, and a kind added there
 * without an entry fails in both places.
 */

import { describe, expect, it } from 'vitest'

import { taskMessageSchema } from '../../messages'
import { taskHandlers } from '../index'
import { HandlerNotInstalledError } from '../not-installed'

import type { TaskContext } from '../../dispatch'

const kinds = taskMessageSchema.options.map((o) => o.shape.kind.value)
const notInstalledKinds = kinds.filter((k) => k !== 'billing.event')

describe('taskHandlers', () => {
  it('has an entry for all six kinds, and for nothing else', () => {
    expect(kinds).toHaveLength(6)
    expect(Object.keys(taskHandlers).sort()).toEqual([...kinds].sort())
    for (const kind of kinds) {
      expect(taskHandlers[kind], kind).toBeTypeOf('function')
    }
  })

  it.each(notInstalledKinds)(
    '%s is installed as a handler that throws, never as one that resolves',
    async (kind) => {
      const handler = taskHandlers[kind] as (
        task: unknown,
        ctx: TaskContext,
      ) => Promise<unknown>
      const rejection = handler({ kind }, {} as TaskContext)

      await expect(rejection).rejects.toBeInstanceOf(HandlerNotInstalledError)
      await expect(rejection).rejects.toThrow(kind)
    },
  )
})
