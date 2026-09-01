/**
 * Which model and how much reasoning effort each stage of the loop gets.
 *
 * Every role used to be `claude-opus-5` with the provider's default effort, named in six separate
 * constants. That is one decision spelled six times, and it left no way to say the obvious thing:
 * the merger resolves git conflicts in a single iteration against a deterministic ladder, and the
 * pixel capture drives a browser and writes PNGs. Neither is reasoning work, and both were billed
 * as if they were.
 *
 * The two mechanical roles are demoted here. Everything else keeps opus and gains an EXPLICIT
 * effort rather than the default — the values below are a starting position, not a measurement.
 * The measurement is `pnpm sandcastle:report`, whose per-label table carries tokens beside median
 * work time and failure count for exactly this decision; `stage-log.ts` records the model and
 * effort each row ran with, so a report can always be attributed to a configuration.
 *
 * Every role is overridable from the environment — `SANDCASTLE_MODEL_IMPLEMENTER`,
 * `SANDCASTLE_EFFORT_DEEP_REVIEW` — so the operator can walk one role at a time and read the
 * difference out of the next report instead of editing this file to run an experiment.
 */

import * as sandcastle from '@ai-hero/sandcastle'

/** The provider's own scale, mirrored so a bad env value fails at startup rather than at the CLI. */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof EFFORTS)[number]

export interface RoleConfig {
  readonly model: string
  readonly effort?: Effort
}

export const ROLES = {
  planner: { model: 'claude-opus-5', effort: 'high' },
  implementer: { model: 'claude-opus-5', effort: 'high' },
  reviewer: { model: 'claude-opus-5', effort: 'medium' },
  auditor: { model: 'claude-opus-5', effort: 'high' },
  deepReview: { model: 'claude-opus-5', effort: 'high' },
  pixelCritic: { model: 'claude-opus-5', effort: 'medium' },

  // The pre-triage sweep reads an issue, reproduces it at HEAD and decides whether it becomes
  // workable. It is judgement work on someone else's bug report, so it sits with the planner
  // rather than with the mechanical roles — and it lives here, not in a local constant inside
  // `triage.ts`, so `pnpm sandcastle:report` can attribute a triage row to a configuration and
  // `SANDCASTLE_MODEL_TRIAGER` can move it like any other role.
  triager: { model: 'claude-opus-5', effort: 'high' },

  // The two mechanical roles. Both run `maxIterations: 1` and both have their output checked by
  // something deterministic downstream — the merger by the ladder and the auditor, the capture by
  // the critic that reads its screenshots — so a cheaper model here cannot quietly lower the bar.
  merger: { model: 'claude-sonnet-5', effort: 'low' },
  pixelCapture: { model: 'claude-sonnet-5', effort: 'low' },
} as const satisfies Record<string, RoleConfig>

export type Role = keyof typeof ROLES

/** `deepReview` → `DEEP_REVIEW`, so the env names read like the rest of `SANDCASTLE_*`. */
function envName(role: string): string {
  return role.replace(/[A-Z]/g, (upper) => `_${upper}`).toUpperCase()
}

function readEffort(
  name: string,
  value: string | undefined,
): Effort | undefined {
  if (value === undefined || value === '') return undefined
  if (!(EFFORTS as readonly string[]).includes(value)) {
    throw new Error(
      `${name}=${JSON.stringify(value)} is not an effort level. Known: ${EFFORTS.join(', ')}.`,
    )
  }
  return value as Effort
}

/** What a role will actually run with, after the environment has had its say. */
export function resolveRole(
  role: Role,
  env: Record<string, string | undefined> = process.env,
): RoleConfig {
  const name = envName(role)
  const effort = readEffort(
    `SANDCASTLE_EFFORT_${name}`,
    env[`SANDCASTLE_EFFORT_${name}`],
  )
  return {
    model: env[`SANDCASTLE_MODEL_${name}`] || ROLES[role].model,
    effort: effort ?? ROLES[role].effort,
  }
}

/** The agent provider for a role. */
export function agentFor(
  role: Role,
  env: Record<string, string | undefined> = process.env,
): ReturnType<typeof sandcastle.claudeCode> {
  const { model, effort } = resolveRole(role, env)
  // An empty options object is not the same as none: pass one only when there is something in it.
  return effort === undefined
    ? sandcastle.claudeCode(model)
    : sandcastle.claudeCode(model, { effort })
}

/** Every role's resolved configuration, for the run header in `stages.ndjson`. */
export function describeRoles(
  env: Record<string, string | undefined> = process.env,
): Record<string, { model: string; effort?: string }> {
  return Object.fromEntries(
    (Object.keys(ROLES) as Role[]).map((role) => [
      role,
      resolveRole(role, env),
    ]),
  )
}
