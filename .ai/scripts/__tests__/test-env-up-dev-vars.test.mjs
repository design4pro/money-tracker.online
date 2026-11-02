/**
 * The agent test-env throwaway `.dev.vars` must mint unsubscribe links the
 * suite can open. `.github/actions/e2e-env` already writes a fixed
 * `UNSUBSCRIBE_TOKEN_SECRET`; `e2e/unsubscribe.spec.ts` signs with that same
 * value. A missing line makes every `/unsubscribe` page say the link does not
 * work (the confirm cases then fail naming that state).
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const SCRIPT = resolve(import.meta.dirname, '../test-env-up.sh')
const ACTION = resolve(
  import.meta.dirname,
  '../../../.github/actions/e2e-env/action.yml',
)
const SPEC = resolve(import.meta.dirname, '../../../e2e/unsubscribe.spec.ts')

const KEY = 'UNSUBSCRIBE_TOKEN_SECRET=e2e-unsubscribe-token-secret'

describe('test-env-up throwaway .dev.vars', () => {
  it('writes the same unsubscribe signing key the e2e suite and e2e-env action use', () => {
    expect(readFileSync(ACTION, 'utf8')).toContain(KEY)
    expect(readFileSync(SPEC, 'utf8')).toContain(
      "'e2e-unsubscribe-token-secret'",
    )
    expect(readFileSync(SCRIPT, 'utf8')).toContain(KEY)
  })
})
