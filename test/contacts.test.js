'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ContactsService, normalizeInternationalPhone } = require('../server/actions/contacts');
const system = require('../server/actions/system');
const { Executor } = require('../server/executor');

test('contacts locaux et brouillon WhatsApp exigent une confirmation sans lancer WhatsApp', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'nikous-contacts-'));
  const dataDir = path.join(temporary, 'data');
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));

  const contacts = await new ContactsService({ dataDir }).init();
  await contacts.add('Papa', '+229 97 00 00 00');
  assert.equal(normalizeInternationalPhone('00229 97 00 00 00'), '+22997000000');
  assert.throws(() => normalizeInternationalPhone('97000000'), (error) => error.message.includes('format +'));
  const draft = contacts.prepareWhatsApp('papa', 'Je suis en retard');
  assert.equal(new URL(draft.url).searchParams.get('text'), 'Je suis en retard');
  assert.equal(new URL(draft.url).hostname, 'wa.me');

  const executor = await new Executor({ root: temporary, dataDir, forcedFullAccess: false }).init();
  t.after(() => executor.stop());
  const result = await executor.execute('Dis à papa que je suis en retard');
  assert.ok(result.confirmation && result.confirmation.token);
  assert.ok(result.text.includes('numéro du contact et le texte'));
  assert.ok(result.text.includes('appuyer toi-même sur **Envoyer**'));
  assert.deepEqual(executor.contacts.list().map((item) => item.name), ['Papa']);
});

test('la confirmation vocale ouvre un brouillon WhatsApp mais ne simule jamais son envoi', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'nikous-voice-confirm-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const originalOpenTarget = system.openTarget;
  let openedUrl = null;
  system.openTarget = async (url) => { openedUrl = url; return { text: 'brouillon localement ouvert' }; };
  t.after(() => { system.openTarget = originalOpenTarget; });

  const events = [];
  const executor = await new Executor({ root: temporary, dataDir: path.join(temporary, 'data'), forcedFullAccess: false, emit: (event) => events.push(event) }).init();
  t.after(() => executor.stop());
  await executor.contacts.add('Papa', '+229 97 00 00 00');
  const prompt = await executor.handleWakeWordInput('Dis à papa que je suis en retard');
  assert.ok(prompt.confirmation && executor.agentConfirmation);
  const result = await executor.handleWakeWordInput('oui');
  assert.equal(new URL(openedUrl).hostname, 'wa.me');
  assert.match(result.text, /n’a pas été envoyé automatiquement/);
  assert.equal(executor.agentConfirmation, null);
  assert.equal(events.at(-1).confirmationResolved, true);
});
