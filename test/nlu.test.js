'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const nlu = require('../server/nlu');

test('normalise les accents sans perdre le texte original capturé', () => {
  assert.equal(nlu.normalize('ÉTÉ, déjà !'), 'ete, deja !');
  const parsed = nlu.parse('Crée fichier École.txt avec Bonjour, Été !');
  assert.equal(parsed.intent, 'files.create');
  assert.equal(parsed.slots.name, 'École.txt');
  assert.equal(parsed.slots.content, 'Bonjour, Été !');
  const decomposed = nlu.parse('crée fichier e\u0301cole.txt avec Cafe\u0301');
  assert.equal(decomposed.slots.name, 'e\u0301cole.txt');
  assert.equal(decomposed.slots.content, 'Cafe\u0301');
});

test('reconnaît la conversation sur le moral', () => {
  assert.equal(nlu.parse('Comment ça va ?').intent, 'smalltalk.mood');
  assert.equal(nlu.parse('Quoi de neuf ?').intent, 'smalltalk.mood');
});

test('reconnaît les blagues et les salutations', () => {
  assert.equal(nlu.parse('Raconte une blague').intent, 'smalltalk.joke');
  assert.equal(nlu.parse('fais moi rire').intent, 'smalltalk.joke');
  assert.equal(nlu.parse('Au revoir').intent, 'smalltalk.goodbye');
  assert.equal(nlu.parse('Merci !').intent, 'smalltalk.thanks');
});

test('reconnaît les demandes d’aide et de présentation', () => {
  assert.equal(nlu.parse('aide').intent, 'help');
  assert.equal(nlu.parse('qui es-tu ?').intent, 'smalltalk.identity');
  assert.equal(nlu.parse('tu fais quoi').intent, 'smalltalk.capabilities');
});

test('reconnaît les opérations de fichiers courantes', () => {
  assert.deepEqual(nlu.parse('liste les fichiers de Mes Documents').slots, { directory: 'Mes Documents' });
  assert.equal(nlu.parse('lis le fichier compte rendu.txt').intent, 'files.read');
  assert.equal(nlu.parse('crée dossier Archives').intent, 'files.mkdir');
  assert.equal(nlu.parse('renomme ancien.txt en nouveau.txt').intent, 'files.rename');
  assert.equal(nlu.parse('taille de ancien.txt').intent, 'files.size');
});

test('sépare la recherche par nom de la recherche dans le contenu', () => {
  const byName = nlu.parse('cherche fichier contenant budget');
  assert.equal(byName.intent, 'files.find');
  assert.equal(byName.slots.term, 'budget');
  const byText = nlu.parse('cherche "été" dans les fichiers de docs');
  assert.equal(byText.intent, 'files.grep');
  assert.equal(byText.slots.term, 'été');
  assert.equal(byText.slots.directory, 'docs');
});

test('reconnaît les actions du poste et conserve la commande originale', () => {
  assert.equal(nlu.parse('état du système').intent, 'system.status');
  assert.equal(nlu.parse('liste des processus').intent, 'system.processes');
  assert.equal(nlu.parse('quelle heure est-il').intent, 'system.time');
  assert.equal(nlu.parse('exécute commande git status').slots.command, 'git status');
  assert.equal(nlu.parse('ouvre https://example.com').slots.target, 'https://example.com');
  assert.deepEqual(nlu.parse('ouvre le dossier Documents').slots, { target: 'Documents', targetType: 'path' });
  assert.deepEqual(nlu.parse('ouvre un dossier Projets').slots, { target: 'Projets', targetType: 'path' });
  assert.deepEqual(nlu.parse('ouvre un document rapport.xlsx').slots, { target: 'rapport.xlsx', targetType: 'path' });
  assert.equal(nlu.parse('lance Excel').slots.target, 'Excel');
  assert.deepEqual(nlu.parse('cherche sur le web météo Cotonou').slots, { query: 'météo Cotonou' });
  assert.equal(nlu.parse('cherche sur le web météo Cotonou').intent, 'web.search');
  assert.equal(nlu.parse('verrouille mon écran').intent, 'system.lock');
  assert.equal(nlu.parse('fais une capture d’écran').intent, 'system.screenshot');
  assert.deepEqual(nlu.parse('mets le volume à 45%').slots, { percent: 45 });
  assert.equal(nlu.parse('ferme Word').intent, 'system.close');
  assert.deepEqual(nlu.parse('passe à Chrome').slots, { target: 'Chrome' });
  assert.deepEqual(nlu.parse('Dis à papa que je suis en retard').slots, { name: 'papa', message: 'je suis en retard' });
  assert.equal(nlu.parse('Dis à papa que je suis en retard').intent, 'messaging.whatsapp');
  assert.equal(nlu.parse('ajoute contact Papa +229 97 00 00 00').intent, 'contacts.add');
});

test('reconnaît les rappels et les récurrences quotidiennes', () => {
  const reminder = nlu.parse('rappelle-moi dans 10 min de boire de l’eau');
  assert.equal(reminder.intent, 'automation.reminder');
  assert.equal(reminder.slots.amount, '10');
  assert.equal(reminder.slots.text, 'boire de l’eau');
  assert.equal(nlu.parse('chaque jour à 08:30 : état du système').intent, 'automation.daily');
  assert.equal(nlu.parse('toutes les 5 minutes : état du système').intent, 'automation.interval');
});

test('reconnaît les rappels hebdomadaires avec le jour et l’action', () => {
  const result = nlu.parse('chaque mardi à 08:30 : état du système');
  assert.equal(result.intent, 'automation.weekly');
  assert.deepEqual(result.slots, { day: 'mardi', time: '08:30', action: 'état du système' });
});

test('reconnaît le journal et les commandes de routine', () => {
  assert.equal(nlu.parse('historique des rappels').intent, 'automation.history');
  const create = nlu.parse('crée routine matin : état du système ; liste les processus');
  assert.equal(create.intent, 'automation.routine.create');
  assert.equal(create.slots.name, 'matin');
  assert.equal(nlu.parse('exécute routine matin').intent, 'automation.routine.run');
  assert.equal(nlu.parse('liste les routines').intent, 'automation.routine.list');
});

test('reconnaît les extras du quotidien en français', () => {
  assert.equal(nlu.parse('météo à Montréal').intent, 'extra.weather');
  assert.equal(nlu.parse('calcule sqrt(81) + pi').intent, 'extra.calculate');
  assert.equal(nlu.parse('note : appeler le médecin').intent, 'extra.note.add');
  assert.equal(nlu.parse('mes notes').intent, 'extra.note.list');
  assert.equal(nlu.parse('heure à Europe/Paris').slots.place, 'Europe/Paris');
});

test('chaîne jusqu’à six intentions puis refuse une chaîne trop longue', () => {
  const result = nlu.parse('salut puis état du système puis mes notes');
  assert.equal(result.intent, 'chain');
  assert.deepEqual(result.actions.map((item) => item.intent), ['smalltalk.greeting', 'system.status', 'extra.note.list']);
  assert.equal(nlu.parse('a puis b puis c puis d puis e puis f puis g').intent, 'chain.too_long');
});
