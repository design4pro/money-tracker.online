import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const target = process.env.SCENARIO_TARGET ? pathToFileURL(`${process.env.SCENARIO_TARGET}/`) : new URL('.', import.meta.url);
const { verifyBoundary, verifyHealth } = await import(new URL('probe.mjs', target));
const { release } = await import(new URL('release.mjs', target));
const { verifyContracts } = await import(new URL('contracts.mjs', target));

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
