import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { access, endpoint, packages, request, required, sha, cmsBoundary } from './probe.mjs';
import { canonicalOrigin, signInTarget, smoke } from './smoke.mjs';
import { release } from './release.mjs';
import { activeDeployment, deploymentResult, requireCutoverApproval, requireNoPublicRoutes } from './deployments.mjs';

import { wranglerConfig } from './contracts.mjs';

const stage = process.argv[2];
const expected = sha(required('GITHUB_SHA'));
if (execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== expected) {
  throw new Error('Checked-out commit does not match the release SHA');
}
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
const appOrigin = canonicalOrigin('APP_ORIGIN');
const siteOrigin = canonicalOrigin('SITE_ORIGIN');
if (stage === 'production' && appOrigin !== 'https://app.money-tracker.online') {
  throw new Error('Production APP_ORIGIN must be https://app.money-tracker.online');
}
signInTarget(appOrigin);
cmsBoundary();

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
  return deploymentResult(worker, response, !body);
}

async function previous(worker) {
  return activeDeployment(worker, await cloud(worker));
}

function npm(worker, ...args) {
  return new Promise((resolve, reject) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
      name !== 'GH_TOKEN' && !name.includes('_ACCESS_CLIENT_')));
    env.SOURCE_SHA = expected;
    env.APP_ORIGIN = appOrigin;
    if (worker === 'site') env.SITE_URL = siteOrigin;
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
requireCutoverApproval(
  stage, snapshots, expected, process.env.PRODUCTION_CUTOVER_SHA, process.env.PRODUCTION_CUTOVER_COMPLETE,
);
if (stage === 'production' && (process.env.PRODUCTION_CUTOVER_COMPLETE !== 'true' ||
    Object.values(snapshots).includes(null))) {
  for (const worker of packages) {
    const dir = resolve('apps', worker);
    const config = wranglerConfig(dir);
    if (!config) throw new Error(`${worker}: missing Wrangler configuration`);
    const requireFromWorker = createRequire(resolve(dir, 'package.json'));
    const { unstable_readConfig } = requireFromWorker('wrangler');
    requireNoPublicRoutes(worker, unstable_readConfig({ config, env: stage }));
  }
}
const summary = Object.entries(snapshots).map(([worker, snapshot]) =>
  snapshot
    ? `- ${worker}: deployment \`${snapshot.deployment}\`, version \`${snapshot.version}\``
    : `- ${worker}: no prior active binary`).join('\n');
appendFileSync(required('GITHUB_STEP_SUMMARY'), `## Previous ${stage} deployments\n\n${summary}\n`);
const deployed = {};
try {
  await release({
    workers: packages,
    snapshots,
    async migrate() {
      await verifyMain();
      await npm('app', 'run', `migrate:${stage}`);
    },
    async deploy(worker) {
      await verifyMain();
      const args = ['--name', names[worker]];
      if (worker === 'factory') args.push('--var', `SOURCE_SHA:${expected}`);
      await npm(worker, 'run', `deploy:${stage}`, '--', ...args);
      deployed[worker] = (await previous(worker))?.version;
      if (!deployed[worker] || deployed[worker] === snapshots[worker]?.version) throw new Error(`${worker}: no new active Worker version`);
    },
    async verify() {
      await verifyMain();
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
        if ((await previous(worker))?.version !== deployed[worker]) {
          throw new Error(`${worker}: active version changed during verification`);
        }
      }
    },
    finish() {
      appendFileSync(required('GITHUB_STEP_SUMMARY'), `\nVerified release \`${expected}\`.\n`);
    },
    async rollback(worker, { version }) {
      const current = await previous(worker).catch(() => null);
      if (current?.version !== version) {
        await cloud(worker, {
          strategy: 'percentage',
          versions: [{ version_id: version, percentage: 100 }],
        });
      }
      if ((await previous(worker))?.version !== version) throw new Error('rollback version is not active');
      console.log(`${worker}: confirmed rollback to ${version}`);
    },
    onNoBaseline(worker) {
      console.error(`${worker}: no prior binary to roll back to; manual recovery may be required`);
    },
    onRollbackFailure(worker) {
      console.error(`${worker}: rollback could not be confirmed for ${snapshots[worker].version}; investigate the active deployment`);
    },
  });
} catch (error) {
  console.error(`Delivery failed: ${error.message}`);
  process.exitCode = 1;
}
