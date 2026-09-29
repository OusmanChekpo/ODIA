'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { resolveSafePath } = require('../safety');

const execFileAsync = promisify(execFile);
const APPLICATIONS = new Map([
  ['word', { winProcess: 'WINWORD', winTitle: 'Word', mac: 'Microsoft Word', linux: 'libreoffice', linuxTitle: 'LibreOffice' }],
  ['excel', { winProcess: 'EXCEL', winTitle: 'Excel', mac: 'Microsoft Excel', linux: 'libreoffice', linuxTitle: 'LibreOffice' }],
  ['powerpoint', { winProcess: 'POWERPNT', winTitle: 'PowerPoint', mac: 'Microsoft PowerPoint', linux: 'libreoffice', linuxTitle: 'LibreOffice' }],
  ['bloc-notes', { winProcess: 'notepad', winTitle: 'Notepad', mac: 'TextEdit', linux: 'gedit', linuxTitle: 'gedit' }],
  ['notepad', { winProcess: 'notepad', winTitle: 'Notepad', mac: 'TextEdit', linux: 'gedit', linuxTitle: 'gedit' }],
  ['calculatrice', { winProcess: 'Calculator', winTitle: 'Calculator', mac: 'Calculator', linux: 'gnome-calculator', linuxTitle: 'Calculator' }],
  ['calculator', { winProcess: 'Calculator', winTitle: 'Calculator', mac: 'Calculator', linux: 'gnome-calculator', linuxTitle: 'Calculator' }],
  ['chrome', { winProcess: 'chrome', winTitle: 'Chrome', mac: 'Google Chrome', linux: 'google-chrome', linuxTitle: 'Google Chrome' }],
  ['edge', { winProcess: 'msedge', winTitle: 'Microsoft Edge', mac: 'Microsoft Edge', linux: 'microsoft-edge', linuxTitle: 'Microsoft Edge' }],
  ['firefox', { winProcess: 'firefox', winTitle: 'Firefox', mac: 'Firefox', linux: 'firefox', linuxTitle: 'Firefox' }],
]);

const WINDOWS_AUDIO_SOURCE = String.raw`
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float level, Guid context);
  int j(); int GetMasterVolumeLevelScalar(out float level);
  int k(); int l(); int m(); int n();
  [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, Guid context);
  [PreserveSig] int GetMute(out bool mute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid id, int clsCtx, IntPtr activationParams, out IAudioEndpointVolume endpoint); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice endpoint); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }
public static class NikousAudio {
  public static void SetVolume(float value) {
    var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
    IMMDevice device;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out device));
    IAudioEndpointVolume endpoint;
    var id = typeof(IAudioEndpointVolume).GUID;
    Marshal.ThrowExceptionForHR(device.Activate(ref id, 23, IntPtr.Zero, out endpoint));
    Marshal.ThrowExceptionForHR(endpoint.SetMasterVolumeLevelScalar(value, Guid.Empty));
  }
}`;

function normalizeName(value) {
  return String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, '-');
}

function toPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) throw new Error('Le niveau doit être un nombre entre 0 et 100.');
  return Math.round(number);
}

function getApp(target) {
  const name = normalizeName(target);
  const aliases = new Map([
    ['microsoft-word', 'word'], ['microsoft-excel', 'excel'], ['microsoft-powerpoint', 'powerpoint'],
    ['textedit', 'notepad'], ['bloc-notes', 'notepad'], ['google-chrome', 'chrome'], ['microsoft-edge', 'edge'],
  ]);
  return APPLICATIONS.get(aliases.get(name) || name) || null;
}

async function run(executable, args, options = {}) {
  try {
    return await execFileAsync(executable, args, { timeout: 15_000, maxBuffer: 1024 * 1024, windowsHide: true, ...options });
  } catch (error) {
    if (error && error.code === 'ENOENT') throw new Error(`La fonction nécessite l’outil local « ${executable} », qui n’est pas installé.`);
    if (error && error.killed) throw new Error('L’opération système a dépassé son délai.');
    throw error;
  }
}

async function runPowerShell(script, args = []) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nikous-ps-'));
  const scriptPath = path.join(directory, 'action.ps1');
  try {
    await fs.writeFile(scriptPath, `${script.trim()}\n`, { encoding: 'utf8', mode: 0o600 });
    return await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args]);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function firstAvailable(candidates) {
  let lastError;
  for (const [executable, args] of candidates) {
    try { return await run(executable, args); }
    catch (error) {
      lastError = error;
      if (!String(error.message).includes('n’est pas installé')) throw error;
    }
  }
  throw lastError || new Error('Aucun outil compatible n’est installé sur ce système.');
}

async function lockScreen(platform = process.platform) {
  if (platform === 'win32') {
    await run('rundll32.exe', ['user32.dll,LockWorkStation']);
  } else if (platform === 'darwin') {
    await firstAvailable([
      ['/System/Library/CoreServices/Menu Extras/User.menu/Contents/Resources/CGSession', ['-suspend']],
      ['/System/Library/CoreServices/ScreenSaverEngine.app/Contents/MacOS/ScreenSaverEngine', []],
    ]);
  } else {
    await firstAvailable([['loginctl', ['lock-session']], ['xdg-screensaver', ['lock']]]);
  }
  return { text: 'Je verrouille ta session maintenant. 🔒' };
}

async function setVolume(value, platform = process.platform) {
  const percent = toPercent(value);
  if (platform === 'win32') {
    const script = `param([int]$Percent)\n$ErrorActionPreference = 'Stop'\nAdd-Type -TypeDefinition @'\n${WINDOWS_AUDIO_SOURCE}\n'@\n[NikousAudio]::SetVolume([single]($Percent / 100.0))`;
    await runPowerShell(script, [String(percent)]);
  } else if (platform === 'darwin') {
    await run('osascript', ['-e', `set volume output volume ${percent}`]);
  } else {
    await firstAvailable([
      ['pactl', ['set-sink-volume', '@DEFAULT_SINK@', `${percent}%`]],
      ['amixer', ['sset', 'Master', `${percent}%`]],
      ['wpctl', ['set-volume', '@DEFAULT_AUDIO_SINK@', `${percent / 100}`]],
    ]);
  }
  return { text: `Le volume système est réglé à **${percent} %**. 🔊` };
}

async function setBrightness(value, platform = process.platform) {
  const percent = toPercent(value);
  if (platform === 'win32') {
    const script = `param([int]$Percent)\n$ErrorActionPreference = 'Stop'\n$panel = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods | Select-Object -First 1\nif (-not $panel) { throw 'Aucun écran interne compatible n’a été trouvé.' }\n$null = Invoke-CimMethod -InputObject $panel -MethodName WmiSetBrightness -Arguments @{ Timeout = 1; Brightness = $Percent }`;
    await runPowerShell(script, [String(percent)]);
  } else if (platform === 'darwin') {
    await run('brightness', [String(percent / 100)]);
  } else {
    await firstAvailable([
      ['brightnessctl', ['set', `${percent}%`]],
      ['xbacklight', ['-set', String(percent)]],
    ]);
  }
  return { text: `La luminosité système est réglée à **${percent} %**. ☀️` };
}

async function createScreenshotPath(context = {}) {
  const root = path.resolve(context.root || os.homedir());
  const directory = await resolveSafePath('Captures', { root, fullAccess: context.fullAccess });
  await fs.mkdir(directory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return resolveSafePath(path.join('Captures', `nikous-${stamp}.png`), { root, fullAccess: context.fullAccess });
}

async function screenshot(context = {}) {
  const platform = context.platform || process.platform;
  const output = await createScreenshotPath(context);
  if (platform === 'win32') {
    const script = `param([string]$OutputPath)\n$ErrorActionPreference = 'Stop'\nAdd-Type -AssemblyName System.Windows.Forms\nAdd-Type -AssemblyName System.Drawing\n$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen\n$bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)\n$graphics = [System.Drawing.Graphics]::FromImage($bitmap)\ntry { $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size); $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png) } finally { $graphics.Dispose(); $bitmap.Dispose() }`;
    await runPowerShell(script, [output]);
  } else if (platform === 'darwin') {
    await run('/usr/sbin/screencapture', ['-x', output]);
  } else {
    await firstAvailable([
      ['gnome-screenshot', ['-f', output]],
      ['grim', [output]],
      ['scrot', [output]],
    ]);
  }
  const display = path.relative(context.root || os.homedir(), output).split(path.sep).join('/');
  return { text: `Capture d’écran enregistrée localement : **${display}**. 📸`, blocks: [{ type: 'code', value: output }] };
}

async function closeApplication(target, platform = process.platform) {
  const app = getApp(target);
  if (!app) throw new Error('Cette application n’est pas dans la liste autorisée pour la fermeture.');
  if (platform === 'win32') {
    const script = `param([string]$ProcessName)\n$ErrorActionPreference = 'Stop'\n$processes = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue\nif (-not $processes) { throw 'Application non ouverte.' }\n$closed = $false\nforeach ($process in $processes) { if ($process.CloseMainWindow()) { $closed = $true } }\nif (-not $closed) { throw 'Aucune fenêtre ne peut être fermée proprement.' }`;
    await runPowerShell(script, [app.winProcess]);
  } else if (platform === 'darwin') {
    await run('osascript', ['-e', `tell application "${app.mac}" to quit`]);
  } else {
    await run('wmctrl', ['-c', app.linuxTitle]);
  }
  return { text: `Demande de fermeture envoyée à **${String(target).trim()}**. L’application pourra demander d’enregistrer les modifications. 🪟` };
}

async function focusApplication(target, platform = process.platform) {
  const app = getApp(target);
  if (!app) throw new Error('Cette application n’est pas dans la liste autorisée pour le changement de fenêtre.');
  if (platform === 'win32') {
    const script = `param([string]$Title)\n$ErrorActionPreference = 'Stop'\n$shell = New-Object -ComObject WScript.Shell\nif (-not $shell.AppActivate($Title)) { throw 'Fenêtre non trouvée.' }`;
    await runPowerShell(script, [app.winTitle]);
  } else if (platform === 'darwin') {
    await run('open', ['-a', app.mac]);
  } else {
    await run('wmctrl', ['-a', app.linuxTitle]);
  }
  return { text: `Je passe à la fenêtre **${String(target).trim()}**. 🪟` };
}

async function executeDesktopAction(action, value, context = {}) {
  const platform = context.platform || process.platform;
  if (action === 'lock') return lockScreen(platform);
  if (action === 'volume') return setVolume(value, platform);
  if (action === 'brightness') return setBrightness(value, platform);
  if (action === 'screenshot') return screenshot(context);
  if (action === 'close') return closeApplication(value, platform);
  if (action === 'focus') return focusApplication(value, platform);
  throw new Error('Cette action système n’est pas prise en charge.');
}

module.exports = { executeDesktopAction, setVolume, setBrightness, lockScreen, screenshot, closeApplication, focusApplication, toPercent, getApp, APPLICATIONS };
