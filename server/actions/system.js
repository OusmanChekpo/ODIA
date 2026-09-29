'use strict';

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
]);
const MAC_APPS = new Map([
  ['bloc-notes', 'TextEdit'], ['notepad', 'TextEdit'],
  ['calculatrice', 'Calculator'], ['calculator', 'Calculator'],
  ['explorateur', 'Finder'], ['explorer', 'Finder'],
]);
const LINUX_APPS = new Map([
  ['bloc-notes', 'gedit'], ['notepad', 'gedit'],
  ['calculatrice', 'gnome-calculator'], ['calculator', 'gnome-calculator'],
  ['explorateur', 'xdg-open'], ['explorer', 'xdg-open'],
]);

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
  const normalized = value.toLocaleLowerCase('fr-FR').replace(/\s+/g, '-');
  const knownApps = platform === 'win32' ? WINDOWS_APPS : (platform === 'darwin' ? MAC_APPS : LINUX_APPS);
  if (knownApps.has(normalized)) return { level: 'safe', type: 'app' };
  const windowsPath = platform === 'win32' && /^(?:[a-z]:[\\/]|\\\\)/i.test(value);
  if (path.isAbsolute(value) || windowsPath || value.startsWith('.')) return { level: 'confirm', type: 'path', reason: 'L’ouverture de cette application ou de ce chemin nécessite une confirmation.' };
  return { level: 'confirm', type: 'app', reason: 'Cette application n’est pas dans la petite liste de raccourcis connus.' };
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

async function openTarget(target, context = {}) {
  const value = String(target || '').trim();
  const classification = classifyOpenTarget(value, context.platform || process.platform);
  if (classification.level === 'blocked') throw new Error(classification.reason);

  const platform = context.platform || process.platform;
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
    const filePath = await resolveSafePath(value, { root: context.root, fullAccess: context.fullAccess });
    if (platform === 'win32') await launchDetached('explorer.exe', [filePath]);
    else if (platform === 'darwin') await launchDetached('open', [filePath]);
    else await launchDetached('xdg-open', [filePath]);
    return { text: `Voilà, j’ouvre **${value}**. 👌` };
  }

  const normalized = value.toLocaleLowerCase('fr-FR').replace(/\s+/g, '-');
  if (platform === 'win32' && WINDOWS_APPS.has(normalized)) {
    await launchDetached(WINDOWS_APPS.get(normalized), []);
  } else if (platform === 'darwin' && MAC_APPS.has(normalized)) {
    await launchDetached('open', ['-a', MAC_APPS.get(normalized)]);
  } else if (platform !== 'win32' && platform !== 'darwin' && LINUX_APPS.has(normalized)) {
    const application = LINUX_APPS.get(normalized);
    const args = application === 'xdg-open' ? [context.root || os.homedir()] : [];
    await launchDetached(application, args);
  } else {
    // Une application inconnue n’est lancée qu’après validation explicite dans executor.js.
    await launchDetached(value, []);
  }
  return { text: `Voilà, j’ai lancé **${value}**. 👌` };
}

module.exports = { systemStatus, listProcesses, runCommand, classifyOpenTarget, openTarget, readableDuration };
