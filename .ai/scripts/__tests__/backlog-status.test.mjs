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
 *
 * Since ADR 0029 the same judgement is also a pick: `--next` names the issue a scheduled run
 * implements with nobody watching, so the cases that keep an issue OUT of READY - an author no
 * automation trusts, a brief a stranger wrote, an open blocker, the WIP limit - matter most.
 *
 * Since ADR 0030 `--plan` is five picks at once, for the Reconciler: the cases that matter there are
 * the ones that would start a second run on work a run already holds, slice a spec twice, or lift a
 * hold a person set.
 */

import { describe, expect, it } from "vitest";

import {
  PLAN_WORKFLOWS,
  RETIRED_AGENT_LOGINS,
  WIP_LIMIT,
  addsSpec,
  blockedBy,
  branchIssue,
  buildPlan,
  classify,
  closeKeywordTargets,
  countWip,
  coversStage,
  automationLaunches,
  firstBriefAt,
  firstPrSpans,
  flowReport,
  gateRetries,
  humanHours,
  intakeSpans,
  isAlive,
  linkOpenPrs,
  parseArgs,
  pickNext,
  pickStage,
  planStages,
  readTrusted,
  runsByIssue,
  sample,
  spanSummary,
  specStatus,
  staleClaims,
  sortIssues,
  trustedAuthors,
  unslicedSpecs,
  waitsForPerson,
} from "../backlog-status.mjs";

const NOW = Date.parse("2026-09-13T12:00:00Z");
const OWNER = { login: "rafalwolak" };

const AUTOMATIONS = [
  { name: "Groom", events: ["issue.opened"], filters: { authors: ["rafalwolak"] } },
  { name: "Ungated", events: ["issue.labeled"], filters: {} },
  { name: "Autopilot", events: ["pull_request.opened"], filters: { authors: ["someone-else"] } },
];

const trusted = new Set(["rafalwolak"]);

const sdlcLabels = {
  category: ["bug", "feature"],
  priority: ["priority-low", "priority-medium", "priority-high"],
  risk: ["risk-low", "risk-high"],
};

const BRIEF = "## Agent Brief\n\n**Category:** bug";
const agent = (body, createdAt = "2026-09-01T00:00:00Z") => ({ body: `🤖 ${body}`, createdAt, author: OWNER });
const human = (body, createdAt = "2026-09-02T00:00:00Z", author = OWNER) => ({ body, createdAt, author });

const issue = (over = {}) => ({
  number: 42,
  title: "an issue",
  author: OWNER,
  labels: [{ name: "bug" }, { name: "priority-medium" }, { name: "risk-low" }],
  comments: [agent(`triage\n\n${BRIEF}`)],
  body: "",
  updatedAt: "2026-09-13T11:00:00Z",
  ...over,
});

const decide = (over = {}, context = {}) =>
  classify(issue(over), {
    trusted,
    sdlcLabels,
    openIssues: new Set(),
    runs: new Map(),
    prLinks: new Map(),
    staleHours: 24,
    now: NOW,
    ...context,
  });

describe("readTrusted", () => {
  it("trusts the authors gating an issue automation", () => {
    expect(readTrusted(AUTOMATIONS)).toEqual(new Set(["rafalwolak"]));
  });

  it("trusts nobody when no issue automation is gated", () => {
    expect(readTrusted([AUTOMATIONS[1]]).size).toBe(0);
  });
});

describe("trustedAuthors", () => {
  it("adds the retired agent account to the gated logins", () => {
    expect(RETIRED_AGENT_LOGINS).toEqual(["design4pro-agent"]);
    expect(trustedAuthors(AUTOMATIONS)).toEqual(new Set(["rafalwolak", "design4pro-agent"]));
  });

  it("still trusts nobody when no issue automation is gated", () => {
    expect(trustedAuthors([AUTOMATIONS[1]]).size).toBe(0);
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

  it("flags a merged pull request, so the issue it addresses is not taken again", () => {
    const links = linkOpenPrs([
      { number: 9, title: "t", body: "Closes #5", headRefName: "feat/issue-5-thing", merged: true },
    ]);
    expect(links.get(5)).toEqual([{ number: 9, title: "t", viaKeyword: true, merged: true }]);
  });

  it("links an issue the body closes but the branch does not name", () => {
    const links = linkOpenPrs([
      { number: 8, title: "t", body: "Closes #5\nCloses #6", headRefName: "feat/issue-5-thing" },
    ]);
    expect(links.get(6)).toEqual([{ number: 8, title: "t", viaKeyword: true }]);
  });
});

describe("blockedBy", () => {
  it("reads the issues under the ticket's Blocked by heading, up to the next heading", () => {
    expect(blockedBy("## Acceptance\n- see #3\n\n## Blocked by\n- #12\n- #13\n\n## Notes\n#99")).toEqual([12, 13]);
  });

  it("lists nothing for a ticket that can start immediately, or has no section", () => {
    expect(blockedBy("## Blocked by\n- None - can start immediately")).toEqual([]);
    expect(blockedBy("fixes a thing, see #4")).toEqual([]);
  });
});

describe("classify", () => {
  it("puts a hold ahead of everything, including a claim", () => {
    for (const hold of ["blocked", "do-not-merge", "do-not-close"]) {
      const seen = decide({ labels: [{ name: hold }, { name: "in-progress" }] });
      expect(seen.state).toBe("BLOCKED");
      expect(seen.next).toContain(hold);
    }
  });

  it("reads a fresh claim as running and a stale one as stuck", () => {
    expect(decide({ labels: [{ name: "in-progress" }] }).state).toBe("RUNNING");
    expect(
      decide({ labels: [{ name: "in-progress" }], updatedAt: "2026-09-10T11:00:00Z" }).state,
    ).toBe("STUCK");
  });

  it("tells a stuck claim's owner to clear it over REST, since gh issue edit aborts on this host", () => {
    const { next } = decide({ labels: [{ name: "in-progress" }], updatedAt: "2026-09-10T11:00:00Z" });
    expect(next).toContain("gh api -X DELETE");
    expect(next).not.toContain("gh issue edit");
  });

  it("is queued while a cockpit run holds it", () => {
    const runs = new Map([[42, { status: "queued", workflow: "implement-ticket" }]]);
    expect(decide({}, { runs }).state).toBe("QUEUED");
  });

  it("sends an issue with an open pull request to review, not to triage", () => {
    const prLinks = new Map([[42, [{ number: 269, title: "t", viaKeyword: true }]]]);
    const seen = decide({ comments: [] }, { prLinks });
    expect(seen.state).toBe("IN_REVIEW");
    expect(seen.warning).toBeNull();
  });

  it("keeps an issue whose PR merged into develop out of the ready pool until it is closed", () => {
    const prLinks = new Map([[42, [{ number: 270, title: "t", viaKeyword: true, merged: true }]]]);
    const seen = decide({}, { prLinks });
    expect(seen.state).toBe("IN_REVIEW");
    expect(seen.next).toContain("merged but the issue is still open");
    expect(seen.next).toContain("/om-close-fixed-issues");
  });

  it("drives the open PR when a merged one also names the issue", () => {
    const prLinks = new Map([
      [42, [{ number: 270, title: "t", viaKeyword: true, merged: true }, { number: 271, title: "t", viaKeyword: true }]],
    ]);
    expect(decide({}, { prLinks }).next).toBe("#271 open - drive it with `/om-pr-autopilot 271`.");
  });

  it("asks about a branch-only link instead of prescribing a closing keyword", () => {
    const prLinks = new Map([[42, [{ number: 268, title: "t", viaKeyword: false }]]]);
    const seen = decide({}, { prLinks });
    expect(seen.state).toBe("IN_REVIEW");
    expect(seen.warning).toContain("Does it close the issue?");
    expect(seen.warning).toContain("if it is a partial fix, nothing to change");
  });

  it("tracks a spec parent instead of asking to triage it", () => {
    expect(decide({ comments: [], body: "Spec: .ai/specs/2026-09-01-x.md\n\n- [ ] #43" }).state).toBe("TRACKING");
  });

  it("waits while an issue it is blocked by is open, and is ready once it closes", () => {
    const body = "## Blocked by\n- #7";
    expect(decide({ body }, { openIssues: new Set([7]) }).state).toBe("WAITING");
    expect(decide({ body }).state).toBe("READY");
  });

  it("holds a not-ready issue until a human answers it", () => {
    const unanswered = [agent(`triage\n\n${BRIEF}`), agent("not ready", "2026-09-03T00:00:00Z")];
    expect(decide({ comments: unanswered }).state).toBe("NOT_READY");
    expect(decide({ comments: [...unanswered, human("ready as is", "2026-09-04T00:00:00Z")] }).state).toBe("READY");
  });

  it("takes a newer readiness-verified verdict as the answer, and an older one as nothing", () => {
    const notReady = [agent(`triage\n\n${BRIEF}`), agent("not ready", "2026-09-03T00:00:00Z")];
    const verified = (at) => agent("`readiness-verifier` — readiness verified", at);
    expect(decide({ comments: [...notReady, verified("2026-09-04T00:00:00Z")] }).state).toBe("READY");
    expect(decide({ comments: [verified("2026-09-02T00:00:00Z"), ...notReady] }).state).toBe("NOT_READY");
  });

  it("does not pick an issue implement-ticket stopped on until someone answers", () => {
    const stop = agent("`implement-ticket` STOP: the brief names no test seam", "2026-09-05T00:00:00Z");
    expect(decide({ comments: [agent(`triage\n\n${BRIEF}`), stop] }).state).toBe("NOT_READY");
    expect(
      decide({ comments: [agent(`triage\n\n${BRIEF}`), stop, human("seam: the accounts repo", "2026-09-06T00:00:00Z")] }).state,
    ).toBe("READY");
  });

  it("does not mistake a skill's own comment after a not-ready marker for the answer", () => {
    const comments = [
      agent(`triage\n\n${BRIEF}`),
      agent("not ready", "2026-09-03T00:00:00Z"),
      agent("labels applied", "2026-09-04T00:00:00Z"),
    ];
    expect(decide({ comments }).state).toBe("NOT_READY");
  });

  it("reads an afk-triage Triage Notes comment as a skill's, not a trusted person's answer", () => {
    const stop = agent("`implement-ticket` STOP: the brief names no test seam", "2026-09-05T00:00:00Z");
    const notes = human("> *This was generated by AI during triage.*\n\n## Triage Notes", "2026-09-06T00:00:00Z");
    expect(decide({ comments: [agent(`triage\n\n${BRIEF}`), stop, notes] }).state).toBe("NOT_READY");
  });

  it("does not take an untrusted reply as the answer to a STOP", () => {
    const stop = agent("`implement-ticket` STOP: the brief names no test seam", "2026-09-05T00:00:00Z");
    const stranger = human("+1", "2026-09-06T00:00:00Z", { login: "someone-else" });
    expect(decide({ comments: [agent(`triage\n\n${BRIEF}`), stop, stranger] }).state).toBe("NOT_READY");
  });

  it("takes a newer Agent Brief as the answer, since afk-triage settles the gap into one", () => {
    const comments = [agent("not ready", "2026-09-03T00:00:00Z"), agent(`triage\n\n${BRIEF}`, "2026-09-04T00:00:00Z")];
    expect(decide({ comments }).state).toBe("READY");
  });

  it("takes a later trusted RESOLVED comment as the answer, even when it quotes the STOP it answers", () => {
    const stop = agent("`implement-ticket` STOP: the brief names no test seam", "2026-09-05T00:00:00Z");
    const resolved = agent(
      "RESOLVED: the specialist panel chose the accounts repo as the seam (answers `STOP: the brief names no test seam`)",
      "2026-09-06T00:00:00Z",
    );
    expect(decide({ comments: [agent(`triage\n\n${BRIEF}`), stop, resolved] }).state).toBe("READY");
    // the RESOLVED comment is the answer, never the question: alone it does not park the issue
    expect(decide({ comments: [agent(`triage\n\n${BRIEF}`), resolved] }).state).toBe("READY");
  });

  it("does not take an untrusted RESOLVED comment as the answer", () => {
    const stop = agent("`implement-ticket` STOP: the brief names no test seam", "2026-09-05T00:00:00Z");
    const forged = { ...agent("RESOLVED: fine", "2026-09-06T00:00:00Z"), author: { login: "someone-else" } };
    expect(decide({ comments: [agent(`triage\n\n${BRIEF}`), stop, forged] }).state).toBe("NOT_READY");
  });

  describe("canUnblock", () => {
    const AI_TRIAGE = "> _This was generated by AI during triage._\n\nBlocked: needs a decision on the chart library.";
    const blocked = (comments, labels = ["blocked"], over = {}) =>
      decide({ labels: labels.map((name) => ({ name })), comments, ...over });

    it("offers a hold an agent set: `blocked` alone, and the last comment is an agent's", () => {
      const seen = blocked([agent("`om-prepare-issue` - waiting on the chart library decision")]);
      expect(seen.state).toBe("BLOCKED");
      expect(seen.canUnblock).toBe(true);
      expect(seen.next).toContain("unblock");
    });

    it("reads an afk-triage comment, which opens with the AI quote, as an agent's", () => {
      expect(blocked([{ body: AI_TRIAGE, createdAt: "2026-09-02T00:00:00Z", author: OWNER }]).canUnblock).toBe(true);
    });

    it("leaves a hold a person took over: a human comment after the agent's is the last word", () => {
      const seen = blocked([agent("waiting on the decision"), human("keep it blocked until Friday", "2026-09-03T00:00:00Z")]);
      expect(seen.canUnblock).toBe(false);
      expect(seen.next).toContain("A person clears");
    });

    it("leaves a hold nobody explained, since there is nothing to lift", () => {
      expect(blocked([]).canUnblock).toBe(false);
    });

    it("leaves a comment that says HUMAN-ONLY to the person", () => {
      expect(blocked([agent("HUMAN-ONLY: the owner decides the budget")]).canUnblock).toBe(false);
    });

    it("never lifts do-not-merge or do-not-close, nor blocked beside another hold", () => {
      const note = [agent("waiting on the decision")];
      expect(blocked(note, ["do-not-merge"]).canUnblock).toBe(false);
      expect(blocked(note, ["do-not-close"]).canUnblock).toBe(false);
      expect(blocked(note, ["blocked", "do-not-merge"]).canUnblock).toBe(false);
    });

    it("never offers an issue an outsider opened or a Sentry ticket", () => {
      const note = [agent("waiting on the decision")];
      expect(blocked(note, ["blocked"], { author: { login: "someone-else" } }).canUnblock).toBe(false);
      expect(blocked(note, ["blocked"], { body: "<!-- sentry-issue: 123 -->" }).canUnblock).toBe(false);
    });

    it("offers an unanswered not-ready or STOP comment, and leaves a HUMAN-ONLY one", () => {
      const stop = agent("`implement-ticket` STOP: the brief names no test seam", "2026-09-05T00:00:00Z");
      expect(decide({ comments: [agent(`triage\n\n${BRIEF}`), stop] }).canUnblock).toBe(true);
      const handedBack = agent("HUMAN-ONLY: the seam is the owner's call", "2026-09-06T00:00:00Z");
      const seen = decide({ comments: [agent(`triage\n\n${BRIEF}`), stop, handedBack] });
      expect(seen.state).toBe("NOT_READY");
      expect(seen.canUnblock).toBe(false);
    });

    it("offers nothing on a state that is not a hold or a not-ready", () => {
      expect(decide().canUnblock).toBe(false);
    });
  });

  it("never makes an issue someone else opened ready, whatever it carries", () => {
    const stranger = { login: "github-actions" };
    const seen = decide({ author: stranger, body: BRIEF });
    expect(seen.state).toBe("EXTERNAL");
    expect(seen.next).toContain("github-actions");
  });

  it("never makes a Sentry ticket ready, even one the maintainer filed", () => {
    const seen = decide({ body: `<!-- sentry-issue: MONEY-TRACKER-4KQ -->\n\n${BRIEF}` });
    expect(seen.state).toBe("EXTERNAL");
    expect(seen.next).toContain("Sentry");
  });

  it("does not count a brief an untrusted commenter wrote", () => {
    const comments = [human(BRIEF, "2026-09-02T00:00:00Z", { login: "drive-by" })];
    expect(decide({ comments }).state).toBe("NEEDS_TRIAGE");
  });

  it("takes a brief from the body of a ticket the maintainer filed", () => {
    expect(decide({ comments: [], body: `> *This was generated by AI.*\n\n${BRIEF}` }).state).toBe("READY");
  });

  it("does not read a brief heading quoted as code", () => {
    expect(decide({ comments: [], body: "```\n## Agent Brief\n```" }).state).toBe("NEEDS_TRIAGE");
  });

  it("needs triage when the brief or an SDLC label group is missing, and names what", () => {
    expect(decide({ comments: [] }).next).toContain("No Agent Brief yet");
    const seen = decide({ labels: [{ name: "bug" }] });
    expect(seen.state).toBe("NEEDS_TRIAGE");
    expect(seen.next).toContain("No priority label, risk label yet");
  });

  it("calls a briefed, labelled, unclaimed, unblocked issue ready", () => {
    expect(decide().state).toBe("READY");
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

describe("waitsForPerson", () => {
  const pr = (...names) => ({ labels: names.map((name) => ({ name })) });

  it("waits for a person on QA nobody has signed, a high-risk or security diff, or a hold", () => {
    expect(waitsForPerson(pr("needs-qa"))).toBe(true);
    expect(waitsForPerson(pr("risk-high"))).toBe(true);
    expect(waitsForPerson(pr("security"))).toBe(true);
    expect(waitsForPerson(pr("blocked"))).toBe(true);
    expect(waitsForPerson(pr("do-not-merge"))).toBe(true);
  });

  it("does not wait once QA is approved, nor for a PR the pipeline merges by itself", () => {
    expect(waitsForPerson(pr("needs-qa", "qa-approved"))).toBe(false);
    expect(waitsForPerson(pr("review"))).toBe(false);
    expect(waitsForPerson(pr("risk-low", "merge-queue"))).toBe(false);
    expect(waitsForPerson(pr())).toBe(false);
  });

  it("still waits for a person when a high-risk PR also has QA approved", () => {
    expect(waitsForPerson(pr("risk-high", "needs-qa", "qa-approved"))).toBe(true);
  });
});

describe("countWip", () => {
  const pr = (labels, login = "rafalwolak", baseRefName = "develop") => ({
    author: { login },
    labels: labels.map((name) => ({ name })),
    baseRefName,
  });

  it("counts only the trusted PRs a person has to clear, not the ones the pipeline merges", () => {
    const prs = [
      pr(["review"]),
      pr([]),
      pr(["changes-requested", "risk-low"]),
      pr(["needs-qa"]),
      pr(["risk-high"]),
      pr(["security"]),
      pr(["blocked"]),
      pr(["needs-qa", "qa-approved"]),
      pr(["review"], "dependabot[bot]"),
      pr(["do-not-merge"], "rafalwolak", "main"),
    ];
    expect(countWip(prs, trusted)).toBe(4);
  });

  it("skips the promotion and another author's PR, and counts the retired agent's once it is trusted", () => {
    const prs = [
      pr(["risk-high", "do-not-merge"], "rafalwolak", "main"),
      pr(["risk-high"], "dependabot[bot]"),
      pr(["risk-high"], "design4pro-agent"),
    ];
    expect(countWip(prs, trusted)).toBe(0);
    expect(countWip(prs, trustedAuthors(AUTOMATIONS))).toBe(1);
  });

  it("still counts an agent PR a person put a do-not-merge hold on", () => {
    expect(countWip([pr(["review", "do-not-merge"])], trusted)).toBe(1);
  });
});

describe("pickNext", () => {
  const rows = sortIssues([
    { number: 5, state: "READY", labels: ["priority-low"] },
    { number: 9, state: "READY", labels: ["priority-high"] },
    { number: 1, state: "NEEDS_TRIAGE", labels: ["priority-extreme"] },
  ]);

  it("takes the highest-priority ready issue, then the oldest", () => {
    expect(pickNext(rows, 0)).toBe(9);
  });

  it("takes nothing at the WIP limit", () => {
    expect(pickNext(rows, WIP_LIMIT - 1)).toBe(9);
    expect(pickNext(rows, WIP_LIMIT)).toBeNull();
  });

  it("takes nothing when nothing is ready", () => {
    expect(pickNext(rows.filter((row) => row.state !== "READY"), 0)).toBeNull();
  });
});

describe("parseArgs", () => {
  it("defaults to text output and a 24-hour threshold", () => {
    expect(parseArgs([])).toEqual({ asJson: false, next: false, plan: false, staleHours: 24, flow: false });
  });

  it("reads --json and --stale-hours in either order", () => {
    expect(parseArgs(["--stale-hours", "6", "--json"])).toEqual({
      asJson: true,
      next: false,
      plan: false,
      staleHours: 6,
      flow: false,
    });
  });

  it("reads --next, and refuses it together with --json or --flow", () => {
    expect(parseArgs(["--next"]).next).toBe(true);
    expect(() => parseArgs(["--next", "--json"])).toThrow(/its own output/);
    expect(() => parseArgs(["--flow", "--next"])).toThrow(/its own output/);
  });

  it("reads --plan, and refuses it together with --json, --next or --flow", () => {
    expect(parseArgs(["--plan"]).plan).toBe(true);
    expect(() => parseArgs(["--plan", "--json"])).toThrow(/its own output/);
    expect(() => parseArgs(["--next", "--plan"])).toThrow(/its own output/);
    expect(() => parseArgs(["--plan", "--flow"])).toThrow(/its own output/);
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
      next: false,
      plan: false,
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

describe("isAlive and runsByIssue", () => {
  it.each(["queued", "running", "waiting"])("holds an issue while the run is %s", (status) => {
    expect(isAlive({ status })).toBe(true);
  });

  it("lets go of a finished, cancelled, reviewed or failed run, but not a failed one that resumes by itself", () => {
    // `review` is terminal in cezar's engine, so it keeps the meaning ACTIVE_RUN_STATES gives it.
    for (const status of ["done", "cancelled", "review", "failed"]) expect(isAlive({ status })).toBe(false);
    expect(isAlive({ status: "failed", autoResumeAt: "2026-10-02T12:00:00Z" })).toBe(true);
  });

  it("keys the live runs by the issue they work on and skips the rest", () => {
    const runs = runsByIssue([
      { status: "running", workflow: "implement-ticket", issueNumber: 7 },
      { status: "done", workflow: "implement-ticket", issueNumber: 8 },
      { status: "waiting", workflow: "triage", issueNumber: "9" },
      { status: "running", workflow: "spec-to-tickets" },
    ]);
    expect([...runs.keys()]).toEqual([7, 9]);
    expect(runs.get(9)).toEqual({ status: "waiting", workflow: "triage" });
  });
});

describe("specStatus", () => {
  const table = (status) => `# Title\n\n| | |\n| --- | --- |\n| **Status** | ${status} |\n| **Issue** | none |\n`;

  it("reads the Status row of the metadata table", () => {
    expect(specStatus(table("ready"))).toBe("ready");
    expect(specStatus(table("draft"))).toBe("draft");
  });

  it("is null for a document without one", () => {
    expect(specStatus("# Title\n\nno table")).toBeNull();
  });
});

describe("unslicedSpecs", () => {
  const spec = (name, status) => ({
    path: `.ai/specs/${name}.md`,
    text: `| **Status** | ${status} |\n`,
  });

  it("takes the ready specs nobody sliced, oldest first by file name", () => {
    const specs = [spec("2026-09-20-b", "ready"), spec("2026-09-10-a", "ready"), spec("2026-09-01-c", "draft")];
    expect(unslicedSpecs(specs, []).map((s) => s.path)).toEqual([
      ".ai/specs/2026-09-10-a.md",
      ".ai/specs/2026-09-20-b.md",
    ]);
  });

  it("skips a spec whose parent issue exists, open or closed, and has no age window", () => {
    const specs = [spec("2026-01-01-old", "ready"), spec("2026-09-20-new", "ready")];
    const issues = [{ number: 1, body: "Spec: .ai/specs/2026-01-01-old.md\n\nTracking." }];
    expect(unslicedSpecs(specs, issues).map((s) => s.path)).toEqual([".ai/specs/2026-09-20-new.md"]);
  });

  it("does not read a mention in the middle of a body as the parent", () => {
    const specs = [spec("2026-09-20-new", "ready")];
    const issues = [{ number: 2, body: "See Spec: .ai/specs/2026-09-20-new.md for context" }];
    expect(unslicedSpecs(specs, issues)).toHaveLength(1);
  });
});

describe("planStages", () => {
  const plan = (name, ...ids) => ({
    name,
    text: ids.map((id) => `## Stage ${id} \u2014 something\n\nbody\n`).join("\n"),
  });

  it("lists the stages in file-name order, then document order", () => {
    const stages = planStages([
      plan("02-places.md", "02-S1", "02-S2"),
      plan("01-trips.md", "01-S1", "01-S9a"),
    ]);
    expect(stages.map((stage) => stage.id)).toEqual(["01-S1", "01-S9a", "02-S1", "02-S2"]);
    expect(stages[0].file).toBe("docs/plans/01-trips.md");
  });

  it("reads only NN-name.md files, and skips a heading inside a code sample", () => {
    const stages = planStages([
      { name: "README.md", text: "## Stage 00-S1 \u2014 not a plan\n" },
      { name: "TEMPLATE.md", text: "## Stage 00-S2\n" },
      { name: "03-x.md", text: "```md\n## Stage 03-S9 \u2014 a sample\n```\n\n## Stage 03-S1 \u2014 real\n" },
    ]);
    expect(stages.map((stage) => stage.id)).toEqual(["03-S1"]);
  });

  it("marks an id two plan files both use as ambiguous", () => {
    const stages = planStages([plan("13-gallery.md", "13-S1", "13-S2"), plan("13-studio.md", "13-S1")]);
    expect(stages.map((stage) => [stage.id, stage.ambiguous])).toEqual([
      ["13-S1", true],
      ["13-S2", false],
      ["13-S1", true],
    ]);
  });
});

describe("coversStage", () => {
  const stage = { id: "02-S1", file: "docs/plans/02-places.md", ambiguous: false };

  it("covers a stage by its id, and a slice of it by the letter that follows", () => {
    expect(coversStage("Stage 02-S1 of the plan", stage)).toBe(true);
    expect(coversStage("`02-S1a` - the first slice", stage)).toBe(true);
  });

  it("does not take a longer number or a longer word for the id", () => {
    expect(coversStage("Stage 02-S10", stage)).toBe(false);
    expect(coversStage("a102-S1", stage)).toBe(false);
    expect(coversStage("nothing here", stage)).toBe(false);
  });

  it("needs the plan file as well for an ambiguous id", () => {
    const shared = { id: "13-S1", file: "docs/plans/13-gallery.md", ambiguous: true };
    expect(coversStage("Stage 13-S1", shared)).toBe(false);
    expect(coversStage("Stage 13-S1 of docs/plans/13-gallery.md", shared)).toBe(true);
    expect(coversStage("Stage 13-S1 of docs/plans/13-studio.md", shared)).toBe(false);
  });
});

describe("pickStage", () => {
  const stages = [
    { id: "01-S1", file: "docs/plans/01-a.md", ambiguous: false },
    { id: "01-S2", file: "docs/plans/01-a.md", ambiguous: false },
    { id: "02-S1", file: "docs/plans/02-b.md", ambiguous: false },
  ];

  it("takes the first stage nothing covers", () => {
    expect(pickStage({ stages, corpus: ["Stage 01-S1 spec"], activeTasks: [] })?.id).toBe("01-S2");
  });

  it("skips a stage a run is writing, whose task text names it", () => {
    const activeTasks = ["Write the spec for plan stage 01-S2 (docs/plans/01-a.md)."];
    expect(pickStage({ stages, corpus: ["01-S1"], activeTasks })?.id).toBe("02-S1");
  });

  it("is null once every stage is covered", () => {
    expect(pickStage({ stages, corpus: ["01-S1 01-S2 02-S1"], activeTasks: [] })).toBeNull();
  });

  it("is null for a repository without plans", () => {
    expect(pickStage({ stages: [], corpus: [], activeTasks: [] })).toBeNull();
  });
});

describe("addsSpec", () => {
  const pr = (...files) => ({ files });
  const file = (path, additions, deletions) => ({ path, additions, deletions });

  it("is true for a PR that adds a spec document", () => {
    expect(addsSpec(pr(file(".ai/specs/2026-10-02-x.md", 80, 0)))).toBe(true);
  });

  it("is false for a status flip or a move, which delete the line they replace", () => {
    expect(addsSpec(pr(file(".ai/specs/2026-10-02-x.md", 1, 1)))).toBe(false);
  });

  it("is false for the index, the agent rules and files outside .ai/specs", () => {
    expect(addsSpec(pr(file(".ai/specs/README.md", 3, 0), file(".ai/specs/AGENTS.md", 2, 0)))).toBe(false);
    expect(addsSpec(pr(file("docs/plans/01-x.md", 10, 0)))).toBe(false);
    expect(addsSpec({})).toBe(false);
  });
});

describe("buildPlan", () => {
  const row = (number, state, over = {}) => ({ number, state, labels: ["priority-medium"], canUnblock: false, ...over });
  const spec = (name) => ({ path: `.ai/specs/${name}.md`, text: "| **Status** | ready |\n" });
  const stage = { id: "04-S3", file: "docs/plans/04-budget.md", ambiguous: false };
  const base = {
    issues: [],
    wip: 0,
    runs: new Map(),
    activeTasks: [],
    specs: [],
    stages: [],
    allIssues: [],
    specCorpus: [],
    openPrs: [],
  };

  it("lists nothing, with the WIP state, when there is nothing to do", () => {
    expect(buildPlan(base)).toEqual({ wip: { waitingForPerson: 0, limit: WIP_LIMIT }, actions: [] });
  });

  it("names the five kinds in order, one action each, with the workflow and task text the Reconciler runs", () => {
    const plan = buildPlan({
      ...base,
      issues: sortIssues([
        row(7, "READY"),
        row(45, "BLOCKED", { canUnblock: true }),
        row(67, "NEEDS_TRIAGE"),
        row(68, "NEEDS_TRIAGE"),
      ]),
      specs: [],
      stages: [stage],
    });
    expect(plan.actions).toEqual([
      { kind: "implement", target: "#7", workflow: "implement-ticket", task: "Implement issue #7." },
      { kind: "unblock", target: "#45", workflow: "unblock", task: "Resolve the hold on issue #45." },
      { kind: "triage", target: "#67", workflow: "triage", task: "Triage issue #67." },
      {
        kind: "write-spec",
        target: "04-S3",
        workflow: "plan-to-spec",
        task: "Write the spec for plan stage 04-S3 (docs/plans/04-budget.md).",
      },
    ]);
    expect(Object.values(PLAN_WORKFLOWS)).toEqual([
      "implement-ticket",
      "unblock",
      "triage",
      "spec-to-tickets",
      "plan-to-spec",
    ]);
  });

  it("implements nothing at the WIP limit, but still triages and unblocks", () => {
    const plan = buildPlan({
      ...base,
      wip: WIP_LIMIT,
      issues: sortIssues([row(7, "READY"), row(67, "NEEDS_TRIAGE")]),
    });
    expect(plan.wip).toEqual({ waitingForPerson: WIP_LIMIT, limit: WIP_LIMIT });
    expect(plan.actions.map((a) => a.kind)).toEqual(["triage"]);
  });

  it("never starts a second run on an issue a run already holds", () => {
    const runs = new Map([[45, { status: "waiting", workflow: "unblock" }], [67, { status: "running", workflow: "triage" }]]);
    const plan = buildPlan({
      ...base,
      runs,
      issues: sortIssues([row(45, "BLOCKED", { canUnblock: true }), row(67, "NEEDS_TRIAGE"), row(68, "NEEDS_TRIAGE")]),
    });
    expect(plan.actions).toEqual([
      { kind: "triage", target: "#68", workflow: "triage", task: "Triage issue #68." },
    ]);
  });

  it("slices the oldest unsliced ready spec, and writes no spec while one waits", () => {
    const plan = buildPlan({
      ...base,
      specs: [spec("2026-09-20-b"), spec("2026-09-10-a")],
      stages: [stage],
    });
    expect(plan.actions).toEqual([
      {
        kind: "slice",
        target: ".ai/specs/2026-09-10-a.md",
        workflow: "spec-to-tickets",
        task: "Slice the spec .ai/specs/2026-09-10-a.md into tickets.",
      },
    ]);
  });

  it("skips a spec a run is slicing and offers the next one, without writing a spec meanwhile", () => {
    const plan = buildPlan({
      ...base,
      activeTasks: ["Slice the spec .ai/specs/2026-09-10-a.md into tickets."],
      specs: [spec("2026-09-20-b"), spec("2026-09-10-a")],
      stages: [stage],
    });
    expect(plan.actions.map((a) => a.target)).toEqual([".ai/specs/2026-09-20-b.md"]);
  });

  it("writes the next spec while a run slices the only unsliced one, which is no longer a candidate", () => {
    const plan = buildPlan({
      ...base,
      activeTasks: ["Slice the spec .ai/specs/2026-09-10-a.md into tickets."],
      specs: [spec("2026-09-10-a")],
      stages: [stage],
    });
    expect(plan.actions.map((a) => a.kind)).toEqual(["write-spec"]);
  });

  it("writes no spec while an open PR adds one, and none while a run writes that stage", () => {
    const adding = { files: [{ path: ".ai/specs/2026-10-02-x.md", additions: 90, deletions: 0 }] };
    expect(buildPlan({ ...base, stages: [stage], openPrs: [adding] }).actions).toEqual([]);
    const writing = ["Write the spec for plan stage 04-S3 (docs/plans/04-budget.md)."];
    expect(buildPlan({ ...base, stages: [stage], activeTasks: writing }).actions).toEqual([]);
  });

  it("counts a spec or an issue that mentions the stage as covering it", () => {
    expect(buildPlan({ ...base, stages: [stage], specCorpus: ["covers 04-S3"] }).actions).toEqual([]);
    const issue = { number: 3, title: "04-S3 budget split", body: "" };
    expect(buildPlan({ ...base, stages: [stage], allIssues: [issue] }).actions).toEqual([]);
  });
});

const AUTOMATION_DEFS = [
  {
    name: "Groom and triage new issues",
    events: ["issue.opened"],
    filters: { authors: ["rafalwolak"] },
    task: { workflow: "issue-groom" },
  },
  {
    name: "Re-triage when a hold is cleared",
    events: ["issue.unlabeled"],
    filters: { authors: ["rafalwolak"] },
    task: { workflow: "issue-groom" },
  },
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
      names: ["Groom and triage new issues", "Re-triage when a hold is cleared"],
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

const STRANGER = { login: "drive-by" };
const briefed = (number, createdAt, { author = OWNER, body = "", comments = [] } = {}) => ({
  number,
  createdAt,
  author,
  body,
  comments: comments.map(([at, text, by = OWNER]) => ({ createdAt: at, body: text, author: by })),
});

describe("firstBriefAt", () => {
  it("takes the earliest trusted comment carrying a brief", () => {
    const issue = briefed(1, "2026-09-13T00:00:00Z", {
      comments: [
        ["2026-09-13T05:00:00Z", `🤖 triage\n\n${BRIEF}`],
        ["2026-09-13T01:00:00Z", `🤖 triage\n\n${BRIEF}`],
      ],
    });
    expect(firstBriefAt(issue, trusted)).toBe("2026-09-13T01:00:00Z");
  });

  it("takes the opening of a ticket the maintainer filed with its brief in the body", () => {
    expect(firstBriefAt(briefed(1, "2026-09-13T00:00:00Z", { body: BRIEF }), trusted)).toBe(
      "2026-09-13T00:00:00Z",
    );
  });

  it("answers null when only a stranger wrote a brief, or nobody did", () => {
    const stranger = briefed(1, "2026-09-13T00:00:00Z", {
      body: BRIEF,
      author: STRANGER,
      comments: [["2026-09-13T01:00:00Z", BRIEF, STRANGER]],
    });
    expect(firstBriefAt(stranger, trusted)).toBeNull();
    expect(firstBriefAt(briefed(2, "2026-09-13T00:00:00Z"), trusted)).toBeNull();
  });
});

describe("intakeSpans", () => {
  it("measures from the issue opening to its first Agent Brief", () => {
    expect(
      intakeSpans(
        [briefed(1, "2026-09-13T00:00:00Z", { comments: [["2026-09-13T00:20:00Z", `🤖 triage\n\n${BRIEF}`]] })],
        trusted,
      ),
    ).toEqual([{ number: 1, from: "2026-09-13T00:00:00Z", to: "2026-09-13T00:20:00Z" }]);
  });

  it("leaves out a ticket filed with its brief, and an issue no automation will groom", () => {
    expect(
      intakeSpans(
        [
          briefed(1, "2026-09-13T00:00:00Z", { body: BRIEF }),
          briefed(2, "2026-09-13T00:00:00Z", { author: STRANGER }),
        ],
        trusted,
      ),
    ).toEqual([]);
  });

  it("keeps an unbriefed maintainer issue as pending: that is the groom run not firing", () => {
    expect(intakeSpans([briefed(3, "2026-09-13T00:00:00Z")], trusted)).toEqual([
      { number: 3, from: "2026-09-13T00:00:00Z", to: null },
    ]);
  });
});

describe("firstPrSpans", () => {
  const issues = [
    briefed(339, "2026-09-19T00:00:00Z", { comments: [["2026-09-19T00:43:34Z", `🤖 triage\n\n${BRIEF}`]] }),
    briefed(400, "2026-09-19T00:00:00Z", { body: BRIEF }),
    briefed(500, "2026-09-19T00:00:00Z"),
  ];

  it("measures to the earliest linked pull request, whatever branch it was cut on", () => {
    const prs = [
      { number: 340, title: "fix(shell): remount (#339)", body: "Closes #339", headRefName: "cez/781957ae", createdAt: "2026-09-19T01:15:30Z" },
      { number: 341, title: "later", body: "Closes #339", headRefName: "cez/other", createdAt: "2026-09-19T09:00:00Z" },
    ];
    const spans = firstPrSpans(issues, linkOpenPrs(prs), new Map(prs.map((pr) => [pr.number, pr.createdAt])), trusted);
    expect(spans.find((span) => span.number === 339)).toEqual({
      number: 339,
      from: "2026-09-19T00:43:34Z",
      to: "2026-09-19T01:15:30Z",
    });
  });

  it("skips an issue that never got an Agent Brief", () => {
    expect(firstPrSpans(issues, new Map(), new Map(), trusted).map((span) => span.number)).toEqual([339, 400]);
  });

  it("leaves a briefed issue with no pull request open-ended", () => {
    expect(firstPrSpans(issues, new Map(), new Map(), trusted).every((span) => span.to === null)).toBe(true);
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

  // The docblock example is a spec in a file whose comments are this load-bearing, and it used to
  // show the first few while the code takes the last few.
  it("matches its own docblock example", () => {
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(sample(hundred, 3)).toBe("#98, #99, #100 and 97 more");
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
      prs: [],
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
      prs: [],
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
      prs: [],
      prLinks: new Map(),
      prOpenedAt: new Map(),
    });
    expect(report.gate.retryRate).toBe(0.5);
  });
});

describe("flowReport without a visible runs.json", () => {
  // `.ai/cezar/runs.json` is gitignored, so every cezar run - which works in a worktree - reads
  // this report with the file absent. Treating that as an empty file printed `0 ... last: never
  // launched` for every automation, which `.claude/skills/backlog/SKILL.md` tells a human to read
  // as "the cockpit has never fired it": a count aimed at something that exists.
  const report = () =>
    flowReport({
      runs: [],
      automations: AUTOMATION_DEFS,
      issues: [],
      prs: [],
      prLinks: new Map(),
      prOpenedAt: new Map(),
      runsVisible: false,
    });

  it("reports no launches at all rather than a zero for every automation", () => {
    expect(report().launches).toEqual([]);
    expect(report().runsVisible).toBe(false);
  });

  it("names launches and gate retries as unmeasured, by reason", () => {
    const gaps = report().notMeasured.join(" ");
    expect(gaps).toMatch(/automation launches/);
    expect(gaps).toMatch(/gate retries/);
    expect(gaps).toMatch(/runs\.json/);
  });

  it("withholds the gate retry rate instead of reporting a clean 0%", () => {
    expect(report().gate.retryRate).toBeNull();
  });

  it("still measures the two numbers that come from the tracker, not from runs", () => {
    const measured = flowReport({
      runs: [],
      automations: AUTOMATION_DEFS,
      issues: [
        briefed(1, "2026-09-13T00:00:00Z", { comments: [["2026-09-13T00:00:02Z", `🤖 triage\n\n${BRIEF}`]] }),
      ],
      prs: [],
      prLinks: new Map(),
      prOpenedAt: new Map(),
      runsVisible: false,
    });
    expect(measured.intake.measured).toBe(1);
    expect(measured.intake.medianHours).toBeGreaterThan(0);
  });

  it("counts launches normally when the file is there", () => {
    const visible = flowReport({
      runs: [{ workflow: "issue-groom", automation: {}, startedAt: "2026-09-20T10:00:00Z" }],
      automations: AUTOMATION_DEFS,
      issues: [],
      prs: [],
      prLinks: new Map(),
      prOpenedAt: new Map(),
    });
    expect(visible.runsVisible).toBe(true);
    expect(visible.launches.find((row) => row.workflow === "issue-groom").launches).toBe(1);
    expect(visible.notMeasured.join(" ")).not.toMatch(/automation launches/);
  });
});

describe("staleClaims", () => {
  const pr = (number, state, labels, extra = {}) => ({
    number,
    state,
    labels: labels.map((name) => ({ name })),
    title: "",
    body: "",
    headRefName: "",
    ...extra,
  });

  it("reports an in-progress pull request no live run accounts for", () => {
    const claims = staleClaims([pr(381, "OPEN", ["merge-queue", "in-progress"])], []);
    expect(claims.open).toEqual([{ number: 381, labels: ["merge-queue", "in-progress"] }]);
    expect(claims.closed).toEqual([]);
  });

  it("separates a blocking open claim from residue on a closed one", () => {
    const claims = staleClaims(
      [pr(381, "OPEN", ["in-progress"]), pr(377, "MERGED", ["in-progress"])],
      [],
    );
    expect(claims.open.map((c) => c.number)).toEqual([381]);
    expect(claims.closed.map((c) => c.number)).toEqual([377]);
  });

  it("leaves a claim alone while a run holds that pull request", () => {
    const runs = [{ status: "running", prNumber: 381 }];
    expect(staleClaims([pr(381, "OPEN", ["in-progress"])], runs).open).toEqual([]);
  });

  it("leaves a claim alone while a run still holds the issue the PR closes", () => {
    const runs = [{ status: "queued", issueNumber: 339 }];
    const open = staleClaims(
      [pr(340, "OPEN", ["in-progress"], { body: "Closes #339", headRefName: "cez/781957ae" })],
      runs,
    ).open;
    expect(open).toEqual([]);
  });

  it("leaves a claim alone while a run holds the issue the branch names", () => {
    const runs = [{ status: "running", issueNumber: 392 }];
    const open = staleClaims(
      [pr(400, "OPEN", ["in-progress"], { headRefName: "fix/issue-392-slug" })],
      runs,
    ).open;
    expect(open).toEqual([]);
  });

  it("counts a finished run as no claim at all", () => {
    const runs = [{ status: "done", prNumber: 381 }, { status: "failed", prNumber: 381 }];
    expect(staleClaims([pr(381, "OPEN", ["in-progress"])], runs).open).toHaveLength(1);
  });

  // cezar parks a run on `CEZ:ASK` as `waiting`, and that run still holds its claim. Calling it
  // dead is the dangerous direction: the backlog skill tells a reader to remove such a label, and
  // removing a live one lets the next poll start duplicate work on the same pull request.
  it("treats a run waiting on a human as live, not as a dead lock", () => {
    const runs = [{ status: "waiting", prNumber: 500 }];
    expect(staleClaims([pr(500, "OPEN", ["in-progress"])], runs).open).toEqual([]);
  });

  // `review` is terminal in cezar (TERMINAL_STATUSES, dispatch/engine.ts:37), beside done, failed
  // and cancelled. Counting it as active would shield a claim that really is stale.
  it("treats a run in review as finished: the claim behind it is stale", () => {
    const runs = [{ status: "review", prNumber: 500 }];
    expect(staleClaims([pr(500, "OPEN", ["in-progress"])], runs).open).toHaveLength(1);
  });

  it("never treats ci-monitoring as a claim: it blocks nobody (SDLC.md)", () => {
    const claims = staleClaims([pr(381, "OPEN", ["merge-queue", "ci-monitoring"])], []);
    expect(claims.open).toEqual([]);
    expect(claims.closed).toEqual([]);
  });

  it("says it cannot tell with no visible runs, rather than calling every claim dead", () => {
    const claims = staleClaims([pr(381, "OPEN", ["in-progress"])], [], { runsVisible: false });
    expect(claims).toEqual({ runsVisible: false, open: [], closed: [] });
  });

  it("finds nothing when nothing carries the label", () => {
    expect(staleClaims([pr(1, "OPEN", ["review"])], [])).toEqual({
      runsVisible: true,
      open: [],
      closed: [],
    });
  });

  it("finds nothing at all on an empty repository", () => {
    expect(staleClaims([], [])).toEqual({ runsVisible: true, open: [], closed: [] });
  });

  it("goes into notMeasured with the launches when the runs file is absent", () => {
    const report = flowReport({
      runs: [],
      automations: AUTOMATION_DEFS,
      issues: [],
      prs: [pr(381, "OPEN", ["in-progress"])],
      prLinks: new Map(),
      prOpenedAt: new Map(),
      runsVisible: false,
    });
    expect(report.claims.runsVisible).toBe(false);
    expect(report.notMeasured.join(" ")).toMatch(/stale claims/);
  });

  it("carries the claims through flowReport when runs are visible", () => {
    const report = flowReport({
      runs: [],
      automations: AUTOMATION_DEFS,
      issues: [],
      prs: [pr(381, "OPEN", ["in-progress"])],
      prLinks: new Map(),
      prOpenedAt: new Map(),
    });
    expect(report.claims.open.map((c) => c.number)).toEqual([381]);
    expect(report.notMeasured.join(" ")).not.toMatch(/stale claims/);
  });
});
