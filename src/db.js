// db.js - Database operations for Telos
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'telos.db');
const SCHEMA_PATH = path.join(__dirname, '..', 'schema.sql');

class TelosDB {
  constructor(dbPath = DB_PATH) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this._autoMigrate();
    this.runMigrations();
  }

  // Run SQL migrations from the migrations/ folder (idempotent, tracked in _migrations table)
  runMigrations() {
    const migrationsDir = path.join(__dirname, '..', 'migrations');
    if (!fs.existsSync(migrationsDir)) return;

    // Ensure migration tracking table exists
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL UNIQUE,
        applied_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );
    `);

    const applied = new Set(
      this.db.prepare('SELECT name FROM _migrations ORDER BY name').all().map(r => r.name)
    );

    const sqlFiles = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of sqlFiles) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      this.db.exec(sql);
      this.db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
    }
  }

  // Auto-migrate schema if needed (called on every open)
  _autoMigrate() {
    // Check if nodes table exists and if new statuses are already in the schema
    const tableInfo = this.db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='nodes'"
    ).get();

    // Not yet initialized — initialize the base schema from schema.sql
    if (!tableInfo) {
      const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
      this.db.exec(schema);
      return;
    }

    // Already up to date
    if (tableInfo.sql.includes('shelved')) return;

    // Need to migrate: recreate nodes table with updated CHECK constraint
    const allNodes = this.db.prepare('SELECT * FROM nodes').all();

    this.db.pragma('foreign_keys = OFF');

    this.db.exec(`
      BEGIN TRANSACTION;

      DROP TRIGGER IF EXISTS check_budget_exceeded;
      DROP TRIGGER IF EXISTS set_started_at;
      DROP TRIGGER IF EXISTS set_completed_at;
      DROP VIEW IF EXISTS nodes_with_roi;
      DROP VIEW IF EXISTS node_paths;
      DROP VIEW IF EXISTS downstream_values;
      DROP TABLE nodes;

      CREATE TABLE nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_id INTEGER REFERENCES nodes(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK(type IN ('goal', 'milestone', 'task')),
        title TEXT NOT NULL,
        description TEXT,
        owner TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open'
          CHECK(status IN ('open', 'in_progress', 'blocked', 'done', 'out_of_budget', 'refused', 'shelved', 'rejected', 'in_question')),
        value REAL NOT NULL DEFAULT 0,
        cost_estimate REAL NOT NULL DEFAULT 0,
        cost_actual REAL DEFAULT NULL,
        risk REAL DEFAULT 0 CHECK(risk >= 0 AND risk <= 1),
        budget REAL DEFAULT NULL,
        roi INTEGER NOT NULL DEFAULT 0 CHECK(roi IN (0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89)),
        effort_hours_estimate REAL DEFAULT NULL,
        effort_hours_actual REAL DEFAULT NULL,
        start_date INTEGER DEFAULT NULL,
        end_date INTEGER DEFAULT NULL,
        progress INTEGER DEFAULT 0 CHECK(progress >= 0 AND progress <= 100),
        success_criteria TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        started_at INTEGER DEFAULT NULL,
        completed_at INTEGER DEFAULT NULL,
        metadata TEXT DEFAULT '{}' CHECK(json_valid(metadata))
      );

      COMMIT;
    `);

    // Reinsert rows sorted by id (parents before children)
    const insertStmt = this.db.prepare(`
      INSERT INTO nodes (
        id, parent_id, type, title, description, owner, status,
        value, cost_estimate, cost_actual, risk, budget, roi,
        effort_hours_estimate, effort_hours_actual,
        start_date, end_date, progress, success_criteria,
        created_at, started_at, completed_at, metadata
      ) VALUES (
        @id, @parent_id, @type, @title, @description, @owner, @status,
        @value, @cost_estimate, @cost_actual, @risk, @budget, @roi,
        @effort_hours_estimate, @effort_hours_actual,
        @start_date, @end_date, @progress, @success_criteria,
        @created_at, @started_at, @completed_at, @metadata
      )
    `);
    for (const node of [...allNodes].sort((a, b) => a.id - b.id)) {
      insertStmt.run(node);
    }

    this.db.pragma('foreign_keys = ON');

    // Recreate indexes, views, triggers (IF NOT EXISTS — safe to re-run)
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    this.db.exec(schema);
  }

  // Initialize database with schema
  init() {
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    this.db.exec(schema);
    return { success: true, message: 'Database initialized' };
  }

  // Add a new node
  add(data) {
    const stmt = this.db.prepare(`
      INSERT INTO nodes (
        parent_id, type, title, description, owner, status,
        value, cost_estimate, risk, budget, roi,
        effort_hours_estimate, success_criteria, metadata,
        start_date, end_date, progress
      ) VALUES (
        @parent_id, @type, @title, @description, @owner, @status,
        @value, @cost_estimate, @risk, @budget, @roi,
        @effort_hours_estimate, @success_criteria, @metadata,
        @start_date, @end_date, @progress
      )
    `);

    const result = stmt.run({
      parent_id: data.parent_id || null,
      type: data.type || 'task',
      title: data.title,
      description: data.description || null,
      owner: data.owner || 'atlas',
      status: data.status || 'open',
      value: data.value !== undefined && data.value !== null ? data.value : 0,
      cost_estimate: data.cost_estimate || 0,
      risk: data.risk !== undefined ? data.risk : 0,
      budget: data.budget || null,
      roi: data.roi !== undefined && data.roi !== null ? data.roi : 0,
      effort_hours_estimate: data.effort_hours_estimate || null,
      success_criteria: data.success_criteria || null,
      metadata: JSON.stringify(data.metadata || {}),
      start_date: data.start_date || null,
      end_date: data.end_date || null,
      progress: data.progress || 0
    });

    return { id: result.lastInsertRowid, ...data };
  }

  // Get node by ID
  get(id) {
    const stmt = this.db.prepare('SELECT * FROM nodes WHERE id = ?');
    return stmt.get(id);
  }

  // Get node with computed fields
  getWithMetrics(id) {
    const stmt = this.db.prepare('SELECT * FROM nodes_with_roi WHERE id = ?');
    return stmt.get(id);
  }

  // Update node
  update(id, data) {
    const fields = [];
    const values = {};

    const allowedFields = [
      'title', 'description', 'owner', 'status', 'value',
      'cost_estimate', 'cost_actual', 'risk', 'budget', 'roi',
      'effort_hours_estimate', 'effort_hours_actual',
      'success_criteria', 'metadata', 'start_date', 'end_date', 'progress'
    ];

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        fields.push(`${field} = @${field}`);
        values[field] = field === 'metadata' ? JSON.stringify(data[field]) : data[field];
      }
    }

    if (fields.length === 0) {
      return { success: false, message: 'No fields to update' };
    }

    const stmt = this.db.prepare(`
      UPDATE nodes SET ${fields.join(', ')} WHERE id = @id
    `);

    stmt.run({ id, ...values });
    return { success: true, id };
  }

  // Delete node (cascades to children)
  delete(id) {
    const stmt = this.db.prepare('DELETE FROM nodes WHERE id = ?');
    const result = stmt.run(id);
    return { success: result.changes > 0, deleted: result.changes };
  }

  // List nodes with filters
  list(filters = {}) {
    let query = 'SELECT * FROM nodes_with_roi WHERE 1=1';
    const params = {};

    if (filters.status) {
      query += ' AND status = @status';
      params.status = filters.status;
    }

    if (filters.owner) {
      query += ' AND owner = @owner';
      params.owner = filters.owner;
    }

    if (filters.type) {
      query += ' AND type = @type';
      params.type = filters.type;
    }

    if (filters.parent_id !== undefined) {
      if (filters.parent_id === null) {
        query += ' AND parent_id IS NULL';
      } else {
        query += ' AND parent_id = @parent_id';
        params.parent_id = filters.parent_id;
      }
    }

    // Sorting
    const sortField = filters.sort || 'roi';
    const validSorts = ['roi', 'value', 'cost_estimate', 'created_at', 'title'];
    const sort = validSorts.includes(sortField) ? sortField : 'roi';
    query += ` ORDER BY ${sort} DESC`;

    // Limit
    if (filters.limit) {
      query += ' LIMIT @limit';
      params.limit = filters.limit;
    }

    const stmt = this.db.prepare(query);
    return stmt.all(params);
  }

  // Get children of a node
  getChildren(parentId) {
    const stmt = this.db.prepare('SELECT * FROM nodes WHERE parent_id = ? ORDER BY created_at');
    return stmt.all(parentId);
  }

  // Get full tree (all nodes)
  getTree() {
    const stmt = this.db.prepare('SELECT * FROM nodes_with_roi ORDER BY parent_id, created_at');
    return stmt.all();
  }

  // Get path to root
  getPath(id) {
    const stmt = this.db.prepare('SELECT * FROM node_paths WHERE id = ?');
    return stmt.get(id);
  }

  // Start work on a node
  start(id) {
    return this.update(id, { status: 'in_progress' });
  }

  // Complete a node
  complete(id, actuals = {}) {
    const updateData = { status: 'done' };
    if (actuals.cost_actual !== undefined) {
      updateData.cost_actual = actuals.cost_actual;
    }
    if (actuals.effort_hours_actual !== undefined) {
      updateData.effort_hours_actual = actuals.effort_hours_actual;
    }
    return this.update(id, updateData);
  }

  // Block a node
  block(id, reason) {
    const node = this.get(id);
    const metadata = JSON.parse(node.metadata || '{}');
    metadata.block_reason = reason;
    return this.update(id, { status: 'blocked', metadata });
  }

  // Refuse a node
  refuse(id, reason) {
    const node = this.get(id);
    const metadata = JSON.parse(node.metadata || '{}');
    metadata.refuse_reason = reason;
    return this.update(id, { status: 'refused', metadata });
  }

  // Shelve a node (deprioritised, not deleted — will revisit)
  shelve(id, reason) {
    const node = this.get(id);
    const metadata = JSON.parse(node.metadata || '{}');
    if (reason) metadata.shelve_reason = reason;
    return this.update(id, { status: 'shelved', metadata });
  }

  // Reject a node (decided against, kept for history)
  reject(id, reason) {
    const node = this.get(id);
    const metadata = JSON.parse(node.metadata || '{}');
    if (reason) metadata.reject_reason = reason;
    return this.update(id, { status: 'rejected', metadata });
  }

  // Mark a node as in_question (needs clarification before work can proceed)
  question(id, reason) {
    const node = this.get(id);
    const metadata = JSON.parse(node.metadata || '{}');
    if (reason) metadata.question_reason = reason;
    return this.update(id, { status: 'in_question', metadata });
  }


  // Append a step note to node metadata
  addNote(id, text) {
    const node = this.get(id);
    const metadata = JSON.parse(node.metadata || '{}');
    if (!Array.isArray(metadata.notes)) metadata.notes = [];
    metadata.notes.push({ ts: Math.floor(Date.now() / 1000), text });
    return this.update(id, { metadata });
  }

  // Set progress percent
  setProgress(id, percent, note) {
    const updates = { progress: Math.max(0, Math.min(100, percent)) };
    if (note) {
      const node = this.get(id);
      const metadata = JSON.parse(node.metadata || '{}');
      if (!Array.isArray(metadata.notes)) metadata.notes = [];
      metadata.notes.push({ ts: Math.floor(Date.now() / 1000), text: note, progress: percent });
      updates.metadata = metadata;
    }
    return this.update(id, updates);
  }

  // ── Dependencies (DAG) ────────────────────────────────────────────────────

  ensureDepsTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS dependencies (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        blocked_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        blocker_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        type       TEXT NOT NULL DEFAULT 'hard' CHECK(type IN ('hard','soft')),
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        UNIQUE(blocked_id, blocker_id)
      );
      CREATE INDEX IF NOT EXISTS idx_deps_blocked ON dependencies(blocked_id);
      CREATE INDEX IF NOT EXISTS idx_deps_blocker ON dependencies(blocker_id);
    `);
  }

  // BFS: would adding (blocked_id depends on blocker_id) create a cycle?
  hasCircularDep(blocked_id, blocker_id) {
    // Cycle exists if blocker_id can already (transitively) reach blocked_id
    // i.e., if blocked_id is already a prerequisite of blocker_id
    const visited = new Set();
    const queue = [blocker_id];

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === blocked_id) return true;
      if (visited.has(current)) continue;
      visited.add(current);

      const prereqs = this.db.prepare(
        'SELECT blocker_id FROM dependencies WHERE blocked_id = ?'
      ).all(current);
      for (const p of prereqs) {
        if (!visited.has(p.blocker_id)) queue.push(p.blocker_id);
      }
    }
    return false;
  }

  addDependency(blocked_id, blocker_id, type = 'hard') {
    if (blocked_id === blocker_id) {
      throw new Error('A node cannot depend on itself');
    }
    if (this.hasCircularDep(blocked_id, blocker_id)) {
      throw new Error(`Adding dependency would create a cycle: ${blocked_id} <- ${blocker_id}`);
    }
    const stmt = this.db.prepare(
      'INSERT INTO dependencies (blocked_id, blocker_id, type) VALUES (?, ?, ?)'
    );
    const result = stmt.run(blocked_id, blocker_id, type);
    return { id: result.lastInsertRowid, blocked_id, blocker_id, type };
  }

  removeDependency(blocked_id, blocker_id) {
    const stmt = this.db.prepare(
      'DELETE FROM dependencies WHERE blocked_id = ? AND blocker_id = ?'
    );
    const result = stmt.run(blocked_id, blocker_id);
    return { success: result.changes > 0, deleted: result.changes };
  }

  getDepsFor(node_id) {
    const stmt = this.db.prepare(`
      SELECT d.blocker_id, d.type, n.status as blocker_status, n.title as blocker_title
      FROM dependencies d
      JOIN nodes n ON n.id = d.blocker_id
      WHERE d.blocked_id = ?
    `);
    return stmt.all(node_id);
  }

  // Get tasks that this node is blocking (i.e., this node is the blocker_id)
  getBlockedByNode(node_id) {
    const stmt = this.db.prepare(`
      SELECT d.blocked_id, d.type, n.status as blocked_status, n.title as blocked_title
      FROM dependencies d
      JOIN nodes n ON n.id = d.blocked_id
      WHERE d.blocker_id = ?
    `);
    return stmt.all(node_id);
  }

  getAllDeps() {
    const stmt = this.db.prepare(
      'SELECT id, blocked_id, blocker_id, type FROM dependencies ORDER BY id'
    );
    return stmt.all();
  }

  // Compute locked nodes: nodes with any unmet dependency (status != 'done')
  // Returns Map<nodeId, { blocker_id, blocker_title }>
  // locked_by points to the first unmet dep for that node
  getLockedNodeIds() {
    let rows;
    try {
      rows = this.db.prepare(`
        SELECT d.blocked_id, n.id AS blocker_id, n.title AS blocker_title
        FROM dependencies d
        JOIN nodes n ON n.id = d.blocker_id
        WHERE n.status != 'done'
        ORDER BY d.id
      `).all();
    } catch (_) {
      return new Map();
    }

    const locked = new Map();
    for (const row of rows) {
      if (!locked.has(row.blocked_id)) {
        locked.set(row.blocked_id, { blocker_id: row.blocker_id, blocker_title: row.blocker_title });
      }
    }
    return locked;
  }

  // ── Ideas ─────────────────────────────────────────────────────────────────

  // Ensure the ideas table exists (idempotent — safe to call anytime)
  ensureIdeasTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ideas (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        title       TEXT    NOT NULL,
        description TEXT,
        rationale   TEXT,
        status      TEXT    NOT NULL DEFAULT 'active'
                      CHECK(status IN ('active', 'parked', 'rejected')),
        key_decisions TEXT,
        tags        TEXT    DEFAULT '[]' CHECK(json_valid(tags)),
        created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ideas_status  ON ideas(status);
      CREATE INDEX IF NOT EXISTS idx_ideas_created ON ideas(created_at DESC);
      CREATE TRIGGER IF NOT EXISTS ideas_updated_at
        AFTER UPDATE ON ideas FOR EACH ROW
        BEGIN UPDATE ideas SET updated_at = strftime('%s', 'now') WHERE id = NEW.id; END;
    `);
  }

  addIdea(data) {
    this.ensureIdeasTable();
    const stmt = this.db.prepare(`
      INSERT INTO ideas (title, description, rationale, status, key_decisions, tags)
      VALUES (@title, @description, @rationale, @status, @key_decisions, @tags)
    `);
    const result = stmt.run({
      title:         data.title,
      description:   data.description   || null,
      rationale:     data.rationale     || null,
      status:        data.status        || 'active',
      key_decisions: data.key_decisions || null,
      tags:          JSON.stringify(data.tags || [])
    });
    return { id: result.lastInsertRowid, ...data };
  }

  getIdea(id) {
    this.ensureIdeasTable();
    const stmt = this.db.prepare('SELECT * FROM ideas WHERE id = ?');
    return stmt.get(id);
  }

  listIdeas(filters = {}) {
    this.ensureIdeasTable();
    let query = 'SELECT * FROM ideas WHERE 1=1';
    const params = {};

    if (filters.status) {
      query += ' AND status = @status';
      params.status = filters.status;
    }

    query += ' ORDER BY created_at DESC';

    if (filters.limit) {
      query += ' LIMIT @limit';
      params.limit = filters.limit;
    }

    const stmt = this.db.prepare(query);
    return stmt.all(params);
  }

  updateIdea(id, data) {
    this.ensureIdeasTable();
    const fields  = [];
    const values  = {};
    const allowed = ['title', 'description', 'rationale', 'status', 'key_decisions', 'tags'];

    for (const field of allowed) {
      if (data[field] !== undefined) {
        fields.push(`${field} = @${field}`);
        values[field] = field === 'tags' ? JSON.stringify(data[field]) : data[field];
      }
    }

    if (fields.length === 0) return { success: false, message: 'No fields to update' };

    const stmt = this.db.prepare(`UPDATE ideas SET ${fields.join(', ')} WHERE id = @id`);
    stmt.run({ id, ...values });
    return { success: true, id };
  }

  deleteIdea(id) {
    this.ensureIdeasTable();
    const stmt = this.db.prepare('DELETE FROM ideas WHERE id = ?');
    const result = stmt.run(id);
    return { success: result.changes > 0, deleted: result.changes };
  }

  getAllIdeas() {
    this.ensureIdeasTable();
    const stmt = this.db.prepare('SELECT * FROM ideas ORDER BY created_at DESC');
    return stmt.all();
  }

  // Close database connection
  close() {
    this.db.close();
  }
}

module.exports = TelosDB;
