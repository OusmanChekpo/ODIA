'use strict';

function normalizeWithMap(input) {
  const original = String(input == null ? '' : input);
  let text = '';
  const map = [];
  for (let offset = 0; offset < original.length;) {
    const character = String.fromCodePoint(original.codePointAt(offset));
    const start = offset;
    offset += character.length;
    let normalized = character
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLocaleLowerCase('fr-FR');
    normalized = normalized.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-');
    text += normalized;
    if (!normalized && /\p{M}/u.test(character) && map.length) {
      map[map.length - 1].end = offset;
    }
    for (let index = 0; index < normalized.length; index += 1) map.push({ start, end: offset });
  }
  return { original, text, map };
}

function normalize(input) {
  return normalizeWithMap(input).text;
}

function originalRange(mapped, start, end) {
  const first = mapped.map[start];
  const last = mapped.map[Math.max(start, end - 1)];
  if (!first || !last) return '';
  return mapped.original.slice(first.start, last.end);
}

function capture(match, group, mapped) {
  const indices = match.indices && match.indices.groups;
  const span = indices && indices[group];
  if (!span) return '';
  return originalRange(mapped, span[0], span[1]).trim();
}

function clean(value) {
  let result = String(value || '').trim();
  if ((result.startsWith('"') && result.endsWith('"')) || (result.startsWith("'") && result.endsWith("'"))) {
    result = result.slice(1, -1).trim();
  }
  return result;
}

function matched(pattern, mapped) {
  const expression = new RegExp(pattern, 'di');
  return expression.exec(mapped.text);
}

function parseOne(input) {
  const mapped = normalizeWithMap(input);
  const leading = mapped.text.length - mapped.text.trimStart().length;
  const text = mapped.text.trim();
  const original = mapped.original.trim();
  if (!text) return { intent: 'unknown', original, slots: {} };
  const data = { ...mapped, text, map: mapped.map.slice(leading, leading + text.length) };
  let match;

  const simple = (pattern, intent, slots = {}) => {
    const found = matched(pattern, data);
    return found ? { intent, original, slots: typeof slots === 'function' ? slots(found, data) : slots } : null;
  };

  match = matched('^(?:salut|bonjour|bonsoir|coucou|hey|hello)(?:\\b|$)', data);
  if (match) return { intent: 'smalltalk.greeting', original, slots: {} };
  match = matched('^(?:comment\\s+ca\\s+va|ca\\s+va|quoi\\s+de\\s+neuf)(?:\\b|$)', data);
  if (match) return { intent: 'smalltalk.mood', original, slots: {} };
  match = matched('^(?:raconte(?:[- ]moi)?\\s+une\\s+blague|fais(?:[- ]moi)?\\s+rire|une\\s+blague)(?:\\b|$)', data);
  if (match) return { intent: 'smalltalk.joke', original, slots: {} };
  match = matched('^(?:au\\s+revoir|bonne\\s+nuit|a\\s+bientot|a\\s+plus)(?:\\b|$)', data);
  if (match) return { intent: 'smalltalk.goodbye', original, slots: {} };
  match = matched('^(?:merci|merci\\s+beaucoup)(?:\\b|$)', data);
  if (match) return { intent: 'smalltalk.thanks', original, slots: {} };
  match = matched('^(?:qui\\s+es-tu|qui\\s+es\\s+tu|comment\\s+tu\\s+appelles-tu|quel\\s+est\\s+ton\\s+nom)(?:\\b|$)', data);
  if (match) return { intent: 'smalltalk.identity', original, slots: {} };
  match = matched('^(?:tu\\s+fais\\s+quoi|que\\s+fais-tu|que\\s+peux-tu\\s+faire|tu\\s+sais\\s+faire\\s+quoi)(?:\\b|$)', data);
  if (match) return { intent: 'smalltalk.capabilities', original, slots: {} };
  match = matched('^(?:aide|help|que\\s+sais-tu\\s+faire|quelles?\\s+sont\\s+tes\\s+capacites)(?:\\b|$)', data);
  if (match) return { intent: 'help', original, slots: {} };

  match = matched('^(?:creer?|cree)\\s+(?:une?\\s+)?routine\\s+(?<name>.+?)\\s*:\\s*(?<actions>.+)$', data);
  if (match) return { intent: 'automation.routine.create', original, slots: { name: clean(capture(match, 'name', data)), actions: capture(match, 'actions', data) } };
  match = matched('^(?:liste|affiche)(?:\\s+les?)?\\s+routines$', data);
  if (match) return { intent: 'automation.routine.list', original, slots: {} };
  match = matched('^(?:execute|lance)\\s+(?:la\\s+)?routine\\s+(?<name>.+)$', data);
  if (match) return { intent: 'automation.routine.run', original, slots: { name: clean(capture(match, 'name', data)) } };
  match = matched('^(?:supprime|efface)\\s+(?:la\\s+)?routine\\s+(?<name>.+)$', data);
  if (match) return { intent: 'automation.routine.delete', original, slots: { name: clean(capture(match, 'name', data)) } };

  match = matched('^(?:historique\\s+(?:des\\s+)?rappels|journal\\s+(?:des\\s+)?rappels)$', data);
  if (match) return { intent: 'automation.history', original, slots: {} };
  match = matched('^(?:rappelle(?:-moi)?|rappel(?:le)?\\s+moi)\\s+(?:dans|d\\x27ici)\\s+(?<amount>\\d+(?:[.,]\\d+)?)\\s*(?<unit>secondes?|secs?|minutes?|mins?|heures?|h|jours?)\\s+(?:de|que)\\s+(?<text>.+)$', data);
  if (match) return { intent: 'automation.reminder', original, slots: { amount: capture(match, 'amount', data).replace(',', '.'), unit: normalize(capture(match, 'unit', data)), text: capture(match, 'text', data) } };
  match = matched('^chaque\\s+jour\\s+a\\s+(?<time>\\d{1,2}:\\d{2})\\s*(?::|[-,])?\\s*(?<action>.+)$', data);
  if (match) return { intent: 'automation.daily', original, slots: { time: capture(match, 'time', data), action: capture(match, 'action', data) } };
  match = matched('^chaque\\s+(?<day>lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\\s+a\\s+(?<time>\\d{1,2}:\\d{2})\\s*(?::|[-,])?\\s*(?<action>.+)$', data);
  if (match) return { intent: 'automation.weekly', original, slots: { day: normalize(capture(match, 'day', data)), time: capture(match, 'time', data), action: capture(match, 'action', data) } };
  match = matched('^toutes?\\s+les\\s+(?<amount>\\d+)\\s+minutes?\\s*(?::|[-,])?\\s*(?<action>.+)$', data);
  if (match) return { intent: 'automation.interval', original, slots: { amount: capture(match, 'amount', data), action: capture(match, 'action', data) } };

  match = matched('^(?:quelle\\s+heure\\s+est-il|quelle\\s+heure\\s+est\\s+il|heure\\s+locale|donne-moi\\s+l\\x27heure)$', data);
  if (match) return { intent: 'system.time', original, slots: {} };
  match = matched('^heure\\s+(?:a|dans)\\s+(?<place>.+)$', data);
  if (match) return { intent: 'extra.worldtime', original, slots: { place: clean(capture(match, 'place', data)) } };
  match = matched('^(?:etat|statut)\\s+(?:du\\s+)?systeme$', data);
  if (match) return { intent: 'system.status', original, slots: {} };
  match = matched('^(?:liste|affiche)\\s+(?:(?:les?|des)\\s+)?processus$', data);
  if (match) return { intent: 'system.processes', original, slots: {} };
  match = matched('^(?:execute|lance)\\s+(?:la\\s+)?commande\\s+(?<command>[\\s\\S]+)$', data);
  if (match) return { intent: 'system.command', original, slots: { command: capture(match, 'command', data) } };
  match = matched('^ouvre\\s+(?<target>.+)$', data);
  if (match) return { intent: 'system.open', original, slots: { target: clean(capture(match, 'target', data)) } };

  match = matched('^(?:meteo|temps)\\s+(?:a|pour)\\s+(?<city>.+)$', data);
  if (match) return { intent: 'extra.weather', original, slots: { city: clean(capture(match, 'city', data)) } };
  match = matched('^(?:calcule|calculer|calcul)\\s+(?<expression>[\\s\\S]+)$', data);
  if (match) return { intent: 'extra.calculate', original, slots: { expression: capture(match, 'expression', data) } };
  match = matched('^=\\s*(?<expression>[\\s\\S]+)$', data);
  if (match) return { intent: 'extra.calculate', original, slots: { expression: capture(match, 'expression', data) } };
  match = matched('^(?:note|ajoute\\s+une\\s+note)\\s*:\\s*(?<text>[\\s\\S]+)$', data);
  if (match) return { intent: 'extra.note.add', original, slots: { text: capture(match, 'text', data) } };
  match = matched('^(?:mes\\s+notes|liste\\s+(?:mes\\s+)?notes)$', data);
  if (match) return { intent: 'extra.note.list', original, slots: {} };
  match = matched('^(?:supprime|efface)\\s+(?:la\\s+)?note\\s+(?<number>\\d+)$', data);
  if (match) return { intent: 'extra.note.delete', original, slots: { number: capture(match, 'number', data) } };

  match = matched('^(?:creer?|cree)\\s+(?:un\\s+)?dossier\\s+(?<name>.+)$', data);
  if (match) return { intent: 'files.mkdir', original, slots: { name: clean(capture(match, 'name', data)) } };
  match = matched('^(?:creer?|cree)\\s+(?:un\\s+)?(?:fichier|document)\\s+(?<name>.+?)\\s+avec\\s+(?<content>[\\s\\S]+)$', data);
  if (match) return { intent: 'files.create', original, slots: { name: clean(capture(match, 'name', data)), content: capture(match, 'content', data) } };
  match = matched('^(?:renomme|renommer)\\s+(?<from>.+?)\\s+en\\s+(?<to>.+)$', data);
  if (match) return { intent: 'files.rename', original, slots: { from: clean(capture(match, 'from', data)), to: clean(capture(match, 'to', data)) } };
  match = matched('^(?:taille\\s+de|quelle\\s+est\\s+la\\s+taille\\s+de)\\s+(?<name>.+)$', data);
  if (match) return { intent: 'files.size', original, slots: { name: clean(capture(match, 'name', data)) } };
  match = matched('^cherche\\s+(?:un?\\s+)?fichiers?\\s+contenant\\s+(?<term>.+)$', data);
  if (match) return { intent: 'files.find', original, slots: { term: clean(capture(match, 'term', data)) } };
  match = matched('^cherche\\s+["\\x27](?<term>.+?)["\\x27]\\s+dans\\s+(?:les\\s+)?fichiers?\\s+(?:de|dans)\\s+(?<directory>.+)$', data);
  if (match) return { intent: 'files.grep', original, slots: { term: capture(match, 'term', data), directory: clean(capture(match, 'directory', data)) } };
  match = matched('^cherche\\s+(?<term>.+?)\\s+dans\\s+(?:les\\s+)?fichiers?\\s+(?:de|dans)\\s+(?<directory>.+)$', data);
  if (match) return { intent: 'files.grep', original, slots: { term: clean(capture(match, 'term', data)), directory: clean(capture(match, 'directory', data)) } };
  match = matched('^(?:liste|affiche)\\s+(?:les?\\s+)?fichiers?(?:\\s+de\\s+(?<directory>.+))?$', data);
  if (match) return { intent: 'files.list', original, slots: { directory: clean(capture(match, 'directory', data)) } };
  match = matched('^(?:lis|lit)\\s+(?:le\\s+)?(?:fichier\\s+)?(?<name>.+)$', data);
  if (match) return { intent: 'files.read', original, slots: { name: clean(capture(match, 'name', data)) } };
  match = matched('^(?:supprime|efface)\\s+(?:le\\s+)?fichier\\s+(?<name>.+)$', data);
  if (match) return { intent: 'files.delete', original, slots: { name: clean(capture(match, 'name', data)) } };

  return { intent: 'unknown', original, slots: {} };
}

function parse(input) {
  const mapped = normalizeWithMap(input);
  const separator = /\s+puis\s+/g;
  const separators = [...mapped.text.matchAll(separator)];
  if (!separators.length) return parseOne(input);
  if (separators.length > 5) {
    return { intent: 'chain.too_long', original: String(input || '').trim(), slots: {} };
  }

  const pieces = [];
  let normalizedStart = 0;
  for (const item of separators) {
    const start = item.index;
    const end = start + item[0].length;
    const piece = originalRange(mapped, normalizedStart, start).trim();
    if (piece) pieces.push(piece);
    normalizedStart = end;
  }
  const last = originalRange(mapped, normalizedStart, mapped.text.length).trim();
  if (last) pieces.push(last);
  const actions = pieces.map(parseOne);
  if (actions.length > 6 || actions.some((action) => action.intent === 'chain')) {
    return { intent: 'chain.too_long', original: String(input || '').trim(), slots: {} };
  }
  return { intent: 'chain', original: String(input || '').trim(), slots: {}, actions };
}

module.exports = { normalize, normalizeWithMap, parse };
