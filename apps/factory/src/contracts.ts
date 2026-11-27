import type {Factory} from "./index";

export interface Env {
  FACTORY: DurableObjectNamespace<Factory>;
  REPO: string;
  REPO_ID: string;
  FCTL_SERVER: string;
  FCTL_WORKSPACE_ID: string;
  FCTL_PROJECT_ID: string;
  FCTL_TOKEN: string;
  FCTL_REVIEW_PROJECT_ID?: string;
  FCTL_REVIEW_TOKEN?: string;
  FCTL_OPS_TOKEN: string;
  FCTL_WEBHOOK_SECRET: string;
  FCTL_ACCOUNT_ID: string;
  FCTL_ACCESS_CLIENT_ID?: string;
  FCTL_ACCESS_CLIENT_SECRET?: string;
  TRIAGE_SCHEDULE_ID: string;
  MAINTAINER_TRIAGE_SCHEDULE_ID?: string;
  PLAN_SCHEDULE_ID: string;
  IMPLEMENT_SCHEDULE_ID: string;
  OPS_SCHEDULE_ID: string;
  RETRO_SCHEDULE_ID?: string;
  RETRO_ENABLED?: string;
  GITHUB_WEBHOOK_SECRET: string;
  GITHUB_APP_ID: string;
  GITHUB_INSTALLATION_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  GITHUB_DISCOVERY_BOT_ID: string;
  GITHUB_TRIAGE_BOT_ID: string;
  GITHUB_ACTIONS_APP_ID: string;
  GITHUB_REVIEW_APP_ID: string;
  HUMAN_REVIEWER_IDS?: string;
  BOOTSTRAP_PRS?: string;
  SOURCE_SHA?: string;
  DELIVERY_TARGET?: string;
  DELIVERY_STAGING_SMOKE_STEP?: string;
  DELIVERY_STAGING_SMOKE_JOB?: string;
  DELIVERY_SMOKE_STEP?: string;
  DELIVERY_SMOKE_JOB?: string;
  MERGE_ENABLED?: string;
  OPS_TOKEN: string;
}

export type Json = Record<string, unknown>;
export const record = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
export const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export const integer = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
export const sha = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
export const identifier = (value: unknown, prefix: string): value is string =>
  typeof value === "string" && new RegExp(`^${prefix}_[A-Za-z0-9]{1,64}$`).test(value);

export function fctlRepo(value: unknown): string {
  const {owner, name} = record(value);
  return typeof owner === "string" && typeof name === "string" ? `${owner}/${name}` : "";
}

export type Stage = "triage" | "plan" | "implement";
export type Result =
  | {v: 1; stage: Stage; status: "blocked"; issue: number; reason?: "pre-work-evidence-changed"}
  | {v: 1; stage: "triage"; status: "ready"; issue: number; comment: number}
  | {v: 1; stage: "plan"; status: "planned"; issue: number; comment: number}
  | {v: 1; stage: "implement"; status: "implemented"; issue: number; pr: number};

export function trustedHuman(user: Json, ids = ""): user is Json & {id: number; login: string} {
  return user.type === "User" && integer(user.id) && typeof user.login === "string" &&
    /^[a-zA-Z0-9-]{1,39}$/.test(user.login) && ids.split(",").some(id => id.trim() === String(user.id));
}

export function parseResult(message: unknown): Result | undefined {
  if (typeof message !== "string") return;
  const first = message.split("\n", 1)[0];
  if (first.length > 400) return;
  let data: Json;
  try {
    data = record(JSON.parse(first));
  } catch {
    return;
  }
  const {v, stage, status, issue, comment, pr} = data;
  if (v !== 1 || !integer(issue) || (stage !== "triage" && stage !== "plan" && stage !== "implement")) return;
  if (status === "blocked") {
    const reason = stage === "implement" && data.reason === "pre-work-evidence-changed" ? data.reason : undefined;
    return {v, stage, status, issue, reason};
  }
  if (stage === "triage" && status === "ready" && integer(comment)) return {v, stage, status, issue, comment};
  if (stage === "plan" && status === "planned" && integer(comment)) return {v, stage, status, issue, comment};
  if (stage === "implement" && status === "implemented" && integer(pr)) return {v, stage, status, issue, pr};
}

export function nativeRun(value: unknown, schedule: string, session: string, repo: string, issue: number, actor: string): boolean {
  const run = record(value);
  const event = record(run.event);
  return run.schedule_id === schedule && identifier(run.id, "srn") && run.outcome === "started" &&
    run.trigger === "event" && record(run.session).id === session && event.kind === "issue_opened" &&
    event.number === issue && fctlRepo(event.repo) === repo && event.actor === actor &&
    event.url === `https://github.com/${repo}/issues/${issue}`;
}

export function routineFile(path: unknown): boolean {
  if (typeof path !== "string" || !/^[A-Za-z0-9_./-]+$/.test(path) ||
      path.split("/").some(part => part.startsWith(".") || part === "")) return false;
  if (/(auth|account|billing|secret|private|config|policy|rules|data|infra|migrat|token|lock|package|workflow|permission|session|finance|payment)/i.test(path)) return false;
  return /^(apps\/(app|site)\/(src\/)?(ui|components)\/[\w./-]+\.(css|tsx)|apps\/(app|site)\/(src\/)?(locales|messages)\/[a-z]{2}(-[A-Z]{2})?\.json|docs\/[\w./-]+\.md)$/.test(path);
}

export function approval(reviews: unknown[], head: string, ids: string, author: unknown): boolean {
  const allow = new Set(ids.split(",").map(id => id.trim()).filter(id => /^\d+$/.test(id)));
  const latest = new Map<number, Json>();
  for (const value of reviews) {
    const review = record(value);
    const user = record(review.user);
    if (!integer(user.id) || user.id === author || user.type !== "User" || !allow.has(String(user.id))) continue;
    if (!["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(String(review.state))) continue;
    const previous = latest.get(user.id);
    const submitted = Date.parse(String(review.submitted_at));
    const priorTime = Date.parse(String(previous?.submitted_at));
    if (integer(review.id) && Number.isFinite(submitted) &&
        (!previous || submitted > priorTime || submitted === priorTime && Number(previous.id) < review.id)) latest.set(user.id, review);
  }
  return !Array.from(latest.values()).some(r => r.state === "CHANGES_REQUESTED") &&
    Array.from(latest.values()).some(r => r.state === "APPROVED" && r.commit_id === head);
}

export type DeliveryTarget = "production" | "staging";

export function deployed(value: unknown, head: string, deployName: string, id: number, run: number, attempt: number,
  smokeStep?: string, smokeJob?: string): boolean {
  const response = record(value);
  const jobs = list(response.jobs).map(record);
  if (response.total_count !== jobs.length || !!smokeStep === !!smokeJob) return false;
  const successfulJob = (name: string) => {
    const matches = jobs.filter(job => job.name === name);
    const job = matches[0];
    if (matches.length === 1 && job.head_sha === head && job.head_branch === "main" && job.run_id === run &&
        job.run_attempt === attempt && job.status === "completed" && job.conclusion === "success") return job;
  };
  const deploy = successfulJob(deployName);
  if (deploy?.id !== id) return false;
  if (smokeJob) return smokeJob !== deployName && !!successfulJob(smokeJob);
  const steps = list(deploy.steps).map(record).filter(step => step.name === smokeStep);
  return steps.length === 1 && steps[0].conclusion === "success";
}
