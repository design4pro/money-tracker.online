import {identifier, integer, list, record} from "./contracts";
import type {Env, Json} from "./contracts";
import {ProviderError} from "./providers";
import type {Fctl} from "./providers";

export type Dispatch = {
  key: string; schedule: string; context: string; access: "triage" | "push" | "read";
  state: "queued" | "posting" | "started" | "blocked"; attempts: number; due: number;
  reportAt?: number;
  since?: number; run?: string; session?: string; reason?: string;
};

export function matchingRun(run: Json, schedule: string, account: string): boolean {
  return run.schedule_id === schedule && identifier(run.id, "srn") && run.outcome === "started" &&
    run.trigger === "token" && record(run.by).id === account && identifier(record(run.session).id, "ses");
}

export async function advanceDispatch(
  fctl: Fctl, env: Env, dispatch: Dispatch, save: (value: Dispatch) => void, verify?: () => Promise<boolean>,
): Promise<Dispatch> {
  const now = Date.now();
  const ops = dispatch.access === "read";
  const update = (changes: Partial<Dispatch>) => {
    const next = {...dispatch, ...changes};
    save(next);
    return next;
  };
  const started = (run: Json) => update({state: "started", run: String(run.id), session: String(record(run.session).id)});
  if (dispatch.due > now || dispatch.state === "started" || dispatch.state === "blocked") return dispatch;
  if (!identifier(dispatch.schedule, "sch") || !identifier(env.FCTL_ACCOUNT_ID, "usr") ||
      !identifier(env.FCTL_PROJECT_ID, "prj") || !identifier(env.FCTL_WORKSPACE_ID, "wsp")) {
    return update({state: "blocked", reason: "dispatch-identity"});
  }

  if (dispatch.state === "posting") {
    // The endpoint creates a session before it records the run. A missing run is ambiguous.
    let cursor: number | undefined;
    const matches: Json[] = [];
    for (let page = 0; page < 5; page++) {
      const response = await fctl.runs(dispatch.schedule, cursor, ops);
      for (const run of list(response.runs).map(record)) {
        if (!matchingRun(run, dispatch.schedule, env.FCTL_ACCOUNT_ID) || Number(run.at) < (dispatch.since ?? now) - 10_000) continue;
        const id = String(record(run.session).id);
        const session = await fctl.session(id, dispatch.schedule, ops);
        if (session.id === id && session.github_access === dispatch.access &&
            await fctl.initialContext(id, dispatch.context, ops)) matches.push(run);
      }
      if (!integer(response.next_before) || response.next_before < (dispatch.since ?? now) - 10_000) break;
      if (page === 4) return update({state: "blocked", reason: "run-history-incomplete"});
      cursor = response.next_before;
    }
    if (matches.length === 1) return started(matches[0]);
    if (matches.length > 1 || now - (dispatch.since ?? now) > 15 * 60_000) {
      return update({state: "blocked", reason: matches.length > 1 ? "multiple-dispatch-matches" : "dispatch-unresolved"});
    }
    return update({due: now + 60_000});
  }

  const schedule = record(await fctl.api(`/schedules/${dispatch.schedule}`, undefined, ops));
  if (schedule.id !== dispatch.schedule || schedule.project_id !== env.FCTL_PROJECT_ID ||
      schedule.event || schedule.cron || schedule.at || schedule.agent_kind !== "codex" ||
      schedule.github_access !== dispatch.access || schedule.base_branch !== "main") {
    return update({state: "blocked", reason: "schedule-contract"});
  }
  if (schedule.enabled !== true) return update({due: now + 5 * 60_000, reason: "schedule-paused"});
  if (verify && !await verify()) return update({state: "blocked", reason: "issue-evidence-changed"});
  dispatch = update({state: "posting", since: now, due: now + 30_000, attempts: dispatch.attempts + 1});
  try {
    const run = record(await fctl.api(`/schedules/${dispatch.schedule}/runs`, {context: dispatch.context}, ops));
    if (matchingRun(run, dispatch.schedule, env.FCTL_ACCOUNT_ID)) return started(run);
  } catch (error) {
    // fctl 0.39.0 returns 429 for the schedule limit before starting a session.
    if (error instanceof ProviderError && error.scheduleRateLimit) {
      return update({state: "queued", due: now + 600_000});
    }
    if (error instanceof ProviderError && [400, 401, 403, 404, 409, 422].includes(error.status)) {
      // Keep the claim and reconcile. An intermediary can also return these codes.
      return update({reason: `post-http-${error.status}`});
    }
  }
  return dispatch;
}
