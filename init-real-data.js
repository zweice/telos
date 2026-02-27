#!/usr/bin/env node
/**
 * init-real-data.js
 * Real MacroHard backlog — single source of truth.
 * Run this to reset to confirmed state.
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'telos.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
const db = new Database(DB_PATH);
db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));

const now = Math.floor(Date.now() / 1000);
const daysAgo = (d) => now - d * 86400;

const insert = db.prepare(`
  INSERT INTO nodes (
    parent_id, type, title, description, owner, status,
    value, cost_estimate, cost_actual, risk, budget,
    effort_hours_estimate, effort_hours_actual,
    success_criteria, created_at, started_at, completed_at, metadata
  ) VALUES (
    @parent_id, @type, @title, @description, @owner, @status,
    @value, @cost_estimate, @cost_actual, @risk, @budget,
    @effort_hours_estimate, @effort_hours_actual,
    @success_criteria, @created_at, @started_at, @completed_at, @metadata
  )
`);

function add(data) {
  const defaults = {
    parent_id: null, description: null, owner: 'atlas', status: 'open',
    value: 0, cost_estimate: 0, cost_actual: null, risk: 0.1, budget: null,
    effort_hours_estimate: null, effort_hours_actual: null,
    success_criteria: null, created_at: now, started_at: null,
    completed_at: null, metadata: '{}',
  };
  return insert.run({ ...defaults, ...data }).lastInsertRowid;
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────

const root = add({
  type: 'goal',
  title: 'MacroHard',
  description: 'One-person billion-dollar company. AI-native. One human, infinite leverage.',
  owner: 'andreas',
  status: 'in_progress',
  value: 1_000_000_000,
  cost_estimate: 50_000,
  budget: 100_000,
  risk: 0.4,
  success_criteria: '€1M+/month MRR, fully autonomous operations',
  created_at: daysAgo(90),
  started_at: daysAgo(90),
});

// ─── AUTONOMOUS OPERATIONS ────────────────────────────────────────────────────

const ops = add({
  parent_id: root,
  type: 'milestone',
  title: 'Autonomous Operations',
  description: 'Telephony (Vapi), financial automation, tunneling, proactive agent ops.',
  owner: 'atlas',
  status: 'in_progress',
  value: 80_000,
  cost_estimate: 5_000,
  budget: 8_000,
  risk: 0.2,
  success_criteria: 'Voice + financial ops running autonomously without manual intervention',
  created_at: daysAgo(60),
  started_at: daysAgo(55),
});

add({
  parent_id: ops, type: 'task',
  title: 'Vapi telephony integration',
  description: 'Voice agent via Vapi — inbound/outbound call handling.',
  owner: 'atlas', status: 'open',
  value: 20_000, cost_estimate: 800, risk: 0.2,
  effort_hours_estimate: 12,
  created_at: daysAgo(55),
});

add({
  parent_id: ops, type: 'task',
  title: 'Secure tunneling setup',
  description: 'Cloudflare Tunnel or equivalent for external access to local services.',
  owner: 'conductor', status: 'open',
  value: 8_000, cost_estimate: 200, risk: 0.1,
  effort_hours_estimate: 4,
  created_at: daysAgo(55),
});

add({
  parent_id: ops, type: 'task',
  title: 'Financial automation (invoice parsing)',
  description: 'Auto-parse incoming invoices, categorize expenses.',
  owner: 'forge', status: 'open',
  value: 15_000, cost_estimate: 1_200, risk: 0.25,
  effort_hours_estimate: 16,
  created_at: daysAgo(55),
});

// ─── INFRASTRUCTURE (permanent org unit) ─────────────────────────────────────

const infra = add({
  parent_id: root,
  type: 'milestone',
  title: 'Infrastructure',
  description: 'Permanent org unit. Tooling, systems, memory, dev infrastructure. Always in progress — never "done".',
  owner: 'conductor',
  status: 'in_progress',
  value: 100_000,
  cost_estimate: 10_000,
  budget: 15_000,
  risk: 0.15,
  success_criteria: 'Systems reliable, fast, observable, and always improving',
  created_at: daysAgo(90),
  started_at: daysAgo(90),
  metadata: JSON.stringify({ org_unit: true, permanent: true }),
});

// Telos sub-milestone under Infrastructure
const telos = add({
  parent_id: infra,
  type: 'milestone',
  title: 'Telos',
  description: 'Work management system. Hierarchical goals + ROI prioritization + D3 viz. Single source of truth.',
  owner: 'forge',
  status: 'in_progress',
  value: 30_000,
  cost_estimate: 2_000,
  cost_actual: 1_500,
  budget: 3_000,
  risk: 0.05,
  success_criteria: 'In daily use by all agents. Evolves with the team.',
  created_at: daysAgo(30),
  started_at: daysAgo(28),
});

add({
  parent_id: telos, type: 'task',
  title: 'Core build (DB + CLI + viz)',
  description: 'SQLite schema, CLI, prioritization engine, D3 browser visualization.',
  owner: 'atlas', status: 'done',
  value: 25_000, cost_estimate: 1_500, cost_actual: 1_500, risk: 0.05,
  effort_hours_estimate: 15, effort_hours_actual: 15,
  created_at: daysAgo(28), started_at: daysAgo(28), completed_at: daysAgo(5),
});

add({
  parent_id: telos, type: 'task',
  title: 'Establish as single source of truth',
  description: 'Load real backlog, brief all agents, update team docs.',
  owner: 'atlas', status: 'in_progress',
  value: 5_000, cost_estimate: 200, risk: 0.05,
  effort_hours_estimate: 2,
  created_at: now, started_at: now,
});

// Infra backlog items
add({
  parent_id: infra, type: 'task',
  title: 'Memory upgrade: evaluate QMD + ClawVault',
  description: 'QMD = BM25 + vector hybrid search. ClawVault = structured memory layer. Reminder set for March 5.',
  owner: 'conductor', status: 'open',
  value: 15_000, cost_estimate: 500, risk: 0.15,
  effort_hours_estimate: 6,
  created_at: daysAgo(5),
  metadata: JSON.stringify({ reminder: '2026-03-05', links: ['https://docs.openclaw.ai/concepts/memory', 'https://github.com/Versatly/clawvault'] }),
});

add({
  parent_id: infra, type: 'task',
  title: 'Auto-commit cron: re-enable or kill',
  description: 'Cron job to auto-commit OpenClaw workspace is currently DISABLED. Needs a decision.',
  owner: 'conductor', status: 'open',
  value: 2_000, cost_estimate: 100, risk: 0.05,
  effort_hours_estimate: 1,
  created_at: daysAgo(10),
  metadata: JSON.stringify({ cron_id: 'a718665c-2eff-487c-a6bd-609d3ce72c8b' }),
});

add({
  parent_id: infra, type: 'task',
  title: 'Telos: persistent HTTP server (survives reboots)',
  description: 'Dashboard at localhost:8088 currently dies when shell closes. Make it a proper service.',
  owner: 'conductor', status: 'open',
  value: 3_000, cost_estimate: 100, risk: 0.05,
  effort_hours_estimate: 1,
  created_at: now,
});

// ─── BUSINESS DEVELOPMENT ─────────────────────────────────────────────────────

add({
  parent_id: root,
  type: 'milestone',
  title: 'Business Development',
  description: 'First commercial product. TBD. Andreas has an idea.',
  owner: 'atlas',
  status: 'open',
  value: 500_000,
  cost_estimate: 15_000,
  budget: 20_000,
  risk: 0.35,
  success_criteria: '€10K MRR from first product',
  created_at: now,
  metadata: JSON.stringify({ target_mrr: 10000, currency: 'EUR' }),
});

db.close();

const db2 = new Database(DB_PATH);
const count = db2.prepare('SELECT COUNT(*) as c FROM nodes').get().c;
db2.close();

console.log(`✅ Loaded — ${count} nodes`);
