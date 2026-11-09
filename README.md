# Umbra Studio

A private, local-first AI code editor. Monaco editor, file explorer, terminal, and a coding agent that runs on **your** models: Unsloth Studio, Ollama, LM Studio, llama.cpp, vLLM, or any OpenAI-compatible server. You can also bring your own cloud keys (OpenAI, Anthropic, OpenRouter) if you choose.

## Run

```bash
npm install
npm start
```

## Connect Unsloth

1. Start your Unsloth server (default `http://127.0.0.1:8888/v1`).
2. Open **Settings → Models & API Keys → Unsloth Studio**, paste your `sk-unsloth-…` key and click **Save**.
3. Click **Fetch** to pick the loaded model, then **Test connection**.
4. Under **Settings → Unsloth Agents**, set thinking, `top_k`, `min_p`, `repetition_penalty`, and the server-side tools (`python`, `terminal`, `web_search`). The page shows the exact equivalent Python request.

## Privacy model

| Guarantee | How |
|---|---|
| No telemetry | There is no analytics code and no server to send to. Chromium background networking, component updates, and spellcheck downloads are disabled. |
| Sealed UI | The renderer has a strict CSP and every renderer web request is cancelled. Only the main process can reach model endpoints. |
| Encrypted keys | Keys are sealed with Electron `safeStorage` (DPAPI, Keychain, or libsecret) in `vault.bin.json`. The UI only ever sees `••••1234`. |
| Local-only mode (on by default) | Any model endpoint that isn't on loopback is hard-blocked. |
| Secret redaction | API keys, tokens, JWTs, private keys, and `password=` values are scrubbed from prompts sent to cloud providers. |
| Network Ledger | Every outbound request is listed with its host, size, purpose, and latency. |
| Agent sandbox | Agent tools can't leave the open folder. Writes and shell commands ask for approval by default. |
| Ephemeral chats | Chats are kept in memory only unless you turn on "Remember chats". |
| Panic wipe | One click destroys all keys and resets all settings. |

## Shortcuts

`Ctrl+P` go to file · `Ctrl+Shift+P` commands · `Ctrl+K` AI edit selection · `Ctrl+L` ask agent · `Ctrl+B` sidebar · `Ctrl+J` panel · `Ctrl+Alt+B` agent panel · `Ctrl+,` settings

## Layout

```
src/main/main.js      window, sandboxing, network lockdown, fs + terminal IPC, ledger
src/main/llm.js       model gateway (OpenAI-compatible + Anthropic streaming), agent loop, tools, redaction
src/main/store.js     settings + encrypted key vault, provider presets
src/main/preload.js   narrow contextBridge API
src/renderer/         UI (index.html, styles.css, js/*)
```
