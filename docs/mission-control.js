'use strict';

if (typeof marked !== 'undefined') {
  marked.setOptions({ breaks: true, gfm: true });
}

const REFRESH_INTERVAL   = 60_000;
const CHAT_POLL_INTERVAL = 3_000;
const TOKEN_KEY          = 'mc_token';
const LAST_SEEN_KEY      = 'mc_last_seen';

const AGENT_EMOJI = {
  conductor: '🚀',
  main:      '🐙',
  jared:     '🐙',
  atlas:     '🤖',
};

// ── Auth ──────────────────────────────────────────────────────────────────────

function getToken()    { return localStorage.getItem(TOKEN_KEY); }
function clearToken()  { localStorage.removeItem(TOKEN_KEY); }
function authHeaders() {
  const t = getToken();
  const h = { 'ngrok-skip-browser-warning': 'true' };
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}
(function checkAuth() {
  if (!getToken()) window.location.href = '/login';
})();

async function apiFetch(url) {
  const sep = url.includes('?') ? '&' : '?';
  const res = await fetch(url + sep + 't=' + Date.now(), { headers: authHeaders() });
  if (res.status === 401) { clearToken(); window.location.href = '/login'; throw new Error('Unauthorized'); }
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function apiFetchPost(url, body) {
  const h = authHeaders();
  const opts = { method: 'POST', headers: h };
  if (body !== undefined) {
    h['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (res.status === 401) { clearToken(); window.location.href = '/login'; throw new Error('Unauthorized'); }
  return res.json();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ago(ts) {
  if (!ts) return '—';
  const date    = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
  const diffMs  = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1)  return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24)   return `${diffH}h ago`;
  return `${Math.floor(diffH / 24)}d ago`;
}

function agentAgeClass(heartbeat) {
  if (!heartbeat) return 'stale';
  const diffMin = (Date.now() - new Date(heartbeat).getTime()) / 60000;
  if (diffMin < 30)  return 'active';
  if (diffMin < 120) return 'idle';
  return 'stale';
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls)             e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function fmt(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3);
  return String(v);
}

function kpiColor(value, target) {
  if (typeof value !== 'number' || typeof target !== 'number') return '';
  const ratio = value / target;
  if (ratio >= 1)   return 'green';
  if (ratio >= 0.8) return 'yellow';
  return 'red';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function flatten(nodes, out = []) {
  for (const n of nodes) {
    out.push(n);
    if (n.children?.length) flatten(n.children, out);
  }
  return out;
}

function lastTs(node) {
  const note = Array.isArray(node.notes) ? node.notes[node.notes.length - 1]
             : (node.notes && typeof node.notes === 'object') ? node.notes
             : null;
  return note?.ts || 0;
}

function taskIcon(node) {
  if (node.status === 'blocked')                           return '🚫';
  if (node.status === 'done' || node.status === 'completed') return '✅';
  if (node.status === 'in_progress')                       return '🔄';
  return '📋';
}

function ownerClass(owner) {
  if (!owner) return 'other';
  const o = owner.toLowerCase();
  if (o === 'conductor') return 'conductor';
  if (o === 'andreas')   return 'andreas';
  if (o === 'atlas')     return 'atlas';
  return 'other';
}

// ── State ─────────────────────────────────────────────────────────────────────

const state = {
  activeTaskId:  null,
  tasks:         [],
  kpis:          {},
  agentStatus:   {},
  loopStatus:    {},
  chatMessages:  {},   // `${taskId}:${mode}` -> [{role, text, timestamp}]
  waitingReply:  {},   // `${taskId}:${mode}` -> bool
  chatMode:      {},   // taskId -> 'relay' | 'cc'
  chatPollTimer: null,
  logPollTimer:  null,
  lastSeen:      JSON.parse(localStorage.getItem(LAST_SEEN_KEY) || '{}'),
  sortBy:        localStorage.getItem('mc_sort')     || 'activity',
  sortDir:       localStorage.getItem('mc_sort_dir') || 'desc',
};

function saveLastSeen() {
  localStorage.setItem(LAST_SEEN_KEY, JSON.stringify(state.lastSeen));
}

function markSeen(taskId) {
  // Use the newest timestamp across all loaded modes
  let maxTs = null;
  for (const mode of ['cc', 'relay']) {
    const msgs = state.chatMessages[`${taskId}:${mode}`] || [];
    if (!msgs.length) continue;
    const ts = msgs[msgs.length - 1].timestamp;
    if (ts && (!maxTs || new Date(ts) > new Date(maxTs))) maxTs = ts;
  }
  if (!maxTs) return;
  state.lastSeen[taskId] = maxTs;
  saveLastSeen();
}

function hasUnread(taskId) {
  if (taskId === state.activeTaskId) return false;
  const lastSeenTs = state.lastSeen[taskId];
  const modes = ['cc', 'relay'];
  return modes.some(mode => {
    const msgs = state.chatMessages[`${taskId}:${mode}`] || [];
    if (!msgs.length) return false;
    const lastMsg = msgs[msgs.length - 1];
    if (!lastMsg.timestamp) return false;
    if (!lastSeenTs) return true;
    return new Date(lastMsg.timestamp) > new Date(lastSeenTs);
  });
}

// ── Status Bar ────────────────────────────────────────────────────────────────

function renderStatusBar() {
  const bar = document.getElementById('status-bar');
  bar.innerHTML = '<span class="status-bar-label">Agents</span>';
  for (const [name, info] of Object.entries(state.agentStatus)) {
    const cls   = agentAgeClass(info.last_heartbeat);
    const emoji = AGENT_EMOJI[name] || '🤖';
    const pill  = el('div', `agent-pill ${cls}`);
    pill.innerHTML = `
      <span class="pill-status-dot"></span>
      <span>${emoji} ${name}</span>
      ${info.task ? `<span style="color:var(--text-muted);font-size:10px;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(info.task)}</span>` : ''}
      <span class="pill-time">${ago(info.last_heartbeat)}</span>
    `;
    bar.appendChild(pill);
  }
}

// ── Task Inference ────────────────────────────────────────────────────────────

function inferStatus(node) {
  if (node.status === 'blocked') return 'blocked';
  const owner = node.owner?.toLowerCase();
  if (owner && state.agentStatus[owner]) {
    const agent = state.agentStatus[owner];
    const cls   = agentAgeClass(agent.last_heartbeat);
    if (cls === 'active' && agent.status === 'cooking') return 'cooking';
    if (cls === 'stale')  return 'idle';
    return cls === 'active' ? 'cooking' : 'idle';
  }
  if (node.status === 'in_progress') return 'idle';
  return node.status || 'idle';
}

function lastPreview(node) {
  // Prefer chat messages — check relay first, then cc
  const mode  = state.chatMode[node.id] || 'cc';
  const key   = `${node.id}:${mode}`;
  const msgs  = state.chatMessages[key];
  if (msgs && msgs.length) {
    const last = msgs[msgs.length - 1];
    return { text: last.text || '', ts: last.timestamp };
  }
  // Fall back to notes
  const note = Array.isArray(node.notes) ? node.notes[node.notes.length - 1]
             : (node.notes && typeof node.notes === 'object') ? node.notes
             : null;
  if (note) return { text: note.text || '', ts: note.ts };
  return { text: node.description || '', ts: null };
}

// ── Task List ─────────────────────────────────────────────────────────────────

function lastChatTs(taskId) {
  const relay = state.chatMessages[`${taskId}:relay`] || [];
  const cc    = state.chatMessages[`${taskId}:cc`]    || [];
  const msgs  = [...relay, ...cc];
  if (!msgs.length) return 0;
  return Math.max(...msgs.map(m => {
    const ts = m.timestamp || m.ts;
    return ts ? new Date(ts).getTime() : 0;
  }));
}

const SORT_OPTIONS = [
  { key: 'activity', label: 'Activity' },
  { key: 'updated',  label: 'Updated'  },
  { key: 'created',  label: 'Created'  },
  { key: 'id',       label: '#'        },
];

function renderSortBar() {
  const bar = document.getElementById('sort-bar');
  if (!bar) return;
  const dir = state.sortDir;
  bar.innerHTML = SORT_OPTIONS.map(o => {
    const active = state.sortBy === o.key;
    const arrow  = active ? (dir === 'asc' ? ' ↑' : ' ↓') : '';
    return `<button class="sort-btn${active ? ' active' : ''}" data-sort="${o.key}">${o.label}${arrow}</button>`;
  }).join('');
  bar.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.sort === state.sortBy) {
        state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc';
      } else {
        state.sortBy  = btn.dataset.sort;
        state.sortDir = 'desc';
      }
      localStorage.setItem('mc_sort',     state.sortBy);
      localStorage.setItem('mc_sort_dir', state.sortDir);
      renderSortBar();
      renderTaskList();
    });
  });
}

function sortedTasks(tasks) {
  const sign = state.sortDir === 'asc' ? -1 : 1;
  return [...tasks].sort((a, b) => {
    let diff;
    switch (state.sortBy) {
      case 'id':
        diff = b.id - a.id;
        break;
      case 'created':
        // created_at is unix seconds → convert to ms for consistent comparison
        diff = (b.created_at || 0) * 1000 - (a.created_at || 0) * 1000;
        break;
      case 'updated':
        // no updated_at in DB; use started_at → last note (ts=unix s) → created_at
        diff = (b.started_at || lastTs(b) || b.created_at || 0) * 1000
             - (a.started_at || lastTs(a) || a.created_at || 0) * 1000;
        break;
      default: { // activity: chat tasks above no-chat; within tier sort by timestamp
        const chatA = Math.max(lastChatTs(a.id), a.last_chat_at ? new Date(a.last_chat_at).getTime() : 0);
        const chatB = Math.max(lastChatTs(b.id), b.last_chat_at ? new Date(b.last_chat_at).getTime() : 0);
        if (chatA > 0 || chatB > 0) {
          // At least one has chat — compare by chat ts (0 for no-chat pushes it below)
          diff = chatB - chatA;
        } else {
          // Neither has chat — fall back to started_at / created_at
          diff = (b.started_at || b.created_at || 0) * 1000
               - (a.started_at || a.created_at || 0) * 1000;
        }
        break;
      }
    }
    return diff * sign;
  });
}

function renderTaskList() {
  const container = document.getElementById('task-list');

  const q = (document.getElementById('task-search')?.value || '').trim().toLowerCase();
  const tasks = sortedTasks(state.tasks.filter(n => {
    if (n.children?.length) return false;
    if (!q) return true;
    return String(n.id).includes(q) ||
           (n.title       || '').toLowerCase().includes(q) ||
           (n.description || '').toLowerCase().includes(q);
  }));

  if (!tasks.length) {
    container.innerHTML = '<div class="loading">No tasks found</div>';
    return;
  }

  container.innerHTML = '';
  for (const task of tasks) {
    container.appendChild(buildTaskItem(task));
  }
}

function loopIndicator(taskId) {
  const entry = state.loopStatus[String(taskId)];
  if (!entry?.running) return '';
  if (entry.paused) return '<span class="loop-indicator" title="Loop paused">⏸</span>';
  return '<span class="loop-indicator running" title="Loop running">🔄</span>';
}

function buildTaskItem(task) {
  const preview  = lastPreview(task);
  const isActive = task.id === state.activeTaskId;
  const unread   = hasUnread(task.id);
  const timeStr  = ago(preview.ts || lastTs(task) || null);

  const item = el('div', `task-item${isActive ? ' active' : ''}`);
  item.dataset.taskId = String(task.id);

  item.innerHTML = `
    <div class="task-item-icon">${taskIcon(task)}</div>
    <div class="task-item-body">
      <div class="task-item-top">
        <span class="task-item-title">${escapeHtml(task.title)}</span>
        <span class="task-item-time">${timeStr}</span>
      </div>
      <div class="task-item-bottom">
        <span class="owner-dot ${ownerClass(task.owner)}" title="${escapeHtml(task.owner || '')}"></span>
        <span class="task-item-preview">${escapeHtml(preview.text.slice(0, 90))}</span>
        <span class="task-item-id">#${task.id}</span>
        ${loopIndicator(task.id)}
        ${unread ? '<span class="unread-dot"></span>' : ''}
      </div>
    </div>
  `;
  item.addEventListener('click', () => openChat(task.id));
  return item;
}

function updateTaskItemUnread(taskId) {
  const item = document.querySelector(`.task-item[data-task-id="${taskId}"]`);
  if (!item) return;
  const dot  = item.querySelector('.unread-dot');
  const show = hasUnread(taskId);
  if (show && !dot) {
    item.querySelector('.task-item-bottom')?.appendChild(el('span', 'unread-dot'));
    maybeNotify(taskId);
  } else if (!show && dot) {
    dot.remove();
  }
}

// ── Chat ──────────────────────────────────────────────────────────────────────

function openChat(taskId) {
  state.activeTaskId = taskId;
  history.pushState({ chat: taskId }, '', `#task-${taskId}`);

  // Sidebar active highlight
  document.querySelectorAll('.task-item').forEach(it => {
    it.classList.toggle('active', it.dataset.taskId === String(taskId));
    it.querySelector('.unread-dot')?.remove();
  });

  // Mobile: slide to chat
  document.body.classList.add('chat-open');

  // Populate header
  const task = state.tasks.find(t => t.id === taskId);
  if (task) {
    const titleEl = document.getElementById('chat-title');
    titleEl.innerHTML = `<span class="chat-task-id" title="Copy #${task.id}">#${task.id}</span>${escapeHtml(task.title)}`;
    titleEl.querySelector('.chat-task-id').addEventListener('click', e => {
      e.stopPropagation();
      navigator.clipboard?.writeText(`#${task.id}`).catch(() => {});
      showToast(`Copied #${task.id}`);
    });
    renderChatHeader(task);
  }

  document.getElementById('chat-input-area').classList.remove('disabled');
  document.getElementById('chat-input').disabled  = false;
  document.getElementById('send-btn').disabled    = false;

  // Render existing messages and mark seen
  renderMessages(taskId);
  markSeen(taskId);

  // Tabs — load persisted mode, then check for CC program support
  if (!state.chatMode[taskId]) state.chatMode[taskId] = 'cc';

  const tabsEl  = document.getElementById('chat-tabs');
  const loopBar = document.getElementById('loop-controls');

  // Always show both tabs (relay + CC)
  apiFetch(`/api/chat/${taskId}/mode`).then(modeData => {
    const resolvedMode = modeData.mode || 'cc';
    state.chatMode[taskId] = resolvedMode;
    updateTabUI(taskId);
    tabsEl.classList.remove('hidden');
    // Check for experiment program (loop controls)
    apiFetch(`/api/program/${taskId}`).then(data => {
      const hasExperiment = data.content && data.content.includes('## How to run');
      if (loopBar) loopBar.style.display = hasExperiment ? '' : 'none';
    }).catch(() => {
      if (loopBar) loopBar.style.display = 'none';
    });
    renderMessages(taskId);
    startChatPoll(taskId);
  }).catch(() => {
    state.chatMode[taskId] = 'cc';
    updateTabUI(taskId);
    tabsEl.classList.remove('hidden');
    if (loopBar) loopBar.style.display = 'none';
  });

  // Loop controls bar
  renderLoopControls(taskId);

  // Start polling
  startChatPoll(taskId);
}

function closeChat() {
  document.body.classList.remove('chat-open');
  stopChatPoll();
  state.activeTaskId = null;

  document.querySelectorAll('.task-item').forEach(it => it.classList.remove('active'));
  document.getElementById('chat-input-area').classList.add('disabled');
  document.getElementById('chat-input').disabled = true;
  document.getElementById('send-btn').disabled   = true;
  document.getElementById('loop-controls').classList.add('hidden');
  document.getElementById('chat-tabs').classList.add('hidden');
}

function updateTabUI(taskId) {
  const mode    = state.chatMode[taskId] || 'cc';
  const isCC    = mode === 'cc';
  const input   = document.getElementById('chat-input');
  const sendBtn = document.getElementById('send-btn');
  const area    = document.getElementById('chat-input-area');

  document.querySelectorAll('.chat-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.mode === mode);
  });

  if (isCC) {
    input.disabled   = false;
    sendBtn.disabled = false;
    area.classList.remove('disabled');
    input.placeholder = 'Message CC…';
  } else {
    input.disabled   = false;
    sendBtn.disabled = false;
    area.classList.remove('disabled');
    input.placeholder = 'Message…';
  }
}

function renderChatHeader(task) {
  const status  = inferStatus(task);
  const badgeEl = document.getElementById('chat-status-badge');
  badgeEl.textContent = status;
  badgeEl.className   = `badge-${status === 'cooking' ? 'cooking' : status === 'blocked' ? 'blocked' : 'idle'}`;

  const kpiEl   = document.getElementById('chat-kpis');
  const kpiData = state.kpis[String(task.id)];
  if (kpiData?.metrics) {
    kpiEl.innerHTML = Object.entries(kpiData.metrics).map(([key, m]) => {
      const col = kpiColor(m.value, m.target);
      return `<span class="kpi-pill ${col}">${key}: ${fmt(m.value)}/${fmt(m.target)}</span>`;
    }).join('');
  } else {
    kpiEl.innerHTML = '';
  }
}

// ── Message Rendering ─────────────────────────────────────────────────────────

const MAX_MSG_LEN = 500;

function renderMessages(taskId) {
  const container = document.getElementById('chat-messages');
  if (taskId !== state.activeTaskId) return;

  const key     = `${taskId}:${state.chatMode[taskId] || 'cc'}`;
  const msgs    = state.chatMessages[key] || [];
  const waiting = state.waitingReply[key];

  if (!msgs.length && !waiting) {
    container.innerHTML = '<div class="chat-placeholder">No messages yet. Start the conversation!</div>';
    return;
  }

  let html         = '';
  let prevDateStr  = null;

  for (let i = 0; i < msgs.length; i++) {
    const m       = msgs[i];
    const dateStr = m.timestamp ? new Date(m.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null;

    if (dateStr && dateStr !== prevDateStr) {
      html += `<div class="date-separator">${dateStr}</div>`;
      prevDateStr = dateStr;
    }

    const text    = m.text || '';
    const isLong  = text.length > MAX_MSG_LEN;
    const display = isLong ? text.slice(0, MAX_MSG_LEN) + '…' : text;

    const msgClass = m.role === 'user' ? 'user' : m.role === 'system' ? 'system' : 'assistant';
    const rendered = (msgClass !== 'user' && typeof marked !== 'undefined')
      ? marked.parse(display)
      : escapeHtml(display);
    html += `
      <div class="chat-msg ${msgClass}">
        <div class="chat-bubble markdown-body" data-full="${isLong ? escapeHtml(text) : ''}">${rendered}${isLong ? `<button class="msg-expand-btn" data-idx="${i}"> Show more</button>` : ''}</div>
        ${m.timestamp ? `<div class="chat-ts">${ago(m.timestamp)}</div>` : ''}
      </div>`;
  }

  if (waiting) {
    html += `
      <div class="typing-row">
        <div class="typing-bubble">
          <span class="dot"></span><span class="dot"></span><span class="dot"></span>
        </div>
        <span class="typing-label">Thinking…</span>
      </div>`;
  }

  container.innerHTML = html;
  container.scrollTop = container.scrollHeight;


  // Wire expand buttons
  container.querySelectorAll('.msg-expand-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const bubble = btn.closest('.chat-bubble');
      if (!bubble) return;
      const full = bubble.dataset.full || '';
      const isAssistant = btn.closest('.chat-msg')?.classList.contains('assistant');
      bubble.innerHTML = (isAssistant && typeof marked !== 'undefined')
        ? marked.parse(full)
        : escapeHtml(full);
    });
  });

  // Long-press to copy
  container.querySelectorAll('.chat-bubble').forEach(bubble => {
    let timer;
    bubble.addEventListener('touchstart', () => {
      timer = setTimeout(() => copyText(bubble.textContent), 600);
    }, { passive: true });
    bubble.addEventListener('touchend', () => clearTimeout(timer), { passive: true });
  });
}

function copyText(text) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

// ── Chat Polling ──────────────────────────────────────────────────────────────

async function pollChat(taskId) {
  try {
    const mode       = state.chatMode[taskId] || 'cc';
    const key        = `${taskId}:${mode}`;
    const data       = await apiFetch(`/api/chat/${taskId}?mode=${mode}`);
    const serverMsgs = data.messages || [];
    const clientMsgs = state.chatMessages[key] || [];

    // Use server as source of truth. Compare last timestamp to detect changes.
    const sLast = serverMsgs.length ? serverMsgs[serverMsgs.length - 1].timestamp : '';
    const cLast = clientMsgs.length ? clientMsgs[clientMsgs.length - 1].timestamp : '';

    if (serverMsgs.length !== clientMsgs.length || sLast !== cLast) {
      // Detect new assistant replies
      const newAssistant = serverMsgs.some(m => m.role === 'assistant' &&
        !clientMsgs.some(c => c.timestamp === m.timestamp && c.role === 'assistant'));
      if (newAssistant) state.waitingReply[key] = false;

      state.chatMessages[key] = serverMsgs;
      if (taskId === state.activeTaskId) {
        maybeNotify(taskId);
        renderMessages(taskId);
        markSeen(taskId);
      } else {
        updateTaskItemUnread(taskId);
      }
    }
  } catch { /* silent */ }
}

function startChatPoll(taskId) {
  stopChatPoll();
  pollChat(taskId);
  state.chatPollTimer = setInterval(() => pollChat(taskId), CHAT_POLL_INTERVAL);
}

function stopChatPoll() {
  if (state.chatPollTimer) {
    clearInterval(state.chatPollTimer);
    state.chatPollTimer = null;
  }
}

// ── Send Message ──────────────────────────────────────────────────────────────

async function sendMessage() {
  const taskId = state.activeTaskId;
  if (!taskId) return;

  const input   = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message) return;

  input.value = '';
  input.style.height = '';
  input.disabled = true;
  document.getElementById('send-btn').disabled = true;

  const mode = state.chatMode[taskId] || 'cc';
  const key  = `${taskId}:${mode}`;

  state.waitingReply[key] = true;
  if (!state.chatMessages[key]) state.chatMessages[key] = [];
  state.chatMessages[key].push({ role: 'user', text: message, timestamp: new Date().toISOString() });
  renderMessages(taskId);

  try {
    const res = await fetch(`/api/chat/${taskId}`, {
      method:  'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message, mode }),
    });
    if (res.status === 401) { clearToken(); window.location.href = '/login'; return; }
  } catch (e) {
    console.error('Send failed:', e);
    state.waitingReply[key] = false;
    renderMessages(taskId);
  } finally {
    input.disabled = false;
    document.getElementById('send-btn').disabled = false;
    input.focus();
  }
}

// ── Program Panel ─────────────────────────────────────────────────────────────

function openProgramPanel() {
  const taskId = state.activeTaskId;
  if (!taskId) return;

  const panel    = document.getElementById('program-panel');
  const backdrop = document.getElementById('panel-backdrop');

  document.getElementById('program-textarea').value = 'Loading…';
  document.getElementById('program-status').textContent = '';

  panel.classList.remove('hidden');
  backdrop.classList.remove('hidden');
  requestAnimationFrame(() => panel.classList.add('open'));

  apiFetch(`/api/program/${taskId}`)
    .then(data => { document.getElementById('program-textarea').value = data.content || ''; })
    .catch(() => { document.getElementById('program-textarea').value = ''; });
}

function closeProgramPanel() {
  // Restore textarea if results were shown
  const ta = document.getElementById('program-textarea');
  if (ta) ta.style.display = '';
  const rd = document.getElementById('results-display');
  if (rd) rd.style.display = 'none';
  stopLogPoll();
  const ld = document.getElementById('log-viewer');
  if (ld) ld.style.display = 'none';
  const sb = document.getElementById('save-program-btn');
  if (sb) sb.style.display = '';

  const panel    = document.getElementById('program-panel');
  const backdrop = document.getElementById('panel-backdrop');
  panel.classList.remove('open');
  backdrop.classList.add('hidden');
  setTimeout(() => panel.classList.add('hidden'), 300);
}

async function saveProgram() {
  const taskId   = state.activeTaskId;
  if (!taskId) return;
  const content  = document.getElementById('program-textarea').value;
  const statusEl = document.getElementById('program-status');
  statusEl.textContent = 'Saving…';
  try {
    const res = await fetch(`/api/program/${taskId}`, {
      method:  'PUT',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body:    JSON.stringify({ content }),
    });
    if (res.status === 401) { clearToken(); window.location.href = '/login'; return; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    statusEl.textContent = 'Saved ✓';
    setTimeout(() => { statusEl.textContent = ''; }, 2000);
  } catch (e) {
    statusEl.textContent = 'Failed: ' + e.message;
  }
}

// ── Task Details Panel ────────────────────────────────────────────────────────

function fmtDate(ts) {
  if (!ts) return '—';
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtCost(v) {
  if (v === null || v === undefined) return '—';
  return '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function detailRow(label, value) {
  if (value === null || value === undefined || value === '' || value === '—') return '';
  return `<div class="detail-row"><span class="detail-label">${label}</span><span class="detail-value">${escapeHtml(String(value))}</span></div>`;
}

async function openTaskDetailsPanel() {
  const taskId = state.activeTaskId;
  if (!taskId) return;

  const panel    = document.getElementById('task-details-panel');
  const backdrop = document.getElementById('panel-backdrop');
  const body     = document.getElementById('task-details-body');
  const titleEl  = document.getElementById('task-details-title');

  body.innerHTML = '<div class="detail-loading">Loading…</div>';
  titleEl.textContent = `Task #${taskId}`;

  panel.classList.remove('hidden');
  backdrop.classList.remove('hidden');
  requestAnimationFrame(() => panel.classList.add('open'));

  try {
    const node = await apiFetch(`/api/task/${taskId}`);
    const meta  = node.meta || {};
    const notes = Array.isArray(meta.notes) ? meta.notes : [];

    titleEl.textContent = node.title || `Task #${taskId}`;

    const statusColors = {
      done: '#3fb950', in_progress: '#d29922', blocked: '#f85149',
      open: '#8b949e', shelved: '#8b949e', refused: '#f85149',
    };
    const statusColor = statusColors[node.status] || '#8b949e';

    let notesHtml = '';
    if (notes.length) {
      notesHtml = `<div class="detail-section-title">Step Notes</div>` +
        notes.map(n => {
          const ts   = n.ts ? fmtDate(n.ts) : '';
          const prog = n.progress !== undefined ? ` <span class="detail-note-prog">${n.progress}%</span>` : '';
          return `<div class="detail-note"><span class="detail-note-ts">${ts}${prog}</span><span class="detail-note-text">${escapeHtml(n.text || '')}</span></div>`;
        }).join('');
    }

    const blockReason = meta.block_reason || meta.refuse_reason || meta.shelve_reason || meta.reject_reason || meta.question_reason;

    body.innerHTML = `
      <div class="detail-status-row">
        <span class="detail-status-badge" style="background:${statusColor}22;color:${statusColor};">${node.status || '—'}</span>
        <span class="detail-type-badge">${node.type || 'task'}</span>
      </div>

      ${node.description ? `<div class="detail-section-title">Description</div><div class="detail-description">${escapeHtml(node.description)}</div>` : ''}

      ${(node.success_criteria) ? `<div class="detail-section-title">Success Criteria</div><div class="detail-description">${escapeHtml(node.success_criteria)}</div>` : ''}

      ${blockReason ? `<div class="detail-section-title">Reason</div><div class="detail-description detail-reason">${escapeHtml(blockReason)}</div>` : ''}

      <div class="detail-section-title">Details</div>
      <div class="detail-grid">
        ${detailRow('Owner', node.owner)}
        ${detailRow('Progress', node.progress != null ? node.progress + '%' : null)}
        ${detailRow('Value', node.value)}
        ${detailRow('Cost (est)', fmtCost(node.cost_estimate))}
        ${detailRow('Cost (actual)', node.cost_actual != null ? fmtCost(node.cost_actual) : null)}
        ${detailRow('Budget', node.budget != null ? fmtCost(node.budget) : null)}
        ${detailRow('Risk', node.risk != null ? (node.risk * 100).toFixed(0) + '%' : null)}
        ${detailRow('ROI', node.roi)}
        ${detailRow('Effort (est)', node.effort_hours_estimate != null ? node.effort_hours_estimate + 'h' : null)}
        ${detailRow('Effort (actual)', node.effort_hours_actual != null ? node.effort_hours_actual + 'h' : null)}
        ${detailRow('Start date', fmtDate(node.start_date))}
        ${detailRow('End date', fmtDate(node.end_date))}
        ${detailRow('Created', fmtDate(node.created_at))}
        ${detailRow('Started', fmtDate(node.started_at))}
        ${detailRow('Completed', fmtDate(node.completed_at))}
      </div>

      ${notesHtml}
    `;
  } catch (e) {
    body.innerHTML = `<div class="detail-loading">Failed to load: ${escapeHtml(e.message)}</div>`;
  }
}

function closeTaskDetailsPanel() {
  const panel    = document.getElementById('task-details-panel');
  const backdrop = document.getElementById('panel-backdrop');
  panel.classList.remove('open');
  backdrop.classList.add('hidden');
  setTimeout(() => panel.classList.add('hidden'), 300);
}

// ── Loop Controls ─────────────────────────────────────────────────────────────

function renderLoopControls(taskId) {
  const bar     = document.getElementById('loop-controls');
  const entry   = state.loopStatus[String(taskId)];
  const running = entry?.running;
  const paused  = entry?.paused;

  // Show bar if there's any loop entry or show always — reveal it
  bar.classList.remove('hidden');

  // Buttons
  const startBtn = document.getElementById('loop-start-btn');
  const pauseBtn = document.getElementById('loop-pause-btn');
  const stopBtn  = document.getElementById('loop-stop-btn');

  startBtn.disabled = !!running;
  pauseBtn.disabled = !running;
  stopBtn.disabled  = !running;

  // Pause/Resume toggle label
  pauseBtn.textContent = (running && paused) ? '▶ Resume' : '⏸ Pause';

  // Status line
  const statusEl = document.getElementById('loop-status-line');
  if (!running) {
    statusEl.innerHTML = '<span>Loop stopped</span>';
  } else {
    const expName  = escapeHtml(entry.experiment_name || '—');
    const expNum   = entry.experiment_num || '?';
    const state_   = paused ? '<span class="loop-state-paused">PAUSED</span>' : '<span class="loop-state-running">RUNNING</span>';
    const lastR    = entry.last_result
      ? ` | R@5: ${entry.last_result.r5.toFixed(3)} [${entry.last_result.status}]`
      : '';
    const updated  = entry.started ? ` | ${ago(entry.started)}` : '';
    statusEl.innerHTML = `${state_} EXP-${String(expNum).padStart(3,'0')} ${expName}${lastR}${updated}`;
  }
}

async function loopAction(action) {
  const taskId = state.activeTaskId;
  if (!taskId) return;

  if (action === 'stop') {
    if (!confirm(`Stop the loop for task #${taskId}?`)) return;
  }

  try {
    await apiFetchPost(`/api/loop/${taskId}/${action}`);
    // Refresh status after a short delay to pick up the change
    setTimeout(refresh, 800);
  } catch (e) {
    alert(`Loop ${action} failed: ${e.message}`);
  }
}

// ── Log Viewer ────────────────────────────────────────────────────────────────

function openLogPanel() {
  const taskId = state.activeTaskId;
  if (!taskId) return;

  const panel    = document.getElementById('program-panel');
  const backdrop = document.getElementById('panel-backdrop');
  panel.querySelector('.panel-title').textContent = `Log — #${taskId}`;

  // Hide textarea and save button, show log viewer
  const ta = document.getElementById('program-textarea');
  ta.style.display = 'none';
  document.getElementById('save-program-btn').style.display = 'none';

  let logDiv = document.getElementById('log-viewer');
  if (!logDiv) {
    logDiv = document.createElement('div');
    logDiv.id = 'log-viewer';
    ta.parentNode.insertBefore(logDiv, ta);
  }
  logDiv.innerHTML = '<span class="log-empty">Loading…</span>';
  logDiv.style.display = '';

  // Hide results-display if open
  const rd = document.getElementById('results-display');
  if (rd) rd.style.display = 'none';

  document.getElementById('program-status').textContent = 'Auto-refreshes every 5s';
  panel.classList.remove('hidden');
  backdrop.classList.remove('hidden');
  requestAnimationFrame(() => panel.classList.add('open'));

  fetchLog(taskId);
  state.logPollTimer = setInterval(() => {
    if (state.activeTaskId === taskId) fetchLog(taskId);
    else stopLogPoll();
  }, 5000);
}

async function fetchLog(taskId) {
  try {
    const data   = await apiFetch(`/api/loop/${taskId}/log`);
    const lines  = data.lines || [];
    const logDiv = document.getElementById('log-viewer');
    if (!logDiv) return;
    if (!lines.length) {
      logDiv.innerHTML = '<span class="log-empty">No log entries yet.</span>';
    } else {
      logDiv.textContent = lines.join('\n');
      logDiv.scrollTop   = logDiv.scrollHeight;
    }
  } catch { /* silent */ }
}

function stopLogPoll() {
  if (state.logPollTimer) {
    clearInterval(state.logPollTimer);
    state.logPollTimer = null;
  }
}

// ── Dropdown Menu ─────────────────────────────────────────────────────────────

function openMenu() { document.getElementById('task-menu').classList.remove('hidden'); }
function closeMenu() { document.getElementById('task-menu').classList.add('hidden'); }

// ── Swipe-back gesture (mobile) ───────────────────────────────────────────────

let touchStartX = 0;
document.addEventListener('touchstart', e => {
  touchStartX = e.touches[0].clientX;
}, { passive: true });
document.addEventListener('touchend', e => {
  const dx = e.changedTouches[0].clientX - touchStartX;
  if (dx > 70 && document.body.classList.contains('chat-open')) {
    closeChat();
  }
}, { passive: true });

// ── Main Refresh ──────────────────────────────────────────────────────────────

async function refresh() {
  const indicator = document.getElementById('last-refresh');
  try {
    const { data, kpis, agentStatus, loopStatus } = await apiFetch('/api/status');

    state.tasks       = flatten(data.tree || []);
    state.kpis        = kpis         || {};
    state.agentStatus = agentStatus  || {};
    state.loopStatus  = loopStatus   || {};

    renderTaskList();

    if (state.activeTaskId) {
      const task = state.tasks.find(t => t.id === state.activeTaskId);
      if (task) renderChatHeader(task);
      renderLoopControls(state.activeTaskId);
    }

    if (indicator) indicator.textContent = new Date().toLocaleTimeString();
  } catch (e) {
    if (e.message === 'Unauthorized') return;
    console.error('Refresh failed:', e);
    if (indicator) indicator.textContent = '⚠ ' + e.message;
  }
}

// ── Event Wiring ──────────────────────────────────────────────────────────────

document.getElementById('back-btn').addEventListener('click', () => {
  closeChat();
  history.pushState({ list: true }, '', '#');
});

// Handle browser back button — stay in app instead of going to login
window.addEventListener('popstate', e => {
  if (e.state && e.state.chat) {
    openChat(e.state.chat);
  } else {
    closeChat();
  }
});

// Set initial state
history.replaceState({ list: true }, '', location.hash || '#');

document.getElementById('send-btn').addEventListener('click', sendMessage);

document.getElementById('chat-input').addEventListener('keydown', e => {
  // Desktop: Enter sends, Shift+Enter for newline
  // Mobile (<768px): Enter = newline, only Send button sends
  const isMobile = window.innerWidth < 768;
  if (e.key === 'Enter' && !e.shiftKey && !isMobile) {
    e.preventDefault();
    sendMessage();
  }
});

// Auto-grow textarea
document.getElementById('chat-input').addEventListener('input', function () {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 130) + 'px';
});

document.getElementById('menu-btn').addEventListener('click', e => {
  e.stopPropagation();
  document.getElementById('task-menu').classList.contains('hidden') ? openMenu() : closeMenu();
});

document.getElementById('task-menu').addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  closeMenu();
  const action = btn.dataset.action;
  if (action === 'program') openProgramPanel();
  if (action === 'results') {
    const id = state.activeTaskId;
    if (id) fetch(`/api/results/${id}`, {headers: authHeaders()}).then(r => {
      if (!r.ok) return alert("No results file for this task yet.");
      return r.text();
    }).then(tsv => {
      if (!tsv) return;
      // Parse TSV and show in program panel (reuse it)
      const rows = tsv.trim().split('\n').map(r => r.split('\t'));
      const header = rows[0];
      const html = '<table style="width:100%;border-collapse:collapse;font-size:0.8rem;"><thead><tr>' +
        header.map(h => `<th style="text-align:left;padding:4px 8px;border-bottom:1px solid #30363d;color:#8b949e;">${h}</th>`).join('') +
        '</tr></thead><tbody>' +
        rows.slice(1).map(r => '<tr>' + r.map((c,i) => {
          let color = '#e6edf3';
          if (header[i] === 'status') color = c === 'keep' ? '#3fb950' : c === 'discard' ? '#f85149' : '#d29922';
          return `<td style="padding:4px 8px;border-bottom:1px solid #21262d;color:${color};">${c}</td>`;
        }).join('') + '</tr>').join('') +
        '</tbody></table>';
      const panel = document.getElementById('program-panel');
      const backdrop = document.getElementById('panel-backdrop');
      panel.querySelector('.panel-title').textContent = 'Results — #' + id;
      const textarea = document.getElementById('program-textarea');
      // Hide textarea, inject results table before it
      textarea.style.display = 'none';
      let resultsDiv = document.getElementById('results-display');
      if (!resultsDiv) {
        resultsDiv = document.createElement('div');
        resultsDiv.id = 'results-display';
        resultsDiv.style.cssText = 'overflow-x:auto;padding:8px;flex:1;';
        textarea.parentNode.insertBefore(resultsDiv, textarea);
      }
      resultsDiv.innerHTML = html;
      resultsDiv.style.display = 'block';
      document.getElementById('save-program-btn').style.display = 'none';
      document.getElementById('program-status').textContent = '';
      panel.classList.remove('hidden');
      backdrop.classList.remove('hidden');
      requestAnimationFrame(() => panel.classList.add('open'));
    });
  }
  if (action === 'log') openLogPanel();
});

document.addEventListener('click', e => {
  if (!e.target.closest('#menu-btn') && !e.target.closest('#task-menu')) closeMenu();
});

document.getElementById('panel-backdrop').addEventListener('click', () => {
  if (!document.getElementById('task-details-panel').classList.contains('hidden')) {
    closeTaskDetailsPanel();
  } else {
    closeProgramPanel();
  }
});
document.getElementById('program-close-btn').addEventListener('click', closeProgramPanel);
document.getElementById('task-details-close-btn').addEventListener('click', closeTaskDetailsPanel);
document.getElementById('chat-header-info').addEventListener('click', () => {
  if (state.activeTaskId) openTaskDetailsPanel();
});
document.getElementById('save-program-btn').addEventListener('click', saveProgram);

document.getElementById('loop-start-btn').addEventListener('click', () => loopAction('start'));
document.getElementById('loop-pause-btn').addEventListener('click', () => loopAction('pause'));
document.getElementById('loop-stop-btn').addEventListener('click',  () => loopAction('stop'));

// Scroll position memory per task+mode
const chatScrollPos = {};  // `${taskId}:${mode}` -> scrollTop

document.getElementById('chat-tabs').addEventListener('click', e => {
  const tab = e.target.closest('.chat-tab');
  if (!tab) return;
  const newMode = tab.dataset.mode;
  const taskId  = state.activeTaskId;
  if (!taskId || newMode === state.chatMode[taskId]) return;

  // Save scroll position for current mode
  const messagesEl = document.getElementById('chat-messages');
  chatScrollPos[`${taskId}:${state.chatMode[taskId]}`] = messagesEl.scrollTop;

  // Switch mode
  state.chatMode[taskId] = newMode;
  updateTabUI(taskId);

  const key = `${taskId}:${newMode}`;
  if (!state.chatMessages[key]) state.chatMessages[key] = [];
  renderMessages(taskId);

  // Restore scroll position for new mode
  const savedScroll = chatScrollPos[key];
  if (savedScroll !== undefined) {
    messagesEl.scrollTop = savedScroll;
  }

  // Restart polling on the new mode
  startChatPoll(taskId);
});

// ── Notifications ─────────────────────────────────────────────────────────────

const notifiedMsgs = {};  // taskId -> last notified message timestamp
let _swReg = null;

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function subscribeToPush() {
  if (!_swReg) return;
  try {
    const res        = await fetch('/api/push/vapid-public-key', { headers: authHeaders() });
    const { publicKey } = await res.json();
    const sub        = await _swReg.pushManager.subscribe({
      userVisibleOnly:      true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    await fetch('/api/push/subscribe', {
      method:  'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body:    JSON.stringify(sub),
    });
    console.log('[push] subscribed');
  } catch (e) {
    console.warn('[push] subscribe failed:', e);
  }
}

async function initNotifications() {
  if (!('Notification' in window)) return;

  // Register service worker for Android Chrome compatibility
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/mission-control-sw.js', { scope: '/' });
      _swReg = await navigator.serviceWorker.ready;  // wait until SW is active
    } catch (e) {
      console.warn('SW registration failed:', e);
    }

    // Handle messages from SW (e.g. notification tap → open chat)
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data && e.data.type === 'OPEN_CHAT' && e.data.taskId) {
        openChat(e.data.taskId);
      }
    });
  }

  updateNotifBtn();

  // Subscribe to Web Push if permission already granted
  if (Notification.permission === 'granted') subscribeToPush();
}

function updateNotifBtn() {
  const btn = document.getElementById('notif-btn');
  if (!btn) return;
  if (!('Notification' in window)) { btn.style.display = 'none'; return; }
  const p = Notification.permission;
  btn.textContent = p === 'denied' ? '🔕' : '🔔';
  btn.title       = p === 'granted' ? 'Notifications on'
                  : p === 'denied'  ? 'Notifications blocked — enable in browser settings'
                  :                   'Enable notifications';
  btn.style.opacity = p === 'granted' ? '1' : '0.55';
}

function showToast(msg, ms = 2500) {
  let el = document.getElementById('mc-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'mc-toast';
    el.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1e293b;color:#e2e8f0;padding:8px 16px;border-radius:8px;font-size:13px;z-index:9999;pointer-events:none;transition:opacity 0.3s';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; }, ms);
}

(function attachNotifBtn() {
  const btn = document.getElementById('notif-btn');
  if (!btn) { console.warn('[notif] button not found'); return; }
  btn.addEventListener('click', async () => {
    if (!('Notification' in window)) { showToast('Notifications not supported in this browser'); return; }
    const p = Notification.permission;
    if (p === 'denied') {
      showToast('Blocked — enable in Vivaldi Settings → Site Info → Notifications', 4000);
      return;
    }
    if (p === 'default') {
      const result = await Notification.requestPermission();
      updateNotifBtn();
      if (result === 'granted') {
        await subscribeToPush();
        showToast('Notifications enabled ✓');
      } else {
        showToast('Permission not granted');
      }
      return;
    }
    // Already granted — fire a test notification to verify the pipeline works
    if (_swReg && _swReg.active) {
      _swReg.active.postMessage({ type: 'SHOW_NOTIFICATION', title: 'Telos', body: 'Notifications are working ✓', icon: '/icons/icon-192.png', tag: 'mc-test', taskId: null });
    } else {
      new Notification('Telos', { body: 'Notifications are working ✓', icon: '/icons/icon-192.png', tag: 'mc-test' });
    }
    showToast('Notifications on — test sent ✓');
  });
}());

function maybeNotify(taskId) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  // Don't notify if the page is visible, focused, and this is the active task
  if (document.visibilityState === 'visible' && document.hasFocus() && taskId === state.activeTaskId) return;

  let bestTs = null;
  let bestText = null;
  let bestRole = null;

  for (const mode of ['cc', 'relay']) {
    const msgs = state.chatMessages[`${taskId}:${mode}`] || [];
    if (!msgs.length) continue;
    const last = msgs[msgs.length - 1];
    if (!last.timestamp) continue;
    if (!bestTs || new Date(last.timestamp) > new Date(bestTs)) {
      bestTs   = last.timestamp;
      bestText = last.text;
      bestRole = last.role;
    }
  }

  if (!bestTs) return;
  if (bestRole === 'user') return;  // don't notify for own messages
  const prev = notifiedMsgs[taskId];
  if (prev && new Date(bestTs) <= new Date(prev)) return;

  notifiedMsgs[taskId] = bestTs;

  const task  = state.tasks.find(t => t.id === taskId);
  const title = task ? `#${taskId} ${task.title || 'Task'}` : `Task #${taskId}`;
  const body  = bestText ? bestText.slice(0, 120) : 'New message';

  // Use SW-based notification (works on Android Chrome); fall back to direct
  const swReg = _swReg || (navigator.serviceWorker && navigator.serviceWorker.controller && navigator.serviceWorker.ready);
  if (_swReg && _swReg.active) {
    _swReg.active.postMessage({
      type: 'SHOW_NOTIFICATION',
      title,
      body,
      icon: '/icons/icon-192.png',
      tag: `mc-${taskId}`,
      taskId,
    });
  } else {
    const n = new Notification(title, { body, icon: '/icons/icon-192.png', tag: `mc-${taskId}` });
    n.onclick = () => { window.focus(); openChat(taskId); n.close(); };
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────

document.getElementById('task-search').addEventListener('input', renderTaskList);

renderSortBar();
initNotifications();
refresh();
setInterval(refresh, REFRESH_INTERVAL);
