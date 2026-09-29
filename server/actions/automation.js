'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const nlu = require('../nlu');

const MAX_JOURNAL = 50;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = { dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6 };

async function readJson(file, fallback) {
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    return value && typeof value === 'object' ? value : fallback;
  } catch (error) {
    if (error && error.code === 'ENOENT') return fallback;
    return fallback;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, file);
}

function parseTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) throw new Error('Indique une heure au format HH:MM, par exemple 08:30.');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error('Cette heure n’existe pas. Utilise le format HH:MM.');
  return { hour, minute };
}

function nextDaily(time, now = Date.now()) {
  const { hour, minute } = parseTime(time);
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now) next.setDate(next.getDate() + 1);
  return next.getTime();
}

function nextWeekly(day, time, now = Date.now()) {
  const weekday = typeof day === 'number' ? day : WEEKDAYS[nlu.normalize(day)];
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new Error('Je ne reconnais pas ce jour de la semaine.');
  const { hour, minute } = parseTime(time);
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  let days = (weekday - next.getDay() + 7) % 7;
  if (days === 0 && next.getTime() <= now) days = 7;
  next.setDate(next.getDate() + days);
  return next.getTime();
}

class AutomationService {
  constructor(options = {}) {
    this.dataDir = options.dataDir || path.resolve(__dirname, '..', '..', 'data');
    this.automationFile = path.join(this.dataDir, 'automations.json');
    this.journalFile = path.join(this.dataDir, 'journal.json');
    this.emit = options.emit || (() => {});
    this.executeText = options.executeText || (async () => ({ text: 'Action planifiée exécutée.' }));
    this.clock = options.clock || (() => Date.now());
    this.automations = [];
    this.routines = [];
    this.journal = [];
    this.timer = null;
    this.ticking = false;
  }

  async init() {
    const stored = await readJson(this.automationFile, {});
    this.automations = Array.isArray(stored.automations) ? stored.automations : [];
    this.routines = Array.isArray(stored.routines) ? stored.routines : [];
    const journal = await readJson(this.journalFile, []);
    this.journal = Array.isArray(journal) ? journal.slice(0, MAX_JOURNAL) : [];
    await this.persistAutomations();
    this.start();
    return this;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { this.tick().catch(() => {}); }, 1000);
    if (this.timer.unref) this.timer.unref();
    this.tick().catch(() => {});
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async persistAutomations() {
    await writeJson(this.automationFile, { automations: this.automations, routines: this.routines });
  }

  async persistJournal() {
    this.journal = this.journal.slice(0, MAX_JOURNAL);
    await writeJson(this.journalFile, this.journal);
  }

  async addJournal(entry) {
    this.journal.unshift({ id: crypto.randomUUID(), at: new Date(this.clock()).toISOString(), ...entry });
    this.journal = this.journal.slice(0, MAX_JOURNAL);
    await this.persistJournal();
  }

  async createReminder(text, delayMs) {
    const delay = Number(delayMs);
    if (!Number.isFinite(delay) || delay < 500 || delay > 365 * DAY_MS) throw new Error('Le délai doit être compris entre une demi-seconde et un an.');
    const item = {
      id: crypto.randomUUID(), kind: 'reminder', text: String(text || '').trim(),
      createdAt: this.clock(), nextAt: this.clock() + delay, enabled: true,
    };
    if (!item.text) throw new Error('Dis-moi ce dont je dois te rappeler.');
    this.automations.push(item);
    await this.persistAutomations();
    const when = new Date(item.nextAt).toLocaleString('fr-FR');
    return { text: `C’est noté : je te rappellerai « ${item.text} » vers **${when}** ⏰` };
  }

  async createDaily(time, action) {
    return this.createRecurring({ kind: 'daily', time, action });
  }

  async createWeekly(day, time, action) {
    return this.createRecurring({ kind: 'weekly', day, time, action });
  }

  async createInterval(minutes, action) {
    const amount = Number(minutes);
    if (!Number.isInteger(amount) || amount < 1 || amount > 525_600) throw new Error('Choisis un intervalle entier entre 1 minute et un an.');
    return this.createRecurring({ kind: 'interval', everyMs: amount * 60_000, action, label: `toutes les ${amount} minutes` });
  }

  async createRecurring(options) {
    const action = String(options.action || '').trim();
    if (!action) throw new Error('Il me faut l’action à répéter après les deux-points.');
    const now = this.clock();
    const item = {
      id: crypto.randomUUID(), kind: options.kind, action, createdAt: now, enabled: true,
    };
    if (options.kind === 'daily') {
      parseTime(options.time);
      item.time = options.time;
      item.nextAt = nextDaily(options.time, now);
      item.label = `chaque jour à ${options.time}`;
    } else if (options.kind === 'weekly') {
      const day = nlu.normalize(options.day);
      if (!(day in WEEKDAYS)) throw new Error('Je n’ai pas reconnu le jour de la semaine.');
      parseTime(options.time);
      item.day = day;
      item.time = options.time;
      item.nextAt = nextWeekly(day, options.time, now);
      item.label = `chaque ${day} à ${options.time}`;
    } else {
      item.everyMs = options.everyMs;
      item.nextAt = now + options.everyMs;
      item.label = options.label || 'à intervalle régulier';
    }
    this.automations.push(item);
    await this.persistAutomations();
    return { text: `C’est programmé : **${item.label}**, je lancerai « ${action} » au bon moment. Tu peux dire « historique des rappels » pour consulter le journal. ⏰` };
  }

  async createRoutine(name, actions) {
    const cleanName = String(name || '').trim();
    const steps = Array.isArray(actions) ? actions.map((step) => String(step).trim()).filter(Boolean) : String(actions || '').split(';').map((step) => step.trim()).filter(Boolean);
    if (!cleanName) throw new Error('Donne un nom à cette routine.');
    if (steps.length < 1 || steps.length > 6) throw new Error('Une routine doit contenir entre 1 et 6 actions, séparées par des points-virgules.');
    const key = nlu.normalize(cleanName);
    if (this.routines.some((routine) => nlu.normalize(routine.name) === key)) throw new Error(`La routine « ${cleanName} » existe déjà.`);
    const routine = { id: crypto.randomUUID(), name: cleanName, actions: steps, createdAt: this.clock() };
    this.routines.push(routine);
    await this.persistAutomations();
    return { text: `La routine **${cleanName}** est prête avec ${steps.length} action${steps.length > 1 ? 's' : ''}. Pour la lancer, dis « exécute routine ${cleanName} ». 👌` };
  }

  listRoutines() {
    return this.routines.map((routine) => ({ name: routine.name, actions: routine.actions }));
  }

  getRoutine(name) {
    const key = nlu.normalize(name);
    return this.routines.find((routine) => nlu.normalize(routine.name) === key) || null;
  }

  async deleteRoutine(name) {
    const key = nlu.normalize(name);
    const index = this.routines.findIndex((routine) => nlu.normalize(routine.name) === key);
    if (index < 0) throw new Error(`Je ne trouve pas de routine appelée « ${name} ».`);
    const [removed] = this.routines.splice(index, 1);
    await this.persistAutomations();
    return { text: `La routine **${removed.name}** a été supprimée.` };
  }

  history() {
    return this.journal.slice(0, MAX_JOURNAL);
  }

  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = this.clock();
      const due = this.automations.filter((item) => item.enabled && Number(item.nextAt) <= now);
      for (const item of due) {
        if (item.kind === 'reminder') {
          item.enabled = false;
        } else if (item.kind === 'daily') {
          item.nextAt = nextDaily(item.time, now + 1000);
        } else if (item.kind === 'weekly') {
          item.nextAt = nextWeekly(item.day, item.time, now + 1000);
        } else if (item.kind === 'interval') {
          do { item.nextAt += item.everyMs; } while (item.nextAt <= now);
        }
        await this.persistAutomations();
        let resultText = item.text ? `Rappel : ${item.text}` : `Lancement planifié : ${item.action}`;
        let succeeded = true;
        let confirmation;
        if (item.kind !== 'reminder') {
          try {
            const result = await this.executeText(item.action, { scheduled: true });
            resultText = result && result.text ? result.text : resultText;
            confirmation = result && result.confirmation;
            succeeded = (!result || result.ok !== false) && !confirmation;
          } catch (error) {
            resultText = error && error.message ? error.message : 'L’action planifiée a rencontré une erreur.';
            succeeded = false;
          }
        }
        const title = item.kind === 'reminder' ? 'Petit rappel' : 'Automatisation terminée';
        const message = item.kind === 'reminder' ? `Il est temps de : ${item.text}` : `${item.label} · ${resultText}`;
        await this.addJournal({ kind: item.kind, title, text: message, succeeded, action: item.action || item.text });
        this.emit({ type: 'toast', title, message, at: new Date(now).toISOString(), succeeded, confirmation });
      }
    } finally {
      this.ticking = false;
    }
  }
}

module.exports = { AutomationService, nextDaily, nextWeekly, parseTime, WEEKDAYS, MAX_JOURNAL };
