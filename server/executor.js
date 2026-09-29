'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const nlu = require('./nlu');
const tone = require('./tone');
const safety = require('./safety');
const files = require('./actions/files');
const system = require('./actions/system');
const { AutomationService } = require('./actions/automation');
const { ExtraService, calculate, formatCalculation } = require('./actions/extras');

const HISTORY_LIMIT = 100;

function defaultRoot(platform = process.platform) {
  if (platform === 'win32') return 'C:\\Users';
  return os.homedir();
}

function userFriendlyError(error) {
  if (!error) return 'Essaie encore dans un instant.';
  if (error.code === 'ENOENT') return 'Je ne trouve pas ce fichier ou ce dossier. Vérifie son nom et son emplacement.';
  if (error.code === 'EEXIST') return 'Il existe déjà quelque chose à cet emplacement, je préfère ne pas l’écraser.';
  if (error.code === 'EACCES' || error.code === 'EPERM') return 'Je n’ai pas les droits nécessaires pour faire ça dans ce dossier.';
  if (error.code === 'ENOTDIR') return 'Un élément du chemin indiqué n’est pas un dossier.';
  if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET') return 'Le service ne répond pas pour le moment. Réessaie un peu plus tard.';
  if (error.code) return 'Le système a refusé cette opération. Vérifie les droits et le chemin, puis réessaie.';
  return error.message || 'Essaie encore dans un instant.';
}

function localTime() {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'medium' }).format(new Date());
}

class Executor {
  constructor(options = {}) {
    this.platform = options.platform || process.platform;
    this.root = path.resolve(options.root || process.env.NIKOUS_ROOT || defaultRoot(this.platform));
    this.dataDir = options.dataDir || path.resolve(__dirname, '..', 'data');
    this.forcedFullAccess = options.forcedFullAccess == null
      ? process.env.NIKOUS_FULL_ACCESS === '1'
      : Boolean(options.forcedFullAccess);
    this.fullAccess = this.forcedFullAccess || Boolean(options.fullAccess);
    this.emit = options.emit || (() => {});
    this.confirmations = new safety.ConfirmationTokens({ ttl: 120_000, clock: options.clock });
    this.extras = new ExtraService({ dataDir: this.dataDir });
    this.automations = new AutomationService({
      dataDir: this.dataDir,
      emit: (event) => this.emit(event),
      executeText: (message, context) => this.execute(message, context),
      clock: options.clock,
    });
    this.historyFile = path.join(this.dataDir, 'history.json');
    this.historyItems = [];
    this.ready = false;
  }

  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
    try {
      const history = JSON.parse(await fs.readFile(this.historyFile, 'utf8'));
      this.historyItems = Array.isArray(history) ? history.slice(0, HISTORY_LIMIT) : [];
    } catch {
      this.historyItems = [];
    }
    await this.extras.init();
    await this.automations.init();
    await this.loadSettings();
    this.ready = true;
    return this;
  }

  async loadSettings() {
    try {
      const value = JSON.parse(await fs.readFile(path.join(this.dataDir, 'settings.json'), 'utf8'));
      if (!this.forcedFullAccess && typeof value.fullAccess === 'boolean') this.fullAccess = value.fullAccess;
    } catch { /* les réglages peuvent ne pas exister au premier lancement */ }
  }

  async saveSettings() {
    await fs.mkdir(this.dataDir, { recursive: true });
    const file = path.join(this.dataDir, 'settings.json');
    const temporary = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify({ fullAccess: this.fullAccess }, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, file);
  }

  async setFullAccess(value) {
    if (this.forcedFullAccess) this.fullAccess = true;
    else this.fullAccess = Boolean(value);
    await this.saveSettings();
    return this.getSettings();
  }

  getSettings() {
    return {
      fullAccess: this.fullAccess,
      forcedFullAccess: this.forcedFullAccess,
      root: this.root,
      mode: this.fullAccess ? 'accès complet' : 'mode sûr',
    };
  }

  async history() {
    return this.historyItems.slice(0, HISTORY_LIMIT);
  }

  async record(message, result) {
    this.historyItems.unshift({ at: new Date().toISOString(), message: String(message), reply: result.text || '', ok: result.ok !== false });
    this.historyItems = this.historyItems.slice(0, HISTORY_LIMIT);
    try {
      await fs.writeFile(this.historyFile, `${JSON.stringify(this.historyItems, null, 2)}\n`, 'utf8');
    } catch { /* l’action ne doit pas échouer si l’historique n’est pas inscriptible */ }
  }

  context() {
    return { root: this.root, fullAccess: this.fullAccess, platform: this.platform };
  }

  async execute(message, options = {}) {
    let result;
    try {
      const parsed = nlu.parse(message);
      result = await this.executeParsed(parsed, options);
    } catch (error) {
      result = { text: tone.oops(userFriendlyError(error)), ok: false };
    }
    if (!options.scheduled) await this.record(message, result);
    return result;
  }

  async executeParsed(parsed, options = {}) {
    const slots = parsed.slots || {};
    const context = this.context();
    try {
      switch (parsed.intent) {
        case 'chain.too_long':
          return { text: 'Je peux enchaîner jusqu’à six actions à la fois. Raccourcis un peu ta demande et je m’en occupe 😊', ok: false };
        case 'chain':
          return this.executeChain(parsed.actions || [], options);
        case 'smalltalk.greeting':
          return { text: tone.pick(['Salut ! Ça fait plaisir de te retrouver 😊 Qu’est-ce que je peux faire pour toi ?', 'Hello 👋 Je suis là — raconte-moi ce qu’il te faut.', 'Coucou ! Tu peux me demander une action directement, ou juste papoter un peu 🙂']) };
        case 'smalltalk.mood':
          return { text: tone.pick(['Ça va très bien, merci ! Je suis prêt à t’aider. Et toi, comment tu vas ? 😊', 'Au top, merci de demander ⚡ Et toi, ta journée se passe bien ?', 'Je vais bien — surtout quand je peux te simplifier la vie 😌 Et toi ?']) };
        case 'smalltalk.joke':
          return { text: tone.pick(['Pourquoi les développeurs confondent-ils Halloween et Noël ? Parce que OCT 31 = DEC 25 🎃', 'Un ordinateur entre dans un bar… le serveur lui demande : « Une mise à jour ? » Il répond : « Pas maintenant, je suis en train de redémarrer. » 😄', 'Pourquoi le disque dur est-il toujours calme ? Parce qu’il garde tout en mémoire… mais il a parfois besoin de souffler un peu 🤓']) };
        case 'smalltalk.goodbye':
          return { text: tone.pick(['À bientôt ! Prends soin de toi, je reste dans le coin 👋', 'Bonne nuit 🌙 Repose-toi bien, on se retrouve quand tu veux.', 'Au revoir et belle journée à toi 😊']) };
        case 'smalltalk.thanks':
          return { text: tone.pick(['Avec plaisir 😊 C’est toujours un plaisir de t’aider.', 'Je t’en prie ! Tu peux compter sur moi 👌', 'Pas de souci — je suis là si tu as besoin d’autre chose.']) };
        case 'smalltalk.identity':
          return { text: 'Je suis **NIKOUS**, ton assistant local de contrôle de poste ⚡ Je tourne sur cette machine et je peux t’aider avec tes fichiers, des commandes, des rappels, des notes et quelques petites questions du quotidien.' };
        case 'smalltalk.capabilities':
          return { text: 'Je peux gérer tes fichiers, faire le point sur le système, lancer certaines commandes, prendre des notes, calculer, consulter la météo, programmer des rappels et exécuter des routines. Le tout en français, directement depuis cette interface 😊 Si tu veux la liste détaillée, dis simplement `aide`.' };
        case 'help':
          return {
            text: 'Avec plaisir — voilà tout ce que je sais faire 👇\n\n**Fichiers** · `liste les fichiers` · `lis notes.txt` · `crée fichier idées.txt avec …` · `cherche fichier contenant budget` · `supprime fichier ancien.txt`\n\n**Poste** · `état du système` · `liste des processus` · `quelle heure est-il` · `exécute commande git status` · `ouvre le dossier Documents` · `ouvre le document rapport.xlsx` · `ouvre Word` / `ouvre Excel` · `ouvre https://…`\n\n**Quotidien** · `météo à Paris` · `calcule sqrt(81) + pi` · `note : appeler le médecin` · `mes notes` · `heure à Europe/Paris`\n\n**Automatisations** · `rappelle-moi dans 10 minutes de faire une pause` · `chaque lundi à 09:00 : état du système` · `toutes les 30 minutes : liste des processus` · `crée routine matin : état du système ; liste des processus`\n\nTu peux aussi enchaîner jusqu’à six demandes avec **puis**, ou appuyer sur 🎙 pour parler en conversation vocale locale (Chrome récent et modèle fr-FR installé). En mode sûr, les actions sensibles demandent ton accord et les commandes destructrices restent bloquées. Qu’est-ce qu’on fait en premier ? 😊',
          };
        case 'system.time':
          return { text: `Il est **${localTime()}** chez toi ⏰` };
        case 'system.status':
          return system.systemStatus(context);
        case 'system.processes':
          return system.listProcesses(this.platform);
        case 'system.command':
          return this.executeCommand(slots.command);
        case 'system.open':
          return this.executeOpen(slots.target, slots.targetType);
        case 'files.list':
          return files.listFiles(slots, context);
        case 'files.read':
          return files.readFile(slots, context);
        case 'files.create':
          return files.createFile(slots, context);
        case 'files.mkdir':
          return files.createDirectory(slots, context);
        case 'files.rename':
          return files.renameFile(slots, context);
        case 'files.size':
          return files.fileSize(slots, context);
        case 'files.find':
          return files.findFiles(slots, context);
        case 'files.grep':
          return files.grepFiles(slots, context);
        case 'files.delete':
          return this.requestFileDeletion(slots.name);
        case 'extra.calculate': {
          const answer = calculate(slots.expression);
          return { text: `J’ai calculé **${slots.expression}** : **${formatCalculation(answer)}** 🧮`, blocks: [{ type: 'kv', items: [{ label: 'Résultat', value: formatCalculation(answer) }] }] };
        }
        case 'extra.weather':
          return this.extras.weather(slots.city);
        case 'extra.worldtime':
          return this.extras.worldTime(slots.place);
        case 'extra.note.add':
          return this.extras.addNote(slots.text);
        case 'extra.note.list': {
          const notes = this.extras.listNotes();
          return {
            text: notes.length ? `Voici tes ${notes.length} note${notes.length > 1 ? 's' : ''} — tu peux en retirer une en disant « supprime note <numéro> » :` : 'Tu n’as pas encore de note. Dis-moi par exemple « note : penser au rendez-vous » pour en garder une. 📝',
            blocks: notes.length ? [{ type: 'notes', items: notes }] : [],
          };
        }
        case 'extra.note.delete':
          return this.extras.deleteNote(slots.number);
        case 'automation.reminder':
          return this.createReminder(slots);
        case 'automation.daily':
          return this.automations.createDaily(slots.time, slots.action);
        case 'automation.weekly':
          return this.automations.createWeekly(slots.day, slots.time, slots.action);
        case 'automation.interval':
          return this.automations.createInterval(slots.amount, slots.action);
        case 'automation.history':
          return this.automationHistory();
        case 'automation.routine.create':
          return this.automations.createRoutine(slots.name, slots.actions);
        case 'automation.routine.list': {
          const routines = this.automations.listRoutines();
          return {
            text: routines.length ? `Voilà tes routines. Pour en lancer une, dis « exécute routine <nom> » :` : 'Tu n’as pas encore créé de routine. Tu peux en préparer une avec « crée routine matin : état du système ; liste des processus ». ',
            blocks: routines.length ? [{ type: 'routines', items: routines }] : [],
          };
        }
        case 'automation.routine.run':
          return this.runRoutine(slots.name, options);
        case 'automation.routine.delete':
          return this.automations.deleteRoutine(slots.name);
        case 'unknown':
        default:
          return { text: tone.notUnderstood(), ok: false };
      }
    } catch (error) {
      return { text: tone.oops(userFriendlyError(error)), ok: false };
    }
  }

  async executeChain(actions, options = {}) {
    if (!Array.isArray(actions) || actions.length < 2 || actions.length > 6) {
      return { text: 'Je peux enchaîner de deux à six actions. Essaie de reformuler ta demande 🙂', ok: false };
    }
    const replies = [];
    const blocks = [];
    for (const action of actions) {
      const result = await this.executeParsed(action, options);
      replies.push(result.text);
      if (Array.isArray(result.blocks)) blocks.push(...result.blocks);
      if (result.confirmation) {
        return { text: replies.join('\n\n'), blocks, confirmation: result.confirmation, ok: true };
      }
      if (result.ok === false) {
        replies.push('Je me suis arrêtée ici pour ne pas continuer après cette difficulté.');
        return { text: replies.join('\n\n'), blocks, ok: false };
      }
    }
    return { text: replies.join('\n\n'), blocks, ok: true };
  }

  async executeCommand(command) {
    const verdict = safety.classifyCommand(command, this.platform);
    if (verdict.level === 'blocked') {
      return { text: tone.pick([
        'Je préfère dire non à celle-là 😌 Cette commande peut mettre le système ou tes données en danger.',
        'Je ne peux pas lancer cette commande : les actions de destruction globale sont bloquées sans exception. 🛡️',
      ]), ok: false };
    }
    if (verdict.level === 'confirm' && !this.fullAccess) {
      const prompt = `Juste pour être sûr(e) : tu veux vraiment exécuter la commande **${String(command).trim()}** ?`;
      const confirmation = this.confirmations.create(() => this.runValidatedCommand(command), prompt, { kind: 'command' });
      return { text: prompt, confirmation, ok: true };
    }
    try {
      const result = await this.runValidatedCommand(command);
      return result;
    } catch (error) {
      return { text: tone.oops(userFriendlyError(error)), ok: false };
    }
  }

  async runValidatedCommand(command) {
    await safety.validateCommandPaths(command, {
      root: this.root,
      fullAccess: this.fullAccess,
      platform: this.platform,
    });
    return system.runCommand(command, this.context());
  }

  async executeOpen(target, targetType) {
    const verdict = await system.classifyOpenTargetAsync(target, this.context(), targetType);
    if (verdict.level === 'blocked') return { text: `Je ne peux pas ouvrir cette destination. ${verdict.reason || ''}`.trim(), ok: false };
    if (verdict.level === 'not-found') return { text: verdict.reason, ok: false };
    if (verdict.level === 'confirm' && !this.fullAccess) {
      const prompt = `Juste pour être sûr(e) : tu veux vraiment ouvrir l’application **${target}** ?`;
      const confirmation = this.confirmations.create(() => system.openTarget(target, this.context(), targetType), prompt, { kind: 'open' });
      return { text: prompt, confirmation, ok: true };
    }
    try { return await system.openTarget(target, this.context(), targetType); }
    catch (error) { return { text: tone.oops(userFriendlyError(error)), ok: false }; }
  }

  async requestFileDeletion(name) {
    const context = this.context();
    const filePath = await safety.resolveSafePath(name, { root: context.root, fullAccess: context.fullAccess });
    const stat = await fs.lstat(filePath);
    if (!stat.isFile()) throw new Error('Pour éviter une suppression trop large, je ne supprime ici que des fichiers — pas les dossiers.');
    const display = path.relative(context.root, filePath).split(path.sep).join('/') || path.basename(filePath);
    const prompt = `Juste pour être sûr(e) : tu veux vraiment supprimer **${display}** ?`;
    const confirmation = this.confirmations.create(() => files.deleteFile({ name }, this.context()), prompt, { kind: 'file-delete', path: display });
    return { text: prompt, confirmation, ok: true };
  }

  async createReminder(slots) {
    const unit = String(slots.unit || '').toLowerCase();
    const factors = { seconde: 1000, secondes: 1000, sec: 1000, secs: 1000, minute: 60_000, minutes: 60_000, min: 60_000, mins: 60_000, heure: 3_600_000, heures: 3_600_000, h: 3_600_000, jour: 86_400_000, jours: 86_400_000 };
    const delay = Number(slots.amount) * (factors[unit] || 0);
    return this.automations.createReminder(slots.text, delay);
  }

  async automationHistory() {
    const items = this.automations.history();
    return {
      text: items.length ? `Voici les ${items.length} dernières entrées du journal des rappels et tâches :` : 'Le journal est encore vide. Je t’y montrerai les rappels et les tâches dès qu’ils se déclenchent. ⏰',
      blocks: items.length ? [{ type: 'table', headers: ['Date', 'Événement', 'Résultat'], rows: items.map((item) => [new Date(item.at).toLocaleString('fr-FR'), item.text || item.title, item.succeeded === false ? 'À vérifier' : 'Terminé']) }] : [],
    };
  }

  async runRoutine(name, options = {}) {
    const routine = this.automations.getRoutine(name);
    if (!routine) throw new Error(`Je ne trouve pas de routine appelée « ${name} ».`);
    const parsedActions = routine.actions.map((action) => nlu.parse(action));
    const result = await this.executeChain(parsedActions, options);
    return { ...result, text: `Routine **${routine.name}** :\n\n${result.text}` };
  }

  async confirm(token, approved) {
    const result = this.confirmations.take(token);
    if (!result.ok) return { text: result.reason, ok: false };
    if (!approved) return { text: 'D’accord, j’annule. Aucune modification n’a été faite 🙂', ok: true };
    try {
      const actionResult = await result.entry.action();
      const output = actionResult && actionResult.text ? actionResult : { text: tone.done() };
      if (result.entry.metadata.kind === 'command') {
        output.text = `Merci pour la confirmation. ${output.text}`;
      }
      return output;
    } catch (error) {
      return { text: tone.oops(userFriendlyError(error)), ok: false };
    }
  }

  stop() {
    this.automations.stop();
    this.confirmations.clear();
  }
}

module.exports = { Executor, defaultRoot, userFriendlyError };
