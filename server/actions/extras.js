'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const FUNCTIONS = {
  sqrt: { min: 1, max: 1, run: ([value]) => Math.sqrt(value) },
  abs: { min: 1, max: 1, run: ([value]) => Math.abs(value) },
  round: { min: 1, max: 2, run: ([value, digits = 0]) => {
    if (Math.abs(digits) > 10) throw new Error('Pour arrondir, choisis entre 0 et 10 décimales.');
    const factor = 10 ** digits;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  } },
  floor: { min: 1, max: 1, run: ([value]) => Math.floor(value) },
  ceil: { min: 1, max: 1, run: ([value]) => Math.ceil(value) },
  sin: { min: 1, max: 1, run: ([value]) => Math.sin(value) },
  cos: { min: 1, max: 1, run: ([value]) => Math.cos(value) },
  tan: { min: 1, max: 1, run: ([value]) => Math.tan(value) },
  ln: { min: 1, max: 1, run: ([value]) => Math.log(value) },
  log: { min: 1, max: 1, run: ([value]) => Math.log10(value) },
  exp: { min: 1, max: 1, run: ([value]) => Math.exp(value) },
};

function tokenize(expression) {
  const source = String(expression || '').trim();
  if (!source || source.length > 300) throw new Error('Entre une expression courte à calculer (300 caractères maximum).');
  const tokens = [];
  let position = 0;
  const numberPattern = /^(?:(?:\d+(?:\.\d+|,\d+)?|\.\d+|,\d+))/;
  const namePattern = /^[a-z]+/i;
  while (position < source.length) {
    if (/\s/.test(source[position])) { position += 1; continue; }
    const rest = source.slice(position);
    const number = numberPattern.exec(rest);
    if (number) {
      const value = Number(number[0].replace(',', '.'));
      if (!Number.isFinite(value)) throw new Error('Ce nombre ne semble pas valide.');
      tokens.push({ type: 'number', value });
      position += number[0].length;
    } else {
      const name = namePattern.exec(rest);
      if (name) {
        tokens.push({ type: 'name', value: name[0].toLowerCase() });
        position += name[0].length;
      } else if ('()+-*/^,'.includes(source[position])) {
        tokens.push({ type: source[position], value: source[position] });
        position += 1;
      } else {
        throw new Error(`Le caractère « ${source[position]} » n’est pas autorisé dans une expression.`);
      }
    }
    if (tokens.length > 256) throw new Error('Cette expression contient trop d’éléments.');
  }
  return tokens;
}

function calculate(expression) {
  const tokens = tokenize(expression);
  let cursor = 0;
  const peek = () => tokens[cursor];
  const take = (type) => {
    if (!peek() || peek().type !== type) throw new Error('Il manque une parenthèse ou un opérateur dans cette expression.');
    return tokens[cursor++];
  };
  const finite = (value) => {
    if (!Number.isFinite(value)) throw new Error('Le résultat n’est pas un nombre fini. Vérifie les divisions et les fonctions utilisées.');
    if (Math.abs(value) > 1e100) throw new Error('Le résultat est trop grand pour être affiché.');
    return value;
  };

  function primary() {
    const token = peek();
    if (!token) throw new Error('L’expression est incomplète.');
    if (token.type === 'number') {
      cursor += 1;
      return token.value;
    }
    if (token.type === '(') {
      cursor += 1;
      const value = expressionValue();
      take(')');
      return value;
    }
    if (token.type === 'name') {
      cursor += 1;
      if (token.value === 'pi') return Math.PI;
      const descriptor = FUNCTIONS[token.value];
      if (!descriptor) throw new Error(`La fonction « ${token.value} » n’est pas autorisée.`);
      take('(');
      const args = [];
      if (!peek() || peek().type !== ')') {
        args.push(expressionValue());
        while (peek() && peek().type === ',') {
          cursor += 1;
          args.push(expressionValue());
        }
      }
      take(')');
      if (args.length < descriptor.min || args.length > descriptor.max) {
        throw new Error(`La fonction ${token.value} attend ${descriptor.min === descriptor.max ? descriptor.min : `entre ${descriptor.min} et ${descriptor.max}`} argument${descriptor.max > 1 ? 's' : ''}.`);
      }
      return finite(descriptor.run(args));
    }
    throw new Error('Je ne sais pas comment interpréter cette partie de l’expression.');
  }

  function power() {
    const left = primary();
    if (peek() && peek().type === '^') {
      cursor += 1;
      return finite(left ** unary());
    }
    return left;
  }

  function unary() {
    if (peek() && (peek().type === '+' || peek().type === '-')) {
      const operator = tokens[cursor++].type;
      const value = unary();
      return operator === '-' ? -value : value;
    }
    return power();
  }

  function term() {
    let value = unary();
    while (peek() && (peek().type === '*' || peek().type === '/')) {
      const operator = tokens[cursor++].type;
      const right = unary();
      if (operator === '/' && right === 0) throw new Error('La division par zéro n’est pas possible.');
      value = finite(operator === '*' ? value * right : value / right);
    }
    return value;
  }

  function expressionValue() {
    let value = term();
    while (peek() && (peek().type === '+' || peek().type === '-')) {
      const operator = tokens[cursor++].type;
      const right = term();
      value = finite(operator === '+' ? value + right : value - right);
    }
    return value;
  }

  const result = finite(expressionValue());
  if (cursor !== tokens.length) throw new Error('Il reste un élément inattendu après l’expression.');
  return Object.is(result, -0) ? 0 : result;
}

function weatherDescription(code) {
  const descriptions = new Map([
    [0, 'ciel dégagé'], [1, 'plutôt dégagé'], [2, 'partiellement nuageux'], [3, 'couvert'],
    [45, 'brouillard'], [48, 'brouillard givrant'], [51, 'bruine légère'], [53, 'bruine modérée'], [55, 'bruine dense'],
    [56, 'bruine verglaçante légère'], [57, 'bruine verglaçante dense'], [61, 'pluie faible'], [63, 'pluie modérée'], [65, 'forte pluie'],
    [66, 'pluie verglaçante légère'], [67, 'forte pluie verglaçante'], [71, 'faibles chutes de neige'], [73, 'neige modérée'], [75, 'fortes chutes de neige'],
    [77, 'grains de neige'], [80, 'averses faibles'], [81, 'averses modérées'], [82, 'fortes averses'],
    [85, 'averses de neige légères'], [86, 'fortes averses de neige'], [95, 'orage'], [96, 'orage avec grêle légère'], [99, 'orage avec forte grêle'],
  ]);
  return descriptions.get(Number(code)) || 'conditions météo variables';
}

async function fetchJson(url, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`Service météo indisponible (HTTP ${response.status}).`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function geocodeCity(city) {
  const endpoint = new URL('https://geocoding-api.open-meteo.com/v1/search');
  endpoint.searchParams.set('name', String(city));
  endpoint.searchParams.set('count', '1');
  endpoint.searchParams.set('language', 'fr');
  endpoint.searchParams.set('format', 'json');
  const data = await fetchJson(endpoint);
  return data.results && data.results[0];
}

class ExtraService {
  constructor(options = {}) {
    this.dataDir = options.dataDir || path.resolve(__dirname, '..', '..', 'data');
    this.notesFile = path.join(this.dataDir, 'notes.json');
    this.notes = [];
    this.nextNoteId = 1;
  }

  async init() {
    try {
      const saved = JSON.parse(await fs.readFile(this.notesFile, 'utf8'));
      this.notes = Array.isArray(saved) ? saved : (Array.isArray(saved.items) ? saved.items : []);
      this.nextNoteId = Number(saved.nextId) || Math.max(0, ...this.notes.map((note) => Number(note.id) || 0)) + 1;
    } catch {
      this.notes = [];
      this.nextNoteId = 1;
    }
    this.notes = this.notes.slice(0, 200);
    return this;
  }

  async persistNotes() {
    await fs.mkdir(this.dataDir, { recursive: true });
    const temporary = `${this.notesFile}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify({ nextId: this.nextNoteId, items: this.notes }, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, this.notesFile);
  }

  async addNote(text) {
    const value = String(text || '').trim();
    if (!value) throw new Error('Écris le texte que tu veux garder en note.');
    if (value.length > 2000) throw new Error('Une note ne peut pas dépasser 2 000 caractères.');
    if (this.notes.length >= 200) throw new Error('Tu as atteint la limite de 200 notes. Supprime-en une pour en ajouter une autre.');
    const note = { id: this.nextNoteId++, text: value, at: new Date().toISOString() };
    this.notes.unshift(note);
    await this.persistNotes();
    return { text: `C’est gardé dans tes notes : « ${value} » 📝` };
  }

  listNotes() {
    return this.notes.map((note) => ({ ...note }));
  }

  async deleteNote(number) {
    const id = Number(number);
    const index = this.notes.findIndex((note) => Number(note.id) === id);
    if (index < 0) throw new Error(`Je ne trouve pas de note numéro ${number}.`);
    const [removed] = this.notes.splice(index, 1);
    await this.persistNotes();
    return { text: `La note numéro ${id} a été supprimée. 🗑️` };
  }

  async weather(city) {
    try {
      const place = await geocodeCity(city);
      if (!place) return { text: `Je ne trouve pas la ville « ${city} ». Vérifie son orthographe ou ajoute le pays.`, ok: false };
      const endpoint = new URL('https://api.open-meteo.com/v1/forecast');
      endpoint.searchParams.set('latitude', place.latitude);
      endpoint.searchParams.set('longitude', place.longitude);
      endpoint.searchParams.set('current', 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m');
      endpoint.searchParams.set('timezone', 'auto');
      const data = await fetchJson(endpoint);
      const current = data.current || {};
      const items = [
        { label: 'Lieu', value: [place.name, place.admin1, place.country].filter(Boolean).join(', ') },
        { label: 'Conditions', value: weatherDescription(current.weather_code) },
        { label: 'Température', value: `${current.temperature_2m} °C (ressenti ${current.apparent_temperature} °C)` },
        { label: 'Humidité', value: `${current.relative_humidity_2m} %` },
        { label: 'Vent', value: `${current.wind_speed_10m} km/h` },
        { label: 'Précipitations', value: `${current.precipitation} mm` },
      ];
      return { text: `Voilà la météo du moment à **${place.name}** 🌤️`, blocks: [{ type: 'kv', items }] };
    } catch {
      return { text: 'Je n’arrive pas à joindre Open-Meteo pour le moment. La météo nécessite une connexion Internet ; le reste de NIKOUS continue de fonctionner hors ligne. 🌙', ok: false };
    }
  }

  async worldTime(place) {
    const value = String(place || '').trim();
    if (!value) throw new Error('Indique une ville ou un fuseau comme Europe/Paris.');
    let timeZone = value;
    let location = value;
    try {
      // Permet d’utiliser directement Europe/Paris ou America/Montreal sans réseau.
      new Intl.DateTimeFormat('fr-FR', { timeZone }).format(new Date());
    } catch {
      try {
        const result = await geocodeCity(value);
        if (!result || !result.timezone) return { text: `Je ne reconnais ni le fuseau ni la ville « ${value} ».`, ok: false };
        timeZone = result.timezone;
        location = [result.name, result.country].filter(Boolean).join(', ');
      } catch {
        return { text: `Je ne peux pas retrouver le fuseau de « ${value} » sans Internet. Tu peux aussi indiquer directement un identifiant comme **Europe/Paris**.`, ok: false };
      }
    }
    const now = new Date();
    const time = new Intl.DateTimeFormat('fr-FR', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(now);
    const date = new Intl.DateTimeFormat('fr-FR', { timeZone, dateStyle: 'full' }).format(now);
    const zoneName = new Intl.DateTimeFormat('fr-FR', { timeZone, timeZoneName: 'long' }).formatToParts(now).find((part) => part.type === 'timeZoneName')?.value || timeZone;
    return {
      text: `À **${location}**, il est ${time} (${zoneName}).`,
      blocks: [{ type: 'kv', items: [{ label: 'Date locale', value: date }, { label: 'Heure', value: time }, { label: 'Fuseau', value: timeZone }] }],
    };
  }
}

function formatCalculation(value) {
  return value.toLocaleString('fr-FR', { maximumFractionDigits: 10 });
}

module.exports = { calculate, tokenize, formatCalculation, ExtraService, weatherDescription };
