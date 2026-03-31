'use strict';

const express    = require('express');
const jwt        = require('jsonwebtoken');
const fs         = require('fs');
const path       = require('path');

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
  if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(h.slice(7), SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── Data helpers ──────────────────────────────────────────────────────────────

function readJSON(fp) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
  catch { return {}; }
}

function readSessionMessages(taskId) {
  const sessDir = path.join(OPENCLAW_DIR, 'agents', 'conductor', 'sessions');
  const messages = [];
  try {
    const files = fs.readdirSync(sessDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({ f, mt: fs.statSync(path.join(sessDir, f)).mtimeMs }))
      .sort((a, b) => b.mt - a.mt)
      .slice(0, 10)
      .map(x => x.f);

    for (const file of files) {
      const lines = fs.readFileSync(path.join(sessDir, file), 'utf8')
        .split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj.role && (obj.text || obj.content)) {
            messages.push({
              role: obj.role,
              text: obj.text || (
                Array.isArray(obj.content)
                  ? obj.content.map(c => c.text || '').join('')
                  : String(obj.content || '')
              ),
              timestamp: obj.timestamp || obj.ts || null,
            });
          }
        } catch { /* skip malformed */ }
      }
      if (messages.length >= 50) break;
    }
  } catch { /* no sessions dir yet */ }
  return messages.slice(-50);
}

async function sendToGateway(taskId, message) {
  let token;
  try {
    token = fs.readFileSync(path.join(OPENCLAW_DIR, '.gateway_token'), 'utf8').trim();
  } catch {
    throw new Error('Gateway token not available');
  }
  const sessionKey = `agent:conductor:task:${taskId}`;
  const res = await fetch('http://localhost:18789/tools/invoke', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      tool: 'sessions_send',
      args: { sessionKey, message, timeoutSeconds: 0 },
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
  res.json({ messages: readSessionMessages(taskId) });
});

app.post('/api/chat/:taskId', requireAuth, async (req, res) => {
  const { taskId } = req.params;
  if (!/^\d+$/.test(taskId)) return res.status(400).json({ error: 'Bad taskId' });
  const { message } = req.body || {};
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message required' });
  }
  try {
    await sendToGateway(taskId, message.trim());
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
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
