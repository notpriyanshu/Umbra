// Network Ledger + Privacy Shield views. Every byte that leaves the app is listed here.
U.ledger = (() => {
  const { $, esc, state, timeAgo } = U;
  let data = { items: [], blocked: 0 };

  function render() {
    const items = data.items;
    const outbound = items.filter((i) => i.status !== 'blocked');
    const cloud = outbound.filter((i) => !i.local);
    $('#ledger-count').textContent = items.length;
    $('#st-net').textContent = `${outbound.length} outbound${cloud.length ? ` (${cloud.length} cloud)` : ''} · ${data.blocked} blocked`;
    const v = $('#ledger-view');
    if (!items.length) {
      v.innerHTML = '<div class="ledger-empty">No network activity yet. Umbra makes <b>zero</b> requests on its own — no telemetry, no update pings, no crash reports.<br>Only the model endpoints you configure are ever contacted, and each call appears here.</div>';
    } else {
      v.innerHTML = `<table><thead><tr><th>TIME</th><th>SCOPE</th><th>METHOD</th><th>HOST</th><th>PURPOSE</th><th>SENT</th><th>STATUS</th><th>LATENCY</th></tr></thead><tbody>${
        items.map((i) => `<tr><td>${timeAgo(i.ts)}</td><td><span class="tag ${i.status === 'blocked' ? 'blocked' : i.local ? 'local' : 'cloud'}">${i.status === 'blocked' ? 'BLOCKED' : i.local ? 'LOCAL' : 'CLOUD'}</span></td>` +
          `<td>${esc(i.method)}</td><td title="${esc(i.url)}">${esc(i.host)}</td><td>${esc(i.purpose || '')}${i.redactions ? ` <span class="tag local">${i.redactions} redacted</span>` : ''}</td>` +
          `<td>${i.bytesOut ? (i.bytesOut / 1024).toFixed(1) + ' KB' : '—'}</td><td>${esc(i.status)}${i.error ? ' · ' + esc(i.error) : ''}</td><td>${i.ms ? i.ms + ' ms' : '…'}</td></tr>`).join('')
      }</tbody></table>`;
    }
    renderShield();
  }

  function renderShield() {
    const s = state.settings; if (!s) return;
    const outbound = data.items.filter((i) => i.status !== 'blocked');
    const cloud = outbound.filter((i) => !i.local).length;
    const localOnly = s.privacy.localOnly;
    $('#shield-view').innerHTML = `
      <div class="meter ${localOnly ? '' : 'cloud'}">
        <div class="muted small">PROTECTION LEVEL</div>
        <div class="big" style="color:${localOnly ? 'var(--ok)' : 'var(--warn)'}">${localOnly ? 'Air-gapped' : 'Hybrid'}</div>
        <div class="muted small">${localOnly ? 'Only loopback model servers can be reached.' : 'Cloud providers allowed. Secrets are ' + (s.privacy.redactSecrets ? 'redacted.' : '<b>not</b> redacted.')}</div>
      </div>
      <div class="stat"><span>Model requests</span><b>${outbound.length}</b></div>
      <div class="stat"><span>…to cloud hosts</span><b style="color:${cloud ? 'var(--warn)' : 'var(--ok)'}">${cloud}</b></div>
      <div class="stat"><span>Blocked renderer requests</span><b>${data.blocked}</b></div>
      <div class="stat"><span>Secrets redacted</span><b>${data.items.reduce((a, i) => a + (i.redactions || 0), 0)}</b></div>
      <div class="stat"><span>Telemetry</span><b style="color:var(--ok)">None</b></div>
      <div class="stat"><span>API key storage</span><b>${state.appInfo?.encryption ? 'OS keychain (encrypted)' : 'Unavailable'}</b></div>
      <div class="stat"><span>Chat history</span><b>${s.privacy.persistChats ? 'Saved locally' : 'Memory only'}</b></div>
      <button class="btn" id="sh-ledger">Open Network Ledger</button>
      <button class="btn" id="sh-settings">Privacy Settings</button>`;
    $('#sh-ledger').onclick = () => U.showPanel('ledger');
    $('#sh-settings').onclick = () => U.settingsUI.open('privacy');
  }

  umbra.ledger.onUpdate((d) => { data = d; render(); });
  document.addEventListener('DOMContentLoaded', async () => { data = await umbra.ledger.get(); render(); });
  U.bus.on('settings', renderShield);
  return { render };
})();
