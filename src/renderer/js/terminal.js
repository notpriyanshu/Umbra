// Integrated terminal (streamed shell commands with cwd tracking + history).
U.terminal = (() => {
  const { $, ansiToHtml, esc, bus } = U;
  const ID = 'main';
  let cwd = '';
  let running = false;
  const history = []; let hIdx = -1;

  function write(text) {
    const out = $('#term-out');
    const atBottom = out.scrollHeight - out.scrollTop - out.clientHeight < 40;
    out.insertAdjacentHTML('beforeend', ansiToHtml(text));
    if (out.childNodes.length > 4000) out.innerHTML = out.innerHTML.slice(-200000);
    if (atBottom) out.scrollTop = out.scrollHeight;
  }
  function prompt() {
    const short = cwd.length > 48 ? '…' + cwd.slice(-46) : cwd;
    $('#term-prompt').innerHTML = running ? '<span class="c-dim">running…</span>' : `<b>umbra</b> ${esc(short)} ❯`;
  }
  async function run(cmd, { show = true } = {}) {
    U.showPanel('terminal');
    if (!cmd.trim()) return;
    if (cmd.trim() === 'clear' || cmd.trim() === 'cls') { $('#term-out').innerHTML = ''; return; }
    history.unshift(cmd); hIdx = -1;
    if (show) write(`\x1b[36m❯\x1b[0m \x1b[1m${cmd}\x1b[0m\n`);
    running = true; prompt();
    await umbra.term.run(ID, cmd);
  }
  document.addEventListener('DOMContentLoaded', async () => {
    cwd = await umbra.term.cwd(ID); prompt();
    write('\x1b[35mUmbra Terminal\x1b[0m \x1b[90m— commands run locally on this machine. Nothing is recorded or uploaded.\x1b[0m\n');
    const inp = $('#term-input');
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const v = inp.value; inp.value = ''; run(v); }
      else if (e.key === 'ArrowUp') { if (hIdx < history.length - 1) inp.value = history[++hIdx]; e.preventDefault(); }
      else if (e.key === 'ArrowDown') { hIdx = Math.max(-1, hIdx - 1); inp.value = hIdx < 0 ? '' : history[hIdx]; e.preventDefault(); }
      else if (e.key === 'c' && e.ctrlKey && running) { umbra.term.kill(ID); }
      else if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); $('#term-out').innerHTML = ''; }
    });
    $('#term-out').addEventListener('click', () => { if (!getSelection().toString()) inp.focus(); });
    $('#term-clear').onclick = () => { $('#term-out').innerHTML = ''; };
    $('#term-kill').onclick = () => umbra.term.kill(ID);
  });
  umbra.term.onData(({ data }) => write(data));
  umbra.term.onExit(({ code, cwd: c }) => {
    running = false; cwd = c;
    if (code) write(`\x1b[90m[exit ${code}]\x1b[0m\n`);
    prompt(); bus.emit('fs:changed');
  });
  bus.on('workspace', async () => { cwd = await umbra.term.cwd(ID); prompt(); });
  return { run, write };
})();
