const test = require('node:test');
const assert = require('node:assert/strict');
const { renderQr } = require('../src/qr');

test('renders a compact, light-background QR with a quiet zone for Docker logs', () => {
  const output = renderQr('https://example.test/whatsapp');
  const rows = output.split('\n');

  assert.doesNotMatch(output, /\u001b\[/);
  assert.match(output, /^[ █▀▄\r\n]+$/);
  assert.match(output, /[█▀▄]/);
  assert.ok(rows.every((row) => row.length === rows[0].length));
  assert.equal(rows[0].length, rows.length * 2 - 1);
  assert.ok(rows.slice(0, 2).every((row) => /^\s+$/.test(row)));
  assert.ok(rows.slice(-2).every((row) => /^\s+$/.test(row)));
  assert.ok(rows[2].startsWith('    '));
  assert.ok(rows[2].endsWith('    '));
});
