const test = require('node:test');
const assert = require('node:assert/strict');
const { renderQrPng } = require('../src/qr');

test('renders a QR code as a compact PNG image', async () => {
  const image = await renderQrPng('https://example.test/whatsapp');

  assert.ok(Buffer.isBuffer(image));
  assert.deepEqual(image.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(image.readUInt32BE(16), 320);
  assert.equal(image.readUInt32BE(20), 320);
});
