const test = require('node:test');
const assert = require('node:assert/strict');
const { renderQr } = require('../src/qr');

test('renders a QR code as plain ASCII rows for Docker log viewers', () => {
  const output = renderQr('https://example.test/whatsapp');
  const rows = output.split('\n');

  assert.doesNotMatch(output, /\u001b\[/);
  assert.match(output, /^[# \r\n]+$/);
  assert.match(output, /#/);
  assert.ok(rows.every((row) => row.length === rows[0].length));
  assert.equal(rows[0].length, rows.length * 2);
});
