// Types for plan.mjs (plain ESM so the publish scripts run it with bare node).

export type Scope = 'XS' | 'S' | 'M' | 'L' | 'XL'

export interface TicketBody {
  summary: string
  currentBehaviour: string
  desiredBehaviour: string
  fixDirection: string
  keyInterfaces?: string
  definitionOfDone: string[]
  tenantIsolationTest: string
  moneyInvariant: string
  verification: string
  visualChangeExpected?: string
  outOfScope: string
}

export interface Ticket {
  id: string
  title: string
  blockedBy: string[]
  ownedPaths: string[]
  estimatedScope: Scope
  wave?: 'solo'
  body: TicketBody
}

export interface TicketPlan {
  prd: number
  tickets: Ticket[]
}

/** stdout of `gh <args>`; throws (with `.stderr`) on a non-zero exit */
export type Gh = (args: string[], input?: string) => string

export interface PublishOptions {
  published?: Record<string, number>
  onPublished?: (published: Record<string, number>) => void
  dryRun?: boolean
  log?: (line: string) => void
}

export interface PublishResult {
  published: Record<string, number>
  ready: number[]
}

export const REPO: string
export const SCOPES: Scope[]
export const PROTECTED_PATH: RegExp
export const SCHEMAS: Record<string, { required: string[]; optional: string[] }>

export function sectionsOf(md: string): {
  preamble: string
  sections: Array<{ title: string; body: string }>
}
export function validateBody(schema: string, md: string): string[]
export function renderTicket(ticket: Ticket): string
export function publishOrder(tickets: Ticket[]): string[]
export function parallelPairs(tickets: Ticket[]): Array<[string, string]>
export function validateTickets(plan: unknown): string[]
export const ghExec: Gh
export function swapStatus(gh: Gh, n: number, to: string): void
export function loadPublished(gh: Gh, prd: number): Record<string, number>
export function savePublished(
  gh: Gh,
  prd: number,
  published: Record<string, number>,
): void
export function publishPlan(
  plan: TicketPlan,
  gh: Gh,
  options?: PublishOptions,
): PublishResult
