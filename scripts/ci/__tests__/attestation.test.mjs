/**
 * `judge` decides whether a pull request may skip `verify` and `unit tests · coverage` on the word
 * of an agent's attestation. Its failure mode is silence: a verdict that is too kind lets an untested tree merge and nothing goes red
 * until the post-merge run. So every case that must NOT be accepted is pinned here, next to the
 * one that is (ADR 0033).
 */

import { describe, expect, it } from 'vitest'

import {
  ATTESTATION_MARKER,
  findAttestation,
  judge,
  parseAttestationComment,
  renderAttestationComment,
} from '../attestation.mjs'

const GATE = ['pnpm typecheck', 'pnpm lint', 'pnpm test']
const TREE = 'a'.repeat(40)

const attestation = (over = {}) => ({
  version: 1,
  treeHash: TREE,
  headSha: 'b'.repeat(40),
  commands: GATE.map((command) => ({ command, exitCode: 0, durationMs: 1000 })),
  ...over,
})

const ok = (over = {}) =>
  judge({
    attestation: attestation(),
    treeHash: TREE,
    gateCommands: GATE,
    changedFiles: ['src/components/budgets/budget-bar.tsx'],
    ...over,
  })

describe('judge', () => {
  it('accepts an attestation of this tree that ran the whole gate green', () => {
    expect(ok()).toEqual({ valid: true, reason: expect.stringContaining('3') })
  })

  it('rejects a missing attestation', () => {
    expect(ok({ attestation: null }).valid).toBe(false)
  })

  it('rejects an attestation of another tree (a commit landed after it)', () => {
    const verdict = ok({ treeHash: 'd'.repeat(40) })
    expect(verdict.valid).toBe(false)
    expect(verdict.reason).toContain('tree')
  })

  it('accepts the same tree under another head SHA (a rebase that kept the content)', () => {
    expect(
      ok({ attestation: attestation({ headSha: 'e'.repeat(40) }) }).valid,
    ).toBe(true)
  })

  it('rejects a command that exited non-zero', () => {
    const failed = attestation()
    failed.commands[1].exitCode = 1
    expect(ok({ attestation: failed }).valid).toBe(false)
  })

  it('rejects a gate command the attestation did not run', () => {
    const short = attestation({ commands: attestation().commands.slice(0, 2) })
    expect(ok({ attestation: short }).valid).toBe(false)
  })

  it('rejects the same commands in another order', () => {
    const swapped = attestation({
      commands: attestation().commands.toReversed(),
    })
    expect(ok({ attestation: swapped }).valid).toBe(false)
  })

  it('rejects a gate the base branch has since extended', () => {
    expect(ok({ gateCommands: [...GATE, 'pnpm build'] }).valid).toBe(false)
  })

  it('rejects an empty gate: nothing to attest is not proof of anything', () => {
    expect(
      ok({ gateCommands: [], attestation: attestation({ commands: [] }) })
        .valid,
    ).toBe(false)
  })

  it('rejects an attestation of a version it does not know', () => {
    expect(ok({ attestation: attestation({ version: 99 }) }).valid).toBe(false)
  })

  it('rejects an empty diff: a diff that failed to compute is not a diff that changes nothing', () => {
    expect(ok({ changedFiles: [] }).valid).toBe(false)
  })

  it.each([
    '.github/workflows/ci.yml',
    '.github/actions/e2e-env/action.yml',
    'scripts/ci/attestation.mjs',
    'scripts/seed/seed.mjs',
    '.ai/agentic.config.json',
    '.ai/scripts/test-env-up.sh',
    '.oxlintrc.json',
    'package.json',
    'pnpm-lock.yaml',
    'tsconfig.json',
    'tsr.config.json',
    'vite.config.ts',
    'playwright.config.ts',
    'vitest.config.ts',
    'vitest.setup.workerd.ts',
    'drizzle.config.ts',
    'wrangler.jsonc',
    'e2e/baseline-day.ts',
    'src/server/auth/session.ts',
    'src/server/billing/webhook.ts',
    'src/server/ledger/post.ts',
    'src/server/do/ledger.ts',
    'src/server/db/schema.ts',
    'src/server/repos/base.ts',
    'src/server/repos/scope.ts',
    'src/lib/money/rounding.ts',
    'drizzle/0044_x.sql',
  ])('never lets %s ride on an attestation', (path) => {
    const verdict = ok({
      changedFiles: ['src/components/budgets/budget-bar.tsx', path],
    })
    expect(verdict.valid).toBe(false)
    expect(verdict.reason).toContain(path)
  })
})

describe('comment round trip', () => {
  it('renders a comment that parses back to the same attestation', () => {
    const body = renderAttestationComment(attestation())
    expect(body.startsWith(ATTESTATION_MARKER)).toBe(true)
    expect(parseAttestationComment(body)).toEqual(attestation())
  })

  it.each([
    ['no marker', '```json\n{"version":1}\n```'],
    ['no JSON', `${ATTESTATION_MARKER}\nhello`],
    ['broken JSON', `${ATTESTATION_MARKER}\n\`\`\`json\n{nope\n\`\`\``],
    [
      'a shape that is not an attestation',
      `${ATTESTATION_MARKER}\n\`\`\`json\n{"version":1}\n\`\`\``,
    ],
  ])('returns null for %s', (_name, body) => {
    expect(parseAttestationComment(body)).toBeNull()
  })
})

describe('findAttestation', () => {
  const comment = (over) => ({
    body: renderAttestationComment(attestation()),
    author_association: 'OWNER',
    created_at: '2026-10-22T10:00:00Z',
    ...over,
  })

  it('takes the newest attestation', () => {
    const older = comment({
      created_at: '2026-10-22T09:00:00Z',
      body: renderAttestationComment(attestation({ treeHash: 'f'.repeat(40) })),
    })
    expect(findAttestation([older, comment()])?.treeHash).toBe(TREE)
    expect(findAttestation([comment(), older])?.treeHash).toBe(TREE)
  })

  it.each(['NONE', 'CONTRIBUTOR', 'FIRST_TIME_CONTRIBUTOR'])(
    'ignores a comment from a %s: anyone can comment on a public pull request',
    (author_association) => {
      expect(findAttestation([comment({ author_association })])).toBeNull()
    },
  )

  it.each(['OWNER', 'MEMBER', 'COLLABORATOR'])(
    'trusts a %s',
    (author_association) => {
      expect(findAttestation([comment({ author_association })])).not.toBeNull()
    },
  )

  it('ignores a newer comment that is not an attestation', () => {
    const chatter = comment({
      body: 'LGTM',
      created_at: '2026-10-22T11:00:00Z',
    })
    expect(findAttestation([comment(), chatter])?.treeHash).toBe(TREE)
  })
})
