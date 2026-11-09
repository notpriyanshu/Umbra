// Quick open (Ctrl+P) + command palette (Ctrl+Shift+P, or type ">").
U.palette = (() => {
  const { $, el, esc, state } = U;
  let items = []; let sel = 0; let files = null; let filtered = [];

  const commands = () => [
    ['File: Open Folder…', 'Ctrl+O', () => U.explorer.openFolder()],
    ['File: New File…', '', () => U.explorer.create(false)],
    ['File: Save', 'Ctrl+S', () => U.editor.save()],
    ['File: Save All', 'Ctrl+Alt+S', () => U.editor.saveAll()],
    ['View: Toggle Sidebar', 'Ctrl+B', () => U.toggle('sidebar')],
    ['View: Toggle Panel', 'Ctrl+J', () => U.toggle('panel')],
    ['View: Toggle Agent Panel', 'Ctrl+Alt+B', () => U.toggle('ai')],
    ['View: Network Ledger', '', () => U.showPanel('ledger')],
    ['AI: New Chat Session', '', () => U.chat.reset()],
    ['AI: Edit Selection with AI', 'Ctrl+K', () => U.editor.openInlineEdit()],
    ['AI: Switch Model / Provider', '', () => U.pickModel()],
    ['AI: Configure Unsloth', '', () => U.settingsUI.open('unsloth')],
    ['AI: Manage API Keys', '', () => U.settingsUI.open('models')],
    ['Privacy: Settings', '', () => U.settingsUI.open('privacy')],
    ['Privacy: Toggle Local-only Mode', '', async () => {
      const v = !state.settings.privacy.localOnly;
      if (!v && !(await U.confirm('Allow cloud providers?', 'Prompts may be sent to third-party servers when a cloud provider is active.', 'Allow cloud'))) return;
      await U.settingsUI.patch({ privacy: { localOnly: v } });
      if (v && !state.presets[state.settings.activeProvider].local) await U.settingsUI.patch({ activeProvider: 'unsloth' }, true);
    }],
    ['Privacy: Clear Network Ledger', '', () => umbra.ledger.clear()],
    ['Preferences: Open Settings', 'Ctrl+,', () => U.settingsUI.open()],
    ['Terminal: Focus', 'Ctrl+`', () => { U.showPanel('terminal'); $('#term-input').focus(); }]
  ].map(([label, key, run]) => ({ label, key, run, kind: 'cmd' }));

  async function open(mode = 'files') {
    $('#palette').classList.remove('hidden');
    const inp = $('#palette-input');
    inp.value = mode === 'cmd' ? '>' : '';
    inp.placeholder = 'Search files by name — type > for commands';
    if (mode === 'files' && state.workspace) files = await umbra.fs.allFiles();
    inp.focus(); update();
  }
  function close() { $('#palette').classList.add('hidden'); }

  function score(text, q) {
    // simple fuzzy: all chars in order; bonus for contiguous & start
    let ti = 0, s = 0, last = -2; const hits = [];
    const t = text.toLowerCase();
    for (const ch of q.toLowerCase()) {
      const idx = t.indexOf(ch, ti); if (idx < 0) return null;
      s += idx === last + 1 ? 3 : 1; if (idx === 0 || /[\\/._\s-]/.test(t[idx - 1])) s += 2;
      hits.push(idx); last = idx; ti = idx + 1;
    }
    return { s: s - t.length * 0.01, hits };
  }
  const hl = (text, hits) => { const set = new Set(hits); return [...text].map((c, i) => (set.has(i) ? `<mark>${esc(c)}</mark>` : esc(c))).join(''); };

  function update() {
    const v = $('#palette-input').value;
    const isCmd = v.startsWith('>');
    const q = (isCmd ? v.slice(1) : v).trim();
    let src;
    if (isCmd) src = commands();
    else if (!state.workspace) src = [{ label: 'Open a folder to search files…', kind: 'cmd', run: () => U.explorer.openFolder() }, ...commands()];
    else src = (files || []).map((f) => ({ label: U.basename(f.path), desc: f.rel, path: f.path, kind: 'file' }));
    filtered = (q ? src.map((it) => ({ it, r: score(it.kind === 'file' ? it.label : it.label, q) || (it.desc && score(it.desc, q)) }))
      .filter((x) => x.r).sort((a, b) => b.r.s - a.r.s).slice(0, 80) : src.slice(0, 80).map((it) => ({ it, r: { hits: [] } })));
    sel = 0; render();
  }
  function render() {
    const list = $('#palette-list'); list.innerHTML = '';
    if (!filtered.length) { list.innerHTML = '<div class="pgroup">NO RESULTS</div>'; return; }
    filtered.forEach(({ it, r }, i) => {
      const [, label, color] = U.fileMeta(it.label);
      list.append(el('div', { class: `pitem ${i === sel ? 'sel' : ''}`, onmousemove: () => { if (sel !== i) { sel = i; render(); } }, onclick: () => choose(i),
        html: (it.kind === 'file' ? `<span class="ficon" style="color:${color};font:700 9px var(--mono);width:22px">${esc(label)}</span>` : '<span class="spark" style="width:22px;text-align:center">›</span>') +
          `<span class="pl">${hl(it.label, r.hits || [])}</span>${it.desc ? `<span class="pd">${esc(it.desc)}</span>` : ''}${it.key ? `<kbd>${esc(it.key)}</kbd>` : ''}` }));
    });
    list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }
  function choose(i) {
    const x = filtered[i]; if (!x) return;
    close();
    if (x.it.kind === 'file') U.editor.open(x.it.path); else x.it.run();
  }
  document.addEventListener('DOMContentLoaded', () => {
    const inp = $('#palette-input');
    inp.addEventListener('input', update);
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { sel = Math.min(filtered.length - 1, sel + 1); render(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); render(); e.preventDefault(); }
      else if (e.key === 'Enter') { choose(sel); e.preventDefault(); }
      else if (e.key === 'Escape') { close(); e.preventDefault(); }
    });
    $('#palette').addEventListener('mousedown', (e) => { if (e.target.id === 'palette') close(); });
  });
  return { open, close, commands };
})();
