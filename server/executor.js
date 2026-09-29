'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const nlu = require('./nlu');
const tone = require('./tone');
const safety = require('./safety');
const files = require('./actions/files');
const system = require('./actions/system');
const desktop = require('./actions/desktop');
const { ContactsService } = require('./actions/contacts');
const { AutomationService } = require('./actions/automation');
const { ExtraService, calculate, formatCalculation } = require('./actions/extras');
const { LocalAIService, SUPPORTED_LANGUAGES } = require('./local-ai');

const HISTORY_LIMIT = 100;
const SUPPORTED_LANGUAGE_CODES = new Set(SUPPORTED_LANGUAGES.map(({ code }) => code));

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
    this.language = SUPPORTED_LANGUAGE_CODES.has(options.language) ? options.language : (SUPPORTED_LANGUAGE_CODES.has(process.env.NIKOUS_LANGUAGE) ? process.env.NIKOUS_LANGUAGE : 'fr-FR');
    this.root = path.resolve(options.root || process.env.NIKOUS_ROOT || defaultRoot(this.platform));
    this.dataDir = options.dataDir || path.resolve(__dirname, '..', 'data');
    this.forcedFullAccess = options.forcedFullAccess == null
      ? process.env.NIKOUS_FULL_ACCESS === '1'
      : Boolean(options.forcedFullAccess);
    this.fullAccess = this.forcedFullAccess || Boolean(options.fullAccess);
    this.emit = options.emit || (() => {});
    this.localAI = options.localAI || new LocalAIService(options.localAIOptions || {});
    this.activeTasks = 0;
    this.lastTask = null;
    this.wakeAgent = options.wakeAgent || null;
    this.wakeWordEnabled = false;
    this.agentConfirmation = null;
    this.confirmations = new safety.ConfirmationTokens({ ttl: 120_000, clock: options.clock });
    this.extras = new ExtraService({ dataDir: this.dataDir });
    this.contacts = new ContactsService({ dataDir: this.dataDir });
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
    await this.contacts.init();
    await this.automations.init();
    await this.loadSettings();
    if (this.wakeAgent && typeof this.wakeAgent.setLanguage === 'function') {
      try { await this.wakeAgent.setLanguage(this.language); } catch { /* la configuration vocale peut rester temporairement indisponible */ }
    }
    if (this.wakeWordEnabled && this.wakeAgent) {
      try { await this.wakeAgent.start(); }
      catch { this.wakeWordEnabled = false; await this.saveSettings(); }
    }
    this.ready = true;
    return this;
  }

  async loadSettings() {
    try {
      const value = JSON.parse(await fs.readFile(path.join(this.dataDir, 'settings.json'), 'utf8'));
      if (!this.forcedFullAccess && typeof value.fullAccess === 'boolean') this.fullAccess = value.fullAccess;
      if (typeof value.wakeWord === 'boolean') this.wakeWordEnabled = value.wakeWord;
      if (SUPPORTED_LANGUAGE_CODES.has(value.language)) this.language = value.language;
    } catch { /* les réglages peuvent ne pas exister au premier lancement */ }
  }

  async saveSettings() {
    await fs.mkdir(this.dataDir, { recursive: true });
    const file = path.join(this.dataDir, 'settings.json');
    const temporary = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify({ fullAccess: this.fullAccess, wakeWord: this.wakeWordEnabled, language: this.language }, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, file);
  }

  async setFullAccess(value) {
    if (this.forcedFullAccess) this.fullAccess = true;
    else this.fullAccess = Boolean(value);
    await this.saveSettings();
    return this.getSettings();
  }

  setWakeAgent(agent) {
    this.wakeAgent = agent || null;
    return this.wakeAgent;
  }

  async setWakeWordEnabled(value) {
    const enabled = Boolean(value);
    if (enabled) {
      if (!this.wakeAgent) throw new Error('L’agent vocal local n’est pas configuré sur cette installation.');
      const status = await this.wakeAgent.start();
      if (!status || !status.active) throw new Error(status && status.message ? status.message : 'Impossible de démarrer l’agent vocal local.');
      this.wakeWordEnabled = true;
    } else {
      this.wakeWordEnabled = false;
      if (this.wakeAgent) await this.wakeAgent.stop();
      this.agentConfirmation = null;
    }
    await this.saveSettings();
    return this.getSettings();
  }

  async setLanguage(language) {
    if (!SUPPORTED_LANGUAGE_CODES.has(language)) throw new Error('Cette langue n’est pas dans la liste des langues locales prises en charge.');
    this.language = language;
    let agentError = null;
    if (this.wakeAgent && typeof this.wakeAgent.setLanguage === 'function') {
      try { await this.wakeAgent.setLanguage(language); }
      catch (error) {
        agentError = error;
        this.wakeWordEnabled = false;
        if (typeof this.wakeAgent.stop === 'function') {
          try { await this.wakeAgent.stop(); } catch { /* l’agent reste désactivé même si son arrêt échoue */ }
        }
      }
    }
    await this.saveSettings();
    if (agentError) throw new Error(`La langue est enregistrée, mais la veille locale a été arrêtée car whisper.cpp n’a pas pu redémarrer : ${agentError.message}`);
    return this.getSettings();
  }

  getSettings() {
    return {
      fullAccess: this.fullAccess,
      forcedFullAccess: this.forcedFullAccess,
      root: this.root,
      mode: this.fullAccess ? 'accès complet' : 'mode sûr',
      wakeWord: this.wakeWordEnabled,
      language: this.language,
    };
  }

  async capabilities() {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    let localAI = null;
    try { localAI = await this.localAI.status(); }
    catch { localAI = { ready: false, local: true, message: 'IA locale indisponible.' }; }
    return {
      system: {
        platform: this.platform,
        name: os.type(),
        release: os.release(),
        cores: os.cpus().length,
        memoryUsedPercent: totalMemory ? Math.round(((totalMemory - freeMemory) / totalMemory) * 100) : null,
        uptimeSeconds: Math.floor(os.uptime()),
      },
      localAI,
      agent: this.wakeAgent ? this.wakeAgent.status() : { mode: 'push-to-talk', active: false, configured: false, local: true, message: 'Veille locale désactivée.' },
      activity: this.activeTasks ? { state: 'working', task: this.lastTask } : { state: 'idle', task: null },
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
    let parsed;
    if (!options.scheduled) {
      this.activeTasks += 1;
      this.emit({ type: 'activity', state: 'working', task: 'analyse locale' });
    }
    try {
      const language = SUPPORTED_LANGUAGE_CODES.has(options.language) ? options.language : this.language;
      if (language !== 'fr-FR' && !options.scheduled) {
        this.lastTask = 'IA multilingue locale';
        this.emit({ type: 'activity', state: 'working', task: this.lastTask });
        result = await this.executeInLanguage(message, language, options);
      } else {
        parsed = nlu.parse(message);
        this.lastTask = parsed.intent;
        if (!options.scheduled) this.emit({ type: 'activity', state: 'working', task: parsed.intent });
        if (parsed.intent === 'unknown' && !options.scheduled) result = await this.executeUnknown(message, options);
        else result = await this.executeParsed(parsed, options);
      }
    } catch (error) {
      result = { text: tone.oops(userFriendlyError(error)), ok: false };
    } finally {
      if (!options.scheduled) {
        this.activeTasks = Math.max(0, this.activeTasks - 1);
        if (!this.activeTasks) this.lastTask = null;
        this.emit({ type: 'activity', state: this.activeTasks ? 'working' : 'idle', task: this.lastTask });
      }
    }
    if (!options.scheduled) await this.record(message, result);
    return result;
  }

  async executeUnknown(message, options = {}) {
    try {
      const status = await this.localAI.status();
      if (status.ready) {
        this.lastTask = 'IA locale';
        this.emit({ type: 'activity', state: 'working', task: 'IA locale' });
        const routed = await this.localAI.route(message, this.historyItems, 'fr-FR');
        if (routed && routed.kind === 'action' && typeof routed.command === 'string') {
          const parsed = nlu.parse(routed.command);
          if (parsed.intent !== 'unknown') return await this.executeParsed(parsed, { ...options, localAI: true });
        }
        if (routed && routed.kind === 'reply' && typeof routed.reply === 'string') {
          return { text: routed.reply, source: 'ollama-local', ok: true };
        }
      }
    } catch { /* l’IA optionnelle ne doit jamais empêcher les actions NLU hors ligne */ }
    return this.executeParsed({ intent: 'unknown', original: String(message), slots: {} }, options);
  }

  async localizeResult(result, language) {
    if (!result || !result.text || !SUPPORTED_LANGUAGE_CODES.has(language) || language === 'fr-FR' || typeof this.localAI.translateReply !== 'function') return result;
    try { result.text = await this.localAI.translateReply(result.text, language) || result.text; }
    catch { /* conserver la réponse NLU si le traducteur local ne répond pas */ }
    return result;
  }

  async executeInLanguage(message, language, options = {}) {
    const unavailable = { text: 'Le modèle IA local n’est pas disponible. Démarre Ollama avec un modèle multilingue installé, ou sélectionne le français pour utiliser le NLU embarqué.', ok: false };
    try {
      const status = await this.localAI.status();
      if (!status.ready) return unavailable;
      const routed = await this.localAI.route(message, this.historyItems, language);
      if (routed && routed.kind === 'reply' && typeof routed.reply === 'string') {
        return { text: routed.reply, source: 'ollama-local', ok: true };
      }
      if (routed && routed.kind === 'action' && typeof routed.command === 'string') {
        const parsed = nlu.parse(routed.command);
        if (parsed.intent === 'unknown') return { text: 'Je n’ai pas réussi à convertir cette demande en action sûre. Reformule-la ou sélectionne le français.', ok: false };
        const result = await this.executeParsed(parsed, { ...options, localAI: true, language });
        return this.localizeResult(result, language);
      }
    } catch { /* aucun service distant n’est tenté en cas d’indisponibilité du modèle local */ }
    return unavailable;
  }

  async handleWakeWordInput(message, language = this.language) {
    const heard = String(message || '').trim();
    if (!heard) return { text: 'Je n’ai pas entendu de commande exploitable.', ok: false };
    let result;
    let confirmationResolved = false;
    if (this.agentConfirmation) {
      const answer = nlu.normalize(heard).replace(/[.!?]/g, '').trim();
      const accepted = /^(?:oui(?:\s+(?:je\s+)?confirme)?|yes(?:\s+(?:i\s+)?confirm|\s+please)?|yeah|yep|si(?:\s+confirmo)?|ja(?:\s+bestatigen)?|confirm|confirme|confirmer|okay|ok|はい|نعم(?:\s+اوافق)?|موافق|हाँ|ठीक है)$/u.test(answer);
      const rejected = /^(?:non|no|nope|cancel|annule|annuler|nein|いいえ|لا|नहीं)$/u.test(answer);
      if (accepted || rejected) {
        const pending = this.agentConfirmation;
        this.agentConfirmation = null;
        confirmationResolved = true;
        result = await this.confirm(pending.token, accepted, { language });
        await this.record(`Confirmation vocale: ${heard}`, result);
      } else {
        result = { text: 'Une action attend ta confirmation. Dis « Nikous, confirme » pour continuer ou « Nikous, annule » pour abandonner.', ok: false };
      }
    } else {
      result = await this.execute(heard, { language });
      if (result.confirmation && result.confirmation.token) this.agentConfirmation = result.confirmation;
    }
    this.emit({
      type: 'agent-message',
      message: heard,
      reply: result.text || '',
      blocks: result.blocks || [],
      confirmation: result.confirmation || null,
      confirmationResolved,
    });
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
          return { text: 'Je peux ouvrir et fermer des applications, changer de fenêtre, faire une capture, régler volume et luminosité, verrouiller l’écran, gérer tes fichiers, chercher sur le web, préparer un message WhatsApp, prendre des notes, programmer des rappels et répondre avec Ollama local si Gemma est installé. Les réponses libres et les commandes multilingues fonctionnent hors ligne avec le modèle local. Dis `aide` pour les exemples et les limites propres à ton système 😊' };
        case 'help':
          return {
            text: 'Avec plaisir — voilà tout ce que je sais faire 👇\n\n**Fichiers** · `liste les fichiers` · `lis notes.txt` · `crée fichier idées.txt avec …` · `cherche fichier contenant budget` · `supprime fichier ancien.txt`\n\n**Poste** · `état du système` · `liste des processus` · `quelle heure est-il` · `ouvre le dossier Documents` · `ouvre rapport.xlsx` · `ouvre Word` · `ferme Word` · `passe à Chrome` · `fais une capture d’écran` · `mets le volume à 50 %` · `mets la luminosité à 60 %` · `verrouille l’écran`\n\n**Web et messages** · `cherche sur le web météo Cotonou` · `ajoute contact Papa +229…` · `dis à Papa que je suis en retard` (confirmation, puis WhatsApp ouvre un brouillon à envoyer)\n\n**Quotidien** · `météo à Paris` · `calcule sqrt(81) + pi` · `note : appeler le médecin` · `mes notes` · `heure à Europe/Paris`\n\n**Automatisations** · `rappelle-moi dans 10 minutes de faire une pause` · `chaque lundi à 09:00 : état du système` · `toutes les 30 minutes : liste des processus` · `crée routine matin : état du système ; liste des processus`\n\nTu peux enchaîner jusqu’à six demandes, choisir une langue dans le menu, activer la veille « Nikous » (whisper.cpp local configuré) ou appuyer sur 🎙. Les actions restent soumises aux limites de sécurité ; fermer une application ou ouvrir un brouillon WhatsApp demande une confirmation. Qu’est-ce qu’on fait en premier ? 😊',
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
        case 'web.search':
          return system.searchWeb(slots.query, context);
        case 'system.lock':
          return desktop.executeDesktopAction('lock', null, context);
        case 'system.screenshot':
          return desktop.executeDesktopAction('screenshot', null, context);
        case 'system.volume':
          return desktop.executeDesktopAction('volume', slots.percent, context);
        case 'system.brightness':
          return desktop.executeDesktopAction('brightness', slots.percent, context);
        case 'system.focus':
          return desktop.executeDesktopAction('focus', slots.target, context);
        case 'system.close':
          return this.executeCloseApplication(slots.target);
        case 'contacts.add':
          return this.contacts.add(slots.name, slots.phone);
        case 'contacts.list': {
          const contacts = this.contacts.list();
          return {
            text: contacts.length ? `J’ai trouvé ${contacts.length} contact${contacts.length > 1 ? 's' : ''} dans ton carnet local :` : 'Ton carnet local est vide. Ajoute un contact avec « ajoute contact Papa +229… ».',
            blocks: contacts.length ? [{ type: 'table', headers: ['Contact', 'Téléphone'], rows: contacts.map((contact) => [contact.name, contact.phone]) }] : [],
          };
        }
        case 'messaging.whatsapp':
          return this.prepareWhatsAppMessage(slots.name, slots.message);
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

  prepareWhatsAppMessage(name, message) {
    const prepared = this.contacts.prepareWhatsApp(name, message);
    if (prepared.error) return { text: prepared.error, ok: false };
    const prompt = `Je vais ouvrir WhatsApp pour **${prepared.contact.name}** avec ce brouillon : « ${prepared.message} ». En confirmant, tu transmettras à WhatsApp le numéro du contact et le texte pour préparer la conversation. Le message ne sera pas envoyé : tu devras encore appuyer toi-même sur **Envoyer** dans WhatsApp. Continuer ?`;
    const confirmation = this.confirmations.create(async () => {
      await system.openTarget(prepared.url, this.context());
      return { text: `Le brouillon WhatsApp pour **${prepared.contact.name}** est ouvert. Il n’a pas été envoyé automatiquement : appuie sur **Envoyer** dans WhatsApp pour le transmettre.` };
    }, prompt, { kind: 'whatsapp-draft', contact: prepared.contact.name });
    return { text: prompt, confirmation, ok: true };
  }

  async executeCloseApplication(target) {
    if (!desktop.getApp(target)) return { text: 'Cette application n’est pas dans la liste autorisée pour une fermeture sécurisée.', ok: false };
    const prompt = `Fermer **${String(target).trim()}** peut faire perdre des modifications non enregistrées. Veux-tu continuer ?`;
    const confirmation = this.confirmations.create(() => desktop.closeApplication(target, this.platform), prompt, { kind: 'application-close' });
    return { text: prompt, confirmation, ok: true };
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

  async confirm(token, approved, options = {}) {
    const result = this.confirmations.take(token);
    const language = SUPPORTED_LANGUAGE_CODES.has(options.language) ? options.language : this.language;
    if (this.agentConfirmation && this.agentConfirmation.token === String(token)) this.agentConfirmation = null;
    if (!result.ok) return this.localizeResult({ text: result.reason, ok: false }, language);
    if (!approved) return this.localizeResult({ text: 'D’accord, j’annule. Aucune modification n’a été faite 🙂', ok: true }, language);
    try {
      const actionResult = await result.entry.action();
      const output = actionResult && actionResult.text ? actionResult : { text: tone.done() };
      if (result.entry.metadata.kind === 'command') {
        output.text = `Merci pour la confirmation. ${output.text}`;
      }
      return this.localizeResult(output, language);
    } catch (error) {
      return this.localizeResult({ text: tone.oops(userFriendlyError(error)), ok: false }, language);
    }
  }

  stop() {
    this.automations.stop();
    this.confirmations.clear();
    if (this.wakeAgent) void this.wakeAgent.stop();
    this.agentConfirmation = null;
  }
}

module.exports = { Executor, defaultRoot, userFriendlyError };
