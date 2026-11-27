import {approval, deployed, identifier, integer, list, record, routineFile, sha} from "./contracts";
import type {DeliveryTarget, Env, Json} from "./contracts";
import {ProviderError} from "./providers";
import type {Fctl, Github} from "./providers";

export const UPSTREAM_SHA = "2aae986ff5ad1da1dd8d967498b3b32d6ded413d";

export function issueEvidence(issue: Json): {feature: string; deployed: string} | undefined {
  if (issue.state !== "open" || issue.pull_request || typeof issue.body !== "string" ||
      !list(issue.labels).some(label => record(label).name === "factory:parity")) return;
  const match = /^<!-- factory:parity v1 feature_id=([a-z][a-z0-9-]{2,63}) upstream=v0\.34\.3@(\w{40}) deployed=([0-9a-f]{40}) -->\r?$/m.exec(issue.body);
  if (match?.[2] === UPSTREAM_SHA && issue.body.split("<!-- factory:parity ").length === 2) {
    return {feature: match[1], deployed: match[3]};
  }
}

export interface DeploymentSearch {
  head: string;
  page: number;
  remaining?: {run: number; job: number}[];
  exhausted?: boolean;
}

export async function deployment(github: Github, env: Env, search: DeploymentSearch,
  target: DeliveryTarget = "production"): Promise<boolean | undefined> {
  const {head} = search;
  const deployName = `deploy-${target}`;
  const smokeStep = target === "staging" ? env.DELIVERY_STAGING_SMOKE_STEP : env.DELIVERY_SMOKE_STEP;
  const smokeJob = target === "staging" ? env.DELIVERY_STAGING_SMOKE_JOB : env.DELIVERY_SMOKE_JOB;
  if (!sha(head) || !!smokeStep === !!smokeJob) return false;

  // A pump can check triage, the active release and a superseded release.
  // Allow at most seven evidence requests per ticket and persist its cursor.
  let budget = 7;
  while (search.page <= 10) {
    if (!search.remaining) {
      if (!budget) return;
      budget--;
      const {candidates, exhausted} = await github.deliveryChecks(head, search.page, deployName);
      search.remaining = candidates;
      search.exhausted = exhausted;
    }
    const candidate = search.remaining[0];
    if (!candidate) {
      if (search.exhausted) return false;
      search.page++;
      search.remaining = undefined;
      continue;
    }
    if (budget < 3) return;
    const {run, job: id} = candidate;
    // Authentication errors are shared across candidates, even if GitHub returns 404.
    await github.appToken();
    try {
      budget--;
      const job = record(await github.api(`/actions/jobs/${id}`));
      const attempt = job.run_attempt;
      // GitHub permits 50 reruns in addition to the original attempt.
      if (job.id === id && job.run_id === run && job.name === deployName && job.head_sha === head &&
          job.head_branch === "main" && job.status === "completed" && job.conclusion === "success" &&
          integer(attempt) && attempt <= 51) {
        budget--;
        if (await github.deliveryAttempt(run, attempt, head, target)) {
          budget--;
          if (deployed(await github.api(`/actions/runs/${run}/attempts/${attempt}/jobs?per_page=100`),
            head, deployName, id, run, attempt, smokeStep, smokeJob)) return true;
        }
      }
    } catch (error) {
      if (!(error instanceof ProviderError) || ![404, 410].includes(error.status)) throw error;
    }
    search.remaining.shift();
  }
  return false;
}

export function linked(body: unknown, issue: number, session: string): boolean {
  if (typeof body !== "string" || /\b(?:clos(?:e[sd]?|ing)|fix(?:e[sd]|ing)?|resolv(?:e[sd]?|ing))\s*:?\s+(?:#|https:\/\/github\.com\/|[\w.-]+\/)/i.test(body)) return false;
  return body.split(/\r?\n/).includes(`<!-- factory:implementation v1 issue=${issue} session=${session} -->`);
}

export async function gate(
  github: Github, fctl: Fctl, env: Env, pr: Json, number: number, issued: boolean,
): Promise<boolean> {
  const head = record(pr.head).sha;
  if (!sha(head) || pr.state !== "open" || pr.draft !== false || record(pr.base).ref !== "main" ||
      String(record(record(pr.base).repo).id) !== env.REPO_ID || String(record(record(pr.head).repo).id) !== env.REPO_ID ||
      pr.mergeable !== true) return false;
  if (!await github.verifyPullRequest(number, head, pr.merge_commit_sha, record(pr.base).sha)) return false;
  const review = await fctl.currentReview(number, head);
  if (review.state !== "passed" || review.findings !== 0 || review.still_open !== 0 ||
      !identifier(review.session_id, "ses") || !await github.fctlReviewCheck(head, review.session_id)) return false;

  if (issued) {
    const files = await github.pages(`/pulls/${number}/files`);
    if (integer(pr.changed_files) && files.length === pr.changed_files && files.length > 0 && files.every(file =>
      routineFile(file.filename) && (file.status === "renamed" ? routineFile(file.previous_filename) :
        !file.previous_filename && ["added", "modified", "removed"].includes(String(file.status))))) return true;
  }
  return approval(await github.pages(`/pulls/${number}/reviews`), head, env.HUMAN_REVIEWER_IDS ?? "", record(pr.user).id);
}
