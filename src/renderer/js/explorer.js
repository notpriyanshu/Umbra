// File explorer + workspace search.
U.explorer = (() => {
  const { $, el, esc, fileMeta, basename, dirname, join, bus, toast, state, ask, confirm } = U;
  const expanded = new Set();
  let tree = [];
  let selected = null;
  const CHEV = '<svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6z"/></svg>';
  const FOLDER = (open) => `<svg viewBox="0 0 24 24" width="16" height="16" style="color:${open ? '#a78bfa' : '#8b93ad'}"><path d="${open ? 'M20 6h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2zm0 12H4V8h16v10z' : 'M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z'}"/></svg>`;

  function setWorkspace(ws) {
    state.workspace = ws;
    tree = ws ? ws.tree : [];
    expanded.clear();
    $('#no-folder').classList.toggle('hidden', !!ws);
    $('#ws-name').textContent = ws ? ws.name : '';
    $('#st-ws').textContent = ws ? `⌂ ${ws.name}` : 'No folder';
    render();
    bus.emit('workspace', ws);
  }

  async function openFolder() {
    const ws = await umbra.fs.openFolder();
    if (ws) setWorkspace(ws);
  }

  async function refresh() {
    if (!state.workspace) return;
    const fresh = await umbra.fs.tree();
    // re-load expanded dirs deeper than first level
    const fill = async (nodes) => {
      for (const n of nodes) if (n.type === 'dir' && expanded.has(n.path)) {
        if (!n.children) n.children = await umbra.fs.readDir(n.path);
        await fill(n.children);
      }
    };
    await fill(fresh);
    tree = fresh; render();
  }

  function render() {
    const box = $('#tree'); box.innerHTML = '';
    const walk = (nodes, depth) => {
      for (const n of nodes) {
        const isDir = n.type === 'dir';
        const open = expanded.has(n.path);
        const [, label, color] = fileMeta(n.name);
        const row = el('div', { class: `node ${selected === n.path ? 'active' : ''}`, style: `padding-left:${10 + depth * 14}px`, title: n.path, 'data-path': n.path,
          onclick: () => click(n), oncontextmenu: (e) => { e.preventDefault(); selected = n.path; render(); ctxMenu(e, n); } });
        row.innerHTML = isDir
          ? `${CHEV.replace('class="chev"', `class="chev ${open ? 'open' : ''}"`)}${FOLDER(open)}<span class="name">${esc(n.name)}</span>`
          : `<span style="width:14px"></span><span class="ficon" style="color:${color}">${esc(label)}</span><span class="name">${esc(n.name)}</span>`;
        box.append(row);
        if (isDir && open && n.children) walk(n.children, depth + 1);
      }
    };
    walk(tree, 0);
  }

  async function click(n) {
    selected = n.path;
    if (n.type === 'dir') {
      if (expanded.has(n.path)) expanded.delete(n.path);
      else { expanded.add(n.path); if (!n.children) n.children = await umbra.fs.readDir(n.path); }
      render();
    } else { render(); U.editor.open(n.path); }
  }

  function targetDir() {
    if (!state.workspace) return null;
    if (!selected) return state.workspace.root;
    const find = (nodes) => { for (const n of nodes) { if (n.path === selected) return n; const c = n.children && find(n.children); if (c) return c; } };
    const n = find(tree);
    return n ? (n.type === 'dir' ? n.path : dirname(n.path)) : state.workspace.root;
  }
  async function create(isDir, base = targetDir()) {
    if (!base) { toast('Open a folder first.', 'warn'); return; }
    const name = await ask(isDir ? 'New folder name' : 'New file name', '', isDir ? 'src/components' : 'index.ts');
    if (!name) return;
    const p = join(base, name.replace(/\//g, base.includes('\\') ? '\\' : '/'));
    try {
      await umbra.fs.create(p, isDir);
      expanded.add(base);
      await refresh();
      if (!isDir) U.editor.open(p);
    } catch (e) { toast(clean(e), 'bad'); }
  }
  async function rename(n) {
    const name = await ask('Rename', n.name);
    if (!name || name === n.name) return;
    const to = join(dirname(n.path), name);
    try { await umbra.fs.rename(n.path, to); U.editor.renamePath(n.path, to); await refresh(); } catch (e) { toast(clean(e), 'bad'); }
  }
  async function del(n) {
    if (!(await confirm(`Move "${n.name}" to the trash?`, 'You can restore it from your system trash.', 'Move to Trash', true))) return;
    try { if (U.editor.tabs().some((t) => t.path === n.path)) await U.editor.close(n.path); await umbra.fs.delete(n.path); await refresh(); } catch (e) { toast(clean(e), 'bad'); }
  }
  const clean = (e) => String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

  function ctxMenu(e, n) {
    const items = [];
    if (n.type === 'dir') items.push(['New File…', () => create(false, n.path)], ['New Folder…', () => create(true, n.path)], '-');
    else items.push(['Open', () => U.editor.open(n.path)], ['Add to AI Context', () => bus.emit('ai:attach', n.path)], '-');
    items.push(['Rename…', () => rename(n)], ['Delete', () => del(n)], '-',
      ['Copy Path', () => navigator.clipboard.writeText(n.path)],
      ['Copy Relative Path', () => navigator.clipboard.writeText(n.path.slice(state.workspace.root.length + 1))],
      ['Reveal in File Explorer', () => umbra.fs.reveal(n.path)]);
    U.showMenu(e.clientX, e.clientY, items);
  }

  // ---------------- search
  const runSearch = U.debounce(async (q) => {
    const box = $('#search-results'); box.innerHTML = '';
    if (!q || q.length < 2) return;
    if (!state.workspace) { box.innerHTML = '<div class="pad muted">Open a folder to search.</div>'; return; }
    const hits = await umbra.fs.search(q);
    if (!hits.length) { box.innerHTML = '<div class="pad muted">No results.</div>'; return; }
    const byFile = {};
    hits.forEach((h) => (byFile[h.rel] ||= []).push(h));
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    box.append(el('div', { class: 'pad muted small' }, `${hits.length} results in ${Object.keys(byFile).length} files`));
    for (const [rel, hs] of Object.entries(byFile)) {
      box.append(el('div', { class: 'sr-file' }, rel));
      for (const h of hs) box.append(el('div', { class: 'sr-hit', onclick: () => U.editor.open(h.path, { line: h.line }),
        html: `<span class="muted">${h.line}</span>  ${esc(h.text).replace(re, (m) => `<mark>${m}</mark>`)}` }));
    }
  }, 250);

  document.addEventListener('DOMContentLoaded', () => {
    $('#open-folder-btn').onclick = openFolder;
    $('#ex-newfile').onclick = () => create(false);
    $('#ex-newfolder').onclick = () => create(true);
    $('#ex-refresh').onclick = refresh;
    $('#ex-collapse').onclick = () => { expanded.clear(); render(); };
    $('#search-input').addEventListener('input', (e) => runSearch(e.target.value));
    $('#tree').addEventListener('keydown', (e) => {
      if (e.key === 'F2' && selected) { const n = { path: selected, name: basename(selected) }; rename(n); }
    });
  });

  bus.on('editor:active', (p) => { if (p) { selected = p; render(); } });
  bus.on('fs:changed', () => refresh());

  return { setWorkspace, openFolder, refresh, create };
})();
