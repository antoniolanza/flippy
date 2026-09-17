/* ============ Flippy UI ============ */
(() => {
  'use strict';

  // ---------- Elements ----------
  const chatEl = document.getElementById('chat');
  const formEl = document.getElementById('chat-form');
  const inputEl = document.getElementById('chat-input');
  const sendBtn = document.getElementById('btn-send');
  const newChatBtn = document.getElementById('btn-new-chat');
  const settingsBtn = document.getElementById('btn-settings');
  const quickActions = document.getElementById('quick-actions');
  const modal = document.getElementById('modal');
  const modalTitle = document.getElementById('modal-title');
  const modalUrl = document.getElementById('n8n-url');
  const modalError = document.getElementById('modal-error');
  const modalSave = document.getElementById('modal-save');
  const modalCancel = document.getElementById('modal-cancel');

  // ---------- State ----------
  // Stable identity for favourites (shared across devices on your LAN);
  // sessionId below is per-conversation and only scopes chat memory.
  const USER_ID = 'household';
  const LS_SESSION = 'flippy.sessionId';
  const LS_HISTORY = 'flippy.history';
  let sessionId = localStorage.getItem(LS_SESSION) || newSessionId();
  let history = loadHistory();
  let busy = false;

  function newSessionId() {
    const id = 'ui-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2));
    localStorage.setItem(LS_SESSION, id);
    return id;
  }

  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(LS_HISTORY)) || []; } catch { return []; }
  }
  function saveHistory() {
    try { localStorage.setItem(LS_HISTORY, JSON.stringify(history.slice(-80))); } catch { /* full */ }
  }

  // ---------- Markdown-lite (safe: escapes HTML first) ----------
  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function inlineMd(s) {
    return escapeHtml(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }

  // ---------- Deal line parser ----------
  // Matches Flippy's format:
  //  • Item — [2 for] $5.99[/lb] [500g] @ Store (valid until May 14) — Save $2 (25% off)
  function parseDealLine(raw) {
    const line = raw.replace(/^\s*[•\-*]\s*/, '').trim();
    if (!line || !/[$@]/.test(line) || !line.includes('@')) return null;

    const dashSplit = line.split(/\s+—\s+|\s+--\s+/);
    if (dashSplit.length < 2) return null;

    const name = dashSplit[0].replace(/\*+|`/g, '').trim();
    const rest = dashSplit.slice(1).join(' — ');

    const priceMatch = rest.match(/((?:\d+\s+for\s+)?)\$\s?([\d,]+(?:\.\d+)?)((?:\s?\/\s?[a-zA-Z.]+)?)/);
    if (!priceMatch) return null;

    const atIdx = rest.indexOf('@');
    if (atIdx === -1) return null;
    let afterAt = rest.slice(atIdx + 1).trim();

    let validUntil = null;
    const validMatch = afterAt.match(/\((?:valid\s+(?:until|through|thru)\s+)?([^)]+)\)/i);
    if (validMatch && /valid/i.test(validMatch[0])) validUntil = validMatch[1].trim();

    let store = afterAt.split(/\s*\(/)[0].split(/\s+—\s+/)[0].trim();
    if (!store) return null;

    // Savings note: anything like "Save $5", "17% off", "Limit 2" after store/date
    let save = null;
    const saveMatch = rest.match(/(Save\s+\$[\d.,]+(?:\s*\([^)]*\))?|\d+%\s*off)/i);
    if (saveMatch) save = saveMatch[1].trim();

    // Quantity/size between price and @ (e.g. "500g each", "12-pack")
    const betweenPriceAndAt = rest.slice(priceMatch.index + priceMatch[0].length, atIdx).trim();
    let qty = betweenPriceAndAt.replace(/^[—–-\s]+|[—–-\s]+$/g, '') || null;

    // ...or a trailing segment like "— 500g each" / "— Limit 2" after the store
    if (!qty) {
      const segs = rest.split(/\s+—\s+|\s+--\s+/);
      const last = segs[segs.length - 1].trim();
      if (segs.length > 1 && !last.includes('@') && !/save\s+\$|%\s*off/i.test(last)) qty = last;
    }

    return {
      name,
      prefix: priceMatch[1].trim() || null,
      price: priceMatch[2],
      suffix: priceMatch[3] ? priceMatch[3].replace(/\s/g, '') : null,
      qty,
      store,
      validUntil,
      save,
    };
  }

  function dealCardHtml(deal, isBest) {
    const metaBits = [];
    metaBits.push(`<span class="deal-store">${escapeHtml(deal.store)}</span>`);
    if (deal.qty) metaBits.push(`<span>${escapeHtml(deal.qty)}</span>`);
    if (deal.validUntil) metaBits.push(`<span>until ${escapeHtml(deal.validUntil)}</span>`);
    if (deal.save) metaBits.push(`<span class="deal-save">${escapeHtml(deal.save)}</span>`);
    return `
      <div class="deal-card${isBest ? ' best' : ''}">
        ${isBest ? '<span class="best-tag">Best price</span>' : ''}
        <div class="deal-name">${escapeHtml(deal.name)}</div>
        <div class="deal-price">
          ${deal.prefix ? `<span class="prefix">${escapeHtml(deal.prefix)} </span>` : ''}$${escapeHtml(deal.price)}${deal.suffix ? `<span class="suffix">${escapeHtml(deal.suffix)}</span>` : ''}
        </div>
        <div class="deal-meta">${metaBits.join('')}</div>
      </div>`;
  }

  // ---------- Message renderer ----------
  function renderBotContent(text) {
    const lines = text.split('\n');
    const out = [];
    let dealBuffer = [];
    let listBuffer = [];

    const flushDeals = () => {
      if (!dealBuffer.length) return;
      const cards = dealBuffer.map((d, i) => dealCardHtml(d, i === 0 && dealBuffer.length > 1)).join('');
      out.push(`<div class="deal-group">${cards}</div>`);
      dealBuffer = [];
    };
    const flushList = () => {
      if (!listBuffer.length) return;
      out.push(`<ul>${listBuffer.map((li) => `<li>${inlineMd(li)}</li>`).join('')}</ul>`);
      listBuffer = [];
    };

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      const isBullet = /^\s*[•\-*]\s+/.test(line);

      if (isBullet) {
        const deal = parseDealLine(line);
        if (deal) {
          flushList();
          dealBuffer.push(deal);
          continue;
        }
        flushDeals();
        listBuffer.push(line.replace(/^\s*[•\-*]\s+/, ''));
        continue;
      }

      flushDeals();
      flushList();

      if (!line.trim()) continue;
      const h = line.match(/^(#{1,4})\s+(.*)/);
      if (h) {
        out.push(`<h${Math.min(h[1].length + 2, 4)}>${inlineMd(h[2])}</h${Math.min(h[1].length + 2, 4)}>`);
      } else {
        out.push(`<p>${inlineMd(line)}</p>`);
      }
    }
    flushDeals();
    flushList();
    return out.join('');
  }

  function addMessage(role, text, opts = {}) {
    const wrap = document.createElement('div');
    wrap.className = `msg ${role}${opts.error ? ' error' : ''}`;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (role === 'bot') bubble.innerHTML = renderBotContent(text);
    else bubble.textContent = text;
    wrap.appendChild(bubble);
    chatEl.appendChild(wrap);
    scrollToBottom();
    return bubble;
  }

  function scrollToBottom() {
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  function showWelcome() {
    chatEl.innerHTML = `
      <div class="welcome">
        <div class="big">🛒</div>
        <h2>Hey, I'm Flippy!</h2>
        <p>Ask me about grocery deals in Calgary — a single item, your whole list, or a recipe. I'll check every flyer for you.</p>
      </div>`;
  }

  function renderHistory() {
    chatEl.innerHTML = '';
    if (!history.length) return showWelcome();
    for (const m of history) addMessage(m.role, m.text, { error: m.error });
  }

  // ---------- Streaming chat ----------
  async function sendMessage(text) {
    if (busy || !text.trim()) return;
    busy = true;
    updateSendState();

    const welcome = chatEl.querySelector('.welcome');
    if (welcome) welcome.remove();

    history.push({ role: 'user', text });
    saveHistory();
    addMessage('user', text);

    // Typing indicator inside a fresh bot bubble
    const bubble = addMessage('bot', '');
    bubble.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';

    let acc = '';
    let renderQueued = false;
    const renderAcc = () => {
      if (renderQueued) return;
      renderQueued = true;
      requestAnimationFrame(() => {
        renderQueued = false;
        bubble.innerHTML = renderBotContent(acc) || '<div class="typing"><span></span><span></span><span></span></div>';
        scrollToBottom();
      });
    };

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, userId: USER_ID, action: 'sendMessage', chatInput: text }),
      });

      if (res.status === 409) {
        bubble.parentElement.remove();
        openModal(true);
        return;
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        let errMsg = `n8n returned ${res.status}`;
        try {
          const err = JSON.parse(errText);
          errMsg = err.error || err.message || errMsg;
        } catch { if (errText.trim()) errMsg = errText.trim().slice(0, 300); }
        throw new Error(errMsg);
      }

      // n8n streams newline-delimited JSON chunks (labelled application/json,
      // sometimes SSE-framed). Always read as a stream and parse line-by-line;
      // whatever doesn't parse is collected and handled as a whole afterwards.
      let rawFallback = '';

      const handleStreamLine = (line) => {
        if (!line) return;
        if (line.startsWith('data:')) line = line.slice(5).trim();
        if (!line || line === '[DONE]') return;
        try {
          const obj = JSON.parse(line);
          if (typeof obj === 'string') { acc += obj; }
          else if (obj.type === 'item' || obj.type === 'chunk' || obj.type === 'message') {
            acc += obj.content ?? obj.text ?? '';
          } else if (obj.type === 'error') {
            throw new Error(obj.content || 'Workflow error');
          } else if (obj.output || obj.text || obj.message) {
            acc += obj.output || obj.text || obj.message;
          }
          // begin / end / metadata chunks are ignored
        } catch (e) {
          if (e instanceof SyntaxError) rawFallback += line + '\n';
          else throw e;
        }
        renderAcc();
      };

      if (res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf('\n')) !== -1) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            handleStreamLine(line);
          }
        }
        if (buf.trim()) handleStreamLine(buf.trim());
      }

      // Nothing recognized as chunks — maybe a single (possibly multi-line) JSON
      // body from a non-streaming workflow, or plain text.
      if (!acc.trim() && rawFallback.trim()) {
        try {
          const data = JSON.parse(rawFallback);
          acc = data.output || data.text || data.message || (typeof data === 'string' ? data : rawFallback.trim());
        } catch {
          acc = rawFallback.trim();
        }
      }

      if (!acc.trim()) acc = "Hmm, I didn't get a reply from the workflow. Check that it's Active in n8n.";
      bubble.innerHTML = renderBotContent(acc);
      history.push({ role: 'bot', text: acc });
      saveHistory();
    } catch (err) {
      const msg = `⚠️ ${err.message || 'Something went wrong talking to n8n.'}`;
      bubble.parentElement.classList.add('error');
      bubble.textContent = msg;
      history.push({ role: 'bot', text: msg, error: true });
      saveHistory();
    } finally {
      busy = false;
      updateSendState();
      scrollToBottom();
    }
  }

  // ---------- Composer ----------
  function updateSendState() {
    sendBtn.disabled = busy || !inputEl.value.trim();
  }

  inputEl.addEventListener('input', () => {
    updateSendState();
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      formEl.requestSubmit();
    }
  });

  formEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text || busy) return;
    inputEl.value = '';
    inputEl.style.height = 'auto';
    updateSendState();
    sendMessage(text);
  });

  quickActions.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip && !busy) sendMessage(chip.dataset.prompt);
  });

  newChatBtn.addEventListener('click', () => {
    if (busy) return;
    sessionId = newSessionId();
    history = [];
    saveHistory();
    showWelcome();
  });

  // ---------- Settings modal ----------
  let firstRun = false;

  function openModal(isFirstRun) {
    firstRun = Boolean(isFirstRun);
    modalTitle.textContent = firstRun ? 'Connect to n8n' : 'Settings';
    modalCancel.classList.toggle('hidden', firstRun);
    modalError.classList.add('hidden');
    modal.classList.remove('hidden');
    modalUrl.focus();
  }

  function closeModal() {
    modal.classList.add('hidden');
  }

  settingsBtn.addEventListener('click', async () => {
    try {
      const cfg = await (await fetch('/api/config')).json();
      if (cfg.chatUrl) modalUrl.value = cfg.chatUrl;
      openModal(!cfg.configured);
    } catch {
      openModal(false);
    }
  });

  modalCancel.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal && !firstRun) closeModal();
  });

  modalSave.addEventListener('click', async () => {
    modalError.classList.add('hidden');
    modalSave.disabled = true;
    modalSave.textContent = 'Connecting…';
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: modalUrl.value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save.');
      modalUrl.value = data.chatUrl;
      closeModal();
    } catch (err) {
      modalError.textContent = err.message;
      modalError.classList.remove('hidden');
    } finally {
      modalSave.disabled = false;
      modalSave.textContent = 'Save & connect';
    }
  });

  modalUrl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') modalSave.click();
  });

  // Debug hook for testing the renderer from the console
  window.__flippy = { parseDealLine, renderBotContent };

  // ---------- Boot ----------
  (async function boot() {
    renderHistory();
    updateSendState();
    try {
      const cfg = await (await fetch('/api/config')).json();
      if (!cfg.configured) openModal(true);
      else if (cfg.chatUrl) modalUrl.value = cfg.chatUrl;
    } catch {
      /* server unreachable — errors will surface on send */
    }
  })();
})();
