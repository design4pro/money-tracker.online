import {DurableObject} from "cloudflare:workers";
import {fctlRepo, identifier, integer, list, nativeRun, record, sha} from "./contracts";
import type {Env, Result} from "./contracts";
import {advanceDispatch} from "./dispatch";
import type {Dispatch} from "./dispatch";
import {ingress} from "./ingress";
import type {Ingress} from "./ingress";
import {deployment, gate, issueEvidence, linked} from "./policy";
import {Fctl, Github, ProviderError} from "./providers";
import {bearer} from "./signatures";

const WAIT = 60_000;
const DAY = 24 * 60 * 60_000;

type Phase = "triage" | "ready" | "plan" | "planned" | "implement" | "pr" | "release" | "closed" | "blocked";
type Ticket = {
  issue: number; actor: string; phase: Phase; created: number; due: number; failures: number;
  feature?: string; deployed?: string; triageRun?: string; triageSession?: string;
  triageComment?: number; planComment?: number; plan?: string; implement?: string;
  pr?: number; head?: string; merge?: string; mergedAt?: number; reason?: string;
};
type Finish = Extract<Ingress, {kind: "finish"}>;

export default {
  fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === "/health" && request.method === "GET") return Response.json({ok: true, sourceSha: env.SOURCE_SHA ?? null}, {headers: {"Cache-Control": "no-store"}});
    return env.FACTORY.get(env.FACTORY.idFromName("pilot")).fetch(request);
  },
} satisfies ExportedHandler<Env>;

export class Factory extends DurableObject<Env> {
  private readonly sql = this.ctx.storage.sql;
  private running = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS delivery (id TEXT PRIMARY KEY, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ticket (issue INTEGER PRIMARY KEY, phase TEXT NOT NULL, due INTEGER NOT NULL, feature TEXT UNIQUE, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS result (session TEXT PRIMARY KEY, at INTEGER NOT NULL, issue INTEGER, state TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS result_issue ON result(issue);
      CREATE TABLE IF NOT EXISTS dispatch (key TEXT PRIMARY KEY, state TEXT NOT NULL, due INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS slot (singleton INTEGER PRIMARY KEY CHECK(singleton=1), issue INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (at INTEGER NOT NULL, subject TEXT NOT NULL, action TEXT NOT NULL);
    `);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method === "GET" && new URL(request.url).pathname === "/ops/status") {
      if (!await bearer(request.headers, this.env.OPS_TOKEN)) return new Response(null, {status: 401});
      return Response.json({
        slot: this.sql.exec("SELECT issue FROM slot").toArray(),
        tickets: this.sql.exec<{state: string}>("SELECT state FROM ticket ORDER BY issue DESC LIMIT 30").toArray().map(row => JSON.parse(row.state)),
        audit: this.sql.exec("SELECT * FROM audit ORDER BY rowid DESC LIMIT 80").toArray(),
      });
    }
    const delivery = await ingress(request, this.env);
    if (delivery instanceof Response) return delivery;
    const {id, event} = delivery;
    const now = Date.now();
    // Arm before storing the event. A retry after a crash can arm it again.
    if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(now + 100);
    this.ctx.storage.transactionSync(() => {
      if (!this.sql.exec("INSERT OR IGNORE INTO delivery VALUES (?, ?) RETURNING id", id, now).toArray().length) return;
      if (event.kind === "issue") {
        const ticket: Ticket = {issue: event.issue, actor: event.actor, phase: "triage", due: now, created: now, failures: 0};
        this.sql.exec("INSERT OR IGNORE INTO ticket VALUES (?, ?, ?, NULL, ?)", ticket.issue, ticket.phase, now, JSON.stringify(ticket));
        this.audit(String(ticket.issue), "issue-observed");
      } else if (event.kind === "finish") {
        // Keep out-of-order results until exact schedule/run/session evidence exists.
        this.sql.exec(`INSERT INTO result VALUES (?, ?, ?, ?) ON CONFLICT(session) DO UPDATE SET
          at=excluded.at, issue=excluded.issue, state=excluded.state WHERE excluded.at > result.at AND (excluded.issue IS NOT NULL OR result.issue IS NULL)`,
        event.session, event.at, event.result?.issue ?? null, JSON.stringify(event));
      } else if (event.kind === "alert") {
        this.queue(`ops:${event.key}`, this.env.OPS_SCHEDULE_ID, "read", {repo: this.env.REPO, code: event.code, head: event.head});
        this.audit(`ops:${event.key}`, "alert-accepted");
      }
    });
    return new Response(null, {status: 202});
  }

  async alarm(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // A watchdog also covers eviction or interruption during an external request.
      await this.ctx.storage.setAlarm(Date.now() + 120_000);
      await this.pump();
    } finally {
      this.running = false;
    }
  }

  private audit(subject: string, action: string) {
    this.sql.exec("INSERT INTO audit VALUES (?, ?, ?)", Date.now(), subject, action);
  }

  private tickets(where: string, ...bindings: SqlStorageValue[]): Ticket[] {
    return this.sql.exec<{state: string}>(`SELECT state FROM ticket WHERE ${where}`, ...bindings).toArray().map(row => JSON.parse(row.state));
  }

  private ticket(ticket: Ticket, changes: Partial<Ticket>) {
    const next = {...ticket, failures: 0, due: Date.now() + WAIT, ...changes};
    this.sql.exec("UPDATE ticket SET phase=?, due=?, feature=?, state=? WHERE issue=?",
      next.phase, next.due, next.feature ?? null, JSON.stringify(next), next.issue);
    if (changes.phase && changes.phase !== ticket.phase) this.audit(String(ticket.issue), changes.reason ?? changes.phase);
  }

  private block(ticket: Ticket, reason: string, releaseSlot = false) {
    this.ctx.storage.transactionSync(() => {
      this.ticket(ticket, {phase: "blocked", reason});
      if (releaseSlot) this.sql.exec("DELETE FROM slot WHERE issue=?", ticket.issue);
    });
  }

  private dispatches(where: string, ...bindings: SqlStorageValue[]): Dispatch[] {
    return this.sql.exec<{payload: string}>(`SELECT payload FROM dispatch WHERE ${where}`, ...bindings).toArray().map(row => JSON.parse(row.payload));
  }

  private saveDispatch(dispatch: Dispatch) {
    this.sql.exec("INSERT INTO dispatch VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET state=excluded.state,due=excluded.due,payload=excluded.payload",
      dispatch.key, dispatch.state, dispatch.due, JSON.stringify(dispatch));
  }

  private queue(key: string, schedule: string, access: Dispatch["access"], context: Record<string, unknown>) {
    if (this.dispatches("key=?", key).length) return;
    this.saveDispatch({
      key, schedule, access, context: JSON.stringify({v: 1, invocation: crypto.randomUUID(), ...context}),
      state: "queued", attempts: 0, due: Date.now(),
    });
  }

  private async dispatch(fctl: Fctl, dispatch: Dispatch) {
    const result = await advanceDispatch(fctl, this.env, dispatch, next => this.saveDispatch(next));
    if (result.state !== dispatch.state) this.audit(result.key, result.reason ?? result.state);
    return result;
  }

  private finish(session: string, schedule: string): Finish | undefined {
    const row = this.sql.exec<{state: string}>("SELECT state FROM result WHERE session=?", session).toArray()[0];
    const finish = row ? JSON.parse(row.state) as Finish : undefined;
    return finish?.schedule === schedule ? finish : undefined;
  }

  private async pump() {
    const github = new Github(this.env);
    const fctl = new Fctl(this.env);
    const now = Date.now();
    const due = this.tickets("phase='triage' AND due<=? ORDER BY issue LIMIT 1", now);
    const slot = this.sql.exec<{issue: number}>("SELECT issue FROM slot").toArray()[0];
    const active = slot ? this.tickets("issue=? AND due<=? AND phase!='blocked'", slot.issue, now)[0] :
      this.tickets("phase='ready' AND due<=? ORDER BY issue LIMIT 1", now)[0];
    for (const ticket of [...due, ...(active ? [active] : [])]) {
      try {
        await this.advance(ticket, fctl, github);
      } catch {
        const current = this.tickets("issue=?", ticket.issue)[0];
        const failures = current.failures + 1;
        this.ticket(current, {failures, due: now + Math.min(900_000, 15_000 * 2 ** Math.min(failures, 6))});
        this.audit(String(ticket.issue), "provider-retry");
      }
    }

    const alert = this.dispatches("key LIKE 'ops:%' AND state IN ('queued','posting') AND due<=? ORDER BY due,key LIMIT 1", now)[0];
    if (alert) {
      try {
        await this.dispatch(fctl, alert);
      } catch {
        const current = this.dispatches("key=?", alert.key)[0];
        this.saveDispatch({...current, due: now + 300_000});
        this.audit(alert.key, "ops-provider-retry");
      }
    }

    const bootstrap = this.env.BOOTSTRAP_PRS?.split(",").map(value => Number(value.trim())).filter(integer).slice(0, 3) ?? [];
    if (!this.sql.exec("SELECT issue FROM slot").toArray().length) {
      for (const number of bootstrap) {
        try {
          await this.pr(github, fctl, number);
        } catch {
          this.audit(`pr:${number}`, "bootstrap-provider-retry");
        }
      }
    }

    this.sql.exec("DELETE FROM result WHERE at<? AND session NOT IN (SELECT json_extract(payload,'$.session') FROM dispatch WHERE json_extract(payload,'$.session') IS NOT NULL)", now - 30 * DAY);
    const pending = this.sql.exec(`SELECT
      EXISTS(SELECT 1 FROM ticket WHERE phase NOT IN ('closed','blocked','ready') OR
        (phase='ready' AND NOT EXISTS(SELECT 1 FROM slot))) OR
      EXISTS(SELECT 1 FROM dispatch WHERE key LIKE 'ops:%' AND state IN ('queued','posting')) AS pending`).one();
    if (pending.pending || bootstrap.length) await this.ctx.storage.setAlarm(Date.now() + WAIT);
    // Leave one watchdog pass when an ingress may have interleaved with the pump.
    else if (now - 120_000 < Number(this.sql.exec("SELECT MAX(at) AS newest FROM delivery").one().newest)) {
      await this.ctx.storage.setAlarm(Date.now() + WAIT);
    } else {
      await this.ctx.storage.deleteAlarm();
      // A fetch may have inserted after the last check while deleteAlarm awaited.
      if (Number(this.sql.exec("SELECT MAX(at) AS newest FROM delivery").one().newest) >= now) {
        await this.ctx.storage.setAlarm(Date.now() + WAIT);
      }
    }
  }

  private async checkComment(github: Github, issue: number, result: Result): Promise<boolean> {
    if (!result.comment) return false;
    const comment = record(await github.api(`/issues/comments/${result.comment}`));
    const author = record(comment.user);
    return comment.id === result.comment && author.type === "Bot" && String(author.id) === this.env.GITHUB_TRIAGE_BOT_ID &&
      comment.issue_url === `https://api.github.com/repos/${this.env.REPO}/issues/${issue}` &&
      typeof comment.body === "string" && comment.body.startsWith(`<!-- factory:${result.stage} v1 -->`);
  }

  private async triage(ticket: Ticket, fctl: Fctl, github: Github) {
    if (Date.now() - ticket.created > DAY) return this.block(ticket, "native-triage-timeout");
    const {env} = this;
    if (!identifier(env.TRIAGE_SCHEDULE_ID, "sch")) return this.block(ticket, "triage-schedule-identity");
    const issue = record(await github.api(`/issues/${ticket.issue}`));
    const evidence = issueEvidence(issue);
    if (!evidence || issue.number !== ticket.issue || String(record(issue.user).id) !== env.GITHUB_DISCOVERY_BOT_ID ||
        record(issue.user).login !== ticket.actor) return this.block(ticket, "issue-evidence");
    if (this.tickets("feature=? AND issue<>?", evidence.feature, ticket.issue).length) return this.block(ticket, "duplicate-feature");
    const runs = list((await fctl.runs(env.TRIAGE_SCHEDULE_ID)).runs).map(record);
    const run = runs.find(row => nativeRun(row, env.TRIAGE_SCHEDULE_ID, String(record(row.session).id), env.REPO, ticket.issue, ticket.actor));
    if (!run) return this.ticket(ticket, {});
    const sessionId = record(run.session).id;
    if (!identifier(sessionId, "ses")) return;
    const finish = this.finish(sessionId, env.TRIAGE_SCHEDULE_ID);
    if (!finish) return this.ticket(ticket, {});
    const result = finish.result;
    const session = await fctl.session(sessionId, env.TRIAGE_SCHEDULE_ID);
    if (session.id !== sessionId || session.github_access !== "triage" || session.agent_kind !== "codex") return this.block(ticket, "triage-session-identity");
    if (!result || finish.at < Number(session.created_at) || result.stage !== "triage" || result.issue !== ticket.issue || result.status !== "ready" ||
        !await this.checkComment(github, ticket.issue, result)) return this.block(ticket, "triage-result");
    if (!await deployment(github, env, evidence.deployed)) return this.block(ticket, "parity-deployment-evidence");
    this.ticket(ticket, {phase: "ready", ...evidence, triageRun: String(run.id), triageSession: sessionId,
      triageComment: result.comment, due: Date.now()});
  }

  private async advance(ticket: Ticket, fctl: Fctl, github: Github) {
    const env = this.env;
    const issue = ticket.issue;
    const context = {repo: env.REPO, issue, feature_id: ticket.feature, deployed_sha: ticket.deployed};
    switch (ticket.phase) {
      case "triage":
        return this.triage(ticket, fctl, github);
      case "ready":
        this.ctx.storage.transactionSync(() => {
          if (!this.sql.exec("INSERT OR IGNORE INTO slot VALUES (1, ?) RETURNING issue", issue).toArray().length) return;
          this.queue(`plan:${issue}`, env.PLAN_SCHEDULE_ID, "triage", {...context, triage_comment: ticket.triageComment});
          this.ticket(ticket, {phase: "plan", plan: `plan:${issue}`, due: Date.now()});
        });
        return;
      case "planned": {
        const current = record(await github.api(`/issues/${issue}`));
        const evidence = issueEvidence(current);
        if (!evidence || evidence.feature !== ticket.feature || evidence.deployed !== ticket.deployed ||
            String(record(current.user).id) !== env.GITHUB_DISCOVERY_BOT_ID) return this.block(ticket, "issue-evidence-changed", true);
        this.ctx.storage.transactionSync(() => {
          this.queue(`implement:${issue}`, env.IMPLEMENT_SCHEDULE_ID, "push", {...context, plan_comment: ticket.planComment});
          this.ticket(ticket, {phase: "implement", implement: `implement:${issue}`, due: Date.now()});
        });
        return;
      }
      case "plan":
      case "implement": {
        const stage = ticket.phase;
        const current = this.dispatches("key=?", ticket[stage] ?? "")[0];
        if (!current) return this.block(ticket, "missing-dispatch");
        const dispatch = await this.dispatch(fctl, current);
        if (dispatch.state === "blocked") return this.block(ticket, dispatch.reason ?? "dispatch-blocked", stage === "plan");
        if (dispatch.state !== "started" || !dispatch.session) return this.ticket(ticket, {});
        const finish = this.finish(dispatch.session, dispatch.schedule);
        if (!finish) return this.ticket(ticket, {});
        const session = await fctl.session(dispatch.session, dispatch.schedule);
        if (session.id !== dispatch.session || session.agent_kind !== "codex" || session.github_access !== dispatch.access) {
          return this.block(ticket, "dispatch-session-identity", stage === "plan");
        }
        const result = finish.result;
        if (finish.at < Number(session.created_at) || result?.stage !== stage || result.issue !== issue || result.status === "blocked") {
          return this.block(ticket, `${stage}-result`, stage === "plan");
        }
        if (stage === "plan") {
          if (!await this.checkComment(github, issue, result)) return this.block(ticket, "plan-comment", true);
          this.ticket(ticket, {phase: "planned", planComment: result.comment, due: Date.now()});
        } else {
          if (!result.pr) return this.block(ticket, "implementation-pr-missing");
          if (!list(session.pull_requests).map(record).some(pr => pr.number === result.pr && fctlRepo(pr.repo) === env.REPO)) {
            return this.ticket(ticket, {});
          }
          this.ticket(ticket, {phase: "pr", pr: result.pr, due: Date.now()});
        }
        return;
      }
      case "pr":
      case "release": {
        const dispatch = this.dispatches("key=?", ticket.implement ?? "")[0];
        if (!ticket.pr || !dispatch?.session) return this.block(ticket, "implementation-link-missing");
        await this.pr(github, fctl, ticket.pr, ticket, dispatch);
      }
    }
  }

  private async pr(github: Github, fctl: Fctl, number: number, ticket?: Ticket, dispatch?: Dispatch) {
    const pr = record(await github.api(`/pulls/${number}`));
    const currentHead = record(pr.head).sha;
    if (pr.number !== number || !sha(currentHead) || record(pr.base).ref !== "main") return;
    const session = dispatch?.session ? await fctl.session(dispatch.session, dispatch.schedule) : undefined;
    const relation = !ticket || (!!session?.id && session.branch === record(pr.head).ref &&
      linked(pr.body, ticket.issue, String(session.id)) &&
      list(session.pull_requests).map(record).some(p => p.number === number && fctlRepo(p.repo) === this.env.REPO));
    if (pr.merged === true) {
      if (!ticket) return;
      if (!relation || !sha(pr.merge_commit_sha) || String(record(record(pr.base).repo).id) !== this.env.REPO_ID) {
        return this.block(ticket, "merged-pr-provenance");
      }
      const mergedAt = Date.parse(String(pr.merged_at));
      if (!Number.isFinite(mergedAt)) return this.block(ticket, "merge-timestamp");
      if (ticket.phase !== "release") this.ticket(ticket, {phase: "release", merge: pr.merge_commit_sha, mergedAt, reason: "awaiting-production-smoke"});
      if (!await deployment(github, this.env, pr.merge_commit_sha)) return;
      const issue = record(await github.api(`/issues/${ticket.issue}`));
      if (issue.number !== ticket.issue || issue.pull_request || String(record(issue.user).id) !== this.env.GITHUB_DISCOVERY_BOT_ID) {
        return this.block(ticket, "release-issue-identity");
      }
      if (issue.state !== "closed") await github.api(`/issues/${ticket.issue}`, "PATCH", {state: "closed", state_reason: "completed"});
      this.ctx.storage.transactionSync(() => {
        this.ticket(ticket, {phase: "closed", merge: pr.merge_commit_sha as string, mergedAt});
        this.sql.exec("DELETE FROM slot WHERE issue=?", ticket.issue);
      });
      return;
    }

    if (pr.state !== "open") {
      if (ticket) this.block(ticket, "pr-closed-without-merge");
      return;
    }
    if (ticket) this.ticket(ticket, {head: currentHead});
    const matches = relation && await gate(github, fctl, this.env, pr, number, session) && await github.hasNoClosingIssues(number);
    const enabled = this.env.MERGE_ENABLED === "true";
    await github.setGate(currentHead, `factory-pr-${number}`, matches && enabled);
    if (!matches || !enabled) return;
    const latest = record(await github.api(`/pulls/${number}`));
    if (record(latest.head).sha !== currentHead || latest.state !== "open" || latest.draft !== false ||
        record(latest.base).ref !== "main" || latest.body !== pr.body || !await github.hasNoClosingIssues(number)) {
      await github.setGate(currentHead, `factory-pr-${number}`, false);
      return;
    }
    try {
      const merged = record(await github.api(`/pulls/${number}/merge`, "PUT", {sha: currentHead, merge_method: "squash"}));
      if (merged.merged !== true) this.audit(`pr:${number}`, "merge-declined");
    } catch (error) {
      if (error instanceof ProviderError && [405, 409, 422].includes(error.status)) {
        this.audit(`pr:${number}`, "merge-rejected-by-github");
        await github.setGate(currentHead, `factory-pr-${number}`, false);
        return;
      }
      throw error;
    }
  }
}
