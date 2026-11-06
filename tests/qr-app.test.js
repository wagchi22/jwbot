const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src');

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
      getQrPng,
      getState,
    },
  });
}

test('serves the QR image without authentication and disables caching', async (t) => {
  const app = createMountedQrApp({
    getQrPng: () => Buffer.from('png'),
    getState: () => ({ state: 'qr', revision: 1 }),
  });
  const url = await serve(app, t);

  const image = await fetch(`${url}/qr/qr.png`);
  assert.equal(image.status, 200);
  assert.match(image.headers.get('content-type'), /^image\/png/);
  assert.equal(image.headers.get('www-authenticate'), null);
  assert.equal(image.headers.get('cache-control'), 'no-store, no-cache, must-revalidate, private');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), Buffer.from('png'));
});

test('serves a responsive QR page and status without authentication', async (t) => {
  const app = createMountedQrApp({
    getQrPng: () => null,
    getState: () => ({ state: 'waiting', revision: 0 }),
  });
  const url = await serve(app, t);
  const page = await fetch(`${url}/qr`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('www-authenticate'), null);
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
  const html = await page.text();
  assert.match(html, /Conectar WhatsApp/);
  assert.match(html, /fetch\('\/qr\/status'/);
  assert.match(html, /fetch\('\/qr\/qr\.png'/);

  const status = await fetch(`${url}/qr/status`);
  assert.deepEqual(await status.json(), { state: 'waiting', revision: 0 });
  const health = await fetch(`${url}/health`);
  assert.equal(health.status, 503);

  const noQr = await fetch(`${url}/qr/qr.png`);
  assert.equal(noQr.status, 204);
  assert.equal(noQr.headers.get('cache-control'), 'no-store, no-cache, must-revalidate, private');
});
