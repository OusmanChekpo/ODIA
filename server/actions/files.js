'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { resolveSafePath } = require('../safety');

const MAX_READ_BYTES = 64 * 1024;
const MAX_SCAN_FILES = 4000;
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', '.next', 'coverage', 'dist', 'build']);

function displayPath(filePath, root) {
  const relative = path.relative(root, filePath);
  return (relative && !relative.startsWith('..') ? relative : filePath).split(path.sep).join('/');
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} o`;
  const units = ['Ko', 'Mo', 'Go', 'To'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; value >= 1024 && index < units.length; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${unit}`;
}

function contextOptions(context) {
  return { root: context.root, fullAccess: context.fullAccess };
}

async function listFiles(slots, context) {
  const directory = await resolveSafePath(slots.directory || '.', contextOptions(context));
  const entries = await fs.readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, 'fr', { sensitivity: 'base' }));
  const visible = entries.slice(0, 200);
  const files = await Promise.all(visible.map(async (entry) => {
    let size = null;
    if (entry.isFile()) {
      try { size = (await fs.stat(path.join(directory, entry.name))).size; } catch { /* fichier changé pendant la lecture */ }
    }
    const fullPath = path.join(directory, entry.name);
    return {
      name: entry.name,
      path: displayPath(fullPath, context.root),
      kind: entry.isDirectory() ? 'dossier' : (entry.isFile() ? 'fichier' : 'autre'),
      size: size == null ? '' : formatBytes(size),
    };
  }));
  const label = slots.directory || 'le dossier autorisé';
  const suffix = entries.length > visible.length ? ` (les ${visible.length} premiers éléments sur ${entries.length})` : '';
  return {
    text: files.length ? `Voici ce que j’ai trouvé dans **${label}**${suffix} :` : `Le dossier **${label}** est vide pour le moment.`,
    blocks: [{ type: 'files', items: files }],
  };
}

async function readFile(slots, context) {
  const filePath = await resolveSafePath(slots.name, contextOptions(context));
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error('Je peux lire un fichier, mais pas afficher le contenu d’un dossier.');
  if (stat.size > MAX_READ_BYTES) throw new Error('Ce fichier est un peu trop volumineux pour l’afficher ici (limite : 64 Ko).');
  const content = await fs.readFile(filePath, 'utf8');
  const name = displayPath(filePath, context.root);
  return {
    text: `Voilà le contenu de **${name}** :`,
    blocks: [{ type: 'code', value: content || '(fichier vide)' }],
  };
}

async function createFile(slots, context) {
  const filePath = await resolveSafePath(slots.name, contextOptions(context));
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const content = String(slots.content || '');
  await fs.writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' });
  const characters = Array.from(content.normalize('NFC')).length;
  return { text: `Voilà, le fichier **${path.basename(filePath)}** est créé avec ${characters} caractères dedans 👌` };
}

async function createDirectory(slots, context) {
  const directory = await resolveSafePath(slots.name, contextOptions(context));
  await fs.mkdir(directory, { recursive: false });
  return { text: `Le dossier **${path.basename(directory)}** est créé. Tu peux maintenant y ranger tes fichiers 😊` };
}

async function renameFile(slots, context) {
  const source = await resolveSafePath(slots.from, contextOptions(context));
  const destination = await resolveSafePath(slots.to, contextOptions(context));
  const stat = await fs.lstat(source);
  if (!stat.isFile() && !stat.isDirectory()) throw new Error('Je ne peux renommer que des fichiers ou des dossiers ordinaires.');
  try {
    await fs.lstat(destination);
    throw new Error('Il existe déjà un fichier ou un dossier à cet emplacement ; je préfère ne pas l’écraser.');
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
  }
  await fs.rename(source, destination);
  return { text: `C’est fait : **${path.basename(source)}** s’appelle maintenant **${path.basename(destination)}** 👌` };
}

async function fileSize(slots, context) {
  const filePath = await resolveSafePath(slots.name, contextOptions(context));
  const stat = await fs.stat(filePath);
  return {
    text: `**${displayPath(filePath, context.root)}** pèse **${formatBytes(stat.size)}**${stat.isDirectory() ? ' (taille de l’entrée du dossier, sans parcourir son contenu)' : ''}.`,
    blocks: [{ type: 'kv', items: [{ label: 'Éléments', value: stat.isDirectory() ? 'Dossier' : 'Fichier' }, { label: 'Taille', value: formatBytes(stat.size) }] }],
  };
}

async function walkFiles(startDirectory, visit, context) {
  const pending = [{ directory: startDirectory, depth: 0 }];
  let scanned = 0;
  while (pending.length && scanned < MAX_SCAN_FILES) {
    const current = pending.pop();
    let entries;
    try { entries = await fs.readdir(current.directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (scanned >= MAX_SCAN_FILES) break;
      if (entry.name.startsWith('.') && SKIP_DIRECTORIES.has(entry.name)) continue;
      const fullPath = path.join(current.directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (current.depth < 8 && !SKIP_DIRECTORIES.has(entry.name)) pending.push({ directory: fullPath, depth: current.depth + 1 });
      } else if (entry.isFile()) {
        scanned += 1;
        const shouldStop = await visit(fullPath);
        if (shouldStop) return { scanned, limited: pending.length > 0 };
      }
    }
  }
  return { scanned, limited: pending.length > 0 || scanned >= MAX_SCAN_FILES };
}

async function findFiles(slots, context) {
  const term = String(slots.term || '').trim().toLocaleLowerCase('fr-FR');
  if (!term) throw new Error('Dis-moi quel mot je dois chercher dans les noms de fichiers.');
  const root = await resolveSafePath('.', contextOptions(context));
  const matches = [];
  const scan = await walkFiles(root, async (filePath) => {
    if (path.basename(filePath).toLocaleLowerCase('fr-FR').includes(term)) {
      matches.push({ name: path.basename(filePath), path: displayPath(filePath, context.root), kind: 'fichier' });
      if (matches.length >= 100) return true;
    }
    return false;
  }, context);
  return {
    text: matches.length ? `J’ai trouvé ${matches.length} fichier${matches.length > 1 ? 's' : ''} dont le nom contient **${slots.term}**${scan.limited ? ' (résultat limité)' : ''} :` : `Je n’ai trouvé aucun nom de fichier contenant **${slots.term}**.`,
    blocks: [{ type: 'files', items: matches }],
  };
}

async function grepFiles(slots, context) {
  const term = String(slots.term || '').trim();
  if (!term) throw new Error('Ajoute le texte que tu veux rechercher.');
  const start = await resolveSafePath(slots.directory || '.', contextOptions(context));
  const matches = [];
  const scan = await walkFiles(start, async (filePath) => {
    try {
      const stat = await fs.stat(filePath);
      if (stat.size > 1024 * 1024) return false;
      const buffer = await fs.readFile(filePath);
      if (buffer.includes(0)) return false;
      const lines = buffer.toString('utf8').split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        if (lines[index].toLocaleLowerCase('fr-FR').includes(term.toLocaleLowerCase('fr-FR'))) {
          matches.push({ file: displayPath(filePath, context.root), line: index + 1, text: lines[index].trim().slice(0, 240) });
          if (matches.length >= 100) return true;
        }
      }
    } catch { /* fichier illisible ou supprimé pendant le parcours */ }
    return false;
  }, context);
  return {
    text: matches.length ? `J’ai trouvé ${matches.length} occurrence${matches.length > 1 ? 's' : ''} de « ${term} »${scan.limited ? ' (recherche limitée)' : ''} :` : `Je n’ai trouvé aucune occurrence de « ${term} » dans **${slots.directory || '.'}**.`,
    blocks: matches.length ? [{ type: 'table', headers: ['Fichier', 'Ligne', 'Extrait'], rows: matches.map((item) => [item.file, String(item.line), item.text]) }] : [],
  };
}

async function deleteFile(slots, context) {
  const filePath = await resolveSafePath(slots.name, contextOptions(context));
  const stat = await fs.lstat(filePath);
  if (!stat.isFile()) throw new Error('Pour éviter une suppression trop large, je ne supprime ici que des fichiers — pas les dossiers.');
  await fs.unlink(filePath);
  return { text: `Le fichier **${path.basename(filePath)}** a été supprimé.`, deletedPath: displayPath(filePath, context.root) };
}

module.exports = {
  listFiles,
  readFile,
  createFile,
  createDirectory,
  renameFile,
  fileSize,
  findFiles,
  grepFiles,
  deleteFile,
  formatBytes,
};
