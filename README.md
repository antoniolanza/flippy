# Flippy — Grocery Deal Agent

Claude-powered **n8n agent** that searches Calgary (or any) flyer deals via [Flipp](https://flipp.com), plus a mobile-friendly web UI for your home network.

Built as a practical AI + workflow-automation project: multi-tool agent, scheduled digest, favourites, and a small zero-dependency chat UI with Docker deploy.

## Demo flow

1. Ask Flippy for deals ("cheap chicken this week", "ingredients for butter chicken").
2. It calls Flipp search / recipe tools, ranks prices, and replies with deal cards in the UI.
3. Save favourites; get a **Thursday morning** ntfy digest of what's on sale.

## Architecture

```
flippy-ui (Node) ──proxy──▶ n8n Chat webhook
                               │
                               ▼
                    Grocery Deal Agent (Claude)
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
        Flipp Search    Recipe Ingredients   Manage Favourites
              │
              └─▶ Weekly Deals Digest (cron → ntfy)
```

## Repo contents

| Path | What it is |
|---|---|
| `Flippy - Grocery Deal Agent.json` | Main agent: chat trigger → Claude + tools |
| `Flippy - Tool_ Flipp Search.json` | Sub-workflow: Flipp item search |
| `Flippy - Tool_ Recipe Ingredients.json` | Sub-workflow: dish → grocery list (Haiku) |
| `Flippy - Tool_ Manage Favourites.json` | Sub-workflow: save / list / remove favourites |
| `Flippy - Weekly Deals Digest.json` | Thursday 8am favourites scan → ntfy |
| `flippy-ui/` | Web chat UI + Docker — see [flippy-ui/README.md](flippy-ui/README.md) |

## Quick start (n8n)

1. Import each workflow JSON into n8n (⋯ → **Import from File…**). Keep them **Active**.
2. Attach your **Anthropic** credentials where prompted (agent + recipe tool).
3. In **Flipp Search**, set `postal_code` from `YOUR_POSTAL_CODE` to your real code.
4. On the agent **Chat** trigger, enable **"Make chat publicly available"** and note the webhook URL.
5. For the weekly digest: replace `flippy-deals-CHANGE-ME` in the ntfy URL with a private topic, subscribe in the [ntfy](https://ntfy.sh) app, then activate.

## Quick start (UI)

```bash
cd flippy-ui
node server.js
```

Open the printed Network URL, paste your n8n base URL (or full chat webhook). Config is saved locally to `config.json` (gitignored).

Docker:

```bash
cd flippy-ui
cp .env.example .env   # set N8N_CHAT_URL
docker compose up -d --build
```

## Stack

- **n8n** agent workflows + LangChain Anthropic chat model
- **Flipp** public search API (postal-code scoped)
- **Node** zero-dependency UI (`server.js` + static frontend)
- **Docker Compose** for always-on LAN deploy
- **ntfy** for push notifications

## Notes & limitations

- Favourites live in the Manage Favourites workflow static data — fine for a household, not a durable DB.
- Flipp availability / shape can change; the search tool fails soft with a friendly message.
- Exported workflows reference credential *names* only — no API keys are stored in this repo.
- Your LAN n8n URL and webhook id stay in gitignored local config / `.env`.

## Why this exists

Portfolio / home-lab project showing end-to-end agent design: tool calling, scheduling, a real product UI, and safe ops (proxied chat, no browser CORS to n8n).

## License

MIT — use and adapt freely.
