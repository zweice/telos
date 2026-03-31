'use strict';

const REFRESH_INTERVAL = 60_000;
const DATA_PATH    = './telos-data.json';
const KPI_PATH     = './kpis.json';
const AGENT_PATH   = './agent-status.json';
const LOOP_PATH    = './loop-status.json';

// Agent emoji map
const AGENT_EMOJI = {
  conductor: '🚀',
  main: '🐙',
  jared: '🐙',
  atlas: '🤖',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function ago(ts) {
  if (!ts) return '—';
  const date = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
  const diffMs = Date.now() - date.getTime();
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
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function fmt(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3);
  return String(v);
}

function kpiColor(value, target) {
  if (typeof value !== 'number' || typeof target !== 'number') return 'green';
  const ratio = value / target;
  if (ratio >= 1)    return 'green';
  if (ratio >= 0.8)  return 'yellow';
  return 'red';
}

function kpiBarPct(value, target) {
  if (typeof value !== 'number' || typeof target !== 'number') return 0;
  return Math.min(100, (value / target) * 100);
}

function progressClass(pct) {
  if (pct >= 75) return 'high';
  if (pct >= 40) return 'mid';
  return '';
}

// ── Flatten tree ─────────────────────────────────────────────────────────────

function flatten(nodes, out = []) {
  for (const n of nodes) {
    out.push(n);
    if (n.children?.length) flatten(n.children, out);
  }
  return out;
}

// ── Status Bar ───────────────────────────────────────────────────────────────

function renderStatusBar(agents) {
  const bar = document.getElementById('status-bar');
  bar.innerHTML = '<span class="status-bar-label">Agents</span>';

  for (const [name, info] of Object.entries(agents)) {
    const cls = agentAgeClass(info.last_heartbeat);
    const emoji = AGENT_EMOJI[name] || '🤖';
    const taskTip = info.task ? ` title="${info.task}"` : '';
    const pill = el('div', `agent-pill ${cls}`);
    pill.innerHTML = `
      <span class="pill-status-dot"></span>
      <span>${emoji} ${name}</span>
      ${info.task ? `<span style="color:var(--text-dim);font-size:11px;">${info.task}</span>` : ''}
      <span class="pill-time">${ago(info.last_heartbeat)}</span>
    `;
    if (info.task) pill.title = info.task;
    bar.appendChild(pill);
  }
}

// ── Work Cards ───────────────────────────────────────────────────────────────

function inferCardStatus(node, agentStatus) {
  if (node.status === 'blocked') return 'blocked';
  const owner = node.owner?.toLowerCase();
  if (owner && agentStatus[owner]) {
    const agent = agentStatus[owner];
    const agentCls = agentAgeClass(agent.last_heartbeat);
    if (agentCls === 'active' && agent.status === 'cooking') return 'cooking';
    if (agentCls === 'stale') return 'idle';
    return agentCls === 'active' ? 'cooking' : 'idle';
  }
  return 'idle';
}

function renderKPIs(taskId, kpis) {
  const data = kpis[String(taskId)];
  if (!data?.metrics) return '';
  const rows = Object.entries(data.metrics).map(([key, m]) => {
    const col = kpiColor(m.value, m.target);
    const pct = kpiBarPct(m.value, m.target);
    return `
      <div class="kpi-row">
        <span class="kpi-name">${key}</span>
        <div class="kpi-bar-wrap"><div class="kpi-bar-fill ${col}" style="width:${pct}%"></div></div>
        <span class="kpi-value ${col}">${fmt(m.value)}</span>
        <span class="kpi-target">/ ${fmt(m.target)}</span>
      </div>`;
  }).join('');
  return `<div class="kpi-section">
    <div class="kpi-section-title">KPIs</div>
    <div class="kpi-grid">${rows}</div>
  </div>`;
}

function renderCard(node, kpis, agentStatus, loopStatus) {
  const status = inferCardStatus(node, agentStatus);
  const pct = node.progress || 0;
  const lastNote = Array.isArray(node.notes) ? node.notes[node.notes.length - 1] :
                   (node.notes && typeof node.notes === 'object') ? node.notes : null;

  const noteHtml = lastNote ? `
    <div class="last-note">
      <div class="last-note-time">${ago(lastNote.ts)}</div>
      <div>${lastNote.text || ''}</div>
    </div>` : '';

  const descHtml = node.description ? `
    <div class="card-desc collapsed" id="desc-${node.id}">${node.description}</div>
    <button class="expand-btn" onclick="toggleDesc(${node.id})" id="expand-${node.id}">▾ more</button>` : '';

  const results    = _resultsCache[node.id] || [];
  const resultsHtml = renderResultsTab(node.id, results, loopStatus || {});

  const card = el('div', `work-card ${status}`);
  card.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">${node.title}</div>
        <div class="card-id">#${node.id}</div>
      </div>
      <div class="card-meta">
        ${node.owner ? `<span class="card-owner">${node.owner}</span>` : ''}
        <span class="card-status-badge ${status}">${status}</span>
      </div>
    </div>
    <div class="progress-wrap">
      <div class="progress-label"><span>Progress</span><span>${pct}%</span></div>
      <div class="progress-bar">
        <div class="progress-fill ${progressClass(pct)}" style="width:${pct}%"></div>
      </div>
    </div>
    ${descHtml}
    ${renderKPIs(node.id, kpis)}
    ${resultsHtml}
    ${noteHtml}
  `;
  return card;
}

function renderActiveCards(all, kpis, agentStatus, loopStatus) {
  const container = document.getElementById('active-cards');
  const active = all
    .filter(n => n.status === 'in_progress' && (!n.children?.length))
    .sort((a, b) => {
      const ta = lastTs(a), tb = lastTs(b);
      return tb - ta;
    });

  document.getElementById('active-count').textContent = active.length;

  if (!active.length) {
    container.innerHTML = '<div class="empty-state">No active tasks</div>';
    return;
  }

  container.innerHTML = '';
  for (const node of active) {
    container.appendChild(renderCard(node, kpis, agentStatus, loopStatus));
  }
}

function lastTs(node) {
  const note = Array.isArray(node.notes) ? node.notes[node.notes.length - 1] :
               (node.notes && typeof node.notes === 'object') ? node.notes : null;
  return note?.ts || 0;
}

// ── Queue Panel ──────────────────────────────────────────────────────────────

function renderQueue(all) {
  const container = document.getElementById('queue-list');
  const queue = all
    .filter(n => n.status === 'new' || n.status === 'open')
    .filter(n => !n.locked)
    .sort((a, b) => (b.roi || 0) - (a.roi || 0))
    .slice(0, 5);

  if (!queue.length) {
    container.innerHTML = '<div class="empty-state">Queue empty</div>';
    return;
  }

  container.innerHTML = '';
  queue.forEach((n, i) => {
    const item = el('div', 'queue-item');
    const effort = n.effort_hours_estimate ? `${n.effort_hours_estimate}h` : null;
    const roi = n.roi ? `ROI ${n.roi}` : null;
    const owner = n.owner;
    const tags = [owner, effort, roi].filter(Boolean).map(t =>
      `<span class="queue-tag">${t}</span>`).join('');
    item.innerHTML = `
      <span class="queue-rank">${i + 1}.</span>
      <div class="queue-info">
        <div class="queue-title" title="${n.title}">${n.title}</div>
        <div class="queue-meta">${tags}</div>
      </div>`;
    container.appendChild(item);
  });
}

// ── Activity Feed ────────────────────────────────────────────────────────────

function renderActivity(all) {
  const container = document.getElementById('activity-list');
  const events = [];

  for (const n of all) {
    const notes = Array.isArray(n.notes) ? n.notes :
                  (n.notes && typeof n.notes === 'object') ? [n.notes] : [];
    for (const note of notes) {
      if (note?.ts && note?.text) {
        events.push({ ts: note.ts, task: n.title, taskId: n.id, text: note.text });
      }
    }
  }

  events.sort((a, b) => b.ts - a.ts);
  const recent = events.slice(0, 10);

  if (!recent.length) {
    container.innerHTML = '<div class="empty-state">No recent activity</div>';
    return;
  }

  container.innerHTML = '';
  for (const ev of recent) {
    const item = el('div', 'activity-item');
    item.innerHTML = `
      <div class="activity-meta">
        <span class="activity-time">${ago(ev.ts)}</span>
        <span class="activity-task">#${ev.taskId} ${ev.task}</span>
      </div>
      <div class="activity-text">${ev.text}</div>`;
    container.appendChild(item);
  }
}

// ── Toggle description ───────────────────────────────────────────────────────

window.toggleDesc = function(id) {
  const desc = document.getElementById(`desc-${id}`);
  const btn  = document.getElementById(`expand-${id}`);
  if (!desc) return;
  const collapsed = desc.classList.toggle('collapsed');
  btn.textContent = collapsed ? '▾ more' : '▴ less';
};

// ── Results TSV ──────────────────────────────────────────────────────────────

async function fetchTSV(url) {
  const res = await fetch(url + '?t=' + Date.now());
  if (!res.ok) return [];
  const text = await res.text();
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  return lines.slice(1).map(line => {
    const parts = line.split('\t');
    return {
      commit:      parts[0] || '',
      r5:          parseFloat(parts[1]) || 0,
      mc:          parseFloat(parts[2]) || 0,
      status:      parts[3] || '',
      description: parts.slice(4).join('\t') || '',
    };
  });
}

// ── Sparkline ────────────────────────────────────────────────────────────────

function renderSparkline(values, color) {
  if (!values.length) return '';
  const w = 80, h = 22, pad = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 0.001;
  const pts = values.map((v, i) => {
    const x = pad + (i / Math.max(values.length - 1, 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const last = values[values.length - 1];
  return `<svg class="sparkline" width="${w}" height="${h}" title="R@5 trend — latest: ${last.toFixed(4)}">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>
    <circle cx="${parseFloat(pts.split(' ').pop().split(',')[0])}" cy="${parseFloat(pts.split(' ').pop().split(',')[1])}" r="2" fill="${color}"/>
  </svg>`;
}

// ── Results tab ───────────────────────────────────────────────────────────────

function renderResultsTab(taskId, results, loopStatus) {
  if (!results.length) return '';

  const loop  = loopStatus[String(taskId)];
  const keeps = results.filter(r => r.status === 'keep');
  const r5vals = keeps.map(r => r.r5);
  const sparkColor = '#58a6ff';
  const spark = r5vals.length > 1 ? renderSparkline(r5vals, sparkColor) : '';

  const loopBadge = loop?.running
    ? `<span class="loop-badge running">⚡ Exp #${loop.experiment_num} running</span>`
    : `<span class="loop-badge idle">◎ idle</span>`;

  const rows = results.slice(-10).reverse().map(r => {
    const cls = r.status === 'keep' ? 'result-keep' : 'result-discard';
    const short = r.commit.length > 9 ? r.commit.slice(0, 9) : r.commit;
    return `<tr class="${cls}">
      <td class="res-commit">${short}</td>
      <td class="res-r5">${r.r5.toFixed(4)}</td>
      <td class="res-mc">${r.mc.toFixed(4)}</td>
      <td class="res-status ${r.status}">${r.status}</td>
      <td class="res-desc">${r.description}</td>
    </tr>`;
  }).join('');

  return `
    <div class="results-section">
      <div class="results-header">
        <span class="kpi-section-title">Experiments</span>
        <div class="results-meta">
          ${spark}
          ${loopBadge}
        </div>
      </div>
      <table class="results-table">
        <thead><tr>
          <th>commit</th><th>R@5</th><th>MC</th><th>status</th><th>description</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ── Fetch & Render ───────────────────────────────────────────────────────────

async function fetchJSON(url) {
  const res = await fetch(url + '?t=' + Date.now());
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

// Cache for results TSV (keyed by taskId)
const _resultsCache = {};

async function fetchResultsForTask(taskId) {
  const url = `./results-${taskId}.tsv`;
  try {
    const results = await fetchTSV(url);
    _resultsCache[taskId] = results;
    return results;
  } catch {
    return _resultsCache[taskId] || [];
  }
}

async function refresh() {
  const indicator = document.getElementById('last-refresh');
  try {
    const [data, kpis, agentStatus, loopStatus] = await Promise.all([
      fetchJSON(DATA_PATH),
      fetchJSON(KPI_PATH).catch(() => ({})),
      fetchJSON(AGENT_PATH).catch(() => ({})),
      fetchJSON(LOOP_PATH).catch(() => ({})),
    ]);

    const all = flatten(data.tree || []);

    // Fetch results for active tasks
    const activeTasks = all.filter(n => n.status === 'in_progress' && !n.children?.length);
    await Promise.all(activeTasks.map(n => fetchResultsForTask(n.id)));

    renderStatusBar(agentStatus);
    renderActiveCards(all, kpis, agentStatus, loopStatus);
    renderQueue(all);
    renderActivity(all);

    if (indicator) indicator.textContent = 'Updated ' + new Date().toLocaleTimeString();
  } catch (e) {
    console.error('Refresh failed:', e);
    if (indicator) indicator.textContent = 'Refresh failed — ' + e.message;
  }
}

// ── Boot ─────────────────────────────────────────────────────────────────────

refresh();
setInterval(refresh, REFRESH_INTERVAL);
