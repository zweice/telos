#!/usr/bin/env node
'use strict';

/**
 * work-loop.js — Autonomous experiment loop runner (autoresearch pattern)
 *
 * Usage:
 *   node src/work-loop.js start --task 258 --agent conductor
 *   node src/work-loop.js stop --task 258
 *   node src/work-loop.js status
 *   node src/work-loop.js list
 */

const fs            = require('fs');
const path          = require('path');
const { execSync, spawnSync } = require('child_process');

const DOCS_DIR        = path.join(__dirname, '..', 'docs');
const PROGRAMS_DIR    = path.join(__dirname, '..', 'programs');
const LOOP_STATUS     = path.join(DOCS_DIR, 'loop-status.json');
const KPI_FILE        = path.join(DOCS_DIR, 'kpis.json');
const AGENT_FILE      = path.join(DOCS_DIR, 'agent-status.json');

// ── JSON helpers ─────────────────────────────────────────────────────────────

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return {}; }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ── Arg parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args  = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      flags[argv[i].slice(2)] = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')
        ? argv[++i] : true;
    } else {
      args.push(argv[i]);
    }
  }
  return { args, flags };
}

const [,, cmd, ...rest] = process.argv;
const { args, flags }   = parseArgs(rest);

// ── Results TSV ──────────────────────────────────────────────────────────────

function resultsPath(taskId) {
  return path.join(DOCS_DIR, `results-${taskId}.tsv`);
}

function readResults(taskId) {
  const file = resultsPath(taskId);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  if (lines.length < 2) return [];
  return lines.slice(1).map(line => {
    const [commit, r5, mc, status, ...desc] = line.split('\t');
    return { commit, r5: parseFloat(r5), mc: parseFloat(mc), status, description: desc.join('\t') };
  });
}

function appendResult(taskId, entry) {
  const file = resultsPath(taskId);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, 'commit\tr5\tmc\tstatus\tdescription\n', 'utf8');
  }
  const line = `${entry.commit}\t${entry.r5.toFixed(4)}\t${entry.mc.toFixed(4)}\t${entry.status}\t${entry.description}\n`;
  fs.appendFileSync(file, line, 'utf8');
}

// ── Loop status ───────────────────────────────────────────────────────────────

function readLoopStatus() {
  return readJSON(LOOP_STATUS);
}

function writeLoopStatus(status) {
  writeJSON(LOOP_STATUS, status);
}

function setLoopEntry(taskId, entry) {
  const status = readLoopStatus();
  status[String(taskId)] = entry;
  writeLoopStatus(status);
}

function clearLoopEntry(taskId) {
  const status = readLoopStatus();
  delete status[String(taskId)];
  writeLoopStatus(status);
}

// ── KPI + agent status helpers ────────────────────────────────────────────────

function updateKPIs(taskId, r5, mc) {
  const kpis = readJSON(KPI_FILE);
  const id   = String(taskId);
  if (!kpis[id]) kpis[id] = { title: `Task ${id}`, metrics: {} };
  const now = new Date().toISOString();
  kpis[id].metrics['R@5']   = { value: r5,  target: kpis[id].metrics['R@5']?.target  ?? 0.99, updated: now };
  kpis[id].metrics['MC_Acc'] = { value: mc, target: kpis[id].metrics['MC_Acc']?.target ?? 0.90, updated: now };
  writeJSON(KPI_FILE, kpis);
}

function updateAgentStatus(agentName, status, task, pid) {
  const agents = readJSON(AGENT_FILE);
  agents[agentName] = {
    ...(agents[agentName] || {}),
    status,
    last_heartbeat: new Date().toISOString(),
  };
  if (task)  agents[agentName].task = task;
  if (pid)   agents[agentName].pid  = pid;
  if (status === 'idle') {
    delete agents[agentName].task;
    delete agents[agentName].pid;
    delete agents[agentName].started;
  } else if (!agents[agentName].started) {
    agents[agentName].started = new Date().toISOString();
  }
  writeJSON(AGENT_FILE, agents);
}

// ── git helpers ────────────────────────────────────────────────────────────────

function gitCommitHash(repoDir) {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: repoDir, encoding: 'utf8' }).trim();
  } catch { return '(unknown)'; }
}

function gitCommitAll(repoDir, message) {
  execSync('git add -A', { cwd: repoDir });
  execSync(`git commit -m ${JSON.stringify(message)}`, { cwd: repoDir });
  execSync('git push', { cwd: repoDir });
  return gitCommitHash(repoDir);
}

function gitRevert(repoDir) {
  // Revert to HEAD~1 (the commit before the experiment)
  execSync('git revert --no-edit HEAD', { cwd: repoDir });
  execSync('git push', { cwd: repoDir });
}

// ── Parse Claude output for metrics ──────────────────────────────────────────

function parseMetrics(output) {
  // Look for R@5=0.XXX and MC=0.XXX or MC_Acc=0.XXX patterns
  const r5Match  = output.match(/R@5[=:]\s*(0\.\d+)/i);
  const mcMatch  = output.match(/MC(?:_Acc)?[=:]\s*(0\.\d+)/i);
  const keepMatch = output.match(/\b(KEEP|DISCARD)\b/i);

  return {
    r5:     r5Match   ? parseFloat(r5Match[1])  : null,
    mc:     mcMatch   ? parseFloat(mcMatch[1])  : null,
    keep:   keepMatch ? keepMatch[1].toUpperCase() === 'KEEP' : null,
  };
}

function parseExpName(output) {
  // Look for EXP-NNN or experiment name in output
  const expMatch = output.match(/EXP-(\d+)[:\s]+([^\n]+)/i);
  if (expMatch) return `EXP-${expMatch[1]} ${expMatch[2].trim().slice(0, 60)}`;
  return 'unnamed experiment';
}

// ── Main loop (runs in-process; start detaches via nohup) ────────────────────

async function runLoop(taskId, agentName) {
  const programFile = path.join(PROGRAMS_DIR, `${taskId}.md`);
  if (!fs.existsSync(programFile)) {
    console.error(`Program file not found: ${programFile}`);
    process.exit(1);
  }

  console.log(`[work-loop] Starting loop for task #${taskId}, agent: ${agentName}`);

  let expNum = readResults(taskId).length;
  const pid  = process.pid;

  // Determine mem90 repo dir from program file (default)
  const repoDir = path.expandEnv ? path.expandEnv('~/code/macrohard/mem90')
    : path.join(process.env.HOME, 'code', 'macrohard', 'mem90');

  // Update initial status
  setLoopEntry(taskId, {
    running: true,
    experiment_num: expNum,
    experiment_name: `Starting loop...`,
    started: new Date().toISOString(),
    pid,
    last_result: null,
  });
  updateAgentStatus(agentName, 'cooking', `#${taskId} loop — exp #${expNum}`, pid);

  // Heartbeat interval
  const hbInterval = setInterval(() => {
    updateAgentStatus(agentName, 'cooking', `#${taskId} loop — exp #${expNum}`, pid);
  }, 5 * 60 * 1000);

  // Signal handlers for graceful stop
  let stopping = false;
  process.on('SIGTERM', () => { stopping = true; });
  process.on('SIGINT',  () => { stopping = true; });

  let paused = false;
  process.on('SIGUSR1', () => {
    paused = !paused;
    console.log(`[work-loop] ${paused ? 'PAUSED' : 'RESUMED'}`);
    const entry = readLoopStatus()[taskId] || {};
    entry.paused = paused;
    setLoopEntry(taskId, entry);
  });

  while (!stopping) {
    expNum++;
    const expLabel = `EXP-${String(expNum).padStart(3, '0')}`;
    console.log(`\n[work-loop] === ${expLabel} starting ===`);

    // Update loop status
    setLoopEntry(taskId, {
      running: true,
      experiment_num: expNum,
      experiment_name: `${expLabel} running...`,
      started: new Date().toISOString(),
      pid,
      last_result: null,
    });
    updateAgentStatus(agentName, 'cooking', `#${taskId} ${expLabel}`, pid);

    // Read program and results for context
    const programText  = fs.readFileSync(programFile, 'utf8');
    const resultsLines = fs.existsSync(resultsPath(taskId))
      ? fs.readFileSync(resultsPath(taskId), 'utf8')
      : 'commit\tr5\tmc\tstatus\tdescription\n(no experiments yet)';

    const prompt = `${programText}

## Results so far
${resultsLines}

## Your turn
You are running ${expLabel}. Propose and implement ONE experiment following the program instructions.

Requirements:
1. State your hypothesis clearly
2. Implement the change (edit files as needed)
3. Run the smoke test first (1 conversation). If smoke R@5 < 0.70, DISCARD immediately without full run.
4. If smoke passes, run the full benchmark (3 conversations)
5. Extract metrics using the metric extraction command from the program
6. Output metrics in this exact format on their own line:
   R@5=<value> MC=<value>
7. State KEEP or DISCARD based on the keep/discard rules
8. Provide a one-line description of the experiment

Work in: ${repoDir}
`;

    // Invoke Claude Code
    console.log(`[work-loop] Invoking Claude Code for ${expLabel}...`);
    const result = spawnSync('claude', [
      '--dangerously-skip-permissions',
      '--print',
      '-p', prompt,
    ], {
      encoding: 'utf8',
      timeout: 30 * 60 * 1000, // 30 min max per experiment
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      },
    });

    if (result.error) {
      console.error(`[work-loop] Claude Code error:`, result.error.message);
      await sleep(30000);
      continue;
    }

    const output = (result.stdout || '') + (result.stderr || '');
    console.log(`[work-loop] Claude output (last 500 chars):\n...${output.slice(-500)}`);

    // Parse metrics
    const metrics = parseMetrics(output);
    const expName = parseExpName(output);

    if (metrics.r5 === null || metrics.mc === null) {
      console.warn(`[work-loop] Could not parse metrics from output. Skipping.`);
      continue;
    }

    const keep = metrics.keep === null
      ? shouldKeep(metrics, readResults(taskId))
      : metrics.keep;

    console.log(`[work-loop] ${expLabel}: R@5=${metrics.r5.toFixed(4)} MC=${metrics.mc.toFixed(4)} → ${keep ? 'KEEP' : 'DISCARD'}`);

    // Commit current state in mem90
    let commitHash = '(uncommitted)';
    try {
      commitHash = gitCommitAll(repoDir, `entity-tracking: ${expLabel} ${keep ? 'KEEP' : 'DISCARD'} R@5=${metrics.r5.toFixed(4)} MC=${metrics.mc.toFixed(4)}`);
    } catch (e) {
      console.warn(`[work-loop] git commit failed: ${e.message}`);
    }

    // Append to results TSV
    appendResult(taskId, {
      commit: commitHash,
      r5:     metrics.r5,
      mc:     metrics.mc,
      status: keep ? 'keep' : 'discard',
      description: expName,
    });

    // Update KPIs if keeping
    if (keep) {
      updateKPIs(taskId, metrics.r5, metrics.mc);
    }

    // Commit telos state
    try {
      gitCommitAll(
        path.join(__dirname, '..'),
        `data: ${expLabel} ${keep ? 'keep' : 'discard'} R@5=${metrics.r5.toFixed(4)}`
      );
    } catch (e) {
      console.warn(`[work-loop] telos git commit failed: ${e.message}`);
    }

    // Discard: revert mem90
    if (!keep) {
      console.log(`[work-loop] DISCARD — reverting mem90 to pre-experiment state`);
      try { gitRevert(repoDir); } catch (e) {
        console.warn(`[work-loop] git revert failed: ${e.message}`);
      }
    }

    // Update loop status
    setLoopEntry(taskId, {
      running: true,
      experiment_num: expNum,
      experiment_name: expName,
      started: new Date().toISOString(),
      pid,
      last_result: { r5: metrics.r5, mc: metrics.mc, status: keep ? 'keep' : 'discard' },
    });

    // Brief pause between iterations
    await sleep(10000);

    // Wait while paused
    while (paused && !stopping) {
      await sleep(5000);
    }
  }

  // Cleanup on stop
  clearInterval(hbInterval);
  clearLoopEntry(taskId);
  updateAgentStatus(agentName, 'idle');
  console.log(`[work-loop] Loop stopped for task #${taskId}`);
}

function shouldKeep(metrics, prior) {
  if (!prior.length) return true;
  const prev = prior.filter(r => r.status === 'keep').pop();
  if (!prev) return metrics.r5 >= 0.77;
  if (metrics.r5 >= prev.r5 + 0.005) return true;
  if (metrics.mc >= prev.mc + 0.01)  return true;
  if (metrics.r5 >= prev.r5 - 0.01 && metrics.mc >= prev.mc - 0.01) return false; // within tolerance but not improving
  return false;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── CLI commands ──────────────────────────────────────────────────────────────

if (cmd === 'start') {
  const taskId    = flags.task;
  const agentName = flags.agent || 'conductor';

  if (!taskId) {
    console.error('Usage: work-loop.js start --task <id> [--agent <name>]');
    process.exit(1);
  }

  // Check if already running
  const loopStatus = readLoopStatus();
  if (loopStatus[String(taskId)]?.running) {
    const existing = loopStatus[String(taskId)];
    console.error(`Loop already running for task #${taskId} (PID ${existing.pid})`);
    process.exit(1);
  }

  // Detach via nohup
  const logFile = path.join(__dirname, '..', `loop-${taskId}.log`);
  const { spawn } = require('child_process');
  const child = spawn(process.execPath, [__filename, '_run', '--task', taskId, '--agent', agentName], {
    detached: true,
    stdio: ['ignore', fs.openSync(logFile, 'a'), fs.openSync(logFile, 'a')],
  });
  child.unref();

  console.log(`[work-loop] Started loop for task #${taskId} (PID ${child.pid})`);
  console.log(`[work-loop] Log: ${logFile}`);

} else if (cmd === '_run') {
  // Internal: actual loop runner (called by start)
  const taskId    = flags.task;
  const agentName = flags.agent || 'conductor';
  runLoop(taskId, agentName).catch(e => {
    console.error('[work-loop] Fatal error:', e);
    process.exit(1);
  });

} else if (cmd === 'stop') {
  const taskId = flags.task;
  if (!taskId) {
    console.error('Usage: work-loop.js stop --task <id>');
    process.exit(1);
  }

  const loopStatus = readLoopStatus();
  const entry      = loopStatus[String(taskId)];

  if (!entry?.running) {
    console.log(`No loop running for task #${taskId}`);
    process.exit(0);
  }

  const pid = entry.pid;
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`[work-loop] Sent SIGTERM to PID ${pid} (task #${taskId})`);
    // Status will be cleared by the loop itself on exit
  } catch (e) {
    console.warn(`[work-loop] Could not signal PID ${pid}: ${e.message}`);
    // Force clear status
    clearLoopEntry(taskId);
    console.log(`[work-loop] Cleared stale loop status for task #${taskId}`);
  }

} else if (cmd === 'pause') {
  const taskId = flags.task;
  if (!taskId) {
    console.error('Usage: work-loop.js pause --task <id>');
    process.exit(1);
  }

  const loopStatus = readLoopStatus();
  const entry      = loopStatus[String(taskId)];

  if (!entry?.running) {
    console.log(`No loop running for task #${taskId}`);
    process.exit(0);
  }

  const pid = entry.pid;
  try {
    process.kill(pid, 'SIGUSR1');
    const willBePaused = !entry.paused;
    console.log(`[work-loop] Sent SIGUSR1 to PID ${pid} (task #${taskId}) — ${willBePaused ? 'pausing' : 'resuming'}`);
  } catch (e) {
    console.warn(`[work-loop] Could not signal PID ${pid}: ${e.message}`);
  }

} else if (cmd === 'status') {
  const loopStatus = readLoopStatus();
  const entries    = Object.entries(loopStatus);

  if (!entries.length) {
    console.log('No loops running.');
    process.exit(0);
  }

  for (const [taskId, entry] of entries) {
    const age = entry.started
      ? Math.round((Date.now() - new Date(entry.started).getTime()) / 60000) + 'm ago'
      : 'unknown';
    const result = entry.last_result
      ? `R@5=${entry.last_result.r5.toFixed(4)} MC=${entry.last_result.mc.toFixed(4)} [${entry.last_result.status}]`
      : 'no result yet';
    console.log(`Task #${taskId}: ${entry.running ? 'RUNNING' : 'STOPPED'}`);
    console.log(`  Experiment: #${entry.experiment_num} — ${entry.experiment_name}`);
    console.log(`  PID: ${entry.pid}  Started: ${age}`);
    console.log(`  Last result: ${result}`);
  }

} else if (cmd === 'list') {
  const loopStatus = readLoopStatus();
  const entries    = Object.entries(loopStatus);

  if (!entries.length) {
    console.log('No loops running.');
  } else {
    console.log(`${entries.length} loop(s) active:`);
    for (const [taskId, entry] of entries) {
      console.log(`  #${taskId}  PID=${entry.pid}  exp=#${entry.experiment_num}  ${entry.experiment_name}`);
    }
  }

} else {
  console.log(`Telos Work Loop Runner

Commands:
  start --task <id> [--agent <name>]
      Start an autonomous experiment loop for a task (detached/nohup).

  stop --task <id>
      Signal the loop to stop gracefully.

  pause --task <id>
      Toggle pause/resume on a running loop (sends SIGUSR1).

  status
      Show all running loops with current experiment info.

  list
      List active loops (compact).

Examples:
  node src/work-loop.js start --task 258 --agent conductor
  node src/work-loop.js stop --task 258
  node src/work-loop.js status
  node src/work-loop.js list

Loop reads:  programs/<task-id>.md   (steering program)
             docs/results-<task-id>.tsv  (experiment history)
Loop writes: docs/results-<task-id>.tsv  (append each result)
             docs/kpis.json              (updated on KEEP)
             docs/loop-status.json       (live status)
             docs/agent-status.json      (heartbeat)
`);
}
