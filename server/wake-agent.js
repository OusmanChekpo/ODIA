'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const ANSI_ESCAPE = /\x1b\[[0-?]*[ -/]*[@-~]/g;

function parseWhisperTranscriptLine(line) {
  const clean = String(line || '').replace(ANSI_ESCAPE, '').trim();
  const match = clean.match(/\[(?:\d{2}:)?\d{2}:\d{2}(?:\.\d+)?\s*-->\s*(?:\d{2}:)?\d{2}:\d{2}(?:\.\d+)?\]\s*(.+)$/);
  if (!match) return '';
  return match[1].replace(/\s+\[SPEAKER_TURN\]$/, '').trim();
}

function normalizeSpeechText(value) {
  return String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function findWakeCommand(transcript, wakeWord = 'Nikous') {
  const text = String(transcript || '').trim();
  const wake = normalizeSpeechText(wakeWord);
  if (!text || !wake) return null;
  const normalized = normalizeSpeechText(text);
  const escaped = wake.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const matcher = new RegExp(`(?:^|\\s)${escaped}(?=$|\\s|[,!:;?.])`, 'i');
  const match = matcher.exec(text.normalize('NFD').replace(/\p{M}/gu, ''));
  if (!match) return null;
  const wakeEnd = match.index + match[0].length;
  const command = text.slice(wakeEnd).replace(/^[\s,!:;?.-]+/, '').trim();
  return { command, normalized };
}

async function speakLocally(text, platform = process.platform, language = 'fr-FR') {
  const spoken = String(text || '').replace(/[*_`#]/g, '').slice(0, 1800);
  if (!spoken) return false;
  if (platform === 'win32') {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nikous-speech-'));
    const scriptPath = path.join(directory, 'speak.ps1');
    const script = `param([string]$Text, [string]$Language)\n$ErrorActionPreference = 'Stop'\nAdd-Type -AssemblyName System.Speech\n$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer\ntry { $voice = $speaker.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like ($Language.Split('-')[0] + '*') } | Select-Object -First 1; if (-not $voice) { exit 4 }; $speaker.SelectVoice($voice.VoiceInfo.Name); $speaker.Speak($Text) } finally { $speaker.Dispose() }`;
    try {
      await fs.writeFile(scriptPath, `${script}\n`, 'utf8');
      await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, spoken, language], { timeout: 60_000, windowsHide: true });
      return true;
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
  if (platform === 'darwin') {
    const { stdout } = await execFileAsync('say', ['-v', '?'], { timeout: 10_000, maxBuffer: 1024 * 1024 });
    const prefix = String(language).split('-')[0].toLowerCase();
    const voice = String(stdout).split(/\r?\n/).map((line) => {
      const match = line.match(/^(.+?)\s+([a-z]{2})_[A-Za-z]{2}(?:\s|$)/i);
      return match && match[2].toLowerCase() === prefix ? match[1].trim() : null;
    }).find(Boolean);
    if (!voice) return false;
    await execFileAsync('say', ['-v', voice, spoken], { timeout: 60_000, maxBuffer: 1024 * 1024 });
    return true;
  }
  for (const [executable, args] of [
    ['spd-say', ['--wait', spoken]],
    ['espeak-ng', ['-v', language, spoken]],
    ['espeak', ['-v', language, spoken]],
  ]) {
    try {
      await execFileAsync(executable, args, { timeout: 60_000, maxBuffer: 1024 * 1024 });
      return true;
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
    }
  }
  return false;
}

class WakeWordAgent {
  constructor(options = {}) {
    this.executable = options.executable || process.env.NIKOUS_WHISPER_STREAM || '';
    this.modelPath = options.modelPath || process.env.NIKOUS_WHISPER_MODEL || '';
    this.wakeWord = options.wakeWord || process.env.NIKOUS_WAKE_WORD || 'Nikous';
    this.language = options.language || process.env.NIKOUS_LANGUAGE || 'fr-FR';
    this.platform = options.platform || process.platform;
    this.spawnProcess = options.spawn || spawn;
    this.onCommand = options.onCommand || (async () => null);
    this.onStatus = options.onStatus || (() => {});
    this.speak = options.speak || speakLocally;
    this.child = null;
    this.buffer = '';
    this.awaitingCommandUntil = 0;
    this.processing = false;
    this.speakingUntil = 0;
    this.lastTranscript = '';
    this.lastTranscriptAt = 0;
    this.message = 'Installe whisper.cpp et configure le modèle multilingue pour activer la veille locale.';
  }

  status() {
    const configured = Boolean(this.executable && this.modelPath);
    return {
      mode: 'wake-word',
      engine: 'whisper.cpp',
      wakeWord: this.wakeWord,
      active: Boolean(this.child && !this.child.killed),
      configured,
      local: true,
      message: this.message,
    };
  }

  notify() { this.onStatus(this.status()); }

  async setLanguage(language) {
    const nextLanguage = String(language || 'fr-FR');
    if (nextLanguage === this.language) return this.status();
    const wasActive = Boolean(this.child && !this.child.killed);
    this.language = nextLanguage;
    if (wasActive) {
      await this.stop();
      return this.start();
    }
    return this.status();
  }

  async start() {
    if (this.child && !this.child.killed) return this.status();
    if (!this.executable || !this.modelPath) {
      this.message = 'Configure NIKOUS_WHISPER_STREAM et NIKOUS_WHISPER_MODEL après une installation locale de whisper.cpp.';
      this.notify();
      throw new Error(this.message);
    }
    const basename = path.basename(this.executable).toLowerCase();
    if (!['whisper-stream', 'whisper-stream.exe'].includes(basename)) {
      throw new Error('Le programme configuré doit être whisper-stream (whisper.cpp).');
    }
    const model = path.resolve(this.modelPath);
    const modelInfo = await fs.stat(model).catch(() => null);
    if (!modelInfo || !modelInfo.isFile() || modelInfo.size < 1024 * 1024) {
      throw new Error('Le fichier du modèle whisper.cpp est introuvable ou trop petit. Vérifie NIKOUS_WHISPER_MODEL.');
    }
    const executable = path.isAbsolute(this.executable) ? this.executable : this.executable;
    const threads = Math.max(1, Math.min(8, os.cpus().length || 2));
    const whisperLanguage = this.language.split('-')[0].toLowerCase();
    const args = ['-m', model, '-t', String(threads), '-l', whisperLanguage, '--step', '0', '--length', '5000'];
    const child = this.spawnProcess(executable, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, detached: false });
    this.child = child;
    this.buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this.consume(chunk));
    child.on('error', (error) => {
      this.message = `whisper.cpp n’a pas démarré : ${error.message}`;
      this.child = null;
      this.notify();
    });
    child.on('exit', (code, signal) => {
      if (this.child === child) this.child = null;
      this.message = code === 0 || signal === 'SIGTERM' ? 'Veille locale arrêtée.' : `whisper.cpp s’est arrêté (code ${code == null ? signal : code}).`;
      this.notify();
    });
    await new Promise((resolve, reject) => {
      const onSpawn = () => { cleanup(); resolve(); };
      const onError = (error) => { cleanup(); reject(error); };
      const cleanup = () => { child.removeListener('spawn', onSpawn); child.removeListener('error', onError); };
      child.once('spawn', onSpawn);
      child.once('error', onError);
    });
    this.message = `Mot d’activation « ${this.wakeWord} » actif ; audio traité localement.`;
    this.notify();
    return this.status();
  }

  async stop() {
    const child = this.child;
    this.child = null;
    this.awaitingCommandUntil = 0;
    if (child && child.exitCode == null && child.signalCode == null) {
      await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          child.removeListener('exit', finish);
          resolve();
        };
        const timer = setTimeout(finish, 2500);
        child.once('exit', finish);
        try { if (!child.killed) child.kill(); } catch { finish(); }
      });
    }
    this.message = 'Veille locale arrêtée.';
    this.notify();
    return this.status();
  }

  consume(chunk) {
    this.buffer += String(chunk || '');
    if (this.buffer.length > 64 * 1024) this.buffer = this.buffer.slice(-16 * 1024);
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || '';
    for (const line of lines) {
      const transcript = parseWhisperTranscriptLine(line);
      if (transcript) this.handleTranscript(transcript).catch((error) => {
        this.message = `Erreur de commande vocale locale : ${error.message}`;
        this.notify();
      });
    }
  }

  async handleTranscript(transcript) {
    const now = Date.now();
    const normalized = normalizeSpeechText(transcript);
    if (!normalized || now < this.speakingUntil) return;
    if (normalized === this.lastTranscript && now - this.lastTranscriptAt < 5000) return;
    this.lastTranscript = normalized;
    this.lastTranscriptAt = now;
    const activation = findWakeCommand(transcript, this.wakeWord);
    if (activation) {
      if (activation.command) return this.runCommand(activation.command);
      this.awaitingCommandUntil = now + 12_000;
      this.message = 'Mot d’activation reconnu ; j’attends ta demande.';
      this.notify();
      return;
    }
    if (now <= this.awaitingCommandUntil) {
      this.awaitingCommandUntil = 0;
      return this.runCommand(transcript);
    }
  }

  async runCommand(transcript) {
    const command = String(transcript || '').trim();
    if (!command || this.processing) return;
    this.processing = true;
    this.awaitingCommandUntil = 0;
    this.message = 'Commande reçue ; traitement local en cours.';
    this.notify();
    try {
      const result = await this.onCommand(command, this.language);
      const responseText = result && result.text ? result.text : 'Je n’ai pas pu traiter cette commande.';
      this.message = 'Réponse vocale locale.';
      this.notify();
      this.speakingUntil = Date.now() + Math.min(60_000, Math.max(2500, responseText.length * 90));
      await this.speak(responseText, this.platform, this.language).catch(() => false);
    } finally {
      this.processing = false;
      this.message = 'En veille locale ; dis « ' + this.wakeWord + ' » pour m’appeler.';
      this.notify();
    }
  }
}

module.exports = { WakeWordAgent, parseWhisperTranscriptLine, findWakeCommand, normalizeSpeechText, speakLocally };
