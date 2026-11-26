import {identifier, record} from "./contracts";
import type {Env} from "./contracts";
import type {Fctl} from "./providers";

export const RETRO_CRON = "0 9 * * 5";
export const RETRO_OBJECT = "weekly-retro";
const WEEK = 7 * 24 * 60 * 60_000;
const FIRST_FRIDAY = Date.UTC(2020, 0, 3, 9);
const PAGE_SIZE = 20;
const MAX_PAGES = 3;
const MAX_ENTRIES = 24;

const technicalTopics: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(uncompressed|gzip)\b.*\b(worker|limit|upload)\b|\b(worker|limit|upload)\b.*\b(uncompressed|gzip)\b/i,
    "Compare the uncompressed Worker upload against the size limit"],
  [/\b(gitguardian|secret scan)\b.*\b(commit|history)\b/i, "Credential scans can include earlier PR commits"],
  [/\b(d1|sqlite)\b/i, "D1 schema and migration verification"],
  [/\b(smoke|playwright|chromium)\b/i, "Browser and Worker smoke coverage"],
  [/\b(cutover|rollback|dry.run|wrangler)\b/i, "Deployment, cutover and rollback verification"],
  [/\b(approval|merge.gate|protected main)\b/i, "Exact-head review and branch protection"],
  [/\b(gitguardian|secret scan)\b/i, "Credential scanning across commit history"],
  [/\b(miniflare|fixture|emulator)\b/i, "Synthetic fixture and emulator compatibility"],
  [/\b(cache|access policy|cms preview)\b/i, "Cache and CMS access boundaries"],
  [/\b(queue|idempotent|backoff|retry)\b/i, "Queue retries and idempotency"],
  [/\b(polar|entitlement)\b/i, "Entitlement refresh and reconciliation"],
  [/\b(cron|schedule|retrospectives?)\b/i, "Scheduled automation and operational evidence"],
];

export function activeRetroSchedule(env: Env): string | undefined {
  const id = env.RETRO_SCHEDULE_ID;
  if (env.RETRO_ENABLED === "true" && id && identifier(id, "sch") && env.FCTL_OPS_TOKEN &&
      identifier(env.FCTL_PROJECT_ID, "prj")) return id;
}

export function weeklyEnd(at: number): number {
  return FIRST_FRIDAY + Math.floor((at - FIRST_FRIDAY) / WEEK) * WEEK;
}

export async function weeklyReport(fctl: Fctl, project: string, until: number) {
  const since = until - WEEK;
  const entries: {outcome: string; insights: string[]}[] = [];
  const report = (sampleLimited: boolean) => ({
    since: new Date(since).toISOString(),
    until: new Date(until).toISOString(),
    sampleLimited,
    entries,
  });
  let before = "";
  const seen = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const response = record(await fctl.api(
      `/projects/${project}/retrospectives?limit=${PAGE_SIZE}${before ? `&before=${before}` : ""}`,
      undefined,
      true,
    ));
    if (!Array.isArray(response.retrospectives) || response.retrospectives.length > PAGE_SIZE) {
      throw new Error("Invalid retrospective page");
    }
    let pastWindow = false;
    for (const value of response.retrospectives) {
      const row = record(value);
      if (row.project_id !== project || typeof row.created_at !== "number" ||
          !Number.isSafeInteger(row.created_at)) continue;
      if (row.created_at < since) {
        pastWindow = true;
        continue;
      }
      if (row.created_at >= until || typeof row.outcome !== "string" ||
          !["completed", "partial", "blocked"].includes(row.outcome) ||
          typeof row.id !== "string" || !identifier(row.id, "rtr") || seen.has(row.id)) continue;
      if (entries.length === MAX_ENTRIES) return report(true);
      seen.add(row.id);
      // Project retro text is untrusted and may contain secrets, personal
      // records or instructions. Forward only fixed technical topic labels.
      const text = typeof row.insights === "string" ? row.insights.slice(0, 4000) : "";
      const insights = technicalTopics.filter(([pattern]) => pattern.test(text)).slice(0, 3).map(([, topic]) => topic);
      entries.push({outcome: row.outcome, insights});
    }
    if (pastWindow || response.next_before === null || response.next_before === undefined) return report(false);
    if (typeof response.next_before !== "string" || !identifier(response.next_before, "rtr") ||
        (before && response.next_before >= before)) throw new Error("Invalid retrospective cursor");
    before = response.next_before;
  }
  return report(true);
}
