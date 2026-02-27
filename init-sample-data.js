// init-sample-data.js - Initialize Telos with IT-003 sample data
const TelosDB = require('./src/db');

console.log('🌍 Initializing Telos with sample data...\n');

const db = new TelosDB();

// Initialize database
console.log('Creating database schema...');
db.init();

// Add root goal
console.log('Adding root goal: MacroHard...');
const macrohard = db.add({
  title: 'MacroHard: One-person $1B company',
  type: 'goal',
  value: 1000000000,
  owner: 'andreas',
  description: 'Build the infrastructure for a one-person billion-dollar company through AI-powered operations and autonomous systems',
  success_criteria: 'Revenue > $1B, Team size = 1 human + AI agents'
});

// Add IT-003 milestone
console.log('Adding IT-003 milestone...');
const it003 = db.add({
  parent_id: macrohard.id,
  title: 'IT-003: Telos MVP',
  type: 'milestone',
  value: 50000,
  cost_estimate: 10000,
  budget: 15000,
  effort_hours_estimate: 18,
  risk: 0.1,
  owner: 'atlas',
  description: 'Build Telos: hierarchical work management system with value-based prioritization',
  success_criteria: 'CLI working, browser viz functional, empirical learning active, documentation complete'
});

// Add tasks under IT-003
console.log('Adding IT-003 tasks...');

const prd = db.add({
  parent_id: it003.id,
  title: 'Write PRD',
  type: 'task',
  value: 10000,
  cost_estimate: 1000,
  effort_hours_estimate: 2,
  risk: 0.05,
  owner: 'atlas',
  description: 'Product Requirements Document with vision, data model, features, and success metrics',
  success_criteria: 'PRD.md written and approved by Andreas'
});

const schema = db.add({
  parent_id: it003.id,
  title: 'Build database schema',
  type: 'task',
  value: 15000,
  cost_estimate: 2000,
  effort_hours_estimate: 3,
  risk: 0.05,
  owner: 'atlas',
  description: 'SQLite schema with nodes table, views, triggers, and indexes',
  success_criteria: 'schema.sql created, all tables/views/triggers working, recursive CTEs tested'
});

const cli = db.add({
  parent_id: it003.id,
  title: 'Build CLI interface',
  type: 'task',
  value: 15000,
  cost_estimate: 3000,
  effort_hours_estimate: 5,
  risk: 0.1,
  owner: 'atlas',
  description: 'Command-line interface with commander.js for all CRUD operations and queries',
  success_criteria: 'All commands working: add, list, show, update, start, complete, next, bottlenecks, viz'
});

const viz = db.add({
  parent_id: it003.id,
  title: 'Build browser visualization',
  type: 'task',
  value: 20000,
  cost_estimate: 4000,
  effort_hours_estimate: 6,
  risk: 0.15,
  owner: 'atlas',
  description: 'Interactive D3.js tree view with status colors, tooltips, and expand/collapse',
  success_criteria: 'web/index.html working, tree renders correctly, interactions smooth, exports to JSON/Mermaid/DOT'
});

const docs = db.add({
  parent_id: it003.id,
  title: 'Test and document',
  type: 'task',
  value: 5000,
  cost_estimate: 1000,
  effort_hours_estimate: 2,
  risk: 0.05,
  owner: 'atlas',
  description: 'Complete README, examples, test with sample data',
  success_criteria: 'README complete, docs/examples.md with real workflows, sample data tested'
});

// Mark some tasks as complete (to show progress)
console.log('Marking early tasks as complete...');
db.complete(prd.id, { cost_actual: 950, effort_hours_actual: 1.8 });
db.complete(schema.id, { cost_actual: 1800, effort_hours_actual: 2.5 });
db.complete(cli.id, { cost_actual: 2800, effort_hours_actual: 4.5 });

// Mark viz as in progress
console.log('Starting visualization task...');
db.start(viz.id);

console.log('\n✅ Sample data initialized!\n');
console.log('Try these commands:');
console.log('  node src/cli.js list');
console.log('  node src/cli.js next');
console.log('  node src/cli.js show 1');
console.log('  node src/cli.js bottlenecks');
console.log('  node src/cli.js accuracy');
console.log('  node src/cli.js viz && open web/index.html');
console.log('');

db.close();
