// Umbra Studio — main process.
const { app, BrowserWindow, ipcMain, dialog, session, shell, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { Store, PROVIDER_PRESETS } = require('./store');
const { Gateway } = require('./llm');

// ---- hard privacy defaults, applied before anything loads -------------------------------
app.commandLine.appendSwitch('disable-features', 'SpellcheckService,AutofillServerCommunication,MediaRouter,OptimizationHints,Translate,NetworkTimeServiceQuerying');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('no-pings');
app.commandLine.appendSwitch('disable-breakpad');
app.setName('Umbra Studio');
if (process.env.UMBRA_SMOKE) app.setPath('userData', path.join(process.env.UMBRA_SMOKE, 'userdata'));

let win;
let store;
let gateway;
let workspace = null;
const pendingApprovals = new Map();

// ---- Network Ledger: every outbound request the app makes, visible to the user ---------
const ledger = {
  items: [],
  blocked: 0,
  add(e) { this.items.unshift(e); this.items = this.items.slice(0, 500); this.push(); },
  update(id, patch) { const e = this.items.find((x) => x.id === id); if (e) Object.assign(e, patch); this.push(); },
  push() { win?.webContents.send('ledger:update', { items: this.items.slice(0, 200), blocked: this.blocked }); },
  clear() { this.items = []; this.blocked = 0; this.push(); }
};

function createWindow() {
  win = new BrowserWindow({
    width: 1480, height: 920, minWidth: 980, minHeight: 600,
    backgroundColor: '#0a0b10',
    frame: false,
    titleBarStyle: 'hidden',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webviewTag: false,
      navigateOnDragDrop: false
    }
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '../renderer/index.html'));
  win.once('ready-to-show', () => win.show());

  // Dev-only smoke test hook: UMBRA_SMOKE=<dir> runs a script in the UI, screenshots, and quits.
  if (process.env.UMBRA_SMOKE) {
    win.webContents.on('console-message', (_e, level, message) => console.log(`[renderer:${level}] ${message}`));
    win.webContents.once('did-finish-load', async () => {
      const out = process.env.UMBRA_SMOKE;
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const shot = async (name) => fs.writeFileSync(path.join(out, name + '.png'), (await win.webContents.capturePage()).toPNG());
      try {
        await wait(2500); await shot('01-welcome');
        const steps = JSON.parse(process.env.UMBRA_SMOKE_STEPS || '[]');
        for (const [i, s] of steps.entries()) {
          console.log('[smoke] step', i, await win.webContents.executeJavaScript(s.js).catch((e) => 'ERR ' + e.message));
          await wait(s.wait || 1500); await shot(String(i + 2).padStart(2, '0') + '-' + (s.name || 'step'));
        }
      } catch (e) { console.error('[smoke] failed', e); }
      app.quit();
    });
  }
  win.on('maximize', () => win.webContents.send('win:state', { maximized: true }));
  win.on('unmaximize', () => win.webContents.send('win:state', { maximized: false }));

  // Never let the renderer navigate away or open windows.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) dialog.showMessageBox(win, {
      type: 'question', buttons: ['Open in browser', 'Cancel'], defaultId: 1,
      title: 'External link', message: 'Open this link in your system browser?', detail: url
    }).then((r) => { if (r.response === 0) shell.openExternal(url); });
    return { action: 'deny' };
  });
}

function lockDownSession() {
  const ses = session.defaultSession;
  // Block every renderer request that isn't a local file / devtools / inline resource.
  ses.webRequest.onBeforeRequest((details, cb) => {
    const u = details.url;
    if (/^(file|devtools|data|blob|chrome-extension):/.test(u)) return cb({});
    if (store?.getSettings().privacy.blockRendererNetwork === false) return cb({});
    ledger.blocked++;
    ledger.add({ id: Math.random().toString(36).slice(2), ts: Date.now(), method: details.method, url: u,
      host: (() => { try { return new URL(u).host; } catch { return u; } })(), local: false, purpose: 'renderer (blocked)', status: 'blocked', bytesOut: 0 });
    cb({ cancel: true });
  });
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'clipboard-sanitized-write'));
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'clipboard-sanitized-write');
}

// ---- file system --------------------------------------------------------------------------
const IGNORE = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', 'dist', 'build', '.next', 'target']);
function readTree(dir, depth = 0) {
  if (depth > 12) return [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((d) => !IGNORE.has(d.name))
    .sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name))
    .map((d) => {
      const full = path.join(dir, d.name);
      return d.isDirectory()
        ? { name: d.name, path: full, type: 'dir', children: depth < 1 ? readTree(full, depth + 1) : null }
        : { name: d.name, path: full, type: 'file' };
    });
}
function inWorkspace(p) {
  if (!workspace) return false;
  const r = path.resolve(workspace); const f = path.resolve(p);
  return f === r || f.startsWith(r + path.sep);
}
function guard(p) { if (!inWorkspace(p)) throw new Error('Access outside the open workspace is not allowed.'); return p; }

// ---- terminal (streamed shell commands, cwd-aware) ----------------------------------------
const terms = new Map();
function termRun(id, command) {
  const t = terms.get(id) || { cwd: workspace || app.getPath('home'), proc: null };
  terms.set(id, t);
  const send = (data) => win?.webContents.send('term:data', { id, data });
  const trimmed = command.trim();
  const cd = trimmed.match(/^cd\s*(.*)$/i);
  if (cd) {
    const target = cd[1].replace(/^["']|["']$/g, '') || app.getPath('home');
    const next = path.resolve(t.cwd, target.replace(/^~/, app.getPath('home')));
    if (fs.existsSync(next) && fs.statSync(next).isDirectory()) t.cwd = next;
    else send(`\x1b[31mcd: no such directory: ${target}\x1b[0m\n`);
    win?.webContents.send('term:exit', { id, code: 0, cwd: t.cwd });
    return;
  }
  const isWin = process.platform === 'win32';
  const proc = isWin
    ? spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', `$ProgressPreference='SilentlyContinue'; ${command}`], { cwd: t.cwd, windowsHide: true, env: { ...process.env, FORCE_COLOR: '1' } })
    : spawn(process.env.SHELL || '/bin/bash', ['-lc', command], { cwd: t.cwd, env: { ...process.env, FORCE_COLOR: '1' } });
  t.proc = proc;
  proc.stdout.on('data', (d) => send(d.toString()));
  proc.stderr.on('data', (d) => send(`\x1b[31m${d.toString()}\x1b[0m`));
  proc.on('close', (code) => { t.proc = null; win?.webContents.send('term:exit', { id, code, cwd: t.cwd }); });
  proc.on('error', (e) => { send(`\x1b[31m${e.message}\x1b[0m\n`); });
}

// ---- IPC -------------------------------------------------------------------------------------
function registerIpc() {
  const h = (ch, fn) => ipcMain.handle(ch, async (_e, ...a) => fn(...a));

  h('win:minimize', () => win.minimize());
  h('win:maximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
  h('win:close', () => win.close());
  h('app:info', () => ({ version: app.getVersion(), platform: process.platform, electron: process.versions.electron,
    userData: app.getPath('userData'), encryption: store.encryptionAvailable() }));

  h('fs:openFolder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    workspace = r.filePaths[0];
    terms.forEach((t) => (t.cwd = workspace));
    store.setSettings({ lastWorkspace: workspace });
    return { root: workspace, name: path.basename(workspace), tree: readTree(workspace) };
  });
  h('fs:restore', () => {
    const last = store.getSettings().lastWorkspace;
    if (last && fs.existsSync(last)) { workspace = last; return { root: workspace, name: path.basename(workspace), tree: readTree(workspace) }; }
    return null;
  });
  h('fs:closeFolder', () => { workspace = null; store.setSettings({ lastWorkspace: '' }); return true; });
  h('fs:readDir', (p) => readTree(guard(p), 1));
  h('fs:tree', () => (workspace ? readTree(workspace) : []));
  h('fs:readFile', (p) => {
    guard(p);
    const st = fs.statSync(p);
    if (st.size > 8 * 1024 * 1024) throw new Error('File is larger than 8 MB.');
    const buf = fs.readFileSync(p);
    if (buf.subarray(0, 8000).includes(0)) return { binary: true, content: '' };
    return { binary: false, content: buf.toString('utf8') };
  });
  h('fs:writeFile', (p, content) => { guard(p); fs.writeFileSync(p, content, 'utf8'); return true; });
  h('fs:create', (p, isDir) => {
    guard(p);
    if (fs.existsSync(p)) throw new Error('Already exists');
    if (isDir) fs.mkdirSync(p, { recursive: true }); else { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, ''); }
    return true;
  });
  h('fs:rename', (from, to) => { guard(from); guard(to); fs.renameSync(from, to); return true; });
  h('fs:delete', async (p) => { guard(p); await shell.trashItem(p); return true; });
  h('fs:reveal', (p) => { guard(p); shell.showItemInFolder(p); });
  h('fs:search', (query) => {
    if (!workspace || !query) return [];
    const out = []; const q = query.toLowerCase();
    const walk = (dir) => {
      for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
        if (out.length >= 500 || IGNORE.has(d.name) || d.name.startsWith('.')) continue;
        const full = path.join(dir, d.name);
        if (d.isDirectory()) { walk(full); continue; }
        try {
          if (fs.statSync(full).size > 1_000_000) continue;
          const buf = fs.readFileSync(full); if (buf.subarray(0, 4000).includes(0)) continue;
          buf.toString('utf8').split(/\r?\n/).forEach((line, i) => {
            if (out.length < 500 && line.toLowerCase().includes(q)) out.push({ path: full, rel: path.relative(workspace, full), line: i + 1, text: line.trim().slice(0, 240) });
          });
        } catch {}
      }
    };
    walk(workspace);
    return out;
  });
  h('fs:allFiles', () => {
    if (!workspace) return [];
    const out = [];
    const walk = (dir) => {
      for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
        if (out.length > 5000 || IGNORE.has(d.name) || d.name === '.git') continue;
        const full = path.join(dir, d.name);
        if (d.isDirectory()) walk(full); else out.push({ path: full, rel: path.relative(workspace, full) });
      }
    };
    walk(workspace);
    return out;
  });

  h('settings:get', () => ({ settings: store.getSettings(), presets: PROVIDER_PRESETS, secrets: store.secretHints() }));
  h('settings:set', (patch) => store.setSettings(patch));
  h('settings:reset', () => store.resetSettings());
  h('secret:set', (id, value) => { store.setSecret(id, value); return store.secretHints(); });
  h('privacy:wipe', () => { const s = store.wipeAll(); ledger.clear(); return s; });

  h('ledger:get', () => ({ items: ledger.items, blocked: ledger.blocked }));
  h('ledger:clear', () => ledger.clear());

  h('llm:models', (pid) => gateway.listModels(pid));
  h('llm:test', async (pid) => {
    const t = Date.now();
    const models = await gateway.listModels(pid);
    return { ok: true, ms: Date.now() - t, models };
  });
  h('llm:chat', (reqId, payload) => {
    gateway.chat(reqId, payload, (type, data) => win?.webContents.send('llm:event', { reqId, type, data }));
    return true;
  });
  h('llm:cancel', (reqId) => gateway.cancel(reqId));
  h('llm:complete', (messages, pid) => gateway.complete(messages, pid));
  h('agent:approve', (id, ok) => { pendingApprovals.get(id)?.(ok); pendingApprovals.delete(id); });

  h('term:run', (id, cmd) => termRun(id, cmd));
  h('term:kill', (id) => { const t = terms.get(id); t?.proc?.kill(); });
  h('term:cwd', (id) => (terms.get(id)?.cwd || workspace || app.getPath('home')));
}

app.whenReady().then(() => {
  store = new Store();
  if (process.env.UMBRA_SMOKE_SETTINGS) store.setSettings(JSON.parse(process.env.UMBRA_SMOKE_SETTINGS));
  gateway = new Gateway({
    store, ledger,
    getWorkspace: () => workspace,
    requestApproval: (req) => new Promise((resolve) => {
      pendingApprovals.set(req.id, resolve);
      win?.webContents.send('agent:approval', req);
    })
  });
  lockDownSession();
  registerIpc();
  createWindow();
});

app.on('window-all-closed', () => { terms.forEach((t) => t.proc?.kill()); app.quit(); });
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault());
});
