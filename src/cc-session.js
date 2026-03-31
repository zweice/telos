'use strict';

const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PROGRAMS_DIR = path.join(__dirname, '..', 'programs');
const DOCS_DIR     = path.join(__dirname, '..', 'docs');
const HOME         = process.env.HOME || '/root';
const TELOS_DIR    = path.join(__dirname, '..');
const SESSIONS_FILE = path.join(DOCS_DIR, 'cc-sessions.json');

// ── Session ID tracking ───────────────────────────────────────────────────────

function readSessions() {
  try { return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')); } catch { return {}; }
}

function writeSessions(data) {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2));
}

function getSessionId(taskId) {
  return readSessions()[String(taskId)] || null;
}

function setSessionId(taskId, sessionId) {
  const s = readSessions();
  s[String(taskId)] = sessionId;
  writeSessions(s);
}

function clearSession(taskId) {
  const s = readSessions();
  delete s[String(taskId)];
  writeSessions(s);
}

// ── Repo + context ────────────────────────────────────────────────────────────

function getTaskRepoDir(taskId) {
  const programPath = path.join(PROGRAMS_DIR, `${taskId}.md`);
  if (fs.existsSync(programPath)) {
    const content = fs.readFileSync(programPath, 'utf8');
    const match = content.match(/^Repo:\s*(.+)$/m);
    if (match) {
      const dir = match[1].trim().replace(/^~/, HOME);
      if (fs.existsSync(dir)) return dir;
    }
  }
  return TELOS_DIR;
}

function buildTaskContext(taskId) {
  const parts = [`# Task #${taskId} — Context\n`];

  const programPath = path.join(PROGRAMS_DIR, `${taskId}.md`);
  if (fs.existsSync(programPath)) {
    parts.push('## Program\n' + fs.readFileSync(programPath, 'utf8'));
  }

  const resultsPath = path.join(DOCS_DIR, `results-${taskId}.tsv`);
  if (fs.existsSync(resultsPath)) {
    parts.push('## Results\n```\n' + fs.readFileSync(resultsPath, 'utf8') + '\n```');
  }

  const telosCli = path.join(TELOS_DIR, 'src', 'cli.js');
  const kpiCli   = path.join(TELOS_DIR, 'src', 'kpi.js');
  parts.push(`## Telos Integration
Available commands (run from shell):
- Update progress: node ${telosCli} update ${taskId} --progress <N>
- Add note: node ${telosCli} note ${taskId} "<text>"
- Update KPI: node ${kpiCli} set ${taskId} <metric> <value>
- Complete task: node ${telosCli} complete ${taskId}
- View task: node ${telosCli} show ${taskId}
`);

  return parts.join('\n\n');
}

// ── Send message ──────────────────────────────────────────────────────────────

async function sendAsync(taskId, message) {
  const repoDir = getTaskRepoDir(taskId);
  const existingSessionId = getSessionId(taskId);
  const isNew = !existingSessionId;

  // First message: prepend full context. Subsequent: CC has it in session history.
  let fullMessage = message;
  if (isNew) {
    fullMessage = buildTaskContext(taskId) + '\n\n---\n\nUser message:\n' + message;
  }

  return new Promise((resolve, reject) => {
    const args = ['--print', '--dangerously-skip-permissions', '--output-format', 'json'];
    
    if (existingSessionId) {
      // Resume existing session — CC has full conversation history
      args.push('--resume', existingSessionId);
    }
    
    args.push('-p', fullMessage);

    const child = spawn('claude', args, {
      cwd: repoDir,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('CC timeout (5 min)'));
    }, 300_000);

    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) {
        // If resume failed (stale session), retry as new
        if (existingSessionId && stderr.includes('session')) {
          clearSession(taskId);
          sendAsync(taskId, message).then(resolve).catch(reject);
          return;
        }
        return reject(new Error(`CC exit ${code}: ${stderr.slice(-500)}`));
      }

      // Parse JSON output to get session ID + response text
      try {
        const result = JSON.parse(stdout);
        // Store session ID for future --resume
        if (result.session_id) {
          setSessionId(taskId, result.session_id);
        }
        // Extract text response
        const text = result.result || result.text || 
          (Array.isArray(result.content) ? result.content.filter(c => c.type === 'text').map(c => c.text).join('\n') : stdout.trim());
        resolve(text);
      } catch {
        // Fallback: treat as plain text (non-JSON mode)
        resolve(stdout.trim());
      }
    });
  });
}

// ── Reset session ─────────────────────────────────────────────────────────────

function resetSession(taskId) {
  clearSession(taskId);
  return { ok: true, message: `CC session for task #${taskId} cleared. Next message starts fresh.` };
}

module.exports = { sendAsync, getTaskRepoDir, resetSession, getSessionId };
