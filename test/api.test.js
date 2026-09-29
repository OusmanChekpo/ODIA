'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server');
const { classifyOpenTarget, classifyOpenTargetAsync, createWebSearchUrl } = require('../server/actions/system');

test('API bout en bout : interface, chat, confirmation, fichiers et événements SSE', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'nikous-api-'));
  const root = path.join(temporary, 'racine');
  const dataDir = path.join(temporary, 'data');
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(path.join(root, 'Documents'), { recursive: true });
  await fs.writeFile(path.join(root, 'Documents', 'rapport.xlsx'), 'classeur de test');
  const openDocument = await classifyOpenTargetAsync('Documents/rapport.xlsx', { root, fullAccess: false, platform: process.platform }, 'path');
  assert.equal(openDocument.level, 'safe');
  assert.equal(openDocument.type, 'path');
  const openByName = await classifyOpenTargetAsync('rapport.xlsx', { root, fullAccess: false, platform: process.platform }, 'path');
  assert.equal(openByName.level, 'safe');
  assert.equal(openByName.isDirectory, false);
  await fs.writeFile(path.join(root, 'outil.sh'), '# script de test, jamais exécuté');
  const executableOpen = await classifyOpenTargetAsync('outil.sh', { root, fullAccess: false, platform: process.platform }, 'path');
  assert.equal(executableOpen.level, 'confirm');
  const outsideOpen = await classifyOpenTargetAsync('../outside.txt', { root, fullAccess: false, platform: process.platform }, 'path');
  assert.equal(outsideOpen.level, 'blocked');
  const openFolder = await classifyOpenTargetAsync('mes documents', { root, fullAccess: false, platform: process.platform }, 'path');
  assert.equal(openFolder.level, 'safe');
  assert.equal(openFolder.type, 'path');
  assert.equal(openFolder.isDirectory, true);
  assert.equal(classifyOpenTarget('Word', 'win32').level, 'safe');
  assert.equal(classifyOpenTarget('Excel', 'win32').level, 'safe');
  const search = createWebSearchUrl('météo Cotonou & pluie');
  assert.equal(new URL(search.url).searchParams.get('q'), 'météo Cotonou & pluie');
  const app = await createApp({ root, dataDir, publicDir: path.resolve(__dirname, '..', 'public'), forcedFullAccess: false });
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(0, '127.0.0.1', resolve);
  });
  const address = app.server.address();
  const base = `http://127.0.0.1:${address.port}`;
  const streamController = new AbortController();
  t.after(async () => {
    streamController.abort();
    await app.close();
    await fs.rm(temporary, { recursive: true, force: true });
  });

  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  const pageHtml = await page.text();
  assert.match(pageHtml, /NIKOUS/);
  assert.match(pageHtml, /Démarrer la conversation vocale locale/);
  assert.match(page.headers.get('permissions-policy') || '', /microphone=\(self\)/);
  assert.match(page.headers.get('permissions-policy') || '', /on-device-speech-recognition=\(self\)/);
  const appScript = await fetch(`${base}/app.js`);
  assert.equal(appScript.status, 200);
  const appSource = await appScript.text();
  assert.match(appSource, /recognition\.processLocally = true/);
  assert.match(appSource, /voice\.localService === true/);
  assert.doesNotMatch(appSource, /processLocally\s*=\s*false/);
  const capabilitiesResponse = await fetch(`${base}/api/capabilities`);
  assert.equal(capabilitiesResponse.status, 200);
  const capabilities = await capabilitiesResponse.json();
  assert.equal(capabilities.localAI.local, true);
  assert.equal(capabilities.agent.engine, 'whisper.cpp');
  assert.equal(capabilities.agent.active, false);
  const languageResponse = await fetch(`${base}/api/settings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: 'en-US' }),
  });
  assert.equal(languageResponse.status, 200);
  assert.equal((await languageResponse.json()).language, 'en-US');
  await fetch(`${base}/api/settings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: 'fr-FR' }),
  });
  const wakeResponse = await fetch(`${base}/api/settings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wakeWord: true }),
  });
  assert.equal(wakeResponse.status, 409);

  async function chat(message) {
    const response = await fetch(`${base}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }),
    });
    assert.equal(response.status, 200);
    return response.json();
  }

  const created = await chat('crée fichier bonjour.txt avec salut, Élodie');
  assert.match(created.text, /bonjour\.txt/);
  assert.match(await fs.readFile(path.join(root, 'bonjour.txt'), 'utf8'), /salut, Élodie/);

  const read = await chat('lis bonjour.txt');
  assert.equal(read.blocks[0].value, 'salut, Élodie');

  const deletion = await chat('supprime fichier bonjour.txt');
  assert.match(deletion.text, /Juste pour être sûr/);
  assert.ok(deletion.confirmation && deletion.confirmation.token);
  const confirmed = await fetch(`${base}/api/confirm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: deletion.confirmation.token, approved: true }),
  });
  assert.equal(confirmed.status, 200);
  assert.match((await confirmed.json()).text, /supprimé/);
  await assert.rejects(fs.access(path.join(root, 'bonjour.txt')));

  const eventResponse = await fetch(`${base}/api/events`, { signal: streamController.signal });
  assert.equal(eventResponse.status, 200);
  assert.match(eventResponse.headers.get('content-type'), /text\/event-stream/);
  const reader = eventResponse.body.getReader();
  const decoder = new TextDecoder();
  let eventText = '';
  eventText += decoder.decode((await reader.read()).value || new Uint8Array());
  await chat('rappelle-moi dans 1 seconde de vérifier le flux SSE');
  const deadline = Date.now() + 5000;
  while (!eventText.includes('Petit rappel') && Date.now() < deadline) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Délai SSE dépassé')), Math.max(1, deadline - Date.now()))),
    ]);
    if (chunk.done) break;
    eventText += decoder.decode(chunk.value || new Uint8Array());
  }
  assert.match(eventText, /Petit rappel/);
  assert.match(eventText, /vérifier le flux SSE/);
  await reader.cancel();
});
