// App shell: layout, menus, keybindings, welcome screen, model status.
(() => {
  const { $, $$, el, esc, bus, toast, state } = U;

  // ---------------------------------------------------------------- layout helpers
  U.toggle = (part, force) => {
    const n = { sidebar: '#sidebar', panel: '#panel', ai: '#ai' }[part];
    const node = $(n); const hide = force === undefined ? !node.classList.contains('collapsed') : !force;
    node.classList.toggle('collapsed', hide);
    if (part === 'sidebar') $('[data-resize="sidebar"]').classList.toggle('hidden', hide);
    if (part === 'ai') $('[data-resize="ai"]').classList.toggle('hidden', hide);
    if (part === 'panel') $('[data-resize="panel"]').classList.toggle('hidden', hide);
    saveLayout();
  };
  U.showPanel = (tab) => {
    U.toggle('panel', true);
    $$('.ptab').forEach((b) => b.classList.toggle('active', b.dataset.ptab === tab));
    $$('.panel-body').forEach((b) => b.classList.toggle('hidden', b.dataset.pbody !== tab));
  };
  U.showAI = () => U.toggle('ai', true);

  function showView(view) {
    if (view === 'agent') { U.showAI(); $('#prompt').focus(); return; }
    const cur = $('.act.active')?.dataset.view;
    if (cur === view && !$('#sidebar').classList.contains('collapsed')) { U.toggle('sidebar', false); return; }
    U.toggle('sidebar', true);
    $$('.act[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    $$('.sb-view').forEach((v) => v.classList.toggle('hidden', v.dataset.view !== view));
    if (view === 'search') $('#search-input').focus();
  }

  // ---------------------------------------------------------------- menus
  U.showMenu = (x, y, items) => {
    const pop = $('#menu-pop'); pop.innerHTML = '';
    for (const it of items) {
      if (it === '-') { pop.append(el('hr')); continue; }
      const [label, run, key] = it;
      pop.append(el('button', { onclick: () => { hideMenu(); run(); } }, el('span', {}, label), key ? el('kbd', {}, key) : null));
    }
    pop.classList.remove('hidden');
    const r = pop.getBoundingClientRect();
    pop.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
    pop.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
  };
  const hideMenu = () => { $('#menu-pop').classList.add('hidden'); $$('.menus button').forEach((b) => b.classList.remove('open')); };
  document.addEventListener('mousedown', (e) => { if (!e.target.closest('#menu-pop') && !e.target.closest('.menus')) hideMenu(); });

  const MENUS = {
    file: () => [['Open Folder…', () => U.explorer.openFolder(), 'Ctrl+O'], ['New File…', () => U.explorer.create(false)], ['New Folder…', () => U.explorer.create(true)], '-',
      ['Save', () => U.editor.save(), 'Ctrl+S'], ['Save All', () => U.editor.saveAll(), 'Ctrl+Alt+S'], '-',
      ['Close Editor', () => U.editor.activePath() && U.editor.close(U.editor.activePath()), 'Ctrl+W'],
      ['Close Folder', async () => { await umbra.fs.closeFolder(); U.explorer.setWorkspace(null); }], '-',
      ['Settings', () => U.settingsUI.open(), 'Ctrl+,'], '-', ['Exit', () => umbra.win.close()]],
    edit: () => [['Undo', () => trig('undo'), 'Ctrl+Z'], ['Redo', () => trig('redo'), 'Ctrl+Y'], '-',
      ['Find', () => act('actions.find'), 'Ctrl+F'], ['Replace', () => act('editor.action.startFindReplaceAction'), 'Ctrl+H'], ['Find in Files', () => showView('search'), 'Ctrl+Shift+F'], '-',
      ['Format Document', () => act('editor.action.formatDocument'), 'Shift+Alt+F'], ['Toggle Line Comment', () => act('editor.action.commentLine'), 'Ctrl+/']],
    view: () => [['Command Palette…', () => U.palette.open('cmd'), 'Ctrl+Shift+P'], ['Go to File…', () => U.palette.open('files'), 'Ctrl+P'], '-',
      ['Explorer', () => showView('explorer'), 'Ctrl+Shift+E'], ['Search', () => showView('search'), 'Ctrl+Shift+F'], ['Privacy Shield', () => showView('shield')], '-',
      ['Toggle Sidebar', () => U.toggle('sidebar'), 'Ctrl+B'], ['Toggle Panel', () => U.toggle('panel'), 'Ctrl+J'], ['Toggle Agent Panel', () => U.toggle('ai'), 'Ctrl+Alt+B'], '-',
      ['Terminal', () => U.showPanel('terminal'), 'Ctrl+`'], ['Network Ledger', () => U.showPanel('ledger')]],
    ai: () => [['Ask Agent', () => bus.emit('ai:focus'), 'Ctrl+L'], ['Edit Selection with AI', () => U.editor.openInlineEdit(), 'Ctrl+K'], ['New Chat Session', () => U.chat.reset()], '-',
      ['Switch Model…', () => U.pickModel()], ['Models & API Keys…', () => U.settingsUI.open('models')], ['Unsloth Agents…', () => U.settingsUI.open('unsloth')], ['Coding Agent Settings…', () => U.settingsUI.open('agent')]],
    help: () => [['Keyboard Shortcuts', () => U.settingsUI.open('about')], ['Privacy Guarantees', () => U.settingsUI.open('privacy')], ['About Umbra Studio', () => U.settingsUI.open('about')]]
  };
  const trig = (what) => U.editor.instance?.trigger('menu', what, null);
  const act = (id) => U.editor.instance?.getAction(id)?.run();

  // ---------------------------------------------------------------- model status
  U.setModelStatus = (st) => {
    const s = state.settings; if (!s) return;
    const local = state.presets[s.activeProvider]?.local;
    $('#model-dot').className = `dot ${st === 'bad' ? 'bad' : st === 'ok' ? (local ? 'ok' : 'cloud') : ''}`;
  };
  U.checkModel = async () => {
    try { await umbra.llm.test(); U.setModelStatus('ok'); } catch { U.setModelStatus('bad'); }
  };
  U.pickModel = () => {
    const r = $('#model-picker').getBoundingClientRect();
    const s = state.settings;
    const items = Object.entries(state.presets).filter(([, p]) => p.local || !s.privacy.localOnly).map(([id, p]) =>
      [`${s.activeProvider === id ? '● ' : '   '}${p.label}${s.providers[id]?.model ? ' · ' + s.providers[id].model : ''}${p.local ? '' : '  ☁'}`,
        async () => { await U.settingsUI.patch({ activeProvider: id }, true); U.checkModel(); }]);
    items.push('-', ['Manage models & keys…', () => U.settingsUI.open('models')]);
    U.showMenu(r.left, r.bottom + 4, items);
  };

  function applySettings() {
    const s = state.settings; if (!s) return;
    const p = state.presets[s.activeProvider];
    $('#model-label').textContent = `${p?.label}${s.providers[s.activeProvider]?.model ? ' · ' + s.providers[s.activeProvider].model : ''}`;
    $('#st-model').textContent = `✦ ${p?.label}`;
    const lo = s.privacy.localOnly;
    $('#privacy-pill').classList.toggle('cloud', !lo);
    $('#privacy-label').textContent = lo ? 'LOCAL-ONLY' : (p?.local ? 'HYBRID · LOCAL MODEL' : 'CLOUD MODEL');
    $('#st-shield').classList.toggle('cloud', !lo);
    $('#st-shield-text').textContent = lo ? 'Private · Local-only' : 'Hybrid';
    renderWelcome();
  }
  bus.on('settings', applySettings);

  // ---------------------------------------------------------------- welcome
  function renderWelcome() {
    const s = state.settings;
    const ic = (d) => `<span class="wi"><svg viewBox="0 0 24 24"><path d="${d}"/></svg></span>`;
    $('#welcome').innerHTML = `<div class="welcome-inner">
      <div class="hero">
        <svg class="hero-logo" viewBox="0 0 32 32"><defs><linearGradient id="lg3" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs><path d="M16 2 4 8v8c0 7 5.2 12.4 12 14 6.8-1.6 12-7 12-14V8L16 2z" fill="url(#lg3)"/><path d="M16 9a7 7 0 1 0 0 14 5.2 5.2 0 0 1 0-14z" fill="#08090d"/></svg>
        <div><h1>Umbra Studio</h1><p>The private AI code editor. Your models, your keys, your machine.</p></div>
      </div>
      <div class="badges">
        <span class="badge"><i></i>Zero telemetry</span>
        <span class="badge"><i></i>${s?.privacy.localOnly ? 'Local-only mode on' : 'Hybrid mode'}</span>
        <span class="badge"><i></i>Keys sealed in OS keychain</span>
        <span class="badge"><i></i>Sandboxed agent</span>
        <span class="badge"><i></i>Unsloth · Ollama · LM Studio · llama.cpp · vLLM</span>
      </div>
      <div class="wgrid">
        <div class="wcol"><h3>START</h3>
          <button class="wlink" data-w="open">${ic('M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z')}Open Folder…<kbd>Ctrl O</kbd></button>
          <button class="wlink" data-w="palette">${ic('M10.5 3a7.5 7.5 0 0 1 5.96 12.05l4.25 4.24-1.42 1.42-4.24-4.25A7.5 7.5 0 1 1 10.5 3z')}Go to File…<kbd>Ctrl P</kbd></button>
          <button class="wlink" data-w="cmd">${ic('M4 6h16v2H4zm0 5h16v2H4zm0 5h10v2H4z')}Command Palette<kbd>Ctrl Shift P</kbd></button>
          <button class="wlink" data-w="ai">${ic('M12 2l2.4 5.6L20 10l-5.6 2.4L12 18l-2.4-5.6L4 10l5.6-2.4z')}Ask the Agent<kbd>Ctrl L</kbd></button>
        </div>
        <div class="wcol"><h3>CONNECT A MODEL</h3>
          <button class="wlink" data-w="unsloth">${ic('M12 2l2.4 5.6L20 10l-5.6 2.4L12 18l-2.4-5.6L4 10l5.6-2.4z')}Connect Unsloth Studio<kbd>:8888</kbd></button>
          <button class="wlink" data-w="models">${ic('M7 14a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm5.6-4A6 6 0 1 0 12.6 14H17v4h4v-4h2v-4H12.6z')}Add API keys</button>
          <button class="wlink" data-w="agent">${ic('M20 19V7H4v12h16M9.6 13 5.6 9h2.8l4 4-4 4H5.6l4-4z')}Configure coding agent</button>
          <button class="wlink" data-w="privacy">${ic('M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3z')}Review privacy controls</button>
        </div>
      </div>
      <div class="cards">
        <div class="card"><h4><span class="ci"><svg viewBox="0 0 24 24"><path d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3z"/></svg></span>Sealed by design</h4><p>The UI process has no network. Model calls go through a single audited gateway you can watch live.</p></div>
        <div class="card"><h4><span class="ci"><svg viewBox="0 0 24 24"><path d="M12 2l2.4 5.6L20 10l-5.6 2.4L12 18l-2.4-5.6L4 10l5.6-2.4z"/></svg></span>Agents that ask</h4><p>The agent reads, edits and runs code inside your workspace — and asks before it changes anything.</p></div>
        <div class="card"><h4><span class="ci"><svg viewBox="0 0 24 24"><path d="M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6zm5.2 0 4.6-4.6-4.6-4.6L16 6l6 6-6 6z"/></svg></span>Edit at the speed of thought</h4><p>Select code and press Ctrl+K to rewrite it in place with your local model.</p></div>
      </div></div>`;
    $$('#welcome [data-w]').forEach((b) => (b.onclick = () => ({
      open: () => U.explorer.openFolder(), palette: () => U.palette.open('files'), cmd: () => U.palette.open('cmd'), ai: () => bus.emit('ai:focus'),
      unsloth: () => U.settingsUI.open('unsloth'), models: () => U.settingsUI.open('models'), agent: () => U.settingsUI.open('agent'), privacy: () => U.settingsUI.open('privacy')
    })[b.dataset.w]()));
  }

  // ---------------------------------------------------------------- resizers
  function initResizers() {
    const root = document.documentElement;
    $$('.resizer').forEach((r) => r.addEventListener('mousedown', (e) => {
      e.preventDefault(); r.classList.add('dragging');
      const kind = r.dataset.resize; const sx = e.clientX; const sy = e.clientY;
      const start = { sidebar: $('#sidebar').offsetWidth, ai: $('#ai').offsetWidth, panel: $('#panel').offsetHeight }[kind];
      document.body.style.cursor = kind === 'panel' ? 'row-resize' : 'col-resize';
      const move = (ev) => {
        if (kind === 'sidebar') root.style.setProperty('--sidebar-w', Math.max(170, Math.min(600, start + ev.clientX - sx)) + 'px');
        if (kind === 'ai') root.style.setProperty('--ai-w', Math.max(300, Math.min(900, start - (ev.clientX - sx))) + 'px');
        if (kind === 'panel') root.style.setProperty('--panel-h', Math.max(80, Math.min(innerHeight - 200, start - (ev.clientY - sy))) + 'px');
      };
      const up = () => { r.classList.remove('dragging'); document.body.style.cursor = ''; removeEventListener('mousemove', move); removeEventListener('mouseup', up); saveLayout(); };
      addEventListener('mousemove', move); addEventListener('mouseup', up);
    }));
  }
  function saveLayout() {
    try {
      const cs = document.documentElement.style;
      localStorage.setItem('umbra.layout', JSON.stringify({ sw: cs.getPropertyValue('--sidebar-w'), aw: cs.getPropertyValue('--ai-w'), ph: cs.getPropertyValue('--panel-h'),
        sb: $('#sidebar').classList.contains('collapsed'), pn: $('#panel').classList.contains('collapsed'), ai: $('#ai').classList.contains('collapsed') }));
    } catch {}
  }
  function restoreLayout() {
    try {
      const l = JSON.parse(localStorage.getItem('umbra.layout') || 'null'); if (!l) return;
      const cs = document.documentElement.style;
      if (l.sw) cs.setProperty('--sidebar-w', l.sw); if (l.aw) cs.setProperty('--ai-w', l.aw); if (l.ph) cs.setProperty('--panel-h', l.ph);
      if (l.sb) U.toggle('sidebar', false); if (l.pn) U.toggle('panel', false); if (l.ai) U.toggle('ai', false);
    } catch {}
  }

  // ---------------------------------------------------------------- keys
  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase(); const c = e.ctrlKey || e.metaKey;
    if (!c) return;
    const go = (fn) => { e.preventDefault(); e.stopPropagation(); fn(); };
    if (e.shiftKey && k === 'p') go(() => U.palette.open('cmd'));
    else if (!e.shiftKey && k === 'p') go(() => U.palette.open('files'));
    else if (e.shiftKey && k === 'e') go(() => showView('explorer'));
    else if (e.shiftKey && k === 'f') go(() => showView('search'));
    else if (e.altKey && k === 'b') go(() => U.toggle('ai'));
    else if (k === 'b') go(() => U.toggle('sidebar'));
    else if (k === 'j' || k === '`') go(() => U.toggle('panel'));
    else if (k === ',') go(() => U.settingsUI.open());
    else if (k === 'o') go(() => U.explorer.openFolder());
    else if (k === 'w' && U.editor.activePath()) go(() => U.editor.close(U.editor.activePath()));
    else if (e.altKey && k === 's') go(() => U.editor.saveAll());
    else if (k === 'l' && !e.target.closest('#editor')) go(() => bus.emit('ai:focus'));
    else if (k === 's' && !e.target.closest('#editor')) go(() => U.editor.save());
  }, true);

  // ---------------------------------------------------------------- boot
  document.addEventListener('DOMContentLoaded', async () => {
    $('#w-min').onclick = () => umbra.win.minimize();
    $('#w-max').onclick = () => umbra.win.maximize();
    $('#w-close').onclick = () => umbra.win.close();
    $('#tb-search').onclick = () => U.palette.open('files');
    $('#privacy-pill').onclick = () => { showView('shield'); U.showPanel('ledger'); };
    $('#st-shield').onclick = () => U.settingsUI.open('privacy');
    $('#act-settings').onclick = () => U.settingsUI.open();
    $('#model-picker').onclick = () => U.pickModel();
    $('#ai-close').onclick = () => U.toggle('ai', false);
    $('#panel-close').onclick = () => U.toggle('panel', false);
    $$('.act[data-view]').forEach((b) => (b.onclick = () => showView(b.dataset.view)));
    $$('.ptab').forEach((b) => (b.onclick = () => U.showPanel(b.dataset.ptab)));
    $$('.menus button').forEach((b) => (b.onclick = () => {
      const open = b.classList.contains('open'); hideMenu(); if (open) return;
      b.classList.add('open'); const r = b.getBoundingClientRect(); U.showMenu(r.left, r.bottom + 4, MENUS[b.dataset.menu]()); b.classList.add('open');
    }));
    $$('.menus button').forEach((b) => b.addEventListener('mouseenter', () => { if ($('.menus button.open') && !b.classList.contains('open')) b.click(); }));

    initResizers(); restoreLayout();
    state.appInfo = await umbra.app.info();
    await U.settingsUI.load();
    U.explorer.setWorkspace(await umbra.fs.restore());
    await U.editor.ready;
    U.chat.renderChips();
    U.checkModel();
    if (!state.appInfo.encryption) toast('OS keychain encryption is unavailable — API keys cannot be saved securely on this system.', 'warn', 8000);
  });
})();
