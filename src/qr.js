const qrcode = require('qrcode-terminal');

function renderQr(qr) {
  let output;
  qrcode.generate(qr, {}, (terminalQr) => {
    output = terminalQr
      .replace(/\u001b\[40m  \u001b\[0m/g, '##')
      .replace(/\u001b\[47m  \u001b\[0m/g, '  ');
  });
  return output;
}

module.exports = { renderQr };
