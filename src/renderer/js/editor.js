// Monaco editor host: tabs, models, save, inline AI edit (Ctrl+K).
U.editor = (() => {
  const { $, el, esc, fileMeta, basename, bus, toast, state } = U;
  const VS = '../../node_modules/monaco-editor/min/vs';
  let monaco, ed;
  const tabs = []; // { path, model, viewState, dirty, savedVersion }
  let activePath = null;

  window.MonacoEnvironment = { getWorkerUrl: () => `${VS}/base/worker/workerMain.js` };

  const ready = new Promise((resolve) => {
    window.require.config({ paths: { vs: VS } });
    window.require(['vs/editor/editor.main'], () => {
      monaco = window.monaco;
      defineTheme();
      const s = state.settings?.editor || {};
      ed = monaco.editor.create($('#editor'), {
        theme: 'umbra-dark', automaticLayout: true, fontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, monospace',
        fontSize: s.fontSize || 14, fontLigatures: s.fontLigatures !== false, minimap: { enabled: s.minimap !== false, renderCharacters: false, scale: 1 },
        wordWrap: s.wordWrap || 'off', smoothScrolling: true, cursorSmoothCaretAnimation: 'on', cursorBlinking: 'smooth',
        renderLineHighlight: 'all', bracketPairColorization: { enabled: true }, guides: { bracketPairs: 'active', indentation: true },
        padding: { top: 10 }, scrollBeyondLastLine: false, stickyScroll: { enabled: true }, model: null,
        'semanticHighlighting.enabled': true, roundedSelection: true, lineNumbersMinChars: 4
      });
      ed.onDidChangeCursorPosition((e) => { $('#st-pos').textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`; });
      ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => save());
      ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => openInlineEdit());
      ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyL, () => bus.emit('ai:focus', { withSelection: true }));
      ed.addAction({ id: 'umbra.explain', label: 'Umbra: Explain Selection', contextMenuGroupId: '0_umbra', contextMenuOrder: 1,
        run: () => bus.emit('ai:quick', { kind: 'explain' }) });
      ed.addAction({ id: 'umbra.refactor', label: 'Umbra: Refactor Selection', contextMenuGroupId: '0_umbra', contextMenuOrder: 2,
        run: () => bus.emit('ai:quick', { kind: 'refactor' }) });
      ed.addAction({ id: 'umbra.tests', label: 'Umbra: Write Tests for Selection', contextMenuGroupId: '0_umbra', contextMenuOrder: 3,
        run: () => bus.emit('ai:quick', { kind: 'tests' }) });
      ed.addAction({ id: 'umbra.inline', label: 'Umbra: Edit with AI…', contextMenuGroupId: '0_umbra', contextMenuOrder: 0,
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK], run: () => openInlineEdit() });
      resolve();
    });
  });

  function defineTheme() {
    monaco.editor.defineTheme('umbra-dark', {
      base: 'vs-dark', inherit: true,
      rules: [
        { token: '', foreground: 'd5dbea' },
        { token: 'comment', foreground: '5c6582', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'c084fc' },
        { token: 'keyword.control', foreground: 'c084fc' },
        { token: 'string', foreground: '86efac' },
        { token: 'string.escape', foreground: '5eead4' },
        { token: 'number', foreground: 'fbbf24' },
        { token: 'regexp', foreground: 'f472b6' },
        { token: 'type', foreground: '67e8f9' },
        { token: 'type.identifier', foreground: '67e8f9' },
        { token: 'identifier', foreground: 'd5dbea' },
        { token: 'delimiter', foreground: '8b93ad' },
        { token: 'tag', foreground: 'f472b6' },
        { token: 'attribute.name', foreground: 'fbbf24' },
        { token: 'attribute.value', foreground: '86efac' },
        { token: 'variable', foreground: 'e2e8f0' },
        { token: 'variable.predefined', foreground: '7dd3fc' },
        { token: 'constant', foreground: 'fb923c' },
        { token: 'key', foreground: '93c5fd' },
        { token: 'string.key.json', foreground: '93c5fd' },
        { token: 'string.value.json', foreground: '86efac' },
        { token: 'metatag', foreground: 'f472b6' },
        { token: 'annotation', foreground: 'fbbf24' }
      ],
      colors: {
        'editor.background': '#08090d',
        'editor.foreground': '#d5dbea',
        'editorLineNumber.foreground': '#3a4058',
        'editorLineNumber.activeForeground': '#a5b4fc',
        'editor.lineHighlightBackground': '#11131c',
        'editor.lineHighlightBorder': '#00000000',
        'editor.selectionBackground': '#8b5cf640',
        'editor.inactiveSelectionBackground': '#8b5cf622',
        'editor.selectionHighlightBackground': '#22d3ee1a',
        'editor.wordHighlightBackground': '#22d3ee1a',
        'editorCursor.foreground': '#22d3ee',
        'editorIndentGuide.background1': '#1a1e2b',
        'editorIndentGuide.activeBackground1': '#3a4160',
        'editorWhitespace.foreground': '#232838',
        'editorBracketMatch.background': '#8b5cf622',
        'editorBracketMatch.border': '#8b5cf680',
        'editorGutter.background': '#08090d',
        'editorWidget.background': '#101219',
        'editorWidget.border': '#272c3e',
        'editorSuggestWidget.background': '#101219',
        'editorSuggestWidget.border': '#272c3e',
        'editorSuggestWidget.selectedBackground': '#8b5cf62e',
        'editorHoverWidget.background': '#101219',
        'editorHoverWidget.border': '#272c3e',
        'minimap.background': '#08090d',
        'minimapSlider.background': '#8b5cf61a',
        'scrollbarSlider.background': '#23283899',
        'scrollbarSlider.hoverBackground': '#313852',
        'editorStickyScroll.background': '#0c0d13',
        'editorStickyScrollHover.background': '#151823',
        'menu.background': '#101219',
        'menu.foreground': '#d5dbea',
        'menu.selectionBackground': '#8b5cf62e',
        'menu.border': '#272c3e',
        'input.background': '#08090d',
        'focusBorder': '#8b5cf6'
      }
    });
  }

  function langFor(p) { return fileMeta(basename(p))[0]; }

  async function open(path, { line } = {}) {
    await ready;
    let t = tabs.find((x) => x.path === path);
    if (!t) {
      let res;
      try { res = await umbra.fs.readFile(path); } catch (e) { toast(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'bad'); return; }
      if (res.binary) { toast(`${basename(path)} is a binary file and can't be shown.`, 'warn'); return; }
      const uri = monaco.Uri.file(path);
      const model = monaco.editor.getModel(uri) || monaco.editor.createModel(res.content, langFor(path), uri);
      t = { path, model, viewState: null, savedVersion: model.getAlternativeVersionId(), dirty: false };
      model.onDidChangeContent(() => {
        const d = model.getAlternativeVersionId() !== t.savedVersion;
        if (d !== t.dirty) { t.dirty = d; renderTabs(); bus.emit('editor:dirty', { path, dirty: d }); }
      });
      tabs.push(t);
    }
    activate(path);
    if (line) { ed.revealLineInCenter(line); ed.setPosition({ lineNumber: line, column: 1 }); }
    ed.focus();
  }

  function activate(path) {
    const cur = tabs.find((x) => x.path === activePath);
    if (cur) cur.viewState = ed.saveViewState();
    const t = tabs.find((x) => x.path === path);
    activePath = t ? path : null;
    ed.setModel(t ? t.model : null);
    if (t?.viewState) ed.restoreViewState(t.viewState);
    $('#welcome').classList.toggle('hidden', !!t);
    renderTabs(); renderCrumbs();
    $('#st-lang').textContent = t ? langFor(path) : '';
    $('#st-pos').textContent = t ? 'Ln 1, Col 1' : '';
    $('#tb-title').textContent = t ? `${basename(path)} — ${state.workspace?.name || 'Umbra Studio'}` : (state.workspace?.name || 'Umbra Studio');
    bus.emit('editor:active', t ? path : null);
  }

  async function close(path) {
    const t = tabs.find((x) => x.path === path);
    if (!t) return;
    if (t.dirty) {
      const r = await U.modal({ title: `Save changes to ${basename(path)}?`, body: 'Your changes will be lost if you don\'t save them.',
        buttons: [{ label: 'Cancel', value: 'cancel' }, { label: "Don't Save", value: 'discard' }, { label: 'Save', value: 'save', primary: true }] });
      if (!r || r === 'cancel') return;
      if (r === 'save') await save(path);
    }
    const idx = tabs.indexOf(t);
    tabs.splice(idx, 1);
    t.model.dispose();
    if (activePath === path) activate(tabs[Math.min(idx, tabs.length - 1)]?.path || null);
    else renderTabs();
  }

  async function save(path = activePath) {
    const t = tabs.find((x) => x.path === path);
    if (!t) return;
    try {
      await umbra.fs.writeFile(t.path, t.model.getValue());
      t.savedVersion = t.model.getAlternativeVersionId(); t.dirty = false; renderTabs();
      bus.emit('editor:dirty', { path, dirty: false });
    } catch (e) { toast('Save failed: ' + e.message, 'bad'); }
  }
  const saveAll = async () => { for (const t of tabs.filter((x) => x.dirty)) await save(t.path); };

  function renderTabs() {
    const box = $('#tabs'); box.innerHTML = '';
    for (const t of tabs) {
      const [, label, color] = fileMeta(basename(t.path));
      const tab = el('div', { class: `tab ${t.path === activePath ? 'active' : ''} ${t.dirty ? 'dirty' : ''}`, title: t.path,
        onclick: () => activate(t.path), onauxclick: (e) => { if (e.button === 1) close(t.path); } },
      el('span', { class: 'ficon', style: `color:${color};font:700 9px var(--mono)` }, label),
      el('span', { class: 'tname' }, basename(t.path)),
      el('span', { class: 'tclose', onclick: (e) => { e.stopPropagation(); close(t.path); },
        html: '<svg viewBox="0 0 24 24"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>' }));
      box.append(tab);
      if (t.path === activePath) setTimeout(() => tab.scrollIntoView({ block: 'nearest', inline: 'nearest' }), 0);
    }
  }
  function renderCrumbs() {
    const c = $('#breadcrumbs');
    if (!activePath) { c.innerHTML = ''; c.style.display = 'none'; return; }
    c.style.display = '';
    const root = state.workspace?.root || '';
    const rel = activePath.startsWith(root) ? activePath.slice(root.length).replace(/^[\\/]/, '') : activePath;
    const parts = [state.workspace?.name, ...rel.split(/[\\/]/)].filter(Boolean);
    c.innerHTML = parts.map((p, i) => `<span class="${i === parts.length - 1 ? 'last' : ''}">${esc(p)}</span>`).join('<span class="sep">›</span>');
  }

  // --------------------- inline edit (Ctrl+K)
  let ieBusy = false;
  function openInlineEdit() {
    if (!activePath) return;
    const sel = ed.getSelection();
    if (sel.isEmpty()) {
      const ln = sel.startLineNumber;
      ed.setSelection(new monaco.Selection(ln, 1, ln, ed.getModel().getLineMaxColumn(ln)));
    }
    const box = $('#inline-edit');
    box.classList.remove('hidden');
    $('#ie-status').textContent = `${providerLabel()} · selection: ${ed.getModel().getValueInRange(ed.getSelection()).split('\n').length} line(s) · Enter to apply`;
    const inp = $('#ie-input'); inp.value = ''; inp.focus();
  }
  function providerLabel() { const s = state.settings; return s ? `${state.presets[s.activeProvider]?.label} · ${s.providers[s.activeProvider]?.model || 'default'}` : ''; }
  function closeInlineEdit() { $('#inline-edit').classList.add('hidden'); ed?.focus(); }
  async function runInlineEdit(instruction) {
    if (ieBusy || !instruction.trim()) return;
    ieBusy = true;
    const model = ed.getModel(); const range = ed.getSelection();
    const code = model.getValueInRange(range);
    const lang = langFor(activePath);
    $('#ie-status').innerHTML = '<span class="spark">✦</span> Generating…';
    try {
      const before = model.getValueInRange({ startLineNumber: Math.max(1, range.startLineNumber - 30), startColumn: 1, endLineNumber: range.startLineNumber, endColumn: 1 });
      const after = model.getValueInRange({ startLineNumber: range.endLineNumber + 1, startColumn: 1, endLineNumber: Math.min(model.getLineCount(), range.endLineNumber + 30), endColumn: 1 });
      let out = await umbra.llm.complete([{ role: 'user', content:
        `Rewrite the SELECTED ${lang} code according to the instruction. Respond with ONLY the replacement code in a single fenced code block, nothing else.\n\n` +
        `Instruction: ${instruction}\n\nContext before:\n\`\`\`${lang}\n${before}\n\`\`\`\n\nSELECTED:\n\`\`\`${lang}\n${code}\n\`\`\`\n\nContext after:\n\`\`\`${lang}\n${after}\n\`\`\`` }]);
      const m = out.match(/```[^\n]*\n([\s\S]*?)```/);
      if (m) out = m[1].replace(/\n$/, '');
      ed.pushUndoStop();
      ed.executeEdits('umbra-inline', [{ range, text: out, forceMoveMarkers: true }]);
      ed.pushUndoStop();
      closeInlineEdit();
      toast('Applied AI edit — Ctrl+Z to undo', 'ok');
    } catch (e) {
      $('#ie-status').innerHTML = `<span style="color:var(--bad)">${esc(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))}</span>`;
    } finally { ieBusy = false; }
  }
  document.addEventListener('DOMContentLoaded', () => {
    $('#ie-input').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeInlineEdit(); }
      if (e.key === 'Enter') { e.preventDefault(); runInlineEdit(e.target.value); }
    });
  });

  return {
    ready, open, close, save, saveAll, activate,
    get monaco() { return monaco; }, get instance() { return ed; },
    activePath: () => activePath,
    tabs: () => tabs,
    activeContent: () => tabs.find((t) => t.path === activePath)?.model.getValue() ?? null,
    selection: () => { if (!ed || !activePath) return ''; return ed.getModel().getValueInRange(ed.getSelection()); },
    language: () => (activePath ? langFor(activePath) : ''),
    insert(text) {
      if (!activePath) { toast('Open a file first.', 'warn'); return; }
      ed.pushUndoStop(); ed.executeEdits('umbra', [{ range: ed.getSelection(), text, forceMoveMarkers: true }]); ed.pushUndoStop(); ed.focus();
    },
    replaceAll(text) {
      if (!activePath) { toast('Open a file first.', 'warn'); return; }
      const m = ed.getModel(); ed.pushUndoStop();
      ed.executeEdits('umbra', [{ range: m.getFullModelRange(), text }]); ed.pushUndoStop(); ed.focus();
    },
    async reloadIfOpen(path) {
      const t = tabs.find((x) => x.path === path);
      if (!t || t.dirty) return;
      const r = await umbra.fs.readFile(path);
      if (!r.binary && r.content !== t.model.getValue()) { t.model.setValue(r.content); t.savedVersion = t.model.getAlternativeVersionId(); t.dirty = false; renderTabs(); }
    },
    renamePath(from, to) {
      const t = tabs.find((x) => x.path === from); if (!t) return;
      const content = t.model.getValue(); t.model.dispose();
      t.model = monaco.editor.createModel(content, langFor(to), monaco.Uri.file(to)); t.path = to;
      if (activePath === from) { activePath = null; activate(to); } else renderTabs();
    },
    applyOptions(o) { ed?.updateOptions(o); },
    openInlineEdit
  };
})();
