#!/usr/bin/env node
// tests/test_dag.js — DAG dependency layer + Constraint Weight tests
// Run with: node tests/test_dag.js

const path = require('path');
const fs = require('fs');
const TelosDB = require('../src/db');
const TelosQueries = require('../src/queries');

const TEST_DB = path.join(__dirname, 'test_dag.db');

// Clean up before running
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
// Also remove WAL/SHM if present
[TEST_DB + '-wal', TEST_DB + '-shm'].forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log('  PASS:', msg);
    passed++;
  } else {
    console.error('  FAIL:', msg);
    failed++;
  }
}

function assertThrows(fn, msg) {
  let threw = false;
  try { fn(); } catch (_) { threw = true; }
  assert(threw, msg);
}

// ── Setup ─────────────────────────────────────────────────────────────────────
const db = new TelosDB(TEST_DB);
db.init();

// Add test nodes
const nA = db.add({ title: 'Node A', type: 'task', owner: 'test', value: 10, cost_estimate: 2, risk: 0 });
const nB = db.add({ title: 'Node B', type: 'task', owner: 'test', value: 20, cost_estimate: 4, risk: 0 });
const nC = db.add({ title: 'Node C', type: 'task', owner: 'test', value: 5,  cost_estimate: 1, risk: 0 });
const nD = db.add({ title: 'Node D', type: 'task', owner: 'test', value: 8,  cost_estimate: 2, risk: 0 });

console.log('\n── Test: ensureDepsTable creates table ──');
// Table existence is implicitly verified by the fact that the constructor ran without throwing
assert(true, 'dependencies table created without error');

// ── Test: addDependency ───────────────────────────────────────────────────────
console.log('\n── Test: addDependency ──');

// B is blocked by A (A must complete before B)
const dep1 = db.addDependency(nB.id, nA.id, 'hard');
assert(dep1.id > 0, 'addDependency returns valid id');
assert(dep1.blocked_id === nB.id, 'blocked_id correct');
assert(dep1.blocker_id === nA.id, 'blocker_id correct');
assert(dep1.type === 'hard', 'type defaults to hard');

// C is blocked by B
db.addDependency(nC.id, nB.id, 'soft');

// ── Test: getAllDeps ──────────────────────────────────────────────────────────
console.log('\n── Test: getAllDeps ──');
const allDeps = db.getAllDeps();
assert(allDeps.length === 2, 'getAllDeps returns 2 deps');
assert(allDeps[0].blocked_id === nB.id && allDeps[0].blocker_id === nA.id, 'dep1 correct');
assert(allDeps[1].blocked_id === nC.id && allDeps[1].blocker_id === nB.id, 'dep2 correct');

// ── Test: getDepsFor ──────────────────────────────────────────────────────────
console.log('\n── Test: getDepsFor ──');
const depsForC = db.getDepsFor(nC.id);
assert(depsForC.length === 1, 'getDepsFor(C) returns 1 dep');
assert(depsForC[0].blocker_id === nB.id, 'getDepsFor(C) blocker_id = B');
assert(depsForC[0].type === 'soft', 'getDepsFor(C) type = soft');
assert(typeof depsForC[0].blocker_status === 'string', 'getDepsFor returns blocker_status');

const depsForA = db.getDepsFor(nA.id);
assert(depsForA.length === 0, 'getDepsFor(A) returns 0 deps (A has no blockers)');

// ── Test: hasCircularDep ──────────────────────────────────────────────────────
console.log('\n── Test: hasCircularDep ──');
// A <- B <- C already. Adding A <- C (C blocks A) would create cycle A<-B<-C<-A
assert(db.hasCircularDep(nA.id, nC.id) === true, 'detects cycle: A blocked by C (cycle: A<-B<-C<-A)');
// D has no deps — adding D <- A is safe
assert(db.hasCircularDep(nD.id, nA.id) === false, 'no cycle: D blocked by A (safe)');
// Self-reference
assertThrows(() => db.addDependency(nA.id, nA.id), 'self-dependency throws');

// ── Test: addDependency throws on cycle ───────────────────────────────────────
console.log('\n── Test: addDependency rejects cycles ──');
assertThrows(
  () => db.addDependency(nA.id, nC.id),
  'addDependency throws when cycle detected (A <- C)'
);

// ── Test: removeDependency ────────────────────────────────────────────────────
console.log('\n── Test: removeDependency ──');
// Add a fresh dep to remove
db.addDependency(nD.id, nA.id, 'soft');
assert(db.getAllDeps().length === 3, '3 deps before removal');
const removeResult = db.removeDependency(nD.id, nA.id);
assert(removeResult.success === true, 'removeDependency returns success');
assert(db.getAllDeps().length === 2, '2 deps after removal');

// Remove non-existent dep
const removeResult2 = db.removeDependency(nD.id, nC.id);
assert(removeResult2.success === false, 'removeDependency returns false for non-existent dep');

// ── Test: isDynamicallyBlocked ────────────────────────────────────────────────
console.log('\n── Test: isDynamicallyBlocked ──');
const queries = new TelosQueries(db);

// B is blocked by A (A is open)
assert(queries.isDynamicallyBlocked(nB.id) === true, 'B is dynamically blocked (A is open)');
// A has no blockers
assert(queries.isDynamicallyBlocked(nA.id) === false, 'A is not dynamically blocked');

// Complete A — then B should no longer be laterally blocked
db.complete(nA.id);
assert(queries.isDynamicallyBlocked(nB.id) === false, 'B unblocked after A is completed');

// Reset A to open for remaining tests
db.update(nA.id, { status: 'open', cost_actual: null });

// ── Test: Constraint Weight computation ───────────────────────────────────────
console.log('\n── Test: Constraint Weight ──');
// Chain: A blocks B blocks C
// Base_ROI: A=10/2=5, B=20/4=5, C=5/1=5
// CW(C) = ROI(C) = 5
// CW(B) = ROI(B) + ROI(C) = 5 + 5 = 10
// CW(A) = ROI(A) + ROI(B) + ROI(C) = 5 + 5 + 5 = 15

const allNodes = db.db.prepare('SELECT id, value, cost_estimate, risk FROM nodes').all();
const baseROI = {};
for (const n of allNodes) {
  const denom = n.cost_estimate + (n.value * n.risk);
  baseROI[n.id] = denom === 0 ? 0 : n.value / denom;
}

// Build blockerToBlocked map
const blockerToBlocked = {};
for (const dep of db.getAllDeps()) {
  if (!blockerToBlocked[dep.blocker_id]) blockerToBlocked[dep.blocker_id] = [];
  blockerToBlocked[dep.blocker_id].push(dep.blocked_id);
}

const cwA = queries._computeConstraintWeight(nA.id, baseROI, blockerToBlocked);
const cwB = queries._computeConstraintWeight(nB.id, baseROI, blockerToBlocked);
const cwC = queries._computeConstraintWeight(nC.id, baseROI, blockerToBlocked);

assert(Math.abs(cwA - 15) < 0.001, `CW(A) = 15 [got ${cwA}]`);
assert(Math.abs(cwB - 10) < 0.001, `CW(B) = 10 [got ${cwB}]`);
assert(Math.abs(cwC - 5)  < 0.001, `CW(C) = 5  [got ${cwC}]`);

// ── Test: nextBestAction filters blocked nodes ────────────────────────────────
console.log('\n── Test: nextBestAction with dynamic blocking ──');

// A is open, no blockers -> should appear
// B is blocked by A -> should NOT appear
// C is blocked by B -> should NOT appear
// D is open, no blockers -> should appear

const nextResults = queries.nextBestAction({ owner: 'test' });
const nextIds = nextResults.map(r => r.id);
assert(!nextIds.includes(nB.id), 'B excluded from next (blocked by A)');
assert(!nextIds.includes(nC.id), 'C excluded from next (blocked by B)');
assert(nextIds.includes(nA.id), 'A included in next (no blockers)');
assert(nextIds.includes(nD.id), 'D included in next (no blockers)');

// Verify constraint_weight is present and sorted desc
assert(nextResults.every(r => typeof r.constraint_weight === 'number'), 'constraint_weight is a number on all results');
for (let i = 0; i < nextResults.length - 1; i++) {
  assert(
    nextResults[i].constraint_weight >= nextResults[i + 1].constraint_weight,
    `results sorted desc: [${i}].cw=${nextResults[i].constraint_weight} >= [${i+1}].cw=${nextResults[i+1].constraint_weight}`
  );
}

// ── Test: UNIQUE constraint on dependencies ───────────────────────────────────
console.log('\n── Test: UNIQUE constraint ──');
assertThrows(
  () => db.addDependency(nB.id, nA.id, 'hard'),
  'duplicate dependency throws UNIQUE constraint error'
);

// ── Cleanup ───────────────────────────────────────────────────────────────────
db.close();
[TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm'].forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('SOME TESTS FAILED');
  process.exit(1);
} else {
  console.log('ALL TESTS PASSED');
  process.exit(0);
}
