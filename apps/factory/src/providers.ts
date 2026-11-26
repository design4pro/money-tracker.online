import {fctlRepo, identifier, integer, list, record, sha} from "./contracts";
import type {Env, Json} from "./contracts";
import {base64, bytes} from "./signatures";

export class ProviderError extends Error {
  constructor(public readonly status: number, public readonly scheduleRateLimit = false) {
    super("Provider request failed");
  }
}

export async function request(url: URL, headers: HeadersInit, method = "GET", payload?: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method, headers, redirect: "manual", signal: AbortSignal.timeout(12_000),
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  if (!response.ok) {
    let scheduleRateLimit = false;
    if (response.status === 429 && response.headers.get("Retry-After") === "600") {
      const error = record(await response.json().catch(() => undefined));
      scheduleRateLimit = error.code === "rate_limited" && typeof error.message === "string" &&
        error.message.startsWith("People and tools ran this schedule ");
    }
    throw new ProviderError(response.status, scheduleRateLimit);
  }
  if (response.status === 204) return undefined;
  return response.json();
}

export class Fctl {
  constructor(private readonly env: Env) {}

  api(path: string, payload?: unknown, ops = false): Promise<unknown> {
    const base = new URL(this.env.FCTL_SERVER);
    if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/" || base.search || base.hash) {
      throw new Error("Invalid fctl origin");
    }
    const token = ops ? this.env.FCTL_OPS_TOKEN : this.env.FCTL_TOKEN;
    if (!token) throw new Error("Missing fctl token");
    const headers = new Headers({Authorization: `Bearer ${token}`, "Content-Type": "application/json"});
    const {FCTL_ACCESS_CLIENT_ID: id, FCTL_ACCESS_CLIENT_SECRET: secret} = this.env;
    if (id && secret) {
      headers.set("CF-Access-Client-Id", id);
      headers.set("CF-Access-Client-Secret", secret);
    } else if (id || secret) {
      throw new Error("Incomplete Access configuration");
    }
    return request(new URL(`/api/v1${path}`, base), headers, payload === undefined ? "GET" : "POST", payload);
  }

  async runs(schedule: string, before?: number, ops = false): Promise<Json> {
    return record(await this.api(`/schedules/${schedule}/runs?limit=100${before ? `&before=${before}` : ""}`, undefined, ops));
  }

  async session(id: string, schedule: string, ops = false): Promise<Json> {
    if (!identifier(id, "ses")) return {};
    const session = record(await this.api(`/sessions/${id}`, undefined, ops));
    if (session.id === id && session.project_id === this.env.FCTL_PROJECT_ID &&
        record(session.workspace).id === this.env.FCTL_WORKSPACE_ID && record(session.schedule).id === schedule) return session;
    return {};
  }

  async initialContext(session: string, context: string, ops: boolean): Promise<boolean> {
    const events = list(record(await this.api(`/sessions/${session}/events?limit=30`, undefined, ops)).events).map(record);
    const first = events.find(event => event.kind === "user_message");
    const message = record(first?.data).text;
    return typeof message === "string" && message.endsWith(`<context>\n${context}\n</context>`);
  }

  async currentReview(pr: number, head: string): Promise<Json> {
    const page = record(await this.api(`/projects/${this.env.FCTL_PROJECT_ID}/reviews?limit=100`));
    return list(page.reviews).map(record).find(review => review.number === pr && review.head_sha === head &&
      fctlRepo(review.repo) === this.env.REPO) ?? {};
  }
}

function base64url(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export class Github {
  private token?: string;

  constructor(private readonly env: Env) {}

  async appToken(): Promise<string> {
    if (this.token) return this.token;
    if (!/^\d+$/.test(this.env.GITHUB_APP_ID) || !/^\d+$/.test(this.env.GITHUB_INSTALLATION_ID) ||
        !/^\d+$/.test(this.env.REPO_ID)) throw new Error("Missing GitHub identity");
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: unknown) => base64url(bytes(JSON.stringify(value)));
    const message = `${encode({alg: "RS256", typ: "JWT"})}.${encode({iat: now - 60, exp: now + 540, iss: this.env.GITHUB_APP_ID})}`;
    const pem = this.env.GITHUB_APP_PRIVATE_KEY?.trim();
    if (!pem?.startsWith("-----BEGIN PRIVATE KEY-----")) throw new Error("Expected a PKCS#8 app key");
    const key = await crypto.subtle.importKey("pkcs8",
      base64(pem.replace(/-----[^-]+-----|\s/g, "")),
      {name: "RSASSA-PKCS1-v1_5", hash: "SHA-256"}, false, ["sign"]);
    const signature = base64url(new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, bytes(message))));
    const result = record(await request(new URL(`https://api.github.com/app/installations/${this.env.GITHUB_INSTALLATION_ID}/access_tokens`),
      githubHeaders(`${message}.${signature}`), "POST", {
        repository_ids: [Number(this.env.REPO_ID)],
        permissions: {
          actions: "read", checks: "write", contents: "write", issues: "write", pull_requests: "read",
        },
      }));
    if (typeof result.token !== "string" || !result.token) throw new Error("Missing installation token");
    this.token = result.token;
    return result.token;
  }

  async api(path: string, method = "GET", payload?: unknown): Promise<unknown> {
    return request(new URL(`https://api.github.com/repos/${this.env.REPO}${path}`), githubHeaders(await this.appToken()), method, payload);
  }

  async pages(path: string): Promise<Json[]> {
    const items: Json[] = [];
    for (let page = 1; page <= 10; page++) {
      const result = list(await this.api(`${path}?per_page=100&page=${page}`)).map(record);
      items.push(...result);
      if (result.length < 100) return items;
    }
    throw new Error("GitHub pagination limit");
  }

  async verifyCheck(head: string): Promise<boolean> {
    const checks = record(await this.api(`/commits/${head}/check-runs?check_name=verify&filter=latest&per_page=100`));
    const candidates = list(checks.check_runs).map(record).filter(check => check.name === "verify" &&
      check.head_sha === head && String(record(check.app).id) === this.env.GITHUB_ACTIONS_APP_ID &&
      record(check.app).slug === "github-actions");
    return typeof checks.total_count === "number" && checks.total_count <= 100 && candidates.length === 1 &&
      candidates[0].status === "completed" && candidates[0].conclusion === "success";
  }

  async verifyPullRequest(number: number, head: string, merge: unknown, base: unknown): Promise<boolean> {
    if (!sha(base) || record(record(await this.api("/git/ref/heads/main")).object).sha !== base) return false;
    if (sha(merge) && await this.verifyCheck(merge)) {
      const parents = list(record(await this.api(`/git/commits/${merge}`)).parents).map(parent => record(parent).sha);
      return parents.length === 2 && parents[0] === base && parents[1] === head;
    }
    // GitHub can associate the verify check with the PR head even when CI checked out the merge ref.
    if (!await this.verifyCheck(head)) return false;
    const runs = record(await this.api(`/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${head}&per_page=100`));
    return list(runs.workflow_runs).map(record).some(run => run.head_sha === head &&
      run.status === "completed" && run.conclusion === "success" &&
      list(run.pull_requests).map(record).some(pr => pr.number === number && record(pr.head).sha === head && record(pr.base).sha === base));
  }

  async fctlReviewCheck(head: string): Promise<boolean> {
    const checks = record(await this.api(`/commits/${head}/check-runs?check_name=fctl%20review&filter=latest&per_page=100`));
    const candidates = list(checks.check_runs).map(record).filter(check => check.name === "fctl review" &&
      check.head_sha === head && String(record(check.app).id) === this.env.GITHUB_REVIEW_APP_ID);
    return typeof checks.total_count === "number" && checks.total_count <= 100 && candidates.length === 1 &&
      candidates[0].status === "completed" && candidates[0].conclusion === "success";
  }

  async hasNoClosingIssues(number: number): Promise<boolean> {
    const [owner, name] = this.env.REPO.split("/");
    const response = record(await request(new URL("https://api.github.com/graphql"), githubHeaders(await this.appToken()), "POST", {
      query: `query($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) { pullRequest(number: $number) {
          closingIssuesReferences(first: 1) { totalCount }
        } }
      }`,
      variables: {owner, name, number},
    }));
    const pr = record(record(record(response.data).repository).pullRequest);
    return !response.errors && record(pr.closingIssuesReferences).totalCount === 0;
  }

  async setGate(head: string, externalId: string, success: boolean): Promise<void> {
    const checks = record(await this.api(`/commits/${head}/check-runs?check_name=factory%2Fmerge-gate&filter=latest&per_page=100`));
    if (typeof checks.total_count !== "number" || checks.total_count > 100) throw new Error("Incomplete gate checks");
    const own = list(checks.check_runs).map(record).find(check => check.name === "factory/merge-gate" &&
      check.head_sha === head && String(record(check.app).id) === this.env.GITHUB_APP_ID);
    const conclusion = success ? "success" : "failure";
    if (own?.conclusion === conclusion && own.external_id === externalId) return;
    const output = {title: "Factory merge gate", summary: success ? "Required evidence verified." : "Required evidence is incomplete."};
    if (own && integer(own.id)) {
      await this.api(`/check-runs/${own.id}`, "PATCH", {status: "completed", conclusion, external_id: externalId, output});
    } else {
      await this.api("/check-runs", "POST", {
        name: "factory/merge-gate", head_sha: head, external_id: externalId, status: "completed", conclusion, output,
      });
    }
  }

  async mainAdvancedPast(commit: string): Promise<boolean> {
    const main = record(record(await this.api("/git/ref/heads/main")).object).sha;
    if (!sha(main) || main === commit) return false;
    const comparison = record(await this.api(`/compare/${commit}...${main}?per_page=1`));
    return comparison.status === "ahead" && record(comparison.merge_base_commit).sha === commit;
  }

  async productionDeploys(head: string): Promise<Json[]> {
    if (!sha(head)) return [];
    const responses = await Promise.all(["workflow_run", "workflow_dispatch", "push"].map(event =>
      this.api(`/actions/workflows/delivery.yml/runs?branch=main&event=${event}&head_sha=${head}&per_page=30`)));
    // GitHub allows the original attempt and up to 50 reruns.
    return responses.flatMap(response => list(record(response).workflow_runs).map(record)).filter(run =>
      integer(run.id) && integer(run.run_attempt) && run.run_attempt <= 51 && run.head_sha === head &&
      run.head_branch === "main" && ["workflow_run", "workflow_dispatch", "push"].includes(String(run.event)) &&
      run.path === ".github/workflows/delivery.yml" && String(record(run.repository).id) === this.env.REPO_ID &&
      String(record(run.head_repository).id) === this.env.REPO_ID);
  }
}

function githubHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "money-tracker-factory",
    "Content-Type": "application/json",
  };
}
