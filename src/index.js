require('dotenv').config({ quiet: true });

const crypto = require('node:crypto');
const http = require('node:http');
const express = require('express');
const { createQrApp } = require('./qr-app');
const { renderQrPng } = require('./qr');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { formatNotification } = require('./notifications');
const { sendWhatsAppMessage } = require('./whatsapp');
const { logError, logInfo } = require('./logger');

function readConfig(env = process.env) {
  const apiToken = env.API_TOKEN?.trim();
  if (!apiToken) throw new Error('Defina API_TOKEN no ambiente antes de iniciar');

  const recipients = (env.WA_RECIPIENTS || '')
    .split(',')
    .map((number) => number.replace(/\D/g, ''))
    .filter(Boolean);
  if (recipients.length === 0) {
    throw new Error('Defina ao menos um número em WA_RECIPIENTS');
  }
  if (recipients.some((number) => number.length < 8 || number.length > 15)) {
    throw new Error('Cada número em WA_RECIPIENTS deve ter entre 8 e 15 dígitos');
  }

  const selfPhoneNumber = (env.WA_SELF_NUMBER || '').replace(/\D/g, '') || null;
  if (selfPhoneNumber && (selfPhoneNumber.length < 8 || selfPhoneNumber.length > 15)) {
    throw new Error('WA_SELF_NUMBER deve ter entre 8 e 15 dígitos');
  }

  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT deve ser um número inteiro entre 1 e 65535');
  }

  const dedupeWindowSeconds = Number(env.WA_DEDUPE_WINDOW_SECONDS || 300);
  if (
    !Number.isInteger(dedupeWindowSeconds)
    || dedupeWindowSeconds < 0
    || dedupeWindowSeconds > 86400
  ) {
    throw new Error('WA_DEDUPE_WINDOW_SECONDS deve ser um inteiro entre 0 e 86400');
  }

  const authTimeoutMs = Number(env.WA_AUTH_TIMEOUT_MS || 120000);
  if (!Number.isInteger(authTimeoutMs) || authTimeoutMs < 1000 || authTimeoutMs > 600000) {
    throw new Error('WA_AUTH_TIMEOUT_MS deve ser um inteiro entre 1000 e 600000');
  }

  return {
    apiToken,
    port,
    recipients: [...new Set(recipients)],
    selfPhoneNumber,
    dedupeWindowMs: dedupeWindowSeconds * 1000,
    authTimeoutMs,
  };
}

function tokenMatches(candidate, expected) {
  if (!candidate) return false;
  const candidateHash = crypto.createHash('sha256').update(candidate).digest();
  const expectedHash = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(candidateHash, expectedHash);
}

function isWhatsAppStreamReady(state) {
  return state?.connectionState === 'CONNECTED'
    && state?.libraryInjected === true
    && state?.streamMode === state?.mainMode
    && state?.displayInfoIsNormal === true
    && state?.hasSynced === true;
}

function listenForRequests(app, port, host) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    const onError = (error) => {
      server.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve(server);
    };

    server.once('error', onError);
    server.once('listening', onListening);
    if (host) server.listen(port, host);
    else server.listen(port);
  });
}

function createApp({
  client,
  recipients,
  apiToken,
  isReady,
  selfPhoneNumber,
  dedupeWindowMs = 300000,
  qr,
}) {
  const app = express();
  app.disable('x-powered-by');
  const recentEvents = new Map();
  app.use(express.json({ limit: '64kb' }));
  app.use(express.text({
    type: ['text/plain', 'application/x-www-form-urlencoded'],
    limit: '64kb',
  }));
  app.use((req, res, next) => {
    if (typeof req.body !== 'string') return next();

    const body = req.body.trim();
    if (body.startsWith('{') || body.startsWith('[')) {
      try {
        req.body = JSON.parse(body);
        return next();
      } catch (error) {
        return next(error);
      }
    }

    if (req.is('application/x-www-form-urlencoded')) {
      req.body = Object.fromEntries(new URLSearchParams(body));
    }
    return next();
  });

  app.get('/health', (_req, res) => {
    res.status(isReady() ? 200 : 503).json({
      status: isReady() ? 'ready' : 'connecting',
      whatsapp: isReady() ? 'connected' : 'disconnected',
    });
  });

  app.post('/api/notifications', async (req, res) => {
    const authorization = req.get('authorization') || '';
    const bearerToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
    const bodyToken = req.body && typeof req.body === 'object'
      ? req.body.apiToken || req.body.ApiToken
      : undefined;
    const suppliedToken = bearerToken || req.get('x-api-key') || bodyToken;
    if (!tokenMatches(suppliedToken, apiToken)) {
      logError('Token inválido no webhook');
      return res.status(401).json({ error: 'Token ausente ou inválido' });
    }

    if (!isReady()) {
      logError('WhatsApp offline');
      return res.status(503).json({ error: 'WhatsApp ainda não está conectado' });
    }

    let targetRecipients = recipients;
    if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
      const requestedRecipient = req.body.recipient;
      if (requestedRecipient !== undefined) {
        if (typeof requestedRecipient !== 'string') {
          logError('Destinatário inválido');
          return res.status(400).json({ error: 'recipient deve ser um número configurado' });
        }
        const normalizedRecipient = requestedRecipient.replace(/\D/g, '');
        if (!recipients.includes(normalizedRecipient)) {
          logError('Destinatário não configurado');
          return res.status(400).json({ error: 'recipient não está na lista de destinatários configurados' });
        }
        targetRecipients = [normalizedRecipient];
      }
    }

    let message;
    try {
      message = formatNotification(req.body);
    } catch (error) {
      logError(
        'Webhook sem mensagem válida',
        error instanceof Error ? error.message : String(error),
      );
      return res.status(400).json({ error: error.message });
    }

    const eventType = req.body && typeof req.body === 'object'
      ? req.body.notificationType || req.body.NotificationType
      : undefined;
    const itemId = req.body && typeof req.body === 'object'
      ? req.body.itemId || req.body.ItemId || req.body.ItemID
      : undefined;
    let dedupeKey;
    if (
      dedupeWindowMs > 0
      && typeof eventType === 'string'
      && eventType
      && typeof itemId === 'string'
      && itemId
    ) {
      const now = Date.now();
      for (const [key, expiresAt] of recentEvents) {
        if (expiresAt <= now) recentEvents.delete(key);
      }
      dedupeKey = JSON.stringify([eventType, itemId, [...targetRecipients].sort()]);
      if (recentEvents.has(dedupeKey)) {
        logInfo('Duplicado ignorado');
        return res.status(200).json({ sent: 0, duplicate: true });
      }
      recentEvents.set(dedupeKey, now + dedupeWindowMs);
    }

    logInfo('Webhook recebido');
    const deliveries = await Promise.allSettled(
      targetRecipients.map((number) => sendWhatsAppMessage(
        client,
        number,
        message,
        selfPhoneNumber,
      )),
    );
    const failed = deliveries
      .map((result, index) => ({ result, recipient: targetRecipients[index] }))
      .filter(({ result }) => result.status === 'rejected');

    if (failed.length > 0) {
      if (dedupeKey) recentEvents.delete(dedupeKey);
      const reasons = failed.map(({ result }) => {
        const reason = result.status === 'rejected'
          ? result.reason?.message || String(result.reason)
          : 'Erro desconhecido';
        return reason;
      }).join('; ');
      logError(`Falha no envio: ${reasons}`);
      return res.status(502).json({
        error: 'Não foi possível entregar a notificação a todos os destinatários',
        sent: targetRecipients.length - failed.length,
        failed: failed.length,
      });
    }

    logInfo(`Enviado para ${targetRecipients.length} destinatário(s)`);
    return res.status(200).json({ sent: targetRecipients.length });
  });

  if (qr) app.use('/qr', createQrApp(qr));

  app.use((error, _req, res, _next) => {
    if (error instanceof SyntaxError && 'body' in error) {
      return res.status(400).json({ error: 'JSON inválido' });
    }
    logError(
      'Erro na API:',
      error instanceof Error ? error.message : String(error),
    );
    return res.status(500).json({ error: 'Erro interno da API' });
  });

  return app;
}

async function start() {
  const config = readConfig();
  let whatsappReady = false;
  let qrImage;
  let qrRevision = 0;
  let readinessInterval;
  let readinessDiagnosticTimeout;
  const client = new Client({
    authStrategy: new LocalAuth(),
    authTimeoutMs: config.authTimeoutMs,
    puppeteer: {
      handleSIGINT: false,
      dumpio: false,
      args: process.env.PUPPETEER_NO_SANDBOX === '1' ? ['--no-sandbox', '--disable-setuid-sandbox'] : [],
    },
  });

  const markWhatsAppReady = () => {
    clearTimeout(readinessDiagnosticTimeout);
    if (whatsappReady) return;
    whatsappReady = true;
    qrImage = null;
    qrRevision += 1;
    logInfo('WhatsApp conectado');
  };

  client.on('qr', (qr) => {
    const revision = ++qrRevision;
    qrImage = null;
    renderQrPng(qr).then((image) => {
      if (revision !== qrRevision) return;
      qrImage = image;
      qrRevision += 1;
    }).catch((error) => {
      if (revision !== qrRevision) return;
      logError(`Falha ao gerar QR: ${error.message}`);
    });
  });
  client.on('ready', markWhatsAppReady);
  client.on('change_state', (state) => {
    logInfo(`WhatsApp: ${state}`);
    if (state !== 'CONNECTED') whatsappReady = false;
  });
  client.on('auth_failure', (message) => {
    whatsappReady = false;
    qrImage = null;
    qrRevision += 1;
    logError(`Falha ao autenticar WhatsApp: ${message}`);
  });
  client.on('disconnected', (reason) => {
    whatsappReady = false;
    qrImage = null;
    qrRevision += 1;
    logError(`WhatsApp desconectado: ${reason}`);
  });

  const qr = {
    getQrPng: () => qrImage,
    getState: () => ({
      state: whatsappReady ? 'ready' : qrImage ? 'qr' : 'waiting',
      revision: qrRevision,
    }),
  };
  const app = createApp({
    client,
    recipients: config.recipients,
    apiToken: config.apiToken,
    isReady: () => whatsappReady,
    selfPhoneNumber: config.selfPhoneNumber,
    dedupeWindowMs: config.dedupeWindowMs,
    qr,
  });
  let server;
  try {
    server = await listenForRequests(app, config.port);
  } catch (error) {
    if (error.code === 'EADDRINUSE') {
      throw new Error(
        `A porta ${config.port} já está em uso. Encerre a outra instância do bot ou altere PORT no .env`,
      );
    }
    throw error;
  }
  logInfo(`API iniciada na porta ${config.port}`);
  logInfo(`QR code disponível em http://localhost:${config.port}/qr`);

  let readinessCheckRunning = false;
  readinessInterval = setInterval(async () => {
    if (whatsappReady || readinessCheckRunning || !client.pupPage || client.pupPage.isClosed()) {
      return;
    }

    readinessCheckRunning = true;
    try {
      const state = await client.pupPage.evaluate(() => {
        const libraryInjected = typeof window.WWebJS !== 'undefined';
        if (!libraryInjected) return { libraryInjected };

        let connectionState = 'indisponível';
        try {
          connectionState = window.require('WAWebSocketModel').Socket.state;
        } catch {
          connectionState = 'módulo do WhatsApp ainda não carregado';
        }

        const result = {
          connectionState,
          libraryInjected,
        };
        try {
          const { Stream, StreamInfo, StreamMode } = window.require('WAWebStreamModel');
          const getterModule = window.require('WAWebStreamGetters');
          const getterDisplayInfo = getterModule?.getDisplayInfo?.(Stream);
          const displayInfo = getterDisplayInfo ?? Stream.displayInfo;
          Object.assign(result, {
            streamMode: Stream.mode,
            mainMode: StreamMode.MAIN,
            displayInfoIsNormal: displayInfo === StreamInfo.NORMAL,
            hasSynced: Stream.hasSynced,
          });
        } catch {
          return result;
        }
        return result;
      });

      if (isWhatsAppStreamReady(state)) markWhatsAppReady();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/target closed|execution context was destroyed|cannot find context/i.test(message)) {
        logError(`Falha ao verificar WhatsApp: ${message}`);
      }
    } finally {
      readinessCheckRunning = false;
    }
  }, 1000);
  readinessInterval.unref();

  client.initialize().catch((error) => {
    logError(`Falha ao iniciar WhatsApp: ${error}`);
    clearInterval(readinessInterval);
    server.close(() => process.exit(1));
  });

  readinessDiagnosticTimeout = setTimeout(() => {
    if (!whatsappReady && !qrImage) logError('WhatsApp indisponível');
  }, 45000);
  readinessDiagnosticTimeout.unref();

  const shutdown = async () => {
    clearTimeout(readinessDiagnosticTimeout);
    clearInterval(readinessInterval);
    server.close();
    await client.destroy();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (require.main === module) {
  start().catch((error) => {
    logError(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  createApp,
  createQrApp,
  isWhatsAppStreamReady,
  listenForRequests,
  readConfig,
  start,
  tokenMatches,
};
