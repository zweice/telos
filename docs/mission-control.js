'use strict';

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
  const res = await fetch(url + '?t=' + Date.now(), { headers: authHeaders() });
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
  chatMessages:  {},   // taskId -> [{role, text, timestamp}]
  waitingReply:  {},   // taskId -> bool
  chatMode:      {},   // taskId -> 'relay' | 'cc'
  chatPollTimer: null,
  logPollTimer:  null,
  lastSeen:      JSON.parse(localStorage.getItem(LAST_SEEN_KEY) || '{}'),
};

function saveLastSeen() {
  localStorage.setItem(LAST_SEEN_KEY, JSON.stringify(state.lastSeen));
}

function markSeen(taskId) {
  const msgs = state.chatMessages[taskId] || [];
  if (!msgs.length) return;
  state.lastSeen[taskId] = msgs[msgs.length - 1].timestamp || new Date().toISOString();
  saveLastSeen();
}

function hasUnread(taskId) {
  if (taskId === state.activeTaskId) return false;
  const msgs = state.chatMessages[taskId] || [];
  if (!msgs.length) return false;
  const lastSeenTs = state.lastSeen[taskId];
  if (!lastSeenTs) return msgs.length > 0;
  const lastMsg = msgs[msgs.length - 1];
  if (!lastMsg.timestamp) return false;
  return new Date(lastMsg.timestamp) > new Date(lastSeenTs);
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
  // Prefer chat messages
  const msgs = state.chatMessages[node.id];
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

function renderTaskList() {
  const container = document.getElementById('task-list');

  // Leaf tasks only (no parent containers), sorted by most recent activity
  const tasks = state.tasks
    .filter(n => !n.children?.length)
    .sort((a, b) => {
      const ta = lastTs(a) || 0;
      const tb = lastTs(b) || 0;
      return tb - ta;
    });

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
    document.getElementById('chat-title').textContent = `${task.title} #${task.id}`;
    renderChatHeader(task);
  }

  // Enable input
  // Show description
  let descEl = document.getElementById('chat-description');
  if (!descEl) {
    descEl = document.createElement('div');
    descEl.id = 'chat-description';
    descEl.style.cssText = 'font-size:0.7rem;color:#8b949e;margin-top:2px;max-height:2.8em;overflow:hidden;cursor:pointer;line-height:1.4;';
    descEl.title = 'Click to expand';
    descEl.addEventListener('click', () => {
      descEl.style.maxHeight = descEl.style.maxHeight === 'none' ? '2.8em' : 'none';
    });
    document.getElementById('chat-header-info').appendChild(descEl);
  }
  if (task.description) {
    // First line only for compact display
    const firstLine = task.description.split('\n')[0].slice(0, 120);
    descEl.textContent = firstLine + (task.description.length > 120 ? '…' : '');
    descEl.style.display = '';
  } else {
    descEl.style.display = 'none';
  }

  document.getElementById('chat-input-area').classList.remove('disabled');
  document.getElementById('chat-input').disabled  = false;
  document.getElementById('send-btn').disabled    = false;

  // Render existing messages and mark seen
  renderMessages(taskId);
  markSeen(taskId);

  // Mode toggle — load persisted mode then show toggle
  apiFetch(`/api/chat/${taskId}/mode`).then(data => {
    state.chatMode[taskId] = data.mode || 'relay';
    updateModeUI(taskId);
  }).catch(() => {
    state.chatMode[taskId] = 'relay';
    updateModeUI(taskId);
  });
  document.getElementById('chat-mode-toggle').classList.remove('hidden');

  // Loop controls bar
  renderLoopControls(taskId);

  // Start polling
  startChatPoll(taskId);

  // Check if task has experiment program — show/hide loop controls
  const loopBar = document.getElementById('loop-controls');
  if (loopBar) {
    apiFetch(`/api/program/${taskId}`).then(data => {
      const hasExperiment = data.content && data.content.includes('## How to run');
      loopBar.style.display = hasExperiment ? '' : 'none';
    }).catch(() => {
      loopBar.style.display = 'none';
    });
  }
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
  document.getElementById('chat-mode-toggle').classList.add('hidden');
}

function updateModeUI(taskId) {
  const mode = state.chatMode[taskId] || 'relay';
  document.getElementById('mode-relay-btn').classList.toggle('active', mode === 'relay');
  document.getElementById('mode-cc-btn').classList.toggle('active', mode === 'cc');
}

async function switchMode(taskId, mode) {
  try {
    await apiFetchPost(`/api/chat/${taskId}/mode`, { mode });
    state.chatMode[taskId] = mode;
    updateModeUI(taskId);
  } catch (e) {
    console.error('switchMode failed:', e);
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

  const msgs    = state.chatMessages[taskId] || [];
  const waiting = state.waitingReply[taskId];

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

    html += `
      <div class="chat-msg ${m.role === 'user' ? 'user' : 'assistant'}">
        <div class="chat-bubble" data-full="${isLong ? escapeHtml(text) : ''}">${escapeHtml(display)}${isLong ? `<button class="msg-expand-btn" data-idx="${i}"> Show more</button>` : ''}</div>
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
      bubble.innerHTML = escapeHtml(bubble.dataset.full || '');
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
    const data    = await apiFetch(`/api/chat/${taskId}`);
    const newMsgs = data.messages || [];
    const oldMsgs = state.chatMessages[taskId] || [];

    if (newMsgs.length !== oldMsgs.length) {
      const hasNewAssistant = newMsgs.slice(oldMsgs.length).some(m => m.role === 'assistant');
      if (hasNewAssistant) state.waitingReply[taskId] = false;
      state.chatMessages[taskId] = newMsgs;

      if (taskId === state.activeTaskId) {
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

  state.waitingReply[taskId] = true;
  if (!state.chatMessages[taskId]) state.chatMessages[taskId] = [];
  state.chatMessages[taskId].push({ role: 'user', text: message, timestamp: new Date().toISOString() });
  renderMessages(taskId);

  try {
    const mode = state.chatMode[taskId] || 'relay';
    const res = await fetch(`/api/chat/${taskId}`, {
      method:  'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message, mode }),
    });
    if (res.status === 401) { clearToken(); window.location.href = '/login'; return; }
  } catch (e) {
    console.error('Send failed:', e);
    state.waitingReply[taskId] = false;
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

    renderStatusBar();
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
  if (action === 'copy-id') {
    const id = state.activeTaskId;
    if (id) navigator.clipboard?.writeText(String(id)).catch(() => {});
  }
});

document.addEventListener('click', e => {
  if (!e.target.closest('#menu-btn') && !e.target.closest('#task-menu')) closeMenu();
});

document.getElementById('panel-backdrop').addEventListener('click', closeProgramPanel);
document.getElementById('program-close-btn').addEventListener('click', closeProgramPanel);
document.getElementById('save-program-btn').addEventListener('click', saveProgram);

document.getElementById('loop-start-btn').addEventListener('click', () => loopAction('start'));
document.getElementById('loop-pause-btn').addEventListener('click', () => loopAction('pause'));
document.getElementById('loop-stop-btn').addEventListener('click',  () => loopAction('stop'));

document.getElementById('mode-relay-btn').addEventListener('click', () => {
  if (state.activeTaskId) switchMode(state.activeTaskId, 'relay');
});
document.getElementById('mode-cc-btn').addEventListener('click', () => {
  if (state.activeTaskId) switchMode(state.activeTaskId, 'cc');
});

// ── Boot ──────────────────────────────────────────────────────────────────────

refresh();
setInterval(refresh, REFRESH_INTERVAL);
