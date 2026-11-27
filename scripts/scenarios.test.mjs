import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const target = process.env.SCENARIO_TARGET ? pathToFileURL(`${process.env.SCENARIO_TARGET}/`) : new URL('.', import.meta.url);
const { cmsBoundary, verifyBoundary, verifyCmsBoundary, verifyHealth } = await import(new URL('probe.mjs', target));
const { release } = await import(new URL('release.mjs', target));
const { verifyContracts } = await import(new URL('contracts.mjs', target));
const { activeDeployment, deploymentResult, requireCutoverApproval, requireNoPublicRoutes } = await import(new URL('deployments.mjs', target));

const version = '00000000-0000-4000-8000-000000000001';
const existing = { deployment: 'deployment-id', version };

test('only an empty deployment list or Cloudflare missing-Worker response permits a missing baseline', async () => {
  const missingWorker = { success: false, errors: [{ code: 10007 }] };
  const read = (status, body, allowMissing = true) =>
    deploymentResult('app', Response.json(body, { status }), allowMissing);
  assert.equal(activeDeployment('app', await read(404, missingWorker)), null);
  assert.equal(activeDeployment('app', await read(200, { success: true, result: { deployments: [] } })), null);
  await assert.rejects(read(404, missingWorker, false), /returned 404/);
  await assert.rejects(read(404, { success: false, errors: [{ code: 9999 }] }), /returned 404/);
  await assert.rejects(read(403, missingWorker), /returned 403/);
  await assert.rejects(read(500, missingWorker), /returned 500/);
  assert.throws(() => activeDeployment('app', {}), /invalid deployment list/);
  const deployment = { id: existing.deployment, versions: [{ version_id: version, percentage: 100 }] };
  assert.deepEqual(activeDeployment('app', { deployments: [deployment] }), existing);
  deployment.versions.push({ version_id: version, percentage: 0 });
  assert.throws(() => activeDeployment('app', { deployments: [deployment] }), /single active Worker version/);
});

test('staging can start empty and production bootstrap requires the exact approved SHA', () => {
  const expected = 'a'.repeat(40);
  const empty = { app: null, site: null };
  const ready = { app: existing, site: existing };
  requireCutoverApproval('staging', empty, expected);
  assert.throws(() => requireCutoverApproval('production', empty, expected), /exact SHA/);
  assert.throws(() => requireCutoverApproval('production', empty, expected, 'b'.repeat(40), 'true'), /exact SHA/);
  requireCutoverApproval('production', empty, expected, expected);
  assert.throws(() => requireCutoverApproval('production', ready, expected), /exact SHA/);
  requireCutoverApproval('production', ready, expected, undefined, 'true');
});

test('initial production deployment refuses a public route or custom domain', () => {
  requireNoPublicRoutes('site', { routes: [], workers_dev: true });
  assert.throws(() => requireNoPublicRoutes('site', { route: 'example.com/*' }), /public routes/);
  assert.throws(() => requireNoPublicRoutes('site', {
    routes: [{ pattern: 'example.com', custom_domain: true }],
  }), /public routes/);
});

test('a failed mixed bootstrap restores only workers with prior binaries', async () => {
  const log = [];
  await assert.rejects(release({
    workers: ['app', 'site', 'factory'],
    snapshots: { app: existing, site: null, factory: null },
    migrate: async () => {},
    deploy: async () => {},
    verify: async () => { throw new Error('wrong source SHA'); },
    finish: () => assert.fail('failed bootstrap cannot finish'),
    rollback(worker, snapshot) {
      assert.equal(snapshot, existing);
      log.push(`rollback ${worker}`);
    },
    onNoBaseline: worker => log.push(`no previous version ${worker}`),
    onRollbackFailure: () => assert.fail('rollback should succeed'),
  }), /wrong source SHA/);
  assert.deepEqual(log, ['no previous version factory', 'no previous version site', 'rollback app']);
});

test('an empty staging rollout can finish once the newly deployed Workers pass smoke', async () => {
  const log = [];
  await release({
    workers: ['app', 'site'],
    snapshots: { app: null, site: null },
    migrate: () => log.push('migrate'),
    deploy: worker => log.push(worker),
    verify: () => log.push('verify'),
    finish: () => log.push('finish'),
    rollback: () => assert.fail('successful bootstrap cannot roll back'),
    onNoBaseline: () => assert.fail('successful bootstrap needs no recovery'),
  });
  assert.deepEqual(log, ['migrate', 'app', 'site', 'verify', 'finish']);
});

test('package verification fails when a workspace is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-contracts-'));
  try {
    assert.throws(() => verifyContracts(dir), /Missing required file .*apps\/app\/package.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('health requires success and the exact full source SHA', async () => {
  const expected = 'a'.repeat(40);
  await verifyHealth(Response.json({ ok: true, sourceSha: expected }), expected);
  for (const payload of [
    { ok: false, sourceSha: expected },
    { ok: true, sourceSha: 'b'.repeat(40) },
    { ok: true, sourceSha: expected.slice(0, 7) },
    { ok: true },
  ]) {
    await assert.rejects(verifyHealth(Response.json(payload), expected), /expected source SHA/);
  }
  await assert.rejects(verifyHealth(Response.json({}, { status: 503 }), expected), /health response/);
});

test('auth boundary accepts denial or the expected sign-in redirect', () => {
  const target = new URL('https://app.invalid/private');
  const signIn = new URL('https://app.invalid/sign-in');
  const redirect = location => new Response(null, { status: 302, headers: { location } });
  verifyBoundary(new Response(null, { status: 401 }), target, signIn);
  verifyBoundary(redirect('/sign-in?next=/private'), target, signIn);
  assert.throws(() => verifyBoundary(new Response(null), target, signIn));
  assert.throws(() => verifyBoundary(redirect('https://access.invalid/sign-in'), target, signIn));
});

test('deployed CMS smoke accepts only the configured Cloudflare Access login redirect', t => {
  const site = 'https://staging.money-tracker.online';
  const admin = '/_emdash/admin';
  const team = 'design4pro.cloudflareaccess.com';
  const login = `https://${team}/cdn-cgi/access/login/${new URL(site).hostname}`;
  const query = `redirect_url=${admin}&kid=example&meta=example`;
  const access = `${login}?${query}`;
  const redirect = location => new Response(null, { status: 302, headers: { location } });
  const originalEnv = process.env;
  process.env = {
    ...originalEnv,
    SITE_URL: site,
    CMS_ADMIN_PATH: admin,
    CMS_LOGIN_URL: '',
    CMS_UNAUTHENTICATED_STATUS: '',
    CF_ACCESS_TEAM_DOMAIN: team,
  };
  t.after(() => { process.env = originalEnv; });

  const deployed = cmsBoundary();
  verifyCmsBoundary(redirect(access), deployed);
  verifyCmsBoundary(redirect(`${access}&redirect_url=${encodeURIComponent(admin)}`), deployed);
  verifyCmsBoundary(redirect(`${admin}/login?next=${admin}`), deployed);
  verifyCmsBoundary(new Response(null, { status: 401 }), deployed);
  verifyCmsBoundary(new Response(null, { status: 403, headers: { location: 'https://[' } }), deployed);
  for (const location of [
    access.replace(team, 'another.cloudflareaccess.com'),
    access.replace(team, `${team}.invalid`),
    access.replace('https:', 'http:'),
    access.replace('https:', ''),
    access.replace(team, `user:password@${team}`),
    access.replace(team, `@${team}`),
    access.replace('/access/login/', '/access/other/../login/'),
    access.replace('/access/login/', '/access/logout/'),
    access.replace('login/staging.', 'login/other.'),
    `${login}?kid=example`,
    `${login}?redirect_url=${site}${admin}`,
    `${login}?redirect_url=${admin}/login`,
    `${access}&redirect%5Furl=/other`,
    `${access}&kid=different`,
    `${access}&malformed=%ZZ`,
    `${access}#fragment`,
    'https://[',
  ]) {
    assert.throws(() => verifyCmsBoundary(redirect(location), deployed), /auth boundary/, location);
  }
  assert.throws(() => verifyCmsBoundary(new Response(null, {
    status: 307, headers: { location: access },
  }), deployed), /auth boundary/);
  assert.throws(() => verifyCmsBoundary(redirect(access), cmsBoundary(true)), /auth boundary/);
  delete process.env.CF_ACCESS_TEAM_DOMAIN;
  assert.throws(() => verifyCmsBoundary(redirect(access), cmsBoundary()), /auth boundary/);

  process.env.CF_ACCESS_TEAM_DOMAIN = team;
  process.env.CMS_UNAUTHENTICATED_STATUS = '403';
  const exact = cmsBoundary();
  verifyCmsBoundary(new Response(null, { status: 403 }), exact);
  assert.throws(() => verifyCmsBoundary(new Response(null, { status: 401 }), exact), /Unexpected CMS status/);
  assert.throws(() => verifyCmsBoundary(redirect(access), exact), /Unexpected CMS status/);
});

for (const [failure, expected] of [
  [null, ['migrate', 'deploy app', 'deploy site', 'verify', 'finish']],
  ['migrate', ['migrate']],
  ['deploy site', ['migrate', 'deploy app', 'deploy site', 'rollback site', 'rollback failure site', 'rollback app']],
  ['verify', ['migrate', 'deploy app', 'deploy site', 'verify', 'rollback site', 'rollback failure site', 'rollback app']],
]) {
  test(failure ? `release fails closed on ${failure}` : 'release finishes only after verification', async () => {
    const log = [];
    function record(event) {
      log.push(event);
      if (event === failure) throw new Error(event);
    }
    const result = release({
      workers: ['app', 'site'],
      snapshots: { app: existing, site: existing },
      migrate: () => record('migrate'),
      deploy: worker => record(`deploy ${worker}`),
      verify: () => record('verify'),
      finish: () => record('finish'),
      rollback: worker => {
        record(`rollback ${worker}`);
        if (worker === 'site') throw new Error('rollback failed');
      },
      onRollbackFailure: worker => record(`rollback failure ${worker}`),
    });
    if (failure) await assert.rejects(result, { message: failure });
    else await result;
    assert.deepEqual(log, expected);
  });
}

test('delivery smoke verifies canonical destinations through distinct probe origins', async t => {
  const { canonicalOrigin, signInTarget, verifyAppBoundary, verifyAppOrigin, verifyLanding } =
    await import(new URL('smoke.mjs', target));
  const canonicalApp = 'https://app.invalid';
  const canonicalSite = 'https://site.invalid';
  const appProbe = 'https://app-preview.invalid';
  const siteProbe = 'https://site-preview.invalid';
  const originalEnv = process.env;
  process.env = {
    ...originalEnv,
    APP_ORIGIN: canonicalApp,
    APP_URL: appProbe,
    SIGN_IN_URL: `${canonicalApp}/login`,
    APP_ACCESS_CLIENT_ID: 'synthetic-client',
    APP_ACCESS_CLIENT_SECRET: 'synthetic-secret',
  };
  t.after(() => { process.env = originalEnv; });

  const origin = canonicalOrigin('APP_ORIGIN');
  const signIn = signInTarget(origin);
  const billing = new URL('/billing', appProbe);
  const redirect = location => new Response(null, { status: 302, headers: { location } });
  verifyAppBoundary(redirect('/login?next=/billing'), billing, signIn);
  verifyAppBoundary(redirect(signIn.href), billing, signIn);
  assert.throws(() => verifyAppBoundary(redirect(`${appProbe}/login`), billing, signIn), /auth boundary/);
  assert.throws(() => verifyAppBoundary(redirect('//app-preview.invalid/login'), billing, signIn), /auth boundary/);

  let deployedOrigin = canonicalApp;
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url.href, `${appProbe}/api/pilot/ledger`);
    assert.equal(options.redirect, 'manual');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Origin, canonicalApp);
    assert.equal(options.headers['CF-Access-Client-Id'], 'synthetic-client');
    assert.equal(options.headers['CF-Access-Client-Secret'], 'synthetic-secret');
    return deployedOrigin === options.headers.Origin
      ? Response.json({ message: 'Sign in with a verified email to continue.' }, { status: 401 })
      : Response.json({ message: 'Invalid request origin.' }, { status: 403 });
  });
  await verifyAppOrigin(origin);
  deployedOrigin = appProbe;
  await assert.rejects(verifyAppOrigin(origin), /canonical request origin/);
  assert.equal(fetch.mock.callCount(), 2);

  const seo = { canonical: [`${canonicalSite}/`], openGraph: [`${canonicalSite}/`] };
  verifyLanding([signIn.href], seo, signIn, canonicalSite);
  assert.throws(() => verifyLanding([`${appProbe}/login`], seo, signIn, canonicalSite), /no visible link/);
  assert.throws(() => verifyLanding([signIn.href], {
    ...seo, canonical: [`${siteProbe}/`],
  }, signIn, canonicalSite), /SEO canonical/);
  assert.throws(() => verifyLanding([signIn.href], {
    ...seo, openGraph: [`${siteProbe}/`],
  }, signIn, canonicalSite), /Open Graph URL/);
  process.env.SIGN_IN_URL = `${appProbe}/login`;
  assert.throws(() => signInTarget(origin), /canonical app origin/);
});
