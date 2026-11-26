import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { access, endpoint, packages, request, required, sha, verifyBoundary, verifyHealth } from './probe.mjs';

export async function smoke(expected, local = false) {
  sha(expected);
  const signIn = new URL(required('SIGN_IN_URL'));
  if (signIn.protocol !== 'https:' && !(local && signIn.protocol === 'http:')) {
    throw new Error('Invalid sign-in URL protocol');
  }
  for (const worker of packages) {
    try {
      await verifyHealth(await request(endpoint(worker, '/health', local), {
        headers: { ...access(worker), 'Cache-Control': 'no-cache' },
      }), expected);
    } catch (error) {
      throw new Error(`${worker}: ${error.message}`);
    }
  }
  const app = endpoint('app', required('APP_PROTECTED_PATH'), local);
  verifyBoundary(await request(app, { headers: access('app') }), app, signIn);
  const admin = endpoint('site', required('CMS_ADMIN_PATH'), local);
  const expectedStatus = Number(required('CMS_UNAUTHENTICATED_STATUS'));
  if (![401, 403].includes(expectedStatus)) throw new Error('CMS status must be 401 or 403');
  const response = await request(admin, { headers: access('site') });
  if (response.status !== expectedStatus) throw new Error(`Unexpected CMS status (${response.status})`);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const landing = endpoint('site', '/', local);
    const result = await page.goto(landing.href, { timeout: 15_000, waitUntil: 'domcontentloaded' });
    if (!result?.ok() || new URL(page.url()).origin !== landing.origin) {
      throw new Error('Public landing page unavailable');
    }
    const link = page.getByRole('link').filter({ visible: true });
    const links = await link.evaluateAll(elements => elements.map(element => element.href));
    if (!links.includes(signIn.href)) throw new Error('Public landing has no visible link to the configured sign-in URL');
  } finally {
    await browser.close();
  }
  console.log(`Smoke verified all three Workers at ${expected}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await smoke(process.argv[2], process.argv.includes('--local')).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
