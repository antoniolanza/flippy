#!/usr/bin/env node
/**
 * Flippy UI — tiny zero-dependency server.
 * Serves the static UI and proxies chat requests to your n8n instance
 * (which avoids CORS entirely — the browser only ever talks to this server).
 *
 * Usage:  node server.js
 * Config: flippy-ui/config.json  (created via the UI on first run)
 *         or env vars N8N_CHAT_URL / PORT
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 3080;
const PUBLIC_DIR = path.join(__dirname, 'public');
const CONFIG_PATH = path.join(__dirname, 'config.json');

// Webhook id of the "Chat" trigger node in "Flippy - Grocery Deal Agent"
const WEBHOOK_ID = 'd9ca4194-9e36-4426-a7b4-d568171add51';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function loadConfig() {
  if (process.env.N8N_CHAT_URL) return { chatUrl: process.env.N8N_CHAT_URL };
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

/** Turn whatever the user typed into a full chat webhook URL. */
function normalizeChatUrl(input) {
  let url = String(input || '').trim().replace(/\/+$/, '');
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
  // Already a full chat endpoint
  if (/\/webhook(-test)?\/[^/]+\/chat$/i.test(url)) return url;
  // A webhook URL without /chat
  if (/\/webhook(-test)?\/[^/]+$/i.test(url)) return url + '/chat';
  // Just a base like http://192.168.1.50:5678
  return `${url}/webhook/${WEBHOOK_ID}/chat`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

async function handleApi(req, res, urlPath) {
  if (urlPath === '/api/config' && req.method === 'GET') {
    const cfg = loadConfig();
    return sendJson(res, 200, {
      configured: Boolean(cfg.chatUrl),
      chatUrl: cfg.chatUrl || null,
      locked: Boolean(process.env.N8N_CHAT_URL),
    });
  }

  if (urlPath === '/api/config' && req.method === 'POST') {
    if (process.env.N8N_CHAT_URL) {
      return sendJson(res, 400, { error: 'Config is locked by the N8N_CHAT_URL environment variable.' });
    }
    const body = JSON.parse((await readBody(req)) || '{}');
    const chatUrl = normalizeChatUrl(body.url);
    if (!chatUrl) return sendJson(res, 400, { error: 'Please provide your n8n URL.' });
    saveConfig({ chatUrl });
    return sendJson(res, 200, { ok: true, chatUrl });
  }

  if (urlPath === '/api/chat' && req.method === 'POST') {
    const cfg = loadConfig();
    if (!cfg.chatUrl) return sendJson(res, 409, { error: 'Not configured yet.' });

    const body = await readBody(req);
    let upstream;
    try {
      upstream = await fetch(cfg.chatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' },
        body,
      });
    } catch (err) {
      return sendJson(res, 502, {
        error: `Could not reach n8n at ${cfg.chatUrl} — is n8n running and the workflow active? (${err.message})`,
      });
    }

    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    });

    if (!upstream.body) return res.end();
    const reader = upstream.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    } catch {
      /* client disconnected or upstream dropped — nothing useful to do */
    }
    return res.end();
  }

  sendJson(res, 404, { error: 'Not found' });
}

function serveStatic(res, urlPath) {
  let filePath = path.normalize(path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA-ish fallback: unknown paths get the app shell
      return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err2, html) => {
        if (err2) {
          res.writeHead(404);
          return res.end('Not found');
        }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(html);
      });
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath.startsWith('/api/')) {
    handleApi(req, res, urlPath).catch((err) => {
      if (!res.headersSent) sendJson(res, 500, { error: err.message });
      else res.end();
    });
  } else {
    serveStatic(res, urlPath);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const addrs = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces || []) {
      if (iface.family === 'IPv4' && !iface.internal) addrs.push(iface.address);
    }
  }
  console.log('');
  console.log('  Flippy UI is running');
  console.log(`    Local:   http://localhost:${PORT}`);
  for (const a of addrs) console.log(`    Network: http://${a}:${PORT}`);
  console.log('');
  console.log('  Open the Network URL on your phone (same Wi-Fi).');
  console.log('');
});
