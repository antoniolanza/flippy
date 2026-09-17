# Flippy UI

A lightweight web chat for the **Flippy — Grocery Deal Agent** n8n workflow. Deals in Flippy's replies are rendered as price cards (store, size, % off, validity), with the best price highlighted. Works great on phones — you can "Add to Home Screen" for an app-like experience.

## Requirements

- Node.js 18+ (no npm packages needed — zero dependencies)
- Your n8n instance running on the network with the Flippy workflow **Active**

## One-time n8n setup

1. Open the **Flippy - Grocery Deal Agent** workflow in n8n.
2. Open the **Chat** trigger node and turn on **"Make chat publicly available"**.
3. Make sure the workflow is **Active** (toggle top-right).

## Run

```bash
node server.js
```

Then open the **Network** URL it prints (e.g. `http://192.168.1.20:3080`) on any device on your Wi-Fi. On first load it asks for your n8n address (e.g. `http://192.168.1.50:5678`) — the webhook path is filled in automatically and saved to `config.json`.

Options:

- `PORT=4000 node server.js` — different port
- `N8N_CHAT_URL=http://host:5678/webhook/<id>/chat node server.js` — hard-code the n8n endpoint (locks the settings UI)

## Deploy permanently (Docker, recommended)

Run it on the same machine as n8n so it's always on. Copy the `flippy-ui/` folder there, then:

```bash
docker compose up -d --build
```

Copy `.env.example` to `.env`, set `N8N_CHAT_URL` to your n8n chat webhook, then `docker compose up -d --build`. It restarts on reboot and serves on port 3080. Open `http://<server-ip>:3080` from any device on your Wi-Fi and Add to Home Screen on your phone.

To update after changing the UI files: copy the folder over again and re-run `docker compose up -d --build`.

## Deploy on Windows instead (no Docker)

Run it at login via Task Scheduler:

```bash
schtasks /create /tn "Flippy UI" /tr "\"C:\Program Files\nodejs\node.exe\" \"C:\path\to\flippy\flippy-ui\server.js\"" /sc onlogon /rl limited /f
```

Caveats: your PC must be on and awake for the UI to be reachable, and Windows Firewall must allow inbound connections for Node on port 3080 (approve the prompt on first run, or add a rule).

The server proxies chat requests to n8n, so there are no CORS issues and your n8n address never needs to be exposed to the browser directly.

## Notes

- Each browser keeps its own `sessionId` (favourites in the workflow are stored per session). The **+** button starts a fresh session.
- Chat history is stored locally in the browser (`localStorage`), not on the server.
