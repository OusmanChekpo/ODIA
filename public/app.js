'use strict';

(() => {
  const $ = (selector) => document.querySelector(selector);
  const messages = $('#messages');
  const input = $('#message-input');
  const sendButton = $('#send-button');
  const typing = $('#typing-indicator');
  const voiceHint = $('#voice-hint');
  const toastStack = $('#toast-stack');
  const LANGUAGES = [
    ['fr-FR', 'Français'], ['en-US', 'English'], ['es-ES', 'Español'], ['hi-IN', 'हिन्दी'],
    ['ar-SA', 'العربية'], ['ja-JP', '日本語'], ['de-DE', 'Deutsch'], ['zh-CN', '中文'],
    ['pt-BR', 'Português'], ['it-IT', 'Italiano'], ['ko-KR', '한국어'], ['nl-NL', 'Nederlands'],
    ['tr-TR', 'Türkçe'], ['ru-RU', 'Русский'], ['bn-BD', 'বাংলা'], ['ur-PK', 'اردو'],
    ['sw-KE', 'Kiswahili'], ['id-ID', 'Bahasa Indonesia'], ['th-TH', 'ไทย'], ['vi-VN', 'Tiếng Việt'],
    ['he-IL', 'עברית'], ['pl-PL', 'Polski'],
  ];
  const state = {
    busy: false,
    settings: null,
    eventSource: null,
    recognition: null,
    recognitionConstructor: null,
    voiceConversation: false,
    voiceStarting: false,
    voiceSpeaking: false,
    voiceRestartTimer: null,
    pendingConfirmation: null,
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function inlineMarkdown(value) {
    return escapeHtml(value)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  }

  function markdownLite(source) {
    const lines = String(source || '').split(/\r?\n/);
    let html = '';
    let paragraphOpen = false;
    let listOpen = false;
    let codeOpen = false;
    let codeLines = [];
    const closeParagraph = () => { if (paragraphOpen) { html += '</p>'; paragraphOpen = false; } };
    const closeList = () => { if (listOpen) { html += '</ul>'; listOpen = false; } };
    for (const line of lines) {
      if (/^\s*```/.test(line)) {
        closeParagraph(); closeList();
        if (codeOpen) {
          html += `<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`;
          codeLines = [];
          codeOpen = false;
        } else codeOpen = true;
        continue;
      }
      if (codeOpen) { codeLines.push(line); continue; }
      if (!line.trim()) { closeParagraph(); closeList(); continue; }
      const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
      if (bullet) {
        closeParagraph();
        if (!listOpen) { html += '<ul>'; listOpen = true; }
        html += `<li>${inlineMarkdown(bullet[1])}</li>`;
        continue;
      }
      closeList();
      if (!paragraphOpen) { html += '<p>'; paragraphOpen = true; }
      else html += '<br>';
      html += inlineMarkdown(line);
    }
    if (codeOpen) html += `<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`;
    closeParagraph(); closeList();
    return html;
  }

  function renderBlocks(blocks) {
    if (!Array.isArray(blocks)) return '';
    return blocks.map((block) => {
      if (!block || typeof block !== 'object') return '';
      if (block.type === 'kv') {
        const items = (block.items || []).map((item) => `<div class="kv-item"><span>${escapeHtml(item.label)}</span><span>${escapeHtml(item.value)}</span></div>`).join('');
        return `<div class="structured-block kv-block">${items}</div>`;
      }
      if (block.type === 'code') return `<div class="structured-block"><pre><code>${escapeHtml(block.value || '')}</code></pre></div>`;
      if (block.type === 'files') {
        if (!block.items || !block.items.length) return '';
        const items = block.items.map((item) => {
          const kind = item.kind === 'dossier' ? '▰' : '▤';
          const label = escapeHtml(item.name || item.path || 'Élément');
          const pathValue = escapeHtml(item.path || item.name || '');
          const size = item.size ? `<small>${escapeHtml(item.size)}</small>` : '';
          return `<button class="file-chip" type="button" data-file="${pathValue}" data-kind="${escapeHtml(item.kind || 'fichier')}"><span class="file-type">${kind}</span><span>${label}</span>${size}</button>`;
        }).join('');
        return `<div class="structured-block file-list">${items}</div>`;
      }
      if (block.type === 'table') {
        const headers = (block.headers || []).map((header) => `<th>${escapeHtml(header)}</th>`).join('');
        const rows = (block.rows || []).map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('');
        return `<div class="structured-block data-table-wrap"><table class="data-table"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
      }
      if (block.type === 'notes') {
        const items = (block.items || []).map((note) => `<div class="note-item"><strong>#${escapeHtml(note.id)}</strong><p>${escapeHtml(note.text)}</p><small>${escapeHtml(formatTime(note.at))}</small></div>`).join('');
        return `<div class="structured-block note-list">${items}</div>`;
      }
      if (block.type === 'routines') {
        const items = (block.items || []).map((routine) => `<div class="routine-item"><strong>${escapeHtml(routine.name)}</strong><span>${routine.actions.map(escapeHtml).join(' · ')}</span></div>`).join('');
        return `<div class="structured-block routine-list">${items}</div>`;
      }
      if (block.type === 'chips') {
        const items = (block.items || []).map((item) => `<button class="routine-chip" type="button" data-prompt="${escapeHtml(item.prompt || item)}">${escapeHtml(item.label || item)}</button>`).join('');
        return `<div class="structured-block file-list">${items}</div>`;
      }
      return '';
    }).join('');
  }

  function formatTime(value = Date.now()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(date);
  }

  function orbMarkup() {
    return '<span class="orb" aria-hidden="true"><span class="orb-core"></span></span><span class="fallback" aria-hidden="true">N</span>';
  }

  function appendMessage(role, text, blocks = [], options = {}) {
    const row = document.createElement('article');
    row.className = `message-row ${role === 'user' ? 'user-row' : 'assistant-row'}`;
    row.setAttribute('aria-label', role === 'user' ? 'Ton message' : 'Réponse de NIKOUS');
    const content = document.createElement('div');
    content.className = 'message-content';
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    const sender = document.createElement('strong');
    sender.textContent = role === 'user' ? 'TOI' : 'NIKOUS';
    const timestamp = document.createElement('time');
    timestamp.textContent = formatTime(options.at || Date.now());
    meta.append(sender, timestamp);
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    if (role === 'user') bubble.innerHTML = escapeHtml(text).replace(/\r?\n/g, '<br>');
    else bubble.innerHTML = `${markdownLite(text)}${renderBlocks(blocks)}`;
    content.append(meta, bubble);
    if (options.confirmation) content.append(createConfirmationCard(options.confirmation));
    if (role !== 'user') {
      const avatar = document.createElement('div');
      avatar.className = 'assistant-avatar';
      avatar.innerHTML = orbMarkup();
      row.append(avatar, content);
    } else row.append(content);
    messages.insertBefore(row, typing);
    if (role !== 'user' && options.confirmation) state.pendingConfirmation = options.confirmation;
    scrollToBottom();
    if (role !== 'user' && text && !options.noSpeech && localStorageGet('nikous-voice') === 'true') speak(text);
    return row;
  }

  function confirmationChoice(message) {
    const normalized = String(message || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[.,!?]/g, ' ').replace(/\s+/g, ' ').trim();
    const accepted = new Set(['oui', 'oui confirme', 'oui je confirme', 'je confirme', 'confirme', 'confirmer', 'yes', 'yes confirm', 'yes i confirm', 'yes please', 'i confirm', 'confirm', 'confirm send', 'si', 'si confirmo', 'confirmo', 'ja', 'ja bestatigen', 'bestatigen', 'はい', 'そうです', 'نعم', 'نعم اوافق', 'موافق', 'हाँ', 'ठीक है']);
    const rejected = new Set(['non', 'non annule', 'annule', 'annuler', 'no', 'no cancel', 'cancel', 'nein', 'いいえ', 'キャンセル', 'لا', 'الغاء', 'नहीं', 'रद्द करें']);
    if (accepted.has(normalized)) return true;
    if (rejected.has(normalized)) return false;
    return null;
  }

  async function resolveConfirmation(approved, confirmation = state.pendingConfirmation) {
    if (!confirmation || !confirmation.token) return;
    if (state.pendingConfirmation && state.pendingConfirmation.token === confirmation.token) state.pendingConfirmation = null;
    const card = Array.from(messages.querySelectorAll('.confirm-card')).find((item) => item.dataset.confirmationToken === confirmation.token);
    if (card) card.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    setBusy(true);
    let responseText = '';
    try {
      const result = await postJson('/api/confirm', { token: confirmation.token, approved, language: getSelectedLanguage() });
      responseText = result.text || 'C’est fait.';
      appendMessage('assistant', responseText, result.blocks || [], { confirmation: result.confirmation, noSpeech: state.voiceConversation });
    } catch (error) {
      responseText = error.message || 'Je n’ai pas pu traiter cette confirmation.';
      appendMessage('assistant', responseText, [], { noSpeech: state.voiceConversation });
    } finally {
      setBusy(false);
    }
    if (state.voiceConversation) {
      state.voiceSpeaking = true;
      $('#voice-button').classList.add('is-speaking');
      showVoiceHint(`Je te réponds avec une voix locale ${getLanguageName()}…`);
      const spoke = await speak(responseText, { force: true });
      state.voiceSpeaking = false;
      $('#voice-button').classList.remove('is-speaking');
      if (state.voiceConversation && !spoke) {
        stopVoiceConversation(false);
        showVoiceHint('La réponse n’a pas pu être lue par la voix locale. Vérifie la voix installée ; aucune voix en ligne ne sera utilisée.');
      } else if (state.voiceConversation) scheduleRecognition(350);
    } else input.focus();
  }

  function createConfirmationCard(confirmation) {
    const card = document.createElement('div');
    card.className = 'confirm-card';
    card.dataset.confirmationToken = confirmation.token;
    const prompt = document.createElement('p');
    prompt.textContent = 'Tu peux confirmer si tu veux continuer, ou annuler sans rien changer.';
    const actions = document.createElement('div');
    actions.className = 'confirm-actions';
    const yes = document.createElement('button');
    yes.className = 'confirm-yes';
    yes.type = 'button';
    yes.textContent = 'Confirmer';
    const no = document.createElement('button');
    no.className = 'confirm-no';
    no.type = 'button';
    no.textContent = 'Annuler';
    const finish = async (approved) => {
      yes.disabled = true; no.disabled = true;
      await resolveConfirmation(approved, confirmation);
    };
    yes.addEventListener('click', () => finish(true));
    no.addEventListener('click', () => finish(false));
    actions.append(yes, no);
    card.append(prompt, actions);
    return card;
  }

  function scrollToBottom() {
    requestAnimationFrame(() => { messages.scrollTop = messages.scrollHeight; });
  }

  function setBusy(value) {
    state.busy = value;
    sendButton.disabled = value;
    input.disabled = value;
    typing.hidden = !value;
    if (value) scrollToBottom();
  }

  async function postJson(url, payload) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'La requête n’a pas abouti.');
    return result;
  }

  async function sendMessage(value = input.value, options = {}) {
    const message = String(value || '').trim();
    if (!message || state.busy) return;
    if (state.recognition) {
      const currentRecognition = state.recognition;
      state.recognition = null;
      try { currentRecognition.abort(); } catch { /* écoute déjà terminée */ }
    }
    const choice = state.pendingConfirmation ? confirmationChoice(message) : null;
    if (choice !== null) {
      appendMessage('user', message);
      input.value = '';
      resizeInput();
      if (options.fromVoice && state.voiceConversation) showVoiceHint('Confirmation vocale comprise. Je traite ta réponse localement…');
      await resolveConfirmation(choice);
      return;
    }
    appendMessage('user', message);
    input.value = '';
    resizeInput();
    setBusy(true);
    if (options.fromVoice && state.voiceConversation) showVoiceHint('Demande reconnue sur cet appareil. Je prépare ma réponse localement…');
    let responseText = '';
    try {
      const result = await postJson('/api/chat', { message, language: getSelectedLanguage() });
      responseText = result.text || 'C’est fait.';
      appendMessage('assistant', responseText, result.blocks || [], {
        confirmation: result.confirmation,
        noSpeech: state.voiceConversation,
      });
    } catch (error) {
      responseText = `Oups, je n’arrive pas à joindre NIKOUS. Vérifie que le serveur local est bien démarré, puis réessaie. (${error.message || 'connexion impossible'})`;
      appendMessage('assistant', responseText, [], { noSpeech: state.voiceConversation });
    } finally {
      setBusy(false);
    }

    if (state.voiceConversation) {
      state.voiceSpeaking = true;
      $('#voice-button').classList.add('is-speaking');
      showVoiceHint(`Je te réponds avec une voix locale ${getLanguageName()}…`);
      const spoke = await speak(responseText, { force: true });
      state.voiceSpeaking = false;
      $('#voice-button').classList.remove('is-speaking');
      if (state.voiceConversation && !spoke) {
        stopVoiceConversation(false);
        showVoiceHint('La réponse n’a pas pu être lue par la voix locale. Vérifie que la synthèse vocale française de l’appareil est disponible ; aucune voix en ligne ne sera utilisée.');
      } else if (state.voiceConversation) scheduleRecognition(350);
    } else if (!options.fromVoice) {
      input.focus();
    }
  }

  function resizeInput() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  }

  function localStorageGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  function localStorageSet(key, value) {
    try { localStorage.setItem(key, value); } catch { /* stockage local indisponible */ }
  }

  function getSelectedLanguage() {
    const saved = localStorageGet('nikous-language');
    return LANGUAGES.some(([code]) => code === saved) ? saved : 'fr-FR';
  }

  function getLanguageName(code = getSelectedLanguage()) {
    return (LANGUAGES.find(([languageCode]) => languageCode === code) || LANGUAGES[0])[1];
  }

  function initializeLanguageSelect() {
    const select = $('#language-select');
    for (const [code, name] of LANGUAGES) {
      const option = document.createElement('option');
      option.value = code;
      option.textContent = name;
      select.append(option);
    }
    select.value = getSelectedLanguage();
    select.addEventListener('change', () => {
      const language = LANGUAGES.some(([code]) => code === select.value) ? select.value : 'fr-FR';
      localStorageSet('nikous-language', language);
      if (state.voiceConversation) stopVoiceConversation(false);
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      const wakeWasActive = Boolean(state.settings && state.settings.wakeWord);
      postJson('/api/settings', { language }).then((settings) => {
        state.settings = settings;
        renderSettings();
        if (wakeWasActive && !settings.wakeWord) showToast('Veille locale arrêtée', 'Whisper.cpp n’a pas pu redémarrer avec cette langue. Vérifie le modèle et réactive la veille.', true);
      }).catch((error) => {
        showToast('Langue mise à jour avec une limite', error.message || 'Vérifie l’état de la veille locale.', true);
        loadSettings();
      });
      showToast('Langue mise à jour', `${getLanguageName(language)} sélectionné. Redémarre la conversation vocale pour charger son modèle local.`, false);
    });
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorageSet('nikous-theme', theme);
    const light = theme === 'light';
    $('#theme-toggle').textContent = light ? '🌙' : '☀️';
    $('#theme-toggle').setAttribute('aria-label', light ? 'Passer au thème sombre' : 'Passer au thème clair');
    document.querySelector('meta[name="theme-color"]').content = light ? '#edf3f6' : '#050a12';
  }

  async function loadSettings() {
    try {
      const response = await fetch('/api/settings', { cache: 'no-store' });
      if (!response.ok) throw new Error('Réglages indisponibles');
      state.settings = await response.json();
      if (!localStorageGet('nikous-language') && state.settings.language) localStorageSet('nikous-language', state.settings.language);
      $('#language-select').value = getSelectedLanguage();
      if (state.settings.language !== getSelectedLanguage()) {
        try { state.settings = await postJson('/api/settings', { language: getSelectedLanguage() }); } catch { /* préférence du navigateur conservée localement */ }
      }
      renderSettings();
      $('#connection-label').textContent = 'SYSTÈME EN LIGNE';
      $('#root-path').textContent = state.settings.root;
      refreshCapabilities();
    } catch {
      $('#connection-label').textContent = 'SERVEUR HORS LIGNE';
      $('#root-path').textContent = 'non disponible';
      refreshCapabilities();
    }
  }

  function renderSettings() {
    if (!state.settings) return;
    const button = $('#mode-toggle');
    const full = Boolean(state.settings.fullAccess);
    button.classList.toggle('is-full', full);
    button.setAttribute('aria-pressed', String(full));
    $('#mode-label').textContent = full ? 'ACCÈS COMPLET' : 'MODE SÛR';
    button.title = state.settings.forcedFullAccess
      ? 'L’accès complet est forcé par NIKOUS_FULL_ACCESS=1'
      : (full ? 'Désactiver l’accès complet' : 'Activer l’accès complet');
    button.disabled = Boolean(state.settings.forcedFullAccess);
    const agentButton = $('#agent-toggle');
    const agentActive = Boolean(state.settings.wakeWord);
    agentButton.classList.toggle('is-active', agentActive);
    agentButton.setAttribute('aria-pressed', String(agentActive));
    agentButton.title = agentActive ? 'Arrêter la veille vocale locale' : 'Activer la veille locale avec le mot Nikous';
    agentButton.textContent = agentActive ? '◉ ÉCOUTE' : '◉ VEILLE';
  }

  function setStatusChip(id, label, stateName, title = '') {
    const element = $(`#${id}`);
    if (!element) return;
    element.textContent = label;
    element.dataset.state = stateName || '';
    const chip = element.closest('.status-chip');
    if (chip) chip.dataset.state = stateName || '';
    if (title) element.title = title;
  }

  async function refreshCapabilities() {
    try {
      const response = await fetch('/api/capabilities', { cache: 'no-store' });
      if (!response.ok) throw new Error('Statut indisponible');
      const data = await response.json();
      const ai = data.localAI || {};
      setStatusChip('ai-status', ai.ready ? `${ai.model} · LOCAL` : (ai.serverAvailable ? 'MODÈLE À INSTALLER' : 'NLU LOCAL · IA ABSENTE'), ai.ready ? 'ready' : 'warning', ai.message || '');
      const machine = data.system || {};
      const memory = Number.isFinite(machine.memoryUsedPercent) ? `RAM ${machine.memoryUsedPercent}%` : 'RAM —';
      setStatusChip('system-status', `${machine.name || machine.platform || 'Poste'} · ${machine.cores || '?'} cœurs · ${memory}`, 'ready', machine.release || '');
      const agent = data.agent || {};
      setStatusChip('agent-status', agent.active ? 'ÉCOUTE LOCALE' : 'VEILLE INACTIVE', agent.active ? 'ready' : '', agent.message || '');
      if (data.activity) setStatusChip('activity-status', data.activity.state === 'working' ? (data.activity.task || 'En cours') : 'En attente', data.activity.state === 'working' ? 'working' : '');
    } catch {
      setStatusChip('ai-status', 'STATUT INDISPONIBLE', 'warning');
      setStatusChip('system-status', 'Serveur hors ligne', 'warning');
      setStatusChip('agent-status', 'VEILLE INACTIVE', '');
    }
  }

  async function toggleAccessMode() {
    if (!state.settings || state.settings.forcedFullAccess) return;
    const enabling = !state.settings.fullAccess;
    if (enabling && !window.confirm('L’accès complet autorise NIKOUS à dépasser la racine de fichiers et à lancer les commandes non bloquées après confirmation. Les commandes destructrices globales restent bloquées. Continuer ?')) return;
    try {
      state.settings = await postJson('/api/settings', { fullAccess: enabling });
      renderSettings();
      showToast(enabling ? 'Accès complet activé' : 'Mode sûr activé', enabling ? 'Les chemins sont moins restreints ; les commandes globalement destructrices restent bloquées.' : 'Les commandes hors liste blanche demanderont une confirmation.', !enabling);
    } catch (error) {
      showToast('Réglage non modifié', error.message, true);
    }
  }

  async function toggleWakeWord() {
    if (!state.settings) return;
    const enabling = !state.settings.wakeWord;
    if (enabling && !window.confirm('Activer l’écoute permanente du microphone pour le mot « Nikous » ? L’audio sera traité localement par whisper.cpp, sans envoi réseau. Le micro restera actif tant que l’agent tourne ; tu peux arrêter la veille à tout moment.')) return;
    if (enabling && state.voiceConversation) stopVoiceConversation(false);
    const button = $('#agent-toggle');
    button.disabled = true;
    try {
      state.settings = await postJson('/api/settings', { wakeWord: enabling });
      renderSettings();
      await refreshCapabilities();
      showToast(enabling ? 'Veille locale activée' : 'Veille locale arrêtée', enabling ? 'Le mot d’activation et la reconnaissance restent sur cette machine.' : 'Le microphone n’est plus surveillé par l’agent.', false);
    } catch (error) {
      showToast('Veille non modifiée', error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  function getLocalVoice(language = getSelectedLanguage()) {
    if (!('speechSynthesis' in window)) return null;
    const prefix = language.toLowerCase().split('-')[0];
    return window.speechSynthesis.getVoices().find((voice) => voice.localService === true && voice.lang && voice.lang.toLowerCase().startsWith(prefix)) || null;
  }

  function waitForLocalVoice(language = getSelectedLanguage(), timeoutMs = 1200) {
    const current = getLocalVoice(language);
    if (current) return Promise.resolve(current);
    if (!('speechSynthesis' in window) || typeof window.speechSynthesis.addEventListener !== 'function') return Promise.resolve(null);
    return new Promise((resolve) => {
      let finished = false;
      const complete = () => {
        if (finished) return;
        finished = true;
        window.speechSynthesis.removeEventListener('voiceschanged', check);
        clearTimeout(timer);
        resolve(getLocalVoice(language));
      };
      const check = () => { if (getLocalVoice(language)) complete(); };
      const timer = setTimeout(complete, timeoutMs);
      window.speechSynthesis.addEventListener('voiceschanged', check);
    });
  }

  function speak(text, options = {}) {
    if (!('speechSynthesis' in window) || (!options.force && localStorageGet('nikous-voice') !== 'true')) return Promise.resolve(false);
    const language = getSelectedLanguage();
    const localVoice = getLocalVoice(language);
    if (!localVoice) {
      showVoiceHint(`Aucune voix ${getLanguageName(language)} installée localement n’est disponible. Installe une voix correspondante dans les paramètres de parole du système ; NIKOUS n’utilisera pas de voix en ligne.`, false);
      return Promise.resolve(false);
    }
    window.speechSynthesis.cancel();
    const spoken = String(text).replace(/```[\s\S]*?```/g, ' bloc de code ').replace(/[*_`#]/g, '').replace(/https?:\/\/\S+/g, 'un lien web');
    const utterance = new SpeechSynthesisUtterance(spoken.slice(0, 1600));
    utterance.lang = language;
    utterance.voice = localVoice;
    utterance.rate = 1;
    return new Promise((resolve) => {
      let finished = false;
      const finish = (success) => {
        if (finished) return;
        finished = true;
        clearTimeout(fallback);
        resolve(success);
      };
      utterance.onend = () => finish(true);
      utterance.onerror = () => finish(false);
      const fallback = setTimeout(() => finish(false), Math.max(10_000, spoken.length * 95));
      try { window.speechSynthesis.speak(utterance); } catch { finish(false); }
    });
  }

  async function toggleSpeech() {
    const language = getSelectedLanguage();
    const enabled = localStorageGet('nikous-voice') !== 'true';
    if (enabled && !(await waitForLocalVoice(language))) {
      showVoiceHint(`Aucune voix ${getLanguageName(language)} locale n’est disponible. Installe une voix correspondante ; les voix en ligne ne seront pas utilisées.`, false);
      return;
    }
    localStorageSet('nikous-voice', String(enabled));
    $('#speech-toggle').setAttribute('aria-pressed', String(enabled));
    if (!enabled && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    showToast(enabled ? 'Voix locale activée' : 'Voix locale désactivée', enabled ? `Les réponses seront lues avec une voix ${getLanguageName(language)} installée sur cet appareil.` : 'Les réponses restent affichées à l’écran.', false);
  }

  function showToast(title, message, warning = false) {
    const toast = document.createElement('div');
    toast.className = `toast${warning ? ' toast-warning' : ''}`;
    const heading = document.createElement('strong');
    heading.textContent = title || 'NIKOUS';
    const body = document.createElement('p');
    body.textContent = message || '';
    toast.append(heading, body);
    toastStack.append(toast);
    setTimeout(() => toast.remove(), 6500);
  }

  function connectEvents() {
    if (!('EventSource' in window)) return;
    state.eventSource = new EventSource('/api/events');
    state.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'activity') {
          setStatusChip('activity-status', data.state === 'working' ? (data.task || 'En cours') : 'En attente', data.state === 'working' ? 'working' : '');
          return;
        }
        if (data.type === 'agent-status') {
          const agent = data.agent || {};
          setStatusChip('agent-status', agent.active ? 'ÉCOUTE LOCALE' : 'VEILLE INACTIVE', agent.active ? 'ready' : '', agent.message || '');
          return;
        }
        if (data.type === 'agent-message') {
          if (data.confirmationResolved && state.pendingConfirmation) {
            const token = state.pendingConfirmation.token;
            state.pendingConfirmation = null;
            const card = Array.from(messages.querySelectorAll('.confirm-card')).find((item) => item.dataset.confirmationToken === token);
            if (card) card.querySelectorAll('button').forEach((button) => { button.disabled = true; });
          }
          if (data.message) appendMessage('user', data.message);
          appendMessage('assistant', data.reply || 'Commande traitée.', data.blocks || [], { confirmation: data.confirmation || undefined, noSpeech: true });
          return;
        }
        if (data.type === 'toast') {
          showToast(data.title || 'Tâche terminée', data.message || 'Une automatisation vient de se déclencher.', data.succeeded === false);
          if (data.confirmation) {
            appendMessage('assistant', 'Une tâche planifiée demande une confirmation avant de continuer.', [], { confirmation: data.confirmation });
          }
        }
      } catch { /* ignorer un événement SSE mal formé */ }
    };
    state.eventSource.onerror = () => { $('#connection-label').textContent = 'RECONNEXION…'; };
    state.eventSource.onopen = () => { $('#connection-label').textContent = 'SYSTÈME EN LIGNE'; };
  }

  function prefillFile(event) {
    const button = event.target.closest('[data-file]');
    if (!button) return;
    const filePath = button.dataset.file || '';
    const kind = button.dataset.kind;
    const quoted = `"${filePath.replace(/"/g, '')}"`;
    input.value = kind === 'dossier' ? `liste les fichiers de ${quoted}` : `lis ${quoted}`;
    input.focus();
    resizeInput();
  }

  function handlePromptClick(event) {
    const button = event.target.closest('[data-prompt]');
    if (!button) return;
    const prompt = button.dataset.prompt || '';
    input.value = prompt;
    input.focus();
    resizeInput();
    if (prompt.trim() && !/\s$/.test(prompt)) sendMessage(prompt);
  }

  function isInsideFrame() {
    try { return window.self !== window.top; } catch { return true; }
  }

  function voiceErrorMessage(error, insideFrame) {
    const errorName = error && error.name;
    if (error && error.message && errorName === 'LocalSpeechError') return error.message;
    if (insideFrame && (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError' || errorName === 'SecurityError')) return 'L’aperçu intégré bloque peut-être le microphone. Ouvre NIKOUS dans un nouvel onglet, puis autorise le micro dans Chrome ou Edge.';
    if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError' || errorName === 'SecurityError') return 'L’accès au microphone est refusé. Dans Chrome ou Edge, clique sur le cadenas près de l’adresse, autorise le microphone pour cette page, puis réessaie.';
    if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') return 'Je ne détecte pas de microphone. Branche ou active un micro, puis réessaie.';
    if (errorName === 'NotReadableError') return 'Le microphone semble déjà utilisé par une autre application. Ferme-la et réessaie.';
    if (errorName === 'language-not-supported' || errorName === 'LanguageNotSupportedError') return `Le modèle vocal local ${getSelectedLanguage()} n’est pas installé. Installe le pack de cette langue ; NIKOUS ne basculera pas vers une reconnaissance en ligne.`;
    return error && error.message ? error.message : 'La conversation vocale locale n’est pas disponible. Essaie avec une version récente de Chrome et un pack vocal français installé.';
  }

  function showVoiceHint(message, includeOpenButton = false) {
    voiceHint.replaceChildren();
    const text = document.createElement('span');
    text.textContent = message;
    voiceHint.append(text);
    if (includeOpenButton) {
      const open = document.createElement('button');
      open.type = 'button';
      open.textContent = '↗ Ouvrir dans un nouvel onglet';
      open.addEventListener('click', () => window.open(window.location.href, '_blank', 'noopener,noreferrer'));
      voiceHint.append(open);
    }
    voiceHint.hidden = false;
  }

  function updateVoiceButton() {
    const button = $('#voice-button');
    button.textContent = state.voiceConversation ? '⏹' : '🎙';
    button.classList.toggle('is-conversation', state.voiceConversation);
    button.setAttribute('aria-pressed', String(state.voiceConversation));
    button.setAttribute('aria-label', state.voiceConversation ? 'Arrêter la conversation vocale locale' : 'Démarrer la conversation vocale locale');
    button.title = state.voiceConversation ? 'Arrêter la conversation audio locale' : 'Parler à NIKOUS en audio, sans service cloud';
  }

  function stopVoiceConversation(showNotice = true) {
    state.voiceConversation = false;
    state.voiceStarting = false;
    state.voiceSpeaking = false;
    if (state.voiceRestartTimer) clearTimeout(state.voiceRestartTimer);
    state.voiceRestartTimer = null;
    const recognition = state.recognition;
    state.recognition = null;
    if (recognition) { try { recognition.abort(); } catch { /* déjà arrêté */ } }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    $('#voice-button').classList.remove('is-listening', 'is-speaking');
    updateVoiceButton();
    voiceHint.hidden = true;
    if (showNotice) showToast('Conversation vocale arrêtée', 'Le microphone n’est plus écouté par NIKOUS.', false);
  }

  function scheduleRecognition(delay = 400) {
    if (state.voiceRestartTimer) clearTimeout(state.voiceRestartTimer);
    state.voiceRestartTimer = setTimeout(() => {
      state.voiceRestartTimer = null;
      startLocalRecognition();
    }, delay);
  }

  function startLocalRecognition() {
    if (!state.voiceConversation || state.busy || state.voiceSpeaking || state.voiceStarting || !state.recognitionConstructor) return;
    const recognition = new state.recognitionConstructor();
    state.recognition = recognition;
    recognition.lang = getSelectedLanguage();
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;
    let receivedSpeech = false;
    recognition.onstart = () => {
      if (!state.voiceConversation) return;
      $('#voice-button').classList.add('is-listening');
      showVoiceHint('Je t’écoute en français. La reconnaissance et la réponse restent sur cet appareil ; parle naturellement, puis je te répondrai à voix haute.');
    };
    recognition.onresult = (event) => {
      const result = event.results && event.results[0];
      const transcript = result && result[0] && result[0].transcript;
      if (transcript && transcript.trim()) {
        receivedSpeech = true;
        sendMessage(transcript, { fromVoice: true });
      }
    };
    recognition.onerror = (event) => {
      if (event.error === 'aborted') return;
      if (event.error === 'no-speech') {
        showVoiceHint('Je n’ai rien entendu cette fois. Je reste à l’écoute — tu peux parler quand tu veux.');
        return;
      }
      const localError = event.error === 'language-not-supported' ? new Error(voiceErrorMessage({ name: event.error }, false)) : new Error(`Le moteur de reconnaissance locale a signalé une erreur (${event.error}). Aucune transcription en ligne ne sera utilisée.`);
      if (event.error === 'language-not-supported') localError.name = 'LocalSpeechError';
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') localError.name = 'NotAllowedError';
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed' || event.error === 'language-not-supported') {
        stopVoiceConversation(false);
        const insideFrame = isInsideFrame();
        showVoiceHint(voiceErrorMessage(localError, insideFrame), insideFrame && localError.name === 'NotAllowedError');
      } else {
        stopVoiceConversation(false);
        showVoiceHint(localError.message);
      }
    };
    recognition.onend = () => {
      if (state.recognition === recognition) state.recognition = null;
      $('#voice-button').classList.remove('is-listening');
      if (state.voiceConversation && !state.busy && !state.voiceSpeaking) scheduleRecognition(receivedSpeech ? 350 : 650);
    };
    try {
      recognition.processLocally = true;
      if (recognition.processLocally !== true) throw new Error('Le navigateur ne garantit pas le traitement local ; la reconnaissance est arrêtée sans connexion au cloud.');
      recognition.start();
    } catch (error) {
      if (state.recognition === recognition) state.recognition = null;
      const wrapped = new Error(error.message || 'Impossible de démarrer le moteur vocal local.');
      wrapped.name = error.name || 'LocalSpeechError';
      stopVoiceConversation(false);
      const insideFrame = isInsideFrame();
      showVoiceHint(voiceErrorMessage(wrapped, insideFrame), insideFrame && ['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(wrapped.name));
    }
  }

  async function installLocalLanguagePack(Recognition, language) {
    if (typeof Recognition.available !== 'function' || typeof Recognition.install !== 'function') {
      const error = new Error('Ce navigateur ne propose pas la reconnaissance locale à la demande. Utilise une version récente de Chrome ; NIKOUS n’enverra jamais ta voix à un service cloud.');
      error.name = 'LocalSpeechError';
      throw error;
    }
    const options = { langs: [language], processLocally: true };
    let availability;
    try { availability = await Recognition.available(options); }
    catch {
      const error = new Error(`Le navigateur ne permet pas de vérifier le pack local ${language}. Mets Chrome à jour et réessaie.`);
      error.name = 'LocalSpeechError';
      throw error;
    }
    if (availability === 'available') return true;
    if (availability !== 'downloadable' && availability !== 'downloading') {
      const error = new Error(`Le navigateur ne dispose pas d’un modèle ${language} utilisable hors ligne. Aucun moteur distant ne sera appelé.`);
      error.name = 'LocalSpeechError';
      throw error;
    }
    const accepted = window.confirm(`Pour utiliser la voix en local, le navigateur doit installer une fois le pack ${getLanguageName(language)} (${language}) sur cet appareil. Le micro ne sera pas envoyé à un service de transcription. Télécharger ce pack ?`);
    if (!accepted) return false;
    showVoiceHint(`Installation du modèle vocal ${getLanguageName(language)} local… Le navigateur télécharge le pack une seule fois.`);
    let installed = false;
    try { installed = await Recognition.install(options); } catch { installed = false; }
    if (!installed) {
      const error = new Error(`Le pack ${language} n’a pas pu être installé. Vérifie la connexion ; aucune reconnaissance en ligne ne sera utilisée.`);
      error.name = 'LocalSpeechError';
      throw error;
    }
    if (await Recognition.available(options) !== 'available') {
      const error = new Error(`Le pack ${language} n’est pas encore prêt. Réessaie dans un instant.`);
      error.name = 'LocalSpeechError';
      throw error;
    }
    return true;
  }

  async function startVoiceConversation() {
    if (state.voiceConversation) { stopVoiceConversation(); return; }
    if (state.voiceStarting) return;
    state.voiceStarting = true;
    const button = $('#voice-button');
    button.disabled = true;
    voiceHint.hidden = true;
    const insideFrame = isInsideFrame();
    try {
      if (state.settings && state.settings.wakeWord) {
        const error = new Error('La veille avec le mot d’activation utilise déjà le microphone. Arrête-la avant de démarrer une autre session audio.');
        error.name = 'LocalSpeechError';
        throw error;
      }
      if (!window.isSecureContext && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
        const error = new Error('Le microphone exige une page sécurisée (HTTPS ou localhost).');
        error.name = 'LocalSpeechError';
        throw error;
      }
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Recognition) {
        const error = new Error('Ce navigateur ne prend pas en charge la reconnaissance vocale locale. Essaie avec une version récente de Chrome ; NIKOUS ne basculera pas vers un service en ligne.');
        error.name = 'LocalSpeechError';
        throw error;
      }
      const probe = new Recognition();
      if (!('processLocally' in probe)) {
        const error = new Error('La version du navigateur ne sait pas garantir une reconnaissance locale. Mets Chrome à jour ; NIKOUS refusera d’envoyer l’audio au cloud.');
        error.name = 'LocalSpeechError';
        throw error;
      }
      const language = getSelectedLanguage();
      if (!('speechSynthesis' in window) || !(await waitForLocalVoice(language))) {
        const error = new Error(`Aucune voix locale ${getLanguageName(language)} n’est installée pour lire les réponses. Installe une voix correspondante dans les paramètres de parole du système, puis réessaie.`);
        error.name = 'LocalSpeechError';
        throw error;
      }
      const packReady = await installLocalLanguagePack(Recognition, language);
      if (!packReady) {
        showVoiceHint(`D’accord, le pack ${language} n’a pas été installé. La conversation audio reste arrêtée et aucune voix ne sera envoyée en ligne.`);
        return;
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        const error = new Error('Le navigateur ne donne pas accès au microphone. Essaie avec Chrome à jour.');
        error.name = 'LocalSpeechError';
        throw error;
      }
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      } catch (error) {
        throw error;
      }
      state.recognitionConstructor = Recognition;
      state.voiceConversation = true;
      updateVoiceButton();
      showToast('Conversation vocale locale activée', 'Parle naturellement : ta voix sera reconnue sur cet appareil et NIKOUS te répondra à voix haute.', false);
      showVoiceHint('Conversation vocale locale prête. Parle quand tu veux ; touche ⏹ pour arrêter.');
      scheduleRecognition(150);
    } catch (error) {
      showVoiceHint(voiceErrorMessage(error, insideFrame), insideFrame && (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError' || error.name === 'SecurityError'));
    } finally {
      state.voiceStarting = false;
      button.disabled = false;
      updateVoiceButton();
    }
  }

  async function loadHistoryOrWelcome() {
    try {
      const response = await fetch('/api/history', { cache: 'no-store' });
      if (!response.ok) throw new Error('historique indisponible');
      const data = await response.json();
      const items = Array.isArray(data.items) ? data.items.slice(0, 25).reverse() : [];
      if (items.length) {
        for (const item of items) {
          appendMessage('user', item.message, [], { at: item.at });
          appendMessage('assistant', item.reply, [], { at: item.at, noSpeech: true });
        }
      } else {
        appendMessage('assistant', 'Salut ! **NIKOUS** est en ligne ⚡ … Tape `aide`, ou dis-moi directement ce dont tu as besoin 😊');
      }
    } catch {
      appendMessage('assistant', 'Salut ! **NIKOUS** est en ligne ⚡ … Tape `aide`, ou dis-moi directement ce dont tu as besoin 😊');
    }
  }

  function init() {
    window.addEventListener('beforeunload', (event) => {
      if (state.settings && state.settings.wakeWord) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
    const savedTheme = localStorageGet('nikous-theme');
    applyTheme(savedTheme === 'light' ? 'light' : 'dark');
    $('#today-label').textContent = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()).toLocaleUpperCase('fr-FR');
    $('#speech-toggle').setAttribute('aria-pressed', String(localStorageGet('nikous-voice') === 'true'));
    initializeLanguageSelect();
    $('#theme-toggle').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
    $('#mode-toggle').addEventListener('click', toggleAccessMode);
    $('#agent-toggle').addEventListener('click', toggleWakeWord);
    $('#speech-toggle').addEventListener('click', toggleSpeech);
    sendButton.addEventListener('click', () => sendMessage());
    input.addEventListener('input', resizeInput);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); }
    });
    document.body.addEventListener('click', (event) => {
      if (event.target.closest('[data-prompt]')) { handlePromptClick(event); return; }
      prefillFile(event);
    });
    $('#voice-button').addEventListener('click', startVoiceConversation);
    loadSettings();
    loadHistoryOrWelcome();
    connectEvents();
    setInterval(refreshCapabilities, 15_000);
  }

  init();
})();
