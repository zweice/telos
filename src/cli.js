#!/usr/bin/env node
// cli.js - Command-line interface for Telos

const { Command } = require('commander');
const path = require('path');
const TelosDB = require('./db');
const TelosQueries = require('./queries');
const { exportForViz } = require('./viz');

// Fibonacci scale validation
const FIBONACCI_SCALE = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89];

function validateFibonacci(value, fieldName) {
  if (value === undefined || value === null) return true;
  if (!Number.isInteger(value) || !FIBONACCI_SCALE.includes(value)) {
    throw new Error(`❌ ${fieldName} must be on Fibonacci scale: ${FIBONACCI_SCALE.join(', ')}`);
  }
  return true;
}

const program = new Command();

program
  .name('telos')
  .description('Hierarchical goal and task management with value-based prioritization')
  .version('0.1.0');

// Initialize database
program
  .command('init')
  .description('Initialize Telos database')
  .action(() => {
    const db = new TelosDB();
    const result = db.init();
    console.log('✅', result.message);
    db.close();
  });

// Add node
program
  .command('add <title>')
  .description('Add a new node')
  .option('-p, --parent <id>', 'Parent node ID')
  .option('-t, --type <type>', 'Node type: goal | milestone | task', 'task')
  .option('-v, --value <n>', 'ROI value — Fibonacci scale [0,1,2,3,5,8,13,21,34,55,89] (0 = infra/support, no direct business value)', parseFloat, 0)
  .option('--roi <n>', 'Direct ROI field — Fibonacci scale [0,1,2,3,5,8,13,21,34,55,89]', parseInt, 0)
  .option('-c, --cost <n>', 'Cost estimate', parseFloat, 0)
  .option('-b, --budget <n>', 'Max allowed cost', parseFloat)
  .option('-r, --risk <n>', 'Risk (0.0-1.0)', parseFloat, 0)
  .option('-e, --effort <n>', 'Effort in hours', parseFloat)
  .option('-o, --owner <name>', 'Owner', 'atlas')
  .option('-d, --description <text>', 'Description')
  .option('-s, --success-criteria <text>', 'Success criteria')
  .option('--start-date <date>', 'Planned start date (YYYY-MM-DD)')
  .option('--end-date <date>', 'Planned end date / deadline (YYYY-MM-DD)')
  .action((title, options) => {
    // Validate Fibonacci scale values
    if (options.value !== undefined) validateFibonacci(Math.round(options.value), 'value');
    if (options.cost !== undefined) validateFibonacci(Math.round(options.cost), 'cost');
    const db = new TelosDB();
    const result = db.add({
      title,
      parent_id: options.parent ? parseInt(options.parent) : null,
      type: options.type,
      value: options.value,
      roi: options.roi,
      cost_estimate: options.cost,
      budget: options.budget,
      risk: options.risk,
      effort_hours_estimate: options.effort,
      owner: options.owner,
      description: options.description,
      success_criteria: options.successCriteria,
      start_date: options.startDate ? Math.floor(new Date(options.startDate).getTime()/1000) : null,
      end_date: options.endDate ? Math.floor(new Date(options.endDate).getTime()/1000) : null
    });
    console.log('✅ Added node:', result.id);
    db.close();
  });

// List nodes
program
  .command('list')
  .description('List nodes with filters')
  .option('-s, --status <status>', 'Filter by status')
  .option('-o, --owner <name>', 'Filter by owner')
  .option('-t, --type <type>', 'Filter by type')
  .option('-p, --parent <id>', 'Filter by parent')
  .option('--sort <field>', 'Sort by: roi, value, cost, created', 'roi')
  .option('-l, --limit <n>', 'Limit results', parseInt)
  .action((options) => {
    const db = new TelosDB();
    const nodes = db.list({
      status: options.status,
      owner: options.owner,
      type: options.type,
      parent_id: options.parent ? parseInt(options.parent) : undefined,
      sort: options.sort,
      limit: options.limit
    });

    if (nodes.length === 0) {
      console.log('No nodes found.');
    } else {
      const lockedMap = db.getLockedNodeIds();
      console.table(nodes.map(n => ({
        ID: n.id,
        Title: n.title.substring(0, 40),
        Type: n.type,
        Owner: n.owner,
        Status: lockedMap.has(n.id) ? n.status + ' [LOCKED]' : n.status,
        Value: n.value,
        Cost: n.cost_estimate,
        ROI: n.roi ? n.roi.toFixed(2) : 'N/A'
      })));
    }
    db.close();
  });

// Show node details
program
  .command('show <id>')
  .description('Show node details')
  .action((id) => {
    const db = new TelosDB();
    const node = db.getWithMetrics(parseInt(id));
    if (!node) {
      console.error('Node not found');
      process.exit(1);
    }

    console.log('\n━━━ Node Details ━━━');
    console.log('ID:', node.id);
    console.log('Title:', node.title);
    console.log('Type:', node.type);
    console.log('Owner:', node.owner);
    console.log('Status:', node.status);
    console.log('Parent ID:', node.parent_id || 'None (root)');
    console.log('\n━━━ Value Model ━━━');
    console.log('Value:', node.value);
    console.log('Cost estimate:', node.cost_estimate);
    console.log('Cost actual:', node.cost_actual || 'N/A');
    console.log('Risk:', node.risk);
    console.log('ROI (stored):', node.roi !== undefined ? node.roi : 'N/A');
    console.log('Budget:', node.budget || 'N/A');
    console.log('\n━━━ Time Tracking ━━━');
    console.log('Effort estimate:', node.effort_hours_estimate || 'N/A', 'hours');
    console.log('Effort actual:', node.effort_hours_actual || 'N/A', 'hours');
    console.log('Created:', new Date(node.created_at * 1000).toLocaleString());
    console.log('Started:', node.started_at ? new Date(node.started_at * 1000).toLocaleString() : 'N/A');
    console.log('Completed:', node.completed_at ? new Date(node.completed_at * 1000).toLocaleString() : 'N/A');
    console.log('Planned Start:', node.start_date ? new Date(node.start_date * 1000).toLocaleDateString() : 'N/A');
    console.log('Planned End:', node.end_date ? new Date(node.end_date * 1000).toLocaleDateString() : 'N/A');
    console.log('Progress:', (node.progress || 0) + '%');
    const meta = JSON.parse(node.metadata || '{}');
    if (meta.notes && meta.notes.length > 0) {
      console.log('\n━━━ Step Notes ━━━');
      meta.notes.slice(-5).forEach(n => {
        const ts = new Date(n.ts * 1000).toLocaleString();
        const pct = n.progress !== undefined ? ` [${n.progress}%]` : '';
        console.log(`  ${ts}${pct}: ${n.text}`);
      });
    }
    console.log('\n━━━ Children ━━━');
    console.log('Total children:', node.child_count);
    console.log('Children done:', node.children_done);
    console.log('Has incomplete children:', node.has_incomplete_children ? 'Yes' : 'No');
    if (node.description) {
      console.log('\n━━━ Description ━━━');
      console.log(node.description);
    }
    if (node.success_criteria) {
      console.log('\n━━━ Success Criteria ━━━');
      console.log(node.success_criteria);
    }
    console.log('');

    db.close();
  });

// Update node
program
  .command('update <id>')
  .description('Update node fields')
  .option('--title <text>', 'New title')
  .option('--status <status>', 'New status')
  .option('--value <n>', 'New value', parseFloat)
  .option('--roi <n>', 'New ROI (Fibonacci: 0,1,2,3,5,8,13,21,34,55,89)', parseInt)
  .option('--cost <n>', 'New cost estimate', parseFloat)
  .option('--budget <n>', 'New budget', parseFloat)
  .option('--owner <name>', 'New owner')
  .option('--description <text>', 'New description')
  .option('--start-date <date>', 'Planned start date (YYYY-MM-DD)')
  .option('--end-date <date>', 'Planned end date / deadline (YYYY-MM-DD)')
  .option('--progress <n>', 'Progress percent (0-100)', parseInt)
  .action((id, options) => {
    // Validate Fibonacci scale values
    if (options.value !== undefined) validateFibonacci(Math.round(options.value), 'value');
    if (options.cost !== undefined) validateFibonacci(Math.round(options.cost), 'cost');
    const db = new TelosDB();
    const updates = {};
    if (options.title) updates.title = options.title;
    if (options.status) updates.status = options.status;
    if (options.value !== undefined) updates.value = options.value;
    if (options.roi !== undefined) updates.roi = options.roi;
    if (options.cost !== undefined) updates.cost_estimate = options.cost;
    if (options.budget !== undefined) updates.budget = options.budget;
    if (options.owner) updates.owner = options.owner;
    if (options.description) updates.description = options.description;
    if (options.startDate) updates.start_date = Math.floor(new Date(options.startDate).getTime()/1000);
    if (options.endDate) updates.end_date = Math.floor(new Date(options.endDate).getTime()/1000);
    if (options.progress !== undefined) updates.progress = Math.max(0, Math.min(100, options.progress));

    const result = db.update(parseInt(id), updates);
    console.log('✅ Updated node:', id);
    db.close();
  });

// Start work
program
  .command('start <id>')
  .description('Start work on a node')
  .action((id) => {
    const db = new TelosDB();
    const nodeId = parseInt(id);
    const lockedMap = db.getLockedNodeIds();
    if (lockedMap.has(nodeId)) {
      const { blocker_id, blocker_title } = lockedMap.get(nodeId);
      console.error(`❌ Node ${id} is locked — "${blocker_title}" (#${blocker_id}) must be completed first`);
      db.close();
      process.exit(1);
    }
    db.start(nodeId);
    console.log('✅ Started work on node:', id);
    db.close();
  });

// Complete work
program
  .command('complete <id>')
  .description('Mark node as complete')
  .option('--cost-actual <n>', 'Actual cost', parseFloat)
  .option('--effort-actual <n>', 'Actual effort hours', parseFloat)
  .action((id, options) => {
    const db = new TelosDB();
    db.complete(parseInt(id), {
      cost_actual: options.costActual,
      effort_hours_actual: options.effortActual
    });
    console.log('✅ Completed node:', id);
    db.close();
  });

// Block work
program
  .command('block <id>')
  .description('Mark node as blocked')
  .requiredOption('-r, --reason <text>', 'Reason for blocking')
  .action((id, options) => {
    const db = new TelosDB();
    db.block(parseInt(id), options.reason);
    console.log('🚫 Blocked node:', id);
    db.close();
  });

// Refuse work
program
  .command('refuse <id>')
  .description('Refuse a node')
  .requiredOption('-r, --reason <text>', 'Reason for refusal')
  .action((id, options) => {
    const db = new TelosDB();
    db.refuse(parseInt(id), options.reason);
    console.log('❌ Refused node:', id);
    db.close();
  });

// Shelve a node (deprioritised, not deleted — will revisit)
program
  .command('shelve <id>')
  .description('Shelve a node (deprioritise without deleting)')
  .option('-r, --reason <text>', 'Reason for shelving')
  .action((id, options) => {
    const db = new TelosDB();
    db.shelve(parseInt(id), options.reason);
    console.log('🗄️  Shelved node:', id);
    db.close();
  });

// Reject a node (decided against, kept for history)
program
  .command('reject <id>')
  .description('Reject a node (decided against, kept for history)')
  .requiredOption('-r, --reason <text>', 'Reason for rejection')
  .action((id, options) => {
    const db = new TelosDB();
    db.reject(parseInt(id), options.reason);
    console.log('🚫 Rejected node:', id);
    db.close();
  });

// Mark a node in_question (needs clarification before work can proceed)
program
  .command('question <id>')
  .description('Mark a node as in_question (needs clarification)')
  .requiredOption('-r, --reason <text>', 'What needs clarification')
  .action((id, options) => {
    const db = new TelosDB();
    db.question(parseInt(id), options.reason);
    console.log('❓ Marked in_question node:', id);
    db.close();
  });

// Delete node
program
  .command('delete <id>')
  .description('Delete node and all descendants')
  .action((id) => {
    const db = new TelosDB();
    const result = db.delete(parseInt(id));
    console.log('🗑️  Deleted', result.deleted, 'node(s)');
    db.close();
  });

// Next best action
program
  .command('next')
  .description('Show next best actions (highest ROI)')
  .option('-l, --limit <n>', 'Number of results', parseInt, 10)
  .option('-o, --owner <name>', 'Filter by owner')
  .action((options) => {
    const db = new TelosDB();
    const queries = new TelosQueries(db);
    const lockedMap = db.getLockedNodeIds();
    const results = queries.nextBestAction({ limit: options.limit, owner: options.owner })
      .filter(n => !lockedMap.has(n.id));

    if (results.length === 0) {
      console.log('No open tasks available.');
    } else {
      console.log('\n🎯 Next Best Actions:\n');
      console.table(results.map(n => ({
        ID: n.id,
        Title: n.title.substring(0, 40),
        Parent: n.parent_title ? n.parent_title.substring(0, 30) : 'None',
        Owner: n.owner,
        Value: n.value,
        Cost: n.cost_estimate,
        ROI: n.roi.toFixed(2),
        Effort: n.effort_hours_estimate || 'N/A'
      })));
    }
    db.close();
  });

// Bottlenecks
program
  .command('bottlenecks')
  .description('Show bottleneck report')
  .action(() => {
    const db = new TelosDB();
    const queries = new TelosQueries(db);
    const results = queries.bottlenecks();

    if (results.length === 0) {
      console.log('No bottlenecks found.');
    } else {
      console.log('\n🚧 Bottlenecks:\n');
      console.table(results.map(n => ({
        ID: n.id,
        Parent: n.title.substring(0, 40),
        Status: n.status,
        'Blocked Children': n.incomplete_children,
        'Blocked Value': n.blocked_value,
        'Downstream Value': n.downstream_value || 'N/A'
      })));
    }
    db.close();
  });

// Workload
program
  .command('workload')
  .description('Show workload by owner')
  .action(() => {
    const db = new TelosDB();
    const queries = new TelosQueries(db);
    const results = queries.workload();

    if (results.length === 0) {
      console.log('No active work.');
    } else {
      console.log('\n💼 Workload:\n');
      console.table(results.map(w => ({
        Owner: w.owner,
        'Active Tasks': w.task_count,
        'Total Hours': w.total_hours || 'N/A',
        'Total Value': w.total_value
      })));
    }
    db.close();
  });

// Estimation accuracy
program
  .command('accuracy')
  .description('Show estimation accuracy')
  .action(() => {
    const db = new TelosDB();
    const queries = new TelosQueries(db);
    const result = queries.estimationAccuracy();

    console.log('\n📊 Estimation Accuracy:\n');
    console.log('Completed tasks:', result.completed_tasks);
    console.log('\nCost Estimates:');
    console.log('  MAE (Mean Absolute Error):', result.cost.mae);
    console.log('  MAPE (Mean Absolute % Error):', result.cost.mape);
    console.log('\nEffort Estimates:');
    console.log('  MAE (Mean Absolute Error):', result.effort.mae);
    console.log('  MAPE (Mean Absolute % Error):', result.effort.mape);
    console.log('');

    db.close();
  });

// Visualize
program
  .command('viz')
  .description('Export data for visualization')
  .option('-o, --output <path>', 'Output path', 'docs/telos-data.json')
  .option('-f, --format <format>', 'Export format: json | mermaid | dot', 'json')
  .action((options) => {
    const db = new TelosDB();
    exportForViz(db, options.output, options.format);
    console.log('✅ Exported to:', options.output);
    console.log('💡 Open docs/index.html in a browser to visualize');
    db.close();
    // Auto-push to GitHub Pages (zweice/telos) if script exists
    const pushScript = path.join(__dirname, '..', 'push-pages.sh');
    if (require('fs').existsSync(pushScript)) {
      try {
        require('child_process').execSync(`bash "${pushScript}"`, { stdio: 'inherit' });
      } catch (e) {
        console.warn('⚠️  GitHub Pages push failed (offline?). Dashboard still updated locally.');
      }
    }
  });

// Append a step note to a node
program
  .command('note <id> <text>')
  .description('Append a step note to a node (append-only progress log)')
  .option('-p, --progress <n>', 'Also update progress % (0-100)', parseInt)
  .action((id, text, options) => {
    const db = new TelosDB();
    if (options.progress !== undefined) {
      db.setProgress(parseInt(id), options.progress, text);
      console.log(`✅ Progress: ${options.progress}% — ${text}`);
    } else {
      db.addNote(parseInt(id), text);
      console.log('✅ Note added');
    }
    db.close();
  });

// ── Idea Backlog ─────────────────────────────────────────────────────────────
const idea = program.command('idea').description('Manage the idea backlog');

// idea add
idea
  .command('add <title>')
  .description('Add a new idea to the backlog')
  .option('-d, --description <text>', 'Description of the idea')
  .option('-r, --rationale <text>', 'Why this is worth exploring')
  .option('-s, --status <status>', 'Status: active | parked | rejected', 'active')
  .option('-k, --key-decisions <text>', 'Key decisions or open questions')
  .option('--tags <tags>', 'Comma-separated tags')
  .action((title, options) => {
    // Validate Fibonacci scale values
    if (options.value !== undefined) validateFibonacci(options.value, 'value');
    if (options.cost !== undefined) validateFibonacci(options.cost, 'cost');
    const db = new TelosDB();
    db.ensureIdeasTable();
    const tags = options.tags ? options.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
    const result = db.addIdea({
      title,
      description:   options.description  || null,
      rationale:     options.rationale    || null,
      status:        options.status,
      key_decisions: options.keyDecisions || null,
      tags
    });
    console.log('💡 Added idea:', result.id, `"${title}"`);
    db.close();
  });

// idea list
idea
  .command('list')
  .description('List ideas in the backlog')
  .option('-s, --status <status>', 'Filter by status: active | parked | rejected')
  .option('-l, --limit <n>', 'Limit results', parseInt)
  .action((options) => {
    const db = new TelosDB();
    db.ensureIdeasTable();
    const ideas = db.listIdeas({ status: options.status, limit: options.limit });
    if (ideas.length === 0) {
      console.log('No ideas found.');
    } else {
      console.log(`\n💡 Ideas (${ideas.length}):\n`);
      console.table(ideas.map(i => ({
        ID:          i.id,
        Title:       i.title.substring(0, 45),
        Status:      i.status,
        Rationale:   (i.rationale || '').substring(0, 35) || '—',
        Tags:        (() => { try { return JSON.parse(i.tags || '[]').join(', ') || '—'; } catch { return '—'; } })(),
        Created:     new Date(i.created_at * 1000).toLocaleDateString()
      })));
    }
    db.close();
  });

// idea show
idea
  .command('show <id>')
  .description('Show idea details')
  .action((id) => {
    const db = new TelosDB();
    db.ensureIdeasTable();
    const i = db.getIdea(parseInt(id));
    if (!i) { console.error('Idea not found'); process.exit(1); }
    let tags;
    try { tags = JSON.parse(i.tags || '[]').join(', ') || '—'; } catch { tags = '—'; }
    console.log('\n━━━ Idea ━━━');
    console.log('ID:            ', i.id);
    console.log('Title:         ', i.title);
    console.log('Status:        ', i.status);
    console.log('Tags:          ', tags);
    console.log('Created:       ', new Date(i.created_at * 1000).toLocaleString());
    console.log('Updated:       ', new Date(i.updated_at * 1000).toLocaleString());
    if (i.description)   { console.log('\nDescription:\n ', i.description); }
    if (i.rationale)     { console.log('\nRationale:\n ', i.rationale); }
    if (i.key_decisions) { console.log('\nKey Decisions:\n ', i.key_decisions); }
    console.log('');
    db.close();
  });

// idea update
idea
  .command('update <id>')
  .description('Update an idea')
  .option('--title <text>', 'New title')
  .option('-s, --status <status>', 'New status: active | parked | rejected')
  .option('-d, --description <text>', 'New description')
  .option('-r, --rationale <text>', 'New rationale')
  .option('-k, --key-decisions <text>', 'New key decisions')
  .option('--tags <tags>', 'Comma-separated tags (replaces existing)')
  .action((id, options) => {
    // Validate Fibonacci scale values
    if (options.value !== undefined) validateFibonacci(options.value, 'value');
    if (options.cost !== undefined) validateFibonacci(options.cost, 'cost');
    const db = new TelosDB();
    db.ensureIdeasTable();
    const updates = {};
    if (options.title)       updates.title         = options.title;
    if (options.status)      updates.status        = options.status;
    if (options.description) updates.description   = options.description;
    if (options.rationale)   updates.rationale     = options.rationale;
    if (options.keyDecisions) updates.key_decisions = options.keyDecisions;
    if (options.tags)        updates.tags          = options.tags.split(',').map(t => t.trim()).filter(Boolean);
    db.updateIdea(parseInt(id), updates);
    console.log('✅ Updated idea:', id);
    db.close();
  });

// idea delete
idea
  .command('delete <id>')
  .description('Delete an idea')
  .action((id) => {
    const db = new TelosDB();
    db.ensureIdeasTable();
    const result = db.deleteIdea(parseInt(id));
    console.log(result.success ? `🗑️  Deleted idea ${id}` : 'Idea not found');
    db.close();
  });

// ── Dependencies ──────────────────────────────────────────────────────────────
const dep = program.command('dep').description('Manage lateral dependencies between nodes');

// dep add
dep
  .command('add <blocked_id> <blocker_id>')
  .description('Add a lateral dependency (blocker_id must complete before blocked_id)')
  .option('--type <type>', 'Dependency type: hard | soft', 'hard')
  .action((blocked_id, blocker_id, options) => {
    const db = new TelosDB();
    try {
      const result = db.addDependency(parseInt(blocked_id), parseInt(blocker_id), options.type);
      console.log(`✅ Dependency added: node ${blocked_id} is blocked by node ${blocker_id} (${options.type})`);
    } catch (err) {
      console.error('❌ Error:', err.message);
      process.exit(1);
    }
    db.close();
  });

// dep remove
dep
  .command('remove <blocked_id> <blocker_id>')
  .description('Remove a lateral dependency')
  .action((blocked_id, blocker_id) => {
    const db = new TelosDB();
    const result = db.removeDependency(parseInt(blocked_id), parseInt(blocker_id));
    if (result.success) {
      console.log(`✅ Dependency removed: node ${blocked_id} no longer blocked by node ${blocker_id}`);
    } else {
      console.error('❌ Dependency not found');
      process.exit(1);
    }
    db.close();
  });

// dep list
dep
  .command('list')
  .description('List all dependencies or deps for a specific node')
  .option('--node <id>', 'Show deps for this node (as blocked_id)', parseInt)
  .action((options) => {
    const db = new TelosDB();
    if (options.node) {
      const deps = db.getDepsFor(options.node);
      if (deps.length === 0) {
        console.log(`No dependencies found for node ${options.node}.`);
      } else {
        console.log(`\n🔗 Blockers for node ${options.node}:\n`);
        console.table(deps.map(d => ({
          'Blocker ID': d.blocker_id,
          'Blocker Title': d.blocker_title ? d.blocker_title.substring(0, 40) : '?',
          'Blocker Status': d.blocker_status,
          'Type': d.type
        })));
      }
    } else {
      const deps = db.getAllDeps();
      if (deps.length === 0) {
        console.log('No dependencies found.');
      } else {
        console.log(`\n🔗 All Dependencies (${deps.length}):\n`);
        console.table(deps.map(d => ({
          ID: d.id,
          'Blocked ID': d.blocked_id,
          'Blocker ID': d.blocker_id,
          Type: d.type
        })));
      }
    }
    db.close();
  });

// ── Path ──────────────────────────────────────────────────────────────────────
program
  .command('path <id>')
  .description('Show the full blocker chain for a node (indented tree)')
  .action((id) => {
    const db = new TelosDB();

    function printBlockerTree(nodeId, indent = '') {
      const node = db.get(nodeId);
      if (!node) {
        console.log(`${indent}[Node ${nodeId} not found]`);
        return;
      }
      const prefix = indent === '' ? '' : indent;
      console.log(`${prefix}Node ${node.id}: "${node.title}" [${node.status}]`);
      const blockers = db.getDepsFor(nodeId);
      for (const b of blockers) {
        console.log(`${indent}  <- blocked by (${b.type}):`);
        printBlockerTree(b.blocker_id, indent + '    ');
      }
    }

    printBlockerTree(parseInt(id));
    db.close();
  });

// ── Locked nodes ──────────────────────────────────────────────────────────────
program
  .command('locked')
  .description('List all nodes locked by pending milestone gates')
  .action(() => {
    const db = new TelosDB();
    const lockedMap = db.getLockedNodeIds();

    if (lockedMap.size === 0) {
      console.log('No locked nodes.');
      db.close();
      return;
    }

    console.log('\n🔒 Locked Nodes:\n');
    const rows = [];
    for (const [nodeId, { blocker_id, blocker_title }] of lockedMap) {
      const node = db.get(nodeId);
      if (node) {
        rows.push({
          ID: node.id,
          Title: node.title.substring(0, 40),
          Type: node.type,
          Status: node.status,
          'Locked By': `${blocker_title} (#${blocker_id})`
        });
      }
    }
    rows.sort((a, b) => a.ID - b.ID);
    console.table(rows);
    db.close();
  });

program.parse();
