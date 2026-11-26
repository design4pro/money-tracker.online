import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { smoke } from './smoke.mjs';

const expected = 'a'.repeat(40);
let appSha = expected;
let landingLink;
let cmsRedirect = '/_emdash/admin/login?redirect=/_emdash/admin';
const handlers = {
  app(req, res) {
    if (['/login', '/register'].includes(req.url)) return res.writeHead(200).end();
    if (req.url === '/billing') return res.writeHead(302, { Location: '/login' }).end();
    return health(res, appSha);
  },
  site(req, res) {
    if (req.url === '/_emdash/admin') return res.writeHead(302, { Location: cmsRedirect }).end();
    if (req.url === '/') {
      return res.writeHead(200, { 'Content-Type': 'text/html' }).end(`<a href="${landingLink}">Sign in</a>`);
    }
    return health(res, expected);
  },
  factory: (_req, res) => health(res, expected),
};

function health(res, sourceSha) {
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, sourceSha }));
}

const servers = [];
try {
  for (const [worker, handler] of Object.entries(handlers)) {
    const server = createServer(handler).listen(0, '127.0.0.1');
    servers.push(server);
    await once(server, 'listening');
    process.env[`${worker.toUpperCase()}_URL`] = `http://127.0.0.1:${server.address().port}`;
  }
  process.env.SIGN_IN_URL = landingLink = `${process.env.APP_URL}/login`;
  process.env.APP_PROTECTED_PATH = '/billing';
  process.env.CMS_ADMIN_PATH = '/_emdash/admin';
  delete process.env.CMS_UNAUTHENTICATED_STATUS;

  await smoke(expected, true);
  cmsRedirect = '/_emdash/admin/setup';
  await assert.rejects(smoke(expected, true), /auth boundary/);
  cmsRedirect = '/_emdash/admin/login';
  appSha = 'b'.repeat(40);
  await assert.rejects(smoke(expected, true), /app: Health did not confirm/);
  appSha = expected;
  landingLink = '/wrong-link';
  await assert.rejects(smoke(expected, true), /no visible link/);
} finally {
  for (const server of servers) server.close();
}
