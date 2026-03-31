'use strict';

const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PROGRAMS_DIR = path.join(__dirname, '..', 'programs');
const DOCS_DIR     = path.join(__dirname, '..', 'docs');
const HOME         = process.env.HOME || '/root';
const TELOS_DIR    = path.join(__dirname, '..');

// Track which repo dirs have had at least one CC session this process lifetime.
// First message per dir gets full context prepended; subsequent use --continue.
const activeSessions = new Set();

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

async function sendAsync(taskId, message) {
  const repoDir = getTaskRepoDir(taskId);
  const isFirst = !activeSessions.has(repoDir);

  let fullMessage = message;
  if (isFirst) {
    fullMessage = buildTaskContext(taskId) + '\n\n---\n\n' + message;
  }

  return new Promise((resolve, reject) => {
    const args = [
      ...(isFirst ? [] : ['--continue']),
      '--print',
      '--dangerously-skip-permissions',
      '-p', fullMessage,
    ];

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
        return reject(new Error(`CC exit ${code}: ${stderr.slice(-500)}`));
      }
      activeSessions.add(repoDir);
      resolve(stdout.trim());
    });
  });
}

module.exports = { sendAsync, getTaskRepoDir };
