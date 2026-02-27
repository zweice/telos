#!/usr/bin/env node
/**
 * init-mock-data.js
 * Realistic MacroHard mock data — full company tree
 * Wipes existing DB and loads fresh.
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'telos.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

// Wipe and recreate
if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
const db = new Database(DB_PATH);
db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));

const now = Math.floor(Date.now() / 1000);
const daysAgo = (d) => now - d * 86400;
const daysFromNow = (d) => now + d * 86400;

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

function node(overrides) {
  return {
    parent_id: null,
    type: 'task',
    description: null,
    owner: 'andreas',
    status: 'open',
    value: 0,
    cost_estimate: 0,
    cost_actual: null,
    risk: 0.1,
    budget: null,
    effort_hours_estimate: null,
    effort_hours_actual: null,
    success_criteria: null,
    created_at: now,
    started_at: null,
    completed_at: null,
    metadata: '{}',
    ...overrides,
  };
}

function add(data) {
  const result = insert.run(node(data));
  return result.lastInsertRowid;
}

// ─── ROOT GOAL ───────────────────────────────────────────────────────────────

const root = add({
  type: 'goal',
  title: 'MacroHard — One-Person Billion-Dollar Company',
  description: 'Build the infrastructure for autonomous AI-driven business at scale. One human, infinite leverage.',
  owner: 'andreas',
  status: 'in_progress',
  value: 1_000_000_000,
  cost_estimate: 50_000,
  budget: 100_000,
  risk: 0.4,
  success_criteria: '€1M+/month MRR, fully autonomous operations',
  created_at: daysAgo(90),
  started_at: daysAgo(90),
  metadata: JSON.stringify({ phase: 'foundation', year: 2026 }),
});

// ─── IT-001: INFRASTRUCTURE BASELINE ─────────────────────────────────────────

const it001 = add({
  parent_id: root,
  type: 'milestone',
  title: 'IT-001: Infrastructure Baseline',
  description: 'OpenClaw setup, multi-agent system, browser control, WhatsApp integration.',
  owner: 'atlas',
  status: 'done',
  value: 50_000,
  cost_estimate: 2_000,
  cost_actual: 1_800,
  budget: 3_000,
  risk: 0.1,
  effort_hours_estimate: 40,
  effort_hours_actual: 35,
  success_criteria: 'Multi-agent system operational, messaging live',
  created_at: daysAgo(90),
  started_at: daysAgo(90),
  completed_at: daysAgo(60),
  metadata: JSON.stringify({ iteration: 1 }),
});

const it001tasks = [
  ['Install and configure OpenClaw gateway', 'atlas', 'done', 8000, 500, 400, 0.05, 6, 5.5],
  ['Set up multi-agent team (Atlas, Forge, Conductor)', 'atlas', 'done', 12000, 600, 550, 0.1, 8, 7],
  ['WhatsApp integration + message routing', 'atlas', 'done', 10000, 400, 380, 0.05, 5, 5],
  ['Browser control via Chrome extension relay', 'atlas', 'done', 8000, 300, 300, 0.05, 4, 4],
  ['Memory system + MEMORY.md architecture', 'atlas', 'done', 7000, 200, 180, 0.05, 3, 3],
  ['Telegram channel + Jared persona live', 'atlas', 'done', 5000, 200, 190, 0.05, 2, 2.5],
];

for (const [title, owner, status, value, cost_estimate, cost_actual, risk, effort_hours_estimate, effort_hours_actual] of it001tasks) {
  add({
    parent_id: it001, type: 'task', title, owner, status,
    value, cost_estimate, cost_actual, risk,
    effort_hours_estimate, effort_hours_actual,
    created_at: daysAgo(90), started_at: daysAgo(85), completed_at: daysAgo(65),
  });
}

// ─── IT-002: AUTONOMOUS OPERATIONS ───────────────────────────────────────────

const it002 = add({
  parent_id: root,
  type: 'milestone',
  title: 'IT-002: Autonomous Operations',
  description: 'Telephony via Vapi, financial automation, secure tunneling, heartbeat monitoring.',
  owner: 'conductor',
  status: 'in_progress',
  value: 80_000,
  cost_estimate: 5_000,
  cost_actual: 2_200,
  budget: 8_000,
  risk: 0.2,
  effort_hours_estimate: 80,
  effort_hours_actual: 38,
  success_criteria: 'Voice calls handled autonomously, finances tracked automatically',
  created_at: daysAgo(60),
  started_at: daysAgo(55),
  metadata: JSON.stringify({ iteration: 2 }),
});

const it002tasks = [
  ['Vapi telephony integration + agent voice', 'atlas', 'done', 15000, 800, 750, 0.15, 12, 11, daysAgo(50)],
  ['Secure tunnel setup (Cloudflare / ngrok)', 'conductor', 'done', 8000, 300, 290, 0.1, 4, 4, daysAgo(45)],
  ['Financial automation: invoice parsing', 'forge', 'done', 12000, 1000, 980, 0.2, 16, 15, daysAgo(30)],
  ['Heartbeat monitoring + proactive alerts', 'atlas', 'in_progress', 10000, 600, null, 0.1, 8, null, null],
  ['Financial dashboard (income vs burn rate)', 'forge', 'in_progress', 18000, 1200, null, 0.25, 20, null, null],
  ['Automated tax prep workflow', 'forge', 'open', 12000, 800, null, 0.3, 14, null, null],
  ['Weekly financial summary to Telegram', 'atlas', 'open', 5000, 300, null, 0.1, 4, null, null],
];

for (const [title, owner, status, value, cost_estimate, cost_actual, risk, effort_hours_estimate, effort_hours_actual, completed_at] of it002tasks) {
  add({
    parent_id: it002, type: 'task', title, owner, status,
    value, cost_estimate, cost_actual, risk,
    effort_hours_estimate, effort_hours_actual,
    created_at: daysAgo(60),
    started_at: status !== 'open' ? daysAgo(50) : null,
    completed_at: completed_at || null,
  });
}

// ─── IT-003: TELOS MVP ────────────────────────────────────────────────────────

const it003 = add({
  parent_id: root,
  type: 'milestone',
  title: 'IT-003: Telos MVP',
  description: 'Hierarchical work management system with ROI-based prioritization, budget tracking, and D3 visualization.',
  owner: 'atlas',
  status: 'in_progress',
  value: 30_000,
  cost_estimate: 2_000,
  cost_actual: 1_500,
  budget: 3_000,
  risk: 0.1,
  effort_hours_estimate: 20,
  effort_hours_actual: 15,
  success_criteria: 'Telos in daily use for IT-004 planning',
  created_at: daysAgo(30),
  started_at: daysAgo(28),
  metadata: JSON.stringify({ iteration: 3 }),
});

const it003tasks = [
  ['SQLite schema + database layer', 'atlas', 'done', 5000, 300, 280, 0.05, 3, 2.5],
  ['CLI interface (add/list/start/complete)', 'atlas', 'done', 8000, 400, 380, 0.1, 5, 4.5],
  ['Prioritization engine (ROI formula)', 'atlas', 'done', 6000, 300, 290, 0.05, 3, 3],
  ['D3.js browser visualization', 'atlas', 'done', 7000, 500, 480, 0.1, 5, 4],
  ['Documentation + examples', 'atlas', 'done', 2000, 200, 200, 0.05, 2, 2],
  ['Test and document real workflows', 'atlas', 'open', 5000, 1000, null, 0.1, 4, null],
];

for (const [title, owner, status, value, cost_estimate, cost_actual, risk, effort_hours_estimate, effort_hours_actual] of it003tasks) {
  add({
    parent_id: it003, type: 'task', title, owner, status,
    value, cost_estimate, cost_actual, risk,
    effort_hours_estimate, effort_hours_actual,
    created_at: daysAgo(25),
    started_at: status !== 'open' ? daysAgo(22) : null,
    completed_at: status === 'done' ? daysAgo(5) : null,
  });
}

// ─── IT-004: B2B AGENTIC MVP ──────────────────────────────────────────────────

const it004 = add({
  parent_id: root,
  type: 'milestone',
  title: 'IT-004: B2B Agentic MVP',
  description: 'First commercial agent workflow. Target: lead generation or customer support automation for SMBs. Goal: €10K MRR.',
  owner: 'andreas',
  status: 'open',
  value: 500_000,
  cost_estimate: 15_000,
  budget: 20_000,
  risk: 0.35,
  effort_hours_estimate: 200,
  success_criteria: '3 paying pilot customers, €10K MRR, NPS > 8',
  created_at: daysAgo(5),
  metadata: JSON.stringify({ iteration: 4, target_mrr: 10000, currency: 'EUR' }),
});

// Discovery phase
const it004disc = add({
  parent_id: it004,
  type: 'milestone',
  title: 'IT-004-A: Market Discovery',
  owner: 'atlas',
  status: 'in_progress',
  value: 50_000,
  cost_estimate: 1_500,
  budget: 2_000,
  risk: 0.2,
  effort_hours_estimate: 20,
  success_criteria: 'ICP defined, 5 customer interviews done, niche selected',
  created_at: daysAgo(5),
  started_at: daysAgo(3),
});

const discTasks = [
  ['Define ICP (Ideal Customer Profile)', 'atlas', 'in_progress', 15000, 200, null, 0.1, 4, null],
  ['Research 3 verticals: legal, real estate, e-comm', 'atlas', 'in_progress', 20000, 400, null, 0.15, 8, null],
  ['5× customer discovery interviews', 'andreas', 'open', 30000, 500, null, 0.2, 10, null],
  ['Competitive analysis (existing tools)', 'atlas', 'open', 10000, 300, null, 0.1, 5, null],
  ['Niche selection + go/no-go decision', 'andreas', 'open', 25000, 100, null, 0.25, 2, null],
];

for (const [title, owner, status, value, cost_estimate, cost_actual, risk, effort_hours_estimate, effort_hours_actual] of discTasks) {
  add({
    parent_id: it004disc, type: 'task', title, owner, status,
    value, cost_estimate, cost_actual, risk,
    effort_hours_estimate, effort_hours_actual,
    created_at: daysAgo(4),
    started_at: status === 'in_progress' ? daysAgo(2) : null,
  });
}

// Build phase
const it004build = add({
  parent_id: it004,
  type: 'milestone',
  title: 'IT-004-B: Agent Build',
  owner: 'forge',
  status: 'open',
  value: 200_000,
  cost_estimate: 8_000,
  budget: 12_000,
  risk: 0.3,
  effort_hours_estimate: 100,
  success_criteria: 'Agent live, handling 50+ interactions/day autonomously',
  created_at: daysAgo(5),
});

const buildTasks = [
  ['Agent architecture design', 'atlas', 'open', 20000, 500, null, 0.2, 8, null],
  ['Core workflow engine (task routing)', 'forge', 'open', 40000, 2000, null, 0.3, 24, null],
  ['CRM integration (HubSpot / Pipedrive)', 'forge', 'open', 30000, 1500, null, 0.25, 16, null],
  ['Email + calendar automation', 'forge', 'open', 25000, 1200, null, 0.2, 14, null],
  ['Fallback-to-human escalation flow', 'forge', 'open', 15000, 800, null, 0.15, 8, null],
  ['Dashboard for client visibility', 'forge', 'open', 20000, 1000, null, 0.2, 12, null],
  ['QA + stress testing', 'atlas', 'open', 10000, 1000, null, 0.1, 10, null],
];

for (const [title, owner, status, value, cost_estimate, cost_actual, risk, effort_hours_estimate, effort_hours_actual] of buildTasks) {
  add({
    parent_id: it004build, type: 'task', title, owner, status,
    value, cost_estimate, cost_actual, risk,
    effort_hours_estimate, effort_hours_actual,
    created_at: daysAgo(5),
  });
}

// GTM phase
const it004gtm = add({
  parent_id: it004,
  type: 'milestone',
  title: 'IT-004-C: Go-to-Market',
  owner: 'andreas',
  status: 'open',
  value: 250_000,
  cost_estimate: 5_000,
  budget: 8_000,
  risk: 0.4,
  effort_hours_estimate: 80,
  success_criteria: '3 pilot contracts signed, MRR > 0',
  created_at: daysAgo(5),
});

const gtmTasks = [
  ['Landing page + demo video', 'forge', 'open', 20000, 800, null, 0.15, 10, null],
  ['Cold outreach sequence (50 leads)', 'atlas', 'open', 40000, 500, null, 0.3, 8, null],
  ['Pricing model + contract template', 'andreas', 'open', 30000, 300, null, 0.2, 4, null],
  ['Pilot customer onboarding flow', 'atlas', 'open', 50000, 1000, null, 0.25, 12, null],
  ['LinkedIn content strategy (20 posts)', 'atlas', 'open', 30000, 400, null, 0.3, 10, null],
  ['3 pilot customers signed', 'andreas', 'open', 80000, 2000, null, 0.45, 36, null],
];

for (const [title, owner, status, value, cost_estimate, cost_actual, risk, effort_hours_estimate, effort_hours_actual] of gtmTasks) {
  add({
    parent_id: it004gtm, type: 'task', title, owner, status,
    value, cost_estimate, cost_actual, risk,
    effort_hours_estimate, effort_hours_actual,
    created_at: daysAgo(5),
  });
}

// ─── IT-005: INFRASTRUCTURE V2 ────────────────────────────────────────────────

const it005 = add({
  parent_id: root,
  type: 'milestone',
  title: 'IT-005: Infrastructure V2',
  description: 'Scale the wagon. Better memory, multi-client agent isolation, cost observability.',
  owner: 'conductor',
  status: 'open',
  value: 120_000,
  cost_estimate: 10_000,
  budget: 15_000,
  risk: 0.25,
  effort_hours_estimate: 120,
  success_criteria: 'QMD memory installed, per-client agent isolation, cost dashboard live',
  created_at: daysAgo(2),
  metadata: JSON.stringify({ iteration: 5 }),
});

const it005tasks = [
  ['QMD memory upgrade (BM25 + vectors)', 'conductor', 'open', 20000, 1500, null, 0.15, 16, null],
  ['ClawVault structured memory evaluation', 'atlas', 'open', 15000, 500, null, 0.2, 6, null],
  ['Per-client agent namespace isolation', 'conductor', 'open', 25000, 2000, null, 0.25, 20, null],
  ['Token + API cost observability dashboard', 'forge', 'open', 20000, 1500, null, 0.2, 14, null],
  ['Automated backup + disaster recovery', 'conductor', 'open', 15000, 1000, null, 0.1, 10, null],
  ['Performance benchmarks (latency, uptime)', 'conductor', 'open', 10000, 500, null, 0.1, 6, null],
  ['Multi-region failover planning', 'conductor', 'open', 15000, 3000, null, 0.35, 20, null],
];

for (const [title, owner, status, value, cost_estimate, cost_actual, risk, effort_hours_estimate, effort_hours_actual] of it005tasks) {
  add({
    parent_id: it005, type: 'task', title, owner, status,
    value, cost_estimate, cost_actual, risk,
    effort_hours_estimate, effort_hours_actual,
    created_at: daysAgo(2),
  });
}

db.close();

// Count nodes
const db2 = new Database(DB_PATH);
const count = db2.prepare('SELECT COUNT(*) as c FROM nodes').get().c;
db2.close();

console.log(`✅ Mock data loaded — ${count} nodes across MacroHard tree`);
console.log(`\nRun:\n  node src/cli.js next --limit 10\n  node src/cli.js list\n  node src/cli.js viz && open http://localhost:8088`);
