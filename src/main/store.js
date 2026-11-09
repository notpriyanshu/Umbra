// Umbra Studio — local settings + encrypted secret vault.
// Settings live in <userData>/settings.json. Secrets (API keys) are encrypted with the
// OS keychain via Electron safeStorage (DPAPI on Windows, Keychain on macOS, libsecret on Linux)
// and are NEVER sent to the renderer process — the UI only ever sees a masked hint.
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const PROVIDER_PRESETS = {
  unsloth: {
    label: 'Unsloth Studio', kind: 'openai', local: true,
    baseUrl: 'http://127.0.0.1:8888/v1', model: '', needsKey: true,
    hint: 'Unsloth local inference server (OpenAI-compatible). Supports server-side agent tools.'
  },
  ollama: {
    label: 'Ollama', kind: 'openai', local: true,
    baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5-coder:7b', needsKey: false,
    hint: 'Run `ollama serve`. Uses the OpenAI-compatible /v1 endpoint.'
  },
  lmstudio: {
    label: 'LM Studio', kind: 'openai', local: true,
    baseUrl: 'http://127.0.0.1:1234/v1', model: '', needsKey: false,
    hint: 'Start the local server from the LM Studio Developer tab.'
  },
  llamacpp: {
    label: 'llama.cpp server', kind: 'openai', local: true,
    baseUrl: 'http://127.0.0.1:8080/v1', model: 'local', needsKey: false,
    hint: 'llama-server -m model.gguf --port 8080'
  },
  vllm: {
    label: 'vLLM', kind: 'openai', local: true,
    baseUrl: 'http://127.0.0.1:8000/v1', model: '', needsKey: false,
    hint: 'vllm serve <model>'
  },
  openai: {
    label: 'OpenAI', kind: 'openai', local: false,
    baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1', needsKey: true,
    hint: 'Cloud provider. Disabled while Local-only mode is on.'
  },
  anthropic: {
    label: 'Anthropic', kind: 'anthropic', local: false,
    baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5-5', needsKey: true,
    hint: 'Cloud provider. Disabled while Local-only mode is on.'
  },
  openrouter: {
    label: 'OpenRouter', kind: 'openai', local: false,
    baseUrl: 'https://openrouter.ai/api/v1', model: '', needsKey: true,
    hint: 'Cloud router. Disabled while Local-only mode is on.'
  },
  custom: {
    label: 'Custom (OpenAI-compatible)', kind: 'openai', local: true,
    baseUrl: 'http://127.0.0.1:5000/v1', model: '', needsKey: false,
    hint: 'Any OpenAI-compatible endpoint.'
  }
};

const DEFAULTS = {
  activeProvider: 'unsloth',
  providers: Object.fromEntries(
    Object.entries(PROVIDER_PRESETS).map(([id, p]) => [id, { baseUrl: p.baseUrl, model: p.model }])
  ),
  sampling: { temperature: 0.7, top_p: 0.8, max_tokens: 2048 },
  unsloth: {
    top_k: 20, min_p: 0.05, repetition_penalty: 1.1,
    enable_thinking: true,
    enable_tools: true,
    enabled_tools: ['python', 'terminal'],
    permission_mode: 'off'
  },
  privacy: {
    localOnly: true,          // refuse any non-loopback LLM endpoint
    redactSecrets: true,      // scrub API keys / tokens from prompts sent to remote providers
    persistChats: false,      // chats live in memory only
    sendFileContext: true,    // attach the active file to prompts
    blockRendererNetwork: true
  },
  agent: {
    workspaceTools: true,     // let the model read/write/search files & run commands
    autoApproveReads: true,
    autoApproveWrites: false,
    autoApproveCommands: false,
    maxSteps: 12
  },
  editor: { fontSize: 14, minimap: true, wordWrap: 'off', theme: 'umbra-dark', fontLigatures: true },
  systemPrompt:
    'You are Umbra, an expert software engineer embedded in a private, local code editor. ' +
    'Be concise. Prefer showing code in fenced blocks with a language tag. ' +
    'When workspace tools are available, inspect files before editing them and explain what you change.'
};

function deepMerge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over || {})) out[k] = k in base ? deepMerge(base[k], over[k]) : over[k];
  return out;
}

class Store {
  constructor() {
    this.dir = app.getPath('userData');
    this.settingsFile = path.join(this.dir, 'settings.json');
    this.vaultFile = path.join(this.dir, 'vault.bin.json');
    this.settings = deepMerge(DEFAULTS, this._readJson(this.settingsFile, {}));
    this.vault = this._readJson(this.vaultFile, {});
  }
  _readJson(f, fallback) {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; }
  }
  _write(f, obj) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(obj, null, 2), { mode: 0o600 });
  }
  getSettings() { return JSON.parse(JSON.stringify(this.settings)); }
  setSettings(patch) {
    this.settings = deepMerge(this.settings, patch);
    this._write(this.settingsFile, this.settings);
    return this.getSettings();
  }
  resetSettings() { this.settings = deepMerge(DEFAULTS, {}); this._write(this.settingsFile, this.settings); return this.getSettings(); }

  // ---- secrets ----
  encryptionAvailable() { return safeStorage.isEncryptionAvailable(); }
  setSecret(id, value) {
    if (!value) { delete this.vault[id]; this._write(this.vaultFile, this.vault); return; }
    if (!safeStorage.isEncryptionAvailable()) throw new Error('OS keychain encryption unavailable — refusing to store key in plaintext.');
    this.vault[id] = safeStorage.encryptString(value).toString('base64');
    this._write(this.vaultFile, this.vault);
  }
  getSecret(id) {
    const enc = this.vault[id];
    if (!enc) return '';
    try { return safeStorage.decryptString(Buffer.from(enc, 'base64')); } catch { return ''; }
  }
  secretHints() {
    const out = {};
    for (const id of Object.keys(this.vault)) {
      const v = this.getSecret(id);
      out[id] = v ? { set: true, hint: '••••' + v.slice(-4) } : { set: false };
    }
    return out;
  }
  wipeAll() {
    this.vault = {};
    this._write(this.vaultFile, this.vault);
    return this.resetSettings();
  }
}

module.exports = { Store, PROVIDER_PRESETS };
