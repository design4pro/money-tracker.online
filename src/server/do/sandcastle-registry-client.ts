/**
 * Server-side helpers for talking to the sandcastle run registry.
 *
 * The API route uses these instead of hand-building requests, so the registry's URL scheme lives in
 * one place. The namespace is taken as a narrow structural type: a caller passes
 * `env.SANDCASTLE_REGISTRY`, and a test passes a stub.
 *
 * One object per repository — the repo slug *is* the shard key. That is deliberate and load-bearing
 * rather than incidental: a single object means every claim for a backlog is decided in one thread,
 * which is what makes "who got this issue" unambiguous without any locking of our own.
 *
 * Unlike a typed RPC stub, these return the raw `Response` rather than parsed JSON. The only
 * caller is the API route, which forwards the registry's status verbatim — a 409 for an unknown run
 * has to reach the agent loop as a 409, not as a thrown `Error` that flattens every failure into
 * one shape.
 */

import type {
  ClaimInput,
  FinishInput,
  HeartbeatInput,
  RecordWipInput,
  RegisterRunInput,
  ReleaseInput,
} from './sandcastle-protocol'

export interface SandcastleRegistryStub {
  fetch: (request: Request) => Promise<Response>
}

export interface SandcastleRegistryNamespace {
  idFromName: (name: string) => DurableObjectId
  get: (id: DurableObjectId) => SandcastleRegistryStub
}

/**
 * Internal origin. Durable Object requests never leave the Cloudflare network, but they still need
 * a syntactically valid absolute URL.
 */
const REGISTRY_ORIGIN = 'https://sandcastle-registry.internal'

function stubFor(
  namespace: SandcastleRegistryNamespace,
  repo: string,
): SandcastleRegistryStub {
  return namespace.get(namespace.idFromName(repo))
}

function post(
  namespace: SandcastleRegistryNamespace,
  repo: string,
  path: string,
  body: unknown,
): Promise<Response> {
  return stubFor(namespace, repo).fetch(
    new Request(`${REGISTRY_ORIGIN}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

export function registerSandcastleRun(
  namespace: SandcastleRegistryNamespace,
  input: RegisterRunInput,
): Promise<Response> {
  return post(namespace, input.repo, '/runs/register', input)
}

export function claimSandcastleIssues(
  namespace: SandcastleRegistryNamespace,
  repo: string,
  runId: string,
  input: ClaimInput,
): Promise<Response> {
  return post(
    namespace,
    repo,
    `/runs/${encodeURIComponent(runId)}/claim`,
    input,
  )
}

export function heartbeatSandcastleRun(
  namespace: SandcastleRegistryNamespace,
  repo: string,
  runId: string,
  input: HeartbeatInput,
): Promise<Response> {
  return post(
    namespace,
    repo,
    `/runs/${encodeURIComponent(runId)}/heartbeat`,
    input,
  )
}

export function recordSandcastleWip(
  namespace: SandcastleRegistryNamespace,
  repo: string,
  runId: string,
  input: RecordWipInput,
): Promise<Response> {
  return post(namespace, repo, `/runs/${encodeURIComponent(runId)}/wip`, input)
}

export function releaseSandcastleIssues(
  namespace: SandcastleRegistryNamespace,
  repo: string,
  runId: string,
  input: ReleaseInput,
): Promise<Response> {
  return post(
    namespace,
    repo,
    `/runs/${encodeURIComponent(runId)}/release`,
    input,
  )
}

export function finishSandcastleRun(
  namespace: SandcastleRegistryNamespace,
  repo: string,
  runId: string,
  input: FinishInput,
): Promise<Response> {
  return post(
    namespace,
    repo,
    `/runs/${encodeURIComponent(runId)}/finish`,
    input,
  )
}

/** The dashboard's read. No run id: this is the state of the whole repository's fleet. */
export function readSandcastleState(
  namespace: SandcastleRegistryNamespace,
  repo: string,
): Promise<Response> {
  return stubFor(namespace, repo).fetch(new Request(`${REGISTRY_ORIGIN}/state`))
}
