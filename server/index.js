'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Executor, defaultRoot } = require('./executor');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};
const MAX_BODY_BYTES = 1024 * 1024;

function sendJson(response, statusCode, data) {
  const body = Buffer.from(`${JSON.stringify(data)}\n`);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  response.end(body);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Le message est trop volumineux.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Le corps de la requête doit être un objet JSON valide.');
    error.statusCode = 400;
    throw error;
  }
}

async function createApp(options = {}) {
  const platform = options.platform || process.platform;
  const root = path.resolve(options.root || process.env.NIKOUS_ROOT || defaultRoot(platform));
  const dataDir = options.dataDir || path.resolve(__dirname, '..', 'data');
  const publicDir = path.resolve(options.publicDir || path.resolve(__dirname, '..', 'public'));
  await fs.mkdir(root, { recursive: true });
  const clients = new Set();

  const executor = new Executor({
    root,
    dataDir,
    platform,
    fullAccess: options.fullAccess,
    forcedFullAccess: options.forcedFullAccess,
    clock: options.clock,
    emit: (event) => {
      const payload = `data: ${JSON.stringify(event)}\n\n`;
      for (const client of clients) {
        try { client.write(payload); } catch { clients.delete(client); }
      }
    },
  });
  await executor.init();

  const server = http.createServer(async (request, response) => {
    const baseHeaders = {
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'microphone=(self), on-device-speech-recognition=(self)',
    };
    try {
      const url = new URL(request.url || '/', 'http://nikous.local');
      const pathname = decodeURIComponent(url.pathname);

      if (pathname.startsWith('/api/')) {
        if (pathname === '/api/events' && request.method === 'GET') {
          response.writeHead(200, {
            ...baseHeaders,
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          });
          response.write('retry: 3000\n: NIKOUS est connecté\n\n');
          clients.add(response);
          const keepAlive = setInterval(() => {
            try { response.write(': ping\n\n'); } catch { clearInterval(keepAlive); }
          }, 20_000);
          if (keepAlive.unref) keepAlive.unref();
          response.on('close', () => {
            clearInterval(keepAlive);
            clients.delete(response);
          });
          return;
        }

        if (pathname === '/api/health' && request.method === 'GET') {
          sendJson(response, 200, { ok: true, name: 'NIKOUS', version: '1.0.0', ...executor.getSettings() });
          return;
        }
        if (pathname === '/api/settings' && request.method === 'GET') {
          sendJson(response, 200, executor.getSettings());
          return;
        }
        if (pathname === '/api/settings' && request.method === 'POST') {
          const body = await readJsonBody(request);
          if (typeof body.fullAccess !== 'boolean') {
            sendJson(response, 400, { error: 'Le réglage fullAccess doit être un booléen.' });
            return;
          }
          sendJson(response, 200, await executor.setFullAccess(body.fullAccess));
          return;
        }
        if (pathname === '/api/history' && request.method === 'GET') {
          sendJson(response, 200, { items: await executor.history() });
          return;
        }
        if (pathname === '/api/chat' && request.method === 'POST') {
          const body = await readJsonBody(request);
          if (typeof body.message !== 'string' || !body.message.trim()) {
            sendJson(response, 400, { error: 'Écris un message avant de l’envoyer.' });
            return;
          }
          const result = await executor.execute(body.message);
          sendJson(response, 200, result);
          return;
        }
        if (pathname === '/api/confirm' && request.method === 'POST') {
          const body = await readJsonBody(request);
          if (typeof body.token !== 'string' || typeof body.approved !== 'boolean') {
            sendJson(response, 400, { error: 'La confirmation doit contenir un jeton et un choix explicite.' });
            return;
          }
          const result = await executor.confirm(body.token, body.approved);
          sendJson(response, 200, result);
          return;
        }
        sendJson(response, 404, { error: 'Cette route API n’existe pas.' });
        return;
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendJson(response, 405, { error: 'Cette méthode HTTP n’est pas disponible pour les fichiers statiques.' });
        return;
      }
      const requested = pathname === '/' ? '/index.html' : pathname;
      const filePath = path.resolve(publicDir, `.${requested}`);
      const relative = path.relative(publicDir, filePath);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        sendJson(response, 403, { error: 'Chemin interdit.' });
        return;
      }
      let stat;
      try { stat = await fs.stat(filePath); }
      catch { sendJson(response, 404, { error: 'Fichier introuvable.' }); return; }
      if (!stat.isFile()) { sendJson(response, 404, { error: 'Fichier introuvable.' }); return; }
      const body = await fs.readFile(filePath);
      response.writeHead(200, {
        ...baseHeaders,
        'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Content-Length': body.length,
        'Cache-Control': path.basename(filePath) === 'index.html' ? 'no-cache' : 'public, max-age=300',
      });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const statusCode = error && error.statusCode ? error.statusCode : 500;
      sendJson(response, statusCode, { error: error && error.message ? error.message : 'Erreur interne du serveur.' });
    }
  });

  async function close() {
    executor.stop();
    for (const client of clients) client.end();
    clients.clear();
    if (server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  return { server, executor, close };
}

if (require.main === module) {
  createApp().then(({ server }) => {
    const host = process.env.HOST || '127.0.0.1';
    const port = Number(process.env.PORT || 3000);
    server.listen(port, host, () => {
      const address = server.address();
      const shownHost = host === '0.0.0.0' ? '0.0.0.0' : host;
      console.log(`NIKOUS est prêt sur http://${shownHost}:${address.port}`);
      console.log(`Racine autorisée : ${process.env.NIKOUS_ROOT || defaultRoot()}`);
      console.log(`Mode : ${process.env.NIKOUS_FULL_ACCESS === '1' ? 'accès complet demandé au démarrage' : 'sûr par défaut'}`);
    });
  }).catch((error) => {
    console.error(`Impossible de démarrer NIKOUS : ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { createApp, readJsonBody, sendJson };
