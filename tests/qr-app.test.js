const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp, tokenMatches } = require('../src');

function basicCredentials(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

async function serve(app, t) {
  const server = app.listen(0, '127.0.0.1');
  t.after(() => {
    server.close();
    server.closeAllConnections();
  });
  await new Promise((resolve) => server.once('listening', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

function createMountedQrApp({ getQrPng, getState }) {
  return createApp({
    client: {},
    recipients: [],
    apiToken: 'secret',
    isReady: () => false,
    qr: {
      apiToken: 'secret',
      tokenMatches,
      getQrPng,
      getState,
    },
  });
}

test('protects the QR viewer with API-token HTTP Basic authentication', async (t) => {
  const app = createMountedQrApp({
    getQrPng: () => Buffer.from('png'),
    getState: () => ({ state: 'qr', revision: 1 }),
  });
  const url = await serve(app, t);

  const unauthorized = await fetch(`${url}/qr/qr.png`);
  assert.equal(unauthorized.status, 401);
  assert.match(unauthorized.headers.get('www-authenticate'), /^Basic realm="jwbot QR"/);
  assert.equal(unauthorized.headers.get('cache-control'), 'no-store, no-cache, must-revalidate, private');

  const wrongUser = await fetch(`${url}/qr/status`, {
    headers: { authorization: basicCredentials('wrong', 'secret') },
  });
  assert.equal(wrongUser.status, 401);

  const image = await fetch(`${url}/qr/qr.png`, {
    headers: { authorization: basicCredentials('jwbot', 'secret') },
  });
  assert.equal(image.status, 200);
  assert.match(image.headers.get('content-type'), /^image\/png/);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), Buffer.from('png'));
});

test('serves a responsive QR page and status without exposing the token', async (t) => {
  const app = createMountedQrApp({
    getQrPng: () => null,
    getState: () => ({ state: 'waiting', revision: 0 }),
  });
  const url = await serve(app, t);
  const authorization = basicCredentials('jwbot', 'secret');

  const page = await fetch(`${url}/qr`, { headers: { authorization } });
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
  const html = await page.text();
  assert.match(html, /Conectar WhatsApp/);
  assert.match(html, /fetch\('\/qr\/status'/);
  assert.match(html, /fetch\('\/qr\/qr\.png'/);
  assert.doesNotMatch(html, /secret/);

  const status = await fetch(`${url}/qr/status`, { headers: { authorization } });
  assert.deepEqual(await status.json(), { state: 'waiting', revision: 0 });
  const health = await fetch(`${url}/health`);
  assert.equal(health.status, 503);

  const noQr = await fetch(`${url}/qr/qr.png`, { headers: { authorization } });
  assert.equal(noQr.status, 204);
  assert.equal(noQr.headers.get('cache-control'), 'no-store, no-cache, must-revalidate, private');
});
