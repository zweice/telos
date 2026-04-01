#!/usr/bin/env node
'use strict';

// server.js — Telos dashboard + API server (port 8088)
// Replaces the old split of server.js (static) + api-server.js (port 8089).

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const os     = require('os');

const TelosDB      = require('./src/db');
const TelosQueries = require('./src/queries');

const PORT      = parseInt(process.env.PORT) || 8088;
const HOST      = process.env.HOST || '127.0.0.1';
const ROOT      = path.join(__dirname, 'docs');
const TELOS_DIR = __dirname;
const OPENCLAW  = path.join(os.homedir(), '.openclaw');

// ── MIME / Cache ──────────────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

const CACHE = {
  '.html': 'no-store',
  '.js':   'no-store',
  '.json': 'no-store',
  '.css':  'no-store',
  '.png':  'max-age=31536000, immutable',
  '.jpg':  'max-age=31536000, immutable',
  '.svg':  'max-age=31536000, immutable',
};

// ── Auth ──────────────────────────────────────────────────────────────────────

function readGatewayToken() {
  if (process.env.MC_PASSWORD) return process.env.MC_PASSWORD;
  try { return fs.readFileSync(path.join(OPENCLAW, '.gateway_token'), 'utf8').trim(); }
  catch { return 'changeme'; }
}

const validTokens = new Set();

function issueToken() {
  const token = crypto.randomBytes(32).toString('hex');
  validTokens.add(token);
  return token;
}

function checkToken(token) {
  return token && validTokens.has(token);
}

function extractToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return null;
}

// ── DB ────────────────────────────────────────────────────────────────────────

let db;
try {
  db = new TelosDB();
} catch (e) {
  console.error('DB init failed:', e.message);
  process.exit(1);
}

// ── Tree (ported from api-server.js) ─────────────────────────────────────────

function buildTree(nodes) {
  const nodeMap = new Map();
  const roots   = [];

  nodes.forEach(n => {
    nodeMap.set(n.id, {
      id:                    n.id,
      title:                 n.title,
      type:                  n.type,
      owner:                 n.owner,
      status:                n.status,
      value:                 n.value,
      cost_estimate:         n.cost_estimate,
      cost_actual:           n.cost_actual,
      roi:                   n.roi,
      effort_hours_estimate: n.effort_hours_estimate,
      effort_hours_actual:   n.effort_hours_actual,
      start_date:            n.start_date   || null,
      end_date:              n.end_date     || null,
      completed_at:          n.completed_at || null,
      progress:              n.progress     || 0,
      description:           n.description  || null,
      notes: (() => { try { return JSON.parse(n.metadata || '{}').notes || []; } catch { return []; } })(),
      constraint_weight: n.constraint_weight || 0,
      is_bottleneck:     n.is_bottleneck     || false,
      lateral_blockers:  n.lateral_blockers  || [],
      children:          [],
    });
  });

  nodes.forEach(n => {
    const node = nodeMap.get(n.id);
    if (n.parent_id) {
      const parent = nodeMap.get(n.parent_id);
      if (parent) parent.children.push(node);
    } else {
      roots.push(node);
    }
  });

  return roots;
}

function getTreeData() {
  const nodes   = db.getTree();
  const queries = new TelosQueries(db);

  const { baseROI, blockerToBlocked } = queries._buildWeightLookups();
  const weightMap = {};
  for (const n of nodes) {
    weightMap[n.id] = queries._computeConstraintWeight(n.id, baseROI, blockerToBlocked);
  }

  let bottleneckId = null;
  let maxWeight    = -Infinity;
  for (const [id, w] of Object.entries(weightMap)) {
    if (w > maxWeight) { maxWeight = w; bottleneckId = parseInt(id); }
  }

  const lateralBlockersMap = {};
  try {
    const allDeps = db.getAllDeps();
    for (const dep of allDeps) {
      if (!lateralBlockersMap[dep.blocked_id]) lateralBlockersMap[dep.blocked_id] = [];
      const blocker = db.get(dep.blocker_id);
      lateralBlockersMap[dep.blocked_id].push({
        blocker_id: dep.blocker_id,
        type:       dep.type,
        status:     blocker ? blocker.status : null,
        title:      blocker ? blocker.title  : null,
      });
    }
  } catch (_) {}

  const enriched = nodes.map(n => ({
    ...n,
    constraint_weight: weightMap[n.id] || 0,
    is_bottleneck:     n.id === bottleneckId,
    lateral_blockers:  lateralBlockersMap[n.id] || [],
  }));

  return {
    version:      '0.1.0',
    generated_at: new Date().toISOString(),
    tree:         buildTree(enriched),
  };
}

// ── KPIs ──────────────────────────────────────────────────────────────────────

function computeKpis() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'kpis.json'), 'utf8'));
  } catch { return {}; }
}

// ── Agent Status ──────────────────────────────────────────────────────────────

function getLatestSessionFile(agentName) {
  const sessDir = path.join(OPENCLAW, 'agents', agentName, 'sessions');
  try {
    const files = fs.readdirSync(sessDir)
      .filter(f => f.endsWith('.jsonl') && !f.includes('.reset') && !f.includes('.deleted') && !f.includes('.tmp'))
      .map(f => ({ f, mtime: fs.statSync(path.join(sessDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    return files.length ? path.join(sessDir, files[0].f) : null;
  } catch { return null; }
}

function lastAssistantTimestamp(filePath) {
  if (!filePath) return null;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines   = content.split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]);
        if (obj.message && obj.message.role === 'assistant' && obj.timestamp) {
          return obj.timestamp;
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return null;
}

function getAgentStatus() {
  const agents = ['conductor', 'main', 'atlas', 'forge'];
  const result = {};
  for (const agent of agents) {
    const file      = getLatestSessionFile(agent);
    const heartbeat = lastAssistantTimestamp(file);
    result[agent]   = { last_heartbeat: heartbeat };
  }
  return result;
}

// ── Loop Status ───────────────────────────────────────────────────────────────

function getLoopStatus() {
  // Check docs/loop-status.json first
  try {
    const raw    = fs.readFileSync(path.join(ROOT, 'loop-status.json'), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && Object.keys(parsed).length) return parsed;
  } catch { /* fall through */ }

  // Fall back: scan for loop-<id>.log files in telos root
  const result = {};
  try {
    const files = fs.readdirSync(TELOS_DIR).filter(f => /^loop-\d+\.log$/.test(f));
    for (const f of files) {
      const taskId  = f.match(/loop-(\d+)\.log/)[1];
      const stat    = fs.statSync(path.join(TELOS_DIR, f));
      const ageMins = (Date.now() - stat.mtimeMs) / 60000;
      let iterations = 0;
      try {
        iterations = fs.readFileSync(path.join(TELOS_DIR, f), 'utf8').split('\n').filter(Boolean).length;
      } catch { /* skip */ }
      result[taskId] = {
        running:    ageMins < 15,
        lastUpdate: stat.mtime.toISOString(),
        iterations,
      };
    }
  } catch { /* skip */ }
  return result;
}

// ── Chat helpers ──────────────────────────────────────────────────────────────

function readChatLog(taskId) {
  const logPath = path.join(ROOT, 'chat-logs', `${taskId}.jsonl`);
  try {
    return fs.readFileSync(logPath, 'utf8')
      .split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

function appendChatMessage(taskId, entry) {
  const logDir  = path.join(ROOT, 'chat-logs');
  const logPath = path.join(logDir, `${taskId}.jsonl`);
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
}

async function relayToAgent(taskId, sessionKey, message, taskInfo) {
  const gatewayToken = readGatewayToken();
  const prefix = taskInfo ? `[Mission Control — Task #${taskId}: ${taskInfo.title}]\n` : '';

  try {
    const resp = await fetch('http://localhost:18789/tools/invoke', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${gatewayToken}`,
      },
      body: JSON.stringify({
        tool: 'sessions_send',
        args: {
          sessionKey,
          message:        prefix + message,
          timeoutSeconds: 120,
        },
      }),
    });

    const data = await resp.json();

    // Gateway wraps response: { ok, result: { content: [{type,text}], details: {status,...} } }
    const details = data.result?.details || {};
    const status  = details.status;

    if (status === 'timeout') {
      appendChatMessage(taskId, {
        role:      'system',
        text:      '⏳ Agent is busy — message delivered but response timed out. It may reply later.',
        timestamp: new Date().toISOString(),
        source:    'system',
      });
    } else if (data.ok && data.result?.content?.length) {
      const text = data.result.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('\n')
        .trim();
      if (text) {
        appendChatMessage(taskId, {
          role:      'assistant',
          text,
          timestamp: new Date().toISOString(),
          source:    'agent',
          agent:     sessionKey.split(':')[1],
        });
      }
    } else if (!data.ok) {
      appendChatMessage(taskId, {
        role:      'system',
        text:      `⚠ Gateway error: ${data.error?.message || JSON.stringify(data.error)}`,
        timestamp: new Date().toISOString(),
        source:    'system',
      });
    }
  } catch (err) {
    appendChatMessage(taskId, {
      role:      'system',
      text:      `❌ Relay error: ${err.message}`,
      timestamp: new Date().toISOString(),
      source:    'system',
    });
  }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type':           'application/json',
    'Cache-Control':          'no-store',
    'X-Frame-Options':        'DENY',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', c => { b += c; });
    req.on('end', () => resolve(b));
    req.on('error', reject);
  });
}

function serveStatic(res, filePath) {
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(500); return res.end('Internal server error');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type':           MIME[ext] || 'text/plain',
      'Cache-Control':          CACHE[ext] || 'no-store',
      'X-Frame-Options':        'DENY',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(content);
  });
}

// ── Server ────────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const urlObj   = new URL(req.url, `http://${HOST}:${PORT}`);
  const pathname = urlObj.pathname;
  const method   = req.method;

  // ── Unauthenticated routes ────────────────────────────────────────────────

  if ((pathname === '/login' || pathname === '/login.html') && method === 'GET') {
    return serveStatic(res, path.join(ROOT, 'login.html'));
  }

  if (pathname === '/api/auth' && method === 'POST') {
    try {
      const { passphrase } = JSON.parse((await readBody(req)) || '{}');
      if (passphrase === readGatewayToken()) {
        return json(res, 200, { token: issueToken() });
      }
      return json(res, 401, { error: 'Invalid passphrase' });
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  // ── Auth middleware for all /api/* ────────────────────────────────────────

  if (pathname.startsWith('/api/')) {
    if (!checkToken(extractToken(req))) {
      return json(res, 401, { error: 'Unauthorized' });
    }
  }

  // ── API routes ────────────────────────────────────────────────────────────

  try {

    // GET /api/status
    if (pathname === '/api/status' && method === 'GET') {
      return json(res, 200, {
        data:        getTreeData(),
        kpis:        computeKpis(),
        agentStatus: getAgentStatus(),
        loopStatus:  getLoopStatus(),
      });
    }

    // GET /api/task/:id
    const taskMatch = pathname.match(/^\/api\/task\/(\d+)$/);
    if (taskMatch && method === 'GET') {
      const node = db.get(parseInt(taskMatch[1]));
      if (!node) return json(res, 404, { error: 'Not found' });
      let meta = {};
      try { meta = JSON.parse(node.metadata || '{}'); } catch {}
      return json(res, 200, { ...node, meta });
    }

    // GET /api/chat/:id/mode
    const chatModeMatch = pathname.match(/^\/api\/chat\/(\d+)\/mode$/);
    if (chatModeMatch && method === 'GET') {
      const id         = chatModeMatch[1];
      const hasProgram = fs.existsSync(path.join(TELOS_DIR, 'programs', `${id}.md`));
      const hasCCLog   = fs.existsSync(path.join(ROOT, 'chat-logs', `${id}.jsonl`));
      const modes      = hasProgram ? ['relay'] : ['relay'];
      if (hasProgram && hasCCLog) modes.push('cc');
      return json(res, 200, { modes, mode: modes[0], activeMode: modes[0] });
    }

    // GET|POST /api/chat/:id
    const chatMatch = pathname.match(/^\/api\/chat\/(\d+)$/);
    if (chatMatch) {
      const id = chatMatch[1];
      if (method === 'GET') {
        return json(res, 200, { messages: readChatLog(id) });
      }
      if (method === 'POST') {
        const body    = JSON.parse((await readBody(req)) || '{}');
        const { message, mode } = body;
        if (!message) return json(res, 400, { error: 'No message' });

        appendChatMessage(id, { role: 'user', text: message, timestamp: new Date().toISOString(), source: 'web' });

        if (mode !== 'cc') {
          const task      = db.get(parseInt(id));
          const agentId   = task?.owner || 'conductor';
          const sessionKey = `agent:${agentId}:main`;
          relayToAgent(id, sessionKey, message, task).catch(err =>
            console.error(`Relay failed for task ${id}:`, err.message)
          );
        }

        return json(res, 200, { ok: true, relayed: mode !== 'cc' });
      }
    }

    // GET|POST|PUT /api/program/:id
    const progMatch = pathname.match(/^\/api\/program\/(\d+)$/);
    if (progMatch) {
      const id       = progMatch[1];
      const progDir  = path.join(TELOS_DIR, 'programs');
      const progFile = path.join(progDir, `${id}.md`);
      if (method === 'GET') {
        let content = '';
        try { content = fs.readFileSync(progFile, 'utf8'); } catch {}
        return json(res, 200, { content });
      }
      if (method === 'POST' || method === 'PUT') {
        const { content } = JSON.parse((await readBody(req)) || '{}');
        if (!fs.existsSync(progDir)) fs.mkdirSync(progDir, { recursive: true });
        fs.writeFileSync(progFile, content || '');
        return json(res, 200, { ok: true });
      }
    }

    // GET /api/loop/:id/log
    const loopLogMatch = pathname.match(/^\/api\/loop\/(\d+)\/log$/);
    if (loopLogMatch && method === 'GET') {
      const logFile = path.join(TELOS_DIR, `loop-${loopLogMatch[1]}.log`);
      let lines = [];
      try { lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).slice(-200); } catch {}
      return json(res, 200, { lines });
    }

    // POST /api/loop/:id/:action
    const loopActionMatch = pathname.match(/^\/api\/loop\/(\d+)\/(start|pause|resume|stop)$/);
    if (loopActionMatch && method === 'POST') {
      return json(res, 200, { ok: true, taskId: loopActionMatch[1], action: loopActionMatch[2] });
    }

    // GET /api/results/:id
    const resultsMatch = pathname.match(/^\/api\/results\/(\d+)$/);
    if (resultsMatch && method === 'GET') {
      const tsvFile = path.join(ROOT, `results-${resultsMatch[1]}.tsv`);
      if (!fs.existsSync(tsvFile)) return json(res, 404, { error: 'No results file' });
      res.writeHead(200, {
        'Content-Type':           'text/tab-separated-values',
        'Cache-Control':          'no-store',
        'X-Frame-Options':        'DENY',
        'X-Content-Type-Options': 'nosniff',
      });
      return res.end(fs.readFileSync(tsvFile));
    }

    // GET /api/tree
    if (pathname === '/api/tree' && method === 'GET') {
      return json(res, 200, getTreeData());
    }

    // GET /api/ideas
    if (pathname === '/api/ideas' && method === 'GET') {
      db.ensureIdeasTable();
      const status = urlObj.searchParams.get('status') || null;
      const ideas  = db.listIdeas(status ? { status } : {}).map(i => ({
        id:            i.id,
        title:         i.title,
        description:   i.description   || null,
        rationale:     i.rationale     || null,
        status:        i.status,
        key_decisions: i.key_decisions || null,
        tags: (() => { try { return JSON.parse(i.tags || '[]'); } catch { return []; } })(),
        created_at:    i.created_at,
        updated_at:    i.updated_at,
      }));
      return json(res, 200, { ideas });
    }

    // GET /api/dependencies
    if (pathname === '/api/dependencies' && method === 'GET') {
      return json(res, 200, { dependencies: db.getAllDeps() });
    }

    // GET /api/health
    if (pathname === '/api/health' && method === 'GET') {
      return json(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
    }

    // POST /api/progress/:id
    const progressMatch = pathname.match(/^\/api\/progress\/(\d+)$/);
    if (progressMatch && method === 'POST') {
      const id = parseInt(progressMatch[1]);
      const { progress, note } = JSON.parse((await readBody(req)) || '{}');
      db.setProgress(id, progress !== undefined ? progress : db.get(id).progress, note);
      return json(res, 200, { ok: true, id, progress, note });
    }

    // Unmatched /api/*
    if (pathname.startsWith('/api/')) {
      return json(res, 404, { error: 'Not found' });
    }

  } catch (e) {
    console.error('API error:', pathname, e.message);
    return json(res, 500, { error: e.message });
  }

  // ── Static file serving ───────────────────────────────────────────────────

  let urlPath = pathname === '/' ? '/index.html' : pathname;
  serveStatic(res, path.join(ROOT, urlPath));
});

server.listen(PORT, HOST, () => {
  console.log(`✅ Telos server running at http://${HOST}:${PORT}`);
  console.log(`📁 Static: docs/`);
  console.log(`🔌 API: /api/status /api/task /api/chat /api/program /api/loop /api/results`);
  console.log(`🔒 Auth: POST /api/auth  →  Bearer token`);
});

process.on('SIGTERM', () => {
  console.log('Shutting down…');
  try { db.close(); } catch {}
  server.close(() => process.exit(0));
});
