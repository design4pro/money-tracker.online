import {identifier, integer, parseResult, record, sha, trustedHuman} from "./contracts";
import type {Env, Result} from "./contracts";
import {featureSnapshot, maintainerIdentity} from "./intake";
import type {MaintainerIntake} from "./intake";
import {bearer, digest, fctlSignature, githubSignature} from "./signatures";

export type Ingress =
  | {kind: "issue"; issue: number; actor: string; maintainer?: MaintainerIntake}
  | {kind: "finish"; session: string; schedule: string; at: number; result?: Result}
  | {kind: "production"; head: string}
  | {kind: "alert"; key: string; code: string; head?: string}
  | {kind: "wake"};

export interface Delivery {
  id: string;
  event: Ingress;
}

const rejected = (status: number) => new Response(null, {status});

async function readBody(request: Request): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const reader = request.body?.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  if (!reader) return new Uint8Array();
  for (;;) {
    const {value, done} = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 2 * 1024 * 1024) {
      await reader.cancel();
      return;
    }
    parts.push(value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.length;
  }
  return body;
}

export async function ingress(request: Request, env: Env): Promise<Delivery | Response> {
  const path = new URL(request.url).pathname;
  if (request.method !== "POST") return rejected(405);
  const body = await readBody(request);
  if (!body) return rejected(413);
  const headers = request.headers;
  const fctl = path === "/webhooks/fctl";
  const github = path === "/webhooks/github";
  const ops = path === "/ops/alert";
  if (!fctl && !github && !ops) return rejected(404);
  if (github && !await githubSignature(headers, body, env.GITHUB_WEBHOOK_SECRET) ||
      ops && !await bearer(headers, env.OPS_TOKEN)) return rejected(401);

  let payload;
  try {
    payload = record(JSON.parse(new TextDecoder("utf-8", {fatal: true, ignoreBOM: false}).decode(body)));
  } catch {
    return rejected(400);
  }

  if (fctl) {
    // fctl verifies ownership before it generates the signing secret.
    if (payload.type === "url_verification" && typeof payload.challenge === "string" &&
        /^[A-Za-z0-9_-]{16,256}$/.test(payload.challenge)) return new Response(payload.challenge);
    if (!await fctlSignature(headers, body, env.FCTL_WEBHOOK_SECRET)) return rejected(401);
    if (!identifier(payload.id, "evt") || payload.id !== headers.get("webhook-id") ||
        payload.type !== headers.get("fctl-event") ||
        record(payload.project).id !== env.FCTL_PROJECT_ID || record(payload.workspace).id !== env.FCTL_WORKSPACE_ID ||
        !identifier(env.FCTL_PROJECT_ID, "prj") || !identifier(env.FCTL_WORKSPACE_ID, "wsp")) return rejected(403);
    if (payload.test === true) return rejected(204);
    const data = record(payload.data);
    const session = record(data.session);
    const schedule = record(session.schedule).id;
    const at = Date.parse(String(payload.timestamp));
    if (["session.finished", "session.failed", "session.stopped", "session.question"].includes(String(payload.type)) &&
        identifier(session.id, "ses") && identifier(schedule, "sch") && session.started_by === "schedule" &&
        [env.TRIAGE_SCHEDULE_ID, env.MAINTAINER_TRIAGE_SCHEDULE_ID, env.PLAN_SCHEDULE_ID, env.IMPLEMENT_SCHEDULE_ID].includes(schedule) && Number.isFinite(at)) {
      return {id: `fctl:${payload.id}`, event: {kind: "finish", session: session.id, schedule, at,
        result: payload.type === "session.finished" ? parseResult(data.message) : undefined}};
    }
    return {id: `fctl:${payload.id}`, event: {kind: "wake"}};
  }

  if (ops) {
    const {key, code, head} = payload;
    if (typeof key !== "string" || !/^[A-Za-z0-9_.:-]{1,96}$/.test(key) ||
        typeof code !== "string" || !["deploy-failed", "smoke-failed", "availability", "pipeline-stalled"].includes(code) ||
        head !== undefined && !sha(head)) return rejected(400);
    return {id: `ops:${key}`, event: {kind: "alert", key, code, head}};
  }

  const repo = record(payload.repository);
  if (repo.full_name !== env.REPO || !integer(repo.id) || String(repo.id) !== env.REPO_ID) return rejected(403);
  // GitHub signs the body but excludes its delivery ID and event name.
  const id = `github:${await digest(body)}`;
  const type = headers.get("x-github-event");
  if (type === "workflow_run" && payload.action === "completed") {
    const run = record(payload.workflow_run);
    if (run.path === ".github/workflows/delivery.yml" && run.head_branch === "main" &&
        run.conclusion === "success" && sha(run.head_sha)) {
      return {id, event: {kind: "production", head: run.head_sha}};
    }
  }
  if (type === "issues" && payload.action === "opened" && !payload.pull_request && !payload.comment) {
    const issue = record(payload.issue);
    const author = record(issue.user);
    const sender = record(payload.sender);
    if (!integer(issue.number) || issue.pull_request) return rejected(403);
    if (trustedHuman(author, env.HUMAN_REVIEWER_IDS) && sender.type === "User" &&
        sender.id === author.id && sender.login === author.login &&
        maintainerIdentity(issue, env, issue.number, author.id)) {
      const snapshot = await featureSnapshot(issue);
      if (snapshot) return {id, event: {kind: "issue", issue: issue.number, actor: author.login,
        maintainer: {id: author.id, snapshot}}};
    }
    if (author.type !== "Bot" || !integer(author.id) ||
        String(author.id) !== env.GITHUB_DISCOVERY_BOT_ID || sender.id !== author.id ||
        typeof author.login !== "string" || !/^[a-zA-Z0-9_-]+\[bot\]$/.test(author.login)) return rejected(403);
    if (!Array.isArray(issue.labels) || !issue.labels.some(label => record(label).name === "factory:parity")) return rejected(403);
    return {id, event: {kind: "issue", issue: issue.number, actor: author.login}};
  }
  return {id, event: {kind: "wake"}};
}
