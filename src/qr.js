const QRCode = require('qrcode');

function renderQrPng(qr) {
  return QRCode.toBuffer(qr, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 4,
    width: 320,
    color: {
      dark: '#000000',
      light: '#ffffff',
    },
  });
}

module.exports = { renderQrPng };
