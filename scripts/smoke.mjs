import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { access, endpoint, packages, request, required, sha, cmsBoundary, verifyBoundary, verifyHealth } from './probe.mjs';

export function canonicalOrigin(name) {
  const origin = required(name);
  const url = URL.parse(origin);
  if (url?.protocol !== 'https:' || url.origin !== origin) {
    throw new Error(`Expected an HTTPS origin in ${name}`);
  }
  return origin;
}

export function signInTarget(origin) {
  const signIn = URL.parse(required('SIGN_IN_URL'));
  if (signIn?.origin !== origin || signIn.username || signIn.password || signIn.search || signIn.hash) {
    throw new Error('SIGN_IN_URL must be on the canonical app origin without credentials, query, or fragment');
  }
  return signIn;
}

export function verifyAppBoundary(response, app, signIn) {
  const location = response.headers.get('location');
  // The Worker can respond with a root-relative redirect to the same route on the request host.
  const expected = location?.startsWith('/') && !location.startsWith('//')
    ? new URL(signIn.pathname, app.origin)
    : signIn;
  verifyBoundary(response, app, expected);
}

export async function verifyAppOrigin(origin) {
  // This signed-out request reaches the runtime origin check before session validation.
  const response = await request(endpoint('app', '/api/pilot/ledger'), {
    method: 'POST',
    headers: { ...access('app'), Origin: origin, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const body = response.status === 401 ? await response.json().catch(() => null) : null;
  if (body?.message !== 'Sign in with a verified email to continue.') {
    throw new Error(`App did not accept the canonical request origin at the auth boundary (${response.status})`);
  }
}

export function verifyLanding(links, { canonical, openGraph }, signIn, siteOrigin) {
  if (!links.includes(signIn.href)) throw new Error('Public landing has no visible link to the configured sign-in URL');
  if (!siteOrigin) return;
  const expected = new URL('/', siteOrigin).href;
  if (canonical.length !== 1 || canonical[0] !== expected) {
    throw new Error('Public landing has an unexpected SEO canonical URL');
  }
  if (openGraph.length !== 1 || openGraph[0] !== expected) {
    throw new Error('Public landing has an unexpected Open Graph URL');
  }
}

export async function smoke(expected, local = false) {
  sha(expected);
  const appOrigin = local ? endpoint('app', '/', true).origin : canonicalOrigin('APP_ORIGIN');
  const siteOrigin = local ? null : canonicalOrigin('SITE_ORIGIN');
  const signIn = signInTarget(appOrigin);
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
  verifyAppBoundary(await request(app, { headers: access('app') }), app, signIn);
  if (!local) await verifyAppOrigin(appOrigin);
  if (local) {
    for (const url of [signIn, endpoint('app', process.env.APP_REGISTER_PATH || '/register', true)]) {
      const response = await request(url);
      if (!response.ok) throw new Error(`Public app route ${url.pathname} returned ${response.status}`);
    }
  }
  const { admin, status, login } = cmsBoundary(local);
  const response = await request(admin, { headers: access('site') });
  if (status === null) verifyBoundary(response, admin, login);
  else if (response.status !== status) throw new Error(`Unexpected CMS status (${response.status})`);

  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const landing = endpoint('site', '/', local);
    const result = await page.goto(landing.href, { timeout: 15_000, waitUntil: 'domcontentloaded' })
      .catch(() => null);
    if (!result?.ok() || new URL(page.url()).origin !== landing.origin) {
      throw new Error('Public landing page unavailable');
    }
    const link = page.getByRole('link').filter({ visible: true });
    const links = await link.evaluateAll(elements => elements.map(element => element.href));
    const seo = await page.evaluate(() => ({
      canonical: Array.from(document.querySelectorAll('head link[rel="canonical"]'), node => node.getAttribute('href')),
      openGraph: Array.from(document.querySelectorAll('head meta[property="og:url"]'), node => node.getAttribute('content')),
    }));
    verifyLanding(links, seo, signIn, siteOrigin);
  } finally {
    await browser.close();
  }
  console.log(`Smoke verified all three Workers at ${expected}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  await smoke(process.argv[2], process.argv.includes('--local')).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
