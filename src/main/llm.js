// Umbra Studio — model gateway + coding agent loop.
// All model traffic flows through the main process so that:
//   * API keys never touch the renderer,
//   * every outbound request is recorded in the Network Ledger,
//   * Local-only mode can hard-block non-loopback endpoints.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { PROVIDER_PRESETS } = require('./store');

// ---------------------------------------------------------------- helpers
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);
function isLoopback(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return LOOPBACK.has(h) || h.endsWith('.localhost') || /^127\./.test(h);
  } catch { return false; }
}

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_\-]{16,}/g,                       // OpenAI / Anthropic / Unsloth style
  /ghp_[A-Za-z0-9]{30,}/g, /github_pat_[A-Za-z0-9_]{30,}/g,
  /AKIA[0-9A-Z]{16}/g,                             // AWS access key id
  /xox[abprs]-[A-Za-z0-9-]{10,}/g,                 // Slack
  /AIza[0-9A-Za-z\-_]{35}/g,                       // Google
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g, // JWT
  /((?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*)(['"]?)[^\s'"]{6,}\2/gi
];
function redact(text) {
  let count = 0;
  let out = String(text ?? '');
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (m, g1) => {
      count++;
      return typeof g1 === 'string' && /[:=]\s*$/.test(g1) ? `${g1}[REDACTED]` : '[REDACTED]';
    });
  }
  return { text: out, count };
}

// --------------------------------------------------------- workspace tools
const TOOL_DEFS = [
  { name: 'list_dir', kind: 'read', description: 'List files and folders at a path relative to the workspace root.',
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative path, "." for root' } }, required: ['path'] } },
  { name: 'read_file', kind: 'read', description: 'Read a UTF-8 text file from the workspace.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'search', kind: 'read', description: 'Search workspace files for a plain-text query. Returns matching lines.',
    parameters: { type: 'object', properties: { query: { type: 'string' }, glob: { type: 'string', description: 'Optional file extension filter like .ts' } }, required: ['query'] } },
  { name: 'write_file', kind: 'write', description: 'Create or overwrite a file in the workspace with the full new content.',
    parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'run_command', kind: 'exec', description: 'Run a shell command in the workspace root and return stdout/stderr (60s timeout).',
    parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } }
];
const IGNORED = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv', 'venv', 'target']);

function safeJoin(root, rel) {
  if (!root) throw new Error('No workspace folder is open.');
  const p = path.resolve(root, rel || '.');
  const r = path.resolve(root);
  if (p !== r && !p.startsWith(r + path.sep)) throw new Error('Path escapes the workspace sandbox.');
  return p;
}

function runShell(command, cwd, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const child = isWin
      ? spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', command], { cwd, windowsHide: true })
      : spawn(process.env.SHELL || '/bin/bash', ['-lc', command], { cwd });
    let out = '';
    const cap = (d) => { out += d.toString(); if (out.length > 20000) out = out.slice(-20000); };
    child.stdout.on('data', cap); child.stderr.on('data', cap);
    const t = setTimeout(() => { child.kill(); out += '\n[timed out]'; }, timeoutMs);
    child.on('close', (code) => { clearTimeout(t); resolve(`exit code ${code}\n${out}`); });
    child.on('error', (e) => { clearTimeout(t); resolve(`failed: ${e.message}`); });
  });
}

async function execTool(name, args, root) {
  switch (name) {
    case 'list_dir': {
      const p = safeJoin(root, args.path);
      const items = fs.readdirSync(p, { withFileTypes: true })
        .filter((d) => !IGNORED.has(d.name))
        .map((d) => (d.isDirectory() ? d.name + '/' : d.name));
      return items.join('\n') || '(empty)';
    }
    case 'read_file': {
      const p = safeJoin(root, args.path);
      const txt = fs.readFileSync(p, 'utf8');
      return txt.length > 60000 ? txt.slice(0, 60000) + '\n…[truncated]' : txt;
    }
    case 'search': {
      const hits = [];
      const walk = (dir) => {
        if (hits.length > 200) return;
        for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
          if (IGNORED.has(d.name) || d.name.startsWith('.')) continue;
          const full = path.join(dir, d.name);
          if (d.isDirectory()) walk(full);
          else if (!args.glob || d.name.endsWith(args.glob)) {
            let st; try { st = fs.statSync(full); } catch { continue; }
            if (st.size > 1_000_000) continue;
            const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
            lines.forEach((l, i) => {
              if (hits.length <= 200 && l.toLowerCase().includes(String(args.query).toLowerCase()))
                hits.push(`${path.relative(root, full)}:${i + 1}: ${l.trim().slice(0, 200)}`);
            });
          }
        }
      };
      walk(safeJoin(root, '.'));
      return hits.join('\n') || 'No matches.';
    }
    case 'write_file': {
      const p = safeJoin(root, args.path);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, args.content ?? '', 'utf8');
      return `Wrote ${Buffer.byteLength(args.content ?? '')} bytes to ${args.path}`;
    }
    case 'run_command':
      return runShell(args.command, safeJoin(root, '.'));
    default:
      return `Unknown tool ${name}`;
  }
}

// ------------------------------------------------------------- the gateway
class Gateway {
  constructor({ store, ledger, getWorkspace, requestApproval }) {
    this.store = store;
    this.ledger = ledger;
    this.getWorkspace = getWorkspace;
    this.requestApproval = requestApproval;
    this.controllers = new Map();
  }

  resolveProvider(id) {
    const s = this.store.getSettings();
    const pid = id || s.activeProvider;
    const preset = PROVIDER_PRESETS[pid];
    if (!preset) throw new Error(`Unknown provider "${pid}"`);
    const cfg = s.providers[pid] || {};
    const baseUrl = (cfg.baseUrl || preset.baseUrl).replace(/\/+$/, '');
    const local = isLoopback(baseUrl);
    if (s.privacy.localOnly && !local)
      throw new Error(`Local-only mode is ON — blocked request to ${new URL(baseUrl).host}. Turn it off in Settings › Privacy to use cloud providers.`);
    return { id: pid, preset, baseUrl, model: cfg.model || preset.model, key: this.store.getSecret(pid), local, settings: s };
  }

  async _fetch(url, init, meta) {
    const started = Date.now();
    const entry = { id: Math.random().toString(36).slice(2), ts: started, method: init.method || 'GET',
      url: url.replace(/key=[^&]+/, 'key=***'), host: new URL(url).host, local: isLoopback(url),
      purpose: meta.purpose, bytesOut: init.body ? Buffer.byteLength(init.body) : 0, redactions: meta.redactions || 0, status: 'pending' };
    this.ledger.add(entry);
    try {
      const res = await fetch(url, init);
      this.ledger.update(entry.id, { status: res.status, ms: Date.now() - started });
      return res;
    } catch (e) {
      this.ledger.update(entry.id, { status: 'error', error: e.message, ms: Date.now() - started });
      throw e;
    }
  }

  async listModels(providerId) {
    const p = this.resolveProvider(providerId);
    const headers = {};
    if (p.preset.kind === 'anthropic') { headers['x-api-key'] = p.key; headers['anthropic-version'] = '2023-06-01'; }
    else if (p.key) headers.Authorization = `Bearer ${p.key}`;
    const res = await this._fetch(`${p.baseUrl}/models`, { headers, signal: AbortSignal.timeout(8000) }, { purpose: 'list models' });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = await res.json();
    const arr = j.data || j.models || [];
    return arr.map((m) => m.id || m.name).filter(Boolean);
  }

  cancel(reqId) { this.controllers.get(reqId)?.abort(); this.controllers.delete(reqId); }

  /**
   * Run a chat turn (possibly multi-step with tools). Emits events via `emit(type, data)`:
   *  token | thinking | tool_call | tool_result | done | error | info
   */
  async chat(reqId, { messages, providerId, agent }, emit) {
    const ctrl = new AbortController();
    this.controllers.set(reqId, ctrl);
    try {
      const p = this.resolveProvider(providerId);
      const s = p.settings;
      const doRedact = s.privacy.redactSecrets && !p.local;
      let redactions = 0;
      const convo = [{ role: 'system', content: s.systemPrompt }, ...messages].map((m) => {
        if (!doRedact || typeof m.content !== 'string') return m;
        const r = redact(m.content); redactions += r.count; return { ...m, content: r.text };
      });
      if (redactions) emit('info', `Privacy shield redacted ${redactions} secret(s) before sending.`);

      const useTools = agent && s.agent.workspaceTools && !!this.getWorkspace() && p.preset.kind === 'openai';
      if (agent && s.agent.workspaceTools && !this.getWorkspace()) emit('info', 'Open a folder to give the agent workspace tools.');

      if (p.preset.kind === 'anthropic') {
        await this._anthropicTurn(p, convo, ctrl, emit, redactions);
        emit('done', {});
        return;
      }

      const maxSteps = useTools ? s.agent.maxSteps : 1;
      for (let step = 0; step < maxSteps; step++) {
        const { content, toolCalls } = await this._openaiTurn(p, convo, ctrl, emit, useTools, redactions);
        redactions = 0;
        if (!toolCalls.length) break;
        convo.push({ role: 'assistant', content: content || null, tool_calls: toolCalls });
        for (const tc of toolCalls) {
          let args = {};
          try { args = JSON.parse(tc.function.arguments || '{}'); } catch { args = {}; }
          const def = TOOL_DEFS.find((t) => t.name === tc.function.name);
          emit('tool_call', { id: tc.id, name: tc.function.name, args });
          let approved = true;
          if (def?.kind === 'write' && !s.agent.autoApproveWrites) approved = await this.requestApproval({ id: tc.id, name: def.name, args });
          if (def?.kind === 'exec' && !s.agent.autoApproveCommands) approved = await this.requestApproval({ id: tc.id, name: def.name, args });
          if (def?.kind === 'read' && !s.agent.autoApproveReads) approved = await this.requestApproval({ id: tc.id, name: def.name, args });
          let result;
          if (!approved) result = 'User denied this action.';
          else {
            try { result = await execTool(tc.function.name, args, this.getWorkspace()); }
            catch (e) { result = `Error: ${e.message}`; }
          }
          emit('tool_result', { id: tc.id, name: tc.function.name, approved, result: String(result).slice(0, 4000), args });
          const r = doRedact ? redact(result).text : result;
          convo.push({ role: 'tool', tool_call_id: tc.id, content: String(r) });
        }
        if (step === maxSteps - 1) emit('info', `Agent stopped after ${maxSteps} steps.`);
      }
      emit('done', {});
    } catch (e) {
      if (e.name === 'AbortError') emit('done', { cancelled: true });
      else emit('error', e.message || String(e));
    } finally {
      this.controllers.delete(reqId);
    }
  }

  async _openaiTurn(p, convo, ctrl, emit, useTools, redactions) {
    const s = p.settings;
    const body = {
      model: p.model || 'default',
      messages: convo,
      temperature: s.sampling.temperature,
      top_p: s.sampling.top_p,
      max_tokens: s.sampling.max_tokens,
      stream: true
    };
    if (p.id === 'unsloth') {
      // Unsloth-specific extras (sent as top-level fields, same as OpenAI SDK `extra_body`).
      const u = s.unsloth;
      Object.assign(body, {
        top_k: u.top_k, min_p: u.min_p, repetition_penalty: u.repetition_penalty,
        enable_thinking: u.enable_thinking, enable_tools: u.enable_tools,
        enabled_tools: u.enabled_tools, permission_mode: u.permission_mode
      });
    }
    if (useTools) {
      body.tools = TOOL_DEFS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
      body.tool_choice = 'auto';
    }
    const headers = { 'Content-Type': 'application/json' };
    if (p.key) headers.Authorization = `Bearer ${p.key}`;
    const res = await this._fetch(`${p.baseUrl}/chat/completions`,
      { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal },
      { purpose: useTools ? 'agent step' : 'chat', redactions });
    if (!res.ok) throw new Error(`${p.preset.label} returned HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);

    let content = '';
    const toolCalls = [];
    let inThinkTag = false;
    for await (const evt of sse(res, ctrl.signal)) {
      if (evt === '[DONE]') break;
      let j; try { j = JSON.parse(evt); } catch { continue; }
      const delta = j.choices?.[0]?.delta || {};
      const reasoning = delta.reasoning_content ?? delta.reasoning ?? delta.thinking;
      if (reasoning) emit('thinking', reasoning);
      if (delta.content) {
        // Some local servers stream <think>…</think> inline — route it to the thinking pane.
        let txt = delta.content;
        while (txt) {
          if (inThinkTag) {
            const end = txt.indexOf('</think>');
            if (end === -1) { emit('thinking', txt); txt = ''; }
            else { emit('thinking', txt.slice(0, end)); txt = txt.slice(end + 8); inThinkTag = false; }
          } else {
            const st = txt.indexOf('<think>');
            if (st === -1) { content += txt; emit('token', txt); txt = ''; }
            else { const pre = txt.slice(0, st); if (pre) { content += pre; emit('token', pre); } txt = txt.slice(st + 7); inThinkTag = true; }
          }
        }
      }
      for (const tc of delta.tool_calls || []) {
        const i = tc.index ?? toolCalls.length;
        toolCalls[i] ||= { id: tc.id || `call_${i}_${Date.now()}`, type: 'function', function: { name: '', arguments: '' } };
        if (tc.id) toolCalls[i].id = tc.id;
        if (tc.function?.name) toolCalls[i].function.name += tc.function.name;
        if (tc.function?.arguments) toolCalls[i].function.arguments += tc.function.arguments;
      }
      if (j.usage) emit('usage', j.usage);
    }
    return { content, toolCalls: toolCalls.filter(Boolean) };
  }

  async _anthropicTurn(p, convo, ctrl, emit, redactions) {
    const s = p.settings;
    const system = convo.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const messages = convo.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => ({ role: m.role, content: m.content }));
    const res = await this._fetch(`${p.baseUrl}/messages`, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'x-api-key': p.key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: p.model, system, messages, max_tokens: s.sampling.max_tokens, stream: true })
    }, { purpose: 'chat', redactions });
    if (!res.ok) throw new Error(`Anthropic returned HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
    for await (const evt of sse(res, ctrl.signal)) {
      let j; try { j = JSON.parse(evt); } catch { continue; }
      if (j.type === 'content_block_delta') {
        if (j.delta?.type === 'text_delta') emit('token', j.delta.text);
        if (j.delta?.type === 'thinking_delta') emit('thinking', j.delta.thinking);
      }
      if (j.type === 'error') throw new Error(j.error?.message || 'Anthropic stream error');
    }
  }

  /** One-shot completion used by inline edit (Ctrl+K). */
  async complete(messages, providerId) {
    let out = '';
    await new Promise((resolve, reject) => {
      this.chat('inline_' + Date.now(), { messages, providerId, agent: false }, (type, data) => {
        if (type === 'token') out += data;
        if (type === 'done') resolve();
        if (type === 'error') reject(new Error(data));
      });
    });
    return out;
  }
}

async function* sse(res, signal) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.search(/\r?\n\r?\n/)) !== -1) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx).replace(/^\r?\n\r?\n/, '');
      const data = chunk.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (data) yield data;
    }
  }
  const tail = buf.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
  if (tail) yield tail;
}

module.exports = { Gateway, isLoopback, redact, runShell, TOOL_DEFS };
