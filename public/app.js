'use strict';

(() => {
  const $ = (selector) => document.querySelector(selector);
  const messages = $('#messages');
  const input = $('#message-input');
  const sendButton = $('#send-button');
  const typing = $('#typing-indicator');
  const voiceHint = $('#voice-hint');
  const toastStack = $('#toast-stack');
  const state = { busy: false, settings: null, eventSource: null, recognition: null };

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
    scrollToBottom();
    if (role !== 'user' && text && !options.noSpeech && localStorageGet('nikous-voice') === 'true') speak(text);
    return row;
  }

  function createConfirmationCard(confirmation) {
    const card = document.createElement('div');
    card.className = 'confirm-card';
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
      try {
        const result = await postJson('/api/confirm', { token: confirmation.token, approved });
        appendMessage('assistant', result.text || 'C’est fait.', result.blocks || [], { confirmation: result.confirmation });
      } catch (error) {
        appendMessage('assistant', error.message || 'Je n’ai pas pu traiter cette confirmation.', [], { });
      }
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

  async function sendMessage(value = input.value) {
    const message = String(value || '').trim();
    if (!message || state.busy) return;
    appendMessage('user', message);
    input.value = '';
    resizeInput();
    setBusy(true);
    try {
      const result = await postJson('/api/chat', { message });
      appendMessage('assistant', result.text || 'C’est fait.', result.blocks || [], { confirmation: result.confirmation });
    } catch (error) {
      appendMessage('assistant', `Oups, je n’arrive pas à joindre NIKOUS. Vérifie que le serveur local est bien démarré, puis réessaie. (${error.message || 'connexion impossible'})`);
    } finally {
      setBusy(false);
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
      renderSettings();
      $('#connection-label').textContent = 'SYSTÈME EN LIGNE';
      $('#root-path').textContent = state.settings.root;
    } catch {
      $('#connection-label').textContent = 'SERVEUR HORS LIGNE';
      $('#root-path').textContent = 'non disponible';
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

  function speak(text) {
    if (!('speechSynthesis' in window) || !localStorageGet('nikous-voice')) return;
    window.speechSynthesis.cancel();
    const spoken = String(text).replace(/```[\s\S]*?```/g, ' bloc de code ').replace(/[*_`#]/g, '').replace(/https?:\/\/\S+/g, 'un lien web');
    const utterance = new SpeechSynthesisUtterance(spoken.slice(0, 1600));
    utterance.lang = 'fr-FR';
    const frenchVoice = window.speechSynthesis.getVoices().find((voice) => voice.lang.toLowerCase().startsWith('fr'));
    if (frenchVoice) utterance.voice = frenchVoice;
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
  }

  function toggleSpeech() {
    const enabled = localStorageGet('nikous-voice') !== 'true';
    localStorageSet('nikous-voice', String(enabled));
    $('#speech-toggle').setAttribute('aria-pressed', String(enabled));
    if (!enabled && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    showToast(enabled ? 'Réponses vocales activées' : 'Réponses vocales désactivées', enabled ? 'NIKOUS lira ses réponses avec la voix française disponible dans ton navigateur.' : 'Les réponses restent affichées à l’écran.', false);
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

  function voiceErrorMessage(error, insideFrame) {
    const errorName = error && error.name;
    if (insideFrame) return 'La reconnaissance vocale peut être bloquée dans l’aperçu intégré. Ouvre NIKOUS dans un nouvel onglet, puis autorise le microphone. Chrome et Edge sont recommandés.';
    if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError' || errorName === 'SecurityError') return 'L’accès au microphone est refusé. Dans Chrome ou Edge, clique sur le cadenas près de l’adresse, autorise le microphone pour cette page, puis réessaie.';
    if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') return 'Je ne détecte pas de microphone. Branche ou active un micro, puis réessaie.';
    if (errorName === 'NotReadableError') return 'Le microphone semble déjà utilisé par une autre application. Ferme-la et réessaie.';
    return 'La reconnaissance vocale n’est pas disponible. Vérifie les autorisations du navigateur et essaie avec Chrome ou Edge.';
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

  async function startVoiceInput() {
    voiceHint.hidden = true;
    const insideFrame = (() => { try { return window.self !== window.top; } catch { return true; } })();
    if (!window.isSecureContext && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
      showVoiceHint('Le micro nécessite une page sécurisée. Ouvre NIKOUS sur localhost, ou utilise Chrome / Edge avec HTTPS.', insideFrame);
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showVoiceHint('Ce navigateur ne donne pas accès au microphone. Essaie avec Chrome ou Edge.', insideFrame);
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    } catch (error) {
      showVoiceHint(voiceErrorMessage(error, insideFrame), insideFrame);
      return;
    }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      showVoiceHint('Le micro est autorisé, mais la reconnaissance vocale n’est pas prise en charge ici. Chrome ou Edge offrent la meilleure compatibilité.', insideFrame);
      return;
    }
    if (state.recognition) state.recognition.abort();
    const recognition = new Recognition();
    state.recognition = recognition;
    recognition.lang = 'fr-FR';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => $('#voice-button').classList.add('is-listening');
    recognition.onend = () => $('#voice-button').classList.remove('is-listening');
    recognition.onerror = (event) => showVoiceHint(voiceErrorMessage({ name: event.error === 'not-allowed' ? 'NotAllowedError' : event.error }, insideFrame), insideFrame);
    recognition.onresult = (event) => {
      const transcript = event.results && event.results[0] && event.results[0][0] && event.results[0][0].transcript;
      if (transcript) { input.value = transcript; resizeInput(); input.focus(); }
    };
    try { recognition.start(); }
    catch (error) { showVoiceHint(voiceErrorMessage(error, insideFrame), insideFrame); }
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
    const savedTheme = localStorageGet('nikous-theme');
    applyTheme(savedTheme === 'light' ? 'light' : 'dark');
    $('#today-label').textContent = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()).toLocaleUpperCase('fr-FR');
    $('#speech-toggle').setAttribute('aria-pressed', String(localStorageGet('nikous-voice') === 'true'));
    $('#theme-toggle').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
    $('#mode-toggle').addEventListener('click', toggleAccessMode);
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
    $('#voice-button').addEventListener('click', startVoiceInput);
    loadSettings();
    loadHistoryOrWelcome();
    connectEvents();
  }

  init();
})();
