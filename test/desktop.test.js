'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { toPercent, getApp } = require('../server/actions/desktop');
const { parseWhisperTranscriptLine, findWakeCommand, WakeWordAgent } = require('../server/wake-agent');

test('les commandes de poste valident les niveaux et limitent les applications', () => {
  assert.equal(toPercent('65'), 65);
  assert.throws(() => toPercent(-1), /entre 0 et 100/);
  assert.throws(() => toPercent(101), /entre 0 et 100/);
  assert.ok(getApp('Microsoft Word'));
  assert.equal(getApp('commande inconnue'), null);
});

test('le parseur whisper.cpp ne transmet une commande qu’après le mot d’activation', () => {
  const transcript = parseWhisperTranscriptLine('[00:00:03.100 --> 00:00:05.800] Nikous, verrouille mon écran');
  assert.equal(transcript, 'Nikous, verrouille mon écran');
  assert.deepEqual(findWakeCommand(transcript, 'Nikous'), { command: 'verrouille mon écran', normalized: 'nikous verrouille mon ecran' });
  assert.equal(findWakeCommand('verrouille mon écran', 'Nikous'), null);
  assert.equal(parseWhisperTranscriptLine('### microphone ready'), '');
});

test('la veille redémarre whisper.cpp avec la langue sélectionnée', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nikous-whisper-'));
  const modelPath = path.join(directory, 'ggml-small.bin');
  await fs.writeFile(modelPath, Buffer.alloc(1024 * 1024));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const invocations = [];
  const children = [];
  const spawn = (_executable, args) => {
    invocations.push(args);
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.killed = false;
    child.exitCode = null;
    child.signalCode = null;
    child.kill = () => {
      child.killed = true;
      child.signalCode = 'SIGTERM';
      queueMicrotask(() => child.emit('exit', null, 'SIGTERM'));
      return true;
    };
    children.push(child);
    setImmediate(() => child.emit('spawn'));
    return child;
  };
  const agent = new WakeWordAgent({ executable: '/mock/whisper-stream', modelPath, spawn, platform: 'linux' });
  t.after(() => agent.stop());
  assert.equal((await agent.start()).active, true);
  assert.equal(invocations[0][invocations[0].indexOf('-l') + 1], 'fr');
  await agent.setLanguage('es-ES');
  assert.equal(children[0].killed, true);
  assert.equal(invocations[1][invocations[1].indexOf('-l') + 1], 'es');
  assert.equal(agent.status().active, true);
  assert.equal((await agent.stop()).active, false);
});
