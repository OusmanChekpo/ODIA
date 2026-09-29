'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { LocalAIService } = require('../server/local-ai');
const { Executor } = require('../server/executor');

test('Ollama reste strictement locale et fournit un routage JSON', async () => {
  const requests = [];
  const service = new LocalAIService({
    model: 'gemma3:4b',
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      if (url.endsWith('/api/tags')) return { ok: true, json: async () => ({ models: [{ name: 'gemma3:4b' }] }) };
      return { ok: true, json: async () => ({ message: { content: JSON.stringify({ kind: 'reply', reply: 'Réponse hors ligne.' }) } }) };
    },
  });

  const status = await service.status();
  assert.equal(status.ready, true);
  assert.equal(status.local, true);
  const result = await service.route('What is a nebula?', []);
  assert.deepEqual(result, { kind: 'reply', reply: 'Réponse hors ligne.' });
  assert.ok(requests.every(({ url }) => url.startsWith('http://127.0.0.1:11434/')));
  const payload = JSON.parse(requests[1].options.body);
  assert.equal(payload.model, 'gemma3:4b');
  assert.equal(payload.stream, false);
  assert.equal(payload.format, 'json');
});

test('Ollama refuse les hôtes distants et signale un modèle absent', async () => {
  assert.throws(() => new LocalAIService({ baseUrl: 'https://example.com:11434' }), /loopback/);
  const service = new LocalAIService({ fetch: async () => ({ ok: true, json: async () => ({ models: [] }) }) });
  const status = await service.status();
  assert.equal(status.serverAvailable, true);
  assert.equal(status.modelInstalled, false);
  assert.equal(status.ready, false);
});

test('un message dans une autre langue passe par le modèle local puis revient au NLU sûr', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'nikous-language-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  let selectedLanguage = '';
  const localAI = {
    status: async () => ({ ready: true, local: true }),
    route: async (_message, _history, language) => {
      selectedLanguage = language;
      return { kind: 'action', command: 'calcule sqrt(81)' };
    },
    translateReply: async (_text, language) => language === 'en-US' ? 'The result is nine.' : null,
  };
  const executor = await new Executor({ root: temporary, dataDir: path.join(temporary, 'data'), localAI, forcedFullAccess: false }).init();
  t.after(() => executor.stop());
  const result = await executor.execute('What is the square root of eighty one?', { language: 'en-US' });
  assert.equal(selectedLanguage, 'en-US');
  assert.equal(result.text, 'The result is nine.');
});

test('les cartes de confirmation sont aussi traduites par le modèle local', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'nikous-confirm-language-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const filePath = path.join(temporary, 'note.txt');
  await fs.writeFile(filePath, 'local', 'utf8');
  const localAI = {
    status: async () => ({ ready: true, local: true }),
    route: async () => ({ kind: 'action', command: 'supprime fichier note.txt' }),
    translateReply: async (text, language) => language === 'en-US' ? `English: ${text}` : null,
  };
  const executor = await new Executor({ root: temporary, dataDir: path.join(temporary, 'data'), localAI, forcedFullAccess: false }).init();
  t.after(() => executor.stop());
  const prompt = await executor.execute('Delete note.txt', { language: 'en-US' });
  assert.match(prompt.text, /^English:/);
  const confirmation = await executor.confirm(prompt.confirmation.token, true, { language: 'en-US' });
  assert.match(confirmation.text, /^English:/);
  await assert.rejects(fs.stat(filePath), { code: 'ENOENT' });
});

test('le routeur local ne peut déclencher que des actions reconnues par le NLU existant', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'nikous-local-ai-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  let routedMessage = '';
  const localAI = {
    status: async () => ({ ready: true, local: true }),
    route: async (message) => {
      routedMessage = message;
      return { kind: 'action', command: 'calcule sqrt(81)' };
    },
  };
  const executor = await new Executor({ root: temporary, dataDir: path.join(temporary, 'data'), localAI, forcedFullAccess: false }).init();
  t.after(() => executor.stop());
  const result = await executor.execute('calculate the square root of eighty one');
  assert.match(routedMessage, /square root/);
  assert.match(result.text, /9/);
  assert.equal(result.source, undefined);
});
