// Settings center: providers & keys, Unsloth agent, coding agent, privacy, editor.
U.settingsUI = (() => {
  const { $, $$, el, esc, bus, toast, state } = U;
  let page = 'models';
  let editing = null; // provider id being edited

  const ICONS = {
    models: '<path d="M12 2a3 3 0 0 1 3 3v1h2a3 3 0 0 1 3 3v2h1v4h-1v2a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-2H3v-4h1V9a3 3 0 0 1 3-3h2V5a3 3 0 0 1 3-3zm-3 9a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm6 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/>',
    unsloth: '<path d="M12 2l2.4 5.6L20 10l-5.6 2.4L12 18l-2.4-5.6L4 10l5.6-2.4z"/>',
    agent: '<path d="M20 19V7H4v12h16m0-16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16m-7 14v-2h5v2h-5m-3.42-4L5.57 9H8.4l3.3 3.3c.39.39.39 1.03 0 1.42L8.42 17H5.59l4-4z"/>',
    privacy: '<path d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3zm0 10.9h6c-.5 3.7-3 7-6 7.9V12H6V6.3l6-2.2v8.8z"/>',
    editor: '<path d="M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0 4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/>',
    about: '<path d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/>'
  };
  const NAV = [['models', 'Models & API Keys'], ['unsloth', 'Unsloth Agents'], ['agent', 'Coding Agent'], ['privacy', 'Privacy & Security'], ['editor', 'Editor'], ['about', 'About']];

  async function load() {
    const r = await umbra.settings.get();
    state.settings = r.settings; state.presets = r.presets; state.secrets = r.secrets;
    bus.emit('settings', state.settings);
  }
  async function patch(p, quiet) {
    state.settings = await umbra.settings.set(p);
    bus.emit('settings', state.settings);
    if (!quiet) flash();
  }
  const flash = U.debounce(() => toast('Settings saved locally', 'ok', 1400), 400);

  function open(p) {
    if (p) page = p;
    editing ||= state.settings.activeProvider;
    $('#settings').classList.remove('hidden');
    render();
  }
  function close() { $('#settings').classList.add('hidden'); }

  // helpers -------------------------------------------------------------------
  const row = (label, desc, control, full) => el('div', { class: `row ${full ? 'full' : ''}` },
    el('div', { class: 'rl', html: `<b>${esc(label)}</b>${desc ? `<span>${desc}</span>` : ''}` }), el('div', { class: 'rc' }, control));
  const toggle = (checked, onchange) => {
    const l = el('label', { class: 'toggle' });
    const i = el('input', { type: 'checkbox' }); i.checked = !!checked; i.onchange = () => onchange(i.checked);
    l.append(i, el('span')); return l;
  };
  const input = (value, onchange, attrs = {}) => {
    const i = el('input', { class: 'input', value: value ?? '', spellcheck: 'false', ...attrs });
    i.onchange = () => onchange(attrs.type === 'number' ? Number(i.value) : i.value); return i;
  };
  const section = (title, ...rows) => el('div', { class: 'set-section' }, el('h3', { html: title }), ...rows);

  function render() {
    const root = $('#settings'); root.innerHTML = '';
    const nav = el('nav', { class: 'set-nav' },
      el('div', { class: 'snh', html: `<svg viewBox="0 0 32 32" width="22" height="22"><defs><linearGradient id="lg2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs><path d="M16 2 4 8v8c0 7 5.2 12.4 12 14 6.8-1.6 12-7 12-14V8L16 2z" fill="url(#lg2)"/><path d="M16 9a7 7 0 1 0 0 14 5.2 5.2 0 0 1 0-14z" fill="#0c0d13"/></svg><b>Settings</b>` }),
      NAV.map(([id, label]) => el('button', { class: page === id ? 'active' : '', onclick: () => { page = id; render(); },
        html: `<svg viewBox="0 0 24 24">${ICONS[id]}</svg>${esc(label)}` })));
    const main = el('div', { class: 'set-main' },
      el('button', { class: 'icon-btn set-close', title: 'Close (Esc)', onclick: close, html: '<svg viewBox="0 0 24 24"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>' }));
    ({ models: pModels, unsloth: pUnsloth, agent: pAgent, privacy: pPrivacy, editor: pEditor, about: pAbout })[page](main);
    root.append(el('div', { class: 'settings-box' }, nav, main));
    root.onclick = (e) => { if (e.target === root) close(); };
  }

  // ---------------------------------------------------------------- MODELS
  function pModels(m) {
    const s = state.settings;
    m.append(el('h2', {}, 'Models & API Keys'),
      el('p', { class: 'lede', html: 'Connect a local model server or bring your own key. Keys are encrypted with your OS keychain and are <b>never</b> exposed to the UI layer or written in plaintext.' }));
    const grid = el('div', { class: 'provider-grid' });
    for (const [id, p] of Object.entries(state.presets)) {
      const blocked = s.privacy.localOnly && !p.local;
      const keySet = state.secrets[id]?.set;
      grid.append(el('button', { class: `pcard ${editing === id ? 'sel' : ''} ${blocked ? 'disabled' : ''}`, onclick: () => { editing = id; render(); } },
        s.activeProvider === id ? el('span', { class: 'active-badge' }, 'ACTIVE') : null,
        el('div', { class: 'pn', html: `<span class="dot ${p.local ? 'ok' : 'cloud'}"></span>${esc(p.label)}` }),
        el('div', { class: 'pt', html: `<span class="tag ${p.local ? 'local' : 'cloud'}">${p.local ? 'LOCAL' : 'CLOUD'}</span>${keySet ? '<span class="tag local">KEY ✓</span>' : ''}${blocked ? '<span class="tag blocked">BLOCKED</span>' : ''}` })));
    }
    m.append(grid);

    const id = editing; const p = state.presets[id]; const cfg = s.providers[id] || {};
    const result = el('div', { class: 'test-result' });
    const modelInput = input(cfg.model, (v) => patch({ providers: { [id]: { model: v } } }), { placeholder: 'model id', list: 'model-list' });
    const dl = el('datalist', { id: 'model-list' });
    const keyInput = el('input', { class: 'input', type: 'password', placeholder: state.secrets[id]?.set ? `Saved ${state.secrets[id].hint} — type to replace` : (p.needsKey ? 'sk-…' : 'optional'), autocomplete: 'off', spellcheck: 'false' });
    const saveKey = el('button', { class: 'btn sm', onclick: async () => {
      try { state.secrets = await umbra.settings.setSecret(id, keyInput.value.trim()); keyInput.value = ''; toast(`Key for ${p.label} encrypted & stored`, 'ok'); render(); }
      catch (e) { toast(clean(e), 'bad'); }
    } }, 'Save');
    const clearKey = el('button', { class: 'btn sm ghost', onclick: async () => { state.secrets = await umbra.settings.setSecret(id, ''); toast('Key removed', 'ok'); render(); } }, 'Remove');

    m.append(section(`${esc(p.label)} <span class="muted small" style="font-weight:400">— ${esc(p.hint)}</span>`,
      row('Use as active model', 'Routes chat, agent, and Ctrl+K edits to this provider.',
        s.activeProvider === id ? el('span', { class: 'tag local' }, 'ACTIVE')
          : el('button', { class: 'btn sm primary', disabled: s.privacy.localOnly && !p.local, onclick: () => { patch({ activeProvider: id }); render(); U.checkModel(); } }, 'Make active')),
      row('Base URL', 'OpenAI-compatible endpoint (ends in /v1).', input(cfg.baseUrl, (v) => patch({ providers: { [id]: { baseUrl: v } } }))),
      row('Model', 'Exact model id the server expects. Use “Fetch” to list.', el('div', { style: 'display:flex;gap:6px;width:100%' }, modelInput, dl,
        el('button', { class: 'btn sm', onclick: async () => {
          result.className = 'test-result'; result.textContent = 'Fetching models…';
          try { const list = await umbra.llm.models(id); dl.innerHTML = list.map((x) => `<option value="${esc(x)}">`).join('');
            result.className = 'test-result ok'; result.textContent = `${list.length} model(s): ${list.slice(0, 6).join(', ')}${list.length > 6 ? '…' : ''}`;
            if (!cfg.model && list[0]) { modelInput.value = list[0]; patch({ providers: { [id]: { model: list[0] } } }); }
          } catch (e) { result.className = 'test-result bad'; result.textContent = clean(e); }
        } }, 'Fetch'))),
      row('API key', `${p.needsKey ? 'Required.' : 'Optional for most local servers.'} Stored encrypted via OS keychain.`,
        el('div', { style: 'display:flex;gap:6px;width:100%' }, keyInput, saveKey, state.secrets[id]?.set ? clearKey : null)),
      row('Connection', '', el('div', { style: 'text-align:right' }, el('button', { class: 'btn sm', onclick: async () => {
        result.className = 'test-result'; result.textContent = 'Testing…';
        try { const r = await umbra.llm.test(id); result.className = 'test-result ok'; result.textContent = `✓ Connected in ${r.ms} ms — ${r.models.length} model(s) available`; }
        catch (e) { result.className = 'test-result bad'; result.textContent = '✗ ' + clean(e); }
      } }, 'Test connection'), result))));

    m.append(section('Sampling',
      row('Temperature', 'Higher = more creative.', input(s.sampling.temperature, (v) => patch({ sampling: { temperature: v } }), { type: 'number', step: '0.05', min: '0', max: '2' })),
      row('Top-p', '', input(s.sampling.top_p, (v) => patch({ sampling: { top_p: v } }), { type: 'number', step: '0.05', min: '0', max: '1' })),
      row('Max tokens', 'Upper bound per response.', input(s.sampling.max_tokens, (v) => patch({ sampling: { max_tokens: v } }), { type: 'number', step: '128', min: '64' }))));
  }

  // ---------------------------------------------------------------- UNSLOTH
  function pUnsloth(m) {
    const s = state.settings; const u = s.unsloth; const cfg = s.providers.unsloth;
    m.append(el('h2', {}, 'Unsloth Agents'),
      el('p', { class: 'lede', html: 'Umbra speaks the Unsloth Studio inference API natively — including server-side thinking and agent tools. Point it at your local Unsloth server and pick which tools the model may use.' }));
    const toolChips = el('div', { class: 'chips-input' }, ['web_search', 'python', 'terminal'].map((t) => {
      const cb = el('input', { type: 'checkbox' }); cb.checked = u.enabled_tools.includes(t);
      cb.onchange = () => { const set = new Set(state.settings.unsloth.enabled_tools); cb.checked ? set.add(t) : set.delete(t); patch({ unsloth: { enabled_tools: [...set] } }); };
      return el('label', {}, cb, t === 'web_search' ? 'web_search ☁' : t);
    }));
    const permSel = el('select', { class: 'input' }, ['off', 'ask', 'auto'].map((v) => el('option', { value: v, selected: u.permission_mode === v }, v)));
    permSel.onchange = () => patch({ unsloth: { permission_mode: permSel.value } });
    m.append(section('Server',
      row('Endpoint', 'Default Unsloth Studio port is 8888.', input(cfg.baseUrl, (v) => patch({ providers: { unsloth: { baseUrl: v } } }))),
      row('Model', 'The model loaded in Unsloth.', input(cfg.model, (v) => patch({ providers: { unsloth: { model: v } } }), { placeholder: 'e.g. unsloth/Qwen3-Coder-30B-A3B-Instruct' })),
      row('API key', state.secrets.unsloth?.set ? `Saved ${state.secrets.unsloth.hint}` : 'Your sk-unsloth-… key. Manage it under Models & API Keys.',
        el('button', { class: 'btn sm', onclick: () => { editing = 'unsloth'; page = 'models'; render(); } }, 'Manage key')),
      row('Use Unsloth as active model', '', s.activeProvider === 'unsloth' ? el('span', { class: 'tag local' }, 'ACTIVE')
        : el('button', { class: 'btn sm primary', onclick: () => { patch({ activeProvider: 'unsloth' }); render(); U.checkModel(); } }, 'Make active'))));
    m.append(section('Reasoning & sampling extras',
      row('Enable thinking', 'Streams the model’s reasoning into a collapsible “Thinking” block.', toggle(u.enable_thinking, (v) => patch({ unsloth: { enable_thinking: v } }))),
      row('top_k', '', input(u.top_k, (v) => patch({ unsloth: { top_k: v } }), { type: 'number', min: '0' })),
      row('min_p', '', input(u.min_p, (v) => patch({ unsloth: { min_p: v } }), { type: 'number', step: '0.01', min: '0', max: '1' })),
      row('repetition_penalty', '', input(u.repetition_penalty, (v) => patch({ unsloth: { repetition_penalty: v } }), { type: 'number', step: '0.05', min: '0.5', max: '2' }))));
    m.append(section('Server-side agent tools',
      row('Enable Unsloth tools', 'Lets the Unsloth server run its own tools during generation.', toggle(u.enable_tools, (v) => patch({ unsloth: { enable_tools: v } }))),
      row('Enabled tools', '<span style="color:var(--warn)">web_search contacts the internet from the Unsloth server.</span>', toolChips),
      row('permission_mode', 'Passed through to Unsloth as-is.', permSel)));
    const snippet = `from openai import OpenAI\n\nclient = OpenAI(base_url="${cfg.baseUrl}", api_key="sk-unsloth-…")\nresp = client.chat.completions.create(\n    model="${cfg.model || 'YOUR_MODEL'}",\n    messages=[{"role": "user", "content": "…"}],\n    temperature=${s.sampling.temperature}, top_p=${s.sampling.top_p}, max_tokens=${s.sampling.max_tokens},\n    extra_body={\n        "top_k": ${u.top_k}, "min_p": ${u.min_p}, "repetition_penalty": ${u.repetition_penalty},\n        "enable_thinking": ${u.enable_thinking ? 'True' : 'False'}, "enable_tools": ${u.enable_tools ? 'True' : 'False'},\n        "enabled_tools": ${JSON.stringify(u.enabled_tools)}, "permission_mode": "${u.permission_mode}",\n    },\n    stream=True,\n)`;
    m.append(section('Equivalent request <span class="muted small" style="font-weight:400">— this is exactly what Umbra sends</span>', el('pre', { class: 'code-snippet' }, snippet)));
  }

  // ---------------------------------------------------------------- AGENT
  function pAgent(m) {
    const s = state.settings; const a = s.agent;
    const sys = el('textarea', { class: 'input', rows: 6 }, s.systemPrompt); sys.onchange = () => patch({ systemPrompt: sys.value });
    m.append(el('h2', {}, 'Coding Agent'),
      el('p', { class: 'lede', html: 'In <b>Agent</b> mode the model can use workspace tools through OpenAI-style function calling. Every action is sandboxed to the open folder, and anything that changes your machine asks first unless you allow it.' }),
      section('Workspace tools',
        row('Enable workspace tools', 'list_dir · read_file · search · write_file · run_command', toggle(a.workspaceTools, (v) => patch({ agent: { workspaceTools: v } }))),
        row('Auto-approve reads', 'Listing, reading and searching files.', toggle(a.autoApproveReads, (v) => patch({ agent: { autoApproveReads: v } }))),
        row('Auto-approve file writes', '<span style="color:var(--warn)">The agent can modify files without asking.</span>', toggle(a.autoApproveWrites, (v) => patch({ agent: { autoApproveWrites: v } }))),
        row('Auto-approve shell commands', '<span style="color:var(--bad)">The agent can run any command without asking.</span>', toggle(a.autoApproveCommands, (v) => patch({ agent: { autoApproveCommands: v } }))),
        row('Max agent steps', 'Tool-call rounds per request.', input(a.maxSteps, (v) => patch({ agent: { maxSteps: v } }), { type: 'number', min: '1', max: '50' }))),
      section('System prompt', el('div', { class: 'row full' }, sys)));
  }

  // ---------------------------------------------------------------- PRIVACY
  function pPrivacy(m) {
    const s = state.settings; const pv = s.privacy;
    m.append(el('h2', {}, 'Privacy & Security'),
      el('p', { class: 'lede' }, 'Umbra is private by construction, not by policy. These are the guarantees and the controls.'),
      el('div', { class: 'pledge', html: [
        ['Zero telemetry', 'No analytics, crash reporting, or usage pings. There is no server to send them to.'],
        ['Sealed renderer', 'The UI is blocked from the network entirely; only the main process can reach model endpoints.'],
        ['Encrypted key vault', `API keys are sealed with the OS keychain${state.appInfo?.encryption ? '' : ' (unavailable on this system — keys cannot be saved)'} and never reach the UI.`],
        ['Full network ledger', 'Every outbound request is logged with host, size and purpose — inspect it any time.'],
        ['Workspace sandbox', 'Agent tools cannot read or write outside the open folder.'],
        ['No auto-updates', 'Nothing is downloaded behind your back. Chromium background networking is disabled.']
      ].map(([t, d]) => `<div><b>${t}</b>${d}</div>`).join('') }),
      section('Controls',
        row('Local-only mode', 'Hard-block every model endpoint that isn’t on this machine (127.0.0.1 / localhost).', toggle(pv.localOnly, async (v) => {
          if (!v && !(await U.confirm('Allow cloud providers?', 'Prompts — including attached code — may be sent to third-party servers when a cloud provider is active.', 'Allow cloud'))) { render(); return; }
          await patch({ privacy: { localOnly: v } });
          if (v && !state.presets[state.settings.activeProvider].local) await patch({ activeProvider: 'unsloth' }, true);
          render();
        })),
        row('Redact secrets', 'Scrub API keys, tokens, private keys and passwords from prompts sent to cloud providers.', toggle(pv.redactSecrets, (v) => patch({ privacy: { redactSecrets: v } }))),
        row('Attach active file', 'Include the open file as context with each prompt (toggleable per message).', toggle(pv.sendFileContext, (v) => patch({ privacy: { sendFileContext: v } }))),
        row('Remember chats', 'Off = conversations exist in memory only and vanish when you close the app.', toggle(pv.persistChats, (v) => patch({ privacy: { persistChats: v } }))),
        row('Block UI network access', 'Recommended. Disabling allows the renderer to load remote resources.', toggle(pv.blockRendererNetwork, (v) => patch({ privacy: { blockRendererNetwork: v } })))),
      el('div', { class: 'set-section danger-zone' }, el('h3', {}, 'Danger zone'),
        row('Panic wipe', 'Destroys all stored API keys, resets every setting and clears the network ledger. Your code files are not touched.',
          el('button', { class: 'btn danger sm', onclick: async () => {
            if (!(await U.confirm('Wipe all keys and settings?', 'This permanently deletes every stored API key and resets Umbra to defaults. This cannot be undone.', 'Wipe everything', true))) return;
            state.settings = await umbra.settings.wipe(); state.secrets = {};
            try { localStorage.clear(); } catch {}
            U.chat.reset(); bus.emit('settings', state.settings); toast('All keys and settings wiped', 'ok'); render();
          } }, 'Wipe everything'))));
  }

  // ---------------------------------------------------------------- EDITOR
  function pEditor(m) {
    const e = state.settings.editor;
    const ap = (o) => U.editor.applyOptions(o);
    const wrap = el('select', { class: 'input' }, ['off', 'on', 'bounded'].map((v) => el('option', { value: v, selected: e.wordWrap === v }, v)));
    wrap.onchange = () => { patch({ editor: { wordWrap: wrap.value } }); ap({ wordWrap: wrap.value }); };
    m.append(el('h2', {}, 'Editor'), el('p', { class: 'lede' }, 'Powered by the Monaco engine, bundled locally.'),
      section('Appearance',
        row('Font size', '', input(e.fontSize, (v) => { patch({ editor: { fontSize: v } }); ap({ fontSize: v }); }, { type: 'number', min: '9', max: '32' })),
        row('Font ligatures', '', toggle(e.fontLigatures, (v) => { patch({ editor: { fontLigatures: v } }); ap({ fontLigatures: v }); })),
        row('Minimap', '', toggle(e.minimap, (v) => { patch({ editor: { minimap: v } }); ap({ minimap: { enabled: v } }); })),
        row('Word wrap', '', wrap)));
  }

  function pAbout(m) {
    const i = state.appInfo || {};
    m.append(el('h2', {}, 'About Umbra Studio'), el('p', { class: 'lede' }, 'A private, local-first AI code editor.'),
      section('Build',
        row('Version', '', el('span', {}, i.version || '')),
        row('Runtime', '', el('span', {}, `Electron ${i.electron} · ${i.platform}`)),
        row('Local data folder', 'Settings and the encrypted key vault live here. Nothing else is stored.', el('code', { style: 'font:11px var(--mono);color:var(--fg-2);word-break:break-all;text-align:right' }, i.userData || '')),
        row('Key encryption', '', el('span', { class: `tag ${i.encryption ? 'local' : 'blocked'}` }, i.encryption ? 'OS KEYCHAIN' : 'UNAVAILABLE'))),
      section('Shortcuts', el('pre', { class: 'code-snippet', style: 'margin:14px 16px' },
        'Ctrl+P            Go to file\nCtrl+Shift+P      Command palette\nCtrl+K            Edit selection with AI\nCtrl+L            Ask the agent (with selection)\nCtrl+S            Save\nCtrl+B            Toggle sidebar\nCtrl+J / Ctrl+`   Toggle panel\nCtrl+Alt+B        Toggle agent panel\nCtrl+,            Settings')));
  }

  const clean = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#settings').classList.contains('hidden') && $('#modal').classList.contains('hidden')) close(); });
  return { load, open, close, patch };
})();
