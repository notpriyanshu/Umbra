// AI chat + coding agent panel.
U.chat = (() => {
  const { $, $$, el, esc, bus, toast, state, basename, uid } = U;
  let messages = [];      // API-shaped history {role, content}
  let current = null;     // { reqId, node, text, thinking, ... }
  const attached = new Set();
  let includeActive = true;
  let includeSelection = true;

  const clean = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

  // ---------------------------------------------------------------- rendering
  function renderEmpty() {
    const c = $('#chat');
    if (messages.length || current) return;
    c.innerHTML = `<div class="chat-empty">
      <div class="big spark">✦</div>
      <h3>Your private coding agent</h3>
      <div>Runs against <b>${esc(state.presets[state.settings?.activeProvider]?.label || 'your model')}</b>. Prompts and code stay on this machine${state.settings?.privacy.localOnly ? '' : ' unless you choose a cloud provider'}.</div>
      <div class="suggest">
        <button data-s="Explain what this file does and point out any bugs.">Explain the current file</button>
        <button data-s="Look through the workspace and give me a short architecture overview.">Map this codebase</button>
        <button data-s="Write unit tests for the current file.">Write tests for this file</button>
        <button data-s="Find and fix the most likely bug in the current file. Make the edit.">Find & fix a bug</button>
      </div></div>`;
    $$('.suggest button', c).forEach((b) => (b.onclick = () => send(b.dataset.s)));
  }

  function addMsg(role, html) {
    const c = $('#chat');
    c.querySelector('.chat-empty')?.remove();
    const node = el('div', { class: `msg ${role}` },
      el('div', { class: 'who', html: role === 'user' ? '<span class="avatar">●</span>You' : `<span class="avatar">✦</span>Umbra <span class="muted small" style="font-weight:400">${esc(modelName())}</span>` }),
      el('div', { class: 'body', html }));
    c.append(node);
    scroll(true);
    return node;
  }
  function scroll(force) {
    const c = $('#chat');
    if (force || c.scrollHeight - c.scrollTop - c.clientHeight < 120) c.scrollTop = c.scrollHeight;
  }
  const modelName = () => { const s = state.settings; return s ? (s.providers[s.activeProvider]?.model || state.presets[s.activeProvider]?.label) : ''; };

  // assistant message = sequence of segments: thinking | text | tool | info | error
  function seg(type) {
    const body = current.node.querySelector('.body');
    const last = current.segs[current.segs.length - 1];
    if (last && last.type === type && (type === 'text' || type === 'thinking')) return last;
    let s;
    if (type === 'thinking') {
      const d = el('details', { class: 'thinking', open: true }, el('summary', {}, 'Thinking…'), el('div', { class: 'tbody' }));
      body.append(d); s = { type, node: d, text: '' };
    } else if (type === 'text') {
      const d = el('div', { class: 'tx' }); body.append(d); s = { type, node: d, text: '' };
    }
    current.segs.push(s);
    return s;
  }
  const renderText = U.debounce((s) => { s.node.innerHTML = U.md.render(s.text) + (current && current.segs.at(-1) === s ? '<span class="cursor-blink"></span>' : ''); scroll(); }, 30);

  // ---------------------------------------------------------------- context
  function renderChips() {
    const box = $('#ctx-chips'); box.innerHTML = '';
    const ap = U.editor.activePath();
    if (ap && state.settings?.privacy.sendFileContext) {
      box.append(el('span', { class: `chip ${includeActive ? '' : 'off'}`, title: 'Active file is attached to your prompt' },
        `📄 ${basename(ap)}`, el('button', { onclick: () => { includeActive = !includeActive; renderChips(); }, title: 'Toggle' }, includeActive ? '×' : '+')));
    }
    for (const p of attached) box.append(el('span', { class: 'chip' }, `📎 ${basename(p)}`, el('button', { onclick: () => { attached.delete(p); renderChips(); } }, '×')));
    const sel = U.editor.selection();
    if (sel && sel.length > 1) box.append(el('span', { class: `chip ${includeSelection ? '' : 'off'}` }, `✂ selection (${sel.split('\n').length} lines)`,
      el('button', { onclick: () => { includeSelection = !includeSelection; renderChips(); } }, includeSelection ? '×' : '+')));
    const s = state.settings;
    const local = s && state.presets[s.activeProvider]?.local;
    $('#composer-hint').innerHTML = s ? (state.mode === 'agent'
      ? `Agent can ${s.agent.workspaceTools ? 'read/edit files & run commands' : 'answer only'} · ${local ? '<span style="color:var(--ok)">local</span>' : '<span style="color:var(--warn)">cloud</span>'}`
      : `Ask mode · no tools · ${local ? '<span style="color:var(--ok)">local</span>' : '<span style="color:var(--warn)">cloud</span>'}`) : '';
  }

  async function buildContext() {
    const parts = [];
    const root = state.workspace?.root;
    const rel = (p) => (root && p.startsWith(root) ? p.slice(root.length + 1) : p);
    const ap = U.editor.activePath();
    if (ap && includeActive && state.settings.privacy.sendFileContext) {
      const content = U.editor.activeContent() || '';
      parts.push(`Active file: ${rel(ap)}\n\`\`\`${U.editor.language()}\n${content.slice(0, 40000)}\n\`\`\``);
    }
    const sel = U.editor.selection();
    if (sel && sel.length > 1 && includeSelection) parts.push(`Selected code:\n\`\`\`${U.editor.language()}\n${sel}\n\`\`\``);
    for (const p of attached) {
      try { const r = await umbra.fs.readFile(p); if (!r.binary) parts.push(`File: ${rel(p)}\n\`\`\`\n${r.content.slice(0, 30000)}\n\`\`\``); } catch {}
    }
    if (root) parts.unshift(`Workspace root: ${state.workspace.name} (tool paths are relative to it)`);
    return parts.length ? `<context>\n${parts.join('\n\n')}\n</context>\n\n` : '';
  }

  // ---------------------------------------------------------------- send
  async function send(text) {
    text = (text ?? $('#prompt').value).trim();
    if (!text || current) return;
    $('#prompt').value = ''; autosize();
    addMsg('user', esc(text));
    const ctx = await buildContext();
    messages.push({ role: 'user', content: ctx + text });
    const reqId = uid();
    current = { reqId, node: addMsg('assistant', ''), segs: [], answer: '', tools: {} };
    setBusy(true);
    umbra.llm.chat(reqId, { messages, agent: state.mode === 'agent' });
  }

  function setBusy(b) {
    const btn = $('#send');
    btn.classList.toggle('stop', b);
    btn.querySelector('span').textContent = b ? 'Stop' : 'Send';
  }

  umbra.llm.onEvent(({ reqId, type, data }) => {
    if (!current || current.reqId !== reqId) return;
    if (type === 'token') {
      const s = seg('text'); s.text += data; current.answer += data; renderText(s);
    } else if (type === 'thinking') {
      const s = seg('thinking'); s.text += data; s.node.querySelector('.tbody').textContent = s.text; scroll();
    } else if (type === 'tool_call') {
      finishThinking();
      const card = el('div', { class: 'tool' });
      const argStr = data.args.path || data.args.command || data.args.query || '';
      card.innerHTML = `<div class="th"><span>🛠</span><span class="tn">${esc(data.name)}</span><span class="ta">${esc(argStr)}</span><span class="ts run">running</span></div><pre></pre>`;
      card.querySelector('.th').onclick = () => card.classList.toggle('open');
      current.node.querySelector('.body').append(card);
      current.segs.push({ type: 'tool', node: card });
      current.tools[data.id] = card; scroll();
    } else if (type === 'tool_result') {
      const card = current.tools[data.id];
      if (card) {
        const st = card.querySelector('.ts');
        st.className = `ts ${data.approved ? 'ok' : 'no'}`; st.textContent = data.approved ? 'done' : 'denied';
        card.querySelector('pre').textContent = data.result;
      }
      if (data.approved && data.name === 'write_file' && state.workspace) {
        const full = U.join(state.workspace.root, data.args.path.replace(/\//g, state.workspace.root.includes('\\') ? '\\' : '/'));
        bus.emit('fs:changed'); U.editor.reloadIfOpen(full);
      }
      if (data.name === 'run_command') bus.emit('fs:changed');
    } else if (type === 'info') {
      current.node.querySelector('.body').append(el('div', { class: 'info-line' }, `ⓘ ${data}`));
      current.segs.push({ type: 'info' });
    } else if (type === 'error') {
      current.node.querySelector('.body').append(el('div', { class: 'err-line' }, `⚠ ${data}\n\nCheck the model server is running and the provider settings are correct (Settings › Models).`));
      current.segs.push({ type: 'error' });
      U.setModelStatus('bad');
      finish();
    } else if (type === 'done') {
      U.setModelStatus('ok');
      if (data?.cancelled) current.node.querySelector('.body').append(el('div', { class: 'info-line' }, '■ Stopped'));
      finish();
    }
  });

  function finishThinking() {
    for (const s of current.segs) if (s.type === 'thinking') { s.node.open = false; s.node.querySelector('summary').textContent = `Thought for a moment (${s.text.length} chars)`; }
  }
  function finish() {
    if (!current) return;
    finishThinking();
    const segs = current.segs.filter((s) => s.type === 'text');
    const last = segs.at(-1);
    const cur = current; current = null;
    segs.forEach((s) => { s.node.innerHTML = U.md.render(s.text); });
    if (cur.answer) messages.push({ role: 'assistant', content: cur.answer });
    else if (!last) messages.pop(); // failed turn — drop the user message so history stays valid
    setBusy(false); persist();
  }

  function persist() { try { if (state.settings?.privacy.persistChats) localStorage.setItem('umbra.chat', JSON.stringify(messages.slice(-60))); else localStorage.removeItem('umbra.chat'); } catch {} }

  function reset() {
    if (current) umbra.llm.cancel(current.reqId);
    current = null; messages = []; attached.clear(); setBusy(false);
    $('#chat').innerHTML = ''; persist(); renderEmpty(); renderChips();
  }

  // ---------------------------------------------------------------- approvals
  umbra.agent.onApproval(async (req) => {
    const what = { write_file: 'write a file', run_command: 'run a shell command', read_file: 'read a file', list_dir: 'list a folder', search: 'search the workspace' }[req.name] || req.name;
    const detail = req.name === 'write_file' ? `<b>${esc(req.args.path)}</b><pre>${esc(String(req.args.content ?? '').slice(0, 6000))}</pre>`
      : req.name === 'run_command' ? `<pre>${esc(req.args.command)}</pre><div class="muted small">Runs in the workspace root on this machine.</div>`
        : `<pre>${esc(JSON.stringify(req.args, null, 2))}</pre>`;
    const ok = await U.modal({ title: `The agent wants to ${what}`, icon: '<span class="spark">✦</span> ', html: detail,
      buttons: [{ label: 'Deny', value: false }, { label: 'Allow', value: true, primary: true }] });
    umbra.agent.approve(req.id, !!ok);
  });

  // ---------------------------------------------------------------- code block actions
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('.codeblock .cb-head button'); if (!b) return;
    const cb = U.md.store[b.closest('.codeblock').dataset.cb]; if (!cb) return;
    const act = b.dataset.act;
    if (act === 'copy') { await navigator.clipboard.writeText(cb.code); b.textContent = 'Copied'; setTimeout(() => (b.textContent = 'Copy'), 1200); }
    if (act === 'insert') U.editor.insert(cb.code);
    if (act === 'run') { if (await U.confirm('Run in terminal?', cb.code, 'Run')) U.terminal.run(cb.code); }
    if (act === 'apply') {
      const ap = U.editor.activePath(); if (!ap) { toast('Open a file to apply to.', 'warn'); return; }
      const sel = U.editor.selection();
      if (sel) U.editor.insert(cb.code);
      else if (await U.confirm(`Replace contents of ${basename(ap)}?`, 'The whole file will be replaced with this code block. You can undo with Ctrl+Z.', 'Replace')) U.editor.replaceAll(cb.code);
    }
  });

  // ---------------------------------------------------------------- wiring
  function autosize() { const t = $('#prompt'); t.style.height = 'auto'; t.style.height = Math.min(240, t.scrollHeight) + 'px'; }
  document.addEventListener('DOMContentLoaded', () => {
    const p = $('#prompt');
    p.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
    p.addEventListener('input', autosize);
    $('#send').onclick = () => (current ? umbra.llm.cancel(current.reqId) : send());
    $('#ai-new').onclick = reset;
    $$('#mode-seg button').forEach((b) => (b.onclick = () => {
      state.mode = b.dataset.mode; $$('#mode-seg button').forEach((x) => x.classList.toggle('active', x === b)); renderChips();
    }));
    try {
      const saved = JSON.parse(localStorage.getItem('umbra.chat') || 'null');
      if (saved?.length) { messages = saved; saved.forEach((m) => addMsg(m.role, m.role === 'user' ? esc(m.content.replace(/^<context>[\s\S]*?<\/context>\n\n/, '')) : U.md.render(m.content))); }
    } catch {}
    renderEmpty();
  });

  bus.on('editor:active', renderChips);
  bus.on('settings', () => { renderChips(); if (!messages.length && !current) { $('#chat').innerHTML = ''; renderEmpty(); } persist(); });
  bus.on('ai:attach', (p) => { attached.add(p); renderChips(); U.showAI(); });
  bus.on('ai:focus', () => { U.showAI(); renderChips(); $('#prompt').focus(); });
  bus.on('ai:quick', ({ kind }) => {
    const sel = U.editor.selection();
    if (!sel) { toast('Select some code first.', 'warn'); return; }
    U.showAI();
    send({ explain: 'Explain the selected code step by step.', refactor: 'Refactor the selected code for readability and performance. Show the improved version.', tests: 'Write thorough unit tests for the selected code.' }[kind]);
  });
  setInterval(() => { if (document.activeElement?.closest?.('#editor')) renderChips(); }, 1200);

  return { send, reset, renderChips };
})();
