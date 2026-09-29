'use strict';

const DEFAULT_MODEL = process.env.NIKOUS_OLLAMA_MODEL || 'gemma3:4b';
const DEFAULT_URL = process.env.NIKOUS_OLLAMA_URL || 'http://127.0.0.1:11434';
const STATUS_TTL_MS = 10_000;
const SUPPORTED_LANGUAGES = [
  { code: 'fr-FR', name: 'Français' }, { code: 'en-US', name: 'English' },
  { code: 'es-ES', name: 'Español' }, { code: 'hi-IN', name: 'हिन्दी' },
  { code: 'ar-SA', name: 'العربية' }, { code: 'ja-JP', name: '日本語' },
  { code: 'de-DE', name: 'Deutsch' }, { code: 'zh-CN', name: '中文' },
  { code: 'pt-BR', name: 'Português' }, { code: 'it-IT', name: 'Italiano' },
  { code: 'ko-KR', name: '한국어' }, { code: 'nl-NL', name: 'Nederlands' },
  { code: 'tr-TR', name: 'Türkçe' }, { code: 'ru-RU', name: 'Русский' },
  { code: 'bn-BD', name: 'বাংলা' }, { code: 'ur-PK', name: 'اردو' },
  { code: 'sw-KE', name: 'Kiswahili' }, { code: 'id-ID', name: 'Bahasa Indonesia' },
  { code: 'th-TH', name: 'ไทย' }, { code: 'vi-VN', name: 'Tiếng Việt' },
  { code: 'he-IL', name: 'עברית' }, { code: 'pl-PL', name: 'Polski' },
];
const LANGUAGE_NAMES = new Map(SUPPORTED_LANGUAGES.map(({ code, name }) => [code, name]));

function normalizeLocalUrl(value = DEFAULT_URL) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Ollama doit être accessible sur une URL HTTP locale.');
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('Pour protéger la confidentialité, NIKOUS n’accepte qu’un serveur Ollama sur cette machine (loopback).');
  if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) throw new Error('L’adresse Ollama ne doit contenir ni identifiants ni chemin supplémentaire.');
  return url.origin;
}

function cleanModelName(value = DEFAULT_MODEL) {
  const model = String(value || '').trim();
  if (!model || model.length > 100 || !/^[a-z0-9][a-z0-9._:/-]*$/i.test(model)) {
    throw new Error('Nom de modèle Ollama invalide.');
  }
  return model;
}

function safeText(value, maxLength = 4000) {
  return String(value == null ? '' : value).slice(0, maxLength);
}

class LocalAIService {
  constructor(options = {}) {
    this.baseUrl = normalizeLocalUrl(options.baseUrl || DEFAULT_URL);
    this.model = cleanModelName(options.model || DEFAULT_MODEL);
    this.fetch = options.fetch || globalThis.fetch;
    this.timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 90_000;
    this.statusCache = null;
    this.statusExpiresAt = 0;
  }

  async request(path, payload) {
    if (typeof this.fetch !== 'function') throw new Error('Node.js doit fournir fetch pour contacter Ollama localement.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(`${this.baseUrl}${path}`, {
        method: payload ? 'POST' : 'GET',
        headers: payload ? { 'Content-Type': 'application/json' } : undefined,
        body: payload ? JSON.stringify(payload) : undefined,
        signal: controller.signal,
        cache: 'no-store',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(safeText(data.error || `Ollama a répondu HTTP ${response.status}.`, 300));
        error.statusCode = response.status;
        throw error;
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  async status(options = {}) {
    if (!options.refresh && this.statusCache && Date.now() < this.statusExpiresAt) return { ...this.statusCache };
    let state;
    try {
      const data = await this.request('/api/tags');
      const models = Array.isArray(data.models) ? data.models.map((model) => String(model.name || model.model || '')) : [];
      const installed = models.some((name) => name === this.model);
      state = {
        provider: 'Ollama local',
        model: this.model,
        local: true,
        serverAvailable: true,
        modelInstalled: installed,
        ready: installed,
        models: models.slice(0, 20),
        message: installed ? 'Modèle local prêt' : `Modèle absent : exécute « ollama pull ${this.model} » une fois.`,
      };
    } catch (error) {
      state = {
        provider: 'Ollama local',
        model: this.model,
        local: true,
        serverAvailable: false,
        modelInstalled: false,
        ready: false,
        models: [],
        message: error.name === 'AbortError' ? 'Ollama ne répond pas dans le délai prévu.' : 'Ollama local indisponible ; le NLU embarqué reste actif.',
      };
    }
    this.statusCache = state;
    this.statusExpiresAt = Date.now() + STATUS_TTL_MS;
    return { ...state };
  }

  async route(message, history = [], language = 'fr-FR') {
    const languageName = LANGUAGE_NAMES.get(language) || 'la langue du message';
    const systemPrompt = [
      `Tu es NIKOUS, un assistant local et privé. Tu réponds en ${languageName}, sauf que toute commande d’action doit être normalisée en français.`,
      'Le serveur Ollama est sur la même machine. N’invente pas de faits personnels ni de résultats système.',
      'Tu dois choisir exactement une forme JSON : {"kind":"reply","reply":"réponse naturelle"} ou {"kind":"action","command":"commande française canonique"}.',
      'Une action n’est permise que si la demande veut clairement effectuer une capacité prise en charge : fichiers (lire, lister, créer, renommer, chercher, supprimer un fichier), ouvrir dossier/document/application ou URL, état/processus/heure, verrouiller l’écran, capture d’écran, volume/luminosité, fermer une application autorisée, changer de fenêtre, calcul, notes, météo, fuseau, rappels/routines, recherche web, contacts locaux et brouillon WhatsApp après confirmation.',
      'Pour une action, écris uniquement une formulation que le NLU français peut comprendre, par exemple « ouvre le dossier Documents », « ouvre le document rapport.xlsx », « mets le volume à 50 % », « ferme Word », « passe à Chrome », « fais une capture d’écran », « ajoute contact Papa +229… », « dis à Papa que je suis en retard », « note : appeler papa », « cherche sur le web météo Cotonou ». Pour les contacts WhatsApp, conserve à l’identique le nom, le numéro et le texte voulu ; ne prétends jamais que le message est envoyé, car le serveur ouvrira uniquement un brouillon. Ne fournis jamais directement un script ou du code à exécuter.',
      'Ne prétends jamais qu’une action est faite avant que NIKOUS ne l’ait exécutée. N’accorde jamais une confirmation à la place de la personne. Les commandes et chemins seront soumis aux garde-fous locaux.',
      'Si la demande est une question, une discussion, ou une capacité non prise en charge, réponds dans le champ reply avec honnêteté et brièvement ; ne transforme pas une simple question en action.',
    ].join(' ');
    const messages = [{ role: 'system', content: systemPrompt }];
    for (const item of history.slice(0, 6).reverse()) {
      const user = safeText(item.message, 1500);
      const assistant = safeText(item.reply, 1500);
      if (user) messages.push({ role: 'user', content: user });
      if (assistant) messages.push({ role: 'assistant', content: assistant });
    }
    messages.push({ role: 'user', content: safeText(message, 4000) });
    const data = await this.request('/api/chat', {
      model: this.model,
      messages,
      format: 'json',
      stream: false,
      keep_alive: '5m',
      options: { temperature: 0.25 },
    });
    const content = data && data.message && typeof data.message.content === 'string' ? data.message.content : '';
    let parsed;
    try { parsed = JSON.parse(content); } catch { return null; }
    if (parsed.kind === 'action' && typeof parsed.command === 'string') {
      const command = safeText(parsed.command.trim(), 4000);
      return command ? { kind: 'action', command } : null;
    }
    if (parsed.kind === 'reply' && typeof parsed.reply === 'string') {
      const reply = safeText(parsed.reply.trim(), 6000);
      return reply ? { kind: 'reply', reply } : null;
    }
    return null;
  }

  async translateReply(text, language = 'fr-FR') {
    const languageName = LANGUAGE_NAMES.get(language);
    if (!languageName || language === 'fr-FR') return null;
    const data = await this.request('/api/chat', {
      model: this.model,
      messages: [
        { role: 'system', content: `Traduis fidèlement le texte suivant en ${languageName}. Ne réponds pas à son contenu, n’ajoute aucun fait, conserve les noms, chemins, nombres et le format Markdown. Retourne uniquement la traduction.` },
        { role: 'user', content: safeText(text, 6000) },
      ],
      stream: false,
      keep_alive: '5m',
      options: { temperature: 0.1 },
    });
    const result = data && data.message && typeof data.message.content === 'string' ? data.message.content.trim() : '';
    return result ? safeText(result, 6000) : null;
  }
}

module.exports = { LocalAIService, normalizeLocalUrl, cleanModelName, DEFAULT_MODEL, DEFAULT_URL, SUPPORTED_LANGUAGES };
