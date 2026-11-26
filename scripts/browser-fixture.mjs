import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { smoke } from './smoke.mjs';

const expected = 'a'.repeat(40);
let appSha = expected;
let landingLink;
const handlers = {
  app(req, res) {
    if (req.url === '/private') return res.writeHead(302, { Location: '/sign-in' }).end();
    return health(res, appSha);
  },
  site(req, res) {
    if (req.url === '/admin') return res.writeHead(401).end();
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
  process.env.SIGN_IN_URL = landingLink = `${process.env.APP_URL}/sign-in`;
  process.env.APP_PROTECTED_PATH = '/private';
  process.env.CMS_ADMIN_PATH = '/admin';
  process.env.CMS_UNAUTHENTICATED_STATUS = '401';

  await smoke(expected, true);
  appSha = 'b'.repeat(40);
  await assert.rejects(smoke(expected, true), /app: Health did not confirm/);
  appSha = expected;
  landingLink = '/wrong-link';
  await assert.rejects(smoke(expected, true), /no visible link/);
} finally {
  for (const server of servers) server.close();
}
