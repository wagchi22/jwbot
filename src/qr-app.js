const express = require('express');

const page = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Conectar WhatsApp - jwbot</title>
  <style>
    body { font: 16px system-ui, sans-serif; margin: 2rem auto; max-width: 32rem; padding: 0 1rem; text-align: center; }
    img { height: auto; image-rendering: pixelated; max-width: 100%; width: 320px; }
    [hidden] { display: none; }
  </style>
</head>
<body>
  <h1>Conectar WhatsApp</h1>
  <p id="status" role="status">Aguardando o QR code...</p>
  <img id="qr" alt="QR code para conectar o WhatsApp" hidden>
  <p>Escaneie em WhatsApp &gt; Aparelhos conectados &gt; Conectar aparelho.</p>
  <script>
    const status = document.querySelector('#status');
    const image = document.querySelector('#qr');
    let revision = -1;
    let imageUrl;

    function clearImage() {
      image.hidden = true;
      image.removeAttribute('src');
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      imageUrl = undefined;
    }

    async function refresh() {
      try {
        const response = await fetch('/qr/status', { cache: 'no-store' });
        if (!response.ok) throw new Error('Falha ao consultar o estado.');
        const state = await response.json();

        if (state.state === 'ready') {
          status.textContent = 'WhatsApp conectado.';
          clearImage();
          revision = state.revision;
        } else if (state.state === 'qr') {
          status.textContent = 'Escaneie o QR code com o WhatsApp.';
          if (revision !== state.revision) {
            const qrResponse = await fetch('/qr/qr.png', { cache: 'no-store' });
            if (qrResponse.status === 200) {
              const nextUrl = URL.createObjectURL(await qrResponse.blob());
              image.src = nextUrl;
              image.hidden = false;
              if (imageUrl) URL.revokeObjectURL(imageUrl);
              imageUrl = nextUrl;
              revision = state.revision;
            }
          }
        } else {
          status.textContent = 'Aguardando o QR code do WhatsApp...';
          clearImage();
          revision = state.revision;
        }
      } catch {
        status.textContent = 'Não foi possível carregar o QR code. Atualize a página.';
      }
      window.setTimeout(refresh, 2000);
    }

    refresh();
  </script>
</body>
</html>`;

function createQrApp({ apiToken, tokenMatches, getQrPng, getState }) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      'Pragma': 'no-cache',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });

    const encodedCredentials = req.get('authorization')?.match(/^Basic\s+(.+)$/i)?.[1];
    const credentials = encodedCredentials
      ? Buffer.from(encodedCredentials, 'base64').toString('utf8')
      : '';
    const separator = credentials.indexOf(':');
    const username = credentials.slice(0, separator);
    const password = separator < 0 ? '' : credentials.slice(separator + 1);
    if (username !== 'jwbot' || !tokenMatches(password, apiToken)) {
      res.set('WWW-Authenticate', 'Basic realm="jwbot QR", charset="UTF-8"');
      return res.status(401).type('text').send('Autenticação necessária.');
    }

    return next();
  });

  router.get('/', (_req, res) => res.type('html').send(page));
  router.get('/status', (_req, res) => res.json(getState()));
  router.get('/qr.png', (_req, res) => {
    const image = getQrPng();
    if (!image) return res.status(204).end();
    return res.type('png').send(image);
  });
  router.use((_req, res) => res.status(404).end());

  return router;
}

module.exports = { createQrApp };
