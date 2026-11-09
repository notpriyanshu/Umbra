// Shared helpers + global namespace.
window.U = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(k));
    return n;
  }

  // tiny event bus
  const handlers = {};
  const bus = {
    on(ev, fn) { (handlers[ev] ||= []).push(fn); },
    emit(ev, d) { (handlers[ev] || []).forEach((f) => f(d)); }
  };

  function toast(msg, kind = '', ms = 3800) {
    const t = el('div', { class: `toast ${kind}` }, el('div', {}, msg));
    $('#toasts').append(t);
    setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, ms);
  }

  function modal({ title, body, html, buttons = [{ label: 'OK', value: true, primary: true }], icon = '' }) {
    return new Promise((resolve) => {
      const m = $('#modal');
      m.innerHTML = '';
      const box = el('div', { class: 'modal-box' },
        el('h3', { html: `${icon}${esc(title)}` }),
        el('div', { class: 'mb', html: html ?? esc(body ?? '') }),
        el('div', { class: 'mf' }, buttons.map((b) =>
          el('button', { class: `btn ${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}`, onclick: () => close(b.value) }, b.label))));
      m.append(box);
      m.classList.remove('hidden');
      const input = box.querySelector('input');
      const close = (v) => {
        m.classList.add('hidden'); document.removeEventListener('keydown', key, true);
        resolve(v === '__input' ? input?.value : v);
      };
      const key = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); close(null); }
        if (e.key === 'Enter' && input) { e.preventDefault(); close('__input'); }
      };
      document.addEventListener('keydown', key, true);
      setTimeout(() => (input ? (input.focus(), input.select()) : box.querySelector('.btn.primary')?.focus()), 30);
    });
  }
  const ask = (title, value = '', placeholder = '') => modal({
    title, html: `<input class="input" value="${esc(value)}" placeholder="${esc(placeholder)}" spellcheck="false" />`,
    buttons: [{ label: 'Cancel', value: null }, { label: 'OK', value: '__input', primary: true }]
  });
  const confirm = (title, body, okLabel = 'Confirm', danger = false) => modal({
    title, body, buttons: [{ label: 'Cancel', value: false }, { label: okLabel, value: true, primary: !danger, danger }]
  });

  // file meta
  const EXT = {
    js: ['javascript', 'JS', '#f7df1e'], mjs: ['javascript', 'JS', '#f7df1e'], cjs: ['javascript', 'JS', '#f7df1e'], jsx: ['javascript', 'JSX', '#61dafb'],
    ts: ['typescript', 'TS', '#3b82f6'], tsx: ['typescript', 'TSX', '#38bdf8'], json: ['json', '{}', '#fbbf24'],
    py: ['python', 'PY', '#4b8bbe'], ipynb: ['json', 'NB', '#f97316'], rs: ['rust', 'RS', '#f97316'], go: ['go', 'GO', '#22d3ee'],
    java: ['java', 'JV', '#ef4444'], kt: ['kotlin', 'KT', '#a855f7'], c: ['c', 'C', '#60a5fa'], h: ['c', 'H', '#60a5fa'], cpp: ['cpp', 'C++', '#3b82f6'], hpp: ['cpp', 'H++', '#3b82f6'],
    cs: ['csharp', 'C#', '#a855f7'], rb: ['ruby', 'RB', '#ef4444'], php: ['php', 'PHP', '#818cf8'], swift: ['swift', 'SW', '#f97316'],
    html: ['html', '<>', '#f97316'], htm: ['html', '<>', '#f97316'], css: ['css', '#', '#38bdf8'], scss: ['scss', 'S', '#ec4899'], less: ['less', 'L', '#3b82f6'],
    md: ['markdown', 'M↓', '#94a3b8'], yml: ['yaml', 'YM', '#f43f5e'], yaml: ['yaml', 'YM', '#f43f5e'], toml: ['ini', 'TM', '#94a3b8'], ini: ['ini', 'INI', '#94a3b8'],
    xml: ['xml', 'XML', '#f97316'], svg: ['xml', 'SVG', '#fbbf24'], sh: ['shell', '$', '#34d399'], bash: ['shell', '$', '#34d399'], ps1: ['powershell', 'PS', '#60a5fa'],
    sql: ['sql', 'SQL', '#f59e0b'], lua: ['lua', 'LUA', '#3b82f6'], dart: ['dart', 'DT', '#22d3ee'], vue: ['html', 'V', '#34d399'], txt: ['plaintext', 'TXT', '#94a3b8'],
    env: ['ini', 'ENV', '#facc15'], lock: ['plaintext', 'LCK', '#64748b'], dockerfile: ['dockerfile', 'DK', '#38bdf8'], r: ['r', 'R', '#3b82f6']
  };
  function fileMeta(name) {
    const lower = name.toLowerCase();
    if (lower === 'dockerfile') return EXT.dockerfile;
    if (lower.startsWith('.env')) return EXT.env;
    const ext = lower.includes('.') ? lower.split('.').pop() : '';
    return EXT[ext] || ['plaintext', '•', '#64748b'];
  }
  const basename = (p) => p.split(/[\\/]/).pop();
  const dirname = (p) => p.replace(/[\\/][^\\/]*$/, '');
  const sep = (p) => (p.includes('\\') ? '\\' : '/');
  const join = (a, b) => a.replace(/[\\/]+$/, '') + sep(a) + b;

  function ansiToHtml(text) {
    const map = { 31: 'c-red', 32: 'c-green', 33: 'c-yellow', 34: 'c-blue', 35: 'c-magenta', 36: 'c-cyan', 90: 'c-dim', 91: 'c-red', 92: 'c-green', 93: 'c-yellow', 94: 'c-blue', 95: 'c-magenta', 96: 'c-cyan', 1: 'c-bold', 2: 'c-dim' };
    let open = 0;
    let out = esc(text).replace(/\x1b\[([\d;]*)m/g, (_, codes) => {
      let s = '';
      for (const c of (codes || '0').split(';').map(Number)) {
        if (c === 0 || c === 39) { s += '</span>'.repeat(open); open = 0; }
        else if (map[c]) { s += `<span class="${map[c]}">`; open++; }
      }
      return s;
    }).replace(/\x1b\[[\d;?]*[A-Za-z]/g, '');
    return out + '</span>'.repeat(open);
  }

  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const uid = () => Math.random().toString(36).slice(2, 10);
  const timeAgo = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const state = { settings: null, presets: {}, secrets: {}, workspace: null, mode: 'agent' };

  return { $, $$, esc, el, bus, toast, modal, ask, confirm, fileMeta, basename, dirname, join, ansiToHtml, debounce, uid, timeAgo, state };
})();
