'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { spawn } = require('node:child_process');
const { commandTokens, resolveSafePath } = require('../safety');

const execFileAsync = promisify(execFile);
const WINDOWS_APPS = new Map([
  ['bloc-notes', 'notepad.exe'], ['notepad', 'notepad.exe'],
  ['calculatrice', 'calc.exe'], ['calculator', 'calc.exe'],
  ['explorateur', 'explorer.exe'], ['explorer', 'explorer.exe'],
  ['word', 'winword.exe'], ['microsoft-word', 'winword.exe'],
  ['excel', 'excel.exe'], ['microsoft-excel', 'excel.exe'],
  ['powerpoint', 'powerpnt.exe'], ['microsoft-powerpoint', 'powerpnt.exe'],
  ['paint', 'mspaint.exe'], ['microsoft-paint', 'mspaint.exe'],
]);
const MAC_APPS = new Map([
  ['bloc-notes', 'TextEdit'], ['notepad', 'TextEdit'],
  ['calculatrice', 'Calculator'], ['calculator', 'Calculator'],
  ['explorateur', 'Finder'], ['explorer', 'Finder'],
  ['word', 'Microsoft Word'], ['microsoft-word', 'Microsoft Word'],
  ['excel', 'Microsoft Excel'], ['microsoft-excel', 'Microsoft Excel'],
  ['powerpoint', 'Microsoft PowerPoint'], ['microsoft-powerpoint', 'Microsoft PowerPoint'],
]);
const LINUX_APPS = new Map([
  ['bloc-notes', { command: 'gedit', args: [] }], ['notepad', { command: 'gedit', args: [] }],
  ['calculatrice', { command: 'gnome-calculator', args: [] }], ['calculator', { command: 'gnome-calculator', args: [] }],
  ['explorateur', { command: 'xdg-open', args: [os.homedir()] }], ['explorer', { command: 'xdg-open', args: [os.homedir()] }],
  ['word', { command: 'libreoffice', args: ['--writer'] }], ['microsoft-word', { command: 'libreoffice', args: ['--writer'] }],
  ['excel', { command: 'libreoffice', args: ['--calc'] }], ['microsoft-excel', { command: 'libreoffice', args: ['--calc'] }],
  ['powerpoint', { command: 'libreoffice', args: ['--impress'] }], ['microsoft-powerpoint', { command: 'libreoffice', args: ['--impress'] }],
]);
const USER_FOLDERS = new Map([
  ['documents', 'Documents'], ['mes-documents', 'Documents'], ['document', 'Documents'],
  ['bureau', 'Desktop'], ['desktop', 'Desktop'],
  ['telechargements', 'Downloads'], ['download', 'Downloads'], ['downloads', 'Downloads'],
  ['images', 'Pictures'], ['photos', 'Pictures'], ['pictures', 'Pictures'],
  ['videos', 'Videos'], ['video', 'Videos'], ['musique', 'Music'], ['music', 'Music'],
]);

function normalizeOpenName(value) {
  return String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr-FR').trim().replace(/\s+/g, '-');
}

function cleanOpenPath(value) {
  let result = String(value || '').trim();
  if ((result.startsWith('"') && result.endsWith('"')) || (result.startsWith("'") && result.endsWith("'"))) result = result.slice(1, -1).trim();
  result = result.replace(/^(?:(?:mon|ma|mes|le|la|les|du|des|de)\s+)+/i, '');
  result = result.replace(/^(?:dossier|repertoire|fichier|document|classeur)\s+/i, '').trim();
  return result;
}

function readableDuration(seconds) {
  let remaining = Math.max(0, Math.floor(seconds));
  const days = Math.floor(remaining / 86400);
  remaining %= 86400;
  const hours = Math.floor(remaining / 3600);
  remaining %= 3600;
  const minutes = Math.floor(remaining / 60);
  const parts = [];
  if (days) parts.push(`${days} j`);
  if (hours || days) parts.push(`${hours} h`);
  parts.push(`${minutes} min`);
  return parts.join(' ');
}

async function diskInformation(root, platform = process.platform) {
  if (platform === 'win32') {
    const drive = path.parse(path.resolve(root)).root.replace(/[\\/:]/g, '') || 'C';
    const script = `$d=Get-PSDrive -Name '${drive.replace(/'/g, "''")}' -ErrorAction Stop; [pscustomobject]@{Total=($d.Used+$d.Free);Free=$d.Free} | ConvertTo-Json -Compress`;
    try {
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 5000, windowsHide: true });
      const result = JSON.parse(stdout.trim());
      const total = Number(result.Total);
      const free = Number(result.Free);
      return { total, free, usedPercent: total ? Math.round(((total - free) / total) * 100) : null };
    } catch {
      return null;
    }
  }
  try {
    const { stdout } = await execFileAsync('df', ['-Pk', root], { timeout: 5000, maxBuffer: 64 * 1024 });
    const line = stdout.trim().split(/\r?\n/).at(-1).trim().split(/\s+/);
    const total = Number(line[1]) * 1024;
    const free = Number(line[3]) * 1024;
    return { total, free, usedPercent: Number(String(line[4] || '').replace('%', '')) || null };
  } catch {
    return null;
  }
}

async function systemStatus(context = {}) {
  const cpus = os.cpus();
  const load = os.loadavg()[0] || 0;
  const cpuPercent = cpus.length ? Math.min(100, Math.round((load / cpus.length) * 100)) : null;
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const disk = await diskInformation(context.root || os.homedir(), context.platform || process.platform);
  const items = [
    { label: 'Système', value: `${os.type()} ${os.release()} (${os.arch()})` },
    { label: 'Processeur', value: `${cpus.length} cœur${cpus.length > 1 ? 's' : ''} · charge estimée ${cpuPercent == null ? 'indisponible' : `${cpuPercent} %`}` },
    { label: 'Mémoire vive', value: `${((totalMemory - freeMemory) / 1024 ** 3).toFixed(1)} Go utilisés / ${(totalMemory / 1024 ** 3).toFixed(1)} Go` },
    { label: 'Disque', value: disk ? `${(disk.free / 1024 ** 3).toFixed(1)} Go libres / ${(disk.total / 1024 ** 3).toFixed(1)} Go${disk.usedPercent == null ? '' : ` (${disk.usedPercent} % utilisés)`}` : 'Information indisponible' },
    { label: 'Depuis le démarrage', value: readableDuration(os.uptime()) },
    { label: 'Utilisateur', value: os.userInfo().username },
  ];
  return {
    text: 'J’ai fait le point sur ton poste. Voici son état actuel :',
    blocks: [{ type: 'kv', items }],
  };
}

async function listProcesses(platform = process.platform) {
  let stdout;
  if (platform === 'win32') {
    ({ stdout } = await execFileAsync('tasklist.exe', ['/fo', 'csv', '/nh'], { timeout: 8000, maxBuffer: 1024 * 1024, windowsHide: true }));
  } else {
    ({ stdout } = await execFileAsync('ps', ['-eo', 'pid,comm,%cpu,%mem', '--sort=-%cpu'], { timeout: 8000, maxBuffer: 1024 * 1024 }));
  }
  const lines = stdout.trim().split(/\r?\n/).slice(0, 26);
  return {
    text: `Voici les ${Math.max(0, lines.length - (platform === 'win32' ? 0 : 1))} premiers processus visibles sur le poste :`,
    blocks: [{ type: 'code', value: lines.join('\n') || 'Aucun processus retourné.' }],
  };
}

async function runCommand(command, context = {}) {
  const tokens = commandTokens(command);
  if (!tokens.length) throw new Error('La commande est vide.');
  const executable = tokens[0];
  const options = {
    cwd: context.root || os.homedir(),
    timeout: 12_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    env: process.env,
  };

  let result;
  if ((context.platform || process.platform) === 'win32' && new Set(['dir', 'type', 'ver', 'echo', 'tree']).has(path.basename(executable).toLowerCase())) {
    // cmd.exe est requis pour quelques commandes internes. La classification et les
    // confirmations sont effectuées en amont ; aucun shell n'est utilisé sur Unix.
    result = await execFileAsync('cmd.exe', ['/d', '/s', '/c', command], options);
  } else {
    result = await execFileAsync(executable, tokens.slice(1), options);
  }
  const output = String(result.stdout || '').trim();
  const errorOutput = String(result.stderr || '').trim();
  const combined = [output, errorOutput && `Sortie d’erreur :\n${errorOutput}`].filter(Boolean).join('\n\n');
  return {
    text: combined ? 'La commande a terminé. Voilà son résultat :' : 'La commande s’est terminée sans rien afficher.',
    blocks: combined ? [{ type: 'code', value: combined.slice(0, 16_000) }] : [],
  };
}

function classifyOpenTarget(target, platform = process.platform) {
  const value = String(target || '').trim();
  if (!value || value.length > 2048) return { level: 'blocked', reason: 'La destination est vide ou trop longue.' };
  let url;
  try { url = new URL(value); } catch { url = null; }
  if (url) {
    if (url.protocol === 'http:' || url.protocol === 'https:') return { level: 'safe', type: 'url' };
    return { level: 'blocked', reason: 'Seules les adresses web HTTP ou HTTPS peuvent être ouvertes.' };
  }
  const normalized = normalizeOpenName(value);
  const knownApps = platform === 'win32' ? WINDOWS_APPS : (platform === 'darwin' ? MAC_APPS : LINUX_APPS);
  if (knownApps.has(normalized)) return { level: 'safe', type: 'app' };
  const windowsPath = platform === 'win32' && /^(?:[a-z]:[\\/]|\\\\)/i.test(value);
  if (path.isAbsolute(value) || windowsPath || value.startsWith('.') || /[\\/]/.test(value)) {
    return { level: 'confirm', type: 'path', reason: 'L’ouverture de ce chemin doit rester dans la racine autorisée.' };
  }
  return { level: 'confirm', type: 'app', reason: 'Cette application n’est pas dans la liste des raccourcis connus.' };
}

function isLikelyPath(value, targetType, platform) {
  if (targetType === 'path') return true;
  if (path.isAbsolute(value) || value.startsWith('.') || /[\\/]/.test(value)) return true;
  if (platform === 'win32' && /^[a-z]:/i.test(value)) return true;
  if (USER_FOLDERS.has(normalizeOpenName(cleanOpenPath(value)))) return true;
  return /\.[a-z0-9]{1,12}$/i.test(value);
}

function openPathCandidates(target, context = {}, targetType) {
  const clean = cleanOpenPath(target);
  const root = path.resolve(context.root || os.homedir());
  const home = path.resolve(os.homedir());
  const homeIsAllowed = require('../safety').isWithin(home, root);
  const platform = context.platform || process.platform;
  const windowsPath = platform === 'win32' && /^(?:[a-z]:[\\/]|\\\\)/i.test(clean);
  if (path.isAbsolute(clean) || windowsPath) return [clean];
  if (clean.startsWith('~')) {
    const expanded = path.join(home, clean.slice(1).replace(/^[\\/]/, ''));
    return [expanded];
  }

  const candidates = [];
  const add = (candidate) => {
    if (!candidates.includes(candidate)) candidates.push(candidate);
  };
  const segments = clean.split(/[\\/]+/).filter(Boolean);
  const firstFolder = segments.length ? USER_FOLDERS.get(normalizeOpenName(segments[0])) : null;
  if (firstFolder) {
    if (homeIsAllowed) add(path.join(home, firstFolder, ...segments.slice(1)));
    add(path.resolve(root, firstFolder, ...segments.slice(1)));
  }
  const folderAlias = USER_FOLDERS.get(normalizeOpenName(clean));
  if (folderAlias) {
    if (homeIsAllowed) add(path.join(home, folderAlias));
    add(path.resolve(root, folderAlias));
  }
  if (homeIsAllowed) add(path.join(home, clean));
  add(path.resolve(root, clean));
  if (/\.[a-z0-9]{1,12}$/i.test(clean) && segments.length === 1) {
    for (const folder of ['Documents', 'Desktop', 'Downloads']) {
      if (homeIsAllowed) add(path.join(home, folder, clean));
      add(path.resolve(root, folder, clean));
    }
  }
  return candidates;
}

async function findOpenPath(target, context = {}, targetType) {
  const candidates = openPathCandidates(target, context, targetType);
  for (const candidate of candidates) {
    const safePath = await resolveSafePath(candidate, { root: context.root, fullAccess: context.fullAccess });
    try {
      const stat = await fs.stat(safePath);
      if (stat.isFile() || stat.isDirectory()) return { path: safePath, stat };
    } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      throw error;
    }
  }
  return null;
}

async function classifyOpenTargetAsync(target, context = {}, targetType) {
  const value = String(target || '').trim();
  const platform = context.platform || process.platform;
  const initial = classifyOpenTarget(value, platform);
  if (initial.level === 'blocked' || initial.type === 'url') return initial;
  if (targetType !== 'path' && initial.type === 'app' && initial.level === 'safe') return initial;

  try {
    const match = await findOpenPath(value, context, targetType);
    if (match) {
      const executableFile = !match.stat.isDirectory() && /\.(?:exe|com|bat|cmd|ps1|msi|scr|lnk|sh|command|appimage|desktop)$/i.test(match.path);
      if (executableFile) return { level: 'confirm', type: 'path', path: match.path, isDirectory: false, reason: 'L’ouverture d’un programme ou script demande une confirmation.' };
      return { level: 'safe', type: 'path', path: match.path, isDirectory: match.stat.isDirectory() };
    }
  } catch (error) {
    if (error && /sort du dossier autorisé|en dehors du dossier autorisé|lien symbolique/i.test(error.message)) {
      return { level: 'blocked', type: 'path', reason: error.message };
    }
    if (error && error.code !== 'ENOENT') return { level: 'blocked', type: 'path', reason: 'Je ne peux pas accéder à ce chemin avec les droits actuels.' };
  }

  if (isLikelyPath(value, targetType, platform)) {
    return { level: 'not-found', type: 'path', reason: `Je ne trouve pas « ${cleanOpenPath(value)} » dans la racine autorisée.` };
  }
  return initial;
}

function launchDetached(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { detached: true, stdio: 'ignore', windowsHide: true, ...options });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

async function openTarget(target, context = {}, targetType) {
  const value = String(target || '').trim();
  const platform = context.platform || process.platform;
  const classification = await classifyOpenTargetAsync(value, context, targetType);
  if (classification.level === 'blocked' || classification.level === 'not-found') throw new Error(classification.reason);

  if (classification.type === 'url') {
    const safeUrl = new URL(value).href;
    if (platform === 'win32') {
      await launchDetached('cmd.exe', ['/d', '/s', '/c', `start "" "${safeUrl.replace(/"/g, '')}"`]);
    } else if (platform === 'darwin') {
      await launchDetached('open', [safeUrl]);
    } else {
      await launchDetached('xdg-open', [safeUrl]);
    }
    return { text: `C’est parti, j’ouvre **${safeUrl}** dans le navigateur. 🌐` };
  }

  if (classification.type === 'path') {
    if (platform === 'win32') await launchDetached('explorer.exe', [classification.path]);
    else if (platform === 'darwin') await launchDetached('open', [classification.path]);
    else await launchDetached('xdg-open', [classification.path]);
    const display = path.relative(context.root || os.homedir(), classification.path).split(path.sep).join('/') || path.basename(classification.path);
    const object = classification.isDirectory ? 'dossier' : 'document';
    return { text: `J’ouvre le ${object} **${display}** avec l’application associée. 👌` };
  }

  const normalized = normalizeOpenName(value);
  if (platform === 'win32' && WINDOWS_APPS.has(normalized)) {
    await launchDetached(WINDOWS_APPS.get(normalized), []);
  } else if (platform === 'darwin' && MAC_APPS.has(normalized)) {
    await launchDetached('open', ['-a', MAC_APPS.get(normalized)]);
  } else if (platform !== 'win32' && platform !== 'darwin' && LINUX_APPS.has(normalized)) {
    const application = LINUX_APPS.get(normalized);
    await launchDetached(application.command, application.args);
  } else {
    // Une application inconnue n’est lancée qu’après validation explicite dans executor.js.
    await launchDetached(value, []);
  }
  return { text: `Voilà, j’ai lancé **${value}**. 👌` };
}

module.exports = { systemStatus, listProcesses, runCommand, classifyOpenTarget, classifyOpenTargetAsync, openTarget, readableDuration };
