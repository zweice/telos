#!/usr/bin/env node
// api-server.js — Lightweight API server for live Telos dashboard

const http = require('http');
const TelosDB = require('./src/db');
const TelosQueries = require('./src/queries');

const PORT = parseInt(process.env.PORT) || 8089;

const db = new TelosDB();

// Build tree structure from flat nodes
function buildTree(nodes) {
  const nodeMap = new Map();
  const roots = [];

  nodes.forEach(n => {
    nodeMap.set(n.id, {
      id: n.id,
      title: n.title,
      type: n.type,
      owner: n.owner,
      status: n.status,
      value: n.value,
      cost_estimate: n.cost_estimate,
      cost_actual: n.cost_actual,
      roi: n.roi,
      effort_hours_estimate: n.effort_hours_estimate,
      effort_hours_actual: n.effort_hours_actual,
      start_date: n.start_date || null,
      end_date: n.end_date || null,
      completed_at: n.completed_at || null,
      progress: n.progress || 0,
      description: n.description || null,
      notes: (() => { try { return JSON.parse(n.metadata || '{}').notes || []; } catch { return []; } })(),
      constraint_weight: n.constraint_weight || 0,
      is_bottleneck: n.is_bottleneck || false,
      lateral_blockers: n.lateral_blockers || [],
      children: []
    });
  });

  nodes.forEach(n => {
    const node = nodeMap.get(n.id);
    if (n.parent_id) {
      const parent = nodeMap.get(n.parent_id);
      if (parent) {
        parent.children.push(node);
      }
    } else {
      roots.push(node);
    }
  });

  return roots;
}

// Get tree data from DB, enriched with constraint_weight, is_bottleneck, lateral_blockers
function getTreeData() {
  const nodes = db.getTree();
  const queries = new TelosQueries(db);

  // Build weight lookups
  const { baseROI, blockerToBlocked } = queries._buildWeightLookups();

  // Compute constraint weight for every node
  const weightMap = {};
  for (const n of nodes) {
    weightMap[n.id] = queries._computeConstraintWeight(n.id, baseROI, blockerToBlocked);
  }

  // Identify bottleneck: highest constraint_weight node
  let bottleneckId = null;
  let maxWeight = -Infinity;
  for (const [id, w] of Object.entries(weightMap)) {
    if (w > maxWeight) { maxWeight = w; bottleneckId = parseInt(id); }
  }

  // Build lateral blockers map: nodeId -> [{blocker_id, type, status, title}]
  const lateralBlockersMap = {};
  try {
    const allDeps = db.getAllDeps();
    for (const dep of allDeps) {
      if (!lateralBlockersMap[dep.blocked_id]) lateralBlockersMap[dep.blocked_id] = [];
      const blocker = db.get(dep.blocker_id);
      lateralBlockersMap[dep.blocked_id].push({
        blocker_id: dep.blocker_id,
        type: dep.type,
        status: blocker ? blocker.status : null,
        title: blocker ? blocker.title : null
      });
    }
  } catch (_) {}

  // Enrich nodes before building tree
  const enrichedNodes = nodes.map(n => ({
    ...n,
    constraint_weight: weightMap[n.id] || 0,
    is_bottleneck: n.id === bottleneckId,
    lateral_blockers: lateralBlockersMap[n.id] || []
  }));

  return {
    version: '0.1.0',
    generated_at: new Date().toISOString(),
    tree: buildTree(enrichedNodes)
  };
}

const server = http.createServer((req, res) => {
  // Set security headers
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  // Parse URL
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // API endpoints
  if (url.pathname === '/api/tree' && req.method === 'GET') {
    try {
      const treeData = getTreeData();
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end(JSON.stringify(treeData));
    } catch (err) {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
  } else if (url.pathname === '/api/ideas' && req.method === 'GET') {
    try {
      db.ensureIdeasTable();
      const status = url.searchParams.get('status') || null;
      const ideas  = db.listIdeas(status ? { status } : {}).map(i => ({
        id:            i.id,
        title:         i.title,
        description:   i.description   || null,
        rationale:     i.rationale     || null,
        status:        i.status,
        key_decisions: i.key_decisions || null,
        tags:          (() => { try { return JSON.parse(i.tags || '[]'); } catch { return []; } })(),
        created_at:    i.created_at,
        updated_at:    i.updated_at
      }));
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end(JSON.stringify({ ideas }));
    } catch (err) {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
  } else if (url.pathname === '/api/dependencies' && req.method === 'GET') {
    try {
      const deps = db.getAllDeps();
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end(JSON.stringify({ dependencies: deps }));
    } catch (err) {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
  } else if (url.pathname === '/api/health' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
  } else if (/^\/api\/progress\/(\d+)$/.test(url.pathname) && req.method === 'POST') {
    // Sub-agent progress update: POST /api/progress/:id  { progress: 0-100, note: "..." }
    const id = parseInt(url.pathname.match(/(\d+)/)[1]);
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { progress, note } = JSON.parse(body || '{}');
        db.setProgress(id, progress !== undefined ? progress : db.get(id).progress, note);
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, id, progress, note }));
      } catch (err) {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(400);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

const HOST = process.env.HOST || '127.0.0.1';

server.listen(PORT, HOST, () => {
  console.log(`✅ Telos API server running at http://${HOST}:${PORT}`);
  console.log(`📂 Serving /api/tree from SQLite DB (no caching)`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  db.close();
  server.close(() => process.exit(0));
});
