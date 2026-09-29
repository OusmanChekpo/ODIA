'use strict';

function pick(choices) {
  if (!Array.isArray(choices) || choices.length === 0) return '';
  return choices[Math.floor(Math.random() * choices.length)];
}

function ack() {
  return pick([
    'Bien sûr, je m’en occupe.',
    'Avec plaisir — je regarde ça.',
    'Entendu, je lance ça tout de suite.',
    'D’accord, je te prépare ça.',
  ]);
}

function done() {
  return pick([
    'Et voilà, c’est fait 👌',
    'C’est réglé !',
    'Voilà, tout est prêt 😊',
    'Terminé — tu peux compter dessus.',
  ]);
}

function notUnderstood() {
  return pick([
    'Hum, je n’ai pas bien saisi ce que tu veux faire. Tu peux le dire autrement, ou taper `aide` pour voir des exemples ? 🙂',
    'Je crois qu’il me manque un petit détail 😌 Tu peux reformuler ? `aide` te montrera aussi quelques idées.',
    'Je ne suis pas sûr d’avoir compris — essaie avec une phrase un peu différente, ou demande-moi `aide` 😊',
  ]);
}

function oops(detail = '') {
  const prefix = pick([
    'Oups, je n’ai pas réussi à terminer cette action.',
    'Hum, quelque chose m’a empêché d’aller au bout.',
    'Je suis désolé, ça n’a pas fonctionné comme prévu.',
  ]);
  return detail ? `${prefix} ${detail}` : prefix;
}

module.exports = { pick, ack, done, notUnderstood, oops };
