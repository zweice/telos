'use strict';

const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PROGRAMS_DIR  = path.join(__dirname, '..', 'programs');
const DOCS_DIR      = path.join(__dirname, '..', 'docs');
const HOME          = process.env.HOME || '/root';
const TELOS_DIR     = path.join(__dirname, '..');
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
  const s = readSessions(); s[String(taskId)] = sessionId; writeSessions(s);
}
function clearSession(taskId) {
  const s = readSessions(); delete s[String(taskId)]; writeSessions(s);
}

// ── Repo + context ────────────────────────────────────────────────────────────

function getTaskRepoDir(taskId) {
  const pp = path.join(PROGRAMS_DIR, taskId + '.md');
  if (fs.existsSync(pp)) {
    const content = fs.readFileSync(pp, 'utf8');
    const match = content.match(/^Repo:\s*(.+)$/m);
    if (match) {
      const dir = match[1].trim().replace(/^~/, HOME);
      if (fs.existsSync(dir)) return dir;
    }
  }
  return TELOS_DIR;
}

function buildTaskContext(taskId) {
  const parts = ['# Task #' + taskId + ' - Context\n'];
  const programFile = path.join(PROGRAMS_DIR, taskId + '.md');
  const resultsFile = path.join(DOCS_DIR, 'results-' + taskId + '.tsv');
  const telosCli    = path.join(TELOS_DIR, 'src', 'cli.js');
  const kpiCli      = path.join(TELOS_DIR, 'src', 'kpi.js');
  const workLoop    = path.join(TELOS_DIR, 'src', 'work-loop.js');

  // Program file
  if (fs.existsSync(programFile)) {
    parts.push('## Program\n' + fs.readFileSync(programFile, 'utf8'));
  }

  // Results file
  if (fs.existsSync(resultsFile)) {
    parts.push('## Results\n```\n' + fs.readFileSync(resultsFile, 'utf8') + '\n```');
  }

  // Telos commands
  parts.push([
    '## Telos Integration',
    'Available commands (run from shell):',
    '- Update progress: node ' + telosCli + ' update ' + taskId + ' --progress <N>',
    '- Add note: node ' + telosCli + ' note ' + taskId + ' "<text>"',
    '- Update KPI: node ' + kpiCli + ' set ' + taskId + ' <metric> <value>',
    '- Complete task: node ' + telosCli + ' complete ' + taskId,
    '- View task: node ' + telosCli + ' show ' + taskId,
  ].join('\n'));

  // Autoresearch awareness
  parts.push([
    '## Autoresearch Loop',
    '',
    'This task has a program file at: ' + programFile,
    'You can READ and EDIT this file to steer the autonomous experiment loop.',
    '',
    '### How the loop works',
    'An independent process runs experiments autonomously:',
    '1. Reads programs/' + taskId + '.md for instructions',
    '2. Proposes an experiment based on the program',
    '3. Implements it, runs smoke test, then full benchmark',
    '4. Parses metrics, decides KEEP or DISCARD based on rules in the program',
    '5. Commits or reverts, appends to results TSV, updates KPIs',
    '6. Repeats until stopped or targets met',
    '',
    '### Loop controls',
    '- Dashboard: Start/Pause/Stop buttons (visible when "## How to run" exists in program)',
    '- CLI: node ' + workLoop + ' start|stop|pause --task ' + taskId,
    '',
    '### Creating an autoresearch program',
    'If the user asks to set up autoresearch, create/edit programs/' + taskId + '.md.',
    'REQUIRED sections (the "## How to run" section triggers loop controls in dashboard):',
    '',
    '  Repo: ~/path/to/repo          <-- first line, tells loop which directory',
    '  # Title Research Program',
    '  ## Goal                        <-- target metrics, current values',
    '  ## Setup                       <-- repo, language, key files',
    '  ## What you CAN modify         <-- files the loop can change',
    '  ## What you CANNOT modify      <-- ground truth, off limits',
    '  ## How to run                  <-- REQUIRED: smoke test + full run commands',
    '  ## Metric extraction           <-- how to parse results',
    '  ## Keep/discard rules          <-- when to keep vs revert',
    '  ## FALSIFIED - do not retry    <-- failed experiments',
    '  ## Next experiments            <-- prioritized ideas',
    '  ## Results so far              <-- TSV log',
    '',
    '### Steering the loop',
    'When the user asks to adjust the autoresearch:',
    '- Read the current program file',
    '- Discuss what to change (metrics, rules, allowed files, experiments)',
    '- Edit the file with agreed changes',
    '- The running loop picks up changes on next iteration (reads program fresh each cycle)',
    '- Add failed experiments to FALSIFIED section so loop does not retry them',
  ].join('\n'));

  return parts.join('\n\n');
}

// ── Send message ──────────────────────────────────────────────────────────────

async function sendAsync(taskId, message) {
  const repoDir = getTaskRepoDir(taskId);
  const existingSessionId = getSessionId(taskId);
  const isNew = !existingSessionId;

  let fullMessage = message;
  if (isNew) {
    fullMessage = buildTaskContext(taskId) + '\n\n---\n\nUser message:\n' + message;
  }

  return new Promise((resolve, reject) => {
    const args = ['--print', '--dangerously-skip-permissions', '--output-format', 'json'];
    if (existingSessionId) {
      args.push('--resume', existingSessionId);
    }
    args.push('-p', fullMessage);

    const child = spawn('claude', args, {
      cwd: repoDir,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('CC timeout (5 min)'));
    }, 300000);

    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) {
        if (existingSessionId && (stderr.includes('session') || stderr.includes('not found'))) {
          clearSession(taskId);
          sendAsync(taskId, message).then(resolve).catch(reject);
          return;
        }
        return reject(new Error('CC exit ' + code + ': ' + stderr.slice(-500)));
      }
      try {
        const result = JSON.parse(stdout);
        if (result.session_id) setSessionId(taskId, result.session_id);
        const text = result.result || result.text ||
          (Array.isArray(result.content) ? result.content.filter(c => c.type === 'text').map(c => c.text).join('\n') : stdout.trim());
        resolve(text);
      } catch {
        resolve(stdout.trim());
      }
    });
  });
}

// ── Reset ─────────────────────────────────────────────────────────────────────

function resetSession(taskId) {
  clearSession(taskId);
  return { ok: true, message: 'CC session for task #' + taskId + ' cleared. Next message starts fresh.' };
}

module.exports = { sendAsync, getTaskRepoDir, resetSession, getSessionId };
