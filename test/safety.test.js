'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { classifyCommand, resolveSafePath, validateCommandPaths, ConfirmationTokens } = require('../server/safety');

test('liste blanche Unix : commandes de consultation sans confirmation', () => {
  assert.equal(classifyCommand('ls -la', 'linux').level, 'safe');
  assert.equal(classifyCommand('git status', 'linux').level, 'safe');
  assert.equal(classifyCommand('ps -ef', 'linux').level, 'safe');
});

test('liste blanche Windows : commandes de consultation reconnues', () => {
  assert.equal(classifyCommand('dir C:\\Users', 'win32').level, 'safe');
  assert.equal(classifyCommand('tasklist /fo csv', 'win32').level, 'safe');
  assert.equal(classifyCommand('ipconfig', 'win32').level, 'safe');
});

test('les interpréteurs et les commandes inconnues demandent confirmation', () => {
  assert.equal(classifyCommand('node script.js', 'linux').level, 'confirm');
  assert.equal(classifyCommand('python3 outil.py', 'linux').level, 'confirm');
  assert.equal(classifyCommand('commande-inconnue --option', 'linux').level, 'confirm');
  assert.equal(classifyCommand('git push origin main', 'linux').level, 'confirm');
  assert.equal(classifyCommand('git branch nouvelle-fonction', 'linux').level, 'confirm');
  assert.equal(classifyCommand('find . -delete', 'linux').level, 'confirm');
  assert.equal(classifyCommand('find / -delete', 'linux').level, 'blocked');
});

test('bloque les commandes Unix destructrices sans exception', () => {
  for (const command of [
    'rm -rf /', 'rm -fr ~', 'mkfs.ext4 /dev/sda', 'dd if=/dev/zero of=/dev/sda',
    ':(){ :|:& };:', 'shutdown -h now', 'reboot', 'passwd', 'chmod -R 777 /',
  ]) assert.equal(classifyCommand(command, 'linux').level, 'blocked', command);
});

test('bloque les commandes Windows destructrices sans exception', () => {
  for (const command of [
    'format D:', 'diskpart', 'bcdedit /set test on', 'rd /s /q C:\\Users',
    'rmdir /s /q D:\\Data', 'del /s /q C:\\Temp', 'reg delete HKLM\\Software /f',
    'Remove-Item -Recurse C:\\',
  ]) assert.equal(classifyCommand(command, 'win32').level, 'blocked', command);
});

test('autorise un chemin dans la racine sans élargir le périmètre', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'nikous-path-'));
  const root = path.join(temporary, 'racine');
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'note.txt'), 'bonjour');
  const result = await resolveSafePath('note.txt', { root, fullAccess: false });
  assert.equal(result, path.join(root, 'note.txt'));
  await validateCommandPaths('cat note.txt', { root, fullAccess: false, platform: 'linux' });
  await assert.rejects(validateCommandPaths('cat /etc/passwd', { root, fullAccess: false, platform: 'linux' }), /sort du dossier autorisé/);
  await assert.rejects(validateCommandPaths('cat ./../../ailleurs/secret.txt', { root, fullAccess: false, platform: 'linux' }), /sort du dossier autorisé/);
  await fs.rm(temporary, { recursive: true, force: true });
});

test('refuse la traversée de dossier et les liens symboliques qui sortent de la racine', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'nikous-path-'));
  const root = path.join(temporary, 'racine');
  const outside = path.join(temporary, 'ailleurs');
  await fs.mkdir(root);
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'secret.txt'), 'privé');
  await assert.rejects(resolveSafePath('../ailleurs/secret.txt', { root }), /sort du dossier autorisé/);
  await fs.symlink(outside, path.join(root, 'raccourci'), 'dir');
  await assert.rejects(resolveSafePath('raccourci/secret.txt', { root }), /en dehors du dossier autorisé/);
  await fs.rm(temporary, { recursive: true, force: true });
});

test('jeton de confirmation à usage unique et durée limitée', async () => {
  let now = 1000;
  const tokens = new ConfirmationTokens({ ttl: 120_000, clock: () => now });
  const confirmation = tokens.create(async () => 'fait', 'confirmer ?', { kind: 'suppression' });
  assert.equal(confirmation.kind, 'suppression');
  assert.equal(tokens.take(confirmation.token).ok, true);
  assert.equal(tokens.take(confirmation.token).ok, false);
  const expired = tokens.create(async () => 'fait', 'confirmer ?');
  now += 120_001;
  assert.equal(tokens.take(expired.token).ok, false);
});
