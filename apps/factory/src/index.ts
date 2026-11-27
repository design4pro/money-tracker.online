import {DurableObject} from "cloudflare:workers";
import {fctlRepo, identifier, integer, list, nativeRun, record, sha, trustedHuman} from "./contracts";
import type {DeliveryTarget, Env, Json, Result} from "./contracts";
import {advanceDispatch} from "./dispatch";
import type {Dispatch} from "./dispatch";
import {ingress} from "./ingress";
import type {Ingress} from "./ingress";
import {featureSnapshot, maintainerIdentity} from "./intake";
import type {MaintainerIntake, StagingIntake} from "./intake";
import {deployment, gate, hasStagingClassification, issueEvidence, linked} from "./policy";
import type {DeploymentSearch} from "./policy";
import {CREDENTIAL_PAUSE, Fctl, Github, ProviderError} from "./providers";
import type {RecoveryProgress} from "./providers";
import {activeRetroSchedule, RETRO_CRON, RETRO_OBJECT, weeklyEnd, weeklyReport} from "./retro";
import {bearer} from "./signatures";

const WAIT = 60_000;
const RECOVERY_WAIT = 1_000;
const CREDENTIAL_WAIT = 5 * 60_000;
const DAY = 24 * 60 * 60_000;
const PRODUCTION_SUPERSEDED = "release-superseded-without-production-smoke";
const STAGING_SUPERSEDED = "release-superseded-without-staging-smoke";
const SUPERSEDED_RELEASE = "phase='blocked' AND json_extract(state,'$.reason') IN (?,?)";
const PENDING_RELEASE = `${SUPERSEDED_RELEASE} AND json_extract(state,'$.productionVerification') IS NOT NULL`;

type Phase = "triage" | "ready" | "plan" | "planned" | "implement" | "pr" | "release" | "closed" | "blocked";
type Stage = "triage" | "plan" | "implement";
type CredentialRecovery = {
  session: string; run: string; schedule: string; stage: Stage;
  parity?: ReturnType<typeof issueEvidence>;
  action: "resume" | "messages"; reservedAt: number; interruptedTurns?: number;
};
type Ticket = {
  issue: number; actor: string; phase: Phase; created: number; due: number; failures: number; recoveryPending?: true;
  credentialRecovery?: CredentialRecovery;
  maintainer?: MaintainerIntake; staging?: StagingIntake; main?: string;
  feature?: string; deployed?: string; triageRun?: string; triageSession?: string;
  triageComment?: number; planComment?: number; plan?: string; implement?: string;
  pr?: number; head?: string; merge?: string; mergedAt?: number; reason?: string; productionVerification?: string; productionHistory?: DeploymentSearch; stagingHistory?: DeploymentSearch;
};
type Finish = Extract<Ingress, {kind: "finish"}> & {recovery?: RecoveryProgress; verifiedResult?: Result};

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
      CREATE TABLE IF NOT EXISTS recovery_finish (
        session TEXT NOT NULL, schedule TEXT NOT NULL, at INTEGER NOT NULL, due INTEGER NOT NULL, state TEXT NOT NULL,
        PRIMARY KEY(session,schedule,at)
      );
      CREATE TABLE IF NOT EXISTS dispatch (key TEXT PRIMARY KEY, state TEXT NOT NULL, due INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS slot (singleton INTEGER PRIMARY KEY CHECK(singleton=1), issue INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (at INTEGER NOT NULL, subject TEXT NOT NULL, action TEXT NOT NULL);
    `);
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/health/staging-ui") {
      if (this.env.DELIVERY_TARGET !== "staging") return new Response(null, {status: 404});
      const {busy} = this.sql.exec(`SELECT
        EXISTS(SELECT 1 FROM slot) OR
        EXISTS(SELECT 1 FROM ticket WHERE phase NOT IN ('closed','blocked')) AS busy`).one();
      return Response.json({idle: busy === 0, sourceSha: this.env.SOURCE_SHA ?? null}, {headers: {"Cache-Control": "no-store"}});
    }
    if (request.method === "GET" && path === "/ops/status") {
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
        const ticket: Ticket = {issue: event.issue, actor: event.actor, maintainer: event.maintainer, staging: event.staging, phase: "triage", due: now, created: now, failures: 0};
        this.sql.exec("INSERT OR IGNORE INTO ticket VALUES (?, ?, ?, NULL, ?)", ticket.issue, ticket.phase, now, JSON.stringify(ticket));
        this.audit(String(ticket.issue), "issue-observed");
      } else if (event.kind === "finish") {
        const active = this.sql.exec<{issue: number; phase: string}>(`SELECT issue,phase FROM ticket
          WHERE phase IN ('triage','plan','implement')
            AND json_extract(state,'$.credentialRecovery.session') = ?
            AND json_extract(state,'$.credentialRecovery.schedule') = ? LIMIT 1`, event.session, event.schedule).toArray()[0];
        if (active) {
          // An explicit mismatch cannot supersede a signed turn candidate.
          if (event.result && (event.result.issue !== active.issue || event.result.stage !== active.phase)) return;
          if (event.completedTurns || event.result) {
            this.sql.exec("INSERT OR IGNORE INTO recovery_finish VALUES (?, ?, ?, 0, ?)",
              event.session, event.schedule, event.at, JSON.stringify(event));
            return;
          }
        }

        // Keep out-of-order results until exact schedule/run/session evidence exists.
        // Prefer a parsed message over recoverable evidence, and either over a non-result event.
        // A newer completed turn must be checked before an older pre-work result can free a slot.
        this.sql.exec(`INSERT INTO result VALUES (?, ?, ?, ?) ON CONFLICT(session) DO UPDATE SET
          at=excluded.at, issue=excluded.issue, state=excluded.state WHERE excluded.at > result.at AND (
            excluded.issue IS NOT NULL OR (result.issue IS NULL AND (
              json_type(excluded.state,'$.completedTurns') = 'integer' OR
              json_type(result.state,'$.completedTurns') IS NULL)) OR
            (json_extract(result.state,'$.result.reason') = 'pre-work-evidence-changed'
              AND json_extract(excluded.state,'$.completedTurns') > COALESCE(json_extract(result.state,'$.turns'),0)))
            AND (json_type(result.state,'$.recovery.interruptedIdleAt') IS NULL OR
              json_extract(excluded.state,'$.turns') > json_extract(result.state,'$.completedTurns'))`,
        event.session, event.at, event.result?.issue ?? null, JSON.stringify(event));
      } else if (event.kind === "delivery") {
        this.sql.exec(`UPDATE ticket SET due=?, state=json_set(json_remove(state,'$.productionHistory','$.stagingHistory'),'$.due',?,'$.productionVerification',?)
          WHERE (phase='release' OR (${SUPERSEDED_RELEASE}))
            AND json_extract(state,'$.merge')=?`,
          now, now, id, PRODUCTION_SUPERSEDED, STAGING_SUPERSEDED, event.head);
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
    const next = {...ticket, failures: 0, recoveryPending: undefined, due: Date.now() + WAIT, ...changes};
    if (changes.phase && changes.phase !== ticket.phase) {
      next.credentialRecovery = undefined;
      if (!changes.reason && (next.reason?.startsWith("credential-") || next.reason?.startsWith("session-"))) next.reason = undefined;
    }
    this.sql.exec("UPDATE ticket SET phase=?, due=?, feature=?, state=? WHERE issue=?",
      next.phase, next.due, next.feature ?? null, JSON.stringify(next), next.issue);
    if (changes.phase && changes.phase !== ticket.phase) {
      if (ticket.credentialRecovery) this.sql.exec("DELETE FROM recovery_finish WHERE session=? AND schedule=?",
        ticket.credentialRecovery.session, ticket.credentialRecovery.schedule);
      this.audit(String(ticket.issue), changes.reason ?? changes.phase);
    }
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

  private recoveryFinish(session: string, schedule: string, includeDeferred = false): Finish | undefined {
    const row = this.sql.exec<{state: string}>(
      "SELECT state FROM recovery_finish WHERE session=? AND schedule=? AND due<=? ORDER BY at DESC LIMIT 1",
      session, schedule, includeDeferred ? Number.MAX_SAFE_INTEGER : Date.now()).toArray()[0];
    return row ? JSON.parse(row.state) as Finish : undefined;
  }

  private finishResult(fctl: Fctl, finish: Finish, queued: boolean) {
    if (queued && finish.verifiedResult) return finish.verifiedResult;
    if (!finish.completedTurns) return finish.result;
    return fctl.resultAt(finish.session, finish.at, finish.completedTurns, finish.recovery, progress => {
      // The normal path can be superseded during a transcript read.
      const table = queued ? "recovery_finish" : "result";
      this.sql.exec(`UPDATE ${table} SET state=json_set(state, '$.recovery', json(?)) WHERE session=? AND at=?
        AND json_extract(state,'$.schedule')=?`, JSON.stringify(progress), finish.session, finish.at, finish.schedule);
    });
  }

  private recoveryWait(ticket: Ticket, reason = ticket.reason, moreCandidates = false) {
    if (reason && ticket.reason !== reason) this.audit(String(ticket.issue), reason);
    this.ticket(ticket, moreCandidates ? {reason, due: Date.now() + RECOVERY_WAIT, recoveryPending: true} : {reason});
    return "waiting" as const;
  }

  private deferRecoveryFinish(ticket: Ticket, candidate: Finish, reason: string, parsed?: Result) {
    this.sql.exec(`UPDATE recovery_finish SET due=?,state=json_patch(state,json(?)) WHERE session=? AND schedule=? AND at=?`,
      Date.now() + WAIT, JSON.stringify(parsed ? {verifiedResult: parsed} : {}), candidate.session, candidate.schedule, candidate.at);
    return this.recoveryWait(ticket, reason, !!this.recoveryFinish(candidate.session, candidate.schedule));
  }

  private async stageResult(ticket: Ticket, fctl: Fctl, github: Github, stage: Stage, run: string, schedule: string,
    session: Json, finish: Finish | undefined, verify: () => Promise<boolean>, parity?: ReturnType<typeof issueEvidence>) {
    const id = String(session.id);
    const reservation = ticket.credentialRecovery;
    if (reservation && (reservation.session !== id || reservation.run !== run ||
        reservation.schedule !== schedule || reservation.stage !== stage)) {
      return this.recoveryWait(ticket, "credential-recovery-identity-operator");
    }
    const eligible = (item?: Finish) => item && item.at >= Number(session.created_at) &&
      (reservation?.interruptedTurns === undefined || (item.turns ?? item.completedTurns ?? 0) > reservation.interruptedTurns);
    const candidate = reservation && this.recoveryFinish(id, schedule);
    const selected = reservation ? candidate : finish;
    if (!reservation && finish && !eligible(finish)) return;
    let result: Awaited<ReturnType<Fctl["resultAt"]>>;
    try {
      result = selected && eligible(selected) ? await this.finishResult(fctl, selected, selected === candidate) : undefined;
    } catch (error) {
      if (!candidate || selected !== candidate) throw error;
      const reason = reservation && Date.now() >= reservation.reservedAt + CREDENTIAL_WAIT
        ? "credential-recovery-transcript-unavailable-operator" : "credential-recovery-transcript-retry";
      return this.deferRecoveryFinish(ticket, candidate, reason);
    }
    // The normal finish can be superseded during a transcript read.
    if (!reservation && this.finish(id, schedule)?.at !== finish?.at) return "recovery-pending" as const;
    if (result === "recovery-pending") return result;
    const interrupted = result && "interruptedIdleAt" in result ? result.interruptedIdleAt : undefined;
    const parsed = result && !("interruptedIdleAt" in result) ? result : undefined;
    if (!reservation && finish && interrupted === undefined) {
      if (ticket.staging && parsed && parsed.stage === stage && parsed.issue === ticket.issue &&
          parsed.status !== "blocked" && parsed.status !== "implemented") {
        const matches = await verify();
        if (this.finish(id, schedule)?.at !== finish.at) return "recovery-pending" as const;
        if (!matches) return;
      }
      return parsed;
    }

    if (reservation && parsed?.stage === stage && parsed.issue === ticket.issue) {
      let reason: string | undefined;
      const expired = Date.now() >= reservation.reservedAt + CREDENTIAL_WAIT;
      if (parsed.status !== "blocked") {
        try {
          // Keep a linked staging PR even if the issue changes after work started.
          // The merge gate checks current evidence before it can merge the PR.
          const stagedPR = ticket.staging && parsed.status === "implemented";
          if (!stagedPR && !await verify()) reason = "credential-recovery-evidence-changed-operator";
          else if (parsed.status === "implemented" && !await this.matchesImplementationPR(github, ticket, session, parsed.pr)) {
            reason = expired ? "credential-recovery-pr-link-operator" : "credential-recovery-awaiting-pr-link";
          } else if ((parsed.stage === "triage" || parsed.stage === "plan") &&
              !await this.checkComment(github, ticket.issue, parsed.stage, parsed.comment)) {
            reason = expired ? "credential-recovery-comment-operator" : "credential-recovery-awaiting-comment";
          }
        } catch {
          reason = expired ? "credential-recovery-evidence-unavailable-operator" : "credential-recovery-evidence-retry";
        }
      }
      if (candidate && reason) return this.deferRecoveryFinish(ticket, candidate, reason, parsed);
      // A newer completion can arrive while recovering the transcript or checking GitHub.
      return this.recoveryFinish(id, schedule)?.at === candidate?.at ? parsed : "recovery-pending" as const;
    }
    if (reservation && candidate && selected === candidate) {
      const more = this.ctx.storage.transactionSync(() => {
        this.sql.exec("DELETE FROM recovery_finish WHERE session=? AND schedule=? AND at=?", id, schedule, candidate.at);
        if (interrupted !== undefined) {
          ticket = {...ticket, credentialRecovery: {...reservation, interruptedTurns: candidate.completedTurns}};
        }
        const pending = !!this.recoveryFinish(id, schedule);
        if (pending) this.ticket(ticket, {due: Date.now() + RECOVERY_WAIT, recoveryPending: true});
        else if (interrupted !== undefined) this.ticket(ticket, {});
        return pending;
      });
      if (more) return "waiting";
    }
    // A reserved continuation stays eligible until this session returns its
    // stage result. An intermediate finish, stop, failure or question cannot
    // establish the outcome of the continuation.
    const paused = session.status === "paused" && session.status_reason === CREDENTIAL_PAUSE;
    if (session.status === "paused" && !paused) {
      return this.recoveryWait(ticket, session.status_reason === "Waiting for the ChatGPT plan usage limit to reset"
        ? "session-usage-limit" : "session-paused-operator");
    }
    if (session.status === "failed" || session.status === "stopped") {
      const restarting = session.status === "stopped" && reservation?.action === "resume" &&
        Date.now() < reservation.reservedAt + CREDENTIAL_WAIT;
      const reason = restarting ? "credential-restart-stop-observed" : `session-${session.status}-operator`;
      return this.recoveryWait(ticket, reason);
    }
    if (reservation) {
      if (session.question || finish?.eventType === "session.question") {
        return this.recoveryWait(ticket, "credential-continuation-question-operator");
      }
      if (finish?.eventType === "session.failed") return this.recoveryWait(ticket, "session-failed-operator");
      // Queued, running and idle are all possible after an ambiguous POST.
      // Only the original session's newer signed result can advance the stage.
      if (ticket.reason?.endsWith("-operator")) return this.recoveryWait(ticket);
      if (Date.now() >= reservation.reservedAt + CREDENTIAL_WAIT) {
        return this.recoveryWait(ticket, "credential-recovery-unresolved-operator");
      }
      if (["queued", "preparing", "running"].includes(String(session.status))) {
        return this.recoveryWait(ticket, "credential-continuation-active");
      }
      return this.recoveryWait(ticket);
    }
    const idle = (current: Json) => interrupted !== undefined && current.status === "idle" &&
      record(current.stats).turns === finish?.completedTurns && record(current.stats).turn_started_at === undefined &&
      (current.messaged_at === undefined || typeof current.messaged_at === "number" && current.messaged_at <= interrupted);
    const action = paused ? "resume" : idle(session) ? "messages" : undefined;
    if (!action) return this.recoveryWait(ticket, interrupted !== undefined ? "credential-interrupted-waiting" : undefined);

    const sameOwner = (current: Json) => current.id === id && current.agent_kind === "codex" &&
      current.github_access === session.github_access && current.role === "owner" &&
      identifier(this.env.FCTL_ACCOUNT_ID, "usr") && record(current.created_by).id === this.env.FCTL_ACCOUNT_ID &&
      !current.review && current.archived !== true;
    if (!identifier(run, "srn") || !sameOwner(session) || session.question) return this.recoveryWait(ticket, "credential-recovery-owner-or-question-operator");
    if (!await verify()) return this.recoveryWait(ticket, "credential-recovery-evidence-changed-operator");
    const current = await fctl.session(id, schedule);
    if (this.finish(id, schedule)?.at !== finish?.at) return "recovery-pending" as const;
    if (!sameOwner(current) || current.question) return this.recoveryWait(ticket, "credential-recovery-owner-or-question-operator");
    if (action === "resume" ? current.status !== "paused" || current.status_reason !== CREDENTIAL_PAUSE : !idle(current)) {
      return "recovery-pending" as const;
    }

    const credentialRecovery: CredentialRecovery = {session: id, run, schedule, stage, parity, action, reservedAt: Date.now(),
      interruptedTurns: interrupted === undefined ? undefined : finish?.completedTurns};
    const reserved = {...ticket, credentialRecovery};
    this.ctx.storage.transactionSync(() => {
      this.ticket(reserved, {reason: `credential-${action}-reserved`});
      this.audit(String(ticket.issue), `credential-${action}-reserved`);
    });
    const prompt = `Continue the original factory ${stage} task for issue #${ticket.issue} in this session. Check what you already completed and revalidate the original task evidence. Reuse any existing comment or pull request and branch. Return the original stage's required v1 JSON result as the first line, including a structured blocked result if its requirements cannot be met.`;
    try {
      await fctl.api(`/sessions/${id}/${action}`, action === "resume" ? {prompt, attachments: []} : {
        text: prompt, client_id: `factory-credential-${run}`, attachments: [],
      });
      return this.recoveryWait(reserved, `credential-${action}-accepted`);
    } catch (error) {
      const reason = error instanceof ProviderError && error.status === 429 ? "credential-usage-limit-operator" :
        error instanceof ProviderError && error.status === 501 ? "credential-connection-unavailable-operator" :
        error instanceof ProviderError && error.status < 500 ? `credential-${action}-http-${error.status}-operator` :
        `credential-${action}-uncertain`;
      return this.recoveryWait(reserved, reason);
    }
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
    const due = this.tickets("phase='triage' AND due<=? ORDER BY due,issue LIMIT 1", now);
    const slot = this.sql.exec<{issue: number}>("SELECT issue FROM slot").toArray()[0];
    const active = slot ? this.tickets("issue=? AND due<=? AND phase!='blocked'", slot.issue, now)[0] :
      this.tickets("phase='ready' AND due<=? ORDER BY issue LIMIT 1", now)[0];
    // Webhook wakeups can deliver late Delivery evidence even after the
    // superseded ticket released its slot.
    const superseded = this.tickets(
      `${PENDING_RELEASE} AND due<=? ORDER BY due,issue LIMIT 1`,
      PRODUCTION_SUPERSEDED, STAGING_SUPERSEDED, now,
    );
    for (const ticket of [...due, ...(active ? [active] : []), ...superseded]) {
      try {
        const result = await this.advance(ticket, fctl, github);
        if (result === "recovery-pending") {
          this.ticket(ticket, {due: Date.now() + RECOVERY_WAIT, recoveryPending: true});
          continue;
        }
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
    const releaseDue = this.sql.exec<{due: number | null}>(
      `SELECT MIN(due) AS due FROM ticket WHERE ${PENDING_RELEASE}`, PRODUCTION_SUPERSEDED, STAGING_SUPERSEDED,
    ).one().due;
    const recoveryDue = this.sql.exec<{due: number | null}>(
      `SELECT MIN(due) AS due FROM ticket WHERE json_extract(state, '$.recoveryPending') = 1
        AND (phase='triage' OR (phase IN ('plan','implement') AND issue=(SELECT issue FROM slot)))`,
    ).one().due;
    if (releaseDue !== null || recoveryDue !== null || pending.pending || bootstrap.length) {
      const regularDue = pending.pending || bootstrap.length ? Date.now() + WAIT : Infinity;
      await this.ctx.storage.setAlarm(Math.max(Date.now() + 100, Math.min(regularDue, recoveryDue ?? Infinity, releaseDue ?? Infinity)));
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

  private sessionHasPR(session: Json, pr: number): boolean {
    return list(session.pull_requests).map(record).some(link => link.number === pr && fctlRepo(link.repo) === this.env.REPO);
  }

  private implementationLink(pr: Json, ticket: Ticket, session: Json): boolean {
    const branch = record(pr.head).ref;
    return typeof branch === "string" && branch !== "" && session.branch === branch &&
      linked(pr.body, ticket.issue, String(session.id));
  }

  private async matchesImplementationPR(github: Github, ticket: Ticket, session: Json, number: number): Promise<boolean> {
    if (!this.sessionHasPR(session, number)) return false;
    const pr = await this.readEvidence(github, `/pulls/${number}`);
    if (!pr || pr.number !== number || pr.state !== "open" && pr.merged !== true) return false;
    const head = record(pr.head);
    const base = record(pr.base);
    return sha(head.sha) && base.ref === "main" && String(record(head.repo).id) === this.env.REPO_ID &&
      String(record(base.repo).id) === this.env.REPO_ID && this.implementationLink(pr, ticket, session);
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

  private async verifyDeployment(ticket: Ticket, github: Github, head: string, target: DeliveryTarget = "production") {
    const field = target === "staging" ? "stagingHistory" : "productionHistory";
    const saved = ticket[field];
    const history = saved?.head === head ? saved : {head, page: 1};
    let verified: boolean | undefined;
    try {
      verified = await deployment(github, this.env, history, target);
      return verified;
    } finally {
      const current = this.tickets("issue=?", ticket.issue)[0];
      if (current.productionVerification === ticket.productionVerification) {
        if (verified !== false) {
          this.sql.exec("UPDATE ticket SET state=json_set(state,?,json(?)) WHERE issue=?",
            `$.${field}`, JSON.stringify(history), ticket.issue);
        } else {
          this.sql.exec("UPDATE ticket SET state=json_remove(state,?) WHERE issue=?", `$.${field}`, ticket.issue);
        }
      }
    }
  }

  private async readEvidence(github: Github, path: string, rejectMovedIssue = false): Promise<Json | undefined> {
    // Authentication failures must still retry, even if the token endpoint returns 404.
    await github.appToken();
    try {
      return record(await github.api(path));
    } catch (error) {
      if (error instanceof ProviderError && ([404, 410].includes(error.status) || rejectMovedIssue && error.status === 301)) return;
      throw error;
    }
  }

  private async readIssue(github: Github, ticket: Ticket): Promise<Json | undefined> {
    const path = `/issues/${ticket.issue}`;
    return ticket.maintainer || ticket.staging ? this.readEvidence(github, path, true) : record(await github.api(path));
  }

  private async matchesMaintainer(ticket: Ticket, issue?: Json): Promise<boolean> {
    if (!issue) return false;
    const maintainer = ticket.maintainer;
    const author = record(issue.user);
    return !!maintainer && maintainerIdentity(issue, this.env, ticket.issue, maintainer.id) &&
      trustedHuman(author, this.env.HUMAN_REVIEWER_IDS) && author.login === ticket.actor &&
      await featureSnapshot(issue) === maintainer.snapshot;
  }

  private async matchesStaging(ticket: Ticket, issue?: Json, allowClosed = false): Promise<boolean> {
    const staged = ticket.staging;
    if (this.env.DELIVERY_TARGET !== "staging" || !staged || !issue || issue.number !== ticket.issue ||
        issue.repository_url !== `https://api.github.com/repos/${this.env.REPO}`) return false;
    const author = record(issue.user);
    if (author.type !== "Bot" || author.id !== staged.id || String(author.id) !== this.env.GITHUB_DISCOVERY_BOT_ID ||
        author.login !== ticket.actor) return false;
    const open = allowClosed && issue.state === "closed" ? {...issue, state: "open"} : issue;
    const evidence = issueEvidence(open, true);
    return evidence?.feature === staged.feature && evidence.deployed === staged.deployed &&
      await featureSnapshot(open) === staged.snapshot;
  }

  private async matchesDispatchEvidence(github: Github, ticket: Ticket, stage: "plan" | "implement"): Promise<boolean> {
    return await this.checkComment(github, ticket.issue,
      stage === "plan" ? "triage" : "plan", stage === "plan" ? ticket.triageComment : ticket.planComment) &&
      (ticket.staging ? await this.matchesStaging(ticket, await this.readIssue(github, ticket)) :
        await this.matchesMaintainer(ticket, await this.readIssue(github, ticket)));
  }

  private async triage(ticket: Ticket, fctl: Fctl, github: Github) {
    const {env} = this;
    const {maintainer, staging} = ticket;
    if (!ticket.credentialRecovery && Date.now() - ticket.created > DAY) {
      return this.block(ticket, maintainer ? "maintainer-triage-timeout" : "native-triage-timeout");
    }
    const schedule = maintainer ? env.MAINTAINER_TRIAGE_SCHEDULE_ID : env.TRIAGE_SCHEDULE_ID;
    if (!identifier(schedule, "sch") || maintainer && [env.TRIAGE_SCHEDULE_ID, env.PLAN_SCHEDULE_ID].includes(schedule)) {
      return this.block(ticket, "triage-schedule-identity");
    }
    const issue = await this.readIssue(github, ticket);
    const evidence = staging ? {feature: staging.feature, deployed: staging.deployed} :
      issue && !maintainer ? issueEvidence(issue) : undefined;
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
      if (staging && !await this.matchesStaging(ticket, issue)) {
        return ticket.credentialRecovery ? this.recoveryWait(ticket, "credential-recovery-evidence-changed-operator") :
          this.block(ticket, "issue-evidence-changed");
      }
      if (!issue || !evidence || issue.number !== ticket.issue || String(record(issue.user).id) !== env.GITHUB_DISCOVERY_BOT_ID ||
          record(issue.user).login !== ticket.actor) return this.block(ticket, "issue-evidence");
      if (this.tickets("feature=? AND issue<>?", evidence.feature, ticket.issue).length) return this.block(ticket, "duplicate-feature");
      const reserved = ticket.credentialRecovery;
      if (reserved) {
        // The run was verified before reserving the POST. It can age out of the first page.
        if (reserved.stage !== "triage" || reserved.schedule !== schedule) {
          return this.recoveryWait(ticket, "credential-recovery-identity-operator");
        }
        if (!staging && (reserved.parity?.feature !== evidence.feature || reserved.parity.deployed !== evidence.deployed)) {
          return this.recoveryWait(ticket, "credential-recovery-evidence-changed-operator");
        }
        runId = reserved.run;
        sessionId = reserved.session;
      } else {
        const runs = list((await fctl.runs(schedule)).runs).map(record);
        const run = runs.find(row => nativeRun(row, schedule, String(record(row.session).id), env.REPO, ticket.issue, ticket.actor));
        if (!run) return this.ticket(ticket, {});
        runId = String(run.id);
        sessionId = record(run.session).id;
      }
    }
    if (!identifier(runId, "srn") || !identifier(sessionId, "ses")) return;
    const finish = this.finish(sessionId, schedule);
    const session = await fctl.session(sessionId, schedule);
    if (session.id !== sessionId || session.github_access !== "triage" || session.agent_kind !== "codex") {
      return finish ? this.block(ticket, "triage-session-identity") : this.ticket(ticket, {});
    }
    const result = await this.stageResult(ticket, fctl, github, "triage", runId, schedule, session, finish, async () => {
      const current = await this.readIssue(github, ticket);
      if (maintainer) return this.matchesMaintainer(ticket, current);
      if (staging) return this.matchesStaging(ticket, current);
      const parity = current && issueEvidence(current);
      return !!parity && parity.feature === evidence?.feature && parity.deployed === evidence?.deployed &&
        current.number === ticket.issue && String(record(current.user).id) === env.GITHUB_DISCOVERY_BOT_ID &&
        record(current.user).login === ticket.actor;
    }, staging ? undefined : evidence);
    if (result === "waiting" || result === "recovery-pending") return result;
    if (!result || result.stage !== "triage" || result.issue !== ticket.issue || result.status !== "ready" ||
        !ticket.credentialRecovery && !await this.checkComment(github, ticket.issue, "triage", result.comment)) return this.block(ticket, "triage-result");
    let main: string | undefined;
    if (evidence) {
      const verified = await this.verifyDeployment(ticket, github, evidence.deployed, staging ? "staging" : "production");
      if (verified === undefined) return;
      if (!verified) return this.block({...ticket, productionHistory: undefined, stagingHistory: undefined},
        staging ? "staging-ui-deployment-evidence" : "parity-deployment-evidence");
    } else {
      const ref = record(await github.api("/git/ref/heads/main"));
      const commit = record(ref.object);
      if (ref.ref !== "refs/heads/main" || commit.type !== "commit" || !sha(commit.sha)) {
        return this.block(ticket, "main-revision-evidence");
      }
      main = commit.sha;
    }
    this.ticket(ticket, {phase: "ready", ...evidence, main, productionHistory: undefined, stagingHistory: undefined, triageRun: runId, triageSession: sessionId,
      triageComment: result.comment, due: Date.now()});
  }

  private async advance(ticket: Ticket, fctl: Fctl, github: Github) {
    const env = this.env;
    const issue = ticket.issue;
    const provenance = ticket.maintainer
      ? {provenance: "maintainer", main_sha: ticket.main, issue_snapshot_sha256: ticket.maintainer.snapshot}
      : ticket.staging
        ? {provenance: "staging-ui", feature_id: ticket.staging.feature, deployed_sha: ticket.staging.deployed,
          author_id: ticket.staging.id, actor: ticket.actor, issue_snapshot_sha256: ticket.staging.snapshot}
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
        if (!ticket.maintainer && !ticket.staging) {
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
        // Reconciliation must use the exact context sent in the original POST.
        const bound = ticket.maintainer || ticket.staging;
        const pending = bound && current.state === "queued"
          ? {...current, context: JSON.stringify({...record(JSON.parse(current.context)), ticket_bot_id: env.GITHUB_TRIAGE_BOT_ID})}
          : current;
        const dispatch = await this.dispatch(fctl, pending, bound
          ? () => this.matchesDispatchEvidence(github, ticket, stage)
          : undefined);
        if (dispatch.state === "blocked") {
          return this.block(ticket, dispatch.reason ?? "dispatch-blocked",
            stage === "plan" || dispatch.reason === "issue-evidence-changed");
        }
        if (dispatch.state !== "started" || !dispatch.session) return this.ticket(ticket, {});
        const finish = this.finish(dispatch.session, dispatch.schedule);
        const session = await fctl.session(dispatch.session, dispatch.schedule);
        if (session.id !== dispatch.session || session.agent_kind !== "codex" || session.github_access !== dispatch.access) {
          return finish ? this.block(ticket, "dispatch-session-identity", stage === "plan") : this.ticket(ticket, {});
        }
        const selectedFinish = () => ticket.credentialRecovery
          ? this.recoveryFinish(String(session.id), dispatch.schedule)
          : this.finish(String(session.id), dispatch.schedule);
        const selected = ticket.credentialRecovery ? selectedFinish() : finish;
        const selectedAt = selected?.at;
        const result = await this.stageResult(ticket, fctl, github, stage, String(dispatch.run), dispatch.schedule, session, finish, async () => {
          if (bound) return this.matchesDispatchEvidence(github, ticket, stage);
          const current = await this.readIssue(github, ticket);
          const evidence = current && issueEvidence(current);
          return !!evidence && evidence.feature === ticket.feature && evidence.deployed === ticket.deployed &&
            current.number === ticket.issue && String(record(current.user).id) === env.GITHUB_DISCOVERY_BOT_ID &&
            record(current.user).login === ticket.actor && await this.checkComment(github, ticket.issue,
              stage === "plan" ? "triage" : "plan", stage === "plan" ? ticket.triageComment : ticket.planComment);
        });
        if (result === "waiting" || result === "recovery-pending") return result;
        if (result?.stage !== stage || result.issue !== issue) {
          return this.block(ticket, `${stage}-result`, stage === "plan");
        }
        if (result.status === "blocked") {
          if (stage === "implement" && bound && result.reason === "pre-work-evidence-changed") {
            // A newer completion may be waiting for its PR link to appear.
            if (ticket.credentialRecovery && this.recoveryFinish(String(session.id), dispatch.schedule, true)?.at !== selectedAt) {
              return this.recoveryWait(ticket);
            }
            const noPR = (value: Json) => !value.pull_request &&
              (value.pull_requests === undefined || Array.isArray(value.pull_requests) && value.pull_requests.length === 0);
            if (noPR(session)) {
              const mismatch = !await this.matchesDispatchEvidence(github, ticket, stage);
              if (selectedFinish()?.at !== selectedAt) return "recovery-pending" as const;
              if (mismatch) {
                const latest = await fctl.session(dispatch.session, dispatch.schedule);
                if (selectedFinish()?.at !== selectedAt) return "recovery-pending" as const;
                const watermark = selected?.completedTurns ?? selected?.turns;
                const stats = record(latest.stats);
                if (latest.id !== dispatch.session || latest.agent_kind !== "codex" ||
                    latest.github_access !== dispatch.access || !noPR(latest) || latest.status !== "idle" ||
                    !integer(watermark) || stats.turns !== watermark || stats.turn_started_at !== undefined ||
                    (latest.messaged_at !== undefined && (typeof latest.messaged_at !== "number" ||
                      selectedAt === undefined || latest.messaged_at > selectedAt))) return this.ticket(ticket, {});
                return this.block(ticket, "implementation-pre-work-evidence-changed", true);
              }
            }
          }
          return this.block(ticket, `${stage}-result`, stage === "plan");
        }
        if (stage === "plan") {
          if (result.status !== "planned" || !ticket.credentialRecovery && !await this.checkComment(github, issue, "plan", result.comment)) {
            return this.block(ticket, "plan-comment", true);
          }
          this.ticket(ticket, {phase: "planned", planComment: result.comment, due: Date.now()});
        } else {
          if (result.status !== "implemented") return this.block(ticket, "implementation-pr-missing");
          if (ticket.staging && !ticket.credentialRecovery) {
            const linkedPR = await this.matchesImplementationPR(github, ticket, session, result.pr);
            if (selectedFinish()?.at !== selectedAt) return "recovery-pending" as const;
            if (!linkedPR) return this.ticket(ticket, {});
          } else if (!this.sessionHasPR(session, result.pr)) {
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
    // The PR phase records the PR named by the authenticated implementation completion.
    const relation = !ticket || (dispatch?.state === "started" && dispatch.schedule === this.env.IMPLEMENT_SCHEDULE_ID &&
      !!session && session.id === dispatch.session && session.agent_kind === "codex" && session.github_access === "push" &&
      this.implementationLink(pr, ticket, session) && this.sessionHasPR(session, number));
    if (pr.merged === true) {
      if (!ticket) return;
      if (!relation || (ticket.staging && this.env.DELIVERY_TARGET !== "staging") || !sha(pr.merge_commit_sha) || String(record(record(pr.base).repo).id) !== this.env.REPO_ID ||
          String(record(record(pr.head).repo).id) !== this.env.REPO_ID) {
        return this.block(ticket, "merged-pr-provenance");
      }
      const mergedAt = Date.parse(String(pr.merged_at));
      if (!Number.isFinite(mergedAt)) return this.block(ticket, "merge-timestamp");
      const target = this.env.DELIVERY_TARGET ?? "production";
      if (target !== "production" && target !== "staging") throw new Error("Invalid Delivery target");
      if (ticket.phase === "pr") this.ticket(ticket, {phase: "release", merge: pr.merge_commit_sha, mergedAt,
        reason: `awaiting-${target}-smoke`});
      const verified = await this.verifyDeployment(ticket, github, pr.merge_commit_sha, target);
      if (!verified) {
        if (ticket.phase !== "blocked" && await github.mainAdvancedPast(pr.merge_commit_sha)) {
          const release = this.tickets("issue=?", ticket.issue)[0];
          // Establish a durable check even if Delivery's webhook preceded this transition.
          this.block({...release, productionVerification: release.productionVerification ?? crypto.randomUUID()},
            target === "staging" ? STAGING_SUPERSEDED : PRODUCTION_SUPERSEDED, true);
        }
        if (verified === undefined) {
          const current = this.tickets("issue=?", ticket.issue)[0];
          if (current.productionVerification === ticket.productionVerification) this.ticket(current, {});
          return "pending" as const;
        }
        return;
      }
      const release = {...ticket, merge: pr.merge_commit_sha, mergedAt, productionVerification: undefined, productionHistory: undefined, stagingHistory: undefined};
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
      } else if (ticket.staging) {
        if (!await this.matchesStaging(ticket, issue, true)) {
          return this.block(release, "release-issue-evidence-changed", true);
        }
      } else if (hasStagingClassification(issue) || issue.number !== ticket.issue || issue.pull_request || String(record(issue.user).id) !== this.env.GITHUB_DISCOVERY_BOT_ID) {
        return this.block(ticket, "release-issue-identity");
      }
      if (issue.state !== "closed") await github.api(`/issues/${ticket.issue}`, "PATCH", {state: "closed", state_reason: "completed"});
      this.ctx.storage.transactionSync(() => {
        this.ticket(ticket, {phase: "closed", merge: pr.merge_commit_sha as string, mergedAt, productionVerification: undefined, productionHistory: undefined, stagingHistory: undefined});
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
    const matchesIssue = () => ticket?.staging ? this.matchesDispatchEvidence(github, ticket, "implement") : true;
    const matches = relation && await matchesIssue() && await gate(github, fctl, this.env, pr, number, !!ticket) && await github.hasNoClosingIssues(number);
    await github.setGate(currentHead, `factory-pr-${number}`, matches);
    if (!matches) return;
    const latest = record(await github.api(`/pulls/${number}`));
    if (record(latest.head).sha !== currentHead || latest.state !== "open" || latest.draft !== false ||
        latest.mergeable !== true || latest.merge_commit_sha !== pr.merge_commit_sha ||
        record(latest.base).ref !== "main" || record(latest.base).sha !== record(pr.base).sha ||
        record(record(latest.base).repo).id !== record(record(pr.base).repo).id ||
        record(record(latest.head).repo).id !== record(record(pr.head).repo).id ||
        record(latest.head).ref !== record(pr.head).ref || latest.body !== pr.body || !await github.hasNoClosingIssues(number) || !await matchesIssue()) {
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
