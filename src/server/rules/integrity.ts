/**
 * Self-pausing: the one thing that keeps a broken rule from being a silent rule.
 *
 * ---------------------------------------------------------------------------
 * WHY A PAUSE IS WRITTEN BY THE DELETE, NOT FOUND BY A SCAN
 * ---------------------------------------------------------------------------
 *
 * A rule names a category, a tag, a payee, an account or an account group by id. Delete that row
 * and the rule does not fail — it stops matching, or it keeps matching and writes a reference to
 * something that is gone. Neither says anything out loud. The worst version is a rule that carried
 * on classifying an import for three weeks into a category nobody can name, because the failure of
 * an automation is *silence*, and silence is indistinguishable from working.
 *
 * So {@link pauseRulesReferencing} is called **by the deleting operation, in the same batch**, and
 * `#/server/repos/categories`, `#/server/repos/payees` and `#/server/repos/accounts` each call it
 * from their delete paths. Doing it on a later sweep instead would leave a window — one import
 * long is long enough — in which a rule quietly no-ops.
 *
 * {@link checkRuleIntegrity} is the belt and braces, run weekly. **It is expected to find
 * nothing.** A finding is logged at `warn` with the rule id because it does not mean a rule broke;
 * it means a delete path is missing its call, which is a defect in this module's callers.
 *
 * ---------------------------------------------------------------------------
 * WHY THE REASON CARRIES A NAME
 * ---------------------------------------------------------------------------
 *
 * `paused_reason` is `{ kind, ref_type, ref_id, label, at }` and **`label` is the human name of the
 * thing that vanished, captured at pause time**. By the time somebody reads the banner the
 * referenced row is gone, so `ref_id` alone is unresolvable — there is no query that turns it back
 * into "Groceries". The name has to be copied at the only moment it still exists.
 *
 * The sweep is the case that proves the rule: it runs long after the row went, has no name to
 * capture, and records the id in `label` because that is the best it can honestly do. A banner
 * showing a raw id is therefore *also* a symptom of the missing delete-path call, visible to the
 * person rather than only in the log.
 *
 * The stored keys are `snake_case` because the plan (`docs/plans/14-rules.md`, `14-S3`) writes the
 * blob that way and the blob is the contract; there is one shape here, not a wire shape and a
 * camel-cased twin that has to be kept in step.
 */

import { z } from 'zod'

import {
  RULE_REFERENCE_TYPES,
  listExistingReferenceIds,
  listRules,
  pauseRules,
} from '#/server/repos/rules'

import type { Logger } from '#/server/observability/logger'
import type { TenantScope } from '#/server/repos/base'
import type { RuleReferenceType } from '#/server/repos/rules'
import type {
  RuleAction,
  RuleCondition,
  RuleDefinition,
} from '#/server/rules/schema'

export type { RuleReferenceType }
export { RULE_REFERENCE_TYPES }

/* -------------------------------------------------------------------------- */
/* The stored reason                                                          */
/* -------------------------------------------------------------------------- */

const idSchema = z.string().trim().min(1).max(64)

/** As long as the longest name any of the five tables will hand over. Truncated, never rejected. */
const MAX_LABEL_LENGTH = 200

/**
 * The blob `rules.paused_reason` holds.
 *
 * `kind` is a literal rather than a free string so that a second reason — there is none today —
 * has to be added here as a union member and handled everywhere the banner switches on it.
 */
export const pausedReasonSchema = z.strictObject({
  kind: z.literal('missing_reference'),
  ref_type: z.enum(RULE_REFERENCE_TYPES),
  ref_id: idSchema,
  label: z.string().max(MAX_LABEL_LENGTH),
  at: z.iso.datetime(),
})
export type PausedReason = z.infer<typeof pausedReasonSchema>

/**
 * The stored text as a reason, or `null`.
 *
 * A blob this version cannot parse answers `null` — *not paused* — for the same reason
 * `#/server/rules/schema` answers the empty list for an unreadable condition: the failure of a
 * parser must not be able to disable a rule, and a rule the banner cannot explain is better shown
 * running than shown broken with no sentence attached.
 */
export function readPausedReason(stored: string | null): PausedReason | null {
  if (stored === null) return null
  try {
    return pausedReasonSchema.parse(JSON.parse(stored))
  } catch {
    return null
  }
}

/* -------------------------------------------------------------------------- */
/* What a rule points at                                                      */
/* -------------------------------------------------------------------------- */

/** One `(kind, id)` a rule names, whether from a condition or from an action. */
export interface RuleReference {
  readonly refType: RuleReferenceType
  readonly refId: string
}

/**
 * What happens to one id as a traversal reaches it.
 *
 * Returning `reference.refId` unchanged turns the traversal into an *enumeration*, which is
 * exactly how {@link ruleReferences} is built. That is the whole trick: finding what a rule points
 * at and rewriting what a rule points at are one walk of the condition and action unions, not two
 * that can drift apart. A second walk would agree today and disagree the day a tenth condition
 * field lands.
 */
type RuleIdMapper = (reference: RuleReference) => string

/**
 * The mapped list, or `null` when every id came back identical.
 *
 * `null` rather than the array is what lets the callers below return the **original** condition
 * object when nothing matched, which is what makes {@link replaceRuleReference} identity-preserving
 * all the way down.
 */
function mappedIds(
  ids: ReadonlyArray<string>,
  refType: RuleReferenceType,
  map: RuleIdMapper,
): Array<string> | null {
  const next = ids.map((refId) => map({ refType, refId }))
  return next.every((id, index) => id === ids[index]) ? null : next
}

/**
 * One condition with every id it carries passed through `map`.
 *
 * The `switch` has **no `default`**, so a tenth condition field added to `./schema` is a compile
 * error here rather than an id this module silently cannot see — the same exhaustiveness
 * `./evaluate` and `./apply` stand on, for the same reason.
 */
function mapConditionIds(
  condition: RuleCondition,
  map: RuleIdMapper,
): RuleCondition {
  switch (condition.field) {
    case 'account': {
      const ids = mappedIds(condition.ids, 'account', map)
      return ids === null ? condition : { ...condition, ids }
    }
    case 'account_group': {
      const ids = mappedIds(condition.ids, 'account_group', map)
      return ids === null ? condition : { ...condition, ids }
    }
    case 'category': {
      const ids = mappedIds(condition.ids, 'category', map)
      return ids === null ? condition : { ...condition, ids }
    }
    case 'tag': {
      const ids = mappedIds(condition.ids, 'tag', map)
      return ids === null ? condition : { ...condition, ids }
    }
    // `payee` matches the payee's **name**, not its id (`./schema`), so a deleted payee cannot
    // break it and there is nothing here to rewrite. The rest carry no id at all.
    case 'note':
    case 'payee':
    case 'amount':
    case 'direction':
    case 'day_of_month':
      return condition
  }
}

/** One action with every id it carries passed through `map`. Exhaustive, for the same reason. */
function mapActionIds(action: RuleAction, map: RuleIdMapper): RuleAction {
  switch (action.kind) {
    case 'set_category': {
      const categoryId = map({ refType: 'category', refId: action.categoryId })
      return categoryId === action.categoryId
        ? action
        : { ...action, categoryId }
    }
    case 'set_payee': {
      const payeeId = map({ refType: 'payee', refId: action.payeeId })
      return payeeId === action.payeeId ? action : { ...action, payeeId }
    }
    case 'add_tag':
    case 'remove_tag': {
      const tagId = map({ refType: 'tag', refId: action.tagId })
      return tagId === action.tagId ? action : { ...action, tagId }
    }
    case 'set_note':
    case 'set_payment_method':
    case 'mark_planned':
    case 'set_excluded':
      return action
  }
}

/** Anything with a rule's two ordered lists on it: a stored {@link Rule} or an unsaved draft. */
interface RuleShape {
  readonly conditions: ReadonlyArray<RuleCondition>
  readonly actions: ReadonlyArray<RuleAction>
}

/**
 * Every row one rule points at, in **document order** — the conditions as they are written, then
 * the actions.
 *
 * The identity mapping over {@link mapConditionIds} and {@link mapActionIds}: the same walk
 * {@link replaceRuleReference} uses, so "where can an id hide" is answered in exactly one place.
 * Duplicates are kept — a rule naming one category twice reports it twice, because this answers
 * *what is written*, and the callers that want a set build one.
 */
export function ruleReferences(rule: RuleShape): ReadonlyArray<RuleReference> {
  const found: Array<RuleReference> = []
  const collect: RuleIdMapper = (reference) => {
    found.push(reference)
    return reference.refId
  }
  for (const condition of rule.conditions) mapConditionIds(condition, collect)
  for (const action of rule.actions) mapActionIds(action, collect)
  return found
}

/**
 * The repair: one definition with `fromId` swapped for `toId`, everywhere it appears as `refType`.
 *
 * This is the inverse of {@link ruleReferences} and it is what turns the banner's **Pick a
 * replacement** into one step — the route rewrites the definition here and writes it through
 * `updateRule`, which clears `paused_reason` because replacing the broken reference *is* the
 * resolution.
 *
 * **Pure and total.** No I/O, no repository call, no mutation of the input: the SQL stays where
 * `docs/SPEC.md` §6 says it lives, and the caller can render the result before saving it.
 *
 * **Matched on the pair, never on the id alone.** An id is unique only within its kind, so a payee
 * id that happened to equal a category id would otherwise rewrite a condition nobody was looking
 * at — a corruption with no error attached to it, which is the failure mode this whole stage
 * exists to prevent.
 *
 * **Every occurrence, not the first.** A rule may name the same dead category in a condition *and*
 * in an action; both are rewritten, because the walk is the one {@link ruleReferences} enumerates
 * with.
 *
 * **Nothing to replace returns the argument itself** — reference-identical, and so are its
 * `conditions` and `actions` arrays and every member of them. Callers may rely on that (`===` is a
 * valid "did anything change?" test); they need not, because `updateRule` writes what it is given
 * either way.
 */
export function replaceRuleReference(
  definition: RuleDefinition,
  refType: RuleReferenceType,
  fromId: string,
  toId: string,
): RuleDefinition {
  const map: RuleIdMapper = (reference) =>
    reference.refType === refType && reference.refId === fromId
      ? toId
      : reference.refId

  const conditions = definition.conditions.map((condition) =>
    mapConditionIds(condition, map),
  )
  const actions = definition.actions.map((action) => mapActionIds(action, map))

  const changed =
    conditions.some(
      (condition, index) => condition !== definition.conditions[index],
    ) || actions.some((action, index) => action !== definition.actions[index])

  return changed ? { ...definition, conditions, actions } : definition
}

/* -------------------------------------------------------------------------- */
/* The write path: the delete pauses the rules                                */
/* -------------------------------------------------------------------------- */

export interface PauseRulesReferencingArgs {
  readonly scope: TenantScope
  readonly refType: RuleReferenceType
  /** The id that is going away. A id belonging to another workspace pauses nothing: see below. */
  readonly refId: string
  /** The vanishing row's own name, read **before** it went. This is why it is a parameter. */
  readonly label: string
  /** The moment recorded in the reason. Injected so a test can assert the captured instant. */
  readonly at?: Date
}

/**
 * Pauses every rule in this workspace that names `refId`, in one `UPDATE`.
 *
 * **Called after the delete has succeeded, not before.** A pause written first and then abandoned
 * by a delete that refused — a category still in use, an account with history — would be a warning
 * banner about a row that is still there, and the only way out of it is an edit the person should
 * never have been asked for. Written second, the exposure is the microseconds between two
 * statements, and {@link checkRuleIntegrity} is what closes even that.
 *
 * **Tenancy is the caller's scope, and nothing else.** The rules are listed through the tenant
 * predicate, so a `refId` belonging to another workspace matches none of them and this returns `0`
 * — it cannot pause the other workspace's rules, and it cannot pause this one's either.
 *
 * Returns how many rules were paused, which is `0` on the overwhelmingly common path.
 */
export async function pauseRulesReferencing(
  args: PauseRulesReferencingArgs,
): Promise<number> {
  const refType = z.enum(RULE_REFERENCE_TYPES).parse(args.refType)
  const refId = idSchema.parse(args.refId)
  const label = z.string().parse(args.label).slice(0, MAX_LABEL_LENGTH)

  const affected = (await listRules(args.scope))
    .filter((rule) => rule.pausedReason === null)
    .filter((rule) =>
      ruleReferences(rule).some(
        (reference) =>
          reference.refType === refType && reference.refId === refId,
      ),
    )
    .map((rule) => rule.id)

  if (affected.length === 0) return 0

  return pauseRules(
    args.scope,
    affected,
    writeReason({ refType, refId, label, at: args.at ?? new Date() }),
  )
}

function writeReason(input: {
  readonly refType: RuleReferenceType
  readonly refId: string
  readonly label: string
  readonly at: Date
}): string {
  return JSON.stringify(
    pausedReasonSchema.parse({
      kind: 'missing_reference',
      ref_type: input.refType,
      ref_id: input.refId,
      label: input.label,
      at: input.at.toISOString(),
    }),
  )
}

/* -------------------------------------------------------------------------- */
/* The sweep: what a delete path forgot                                       */
/* -------------------------------------------------------------------------- */

export interface CheckRuleIntegrityArgs {
  readonly scope: TenantScope
  /** Where a finding goes. A finding is a defect report, so it is never silent. */
  readonly logger: Logger
  readonly at?: Date
}

/** One rule that was still running while something it names had already gone. */
export interface RuleIntegrityFinding {
  readonly ruleId: string
  readonly refType: RuleReferenceType
  readonly refId: string
}

export interface RuleIntegrityReport {
  /** Live, unpaused rules examined. A paused rule already carries its reason and is skipped. */
  readonly checked: number
  readonly paused: ReadonlyArray<RuleIntegrityFinding>
}

/**
 * The weekly sweep, per workspace: any live rule naming a row this workspace no longer has.
 *
 * **A healthy workspace produces an empty report and five reads at most** — one per referenced
 * kind, over the ids of the whole rule set at once, never one per condition.
 *
 * A finding pauses the rule, so the person is told, *and* is logged at `warn` with the rule id, so
 * whoever owns the delete path that forgot to call {@link pauseRulesReferencing} can find it. The
 * `label` recorded is the id: the name went with the row, weeks ago.
 *
 * A rule is paused for the **first** reference that is missing, in the document order
 * {@link ruleReferences} lists them in — the conditions as written, then the actions. One rule
 * with two dangling references is one pause and one finding, because a person fixes one thing at a
 * time and the second is waiting behind it (an edit re-checks every reference before it clears the
 * pause).
 */
export async function checkRuleIntegrity(
  args: CheckRuleIntegrityArgs,
): Promise<RuleIntegrityReport> {
  const live = (await listRules(args.scope)).filter(
    (rule) => rule.pausedReason === null,
  )
  if (live.length === 0) return { checked: 0, paused: [] }

  const wanted = new Map<RuleReferenceType, Array<string>>()
  for (const rule of live) {
    for (const reference of ruleReferences(rule)) {
      const bucket = wanted.get(reference.refType)
      if (bucket === undefined) wanted.set(reference.refType, [reference.refId])
      else bucket.push(reference.refId)
    }
  }

  const alive = new Map<RuleReferenceType, Set<string>>()
  for (const [refType, ids] of wanted) {
    alive.set(refType, await listExistingReferenceIds(args.scope, refType, ids))
  }

  const findings: Array<RuleIntegrityFinding> = []
  for (const rule of live) {
    const broken = ruleReferences(rule).find(
      (reference) => !alive.get(reference.refType)?.has(reference.refId),
    )
    if (broken === undefined) continue
    findings.push({ ruleId: rule.id, ...broken })
  }

  // Grouped by reason so that a sweep finding many rules broken by one deletion — the shape a
  // missing delete-path call actually has — is one statement, not one per rule.
  const at = args.at ?? new Date()
  for (const { reason, ruleIds } of groupByReason(findings)) {
    await pauseRules(
      args.scope,
      ruleIds,
      writeReason({ ...reason, label: reason.refId, at }),
    )
  }

  for (const finding of findings) {
    args.logger.warn(
      'rule integrity sweep paused a rule a delete path missed',
      {
        ruleId: finding.ruleId,
        refType: finding.refType,
        refId: finding.refId,
        organizationId: args.scope.ctx.organizationId,
      },
    )
  }

  return { checked: live.length, paused: findings }
}

/** The findings collapsed to one entry per deleted row, which is one `UPDATE` per entry. */
function groupByReason(
  findings: ReadonlyArray<RuleIntegrityFinding>,
): ReadonlyArray<{
  readonly reason: RuleReference
  readonly ruleIds: Array<string>
}> {
  const grouped = new Map<
    string,
    { readonly reason: RuleReference; readonly ruleIds: Array<string> }
  >()
  for (const finding of findings) {
    const key = `${finding.refType}:${finding.refId}`
    const bucket = grouped.get(key)
    if (bucket === undefined) {
      grouped.set(key, {
        reason: { refType: finding.refType, refId: finding.refId },
        ruleIds: [finding.ruleId],
      })
    } else bucket.ruleIds.push(finding.ruleId)
  }
  return [...grouped.values()]
}
