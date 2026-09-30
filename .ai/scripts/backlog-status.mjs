#!/usr/bin/env node
// Vendored here since ADR 0021 retired design4pro/agent-kit. This is the only copy and it is
// edited in place; its cases are in .ai/scripts/__tests__/backlog-status.test.mjs.
//
// Reports where every open issue sits in the SDLC flow and the single next step that moves it.
// Read-only: it never applies a label, because the labels that start an agent run are human
// triggers (SDLC.md), and a report that could start work would be a different kind of tool.
//
// It keeps no knowledge of its own that another file already holds:
//   - the trigger labels, their required labels and their stand-down labels come from
//     docs/agents/cezar-automations.json, the same file the cockpit polls;
//   - "groomed" and "not ready" are read through the 🤖 comment marker every skill writes
//     (.ai/trackers/github.md), so a human comment newer than a not-ready marker is the answer;
//   - the run queue comes from .ai/cezar/runs.json when the host has one, which is what tells a
//     queued issue apart from one whose trigger label no run ever picked up.
//
// Why it parses pull-request linkage itself rather than asking the tracker: pull requests here
// target the base branch while the repository's default branch is another, and GitHub populates
// `closingIssuesReferences` / `closedByPullRequestsReferences` for neither side of that pairing.
// Measured on money-tracker.online: 15 of 15 recently merged pull requests carrying an explicit
// closing keyword report an empty list, including one whose body opens with `Closes #163`. Reading
// that field would mean the IN_REVIEW state could never once fire.
//
// `--flow` answers a different question: not where each issue sits, but whether the ladder is
// moving at all. Four numbers, each from a file or a command whose output is read - launches per
// automation, issue opened to `needs-triage`, `ready-for-agent` to the first pull request, and the
// share of gate steps that needed a second try - plus the `in-progress` claims no live run stands
// behind, which is the commonest way the ladder stops. Three of those read `.ai/cezar/runs.json`, which is
// gitignored and therefore absent in a worktree or a fresh clone; there the report says it cannot
// measure them rather than printing the zeroes. Poll counts are deliberately absent: they live
// only in the running cockpit's automation state, not in any committed file, and the report says
// so rather than printing a zero it did not measure.
//
// Usage: node .ai/scripts/backlog-status.mjs [--json] [--stale-hours N]
//        node .ai/scripts/backlog-status.mjs --flow [--json]

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const AUTOMATIONS = "docs/agents/cezar-automations.json";
const RUNS = ".ai/cezar/runs.json";
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
  "NOT_READY",
  "NEEDS_SPEC",
  "NEEDS_GROOM",
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
 * Open pull requests keyed by the issue each one addresses.
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
    else links.push({ number: pr.number, title: pr.title, viaKeyword });
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

/** The label → workflow map the cockpit polls, plus what requires and what voids each trigger. */
export function readTriggers(automations) {
  const triggers = new Map();
  for (const automation of automations) {
    if (automation.filters?.includePullRequests) continue;
    for (const label of automation.filters?.changedLabels ?? []) {
      triggers.set(label, {
        workflow: automation.task?.workflow ?? automation.name,
        requires: automation.filters?.allLabels ?? [],
        excludes: automation.filters?.excludeLabels ?? [],
      });
    }
  }
  return triggers;
}

// A 🤖-prefixed comment is a skill's; anything else is a human's (.ai/trackers/github.md).
const isAgentComment = (comment) => String(comment.body).trimStart().startsWith("🤖");

/** One issue's state and the single next step that moves it. Pure: every input is passed in. */
export function classify(issue, { triggers, runs, prLinks, staleHours, now }) {
  const labels = issue.labels.map((label) => label.name);
  const has = (label) => labels.includes(label);
  const comments = issue.comments ?? [];
  const run = runs.get(issue.number);
  const prs = prLinks.get(issue.number) ?? [];
  const trigger = labels.find((label) => triggers.has(label));

  const notReady = comments
    .filter((c) => isAgentComment(c) && c.body.includes("not ready"))
    .at(-1);
  const groomed = comments.some(
    (c) => isAgentComment(c) && c.body.includes("implementation notes"),
  );
  const answered =
    notReady &&
    comments.some(
      (c) =>
        c.createdAt > notReady.createdAt &&
        // A human's reply, or the readiness verifier resolving the gap in the human's place
        // (SDLC.md § Definition of Ready).
        (!isAgentComment(c) || c.body.includes("readiness verified")),
    );
  const hoursIdle = (now - Date.parse(issue.updatedAt)) / 36e5;

  const state = (name, next, warning) => ({
    ...issue,
    labels,
    state: name,
    next,
    warning: warning ?? null,
    trigger: trigger ?? null,
    prs,
  });

  if (has("blocked") || has("do-not-merge"))
    return state(
      "BLOCKED",
      "A human clears `blocked` / `do-not-merge` when the dependency lands.",
    );

  if (has("in-progress"))
    return hoursIdle > staleHours
      ? state(
          "STUCK",
          `Claimed but idle for ${Math.round(hoursIdle)}h - check the run, then \`gh issue edit ${issue.number} --remove-label in-progress\`.`,
        )
      : state("RUNNING", `A run holds the claim (${run?.workflow ?? "cockpit"}). Wait.`);

  if (trigger) {
    const rule = triggers.get(trigger);
    const standDown = rule.excludes.filter(has);
    const missing = rule.requires.filter((label) => !has(label));
    if (standDown.length)
      return state(
        "BLOCKED",
        `\`${trigger}\` cannot fire while \`${standDown.join("`, `")}\` is set.`,
      );
    if (missing.length)
      return state(
        "STUCK",
        `\`${trigger}\` needs \`${missing.join("`, `")}\` too: \`gh issue edit ${issue.number} --add-label ${missing.join(",")}\`.`,
      );
    if (run)
      return state("QUEUED", `Cezar has a ${run.status} \`${run.workflow}\` run for it. Wait.`);
    return state(
      "STUCK",
      `\`${trigger}\` is set but no run picked it up. Check the cockpit, or re-apply the label.`,
    );
  }

  if (prs.length) {
    const numbers = prs.map((pr) => `#${pr.number}`).join(", ");
    const branchOnly = prs.filter((pr) => !pr.viaKeyword);
    const warning = branchOnly.length
      ? `${branchOnly.map((pr) => `#${pr.number}`).join(", ")} names this issue in its branch but no closing keyword links it. Does it close the issue? If it does, the body needs \`Closes #${issue.number}\` or housekeeping will leave this open; if it is a partial fix, nothing to change.`
      : null;
    return state(
      "IN_REVIEW",
      `${numbers} open - drive it with \`/om-pr-autopilot ${prs[0].number}\`.`,
      warning,
    );
  }

  if (notReady && !answered)
    return state(
      "NOT_READY",
      `Answer the not-ready comment, then \`gh issue edit ${issue.number} --add-label groom\`.`,
    );

  if (has("feature") && !/\.ai\/specs\//.test(issue.body ?? ""))
    return state(
      "NEEDS_SPEC",
      `A feature with no covering spec: \`gh issue edit ${issue.number} --add-label spec\`.`,
    );

  if (!groomed)
    return state(
      "NEEDS_GROOM",
      `Never groomed: \`gh issue edit ${issue.number} --add-label groom\`.`,
    );

  return state(
    "READY",
    `Definition of Ready met: \`gh issue edit ${issue.number} --add-label autofix\`.`,
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

/** When each issue first got `label`, from its LABELED_EVENT timeline. */
export function firstLabelledAt(issue, label) {
  const stamps = (issue.timeline ?? [])
    .filter((event) => event.label === label && event.at)
    .map((event) => event.at)
    .sort();
  return stamps[0] ?? null;
}

/**
 * Issue opened -> `needs-triage`, one span per issue.
 *
 * An issue that a human sent straight to `ready-for-agent` or `ready-for-human` never carried
 * `needs-triage` and is not a stalled intake, so it is left out rather than counted as pending -
 * otherwise every issue a person decided by hand would read as a bridge failure.
 */
export function intakeSpans(issues) {
  return issues
    .filter(
      (issue) =>
        firstLabelledAt(issue, "needs-triage") !== null ||
        (firstLabelledAt(issue, "ready-for-agent") === null &&
          firstLabelledAt(issue, "ready-for-human") === null),
    )
    .map((issue) => ({
      number: issue.number,
      from: issue.createdAt,
      to: firstLabelledAt(issue, "needs-triage"),
    }));
}

/**
 * `ready-for-agent` -> the first pull request that claims the issue.
 *
 * Linkage comes from `linkOpenPrs`, which is this file's own parser rather than the tracker's
 * `closingIssuesReferences` - the header says why that field is unusable here. `prOpenedAt` maps a
 * pull-request number to when it was opened; keeping it beside the links rather than inside them
 * leaves `linkOpenPrs` and the `--json` shape it feeds untouched.
 */
export function firstPrSpans(issues, prLinks, prOpenedAt) {
  const spans = [];
  for (const issue of issues) {
    const readyAt = firstLabelledAt(issue, "ready-for-agent");
    if (!readyAt) continue;
    const opened = (prLinks.get(issue.number) ?? [])
      .map((pr) => prOpenedAt.get(pr.number))
      .filter(Boolean)
      .sort();
    spans.push({ number: issue.number, from: readyAt, to: opened[0] ?? null });
  }
  return spans;
}

const gh = (args) =>
  JSON.parse(
    execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }),
  );

/** Locally queued or running cockpit runs, keyed by issue number. Absent on a non-cockpit host. */
function readRuns() {
  if (!existsSync(RUNS)) return new Map();
  const byIssue = new Map();
  for (const run of JSON.parse(readFileSync(RUNS, "utf8"))) {
    if (!run.issueNumber || !ACTIVE_RUN_STATES.has(run.status)) continue;
    byIssue.set(Number(run.issueNumber), { status: run.status, workflow: run.workflow });
  }
  return byIssue;
}

/**
 * Reads `--stale-hours` only when the flag is present, and throws on a malformed value or an
 * argument it does not know: a typo must be as red as a real failure, never a silent default.
 */
export function parseArgs(argv) {
  const options = { asJson: false, staleHours: 24, flow: false };
  let staleHoursGiven = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") options.asJson = true;
    else if (argv[i] === "--flow") options.flow = true;
    else if (argv[i] === "--stale-hours") {
      const value = argv[++i];
      if (!/^\d+$/.test(value ?? "") || Number(value) === 0)
        throw new Error(`--stale-hours needs a positive whole number of hours, got ${value ?? "nothing"}`);
      options.staleHours = Number(value);
      staleHoursGiven = true;
    } else
      throw new Error(
        `unknown argument ${argv[i]} - usage: [--json] [--stale-hours N] | --flow [--json]`,
      );
  }
  // `--flow` measures spans, not staleness, so it has no use for the threshold. Accepting it
  // silently would let a typed-in combination look like it had been honoured.
  if (options.flow && staleHoursGiven)
    throw new Error("--stale-hours belongs to the issue report, not to --flow");
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
    intake: spanSummary(intakeSpans(issues)),
    firstPr: spanSummary(firstPrSpans(issues, prLinks, prOpenedAt)),
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

  span("Intake latency - issue opened to needs-triage", report.intake, "never labelled");
  span("Time to first PR - ready-for-agent to the PR opening", report.firstPr, "no PR yet");

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
 * Every issue with the LABELED_EVENT half of its timeline, newest first, bounded like the issue
 * report's `--limit 200`. Closed issues count: an issue that went all the way through is exactly
 * the one whose latency is measurable, and leaving them out would report only the stalls.
 */
function fetchIssueTimelines(pages = 4) {
  const query = `query($owner:String!,$name:String!,$cursor:String){
    repository(owner:$owner,name:$name){
      issues(first:50, after:$cursor, orderBy:{field:CREATED_AT,direction:DESC}){
        pageInfo{ hasNextPage endCursor }
        nodes{
          number createdAt
          timelineItems(first:100, itemTypes:[LABELED_EVENT]){
            nodes{ ... on LabeledEvent { createdAt label{ name } } }
          }
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
        timeline: node.timelineItems.nodes.map((event) => ({
          at: event.createdAt,
          label: event.label?.name,
        })),
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
    issues: fetchIssueTimelines(),
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
  const { asJson, staleHours, flow } = options;
  if (flow) return mainFlow(asJson);

  const context = {
    triggers: readTriggers(JSON.parse(readFileSync(AUTOMATIONS, "utf8"))),
    runs: readRuns(),
    prLinks: linkOpenPrs(
      gh([
        "pr", "list", "--state", "open", "--limit", "200",
        "--json", "number,title,body,headRefName",
      ]),
    ),
    staleHours,
    now: Date.now(),
  };

  const issues = sortIssues(
    gh([
      "issue", "list", "--state", "open", "--limit", "200",
      "--json", "number,title,url,labels,updatedAt,body,comments",
    ]).map((issue) => classify(issue, context)),
  );

  if (asJson) {
    console.log(
      JSON.stringify(
        issues.map(({ number, title, url, labels, state, next, warning, trigger, prs }) => ({
          number, title, url, labels, state, next, warning, trigger, prs,
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
