'use strict';

const express    = require('express');
const jwt        = require('jsonwebtoken');
const fs         = require('fs');
const path       = require('path');
const { execSync }   = require('child_process');
const ccSession      = require('./cc-session');

const PORT        = parseInt(process.env.PORT) || 8088;
const HOST        = process.env.HOST || '127.0.0.1';
const DOCS_DIR    = path.join(__dirname, '..', 'docs');
const PROGRAMS_DIR = path.join(__dirname, '..', 'programs');
const HOME        = process.env.HOME || '/root';
const OPENCLAW_DIR = path.join(HOME, '.openclaw');

// ── Secret ────────────────────────────────────────────────────────────────────

function loadSecret() {
  if (process.env.TELOSBOARD_SECRET) return process.env.TELOSBOARD_SECRET;
  try {
    return fs.readFileSync(path.join(OPENCLAW_DIR, '.telosboard_secret'), 'utf8').trim();
  } catch {
    console.warn('[auth] TELOSBOARD_SECRET not set; using insecure default');
    return 'insecure-default-please-set-env';
  }
}

const SECRET = loadSecret();

// ── Rate limiter (/api/auth: 5 req/min per IP) ────────────────────────────────

const authAttempts = new Map(); // ip -> { count, resetAt }

function checkRateLimit(ip) {
  const now = Date.now();
  const rec = authAttempts.get(ip);
  if (!rec || now > rec.resetAt) {
    authAttempts.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (rec.count >= 5) return false;
  rec.count++;
  return true;
}

// ── Auth middleware ───────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const h = req.headers['authorization'];
  let token = (h && h.startsWith('Bearer ')) ? h.slice(7) : null;
  // Also accept token as query param (for window.open links)
  if (!token && req.query && req.query.token) token = req.query.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── Chat log helpers ──────────────────────────────────────────────────────────

const CHAT_LOG_DIR   = path.join(DOCS_DIR, 'chat-logs');
const CHAT_MODES_FILE = path.join(DOCS_DIR, 'chat-modes.json');
if (!fs.existsSync(CHAT_LOG_DIR)) fs.mkdirSync(CHAT_LOG_DIR, { recursive: true });

function readModes() {
  try { return JSON.parse(fs.readFileSync(CHAT_MODES_FILE, 'utf8')); }
  catch { return {}; }
}

function writeModes(modes) {
  fs.writeFileSync(CHAT_MODES_FILE, JSON.stringify(modes, null, 2));
}

function appendChatLog(taskId, entry) {
  const fp = path.join(CHAT_LOG_DIR, `${taskId}.jsonl`);
  fs.appendFileSync(fp, JSON.stringify(entry) + '\n');
}

function readChatLog(taskId) {
  const fp = path.join(CHAT_LOG_DIR, `${taskId}.jsonl`);
  try {
    return fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch { return []; }
}

// ── Data helpers ──────────────────────────────────────────────────────────────

function readJSON(fp) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
  catch { return {}; }
}


// ── Background response capture ───────────────────────────────────────────────

const lastResponseCheck = {};

function captureResponses() {
  const sessDir = path.join(OPENCLAW_DIR, 'agents', 'conductor', 'sessions');
  try {
    const files = fs.readdirSync(sessDir).filter(f => f.endsWith('.jsonl'));
    for (const file of files) {
      const fp = path.join(sessDir, file);
      const stat = fs.statSync(fp);
      if (lastResponseCheck[file] && stat.mtimeMs <= lastResponseCheck[file]) continue;
      lastResponseCheck[file] = stat.mtimeMs;

      const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
      for (const line of lines.slice(-10)) {
        try {
          const obj = JSON.parse(line);
          if (obj.role === 'assistant' && obj.timestamp) {
            const text = obj.text || (Array.isArray(obj.content) ? obj.content.map(c => c.text || '').join('') : '');
            const match = text.match(/\[TelosBoard #(\d+)\]/) || text.match(/#(\d+)/);
            if (match) {
              const taskId = match[1];
              const chatLog = readChatLog(taskId);
              const isDupe = chatLog.some(m => m.timestamp === obj.timestamp && m.role === 'assistant');
              if (!isDupe) {
                appendChatLog(taskId, { role: 'assistant', text, timestamp: obj.timestamp, source: 'session' });
              }
            }
          }
        } catch { /* skip malformed */ }
      }
    }
  } catch { /* no sessions dir yet */ }
}

setInterval(captureResponses, 10000);

async function sendToGateway(taskId, message) {
  let token;
  try {
    token = fs.readFileSync(path.join(OPENCLAW_DIR, '.gateway_token'), 'utf8').trim();
  } catch {
    throw new Error('Gateway token not available');
  }
  const sessionKey = process.env.CHAT_SESSION_KEY || 'agent:conductor:telegram:direct:29216737';
  const prefixedMessage = `[TelosBoard #${taskId}] ${message}`;
  const res = await fetch('http://localhost:18789/tools/invoke', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      tool: 'sessions_send',
      args: { sessionKey, message: prefixedMessage, timeoutSeconds: 0 },
    }),
  });
  if (!res.ok) throw new Error(`Gateway ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

// ── Public routes ─────────────────────────────────────────────────────────────

app.get('/login', (req, res) => res.sendFile(path.join(DOCS_DIR, 'login.html')));

app.post('/api/auth', (req, res) => {
  const ip = req.ip || 'unknown';
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many attempts' });
  const { passphrase } = req.body || {};
  if (!passphrase || passphrase !== SECRET) return res.status(401).json({ error: 'Invalid passphrase' });
  const token = jwt.sign({}, SECRET, { expiresIn: '24h' });
  res.json({ token });
});

// ── Protected API routes ──────────────────────────────────────────────────────

app.get('/api/status', requireAuth, (req, res) => {
  res.json({
    data:        readJSON(path.join(DOCS_DIR, 'telos-data.json')),
    kpis:        readJSON(path.join(DOCS_DIR, 'kpis.json')),
    agentStatus: readJSON(path.join(DOCS_DIR, 'agent-status.json')),
    loopStatus:  readJSON(path.join(DOCS_DIR, 'loop-status.json')),
  });
});

app.get('/api/results/:taskId', requireAuth, (req, res) => {
  const { taskId } = req.params;
  if (!/^\d+$/.test(taskId)) return res.status(400).json({ error: 'Bad taskId' });
  try {
    res.type('text/tab-separated-values')
       .send(fs.readFileSync(path.join(DOCS_DIR, `results-${taskId}.tsv`), 'utf8'));
  } catch {
    res.status(404).send('');
  }
});

app.get('/api/chat/:taskId', requireAuth, (req, res) => {
  const { taskId } = req.params;
  if (!/^\d+$/.test(taskId)) return res.status(400).json({ error: 'Bad taskId' });
  res.json({ messages: readChatLog(taskId) });
});

app.post('/api/chat/:taskId', requireAuth, async (req, res) => {
  const { taskId } = req.params;
  if (!/^\d+$/.test(taskId)) return res.status(400).json({ error: 'Bad taskId' });
  const { message, mode } = req.body || {};
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message required' });
  }

  const msg      = message.trim();
  const chatMode = mode || readModes()[taskId] || 'relay';

  if (chatMode === 'cc') {
    appendChatLog(taskId, { role: 'user', text: msg, timestamp: new Date().toISOString(), source: 'web', mode: 'cc' });
    ccSession.sendAsync(taskId, msg)
      .then(response => {
        appendChatLog(taskId, { role: 'assistant', text: response, timestamp: new Date().toISOString(), source: 'cc', mode: 'cc' });
      })
      .catch(err => {
        appendChatLog(taskId, { role: 'assistant', text: `❌ CC error: ${err.message}`, timestamp: new Date().toISOString(), source: 'cc', mode: 'cc' });
      });
    res.json({ ok: true, mode: 'cc', status: 'processing' });
  } else {
    try {
      await sendToGateway(taskId, msg);
      appendChatLog(taskId, { role: 'user', text: msg, timestamp: new Date().toISOString(), source: 'web', mode: 'relay' });
      res.json({ ok: true, mode: 'relay' });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  }
});

app.get('/api/chat/:taskId/mode', requireAuth, (req, res) => {
  const { taskId } = req.params;
  if (!/^\d+$/.test(taskId)) return res.status(400).json({ error: 'Bad taskId' });
  const modes = readModes();
  res.json({ mode: modes[taskId] || 'relay' });
});

app.post('/api/chat/:taskId/mode', requireAuth, (req, res) => {
  const { taskId } = req.params;
  if (!/^\d+$/.test(taskId)) return res.status(400).json({ error: 'Bad taskId' });
  const { mode } = req.body || {};
  if (mode !== 'relay' && mode !== 'cc') return res.status(400).json({ error: 'mode must be relay or cc' });
  const modes = readModes();
  modes[taskId] = mode;
  writeModes(modes);
  res.json({ ok: true, mode });
});

app.get('/api/program/:taskId', requireAuth, (req, res) => {
  const { taskId } = req.params;
  if (!/^\d+$/.test(taskId)) return res.status(400).json({ error: 'Bad taskId' });
  try {
    res.json({ content: fs.readFileSync(path.join(PROGRAMS_DIR, `${taskId}.md`), 'utf8') });
  } catch {
    res.json({ content: '' });
  }
});

app.put('/api/program/:taskId', requireAuth, (req, res) => {
  const { taskId } = req.params;
  if (!/^\d+$/.test(taskId)) return res.status(400).json({ error: 'Bad taskId' });
  const { content } = req.body || {};
  if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
  try {
    fs.writeFileSync(path.join(PROGRAMS_DIR, `${taskId}.md`), content, 'utf8');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Loop control endpoints ────────────────────────────────────────────────────

const WORK_LOOP       = path.join(__dirname, 'work-loop.js');
const LOOP_STATUS_FILE = path.join(DOCS_DIR, 'loop-status.json');

app.get('/api/loop/status', requireAuth, (req, res) => {
  res.json(readJSON(LOOP_STATUS_FILE));
});

app.get('/api/loop/:taskId/log', requireAuth, (req, res) => {
  const { taskId } = req.params;
  if (!/^\d+$/.test(taskId)) return res.status(400).json({ error: 'Bad taskId' });
  const logFile = path.join(__dirname, '..', `loop-${taskId}.log`);
  try {
    const content = fs.readFileSync(logFile, 'utf8');
    const lines   = content.split('\n').filter(Boolean);
    res.json({ lines: lines.slice(-50) });
  } catch {
    res.json({ lines: [] });
  }
});

app.post('/api/loop/:taskId/start', requireAuth, (req, res) => {
  const { taskId } = req.params;
  if (!/^\d+$/.test(taskId)) return res.status(400).json({ error: 'Bad taskId' });
  try {
    execSync(`node ${WORK_LOOP} start --task ${taskId}`, {
      env: { ...process.env },
      timeout: 10000,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.stderr?.toString() || e.message });
  }
});

app.post('/api/loop/:taskId/stop', requireAuth, (req, res) => {
  const { taskId } = req.params;
  if (!/^\d+$/.test(taskId)) return res.status(400).json({ error: 'Bad taskId' });
  try {
    execSync(`node ${WORK_LOOP} stop --task ${taskId}`, {
      env: { ...process.env },
      timeout: 10000,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.stderr?.toString() || e.message });
  }
});

app.post('/api/loop/:taskId/pause', requireAuth, (req, res) => {
  const { taskId } = req.params;
  if (!/^\d+$/.test(taskId)) return res.status(400).json({ error: 'Bad taskId' });
  try {
    execSync(`node ${WORK_LOOP} pause --task ${taskId}`, {
      env: { ...process.env },
      timeout: 10000,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.stderr?.toString() || e.message });
  }
});

// ── Static serving ────────────────────────────────────────────────────────────

app.get('/', (req, res) => res.sendFile(path.join(DOCS_DIR, 'mission-control.html')));

app.use(express.static(DOCS_DIR, {
  setHeaders(res, fp) {
    const ext = path.extname(fp);
    res.setHeader('Cache-Control',
      ['.html', '.js', '.json', '.css'].includes(ext) ? 'no-store' : 'max-age=31536000, immutable'
    );
  },
}));

app.listen(PORT, HOST, () => {
  console.log(`✅  TelosBoard  →  http://${HOST}:${PORT}`);
  console.log(`🔐  Auth: JWT 24h  |  Secret loaded: ${SECRET !== 'insecure-default-please-set-env' ? 'yes' : 'NO (insecure default!)'}`);
  console.log(`📁  Docs: ${DOCS_DIR}`);
});
