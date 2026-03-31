#!/usr/bin/env node
'use strict';

/**
 * kpi.js — CLI to update KPIs and agent status
 *
 * Usage:
 *   node src/kpi.js set <taskId> <metric> <value> [--target <n>]
 *   node src/kpi.js agent <name> <status> [--task <str>] [--pid <n>]
 *   node src/kpi.js show
 */

const fs   = require('fs');
const path = require('path');

const DOCS_DIR    = path.join(__dirname, '..', 'docs');
const KPI_FILE    = path.join(DOCS_DIR, 'kpis.json');
const AGENT_FILE  = path.join(DOCS_DIR, 'agent-status.json');
const LOOP_FILE   = path.join(DOCS_DIR, 'loop-status.json');

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return {}; }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function parseArgs(argv) {
  const args = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      flags[argv[i].slice(2)] = argv[i + 1] ?? true;
      i++;
    } else {
      args.push(argv[i]);
    }
  }
  return { args, flags };
}

const [,, cmd, ...rest] = process.argv;
const { args, flags } = parseArgs(rest);

// ── set <taskId> <metric> <value> [--target <n>] [--title <str>] ──────────────
if (cmd === 'set') {
  const [taskId, metric, rawValue] = args;
  if (!taskId || !metric || rawValue === undefined) {
    console.error('Usage: kpi.js set <taskId> <metric> <value> [--target <n>] [--title <str>]');
    process.exit(1);
  }

  const value = isNaN(rawValue) ? rawValue : parseFloat(rawValue);
  const kpis  = readJSON(KPI_FILE);

  if (!kpis[taskId]) kpis[taskId] = { title: flags.title || `Task ${taskId}`, metrics: {} };
  if (flags.title) kpis[taskId].title = flags.title;

  const existing = kpis[taskId].metrics[metric] || {};
  kpis[taskId].metrics[metric] = {
    value,
    target: flags.target !== undefined ? (isNaN(flags.target) ? flags.target : parseFloat(flags.target))
                                        : (existing.target ?? null),
    updated: new Date().toISOString(),
  };

  writeJSON(KPI_FILE, kpis);
  console.log(`✓ KPI set: task=${taskId} ${metric}=${value}${flags.target !== undefined ? ` target=${flags.target}` : ''}`);

// ── agent <name> <status> [--task <str>] [--pid <n>] ─────────────────────────
} else if (cmd === 'agent') {
  const [name, status] = args;
  if (!name || !status) {
    console.error('Usage: kpi.js agent <name> <status> [--task <str>] [--pid <n>]');
    process.exit(1);
  }

  const agents = readJSON(AGENT_FILE);
  const existing = agents[name] || {};

  agents[name] = {
    ...existing,
    status,
    last_heartbeat: new Date().toISOString(),
  };

  if (flags.task)    agents[name].task    = flags.task;
  if (flags.pid)     agents[name].pid     = parseInt(flags.pid);
  if (status === 'idle') {
    delete agents[name].task;
    delete agents[name].pid;
    delete agents[name].started;
  } else if (!agents[name].started) {
    agents[name].started = new Date().toISOString();
  }

  writeJSON(AGENT_FILE, agents);
  console.log(`✓ Agent updated: ${name} → ${status}${flags.task ? ` (${flags.task})` : ''}`);

// ── heartbeat <name> ──────────────────────────────────────────────────────────
} else if (cmd === 'heartbeat') {
  const [name] = args;
  if (!name) { console.error('Usage: kpi.js heartbeat <name>'); process.exit(1); }

  const agents = readJSON(AGENT_FILE);
  if (!agents[name]) agents[name] = { status: 'idle' };
  agents[name].last_heartbeat = new Date().toISOString();

  writeJSON(AGENT_FILE, agents);
  console.log(`✓ Heartbeat: ${name} @ ${agents[name].last_heartbeat}`);

// ── show ──────────────────────────────────────────────────────────────────────
} else if (cmd === 'show') {
  console.log('\n── KPIs ──');
  const kpis = readJSON(KPI_FILE);
  for (const [id, entry] of Object.entries(kpis)) {
    console.log(`\nTask #${id}: ${entry.title}`);
    for (const [metric, m] of Object.entries(entry.metrics || {})) {
      const pct = (m.target && typeof m.value === 'number')
        ? ` (${Math.round(m.value / m.target * 100)}%)`
        : '';
      console.log(`  ${metric}: ${m.value} / ${m.target ?? '?'}${pct}  [${m.updated}]`);
    }
  }

  console.log('\n── Agents ──');
  const agents = readJSON(AGENT_FILE);
  for (const [name, info] of Object.entries(agents)) {
    const hb = info.last_heartbeat
      ? Math.round((Date.now() - new Date(info.last_heartbeat).getTime()) / 60000) + 'm ago'
      : 'never';
    console.log(`  ${name}: ${info.status}${info.task ? ` — ${info.task}` : ''}  [heartbeat: ${hb}]`);
  }
  console.log('');

// ── loop-status <taskId> [--exp <n>] [--name <str>] [--r5 <n>] [--mc <n>] [--clear] ──
} else if (cmd === 'loop-status') {
  const [taskId] = args;
  if (!taskId) {
    console.error('Usage: kpi.js loop-status <taskId> [--exp <n>] [--name <str>] [--r5 <n>] [--mc <n>] [--clear]');
    process.exit(1);
  }

  const loops = readJSON(LOOP_FILE);

  if (flags.clear) {
    delete loops[taskId];
    writeJSON(LOOP_FILE, loops);
    console.log(`✓ Loop status cleared for task #${taskId}`);
  } else {
    const existing = loops[taskId] || {};
    loops[taskId] = {
      ...existing,
      running: true,
    };
    if (flags.exp  !== undefined) loops[taskId].experiment_num  = parseInt(flags.exp);
    if (flags.name !== undefined) loops[taskId].experiment_name = flags.name;
    if (flags.pid  !== undefined) loops[taskId].pid             = parseInt(flags.pid);
    if (!loops[taskId].started)   loops[taskId].started         = new Date().toISOString();

    if (flags.r5 !== undefined || flags.mc !== undefined) {
      loops[taskId].last_result = {
        r5:     flags.r5 !== undefined ? parseFloat(flags.r5) : (existing.last_result?.r5 ?? 0),
        mc:     flags.mc !== undefined ? parseFloat(flags.mc) : (existing.last_result?.mc ?? 0),
        status: flags.status || existing.last_result?.status || 'keep',
      };
    }

    writeJSON(LOOP_FILE, loops);
    console.log(`✓ Loop status updated: task #${taskId} exp=${loops[taskId].experiment_num} "${loops[taskId].experiment_name}"`);
  }

} else {
  console.log(`Telos KPI CLI

Commands:
  set <taskId> <metric> <value> [--target <n>] [--title <str>]
      Update a KPI metric value (and optionally its target).

  agent <name> <status> [--task <str>] [--pid <n>]
      Update an agent's status (cooking | idle | blocked).

  heartbeat <name>
      Refresh an agent's last_heartbeat without changing status.

  show
      Print current KPIs and agent statuses.

Examples:
  node src/kpi.js set 258 R@5 0.854 --target 0.99
  node src/kpi.js set 258 MC_Acc 0.919 --target 0.90
  node src/kpi.js agent conductor cooking --task "#258 Entity Register" --pid 1254072
  node src/kpi.js agent conductor idle
  node src/kpi.js heartbeat conductor
  node src/kpi.js loop-status 258 --exp 21 --name "EXP-021 entity resolution" --r5 0.862 --mc 0.821
  node src/kpi.js loop-status 258 --clear
  node src/kpi.js show
`);
}
