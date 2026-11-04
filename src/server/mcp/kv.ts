/**
 * SESSIONS KV helpers for MCP: per-grant / per-user rate counters and
 * two-step delete tickets. Counters are approximate (last-write-wins), same
 * trade as auth `RATE_LIMIT_RULES`.
 */

import { nanoid } from 'nanoid'

import { McpRateLimitedError } from './tool-error'

import type { AgentResource, AgentVerb } from '#/lib/enums'

const WINDOW_MS = 60_000
export const MCP_CONFIRM_TTL_SEC = 60

const GRANT_LIMIT: Readonly<Record<AgentVerb, number>> = {
  read: 60,
  write: 20,
  delete: 5,
}

const USER_LIMIT: Readonly<Record<AgentVerb, number>> = {
  read: 120,
  write: 40,
  delete: 10,
}

export interface McpKv {
  get: (key: string) => Promise<string | null>
  put: (
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ) => Promise<void>
  delete: (key: string) => Promise<void>
}

export class MemoryMcpKv implements McpKv {
  private readonly rows = new Map<
    string,
    { value: string; expiresAt: number | null }
  >()

  constructor(private readonly clock: () => number = Date.now) {}

  async get(key: string): Promise<string | null> {
    const row = this.rows.get(key)
    if (row === undefined) return null
    if (row.expiresAt !== null && this.clock() >= row.expiresAt) {
      this.rows.delete(key)
      return null
    }
    return row.value
  }

  async put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void> {
    const expiresAt =
      options?.expirationTtl === undefined
        ? null
        : this.clock() + options.expirationTtl * 1000
    this.rows.set(key, { value, expiresAt })
  }

  async delete(key: string): Promise<void> {
    this.rows.delete(key)
  }
}

interface CounterRow {
  readonly count: number
  readonly resetAt: number
}

function parseCounter(raw: string | null, now: number): CounterRow {
  if (raw === null) return { count: 0, resetAt: now + WINDOW_MS }
  const parsed: unknown = JSON.parse(raw)
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('count' in parsed) ||
    !('resetAt' in parsed) ||
    typeof parsed.count !== 'number' ||
    typeof parsed.resetAt !== 'number'
  ) {
    return { count: 0, resetAt: now + WINDOW_MS }
  }
  if (parsed.resetAt <= now) return { count: 0, resetAt: now + WINDOW_MS }
  return { count: parsed.count, resetAt: parsed.resetAt }
}

function ttlSec(resetAt: number, now: number): number {
  return Math.max(1, Math.ceil((resetAt - now) / 1000))
}

async function peekLimit(
  kv: McpKv,
  key: string,
  limit: number,
  now: number,
): Promise<CounterRow> {
  const row = parseCounter(await kv.get(key), now)
  if (row.count >= limit) {
    throw new McpRateLimitedError(ttlSec(row.resetAt, now))
  }
  return row
}

async function storeCounter(
  kv: McpKv,
  key: string,
  row: CounterRow,
  now: number,
): Promise<void> {
  await kv.put(key, JSON.stringify(row), {
    expirationTtl: ttlSec(row.resetAt, now),
  })
}

export async function assertMcpRateLimit(args: {
  readonly kv: McpKv
  readonly grantId: string
  readonly userId: string
  readonly verb: AgentVerb
  readonly nowMs: number
}): Promise<void> {
  const grantKey = `mcp:rl:grant:${args.grantId}:${args.verb}`
  const userKey = `mcp:rl:user:${args.userId}:${args.verb}`
  const grant = await peekLimit(
    args.kv,
    grantKey,
    GRANT_LIMIT[args.verb],
    args.nowMs,
  )
  const user = await peekLimit(
    args.kv,
    userKey,
    USER_LIMIT[args.verb],
    args.nowMs,
  )
  await storeCounter(
    args.kv,
    grantKey,
    { count: grant.count + 1, resetAt: grant.resetAt },
    args.nowMs,
  )
  await storeCounter(
    args.kv,
    userKey,
    { count: user.count + 1, resetAt: user.resetAt },
    args.nowMs,
  )
}

export interface ConfirmTicket {
  readonly resource: AgentResource
  readonly id: string
  readonly labelKey: string
}

function ticketKey(grantId: string, token: string): string {
  return `mcp:confirm:${grantId}:${token}`
}

export async function putConfirmTicket(
  kv: McpKv,
  grantId: string,
  ticket: ConfirmTicket,
): Promise<string> {
  const token = nanoid()
  await kv.put(ticketKey(grantId, token), JSON.stringify(ticket), {
    expirationTtl: MCP_CONFIRM_TTL_SEC,
  })
  return token
}

export async function takeConfirmTicket(
  kv: McpKv,
  grantId: string,
  token: string,
): Promise<ConfirmTicket | null> {
  const key = ticketKey(grantId, token)
  const raw = await kv.get(key)
  if (raw === null) return null
  await kv.delete(key)
  const parsed: unknown = JSON.parse(raw)
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('resource' in parsed) ||
    !('id' in parsed) ||
    !('labelKey' in parsed) ||
    typeof parsed.resource !== 'string' ||
    typeof parsed.id !== 'string' ||
    typeof parsed.labelKey !== 'string'
  ) {
    return null
  }
  return {
    resource: parsed.resource as AgentResource,
    id: parsed.id,
    labelKey: parsed.labelKey,
  }
}
