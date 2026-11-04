/**
 * Map a thrown value to the public MCP tool error envelope.
 *
 * Kinds are the spec's closed set. Text is the kind only — no SQL, stacks,
 * amounts, or entity ids.
 */

import { ZodError } from 'zod'

import { classifyFailure } from '#/server/errors/classify'

export type McpToolErrorKind =
  | 'denied'
  | 'not_found'
  | 'invalid'
  | 'feature_locked'
  | 'rate_limited'
  | 'error'

export class McpDeniedError extends Error {
  constructor() {
    super('denied')
    this.name = 'McpDeniedError'
  }
}

export interface McpToolFailure {
  readonly kind: McpToolErrorKind
}

export function mcpToolFailureOf(error: unknown): McpToolFailure {
  if (error instanceof McpDeniedError) return { kind: 'denied' }
  if (error instanceof ZodError) return { kind: 'invalid' }
  const classified = classifyFailure(error)
  switch (classified.kind) {
    case 'not_found':
      return { kind: 'not_found' }
    case 'validation':
      return { kind: 'invalid' }
    case 'feature_locked':
      return { kind: 'feature_locked' }
    case 'rate_limited':
      return { kind: 'rate_limited' }
    case 'forbidden':
      return { kind: 'denied' }
    default:
      return { kind: 'error' }
  }
}

export function mcpToolErrorResult(error: unknown): {
  readonly isError: true
  readonly content: ReadonlyArray<{
    readonly type: 'text'
    readonly text: string
  }>
  readonly structuredContent: McpToolFailure
} {
  const failure = mcpToolFailureOf(error)
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(failure) }],
    structuredContent: failure,
  }
}
