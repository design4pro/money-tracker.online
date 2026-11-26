import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { access, endpoint, packages, request, required, sha } from './probe.mjs';
import { smoke } from './smoke.mjs';
import { release } from './release.mjs';

const stage = process.argv[2];
const expected = sha(required('GITHUB_SHA'));
if (!['staging', 'production'].includes(stage) || process.env.GITHUB_REF !== 'refs/heads/main') {
  throw new Error('Delivery requires protected main and a supported environment');
}

const account = required('CLOUDFLARE_ACCOUNT_ID');
const token = required('CLOUDFLARE_API_TOKEN');
const names = Object.fromEntries(packages.map(worker => [worker, required(`${worker.toUpperCase()}_WORKER_NAME`)]));
if (new Set(Object.values(names)).size !== packages.length) throw new Error('Worker names must be distinct');
for (const worker of packages) {
  endpoint(worker, '/health');
  access(worker);
}
endpoint('app', required('APP_PROTECTED_PATH'));
endpoint('site', required('CMS_ADMIN_PATH'));
const signIn = new URL(required('SIGN_IN_URL'));
if (signIn.origin !== endpoint('app', '/').origin || signIn.username || signIn.password ||
    ![401, 403].includes(Number(required('CMS_UNAUTHENTICATED_STATUS')))) {
  throw new Error('Invalid smoke test configuration');
}
if (stage === 'production' && process.env.PRODUCTION_CUTOVER_APPROVED !== 'true') {
  throw new Error('Production cutover has not been enabled');
}

async function verifyMain() {
  const current = await request(`https://api.github.com/repos/${required('GITHUB_REPOSITORY')}/git/ref/heads/main`, {
    headers: { Authorization: `Bearer ${required('GH_TOKEN')}`, Accept: 'application/vnd.github+json' },
  });
  if (!current.ok || (await current.json()).object?.sha !== expected) {
    throw new Error('Release SHA is no longer the tip of main');
  }
}

async function cloud(worker, body) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/workers/scripts/${encodeURIComponent(names[worker])}/deployments`;
  const response = await request(url, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok || data.success !== true) throw new Error(`${worker}: Cloudflare deployment API returned ${response.status}`);
  return data.result;
}

async function previous(worker) {
  const deployment = (await cloud(worker)).deployments?.[0];
  const version = deployment?.versions?.[0];
  if (!deployment?.id || deployment.versions.length !== 1 ||
      version.percentage !== 100 || !/^[a-f0-9-]{36}$/i.test(version.version_id)) {
    throw new Error(`${worker}: a single active rollback version is required`);
  }
  return { deployment: deployment.id, version: version.version_id };
}

function npm(worker, ...args) {
  return new Promise((resolve, reject) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
      name !== 'GH_TOKEN' && !name.includes('_ACCESS_CLIENT_')));
    const child = spawn('npm', ['--prefix', `apps/${worker}`, ...args], { stdio: 'inherit', env });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${worker}: ${args[1]} exited with ${signal ?? code}`));
    });
  });
}

await verifyMain();
const snapshots = {};
for (const worker of packages) snapshots[worker] = await previous(worker);
const summary = Object.entries(snapshots).map(([worker, { deployment, version }]) =>
  `- ${worker}: deployment \`${deployment}\`, version \`${version}\``).join('\n');
appendFileSync(required('GITHUB_STEP_SUMMARY'), `## Previous ${stage} deployments\n\n${summary}\n`);
const deployed = {};
try {
  await release({
    workers: packages,
    migrate: () => npm('app', 'run', `migrate:${stage}`),
    async deploy(worker) {
      await npm(worker, 'run', `deploy:${stage}`, '--', '--name', names[worker], '--var', `SOURCE_SHA:${expected}`);
      deployed[worker] = (await previous(worker)).version;
      if (deployed[worker] === snapshots[worker].version) throw new Error(`${worker}: no new active Worker version`);
    },
    async verify() {
      for (let attempt = 1; ; attempt++) {
        try {
          await smoke(expected);
          break;
        } catch (error) {
          console.error(`Smoke attempt ${attempt}: ${error.message}`);
          if (attempt === 4) throw error;
          await delay(5_000);
        }
      }
      for (const worker of packages) {
        if ((await previous(worker)).version !== deployed[worker]) {
          throw new Error(`${worker}: active version changed during verification`);
        }
      }
    },
    finish() {
      appendFileSync(required('GITHUB_STEP_SUMMARY'), `\nVerified release \`${expected}\`.\n`);
    },
    async rollback(worker) {
      const version = snapshots[worker].version;
      const current = await previous(worker).catch(() => null);
      if (current?.version !== version) {
        await cloud(worker, {
          strategy: 'percentage',
          versions: [{ version_id: version, percentage: 100 }],
        });
      }
      if ((await previous(worker)).version !== version) throw new Error('rollback version is not active');
      console.log(`${worker}: confirmed rollback to ${version}`);
    },
    onRollbackFailure(worker) {
      console.error(`${worker}: rollback could not be confirmed for ${snapshots[worker].version}; operator action required`);
    },
  });
} catch (error) {
  console.error(`Delivery failed: ${error.message}`);
  process.exitCode = 1;
}
