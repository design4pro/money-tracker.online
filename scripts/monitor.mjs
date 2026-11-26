import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { access, endpoint, packages, request, required, sha } from './probe.mjs';

const sampleCount = 5;

function threshold(name) {
  const value = Number(required(name));
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid ${name}`);
  return value;
}

async function sample(worker) {
  const started = performance.now();
  try {
    const response = await request(endpoint(worker, '/health'), { headers: access(worker) });
    if (response.status !== 200) return { status: response.status, healthy: false };
    const payload = await response.json();
    sha(payload.sourceSha);
    return { status: 200, healthy: payload.ok === true, ms: Math.ceil(performance.now() - started) };
  } catch {
    return { status: 0, healthy: false };
  }
}

async function polarLag(url, token, limit) {
  try {
    const response = await request(url, {
      headers: { ...access('app'), Authorization: `Bearer ${token}` },
    });
    if (response.ok) {
      const { lagSeconds } = await response.json();
      if (Number.isFinite(lagSeconds) && lagSeconds >= 0) {
        return lagSeconds > limit ? [{ signal: 'polar-lag', lagSeconds, thresholdSeconds: limit }] : [];
      }
    }
  } catch {
    // Use only sanitized evidence in the alert.
  }
  return [{ signal: 'polar-signal-unavailable' }];
}

const latencyLimit = threshold('MONITOR_P95_MS');
const factoryAlert = endpoint('factory', '/ops/alert');
const factoryToken = required('FACTORY_ALERT_TOKEN');
const polarPath = process.env.POLAR_LAG_PATH;
const polar = polarPath && {
  url: endpoint('app', polarPath),
  token: required('POLAR_SIGNAL_TOKEN'),
  limit: threshold('MONITOR_POLAR_LAG_SECONDS'),
};
for (const worker of packages) {
  endpoint(worker, '/health');
  access(worker);
}

const findings = [];
for (const worker of packages) {
  const samples = [];
  for (let index = 0; index < sampleCount; index++) samples.push(await sample(worker));
  const timings = samples.filter(item => item.healthy).map(item => item.ms).sort((a, b) => a - b);
  const p95Ms = timings.length ? timings[Math.ceil(timings.length * 0.95) - 1] : null;
  const unavailable = samples.filter(item => !item.healthy).length;
  const serverErrors = samples.filter(item => item.status >= 500).length;
  const evidence = { worker, samples: sampleCount, unavailable, serverErrors, p95Ms };
  console.log(JSON.stringify(evidence));
  if (unavailable) findings.push({ signal: 'availability', ...evidence });
  if (serverErrors) findings.push({ signal: '5xx', ...evidence });
  if (p95Ms !== null && p95Ms > latencyLimit) findings.push({ signal: 'p95', ...evidence, thresholdMs: latencyLimit });
}
if (polar) findings.push(...await polarLag(polar.url, polar.token, polar.limit));

if (findings.length) {
  const correlationId = `github-${process.env.GITHUB_RUN_ID ?? randomUUID()}-${process.env.GITHUB_RUN_ATTEMPT ?? '1'}`;
  const response = await request(factoryAlert, {
    method: 'POST',
    headers: { ...access('factory'), Authorization: `Bearer ${factoryToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ correlationId, source: 'pilot-monitoring', evidence: findings }),
  });
  if (!response.ok) throw new Error(`Factory alert was rejected (${response.status}, ${correlationId})`);
  console.error(`Monitoring found anomalies and submitted alert ${correlationId}`);
  process.exitCode = 1;
}
