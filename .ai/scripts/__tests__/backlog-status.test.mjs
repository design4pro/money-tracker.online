/**
 * Vendored here since ADR 0021 retired design4pro/agent-kit. This is the only copy and it is
 * edited in place, alongside the script it covers.
 *
 * The pure half of `backlog-status.mjs` is the whole judgement: everything around it is one `gh`
 * read and a print. What can go wrong here is never an exit code, it is advice - telling a
 * developer to groom an issue whose work is already on an open pull request, or to add a closing
 * keyword to a pull request that deliberately does not close its issue.
 *
 * Both of those shipped once and are pinned below: `linkOpenPrs` keeps *which* signal matched, and
 * a branch-only link is a question rather than an instruction.
 */

import { describe, expect, it } from "vitest";

import {
  branchIssue,
  classify,
  closeKeywordTargets,
  automationLaunches,
  firstLabelledAt,
  firstPrSpans,
  flowReport,
  gateRetries,
  humanHours,
  intakeSpans,
  linkOpenPrs,
  parseArgs,
  sample,
  spanSummary,
  readTriggers,
  sortIssues,
} from "../backlog-status.mjs";

const NOW = Date.parse("2026-09-13T12:00:00Z");

const AUTOMATIONS = [
  {
    name: "Fix issues on the autofix label",
    filters: { changedLabels: ["autofix"], excludeLabels: ["in-progress", "blocked"] },
    task: { workflow: "issue-autofix" },
  },
  {
    name: "Write a spec for feature issues",
    filters: { changedLabels: ["spec"], allLabels: ["feature"], excludeLabels: [] },
    task: { workflow: "spec" },
  },
  {
    name: "Resolve blocking review threads",
    filters: { includePullRequests: true, changedLabels: ["review-threads"] },
    task: { workflow: "pr-fix" },
  },
];

const triggers = new Map([
  ["autofix", { workflow: "issue-autofix", requires: [], excludes: ["in-progress", "blocked"] }],
  ["spec", { workflow: "spec", requires: ["feature"], excludes: [] }],
]);

const agent = (body, createdAt = "2026-09-01T00:00:00Z") => ({ body: `🤖 ${body}`, createdAt });
const human = (body, createdAt = "2026-09-02T00:00:00Z") => ({ body, createdAt });

const issue = (over = {}) => ({
  number: 42,
  title: "an issue",
  labels: [{ name: "bug" }],
  comments: [agent("implementation notes")],
  body: "",
  updatedAt: "2026-09-13T11:00:00Z",
  ...over,
});

const decide = (over = {}, context = {}) =>
  classify(issue(over), {
    triggers,
    runs: new Map(),
    prLinks: new Map(),
    staleHours: 24,
    now: NOW,
    ...context,
  });

describe("readTriggers", () => {
  it("maps every issue trigger to its workflow, its requirements and its stand-downs", () => {
    const read = readTriggers(AUTOMATIONS);
    expect(read.get("autofix")).toEqual({
      workflow: "issue-autofix",
      requires: [],
      excludes: ["in-progress", "blocked"],
    });
    expect(read.get("spec").requires).toEqual(["feature"]);
  });

  it("skips an automation that watches pull requests, which carry no issue state", () => {
    expect(readTriggers(AUTOMATIONS).has("review-threads")).toBe(false);
  });
});

describe("closeKeywordTargets", () => {
  it("reads every English closing keyword", () => {
    expect(closeKeywordTargets("Closes #163")).toEqual([163]);
    expect(closeKeywordTargets("fixes #12 and resolved #13")).toEqual([12, 13]);
  });

  it("ignores a bare mention, which is not a link", () => {
    expect(closeKeywordTargets("follow-up to #12")).toEqual([]);
    expect(closeKeywordTargets("refs #12")).toEqual([]);
  });

  it("refuses a keyword that is only the tail of a longer word", () => {
    expect(closeKeywordTargets("discloses #9")).toEqual([]);
  });

  it("does not read a keyword quoted as code", () => {
    expect(closeKeywordTargets("write `Closes #7` in the body")).toEqual([]);
    expect(closeKeywordTargets("```\nCloses #7\n```")).toEqual([]);
  });
});

describe("branchIssue", () => {
  it("reads the issue out of any type prefix, not a fixed list", () => {
    expect(branchIssue("fix/issue-189-e2e-wedge")).toBe(189);
    expect(branchIssue("refactor/issue-184-migrations")).toBe(184);
  });

  it("is null for a branch that claims no issue", () => {
    expect(branchIssue("develop")).toBeNull();
    expect(branchIssue("chore/backlog-status-command")).toBeNull();
    expect(branchIssue("")).toBeNull();
  });
});

describe("linkOpenPrs", () => {
  it("keeps which signal matched, so a branch-only link stays distinguishable", () => {
    const links = linkOpenPrs([
      { number: 269, title: "fix(i18n): date ranges (#163)", body: "Closes #163", headRefName: "fix/issue-163-dates" },
      { number: 268, title: "fix(e2e): name the wedge", body: "This PR does not stop the wedge.", headRefName: "fix/issue-189-e2e-wedge" },
    ]);
    expect(links.get(163)).toEqual([{ number: 269, title: expect.any(String), viaKeyword: true }]);
    expect(links.get(189)).toEqual([{ number: 268, title: expect.any(String), viaKeyword: false }]);
  });

  it("records a pull request once when both signals name the same issue", () => {
    const links = linkOpenPrs([
      { number: 7, title: "t", body: "Fixes #5", headRefName: "feat/issue-5-thing" },
    ]);
    expect(links.get(5)).toHaveLength(1);
    expect(links.get(5)[0].viaKeyword).toBe(true);
  });

  it("links an issue the body closes but the branch does not name", () => {
    const links = linkOpenPrs([
      { number: 8, title: "t", body: "Closes #5\nCloses #6", headRefName: "feat/issue-5-thing" },
    ]);
    expect(links.get(6)).toEqual([{ number: 8, title: "t", viaKeyword: true }]);
  });
});

describe("classify", () => {
  it("puts a hard block ahead of everything, including a claim", () => {
    const seen = decide({ labels: [{ name: "blocked" }, { name: "in-progress" }] });
    expect(seen.state).toBe("BLOCKED");
  });

  it("reads a fresh claim as running and a stale one as stuck", () => {
    expect(decide({ labels: [{ name: "in-progress" }] }).state).toBe("RUNNING");
    expect(
      decide({ labels: [{ name: "in-progress" }], updatedAt: "2026-09-10T11:00:00Z" }).state,
    ).toBe("STUCK");
  });

  it("is queued only when a run actually holds the trigger", () => {
    const runs = new Map([[42, { status: "queued", workflow: "issue-autofix" }]]);
    expect(decide({ labels: [{ name: "autofix" }] }, { runs }).state).toBe("QUEUED");
    expect(decide({ labels: [{ name: "autofix" }] }).state).toBe("STUCK");
  });

  it("reports a trigger its own stand-down label voids", () => {
    const seen = decide({ labels: [{ name: "autofix" }, { name: "blocked" }] });
    expect(seen.state).toBe("BLOCKED");
  });

  it("reports a trigger missing the label its automation requires", () => {
    const seen = decide({ labels: [{ name: "spec" }] });
    expect(seen.state).toBe("STUCK");
    expect(seen.next).toContain("--add-label feature");
  });

  it("sends an issue with an open pull request to review, not to grooming", () => {
    const prLinks = new Map([[42, [{ number: 269, title: "t", viaKeyword: true }]]]);
    const seen = decide({ comments: [] }, { prLinks });
    expect(seen.state).toBe("IN_REVIEW");
    expect(seen.warning).toBeNull();
  });

  it("asks about a branch-only link instead of prescribing a closing keyword", () => {
    const prLinks = new Map([[42, [{ number: 268, title: "t", viaKeyword: false }]]]);
    const seen = decide({}, { prLinks });
    expect(seen.state).toBe("IN_REVIEW");
    expect(seen.warning).toContain("Does it close the issue?");
    expect(seen.warning).toContain("if it is a partial fix, nothing to change");
  });

  it("holds a not-ready issue until a human answers it", () => {
    const unanswered = [agent("implementation notes"), agent("not ready", "2026-09-03T00:00:00Z")];
    expect(decide({ comments: unanswered }).state).toBe("NOT_READY");
    expect(decide({ comments: [...unanswered, human("ready as is", "2026-09-04T00:00:00Z")] }).state).toBe("READY");
  });

  it("does not mistake its own not-ready marker for the human's answer", () => {
    const comments = [
      agent("implementation notes"),
      agent("not ready", "2026-09-03T00:00:00Z"),
      agent("labels applied", "2026-09-04T00:00:00Z"),
    ];
    expect(decide({ comments }).state).toBe("NOT_READY");
  });

  it("routes a feature with no covering spec to the spec trigger", () => {
    expect(decide({ labels: [{ name: "feature" }], comments: [] }).state).toBe("NEEDS_SPEC");
    expect(
      decide({ labels: [{ name: "feature" }], body: "Spec: .ai/specs/2026-09-01-x.md" }).state,
    ).toBe("READY");
  });

  it("asks for grooming before work when nothing groomed it", () => {
    expect(decide({ comments: [] }).state).toBe("NEEDS_GROOM");
  });

  it("calls a groomed, unclaimed, unblocked issue ready", () => {
    const seen = decide();
    expect(seen.state).toBe("READY");
    expect(seen.next).toContain("--add-label autofix");
  });
});

describe("sortIssues", () => {
  it("orders by state, then priority, then number", () => {
    const rows = [
      { number: 2, state: "READY", labels: ["priority-low"] },
      { number: 1, state: "READY", labels: ["priority-high"] },
      { number: 3, state: "BLOCKED", labels: ["priority-low"] },
      { number: 4, state: "READY", labels: [] },
    ];
    expect(sortIssues(rows).map((row) => row.number)).toEqual([3, 1, 4, 2]);
  });
});

describe("parseArgs", () => {
  it("defaults to text output and a 24-hour threshold", () => {
    expect(parseArgs([])).toEqual({ asJson: false, staleHours: 24, flow: false });
  });

  it("reads --json and --stale-hours in either order", () => {
    expect(parseArgs(["--stale-hours", "6", "--json"])).toEqual({
      asJson: true,
      staleHours: 6,
      flow: false,
    });
  });

  it("rejects a stray positional instead of taking it as the threshold", () => {
    expect(() => parseArgs(["6"])).toThrow(/unknown argument 6/);
  });

  it.each([[[]], [["abc"]], [["0"]], [["-3"]], [["1.5"]], [["--json"]]])(
    "rejects a malformed --stale-hours value %j",
    (rest) => {
      expect(() => parseArgs(["--stale-hours", ...rest])).toThrow(/--stale-hours/);
    },
  );
});

describe("parseArgs --flow", () => {
  it("turns the flow report on", () => {
    expect(parseArgs(["--flow"]).flow).toBe(true);
  });

  it("carries --json into the flow report", () => {
    expect(parseArgs(["--flow", "--json"])).toEqual({
      asJson: true,
      staleHours: 24,
      flow: true,
    });
  });

  it("refuses --stale-hours with --flow rather than ignoring it", () => {
    expect(() => parseArgs(["--flow", "--stale-hours", "6"])).toThrow(/belongs to the issue report/);
  });

  it("leaves --stale-hours alone when --flow is absent", () => {
    expect(parseArgs(["--stale-hours", "6"]).staleHours).toBe(6);
  });
});

const AUTOMATION_DEFS = [
  { name: "Groom new issues", task: { workflow: "issue-groom" } },
  { name: "Re-groom on request", task: { workflow: "issue-groom" } },
  { name: "Weekly architecture review", task: { workflow: "architecture-review" } },
];

describe("automationLaunches", () => {
  it("reports a committed automation that has never launched as zero, first", () => {
    const rows = automationLaunches(
      [{ workflow: "issue-groom", automation: { automationId: "a" }, startedAt: "2026-09-20T10:00:00Z" }],
      AUTOMATION_DEFS,
    );
    expect(rows[0]).toEqual({
      workflow: "architecture-review",
      names: ["Weekly architecture review"],
      launches: 0,
      lastAt: null,
    });
  });

  it("counts two automations sharing one workflow on a single row, under both names", () => {
    const rows = automationLaunches(
      [
        { workflow: "issue-groom", automation: {}, startedAt: "2026-09-18T10:00:00Z" },
        { workflow: "issue-groom", automation: {}, startedAt: "2026-09-20T10:00:00Z" },
      ],
      AUTOMATION_DEFS,
    );
    const groom = rows.find((row) => row.workflow === "issue-groom");
    expect(groom).toEqual({
      workflow: "issue-groom",
      names: ["Groom new issues", "Re-groom on request"],
      launches: 2,
      lastAt: "2026-09-20T10:00:00Z",
    });
  });

  it("ignores a run nobody automated: a hand-started workflow is a person, not a poller", () => {
    const rows = automationLaunches(
      [{ workflow: "architecture-review", startedAt: "2026-09-20T10:00:00Z" }],
      AUTOMATION_DEFS,
    );
    expect(rows.find((row) => row.workflow === "architecture-review").launches).toBe(0);
  });

  it("reports every automation as zero when nothing has run at all", () => {
    expect(automationLaunches([], AUTOMATION_DEFS).map((row) => row.launches)).toEqual([0, 0]);
  });
});

describe("gateRetries", () => {
  it("counts a gate step that needed a second attempt", () => {
    expect(
      gateRetries([
        { steps: [{ id: "implement" }, { id: "gate", iterations: 1 }] },
        { steps: [{ id: "gate", iterations: 3 }] },
      ]),
    ).toEqual({ steps: 2, retried: 1, attempts: 4 });
  });

  it("treats a gate step with no iterations field as one attempt", () => {
    expect(gateRetries([{ steps: [{ id: "gate" }] }])).toEqual({
      steps: 1,
      retried: 0,
      attempts: 1,
    });
  });

  it("returns zeroes, not a division, when no gate step has run", () => {
    expect(gateRetries([{ steps: [] }, {}])).toEqual({ steps: 0, retried: 0, attempts: 0 });
  });
});

describe("spanSummary", () => {
  const at = (hours) => new Date(Date.parse("2026-09-13T00:00:00Z") + hours * 3_600_000).toISOString();

  it("takes the lower middle as the median of an even count, and names the slowest", () => {
    const summary = spanSummary([
      { number: 1, from: at(0), to: at(1) },
      { number: 2, from: at(0), to: at(2) },
      { number: 3, from: at(0), to: at(3) },
      { number: 4, from: at(0), to: at(10) },
    ]);
    expect(summary).toEqual({
      measured: 4,
      pending: [],
      medianHours: 2,
      slowest: { number: 4, hours: 10 },
    });
  });

  it("keeps sub-minute precision rather than rounding a working bridge to zero", () => {
    const summary = spanSummary([
      { number: 7, from: "2026-09-17T12:24:23Z", to: "2026-09-17T12:24:25Z" },
    ]);
    expect(summary.medianHours).toBeGreaterThan(0);
    expect(humanHours(summary.medianHours)).toBe("2 s");
  });

  it("reports a span that never ended as pending instead of dropping it", () => {
    expect(spanSummary([{ number: 9, from: at(0), to: null }])).toEqual({
      measured: 0,
      pending: [9],
      medianHours: null,
      slowest: null,
    });
  });

  it("counts a `to` older than its `from` as pending rather than averaging a negative", () => {
    expect(spanSummary([{ number: 9, from: at(5), to: at(1) }]).pending).toEqual([9]);
  });

  it("skips a span with no start at all: there is nothing to measure from", () => {
    expect(spanSummary([{ number: 9, from: null, to: at(1) }])).toEqual({
      measured: 0,
      pending: [],
      medianHours: null,
      slowest: null,
    });
  });

  it("measures nothing and claims nothing on an empty set", () => {
    expect(spanSummary([])).toEqual({
      measured: 0,
      pending: [],
      medianHours: null,
      slowest: null,
    });
  });
});

const labelled = (number, createdAt, events) => ({
  number,
  createdAt,
  timeline: events.map(([at, label]) => ({ at, label })),
});

describe("firstLabelledAt", () => {
  it("takes the earliest application when a label was removed and re-applied", () => {
    const issue = labelled(1, "2026-09-13T00:00:00Z", [
      ["2026-09-13T05:00:00Z", "needs-triage"],
      ["2026-09-13T01:00:00Z", "needs-triage"],
    ]);
    expect(firstLabelledAt(issue, "needs-triage")).toBe("2026-09-13T01:00:00Z");
  });

  it("answers null for a label the issue never carried", () => {
    expect(firstLabelledAt(labelled(1, "2026-09-13T00:00:00Z", []), "needs-triage")).toBeNull();
  });
});

describe("intakeSpans", () => {
  it("measures from the issue opening to the first needs-triage", () => {
    expect(
      intakeSpans([
        labelled(1, "2026-09-13T00:00:00Z", [["2026-09-13T00:00:02Z", "needs-triage"]]),
      ]),
    ).toEqual([{ number: 1, from: "2026-09-13T00:00:00Z", to: "2026-09-13T00:00:02Z" }]);
  });

  it("leaves out an issue a human routed straight past triage", () => {
    expect(
      intakeSpans([
        labelled(1, "2026-09-13T00:00:00Z", [["2026-09-13T01:00:00Z", "ready-for-agent"]]),
        labelled(2, "2026-09-13T00:00:00Z", [["2026-09-13T01:00:00Z", "ready-for-human"]]),
      ]),
    ).toEqual([]);
  });

  it("keeps an unlabelled issue as pending: that is the bridge not firing", () => {
    expect(intakeSpans([labelled(3, "2026-09-13T00:00:00Z", [["2026-09-13T01:00:00Z", "bug"]])])).toEqual(
      [{ number: 3, from: "2026-09-13T00:00:00Z", to: null }],
    );
  });
});

describe("firstPrSpans", () => {
  const issues = [
    labelled(339, "2026-09-19T00:00:00Z", [["2026-09-19T00:43:34Z", "ready-for-agent"]]),
    labelled(400, "2026-09-19T00:00:00Z", [["2026-09-19T00:00:00Z", "ready-for-agent"]]),
    labelled(500, "2026-09-19T00:00:00Z", [["2026-09-19T00:00:00Z", "needs-triage"]]),
  ];

  it("measures to the earliest linked pull request, whatever branch it was cut on", () => {
    const prs = [
      { number: 340, title: "fix(shell): remount (#339)", body: "Closes #339", headRefName: "cez/781957ae", createdAt: "2026-09-19T01:15:30Z" },
      { number: 341, title: "later", body: "Closes #339", headRefName: "cez/other", createdAt: "2026-09-19T09:00:00Z" },
    ];
    const spans = firstPrSpans(issues, linkOpenPrs(prs), new Map(prs.map((pr) => [pr.number, pr.createdAt])));
    expect(spans.find((span) => span.number === 339).to).toBe("2026-09-19T01:15:30Z");
  });

  it("skips an issue that never reached ready-for-agent", () => {
    expect(firstPrSpans(issues, new Map(), new Map()).map((span) => span.number)).toEqual([339, 400]);
  });

  it("leaves a ready issue with no pull request open-ended", () => {
    expect(firstPrSpans(issues, new Map(), new Map()).every((span) => span.to === null)).toBe(true);
  });
});

describe("humanHours", () => {
  it.each([
    [null, "not measured"],
    [2 / 3600, "2 s"],
    [0.5322, "32 min"],
    [5.25, "5.3 h"],
    [72, "3.0 d"],
  ])("renders %j as %s", (hours, text) => {
    expect(humanHours(hours)).toBe(text);
  });
});

describe("sample", () => {
  it("shows the most recent and says how many it left out", () => {
    expect(sample([1, 2, 3, 4], 2)).toBe("#3, #4 and 2 more");
  });

  it("shows everything when the list fits", () => {
    expect(sample([1, 2], 2)).toBe("#1, #2");
  });

  it("says nothing at all for an empty list", () => {
    expect(sample([])).toBe("");
  });
});

describe("flowReport", () => {
  it("reports a retry rate only once a gate step has run", () => {
    const empty = flowReport({
      runs: [],
      automations: AUTOMATION_DEFS,
      issues: [],
      prLinks: new Map(),
      prOpenedAt: new Map(),
    });
    expect(empty.gate).toEqual({ steps: 0, retried: 0, attempts: 0, retryRate: null });
    expect(empty.intake.medianHours).toBeNull();
    expect(empty.firstPr.medianHours).toBeNull();
    expect(empty.sources).toEqual({ runs: 0, automations: 3, issues: 0 });
  });

  it("names the poll count as unmeasured rather than printing a zero for it", () => {
    const report = flowReport({
      runs: [],
      automations: AUTOMATION_DEFS,
      issues: [],
      prLinks: new Map(),
      prOpenedAt: new Map(),
    });
    expect(report.notMeasured.join(" ")).toMatch(/poll counts/);
    expect(report).not.toHaveProperty("polls");
  });

  it("carries the gate retry rate through as a share of gate steps", () => {
    const report = flowReport({
      runs: [{ steps: [{ id: "gate", iterations: 2 }] }, { steps: [{ id: "gate", iterations: 1 }] }],
      automations: AUTOMATION_DEFS,
      issues: [],
      prLinks: new Map(),
      prOpenedAt: new Map(),
    });
    expect(report.gate.retryRate).toBe(0.5);
  });
});
