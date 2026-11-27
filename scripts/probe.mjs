export const packages = ['app', 'site', 'factory'];

export function required(name) {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`Missing ${name}`);
  return value;
}

export function sha(value) {
  if (!/^[a-f0-9]{40}$/.test(value)) throw new Error('Expected a full Git SHA');
  return value;
}

export function endpoint(worker, path, local = false) {
  const origin = new URL(required(`${worker.toUpperCase()}_URL`));
  if ((!local && origin.protocol !== 'https:') || origin.username || origin.password ||
      origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error(`Invalid ${worker} origin`);
  }
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Expected an absolute path');
  const url = new URL(path, origin);
  if (url.origin !== origin.origin || url.hash || url.search) throw new Error('Invalid probe path');
  return url;
}

export function access(worker) {
  const id = process.env[`${worker.toUpperCase()}_ACCESS_CLIENT_ID`];
  const secret = process.env[`${worker.toUpperCase()}_ACCESS_CLIENT_SECRET`];
  if (Boolean(id) !== Boolean(secret)) throw new Error(`Incomplete ${worker} Access credentials`);
  return id ? { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret } : {};
}

export function request(url, options = {}) {
  return fetch(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
}

export async function verifyHealth(response, expected) {
  if (response.status !== 200 || !/^application\/json\b/i.test(response.headers.get('content-type') ?? '')) {
    throw new Error(`Unexpected health response (${response.status})`);
  }
  const body = await response.json();
  if (body?.ok !== true || body.sourceSha !== expected) {
    throw new Error('Health did not confirm the expected source SHA');
  }
}

export function verifyBoundary(response, protectedUrl, signInUrl) {
  if ([401, 403].includes(response.status)) return;
  const location = response.headers.get('location');
  if ([301, 302, 303, 307, 308].includes(response.status) && location) {
    const redirect = URL.parse(location, protectedUrl);
    if (redirect?.origin === signInUrl.origin && redirect.pathname === signInUrl.pathname) return;
  }
  throw new Error(`Protected route did not enforce the expected auth boundary (${response.status})`);
}

export function cmsBoundary(local = false) {
  const admin = endpoint('site', required('CMS_ADMIN_PATH'), local);
  const statusParam = process.env.CMS_UNAUTHENTICATED_STATUS;
  const status = statusParam ? Number(statusParam) : null;
  const login = new URL(process.env.CMS_LOGIN_URL || '/_emdash/admin/login', admin);
  if ((status !== null && ![401, 403].includes(status)) ||
      login.origin !== admin.origin || login.pathname === admin.pathname ||
      login.username || login.password || login.hash) {
    throw new Error('Invalid CMS auth boundary configuration');
  }
  const teamDomain = process.env.CF_ACCESS_TEAM_DOMAIN;
  const accessLogin = !local && /^[a-z0-9-]+\.cloudflareaccess\.com$/.test(teamDomain ?? '')
    ? `https://${teamDomain}/cdn-cgi/access/login/${admin.hostname}`
    : null;
  return { admin, status, login, accessLogin };
}

function matchesAccessLogin(location, accessLogin, returnPath) {
  // Compare the raw URL prefix so URL normalization cannot hide credentials or path changes.
  if (!location?.startsWith(`${accessLogin}?`) || /[\s\\#]|%(?![a-f\d]{2})/i.test(location)) return false;
  const redirect = URL.parse(location);
  if (!redirect) return false;

  const parameters = new Map();
  for (const [name, value] of redirect.searchParams) {
    if (parameters.has(name) && parameters.get(name) !== value) return false;
    parameters.set(name, value);
  }
  return parameters.get('redirect_url') === returnPath;
}

export function verifyCmsBoundary(response, { admin, status, login, accessLogin }) {
  if (status !== null) {
    if (response.status !== status) throw new Error(`Unexpected CMS status (${response.status})`);
    return;
  }
  if ([401, 403].includes(response.status)) return;
  const location = response.headers.get('location');
  if (response.status === 302 && accessLogin && matchesAccessLogin(location, accessLogin, admin.pathname)) return;
  const redirect = location && URL.parse(location, admin);
  if (redirect?.username || redirect?.password) {
    throw new Error(`Protected route did not enforce the expected auth boundary (${response.status})`);
  }
  verifyBoundary(response, admin, login);
}
