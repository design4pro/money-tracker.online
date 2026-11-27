import {DurableObject} from "cloudflare:workers";
import {fctlRepo, identifier, integer, list, nativeRun, record, sha, trustedHuman} from "./contracts";
import type {Env, Json} from "./contracts";
import {advanceDispatch} from "./dispatch";
import type {Dispatch} from "./dispatch";
import {ingress} from "./ingress";
import type {Ingress} from "./ingress";
import {featureSnapshot, maintainerIdentity} from "./intake";
import type {MaintainerIntake} from "./intake";
import {deployment, gate, issueEvidence, linked} from "./policy";
import type {DeploymentSearch} from "./policy";
import {Fctl, Github, ProviderError} from "./providers";
import {activeRetroSchedule, RETRO_CRON, RETRO_OBJECT, weeklyEnd, weeklyReport} from "./retro";
import {bearer} from "./signatures";

const WAIT = 60_000;
const DAY = 24 * 60 * 60_000;
const SUPERSEDED = "release-superseded-without-production-smoke";
const PENDING_PRODUCTION = "phase='blocked' AND json_extract(state,'$.reason')=? AND json_extract(state,'$.productionVerification') IS NOT NULL";

type Phase = "triage" | "ready" | "plan" | "planned" | "implement" | "pr" | "release" | "closed" | "blocked";
type Ticket = {
  issue: number; actor: string; phase: Phase; created: number; due: number; failures: number;
  maintainer?: MaintainerIntake; main?: string;
  feature?: string; deployed?: string; triageRun?: string; triageSession?: string;
  triageComment?: number; planComment?: number; plan?: string; implement?: string;
  pr?: number; head?: string; merge?: string; mergedAt?: number; reason?: string; productionVerification?: string; productionHistory?: DeploymentSearch;
};
type Finish = Extract<Ingress, {kind: "finish"}>;

export default {
  fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === "/health" && request.method === "GET") return Response.json({ok: true, sourceSha: env.SOURCE_SHA ?? null}, {headers: {"Cache-Control": "no-store"}});
    return env.FACTORY.get(env.FACTORY.idFromName("pilot")).fetch(request);
  },
  scheduled(controller, env, ctx) {
    if (controller.cron === RETRO_CRON && activeRetroSchedule(env)) {
      ctx.waitUntil(env.FACTORY.getByName(RETRO_OBJECT).queueWeeklyRetro(controller.scheduledTime));
    }
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
        const ticket: Ticket = {issue: event.issue, actor: event.actor, maintainer: event.maintainer, phase: "triage", due: now, created: now, failures: 0};
        this.sql.exec("INSERT OR IGNORE INTO ticket VALUES (?, ?, ?, NULL, ?)", ticket.issue, ticket.phase, now, JSON.stringify(ticket));
        this.audit(String(ticket.issue), "issue-observed");
      } else if (event.kind === "finish") {
        // Keep out-of-order results until exact schedule/run/session evidence exists.
        this.sql.exec(`INSERT INTO result VALUES (?, ?, ?, ?) ON CONFLICT(session) DO UPDATE SET
          at=excluded.at, issue=excluded.issue, state=excluded.state WHERE excluded.at > result.at AND (excluded.issue IS NOT NULL OR result.issue IS NULL)`,
        event.session, event.at, event.result?.issue ?? null, JSON.stringify(event));
      } else if (event.kind === "production") {
        this.sql.exec(`UPDATE ticket SET due=?, state=json_set(json_remove(state,'$.productionHistory'),'$.due',?,'$.productionVerification',?)
          WHERE (phase='release' OR (phase='blocked' AND json_extract(state,'$.reason')=?))
            AND json_extract(state,'$.merge')=?`,
          now, now, id, SUPERSEDED, event.head);
      } else if (event.kind === "alert") {
        this.queue(`ops:${event.key}`, this.env.OPS_SCHEDULE_ID, "read", {repo: this.env.REPO, code: event.code, head: event.head});
        this.audit(`ops:${event.key}`, "alert-accepted");
      }
    });
    return new Response(null, {status: 202});
  }

  private isRetroObject(): boolean {
    return this.ctx.id.equals(this.env.FACTORY.idFromName(RETRO_OBJECT));
  }

  async queueWeeklyRetro(scheduledTime: number): Promise<void> {
    const schedule = activeRetroSchedule(this.env);
    if (!schedule || !this.isRetroObject() || !Number.isSafeInteger(scheduledTime)) return;
    const end = weeklyEnd(scheduledTime);
    if (end > weeklyEnd(Date.now())) return;
    const key = `retro:${new Date(end).toISOString().slice(0, 10)}`;
    if (this.dispatches("key=?", key).length) return;
    if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(Date.now() + 100);
    this.queue(key, schedule, "read", {kind: "weekly-retrospective"}, end);
  }

  async alarm(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // A watchdog also covers eviction or interruption during an external request.
      await this.ctx.storage.setAlarm(Date.now() + 120_000);
      if (this.isRetroObject()) await this.pumpRetro();
      else await this.pump();
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

  private queue(key: string, schedule: string, access: Dispatch["access"], context: Record<string, unknown>, reportAt?: number) {
    if (this.dispatches("key=?", key).length) return;
    this.saveDispatch({
      key, schedule, access, context: JSON.stringify({v: 1, invocation: crypto.randomUUID(), ...context}),
      state: "queued", attempts: 0, due: Date.now(), reportAt,
    });
  }

  private async dispatch(fctl: Fctl, dispatch: Dispatch, verify?: () => Promise<boolean>) {
    const result = await advanceDispatch(fctl, this.env, dispatch, next => this.saveDispatch(next), verify);
    if (result.state !== dispatch.state) this.audit(result.key, result.reason ?? result.state);
    return result;
  }

  private finish(session: string, schedule: string): Finish | undefined {
    const row = this.sql.exec<{state: string}>("SELECT state FROM result WHERE session=?", session).toArray()[0];
    const finish = row ? JSON.parse(row.state) as Finish : undefined;
    return finish?.schedule === schedule ? finish : undefined;
  }

  private async pumpRetro() {
    if (!activeRetroSchedule(this.env)) return this.ctx.storage.deleteAlarm();
    const pending = "state IN ('queued','posting')";
    let dispatch = this.dispatches(`${pending} AND due<=? ORDER BY due,key LIMIT 1`, Date.now())[0];
    if (dispatch) {
      const fctl = new Fctl(this.env);
      try {
        const at = dispatch.reportAt;
        if (dispatch.state === "queued" && (at === undefined || at < weeklyEnd(Date.now()))) {
          this.saveDispatch({...dispatch, state: "blocked", reason: "retro-window-expired"});
          this.audit(dispatch.key, "retro-window-expired");
        } else {
          const context = record(JSON.parse(dispatch.context));
          if (at !== undefined && dispatch.state === "queued" && !context.report) {
            const report = await weeklyReport(fctl, this.env.FCTL_PROJECT_ID, at);
            dispatch = {...dispatch, context: JSON.stringify({...context, report})};
            this.saveDispatch(dispatch);
          }
          await this.dispatch(fctl, dispatch);
        }
      } catch {
        const current = this.dispatches("key=?", dispatch.key)[0];
        this.saveDispatch({...current, due: Date.now() + 300_000});
        this.audit(current.key, "retro-provider-retry");
      }
    }
    const next = this.dispatches(`${pending} ORDER BY due,key LIMIT 1`)[0];
    if (next) await this.ctx.storage.setAlarm(Math.max(Date.now() + 100, next.due));
    else await this.ctx.storage.deleteAlarm();
  }

  private async pump() {
    const github = new Github(this.env);
    const fctl = new Fctl(this.env);
    const now = Date.now();
    const due = this.tickets("phase='triage' AND due<=? ORDER BY issue LIMIT 1", now);
    const slot = this.sql.exec<{issue: number}>("SELECT issue FROM slot").toArray()[0];
    const active = slot ? this.tickets("issue=? AND due<=? AND phase!='blocked'", slot.issue, now)[0] :
      this.tickets("phase='ready' AND due<=? ORDER BY issue LIMIT 1", now)[0];
    // Webhook wakeups can deliver late production evidence even after the
    // superseded ticket released its slot.
    const superseded = this.tickets(
      `${PENDING_PRODUCTION} AND due<=? ORDER BY due,issue LIMIT 1`,
      SUPERSEDED, now,
    );
    for (const ticket of [...due, ...(active ? [active] : []), ...superseded]) {
      try {
        const result = await this.advance(ticket, fctl, github);
        if (result !== "pending" && ticket.phase === "blocked" && ticket.productionVerification) {
          const current = this.tickets("issue=?", ticket.issue)[0];
          if (current.productionVerification === ticket.productionVerification) {
            this.ticket(current, {productionVerification: undefined});
          }
        }
      } catch {
        const current = this.tickets("issue=?", ticket.issue)[0];
        if (current.productionVerification !== ticket.productionVerification) continue;
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
    const productionDue = this.sql.exec<{due: number | null}>(
      `SELECT MIN(due) AS due FROM ticket WHERE ${PENDING_PRODUCTION}`, SUPERSEDED,
    ).one().due;
    if (productionDue !== null || pending.pending || bootstrap.length) {
      const regularDue = pending.pending || bootstrap.length ? Date.now() + WAIT : Infinity;
      await this.ctx.storage.setAlarm(Math.max(Date.now() + 100, Math.min(regularDue, productionDue ?? Infinity)));
    }
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

  private async checkComment(github: Github, issue: number, stage: "triage" | "plan", id?: number): Promise<boolean> {
    if (!integer(id)) return false;
    const comment = await this.readEvidence(github, `/issues/comments/${id}`);
    if (!comment) return false;
    const author = record(comment.user);
    return comment.id === id && author.type === "Bot" && String(author.id) === this.env.GITHUB_TRIAGE_BOT_ID &&
      comment.issue_url === `https://api.github.com/repos/${this.env.REPO}/issues/${issue}` &&
      typeof comment.body === "string" && comment.body.startsWith(`<!-- factory:${stage} v1 -->`);
  }

  private async verifyDeployment(ticket: Ticket, github: Github, head: string) {
    const history = ticket.productionHistory?.head === head ? ticket.productionHistory : {head, page: 1};
    let verified: boolean | undefined;
    try {
      verified = await deployment(github, this.env, history);
      return verified;
    } finally {
      const current = this.tickets("issue=?", ticket.issue)[0];
      if (current.productionVerification === ticket.productionVerification) {
        if (verified !== false) {
          this.sql.exec("UPDATE ticket SET state=json_set(state,'$.productionHistory',json(?)) WHERE issue=?",
            JSON.stringify(history), ticket.issue);
        } else {
          this.sql.exec("UPDATE ticket SET state=json_remove(state,'$.productionHistory') WHERE issue=?", ticket.issue);
        }
      }
    }
  }

  private async readEvidence(github: Github, path: string): Promise<Json | undefined> {
    // Authentication failures must still retry, even if the token endpoint returns 404.
    await github.appToken();
    try {
      return record(await github.api(path));
    } catch (error) {
      if (error instanceof ProviderError && [404, 410].includes(error.status)) return;
      throw error;
    }
  }

  private async readIssue(github: Github, ticket: Ticket): Promise<Json | undefined> {
    const path = `/issues/${ticket.issue}`;
    return ticket.maintainer ? this.readEvidence(github, path) : record(await github.api(path));
  }

  private async matchesMaintainer(ticket: Ticket, issue?: Json): Promise<boolean> {
    if (!issue) return false;
    const maintainer = ticket.maintainer;
    const author = record(issue.user);
    return !!maintainer && maintainerIdentity(issue, this.env, ticket.issue, maintainer.id) &&
      trustedHuman(author, this.env.HUMAN_REVIEWER_IDS) && author.login === ticket.actor &&
      await featureSnapshot(issue) === maintainer.snapshot;
  }

  private async triage(ticket: Ticket, fctl: Fctl, github: Github) {
    const {env} = this;
    const {maintainer} = ticket;
    if (Date.now() - ticket.created > DAY) return this.block(ticket, maintainer ? "maintainer-triage-timeout" : "native-triage-timeout");
    const schedule = maintainer ? env.MAINTAINER_TRIAGE_SCHEDULE_ID : env.TRIAGE_SCHEDULE_ID;
    if (!identifier(schedule, "sch") || maintainer && [env.TRIAGE_SCHEDULE_ID, env.PLAN_SCHEDULE_ID].includes(schedule)) {
      return this.block(ticket, "triage-schedule-identity");
    }
    const issue = await this.readIssue(github, ticket);
    const evidence = issue && !maintainer ? issueEvidence(issue) : undefined;
    let runId: string | undefined;
    let sessionId: unknown;
    if (maintainer) {
      if (!await this.matchesMaintainer(ticket, issue)) return this.block(ticket, "issue-evidence-changed");
      const key = `maintainer-triage:${ticket.issue}`;
      this.queue(key, schedule, "triage", {repo: env.REPO, issue: ticket.issue, provenance: "maintainer",
        author_id: maintainer.id, actor: ticket.actor, issue_snapshot_sha256: maintainer.snapshot});
      const queued = this.dispatches("key=?", key)[0];
      if (queued.schedule !== schedule) return this.block(ticket, "triage-schedule-identity");
      const dispatch = await this.dispatch(fctl, queued);
      if (dispatch.state === "blocked") return this.block(ticket, dispatch.reason ?? "triage-dispatch-blocked");
      if (dispatch.state !== "started") return this.ticket(ticket, {});
      runId = dispatch.run;
      sessionId = dispatch.session;
    } else {
      if (!issue || !evidence || issue.number !== ticket.issue || String(record(issue.user).id) !== env.GITHUB_DISCOVERY_BOT_ID ||
          record(issue.user).login !== ticket.actor) return this.block(ticket, "issue-evidence");
      if (this.tickets("feature=? AND issue<>?", evidence.feature, ticket.issue).length) return this.block(ticket, "duplicate-feature");
      const runs = list((await fctl.runs(schedule)).runs).map(record);
      const run = runs.find(row => nativeRun(row, schedule, String(record(row.session).id), env.REPO, ticket.issue, ticket.actor));
      if (!run) return this.ticket(ticket, {});
      runId = String(run.id);
      sessionId = record(run.session).id;
    }
    if (!identifier(runId, "srn") || !identifier(sessionId, "ses")) return;
    const finish = this.finish(sessionId, schedule);
    if (!finish) return this.ticket(ticket, {});
    const result = finish.result;
    const session = await fctl.session(sessionId, schedule);
    if (session.id !== sessionId || session.github_access !== "triage" || session.agent_kind !== "codex") return this.block(ticket, "triage-session-identity");
    if (!result || finish.at < Number(session.created_at) || result.stage !== "triage" || result.issue !== ticket.issue || result.status !== "ready" ||
        !await this.checkComment(github, ticket.issue, "triage", result.comment)) return this.block(ticket, "triage-result");
    let main: string | undefined;
    if (evidence) {
      const verified = await this.verifyDeployment(ticket, github, evidence.deployed);
      if (verified === undefined) return;
      if (!verified) return this.block({...ticket, productionHistory: undefined}, "parity-deployment-evidence");
    } else {
      const ref = record(await github.api("/git/ref/heads/main"));
      const commit = record(ref.object);
      if (ref.ref !== "refs/heads/main" || commit.type !== "commit" || !sha(commit.sha)) {
        return this.block(ticket, "main-revision-evidence");
      }
      main = commit.sha;
    }
    this.ticket(ticket, {phase: "ready", ...evidence, main, productionHistory: undefined, triageRun: runId, triageSession: sessionId,
      triageComment: result.comment, due: Date.now()});
  }

  private async advance(ticket: Ticket, fctl: Fctl, github: Github) {
    const env = this.env;
    const issue = ticket.issue;
    const provenance = ticket.maintainer
      ? {provenance: "maintainer", main_sha: ticket.main, issue_snapshot_sha256: ticket.maintainer.snapshot}
      : {provenance: "parity", feature_id: ticket.feature, deployed_sha: ticket.deployed};
    const context = {repo: env.REPO, issue, ...provenance};
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
        if (!ticket.maintainer) {
          const current = record(await github.api(`/issues/${issue}`));
          const evidence = issueEvidence(current);
          if (!evidence || evidence.feature !== ticket.feature || evidence.deployed !== ticket.deployed ||
              String(record(current.user).id) !== env.GITHUB_DISCOVERY_BOT_ID) return this.block(ticket, "issue-evidence-changed", true);
        }
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
        const dispatch = await this.dispatch(fctl, current, ticket.maintainer
          ? async () => await this.checkComment(github, issue,
            stage === "plan" ? "triage" : "plan", stage === "plan" ? ticket.triageComment : ticket.planComment) &&
            await this.matchesMaintainer(ticket, await this.readIssue(github, ticket))
          : undefined);
        if (dispatch.state === "blocked") {
          return this.block(ticket, dispatch.reason ?? "dispatch-blocked",
            stage === "plan" || dispatch.reason === "issue-evidence-changed");
        }
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
          if (result.status !== "planned" || !await this.checkComment(github, issue, "plan", result.comment)) {
            return this.block(ticket, "plan-comment", true);
          }
          this.ticket(ticket, {phase: "planned", planComment: result.comment, due: Date.now()});
        } else {
          if (result.status !== "implemented") return this.block(ticket, "implementation-pr-missing");
          if (!list(session.pull_requests).map(record).some(pr => pr.number === result.pr && fctlRepo(pr.repo) === env.REPO)) {
            return this.ticket(ticket, {});
          }
          this.ticket(ticket, {phase: "pr", pr: result.pr, due: Date.now()});
        }
        return;
      }
      case "pr":
      case "release":
      case "blocked": {
        const dispatch = this.dispatches("key=?", ticket.implement ?? "")[0];
        if (!ticket.pr || !dispatch?.session) return this.block(ticket, "implementation-link-missing");
        return this.pr(github, fctl, ticket.pr, ticket, dispatch);
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
      if (ticket.phase === "pr") this.ticket(ticket, {phase: "release", merge: pr.merge_commit_sha, mergedAt, reason: "awaiting-production-smoke"});
      const verified = await this.verifyDeployment(ticket, github, pr.merge_commit_sha);
      if (!verified) {
        if (ticket.phase !== "blocked" && await github.mainAdvancedPast(pr.merge_commit_sha)) {
          const release = this.tickets("issue=?", ticket.issue)[0];
          // Establish a durable check even if Delivery's webhook preceded this transition.
          this.block({...release, productionVerification: release.productionVerification ?? crypto.randomUUID()},
            SUPERSEDED, true);
        }
        if (verified === undefined) {
          const current = this.tickets("issue=?", ticket.issue)[0];
          if (current.productionVerification === ticket.productionVerification) this.ticket(current, {});
          return "pending" as const;
        }
        return;
      }
      const release = {...ticket, merge: pr.merge_commit_sha, mergedAt, productionVerification: undefined, productionHistory: undefined};
      const issue = await this.readIssue(github, ticket);
      if (!issue) return this.block(release, "release-issue-missing", true);
      if (ticket.maintainer) {
        // Release verifies the recorded author, while intake and dispatch consult the current allowlist.
        if (!maintainerIdentity(issue, this.env, ticket.issue, ticket.maintainer.id)) {
          return this.block(release, "release-issue-identity", true);
        }
        if (issue.state !== "closed" && await featureSnapshot(issue) !== ticket.maintainer.snapshot) {
          return this.block(release, "release-issue-evidence-changed", true);
        }
      } else if (issue.number !== ticket.issue || issue.pull_request || String(record(issue.user).id) !== this.env.GITHUB_DISCOVERY_BOT_ID) {
        return this.block(ticket, "release-issue-identity");
      }
      if (issue.state !== "closed") await github.api(`/issues/${ticket.issue}`, "PATCH", {state: "closed", state_reason: "completed"});
      this.ctx.storage.transactionSync(() => {
        this.ticket(ticket, {phase: "closed", merge: pr.merge_commit_sha as string, mergedAt, productionVerification: undefined, productionHistory: undefined});
        this.sql.exec("DELETE FROM slot WHERE issue=?", ticket.issue);
      });
      return;
    }

    if (ticket?.phase === "blocked") return;
    if (pr.state !== "open") {
      if (ticket) this.block(ticket, "pr-closed-without-merge");
      return;
    }
    if (ticket) this.ticket(ticket, {head: currentHead});
    if (this.env.MERGE_ENABLED !== "true") return;
    const matches = relation && await gate(github, fctl, this.env, pr, number, session) && await github.hasNoClosingIssues(number);
    await github.setGate(currentHead, `factory-pr-${number}`, matches);
    if (!matches) return;
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
