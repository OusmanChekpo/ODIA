'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const UNIX_ALLOWLIST = new Set([
  'ls', 'cat', 'head', 'tail', 'wc', 'pwd', 'df', 'du', 'ps', 'free',
  'uname', 'uptime', 'whoami', 'id', 'date', 'git', 'grep', 'find', 'which',
  'whereis', 'file', 'stat', 'hostname', 'printf',
]);

const WIN_ALLOWLIST = new Set([
  'dir', 'type', 'tasklist', 'systeminfo', 'ipconfig', 'where', 'whoami',
  'ver', 'hostname', 'echo', 'tree',
]);

const INTERPRETERS = new Set([
  'node', 'nodejs', 'npm', 'npx', 'python', 'python2', 'python3', 'py',
  'powershell', 'pwsh', 'cmd', 'cmd.exe', 'bash', 'sh', 'zsh', 'fish',
  'wscript', 'cscript', 'dotnet', 'ruby', 'perl',
]);

function commandTokens(command) {
  const input = String(command || '').trim();
  const tokens = [];
  let token = '';
  let quote = '';
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (escaped) {
      token += char;
      escaped = false;
      continue;
    }
    const next = input[index + 1];
    if (char === '\\' && quote !== "'" && (next === ' ' || next === '\t' || next === '\\' || next === '"' || next === "'")) {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = '';
      else token += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (token) tokens.push(token);
      token = '';
      continue;
    }
    token += char;
  }
  if (escaped) token += '\\';
  if (token) tokens.push(token);
  return tokens;
}

function executableName(token = '') {
  const basename = String(token).split(/[\\/]/).pop() || '';
  return basename.toLowerCase().replace(/\.(?:exe|com|bat|cmd)$/i, '');
}

function isBlockedUnix(command) {
  const text = String(command || '').trim();
  const patterns = [
    /\brm\s+(?:(?:-[a-z]*r[a-z]*f[a-z]*)|(?:-[a-z]*f[a-z]*r[a-z]*))\s+(?:--\s+)?(?:['"]?\/(?:\.\/?)*(?:['"]?(?:\s|$))|['"]?~(?:\/|['"]?(?:\s|$)))/i,
    /\bmkfs(?:\.[a-z0-9_-]+)?\b/i,
    /\bdd\b[^\n;|]*\bof\s*=\s*['"]?\/dev\//i,
    /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?\s*:/,
    /\b(?:shutdown|reboot|halt|poweroff)\b/i,
    /\bpasswd\b/i,
    /\bchmod\s+-R\s+0?777\s+['"]?\/(?:['"]?(?:\s|$))/i,
    /\bfind\s+['"]?\/['"]?(?=\s|$)[^\n]*\s-delete\b/i,
    /\bfind\s+['"]?\/['"]?(?=\s|$)[^\n]*\s-exec(?:dir)?\s+rm\b/i,
  ];
  return patterns.some((pattern) => pattern.test(text));
}

function isBlockedWindows(command) {
  const text = String(command || '').trim();
  const patterns = [
    /\bformat\s+[a-z]\s*:/i,
    /\bdiskpart\b/i,
    /\bbcdedit\b/i,
    /\b(?:rd|rdel|rmdir)\b(?=[^\n]*\/(?:s|S))(?=[^\n]*\/(?:q|Q))[^\n]*\b[a-z]\s*:\\?/i,
    /\bdel\b(?=[^\n]*\/(?:s|S))(?=[^\n]*\/(?:q|Q))[^\n]*\b[a-z]\s*:\\?/i,
    /\breg(?:\.exe)?\s+delete\b[^\n]*\/(?:f|F)(?:\s|$)/i,
    /\bremove-item\b(?=[^\n]*(?:-recurse|\/-r\b))[^\n]*/i,
  ];
  return patterns.some((pattern) => pattern.test(text));
}

function classifyCommand(command, platform = process.platform) {
  const text = String(command || '').trim();
  if (!text || text.length > 2048 || /[\u0000-\u001f]/.test(text)) {
    return { level: 'blocked', reason: 'La commande est vide, trop longue ou contient des caractères de contrôle.' };
  }

  const windows = platform === 'win32';
  if (isBlockedUnix(text) || (windows && isBlockedWindows(text))) {
    return { level: 'blocked', reason: 'Cette commande est bloquée car elle peut endommager le système ou supprimer des données importantes.' };
  }

  const tokens = commandTokens(text);
  if (tokens.length === 0) return { level: 'blocked', reason: 'Commande vide.' };
  const executable = executableName(tokens[0]);
  if (INTERPRETERS.has(executable) || INTERPRETERS.has(tokens[0].toLowerCase())) {
    return { level: 'confirm', reason: 'Les interpréteurs et environnements de développement demandent toujours une confirmation.' };
  }

  // Les compositions shell sont volontairement exclues de la liste blanche.
  if (/[|&;<>`$]/.test(text) || /\$\(/.test(text)) {
    return { level: 'confirm', reason: 'La commande utilise une composition shell et doit être vérifiée avant son lancement.' };
  }

  if (windows) {
    if (WIN_ALLOWLIST.has(executable)) {
      if (executable === 'ipconfig' && tokens.slice(1).some((token) => /^\/(?:release|renew|flushdns|registerdns)/i.test(token))) {
        return { level: 'confirm', reason: 'Cette option peut modifier la configuration réseau ou vider le cache DNS.' };
      }
      return { level: 'safe', reason: 'Commande Windows reconnue comme lecture seule.' };
    }
  } else if (UNIX_ALLOWLIST.has(executable)) {
    if (executable === 'git') {
      const subcommand = (tokens[1] || '').toLowerCase();
      const readOnlyGit = new Set(['status', 'log', 'diff', 'branch', 'show', 'rev-parse', 'remote', 'tag', 'ls-files', 'describe']);
      const argumentsAfterVerb = tokens.slice(2);
      const hasPositional = argumentsAfterVerb.some((token) => !token.startsWith('-'));
      const dangerousGitOption = argumentsAfterVerb.some((token) => /^(?:-D|-d|--delete(?:=.*)?|--move|--copy|--ext-diff(?:=.*)?|--textconv(?:=.*)?|--output(?:=.*)?)$/i.test(token));
      if (!readOnlyGit.has(subcommand)
        || dangerousGitOption
        || (subcommand === 'branch' && hasPositional && !argumentsAfterVerb.some((token) => token === '--list' || token === '-l'))
        || (subcommand === 'tag' && hasPositional && !argumentsAfterVerb.some((token) => token === '--list' || token === '-l'))
        || (subcommand === 'remote' && argumentsAfterVerb.some((token) => !['-v', '--verbose'].includes(token)))) {
        return { level: 'confirm', reason: 'Cette opération Git peut modifier le dépôt ou contacter un service distant.' };
      }
    }
    if (executable === 'find' && tokens.some((token) => ['-delete', '-exec', '-execdir', '-ok', '-okdir'].includes(token))) {
      return { level: 'confirm', reason: 'Cette recherche peut modifier des fichiers ou lancer un autre programme.' };
    }
    if ((executable === 'date' && tokens.slice(1).some((token) => token === '-s' || token === '--set' || token.startsWith('--set=')))
      || (executable === 'hostname' && tokens.length > 1)) {
      return { level: 'confirm', reason: 'Cette option peut modifier un réglage système.' };
    }
    return { level: 'safe', reason: 'Commande en lecture seule reconnue.' };
  }

  return { level: 'confirm', reason: 'Cette commande ne figure pas dans la liste blanche.' };
}

function isWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function resolveSafePath(userPath, options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const fullAccess = Boolean(options.fullAccess);
  let raw = String(userPath == null ? '' : userPath).trim();
  if (!raw) raw = '.';
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    raw = raw.slice(1, -1);
  }

  const candidate = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
  if (fullAccess) return candidate;
  if (!isWithin(candidate, root)) {
    throw new Error('Ce chemin sort du dossier autorisé. Tu peux choisir un dossier situé dans la racine de travail.');
  }

  let probe = candidate;
  while (true) {
    try {
      const realProbe = await fs.realpath(probe);
      let realRoot;
      try {
        realRoot = await fs.realpath(root);
      } catch {
        realRoot = root;
      }
      if (!isWithin(realProbe, realRoot)) {
        throw new Error('Ce chemin pointe en dehors du dossier autorisé (lien symbolique détecté).');
      }
      break;
    } catch (error) {
      if (error && error.message && /en dehors|sort du dossier/.test(error.message)) throw error;
      if (!error || error.code !== 'ENOENT') throw error;
      const parent = path.dirname(probe);
      if (parent === probe) throw error;
      probe = parent;
    }
  }
  return candidate;
}

async function validateCommandPaths(command, options = {}) {
  if (options.fullAccess) return;
  const tokens = commandTokens(command).slice(1);
  const windows = (options.platform || process.platform) === 'win32';
  for (const token of tokens) {
    const candidate = token.includes('=') ? token.slice(token.lastIndexOf('=') + 1) : token;
    if (!candidate) continue;
    const absolute = windows
      ? /^(?:[a-z]:[\\/]|[a-z]:$|\\\\)/i.test(candidate)
      : path.isAbsolute(candidate);
    const escapes = /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(candidate) || /^~(?:[\\/]|$)/.test(candidate);
    const pathLike = absolute || escapes || (windows
      ? /^[a-z]:/i.test(candidate) || (candidate.includes('\\\\') && !candidate.startsWith('/'))
      : /[\\/]/.test(candidate));
    if (pathLike) {
      await resolveSafePath(candidate, { root: options.root, fullAccess: false });
    }
  }
}

class ConfirmationTokens {
  constructor({ ttl = 120_000, clock = () => Date.now() } = {}) {
    this.ttl = ttl;
    this.clock = clock;
    this.pending = new Map();
  }

  create(action, prompt, metadata = {}) {
    const token = crypto.randomBytes(18).toString('hex');
    const expiresAt = this.clock() + this.ttl;
    this.pending.set(token, { action, prompt, metadata, expiresAt });
    return { token, prompt, expiresAt, kind: metadata.kind || 'action' };
  }

  take(token) {
    const entry = this.pending.get(String(token || ''));
    if (!entry) return { ok: false, reason: 'Cette confirmation est inconnue ou a déjà été utilisée.' };
    this.pending.delete(String(token));
    if (entry.expiresAt < this.clock()) {
      return { ok: false, reason: 'Le délai de confirmation est dépassé. Relance l’action si tu souhaites toujours continuer.' };
    }
    return { ok: true, entry };
  }

  clear() {
    this.pending.clear();
  }
}

module.exports = {
  UNIX_ALLOWLIST,
  WIN_ALLOWLIST,
  classifyCommand,
  commandTokens,
  resolveSafePath,
  validateCommandPaths,
  isWithin,
  ConfirmationTokens,
};
