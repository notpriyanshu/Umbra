// Minimal, safe markdown renderer (escape-first; no raw HTML passthrough).
U.md = (() => {
  const { esc } = U;
  function inline(s) {
    return s
      .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  }
  function render(src) {
    const out = [];
    const blocks = [];
    // pull fenced code blocks out first (support unterminated block while streaming)
    const text = String(src).replace(/```([\w+#.-]*)[^\n]*\n([\s\S]*?)(```|$)/g, (_, lang, code) => {
      blocks.push({ lang, code: code.replace(/\n$/, '') });
      return `\u0000${blocks.length - 1}\u0000`;
    });
    const lines = esc(text).split('\n');
    let list = null; let para = [];
    const flushP = () => { if (para.length) { out.push(`<p>${inline(para.join('<br>'))}</p>`); para = []; } };
    const flushL = () => { if (list) { out.push(`<${list.t}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.t}>`); list = null; } };
    for (const line of lines) {
      const cb = line.match(/^\u0000(\d+)\u0000$/);
      if (cb) { flushP(); flushL(); out.push(codeBlock(blocks[+cb[1]])); continue; }
      const h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) { flushP(); flushL(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
      const ul = line.match(/^\s*[-*+]\s+(.*)$/);
      const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (ul || ol) {
        flushP();
        const t = ul ? 'ul' : 'ol';
        if (!list || list.t !== t) { flushL(); list = { t, items: [] }; }
        list.items.push((ul || ol)[1]); continue;
      }
      if (!line.trim()) { flushP(); flushL(); continue; }
      flushL(); para.push(line);
    }
    flushP(); flushL();
    // inline code-block placeholders that landed mid-paragraph
    return out.join('').replace(/\u0000(\d+)\u0000/g, (_, i) => codeBlock(blocks[+i]));
  }
  function codeBlock({ lang, code }) {
    const id = 'cb' + Math.random().toString(36).slice(2, 8);
    U.md.store[id] = { lang, code };
    return `<div class="codeblock" data-cb="${id}"><div class="cb-head"><span>${esc(lang || 'text')}</span>` +
      `<button data-act="copy">Copy</button><button data-act="insert">Insert</button><button data-act="apply">Apply to file</button><button data-act="run" ${/^(sh|bash|shell|powershell|ps1|cmd|console)$/i.test(lang) ? '' : 'hidden'}>Run</button></div>` +
      `<pre><code>${esc(code)}</code></pre></div>`;
  }
  return { render, store: {} };
})();
