const qrcode = require('qrcode-terminal');

function renderQr(qr) {
  let terminalQr;
  qrcode.generate(qr, { small: true }, (output) => {
    terminalQr = output;
  });

  const rows = terminalQr.split('\n').slice(1, -1);
  const lightBackground = { '█': ' ', '▀': '▄', '▄': '▀', ' ': '█' };
  const dataRows = rows.map((row) => row.replace(/[█▀▄ ]/g, (cell) => lightBackground[cell]));
  const width = dataRows[0].length + 6;
  const padding = ' '.repeat(width);

  return [
    padding,
    padding,
    ...dataRows.map((row) => `   ${row}   `),
    padding,
    padding,
  ].join('\n');
}

module.exports = { renderQr };
