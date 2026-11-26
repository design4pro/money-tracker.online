import assert from "node:assert/strict";
import {createHmac, generateKeyPairSync} from "node:crypto";
import {after, before, test} from "node:test";
import {build} from "esbuild";
import {sendAlert} from "../../../scripts/monitor.mjs";
import {Miniflare} from "miniflare";

const repo = "design4pro/money-tracker.online";
const head = "a".repeat(40);
const otherHead = "b".repeat(40);
const merge = "c".repeat(40);
const base = "d".repeat(40);
const candidate = "e".repeat(40);
const upstream = "2aae986ff5ad1da1dd8d967498b3b32d6ded413d";
const key = Buffer.from("synthetic webhook key for replay tests");
const discovery = {type: "Bot", id: 33, login: "factory-test[bot]"};
const ref = {owner: "design4pro", name: "money-tracker.online"};
const env = {
  REPO: repo, REPO_ID: "100", FCTL_SERVER: "https://synthetic-fctl.invalid",
  FCTL_WORKSPACE_ID: "wsp_Mock", FCTL_PROJECT_ID: "prj_Mock", FCTL_ACCOUNT_ID: "usr_Mock",
  TRIAGE_SCHEDULE_ID: "sch_Triage", PLAN_SCHEDULE_ID: "sch_Plan", IMPLEMENT_SCHEDULE_ID: "sch_Implement",
  OPS_SCHEDULE_ID: "sch_Ops", FCTL_WEBHOOK_SECRET: `whsec_${key.toString("base64")}`, FCTL_TOKEN: "fake-pat",
  FCTL_OPS_TOKEN: "fake-read-pat", GITHUB_WEBHOOK_SECRET: "fake-webhook-key", OPS_TOKEN: "fake-monitor-key",
  GITHUB_APP_ID: "55", GITHUB_INSTALLATION_ID: "66", GITHUB_DISCOVERY_BOT_ID: "33", GITHUB_TRIAGE_BOT_ID: "33",
  GITHUB_ACTIONS_APP_ID: "77", GITHUB_REVIEW_APP_ID: "88", MERGE_ENABLED: "true", DELIVERY_SMOKE_STEP: "Production smoke",
};
env.GITHUB_APP_PRIVATE_KEY = generateKeyPairSync("rsa", {modulusLength: 2048}).privateKey.export({type: "pkcs8", format: "pem"});

let mf;
let serial = 0;
const calls = {plan: 0, implement: 0, ops: 0, merges: [], closed: [], gates: []};
const runs = {sch_Triage: [], sch_Plan: [], sch_Implement: [], sch_Ops: []};
const contexts = new Map();
let native = false;
let implemented = false;
let changedHead = false;
let readPr = 0;
let revision = head;
let candidateBase = base;
let conclusion = "neutral";
let smoke = "failure";

function issue(number) {
  return {number, user: discovery, state: "open", labels: [{name: "factory:parity"}],
    body: `<!-- factory:parity v1 feature_id=feature-${number} upstream=v0.34.3@${upstream} deployed=${head} -->`};
}

function session(id, schedule, access) {
  return {id, project_id: env.FCTL_PROJECT_ID, workspace: {id: env.FCTL_WORKSPACE_ID}, schedule: {id: schedule},
    agent_kind: "codex", github_access: access, created_at: Date.now() - 10_000, branch: "codex/pilot",
    pull_requests: access === "push" ? [{repo: ref, number: 23, checks: {sha: revision,
      review: {state: "passed", project_id: env.FCTL_PROJECT_ID, findings: 0, still_open: 0, session_id: "ses_Review"}}}] : []};
}

async function provider(req) {
  const {pathname, searchParams, hostname} = new URL(req.url);
  const body = req.body ? await req.json() : undefined;
  const method = req.method;
  const json = value => Response.json(value);
  if (hostname === "synthetic-fctl.invalid") {
    const path = pathname.replace("/api/v1", "");
    const [, noun, id, part] = path.split("/");
    if (noun === "schedules") {
      const access = {sch_Plan: "triage", sch_Implement: "push", sch_Ops: "read"}[id];
      if (!part) return json({id, project_id: env.FCTL_PROJECT_ID, agent_kind: "codex", github_access: access, base_branch: "main", enabled: true});
      if (method === "GET") return json({runs: id === "sch_Triage" && !native ? [] : runs[id]});
      const sessionId = {sch_Plan: "ses_Plan", sch_Implement: "ses_Implement", sch_Ops: "ses_Ops"}[id];
      const run = {id: `srn_${sessionId.slice(4)}`, schedule_id: id, outcome: "started", trigger: "token",
        by: {id: env.FCTL_ACCOUNT_ID}, session: {id: sessionId}, at: Date.now()};
      runs[id].unshift(run);
      contexts.set(sessionId, body.context);
      if (id === "sch_Plan") {
        calls.plan++;
        return new Response(null, {status: 502});
      }
      if (id === "sch_Implement") calls.implement++;
      if (id === "sch_Ops") {
        assert.equal(req.headers.get("authorization"), "Bearer fake-read-pat");
        calls.ops++;
      }
      return json(run);
    }
    if (noun === "sessions") {
      if (part === "events") return json({events: [{kind: "user_message", data: {
        text: `Task\n<context>\n${contexts.get(id)}\n</context>`,
      }}]});
      if (id.startsWith("ses_Triage")) return json(session(id, "sch_Triage", "triage"));
      if (id === "ses_Plan") return json(session(id, "sch_Plan", "triage"));
      if (id === "ses_Implement") return json(session(id, "sch_Implement", "push"));
    }
    if (noun === "projects" && part === "reviews") return json({reviews: [{repo: ref, number: 23, head_sha: revision,
      state: "passed", findings: 0, still_open: 0, session_id: "ses_Review", opened_by: {id: "ses_Implement"}}]});
  }
  if (hostname === "api.github.com") {
    if (pathname === "/app/installations/66/access_tokens") {
      assert.deepEqual(body.repository_ids, [100]);
      return json({token: "fake-installation-token"});
    }
    if (pathname === "/graphql") return json({data: {repository: {pullRequest: {closingIssuesReferences: {totalCount: 0}}}}});
    const path = pathname.replace(`/repos/${repo}`, "");
    if (/^\/issues\/\d+$/.test(path)) {
      if (method === "PATCH") calls.closed.push(path);
      return json(issue(Number(path.split("/").at(-1))));
    }
    if (path.startsWith("/issues/comments/")) {
      const id = Number(path.split("/").at(-1));
      const stage = id === 101 ? "plan" : "triage";
      return json({id, user: discovery, issue_url: `https://api.github.com/repos/${repo}/issues/${id === 102 ? 2 : 1}`,
        body: `<!-- factory:${stage} v1 -->\nEvidence`});
    }
    if (path === "/pulls/23") {
      const next = changedHead && ++readPr === 2 ? otherHead : revision;
      return json({number: 23, state: implemented ? "closed" : "open", merged: implemented,
        merge_commit_sha: implemented ? merge : candidate,
        ...(implemented ? {merged_at: new Date().toISOString()} : {}),
        draft: false, mergeable: true, base: {ref: "main", sha: base, repo: {id: 100}},
        head: {sha: next, ref: "codex/pilot", repo: {id: 100}}, changed_files: 1,
        body: "<!-- factory:implementation v1 issue=1 session=ses_Implement -->"});
    }
    if (path === "/pulls/23/files") return json([{filename: "apps/app/src/ui/view.css", status: "modified"}]);
    if (path === "/pulls/23/merge") {
      calls.merges.push(body.sha);
      implemented = true;
      return json({merged: true, sha: merge});
    }
    if (path === "/git/ref/heads/main") return json({object: {sha: base}});
    if (path === `/git/commits/${candidate}`) return json({parents: [{sha: candidateBase}, {sha: revision}]});
    if (path === "/check-runs") {
      calls.gates.push(body);
      return json({id: calls.gates.length});
    }
    if (path.endsWith("/check-runs")) {
      const sha = path.split("/")[2];
      const name = searchParams.get("check_name");
      const projected = {
        verify: sha === candidate ? [{name, head_sha: sha, app: {id: 77, slug: "github-actions"}, status: "completed", conclusion: "success"}] : [],
        "fctl review": [{name, head_sha: sha, app: {id: 88}, status: "completed", conclusion}],
      }[name] ?? [];
      return json({total_count: projected.length, check_runs: projected});
    }
    if (path.startsWith("/actions/workflows/")) return json({workflow_runs: [
      ...(implemented && searchParams.get("event") === "workflow_dispatch" ? [{id: 2, run_attempt: 1, head_sha: merge}] : []),
      ...(searchParams.get("event") === "push" ? [{id: 1, run_attempt: 1, head_sha: head}] : []),
    ].map(run => ({...run, head_branch: "main", event: searchParams.get("event"), status: "completed",
      conclusion: "success", path: ".github/workflows/delivery.yml", repository: {id: 100}, head_repository: {id: 100}}))});
    if (path.startsWith("/actions/runs/")) {
      const prior = path.includes("/runs/1/");
      return json({total_count: 1, jobs: [{name: "deploy-production", head_sha: prior ? head : merge, conclusion: "success",
        steps: [{name: "Production smoke", conclusion: prior ? "success" : smoke}]}]});
    }
    if (path.startsWith("/compare/")) return json({status: "diverged"});
  }
  throw new Error(`Unexpected provider route ${method} ${pathname}`);
}

before(async () => {
  const bundled = await build({stdin: {
    contents: `
      import worker, {Factory as Controller} from "./src/index.ts";
      export default worker;
      export class Factory extends Controller {
        async fetch(request) {
          if (new URL(request.url).pathname === "/test/tick") {
            this.ctx.storage.sql.exec("UPDATE ticket SET due=0");
            this.ctx.storage.sql.exec("UPDATE dispatch SET due=0, payload=json_set(payload, '$.due', 0)");
            await this.alarm();
            return new Response(null, {status: 204});
          }
          return super.fetch(request);
        }
      }
    `, resolveDir: process.cwd(), loader: "ts",
  }, bundle: true, write: false, format: "esm", external: ["cloudflare:workers"]});
  mf = new Miniflare({compatibilityDate: "2026-07-30", modules: true, script: bundled.outputFiles[0].text,
    durableObjects: {FACTORY: {className: "Factory", useSQLite: true}}, bindings: env, outboundService: provider});
});

after(async () => mf?.dispose());

const call = (path, init) => mf.dispatchFetch(`https://factory.invalid${path}`, init);
const tick = async () => assert.equal((await call("/test/tick")).status, 204);
const status = async () => (await call("/ops/status", {headers: {authorization: "Bearer fake-monitor-key"}})).json();

function github(payload, delivery, signature) {
  const body = JSON.stringify({repository: {full_name: repo, id: 100}, ...payload});
  return call("/webhooks/github", {method: "POST", body,
    headers: {"x-github-event": "issues", "x-github-delivery": delivery ?? crypto.randomUUID(),
      "x-hub-signature-256": signature ?? `sha256=${createHmac("sha256", env.GITHUB_WEBHOOK_SECRET).update(body).digest("hex")}`}});
}

function finish(schedule, session, result, age = 0, forged = false) {
  const id = `evt_${++serial}`;
  const timestamp = String(Math.floor(Date.now() / 1000) - age);
  const body = JSON.stringify({id, type: "session.finished", timestamp: new Date(Date.now() + serial * 5).toISOString(),
    project: {id: env.FCTL_PROJECT_ID}, workspace: {id: env.FCTL_WORKSPACE_ID},
    data: {session: {id: session, schedule: {id: schedule}, started_by: "schedule"}, message: JSON.stringify(result)}});
  const signature = createHmac("sha256", forged ? "forged" : key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return call("/webhooks/fctl", {method: "POST", body, headers: {"webhook-id": id, "webhook-timestamp": timestamp,
    "webhook-signature": `v1,${signature}`, "fctl-event": "session.finished"}});
}

const opened = number => ({action: "opened", issue: issue(number), sender: discovery});
const triage = number => ({v: 1, stage: "triage", status: "ready", issue: number, comment: 100 + (number === 1 ? 0 : 2)});

test("signed pilot pipeline survives replays, out-of-order evidence and ambiguous dispatch", async () => {
  assert.equal((await call("/health")).status, 200);
  assert.equal((await call("/ops/status")).status, 401);
  assert.equal((await github(opened(1), "fake", `sha256=${"0".repeat(64)}`)).status, 401);
  assert.equal((await finish("sch_Triage", "ses_Triage1", triage(1), 0, true)).status, 401);
  assert.equal((await finish("sch_Triage", "ses_Triage1", triage(1), 400)).status, 401);
  const outsider = {type: "User", id: 44, login: "outsider"};
  assert.equal((await github({...opened(99), issue: {...issue(99), user: outsider}, sender: outsider})).status, 403);

  assert.equal((await finish("sch_Triage", "ses_Triage1", triage(1))).status, 202);
  assert.equal((await finish("sch_Triage", "ses_Triage2", triage(2))).status, 202);
  await Promise.all([github(opened(1)), github(opened(1), "modified-delivery-id"), github(opened(2))]);
  await tick();
  assert.equal(calls.plan, 0);
  assert.equal((await status()).audit.filter(entry => entry.subject === "1" && entry.action === "issue-observed").length, 1);

  const common = {schedule_id: "sch_Triage", outcome: "started", trigger: "event"};
  const event = number => ({kind: "issue_opened", number, repo: ref, actor: discovery.login, url: `https://github.com/${repo}/issues/${number}`});
  native = true;
  runs.sch_Triage.push({...common, id: "srn_Wrong", session: {id: "ses_Triage1"}, event: event(90)});
  await tick();
  assert.equal(calls.plan, 0);
  for (const n of [1, 2]) runs.sch_Triage.push({...common, id: `srn_Triage${n}`, session: {id: `ses_Triage${n}`}, event: event(n)});
  for (let step = 0; step < 4; step++) await tick();
  assert.equal(calls.plan, 1, JSON.stringify(await status()));
  assert.deepEqual((await status()).slot, [{issue: 1}]);
  assert.equal((await status()).tickets.find(ticket => ticket.issue === 2).phase, "ready");

  await finish("sch_Plan", "ses_Plan", {v: 1, stage: "plan", status: "planned", issue: 1, comment: 101});
  await finish("sch_Implement", "ses_Implement", {v: 1, stage: "implement", status: "implemented", issue: 1, pr: 23});
  for (let step = 0; step < 5; step++) await tick();
  assert.equal(calls.plan, 1, JSON.stringify(await status()));
  assert.equal(calls.implement, 1);
  assert.equal(calls.merges.length, 0);
  assert.equal(calls.gates.at(-1).conclusion, "failure");

  conclusion = "success";
  candidateBase = merge;
  await tick();
  assert.equal(calls.merges.length, 0);
  candidateBase = base;
  changedHead = true;
  await tick();
  assert.equal(calls.merges.length, 0);
  changedHead = false;
  revision = otherHead;
  await tick();
  assert.deepEqual(calls.merges, [otherHead]);
  await tick();
  assert.equal((await status()).tickets.find(ticket => ticket.issue === 1).phase, "release");
  assert.deepEqual(calls.closed, []);
  smoke = "success";
  await tick();
  assert.deepEqual(calls.closed, ["/issues/1"]);
  assert.equal((await status()).tickets.find(ticket => ticket.issue === 1).phase, "closed");

  const url = new URL("https://factory.invalid/ops/alert");
  const send = (url, init) => call(url.pathname, init);
  await assert.rejects(sendAlert(url, {}, "monitor-1", "availability", send), /401/);
  const headers = {Authorization: "Bearer fake-monitor-key"};
  await assert.rejects(sendAlert(url, headers, "monitor-1", "invalid", send), /400/);
  const alert = () => sendAlert(url, headers, "monitor-1", "availability", send);
  await Promise.all([alert(), alert()]);
  await tick();
  await tick();
  assert.equal(calls.ops, 1);
});
