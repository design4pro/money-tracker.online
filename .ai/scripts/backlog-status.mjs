#!/usr/bin/env node
// Vendored here since ADR 0021 retired design4pro/agent-kit. This is the only copy and it is
// edited in place; its cases are in .ai/scripts/__tests__/backlog-status.test.mjs.
//
// Reports where every open issue sits in the SDLC flow and the single next step that moves it,
// with `--next` names the one issue the scheduled implement-ticket run takes next, and with `--plan`
// prints everything the Reconciler (docs/agents/cezar.md, ADR 0030) may start right now, at most one
// action per kind.
// Read-only: it never applies a label. No label marks an issue ready (ADR 0029); readiness is the
// rule in `classify`, so the report a person reads and the pick a run makes cannot disagree.
//
// It keeps no knowledge of its own that another file already holds:
//   - the category, priority and risk labels come from .ai/agentic.config.json;
//   - the trusted authors are the `authors` gates of the issue automations in
//     docs/agents/cezar-automations.json, plus the retired agent account: an issue anyone else
//     opened is never auto-implemented, and neither is one filed from a Sentry finding (its
//     `sentry-issue` marker), whoever filed it;
//   - "not ready" is read through the 🤖 comment marker every skill writes
//     (.ai/trackers/github.md) - a groom's not-ready comment, or the `STOP:` comment implement-ticket
//     leaves on an issue it would not take - so a human comment newer than it is the answer, and the
//     schedule never picks the same refused issue every tick. So is a later trusted `🤖 RESOLVED:`
//     comment, which is how `unblock` answers one on a specialist's verdict. A comment that says
//     `HUMAN-ONLY:` names what only a person can do, and no run is started on that issue;
//   - the run queue comes from .ai/cezar/runs.json when the host has one.
//
// Why it parses pull-request linkage itself rather than asking the tracker: pull requests here
// target the base branch while the repository's default branch is another, and GitHub populates
// `closingIssuesReferences` / `closedByPullRequestsReferences` for neither side of that pairing.
// Measured on money-tracker.online: 15 of 15 recently merged pull requests carrying an explicit
// closing keyword report an empty list, including one whose body opens with `Closes #163`. Reading
// that field would mean the IN_REVIEW state could never once fire.
//
// `--flow` answers a different question: not where each issue sits, but whether the pipeline is
// moving at all. Four numbers, each from a file or a command whose output is read - launches per
// automation, issue opened to its first Agent Brief, the Agent Brief to the first pull request, and
// the share of gate steps that needed a second try - plus the `in-progress` claims no live run
// stands behind, which is the commonest way the pipeline stops. Three of those read
// `.ai/cezar/runs.json`, which is gitignored and therefore absent in a worktree or a fresh clone;
// there the report says it cannot measure them rather than printing the zeroes. Poll counts are
// deliberately absent: they live only in the running cockpit's automation state, not in any
// committed file, and the report says so rather than printing a zero it did not measure.
//
// Usage: node .ai/scripts/backlog-status.mjs [--json | --next | --plan] [--stale-hours N]
//        node .ai/scripts/backlog-status.mjs --flow [--json]

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const AUTOMATIONS = "docs/agents/cezar-automations.json";
const CONFIG = ".ai/agentic.config.json";
const RUNS = ".ai/cezar/runs.json";
const SPECS = ".ai/specs";
const PLANS = "docs/plans";
// cezar's own in-flight set, verbatim: `IN_FLIGHT_STATUSES` in
// packages/cezar/src/dispatch/engine.ts:33. `waiting` is a run parked on `CEZ:ASK` - still live,
// still holding its claim - and `review` is *terminal* there (`TERMINAL_STATUSES`, line 37),
// alongside done, failed and cancelled.
//
// This set used to read `queued, running, review`, which was wrong in both directions: it called
// a finished run active, and it called a run waiting on a human dead. The second is the dangerous
// one - `staleClaims` would print a live run as a BLOCKING stale lock, and the backlog skill tells
// a reader to remove those labels, which would drop a real claim and let the next poll start
// duplicate work on the same pull request.
const ACTIVE_RUN_STATES = new Set(["queued", "running", "waiting"]);

/**
 * Open PRs waiting for a person at which `--next` and `--plan` stop handing out implementation, so
 * the queue never outruns the review only a person can give. PRs the pipeline merges by itself do
 * not count (ADR 0030).
 */
export const WIP_LIMIT = 3;

/**
 * How long a `changes-requested` PR may go without an update before it counts as waiting for a person.
 * The label is normal while `om-pr-autopilot` fixes what the review asked for; a PR it sits on for this
 * long is one the autopilot stopped at, parked on a decision no run is making.
 */
export const CHANGES_REQUESTED_PARKED_HOURS = 24;

/**
 * Accounts that no longer exist but whose work is still on the tracker. `design4pro-agent` was the
 * agent identity until the owner retired it (ADR 0027, ADR 0029); every issue and PR it filed came
 * out of an agent run the maintainer launched, and it can file nothing new, so trusting its past
 * output adds no input an outsider could produce.
 */
export const RETIRED_AGENT_LOGINS = ["design4pro-agent"];
const HOLD_LABELS = ["blocked", "do-not-merge", "do-not-close"];

export const PRIORITY_ORDER = [
  "priority-extreme",
  "priority-high",
  "priority-medium",
  "priority-low",
];

export const STATE_ORDER = [
  "BLOCKED",
  "RUNNING",
  "QUEUED",
  "STUCK",
  "IN_REVIEW",
  "TRACKING",
  "WAITING",
  "NOT_READY",
  "EXTERNAL",
  "NEEDS_TRIAGE",
  "READY",
];

/**
 * Text with fenced blocks and inline backtick spans removed.
 *
 * A closing keyword inside a code sample is a quotation, not a link - `om-close-fixed-issues`
 * rejects those matches and so does this.
 */
export const stripCode = (text) =>
  String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ");

/**
 * The issue numbers a text closes, by the rule in `om-close-fixed-issues`: one of the English
 * keywords, preceded by start-of-text or a character that is neither a letter, a digit nor `_`,
 * followed by whitespace and `#{digits}`.
 *
 * Deliberately not wrapped in `\b`: that boundary is ASCII-only and fails silently on a keyword
 * whose first or last character is not ASCII. A bare `#N` mention is never a link.
 */
export function closeKeywordTargets(text) {
  const pattern =
    /(^|[^A-Za-z0-9_])(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\s+#(\d+)/gi;
  const found = new Set();
  for (const match of stripCode(text).matchAll(pattern))
    found.add(Number(match[2]));
  return [...found];
}

/**
 * The issue a branch name claims, by the `<type>/issue-<n>-<slug>` convention.
 *
 * The type segment is deliberately open rather than a list: both repositories have cut branches
 * under more prefixes than their own documentation names, and a closed list would quietly stop
 * matching the next one somebody invents.
 */
export function branchIssue(headRefName) {
  const match = /^[^/]+\/issue-(\d+)(?:-|$)/.exec(String(headRefName ?? ""));
  return match ? Number(match[1]) : null;
}

/**
 * The issues listed under a `## Blocked by` heading (the afk-to-tickets ticket shape), read up to
 * the next heading. "None - can start immediately" lists nothing.
 */
export function blockedBy(body) {
  const section = /^#{2,3}\s*Blocked by[ \t]*$([\s\S]*?)(?=^#{1,3}\s|(?![\s\S]))/im.exec(
    stripCode(body),
  );
  return section ? [...section[1].matchAll(/#(\d+)/g)].map((match) => Number(match[1])) : [];
}

/**
 * Pull requests keyed by the issue each one addresses: the open ones, plus the recently merged
 * ones (flagged `merged`) the caller passes. `develop` is not the default branch, so a merge does
 * not close the issue; until `om-close-fixed-issues` runs, a merged PR is all that tells the
 * schedule the work is done and `--next` must not take the issue again.
 *
 * Two signals, and which one matched is kept rather than collapsed: a keyword is the author saying
 * the pull request closes the issue, while a branch name says only that the work belongs to it.
 * `#268` on money-tracker.online is the case that fixes the distinction in place - a deliberate
 * partial fix whose branch names issue 189 and whose body says, in its first paragraph, that it
 * does not close it. So a branch-only link raises a question for a human and never a suggested
 * edit; treating it as a missing keyword would have closed an open defect.
 */
export function linkOpenPrs(prs) {
  const byIssue = new Map();
  const add = (issue, pr, viaKeyword) => {
    const links = byIssue.get(issue) ?? [];
    const existing = links.find((l) => l.number === pr.number);
    if (existing) existing.viaKeyword ||= viaKeyword;
    else links.push({ number: pr.number, title: pr.title, viaKeyword, ...(pr.merged && { merged: true }) });
    byIssue.set(issue, links);
  };

  for (const pr of prs) {
    const keyworded = new Set([
      ...closeKeywordTargets(pr.body),
      ...closeKeywordTargets(pr.title),
    ]);
    for (const issue of keyworded) add(issue, pr, true);
    const claimed = branchIssue(pr.headRefName);
    if (claimed !== null) add(claimed, pr, keyworded.has(claimed));
  }
  return byIssue;
}

/**
 * The logins the issue automations trust: the union of their `authors` gates. An automation with
 * no gate adds nobody, so a missing gate makes nothing ready rather than everything.
 */
export function readTrusted(automations) {
  const trusted = new Set();
  for (const automation of automations) {
    if (!(automation.events ?? []).some((event) => event.startsWith("issue."))) continue;
    for (const login of automation.filters?.authors ?? []) trusted.add(login);
  }
  return trusted;
}

/**
 * The authors a run may act on: the gated logins plus the retired agent account. A repository whose
 * automations gate nobody trusts nobody - the retired logins do not turn a missing gate into an
 * open door.
 */
export function trustedAuthors(automations) {
  const gated = readTrusted(automations);
  return gated.size === 0 ? gated : new Set([...gated, ...RETIRED_AGENT_LOGINS]);
}

const hasLabel = (pr, name) => pr.labels.some((label) => label.name === name);

/**
 * A PR sits with a person when no run can move it: QA the unattended sign-off may not give
 * (`needs-qa` still without `qa-approved`), a diff the owner signs off (`risk-high`, `security`), or
 * a hold (`blocked`, or a person's `do-not-merge`), or a `changes-requested` nobody has touched for
 * `CHANGES_REQUESTED_PARKED_HOURS`. Everything else - `review`, a fresh `changes-requested`,
 * `merge-queue`, a plain draft - is on its way to `om-pr-autopilot --allow-merge`, which merges it
 * into `develop` without anyone.
 *
 * Pure: `now` is passed in (epoch milliseconds), and a PR with no `updatedAt`, or a call with no
 * `now`, is never parked, because the rule needs both.
 */
export const waitsForPerson = (pr, now) =>
  (hasLabel(pr, "needs-qa") && !hasLabel(pr, "qa-approved")) ||
  ["risk-high", "security", "blocked", "do-not-merge"].some((label) => hasLabel(pr, label)) ||
  (hasLabel(pr, "changes-requested") &&
    (now - Date.parse(pr.updatedAt)) / 36e5 >= CHANGES_REQUESTED_PARKED_HOURS);

/**
 * The WIP the cap counts: open PRs by a trusted author that wait for a person. Counting every agent
 * PR throttled the pipeline on work it was about to merge itself (ADR 0030), while the queue the
 * cap has to protect - what only a person can clear - is exactly this set. The promotion (base
 * `main`) is the release, not work in flight, and dependabot is not a trusted author.
 */
export const countWip = (prs, trusted, now) =>
  prs.filter(
    (pr) => trusted.has(pr.author?.login) && pr.baseRefName !== "main" && waitsForPerson(pr, now),
  ).length;

// A 🤖-prefixed comment is a skill's (.ai/trackers/github.md), and so is one opening with the
// "generated by AI" quote that afk-triage, afk-to-tickets and afk-architecture-review sign with;
// anything else is a human's.
const isAgentComment = (comment) => /^(?:🤖|>\s*[_*]This was generated by AI)/.test(String(comment.body).trimStart());
// `unblock` answers a not-ready or `STOP:` comment with `🤖 RESOLVED: ...` (afk-unblock).
const isResolved = (comment) => /^🤖\s*RESOLVED:/.test(String(comment.body).trimStart());
// What only a person can do (afk-decide § 5); no run is started on an issue whose comment says so.
const HUMAN_ONLY = /\bHUMAN-ONLY:/;
// In an issue body only a marker that opens a line counts, so a body that merely quotes the word
// (an issue about this very rule) is not handed to a person.
const HUMAN_ONLY_LINE = /^[ \t]*(?:🤖[ \t]*)?HUMAN-ONLY:/m;
const hasBrief = (text) => /^#{2,3}\s*Agent Brief\b/m.test(stripCode(text));
const SENTRY_MARKER = /<!--\s*sentry-issue:/;

/** One issue's state and the single next step that moves it. Pure: every input is passed in. */
export function classify(
  issue,
  { trusted, sdlcLabels, openIssues, runs, prLinks, staleHours, now },
) {
  const labels = issue.labels.map((label) => label.name);
  const has = (label) => labels.includes(label);
  const comments = issue.comments ?? [];
  const run = runs.get(issue.number);
  const prs = prLinks.get(issue.number) ?? [];

  // A `RESOLVED:` comment is the answer, never the question, even when it quotes the `STOP:` it
  // answers.
  const notReady = comments
    .filter(
      (c) =>
        isAgentComment(c) &&
        !isResolved(c) &&
        (c.body.includes("not ready") || /\bSTOP:/.test(c.body)),
    )
    .at(-1);
  const answered =
    notReady &&
    comments.some(
      (c) =>
        c.createdAt > notReady.createdAt &&
        // A human's reply, the readiness verifier resolving the gap in the human's place
        // (SDLC.md § Definition of Ready), afk-triage settling it into an Agent Brief, or
        // afk-unblock resolving it on a specialist's verdict (`🤖 RESOLVED:`).
        // Only a trusted author answers: READY starts an unattended run, so a stranger's "+1" must
        // not re-open an issue whose last run stopped.
        trusted.has(c.author?.login) &&
        (!isAgentComment(c) ||
          isResolved(c) ||
          c.body.includes("readiness verified") ||
          hasBrief(c.body)),
    );
  // Only a trusted author's brief counts: the body is the reporter's, so for an issue someone
  // else opened, a brief they wrote into it would be a self-approval.
  const briefed =
    hasBrief(issue.body) ||
    comments.some((c) => trusted.has(c.author?.login) && hasBrief(c.body));
  const missingLabels = Object.entries(sdlcLabels)
    .filter(([, names]) => !names.some(has))
    .map(([group]) => group);
  const waitingOn = blockedBy(issue.body).filter((number) => openIssues.has(number));
  const hoursIdle = (now - Date.parse(issue.updatedAt)) / 36e5;

  // `canUnblock` marks the two states an `unblock` run may try to lift, and only on an issue a run
  // may read at all: its author is trusted and it is no Sentry ticket (the same gate that keeps such
  // an issue out of READY). The rest is what separates a hold an agent set from one a person did.
  const unblockable = trusted.has(issue.author?.login) && !SENTRY_MARKER.test(issue.body ?? "");
  // A person owns the issue while a `HUMAN-ONLY:` marker stands: one in the body of an issue a
  // trusted author opened (afk-plan-to-spec files one that way) or in a trusted agent's comment,
  // with no trusted person's comment after it. Only a trusted author counts, as for every other
  // reading of a comment here: an outsider's "🤖 HUMAN-ONLY:" must not park an issue, nor a
  // "🤖 hi" stand in for the explanation of a hold.
  const trustedAgentComment = (c) => isAgentComment(c) && trusted.has(c.author?.login);
  const humanOnlyAt = [
    trusted.has(issue.author?.login) && HUMAN_ONLY_LINE.test(stripCode(issue.body))
      ? issue.createdAt
      : undefined,
    ...comments
      .filter((c) => trustedAgentComment(c) && HUMAN_ONLY.test(c.body))
      .map((c) => c.createdAt),
  ]
    .filter(Boolean)
    .sort()
    .at(-1);
  const humanOnly =
    humanOnlyAt !== undefined &&
    !comments.some(
      (c) =>
        c.createdAt > humanOnlyAt && trusted.has(c.author?.login) && !isAgentComment(c),
    );
  const state = (name, next, warning, canUnblock = false) => ({
    ...issue,
    labels,
    state: name,
    next,
    warning: warning ?? null,
    prs,
    canUnblock: unblockable && canUnblock,
  });

  const hold = HOLD_LABELS.filter(has);
  if (hold.length) {
    // An agent set the hold when its explanation is the last word on the issue: a person who
    // commented after it has taken the hold over, and one who set the label without a comment left
    // no explanation to lift. `blocked` alone: `do-not-merge` and `do-not-close` are always a
    // person's.
    // The last comment must be a trusted agent's explanation: an Agent Brief or a `RESOLVED:` is
    // an answer, not the reason for a hold, so a person who set `blocked` after one has not left
    // an agent's hold to lift.
    const last = comments.at(-1);
    const agentHold =
      hold.length === 1 &&
      hold[0] === "blocked" &&
      last !== undefined &&
      trustedAgentComment(last) &&
      !hasBrief(last.body) &&
      !isResolved(last) &&
      !humanOnly;
    return state(
      "BLOCKED",
      agentHold
        ? "An agent set `blocked`: the `unblock` run lifts it on a specialist's verdict, or leaves a `HUMAN-ONLY:` comment naming what a person must do."
        : `A person clears \`${hold.join("`, `")}\`: the 🤖 comment names what they must do first.`,
      undefined,
      agentHold,
    );
  }

  if (has("in-progress"))
    return hoursIdle > staleHours
      ? state(
          "STUCK",
          `Claimed but idle for ${Math.round(hoursIdle)}h - check the run, then \`gh api -X DELETE "repos/{owner}/{repo}/issues/${issue.number}/labels/in-progress"\`.`,
        )
      : state("RUNNING", `A run holds the claim (${run?.workflow ?? "cockpit"}). Wait.`);

  if (run)
    return state("QUEUED", `Cezar has a ${run.status} \`${run.workflow}\` run for it. Wait.`);

  if (prs.length) {
    const open = prs.filter((pr) => !pr.merged);
    const branchOnly = prs.filter((pr) => !pr.viaKeyword);
    const warning = branchOnly.length
      ? `${branchOnly.map((pr) => `#${pr.number}`).join(", ")} names this issue in its branch but no closing keyword links it. Does it close the issue? If it does, the body needs \`Closes #${issue.number}\` or housekeeping will leave this open; if it is a partial fix, nothing to change.`
      : null;
    return state(
      "IN_REVIEW",
      open.length
        ? `${open.map((pr) => `#${pr.number}`).join(", ")} open - drive it with \`/om-pr-autopilot ${open[0].number}\`.`
        : `${prs.map((pr) => `#${pr.number}`).join(", ")} merged but the issue is still open - \`/om-close-fixed-issues\` closes it when the PR carries a closing keyword; otherwise a person closes it, or leaves it open if the fix was partial.`,
      warning,
    );
  }

  // The parent afk-to-tickets files for a spec: its tickets carry the work, it carries none.
  if (/^Spec: \.ai\/specs\//.test(issue.body ?? ""))
    return state("TRACKING", "A spec parent: its tickets carry the work. Nothing to do.");

  if (waitingOn.length)
    return state(
      "WAITING",
      `Blocked by open ${waitingOn.map((n) => `#${n}`).join(", ")} - the schedule takes it once they close.`,
    );

  // No run is started on an issue a person owns, whether or not a not-ready comment is open.
  if (humanOnly)
    return state(
      "NOT_READY",
      "A `HUMAN-ONLY:` marker names what only a person can do: do it and comment, and the schedule takes the issue again.",
    );

  if (notReady && !answered)
    return state(
      "NOT_READY",
      "Answer the not-ready or `STOP:` comment, or let the `unblock` run settle it, then start `issue-groom` on it from the cockpit.",
      undefined,
      true,
    );

  // The body quotes production error data, which anyone who can make the app fail can write -
  // and an issue filed from a Sentry finding carries the maintainer's login all the same.
  if (SENTRY_MARKER.test(issue.body ?? ""))
    return state(
      "EXTERNAL",
      "Filed from a Sentry finding, so its body quotes production error data: read it, then start `issue-groom` or `implement-ticket` on it from the cockpit.",
    );

  if (!trusted.has(issue.author?.login))
    return state(
      "EXTERNAL",
      `Opened by ${issue.author?.login ?? "an unknown author"}, whom no automation trusts: read it, then start \`issue-groom\` or \`implement-ticket\` on it from the cockpit, or open it again yourself.`,
    );

  const missing = [
    ...(briefed ? [] : ["Agent Brief"]),
    ...missingLabels.map((group) => `${group} label`),
  ];
  if (missing.length)
    return state(
      "NEEDS_TRIAGE",
      `No ${missing.join(", ")} yet: start \`issue-groom\` on it from the cockpit.`,
    );

  return state(
    "READY",
    "Ready: the scheduled `implement-ticket` run takes it, or start one on it from the cockpit.",
  );
}

const priorityRank = (labels) => {
  const index = PRIORITY_ORDER.findIndex((label) => labels.includes(label));
  return index === -1 ? PRIORITY_ORDER.indexOf("priority-medium") : index;
};

export const sortIssues = (issues) =>
  [...issues].sort(
    (a, b) =>
      STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) ||
      priorityRank(a.labels) - priorityRank(b.labels) ||
      a.number - b.number,
  );

/**
 * The issue the scheduled run takes: the first READY one in report order (highest priority, then
 * oldest), or null while `WIP_LIMIT` PRs wait for a person or nothing is ready.
 */
export function pickNext(sortedIssues, wip) {
  if (wip >= WIP_LIMIT) return null;
  return sortedIssues.find((issue) => issue.state === "READY")?.number ?? null;
}

/** The `Status` row of a spec's metadata table (.ai/specs/AGENTS.md), or null without one. */
export const specStatus = (text) =>
  /^\|\s*\*\*Status\*\*\s*\|\s*([^|\s]+)\s*\|/m.exec(text)?.[1] ?? null;

/**
 * The specs `afk-to-tickets` has not sliced yet, oldest first: `ready` (merged, waiting for a build)
 * and with no issue, open or closed, whose body starts `Spec: <path>` - the parent it files.
 * There is no age window: a spec that merged last month is as sliceable as one that merged
 * today, which the old "added in the last 14 days" rule got wrong for every spec that sat
 * in review longer than that. `specs` are the files directly in `.ai/specs/`; the status
 * directories hold specs whose build is done or dropped.
 */
export function unslicedSpecs(specs, issues) {
  const parents = issues.map((issue) => String(issue.body ?? "").trimStart());
  return [...specs]
    .sort((a, b) => a.path.localeCompare(b.path))
    .filter((spec) => specStatus(spec.text) === "ready")
    .filter((spec) => !parents.some((body) => body.startsWith(`Spec: ${spec.path}`)));
}

/**
 * Every `## Stage NN-SM` of the plans in `docs/plans/`, in file-name order and then document order:
 * the sequence the plan was written to be built in. Only `NN-area.md` files are plans (the README
 * and the TEMPLATE are not), and a heading inside a code sample is a quotation. `ambiguous` marks
 * an id two plan files both use: for those an id alone does not say which stage a mention covers.
 * (No two plans share an id today; the check costs one line and stops the next collision from
 * silently covering the wrong stage.)
 *
 * `delivered` marks a stage the code already carries: its section, from the heading to the next
 * `## ` heading, holds a line that starts `Delivered:`. `afk-plan-to-spec` writes that line, and
 * `pickStage` then leaves the stage alone: no spec is left to write for it.
 */
export function planStages(planFiles) {
  const stages = [];
  const plans = planFiles
    .filter((file) => /^\d{2}-[a-z0-9-]+\.md$/.test(file.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const plan of plans)
    for (const section of stripCode(plan.text).split(/^(?=##\s)/m)) {
      const heading = section.match(/^##\s+Stage\s+(\d{2}-S\d+[a-z]?)\b/);
      if (heading)
        stages.push({
          id: heading[1],
          file: `${PLANS}/${plan.name}`,
          ambiguous: false,
          delivered: /^Delivered:/m.test(section),
        });
    }
  for (const stage of stages)
    stage.ambiguous = stages.some((other) => other.id === stage.id && other.file !== stage.file);
  return stages;
}

/**
 * Whether a text covers a stage: it names the id, and, for an ambiguous id, the plan file too. A
 * trailing letter still counts (`01-S9a` covers `01-S9`: the stage was cut into slices) but a longer
 * number does not (`02-S10` is not `02-S1`).
 */
export function coversStage(text, stage) {
  if (!new RegExp(`(?<![A-Za-z0-9])${stage.id}(?![0-9])`).test(text)) return false;
  return !stage.ambiguous || text.includes(stage.file);
}

/**
 * The first plan stage no spec and no issue, open or closed, mentions, that is not marked
 * `Delivered:` in its plan, and no run is writing: the next stage whose spec nobody has started.
 * An issue counts because a stage held back by a decision only a person can take is filed as one
 * (afk-plan-to-spec), and that is as covered as a spec; the marker covers a stage the code already
 * delivers, which has no spec to write. `corpus` is the text of every spec at any depth plus every
 * issue's title and body.
 */
export function pickStage({ stages, corpus, activeTasks }) {
  return (
    stages.find(
      (stage) =>
        !stage.delivered &&
        !corpus.some((text) => coversStage(text, stage)) &&
        !activeTasks.some((task) => coversStage(task, stage)),
    ) ?? null
  );
}

/**
 * Whether an open PR adds a spec. `gh pr list --json files` carries no change type, so "adds" is a
 * file in `.ai/specs/` with no deleted line: a new document, where a status flip or a move
 * deletes the line it replaces. The generated index and the agent rules are not specs.
 */
export const addsSpec = (pr) =>
  (pr.files ?? []).some(
    (file) =>
      file.path.startsWith(`${SPECS}/`) &&
      file.path.endsWith(".md") &&
      !/\/(?:README|AGENTS)\.md$/.test(file.path) &&
      file.additions > 0 &&
      file.deletions === 0,
  );

/**
 * Whether an open PR is the docs-only PR `afk-plan-to-spec` opens to mark stages the code already
 * delivers. Until it merges the plan has no `Delivered:` line, so `--plan` would name the same stage
 * again on the next tick. Only that branch prefix counts: any other PR touching `docs/plans/` is a
 * person's edit of a plan, and must not stall the queue.
 */
export const marksDeliveredStages = (pr) =>
  String(pr.headRefName ?? "").startsWith("docs/plan-delivered-");

/** The workflow each kind of action starts, in the order `--plan` lists them. */
export const PLAN_WORKFLOWS = {
  implement: "implement-ticket",
  unblock: "unblock",
  triage: "triage",
  slice: "spec-to-tickets",
  "write-spec": "plan-to-spec",
};

const issueText = (issue) => `${issue.title ?? ""}\n${issue.body ?? ""}`;

/**
 * What the Reconciler may start right now: at most one action per kind, in `PLAN_WORKFLOWS` order,
 * a kind with no candidate left out. Pure, and the only place the five candidate rules live:
 *
 * - implement: `pickNext`, so the pick and `--next` cannot disagree;
 * - unblock: the first issue in report order whose hold or not-ready comment an agent may lift;
 * - triage: the first NEEDS_TRIAGE issue in report order;
 * - slice: the oldest `ready` spec with no parent issue (`unslicedSpecs`);
 * - write-spec: the first stage of `docs/plans/` nothing covers and its plan does not mark
 *   `Delivered:` (`pickStage`), but only while no PR adds a spec or marks stages delivered
 *   (`marksDeliveredStages`) and there is no slice candidate.
 *   A spec a run is already slicing is not a candidate, so the next stage is written meanwhile; a
 *   spec that waits for a run is, and holds it back. One spec ahead of the slicing at a time keeps
 *   the review panel's merge order and the plan's wave order the same thing.
 *
 * Every candidate is dropped while a run already holds it: an issue by its `issueNumber`, a spec
 * path or a stage id by the task text of the live runs.
 */
export function buildPlan({
  issues,
  wip,
  runs,
  activeTasks,
  specs,
  stages,
  allIssues,
  specCorpus,
  openPrs,
}) {
  const actions = [];
  const onIssue = (kind, number, task) =>
    actions.push({ kind, target: `#${number}`, workflow: PLAN_WORKFLOWS[kind], task });
  const idle = (issue) => !runs.has(issue.number);

  const implement = pickNext(issues, wip);
  if (implement !== null) onIssue("implement", implement, `Implement issue #${implement}.`);

  const unblock = issues.find((issue) => issue.canUnblock && idle(issue));
  if (unblock) onIssue("unblock", unblock.number, `Resolve the hold on issue #${unblock.number}.`);

  const triage = issues.find((issue) => issue.state === "NEEDS_TRIAGE" && idle(issue));
  if (triage) onIssue("triage", triage.number, `Triage issue #${triage.number}.`);

  const unsliced = unslicedSpecs(specs, allIssues);
  const slice = unsliced.find((spec) => !activeTasks.some((task) => task.includes(spec.path)));
  if (slice)
    actions.push({
      kind: "slice",
      target: slice.path,
      workflow: PLAN_WORKFLOWS.slice,
      task: `Slice the spec ${slice.path} into tickets.`,
    });

  const stage =
    slice === undefined && !openPrs.some((pr) => addsSpec(pr) || marksDeliveredStages(pr))
      ? pickStage({ stages, corpus: [...specCorpus, ...allIssues.map(issueText)], activeTasks })
      : null;
  if (stage)
    actions.push({
      kind: "write-spec",
      target: stage.id,
      workflow: PLAN_WORKFLOWS["write-spec"],
      task: `Write the spec for plan stage ${stage.id} (${stage.file}).`,
    });

  return { wip: { waitingForPerson: wip, limit: WIP_LIMIT }, actions };
}

/**
 * Launches per committed automation, from the runs the cockpit recorded.
 *
 * Only a run carrying an `automation` block counts: the same workflow started by hand from the
 * cockpit is a person's doing and would make a dead automation look alive. Automations are matched
 * by `task.workflow`, and two that share one - `issue-groom` has two - are reported on one row
 * under both names, because the runs file records the workflow and not which of them asked.
 *
 * A zero row is the point of this function, so every committed automation appears whether or not
 * it ever ran, and the zeroes sort first.
 */
export function automationLaunches(runs, automations) {
  // `runs` is what the cockpit still holds, not all history: the file is a window the service
  // rewrites, and a count here is "since the oldest retained run", never "ever".
  const launched = new Map();
  for (const run of runs) {
    if (!run.automation || !run.workflow) continue;
    const seen = launched.get(run.workflow) ?? { count: 0, lastAt: null };
    seen.count += 1;
    const at = run.startedAt ?? run.createdAt ?? null;
    if (at && (!seen.lastAt || at > seen.lastAt)) seen.lastAt = at;
    launched.set(run.workflow, seen);
  }
  const byWorkflow = new Map();
  for (const automation of automations) {
    const workflow = automation.task?.workflow ?? automation.name;
    const row = byWorkflow.get(workflow) ?? { workflow, names: [], launches: 0, lastAt: null };
    row.names.push(automation.name);
    byWorkflow.set(workflow, row);
  }
  for (const row of byWorkflow.values()) {
    const seen = launched.get(row.workflow);
    row.launches = seen?.count ?? 0;
    row.lastAt = seen?.lastAt ?? null;
  }
  return [...byWorkflow.values()].sort(
    (a, b) => a.launches - b.launches || a.workflow.localeCompare(b.workflow),
  );
}

/**
 * How often the validation gate needed more than one attempt.
 *
 * `iterations` is what cezar increments when `onFail.retry` sends a gate step back through the
 * implement step, so a rate above zero is rework the pipeline paid for and nobody saw.
 */
export function gateRetries(runs) {
  let steps = 0;
  let retried = 0;
  let attempts = 0;
  for (const run of runs) {
    for (const step of run.steps ?? []) {
      if (step.id !== "gate") continue;
      steps += 1;
      const iterations = Number(step.iterations ?? 1);
      attempts += iterations;
      if (iterations > 1) retried += 1;
    }
  }
  return { steps, retried, attempts };
}

/**
 * Median and slowest of a set of `{ number, from, to }` spans, in hours.
 *
 * `pending` - a span whose `to` never happened - is returned rather than dropped, because a
 * latency computed only over the issues that made it through is the number that hides the stall.
 * A `to` before its `from` is counted as pending too: it means the label predates the span this
 * caller is measuring, and averaging a negative would quietly flatter the result.
 */
export function spanSummary(spans) {
  const hours = [];
  const pending = [];
  for (const span of spans) {
    const from = Date.parse(span.from ?? "");
    const to = Date.parse(span.to ?? "");
    if (!Number.isFinite(from)) continue;
    if (!Number.isFinite(to) || to < from) {
      pending.push(span.number);
      continue;
    }
    hours.push({ number: span.number, hours: (to - from) / 3_600_000 });
  }
  hours.sort((a, b) => a.hours - b.hours);
  const middle = hours.length ? hours[Math.floor((hours.length - 1) / 2)] : null;
  return {
    measured: hours.length,
    pending: pending.sort((a, b) => a - b),
    // Four decimals, not two: 0.0001 h is a third of a second, and the bridge labelling an issue
    // two seconds after it opened is this report's success case. Two decimals rounded it to zero.
    medianHours: middle ? Number(middle.hours.toFixed(4)) : null,
    slowest: hours.length
      ? { number: hours.at(-1).number, hours: Number(hours.at(-1).hours.toFixed(4)) }
      : null,
  };
}

/**
 * When an issue first carried an Agent Brief: its own creation when a trusted author wrote the
 * brief into the body (an afk-to-tickets ticket), otherwise the first trusted comment carrying one.
 * The trust rule is `classify`'s, so a brief the report would not count is not a measured span.
 */
export function firstBriefAt(issue, trusted) {
  if (trusted.has(issue.author?.login) && hasBrief(issue.body)) return issue.createdAt;
  const stamps = (issue.comments ?? [])
    .filter((c) => trusted.has(c.author?.login) && hasBrief(c.body) && c.createdAt)
    .map((c) => c.createdAt)
    .sort();
  return stamps[0] ?? null;
}

/**
 * Issue opened -> its first Agent Brief, one span per issue issue-groom runs on.
 *
 * Two kinds of issue are left out rather than counted as pending: one no automation trusts the
 * author of, which no run will ever brief, and a ticket that was filed with its brief in the body,
 * which never went through intake - its zero would flatter the median.
 */
export function intakeSpans(issues, trusted) {
  return issues
    .filter((issue) => trusted.has(issue.author?.login) && !hasBrief(issue.body))
    .map((issue) => ({
      number: issue.number,
      from: issue.createdAt,
      to: firstBriefAt(issue, trusted),
    }));
}

/**
 * The first Agent Brief -> the first pull request that claims the issue.
 *
 * Linkage comes from `linkOpenPrs`, which is this file's own parser rather than the tracker's
 * `closingIssuesReferences` - the header says why that field is unusable here. `prOpenedAt` maps a
 * pull-request number to when it was opened; keeping it beside the links rather than inside them
 * leaves `linkOpenPrs` and the `--json` shape it feeds untouched. A ticket waits for its blockers
 * inside this span, so it measures the queue as well as the implementation.
 */
export function firstPrSpans(issues, prLinks, prOpenedAt, trusted) {
  const spans = [];
  for (const issue of issues) {
    const briefAt = firstBriefAt(issue, trusted);
    if (!briefAt) continue;
    const opened = (prLinks.get(issue.number) ?? [])
      .map((pr) => prOpenedAt.get(pr.number))
      .filter(Boolean)
      .sort();
    spans.push({ number: issue.number, from: briefAt, to: opened[0] ?? null });
  }
  return spans;
}

const gh = (args) =>
  JSON.parse(
    execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }),
  );

/**
 * A run still holds its issue while the cockpit works on it or will: an active status, or a
 * `failed` run with `autoResumeAt`, which the cockpit resumes by itself after a provider usage
 * limit. Any other failure is the Reconciler's to repair, and it does that by continuing the run.
 */
export const isAlive = (run) =>
  ACTIVE_RUN_STATES.has(run.status) || (run.status === "failed" && Boolean(run.autoResumeAt));

/** The live runs keyed by the issue each one works on. Runs without an `issueNumber` are left out. */
export function runsByIssue(records) {
  const byIssue = new Map();
  for (const run of records) {
    if (!run.issueNumber || !isAlive(run)) continue;
    byIssue.set(Number(run.issueNumber), { status: run.status, workflow: run.workflow });
  }
  return byIssue;
}

/** The cockpit's run records. Absent on a non-cockpit host, where nothing is queued. */
const readRunRecords = () => (existsSync(RUNS) ? JSON.parse(readFileSync(RUNS, "utf8")) : []);

/** Every `.md` under `dir`, at any depth, as `{ path, text }`; empty when `dir` is absent. */
function readMarkdown(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return readMarkdown(path);
    return entry.name.endsWith(".md") ? [{ path, text: readFileSync(path, "utf8") }] : [];
  });
}

/**
 * Reads `--stale-hours` only when the flag is present, and throws on a malformed value or an
 * argument it does not know: a typo must be as red as a real failure, never a silent default.
 */
export function parseArgs(argv) {
  const options = { asJson: false, next: false, plan: false, staleHours: 24, flow: false };
  let staleHoursGiven = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") options.asJson = true;
    else if (argv[i] === "--next") options.next = true;
    else if (argv[i] === "--plan") options.plan = true;
    else if (argv[i] === "--flow") options.flow = true;
    else if (argv[i] === "--stale-hours") {
      const value = argv[++i];
      if (!/^\d+$/.test(value ?? "") || Number(value) === 0)
        throw new Error(`--stale-hours needs a positive whole number of hours, got ${value ?? "nothing"}`);
      options.staleHours = Number(value);
      staleHoursGiven = true;
    } else
      throw new Error(
        `unknown argument ${argv[i]} - usage: [--json | --next | --plan] [--stale-hours N] | --flow [--json]`,
      );
  }
  // `--flow` measures spans, not staleness, so it has no use for the threshold. Accepting it
  // silently would let a typed-in combination look like it had been honoured.
  if (options.flow && staleHoursGiven)
    throw new Error("--stale-hours belongs to the issue report, not to --flow");
  if (options.next && (options.asJson || options.flow))
    throw new Error("--next is its own output - not with --json or --flow");
  if (options.plan && (options.asJson || options.next || options.flow))
    throw new Error("--plan is its own output - not with --json, --next or --flow");
  return options;
}

/**
 * Pull requests carrying `in-progress` that no live run accounts for.
 *
 * `SDLC.md` § The claim protocol: a pull request carrying `in-progress` is skipped by the merge
 * tooling. The matching obligation - release the label when finished, even on failure - is stated
 * and nothing checks it, so a run that dies mid-work leaves a lock nobody holds and every later
 * automation steps around it in silence. Measured on 2026-09-21: zero active runs, six labelled
 * pull requests, one of them a mergeable promotion PR nothing would ever pick up.
 *
 * `ci-monitoring` is deliberately not read here. `SDLC.md` is explicit that it blocks nobody - it
 * says only that a CI-result comment is still owed - and treating it as a lock is the specific
 * mistake that made agents skip fully processed pull requests.
 *
 * Needs the same `runsVisible` the launches do, and for the same reason: with no runs file every
 * claim would look dead, which is the more damaging direction of that bug rather than the safer
 * one - it would send a human to strip locks off work that is running.
 */
export function staleClaims(prs, runs, { runsVisible = true } = {}) {
  if (!runsVisible) return { runsVisible: false, open: [], closed: [] };

  const activePrs = new Set();
  const activeIssues = new Set();
  for (const run of runs) {
    if (!ACTIVE_RUN_STATES.has(run.status)) continue;
    if (run.prNumber) activePrs.add(Number(run.prNumber));
    if (run.issueNumber) activeIssues.add(Number(run.issueNumber));
  }

  const open = [];
  const closed = [];
  for (const pr of prs) {
    const labels = (pr.labels ?? []).map((label) => label.name ?? label);
    if (!labels.includes("in-progress")) continue;
    if (activePrs.has(pr.number)) continue;
    // A run can hold the issue before its pull request exists - `implement-ticket` labels the
    // branch's PR in a later step than the one that claims the ticket. Reusing this file's own
    // linkage keeps that run from being reported as a dead claim while it is still working.
    const claimed = new Set([
      ...closeKeywordTargets(pr.body),
      ...closeKeywordTargets(pr.title),
    ]);
    const branch = branchIssue(pr.headRefName);
    if (branch !== null) claimed.add(branch);
    if ([...claimed].some((issue) => activeIssues.has(issue))) continue;

    (pr.state === "OPEN" ? open : closed).push({ number: pr.number, labels });
  }
  const byNumber = (a, b) => a.number - b.number;
  return { runsVisible: true, open: open.sort(byNumber), closed: closed.sort(byNumber) };
}

/**
 * The five numbers, assembled from data the caller fetched. Pure, so the whole report has a test.
 *
 * `polls` is not among them and is not a zero: the cockpit counts a poll in memory and commits it
 * nowhere, so the report names the gap instead of implying the pollers are idle.
 */
export function flowReport({
  runs,
  automations,
  issues,
  prs,
  prLinks,
  prOpenedAt,
  runsVisible = true,
}) {
  const gate = gateRetries(runs);
  const trusted = readTrusted(automations);
  const notMeasured = [
    "poll counts per automation - the cockpit holds them in memory and commits them nowhere",
  ];
  // `.ai/cezar/runs.json` is gitignored, so it exists only in the checkout the cockpit writes to -
  // never in a worktree, a fresh clone or CI, which is where most runs read this. An absent file
  // means no run is *visible*, not that none ran, and the difference is the whole report: without
  // it every automation prints `0 ... last: never launched`, which the backlog skill tells a human
  // to read as "the cockpit has never fired it". That is a count aimed at something that exists.
  if (!runsVisible)
    notMeasured.push(
      "automation launches, gate retries and stale claims - no .ai/cezar/runs.json on this host, so no run is visible to count",
    );
  return {
    runsVisible,
    claims: staleClaims(prs, runs, { runsVisible }),
    launches: runsVisible ? automationLaunches(runs, automations) : [],
    intake: spanSummary(intakeSpans(issues, trusted)),
    firstPr: spanSummary(firstPrSpans(issues, prLinks, prOpenedAt, trusted)),
    gate: {
      ...gate,
      retryRate: runsVisible && gate.steps ? Number((gate.retried / gate.steps).toFixed(3)) : null,
    },
    notMeasured,
    sources: { runs: runs.length, automations: automations.length, issues: issues.length },
  };
}

/**
 * A span in the unit a reader can hold.
 *
 * The JSON keeps raw hours; only the text switches. Two seconds rounds to `0` in hours and reads
 * like a missing measurement, which is the one thing this report must never look like - the bridge
 * labelling an issue within the same second is its success case, not its absence.
 */
export const humanHours = (hours) => {
  if (hours === null || hours === undefined) return "not measured";
  if (hours < 1 / 60) return `${Math.round(hours * 3600)} s`;
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} d`;
};

/** `#98, #99, #100 and 97 more` - the most recent few; a full list buries the number above it. */
export const sample = (numbers, limit = 8) => {
  if (!numbers.length) return "";
  const shown = numbers.slice(-limit).map((n) => `#${n}`).join(", ");
  return numbers.length > limit ? `${shown} and ${numbers.length - limit} more` : shown;
};

function printFlow(report) {
  const unmeasured = '    not measured on this host - see "Not measured here"';

  console.log("\n## Automation launches");
  if (!report.runsVisible) console.log(unmeasured);
  for (const row of report.launches)
    console.log(
      `${String(row.launches).padStart(4)}  ${row.workflow}  (${row.names.join("; ")})` +
        `${row.lastAt ? `\n      last: ${row.lastAt}` : "\n      last: never launched"}`,
    );

  const span = (heading, summary, pendingLabel) => {
    console.log(`\n## ${heading}`);
    console.log(`    measured: ${summary.measured} issues`);
    console.log(`    median:   ${humanHours(summary.medianHours)}`);
    console.log(
      `    slowest:  ${summary.slowest ? `#${summary.slowest.number} at ${humanHours(summary.slowest.hours)}` : "not measured"}`,
    );
    const pending = sample(summary.pending);
    console.log(
      `    ${pendingLabel}: ${summary.pending.length}${pending ? ` (${pending})` : ""}`,
    );
  };

  span("Intake latency - issue opened to its first Agent Brief", report.intake, "no brief yet");
  span("Time to first PR - Agent Brief to the PR opening", report.firstPr, "no PR yet");

  console.log("\n## Gate retries");
  if (!report.runsVisible) {
    console.log(unmeasured);
  } else {
    console.log(`    gate steps: ${report.gate.steps} over ${report.gate.attempts} attempts`);
    console.log(
      `    retried:    ${report.gate.retried}${report.gate.retryRate === null ? " (rate not measured: no gate step has run)" : ` (${(report.gate.retryRate * 100).toFixed(1)}%)`}`,
    );
  }

  console.log("\n## Stale in-progress claims");
  if (!report.claims.runsVisible) {
    console.log(unmeasured);
  } else if (!report.claims.open.length && !report.claims.closed.length) {
    console.log("    none - every in-progress label has a live run behind it");
  } else {
    for (const claim of report.claims.open)
      console.log(`    BLOCKING  #${claim.number}  ${claim.labels.join(", ")}`);
    for (const claim of report.claims.closed)
      console.log(`    residue   #${claim.number}  ${claim.labels.join(", ")}`);
    console.log(
      `    ${report.claims.open.length} open, ${report.claims.closed.length} already closed` +
        " - only the open ones stop work (SDLC.md: the merge tooling skips them)",
    );
  }

  console.log("\n## Not measured here");
  for (const gap of report.notMeasured) console.log(`    - ${gap}`);
  console.log(
    `\nfrom ${report.runsVisible ? `${report.sources.runs} retained runs` : "no visible runs"}, ${report.sources.automations} automations, ${report.sources.issues} issues`,
  );
}

/**
 * Every issue with its author, body and comments - what `firstBriefAt` reads - newest first,
 * bounded like the issue report's `--limit 200`. Closed issues count: an issue that went all the
 * way through is exactly the one whose latency is measurable, and leaving them out would report
 * only the stalls.
 */
function fetchIssueBriefs(pages = 4) {
  const query = `query($owner:String!,$name:String!,$cursor:String){
    repository(owner:$owner,name:$name){
      issues(first:50, after:$cursor, orderBy:{field:CREATED_AT,direction:DESC}){
        pageInfo{ hasNextPage endCursor }
        nodes{
          number createdAt body author{ login }
          comments(first:100){ nodes{ createdAt body author{ login } } }
        }
      }
    }
  }`;
  const issues = [];
  let cursor = null;
  for (let page = 0; page < pages; page++) {
    const args = ["api", "graphql", "-F", "owner=:owner", "-F", "name=:repo", "-f", `query=${query}`];
    if (cursor) args.push("-F", `cursor=${cursor}`);
    const { nodes, pageInfo } = gh(args).data.repository.issues;
    for (const node of nodes)
      issues.push({
        number: node.number,
        createdAt: node.createdAt,
        body: node.body,
        author: node.author,
        comments: node.comments.nodes,
      });
    if (!pageInfo.hasNextPage) break;
    cursor = pageInfo.endCursor;
  }
  return issues;
}

function mainFlow(asJson) {
  const prs = gh([
    "pr", "list", "--state", "all", "--limit", "300",
    "--json", "number,title,body,headRefName,createdAt,state,labels",
  ]);
  const runsVisible = existsSync(RUNS);
  const report = flowReport({
    runs: runsVisible ? JSON.parse(readFileSync(RUNS, "utf8")) : [],
    automations: JSON.parse(readFileSync(AUTOMATIONS, "utf8")),
    issues: fetchIssueBriefs(),
    prs,
    prLinks: linkOpenPrs(prs),
    prOpenedAt: new Map(prs.map((pr) => [pr.number, pr.createdAt])),
    runsVisible,
  });
  if (asJson) console.log(JSON.stringify(report, null, 2));
  else printFlow(report);
}

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`backlog-status: ${error.message}`);
    process.exit(2);
  }
  const { asJson, next, plan, staleHours, flow } = options;
  if (flow) return mainFlow(asJson);

  const { labels } = JSON.parse(readFileSync(CONFIG, "utf8"));
  const trusted = trustedAuthors(JSON.parse(readFileSync(AUTOMATIONS, "utf8")));
  const prs = gh([
    "pr", "list", "--state", "open", "--limit", "200",
    "--json", `number,title,body,headRefName,author,labels,baseRefName,updatedAt${plan ? ",files" : ""}`,
  ]);
  const merged = gh([
    "pr", "list", "--state", "merged", "--limit", "30",
    "--json", "number,title,body,headRefName",
  ]).map((pr) => ({ ...pr, merged: true }));
  const openIssues = gh([
    "issue", "list", "--state", "open", "--limit", "200",
    "--json", "number,title,url,labels,updatedAt,body,comments,author",
  ]);

  const records = readRunRecords();
  const context = {
    trusted,
    sdlcLabels: { category: labels.category, priority: labels.priority, risk: labels.risk },
    openIssues: new Set(openIssues.map((issue) => issue.number)),
    runs: runsByIssue(records),
    prLinks: linkOpenPrs([...prs, ...merged]),
    staleHours,
    now: Date.now(),
  };
  const issues = sortIssues(openIssues.map((issue) => classify(issue, context)));

  if (next) {
    const picked = pickNext(issues, countWip(prs, trusted, context.now));
    if (picked !== null) console.log(picked);
    return;
  }

  if (plan) {
    const specFiles = readMarkdown(SPECS);
    const specs = specFiles
      .filter((file) => dirname(file.path) === SPECS && !/(?:README|AGENTS)\.md$/.test(file.path))
      .map((file) => ({ path: file.path, text: file.text }));
    const stages = planStages(
      readMarkdown(PLANS).map((file) => ({ name: basename(file.path), text: file.text })),
    );
    // Every issue in any state, in one call: a spec may be sliced and its parent closed, a stage may
    // be covered by an issue long done. Only needed when a spec or a plan can yield a candidate.
    const allIssues =
      specs.length || stages.length
        ? gh(["issue", "list", "--state", "all", "--limit", "3000", "--json", "number,title,body"])
        : [];
    console.log(
      JSON.stringify(
        buildPlan({
          issues,
          wip: countWip(prs, trusted, context.now),
          runs: context.runs,
          activeTasks: records.filter(isAlive).map((run) => String(run.task ?? "")),
          specs,
          stages,
          allIssues,
          specCorpus: specFiles.map((file) => file.text),
          openPrs: prs,
        }),
        null,
        2,
      ),
    );
    return;
  }

  if (asJson) {
    console.log(
      JSON.stringify(
        issues.map(({ number, title, url, labels, state, next, warning, prs }) => ({
          number, title, url, labels, state, next, warning, prs,
        })),
        null,
        2,
      ),
    );
    return;
  }

  let current = null;
  for (const issue of issues) {
    if (issue.state !== current) console.log(`\n## ${(current = issue.state)}`);
    const priority = PRIORITY_ORDER.find((label) => issue.labels.includes(label)) ?? "priority-medium";
    console.log(`#${issue.number} [${priority.replace("priority-", "")}] ${issue.title}`);
    console.log(`    labels: ${issue.labels.join(", ") || "(none)"}`);
    console.log(`    next:   ${issue.next}`);
    if (issue.warning) console.log(`    ⚠️      ${issue.warning}`);
  }

  const counts = issues.reduce(
    (acc, issue) => ({ ...acc, [issue.state]: (acc[issue.state] ?? 0) + 1 }),
    {},
  );
  console.log(
    `\n${issues.length} open issues - ${Object.entries(counts)
      .map(([state, count]) => `${state} ${count}`)
      .join(", ")}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2));
