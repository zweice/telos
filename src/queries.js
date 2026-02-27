// queries.js - Prioritization and reporting queries for Telos

class TelosQueries {
  constructor(db) {
    this.db = db.db; // Access raw better-sqlite3 instance
  }

  // Check whether a node is dynamically blocked (hierarchical or lateral)
  isDynamicallyBlocked(nodeId) {
    // Hierarchical: has incomplete children
    const row = this.db.prepare(
      'SELECT has_incomplete_children FROM nodes_with_roi WHERE id = ?'
    ).get(nodeId);
    if (row && row.has_incomplete_children) return true;

    // Lateral: exists as blocked_id in dependencies where blocker is not done/shelved/rejected
    let lateralRow;
    try {
      lateralRow = this.db.prepare(`
        SELECT COUNT(*) as cnt
        FROM dependencies d
        JOIN nodes n ON n.id = d.blocker_id
        WHERE d.blocked_id = ?
          AND n.status NOT IN ('done','shelved','rejected')
      `).get(nodeId);
    } catch (_) {
      return false; // deps table doesn't exist yet
    }
    return lateralRow && lateralRow.cnt > 0;
  }

  // BFS: sum Base_ROI of nodeId and all nodes it transitively enables (blocks)
  _computeConstraintWeight(nodeId, baseROI, blockerToBlocked) {
    const visited = new Set();
    const queue = [nodeId];
    let total = 0;

    while (queue.length > 0) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);
      total += baseROI[current] || 0;

      for (const d of (blockerToBlocked[current] || [])) {
        if (!visited.has(d)) queue.push(d);
      }
    }
    return total;
  }

  // Build shared lookup structures for constraint weight computation
  _buildWeightLookups() {
    const allNodes = this.db.prepare(
      'SELECT id, value, cost_estimate, risk FROM nodes'
    ).all();
    const baseROI = {};
    const rawValue = {};
    for (const n of allNodes) {
      const denom = n.cost_estimate + (n.value * n.risk);
      baseROI[n.id] = denom === 0 ? 0 : n.value / denom;
      rawValue[n.id] = n.value || 0;
    }

    const blockerToBlocked = {};
    try {
      const allDeps = this.db.prepare(
        'SELECT blocked_id, blocker_id FROM dependencies'
      ).all();
      for (const dep of allDeps) {
        if (!blockerToBlocked[dep.blocker_id]) blockerToBlocked[dep.blocker_id] = [];
        blockerToBlocked[dep.blocker_id].push(dep.blocked_id);
      }
    } catch (_) {
      // deps table doesn't exist yet
    }

    return { baseROI, rawValue, blockerToBlocked };
  }

  // BFS: sum raw value of nodeId and all nodes it transitively enables
  _computeValueWeight(nodeId, rawValue, blockerToBlocked) {
    const visited = new Set();
    const queue = [nodeId];
    let total = 0;

    while (queue.length > 0) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);
      total += rawValue[current] || 0;

      for (const d of (blockerToBlocked[current] || [])) {
        if (!visited.has(d)) queue.push(d);
      }
    }
    return total;
  }

  // Next best action: highest Constraint Weight tasks that aren't blocked
  // Constraint weight = node.value + SUM(value of all downstream nodes blocked by this node)
  nextBestAction(options = {}) {
    const limit = options.limit || 10;
    const owner = options.owner;

    // Build weight lookups
    const { rawValue, blockerToBlocked } = this._buildWeightLookups();

    // Collect all laterally-blocked node IDs
    const laterallyBlocked = new Set();
    try {
      const rows = this.db.prepare(`
        SELECT d.blocked_id
        FROM dependencies d
        JOIN nodes n ON n.id = d.blocker_id
        WHERE n.status NOT IN ('done','shelved','rejected')
      `).all();
      for (const r of rows) laterallyBlocked.add(r.blocked_id);
    } catch (_) {
      // deps table doesn't exist yet
    }

    let query = `
      SELECT
        n.id,
        n.title,
        n.type,
        n.owner,
        n.value,
        n.cost_estimate,
        n.risk,
        n.roi,
        n.effort_hours_estimate,
        p.title as parent_title
      FROM nodes_with_roi n
      LEFT JOIN nodes p ON n.parent_id = p.id
      WHERE n.status = 'open'
        AND n.has_incomplete_children = 0
    `;

    const params = {};

    if (owner) {
      query += ' AND n.owner = @owner';
      params.owner = owner;
    }

    const candidates = this.db.prepare(query).all(params);

    // Filter out laterally blocked nodes, compute value-based constraint weight, sort
    const results = candidates
      .filter(c => !laterallyBlocked.has(c.id))
      .map(c => ({
        ...c,
        constraint_weight: this._computeValueWeight(c.id, rawValue, blockerToBlocked)
      }))
      .sort((a, b) => b.constraint_weight - a.constraint_weight)
      .slice(0, limit);

    return results;
  }

  // Bottleneck report: top 5 parents by constraint_weight with incomplete children
  bottlenecks() {
    const query = `
      WITH blocked_parents AS (
        SELECT
          p.id,
          p.title,
          p.type,
          p.status,
          COUNT(c.id) as incomplete_children,
          SUM(c.value) as blocked_value,
          dv.downstream_value
        FROM nodes p
        JOIN nodes c ON c.parent_id = p.id
        LEFT JOIN downstream_values dv ON dv.id = p.id
        WHERE c.status != 'done'
          AND p.status IN ('open', 'in_progress')
        GROUP BY p.id
      )
      SELECT * FROM blocked_parents
      ORDER BY downstream_value DESC, blocked_value DESC
    `;

    const rows = this.db.prepare(query).all();

    const { baseROI, blockerToBlocked } = this._buildWeightLookups();

    return rows
      .map(r => ({
        ...r,
        downstream_blocked_value: r.downstream_value,
        constraint_weight: this._computeConstraintWeight(r.id, baseROI, blockerToBlocked)
      }))
      .sort((a, b) => b.constraint_weight - a.constraint_weight)
      .slice(0, 5);
  }

  // Dependency-based bottleneck report
  // Lists tasks that are blocking the most downstream value via the dependencies table
  depBottlenecks() {
    let blockerRows;
    try {
      blockerRows = this.db.prepare(`
        SELECT DISTINCT d.blocker_id
        FROM dependencies d
        JOIN nodes nb ON nb.id = d.blocked_id
        WHERE nb.status NOT IN ('done','shelved','rejected','refused','out_of_budget')
      `).all();
    } catch (_) {
      return [];
    }

    if (blockerRows.length === 0) return [];

    const { rawValue, blockerToBlocked } = this._buildWeightLookups();

    const results = blockerRows.map(row => {
      const node = this.db.prepare('SELECT id, title, status FROM nodes WHERE id = ?').get(row.blocker_id);
      if (!node) return null;

      // Direct blocked count
      let directBlocked;
      try {
        directBlocked = this.db.prepare(`
          SELECT COUNT(*) as cnt FROM dependencies d
          JOIN nodes nb ON nb.id = d.blocked_id
          WHERE d.blocker_id = ?
            AND nb.status NOT IN ('done','shelved','rejected','refused','out_of_budget')
        `).get(row.blocker_id);
      } catch (_) {
        directBlocked = { cnt: 0 };
      }

      // Downstream value: BFS over all nodes this node transitively unblocks (excluding self)
      const visited = new Set();
      const queue = [node.id];
      let downstreamValue = 0;
      while (queue.length > 0) {
        const current = queue.shift();
        if (visited.has(current)) continue;
        visited.add(current);
        if (current !== node.id) downstreamValue += rawValue[current] || 0;
        for (const d of (blockerToBlocked[current] || [])) {
          if (!visited.has(d)) queue.push(d);
        }
      }

      return {
        id: node.id,
        title: node.title,
        status: node.status,
        blocking: directBlocked.cnt,
        downstream_roi: downstreamValue
      };
    }).filter(Boolean);

    return results.sort((a, b) => b.downstream_roi - a.downstream_roi);
  }

  // Workload report: effort hours by owner
  workload() {
    const query = `
      SELECT 
        owner,
        COUNT(*) as task_count,
        SUM(effort_hours_estimate) as total_hours,
        SUM(value) as total_value
      FROM nodes
      WHERE status = 'in_progress'
      GROUP BY owner
      ORDER BY total_hours DESC
    `;

    const stmt = this.db.prepare(query);
    return stmt.all();
  }

  // Estimation accuracy: compare estimates vs actuals
  estimationAccuracy() {
    const query = `
      SELECT 
        COUNT(*) as completed_tasks,
        AVG(ABS(cost_actual - cost_estimate)) as cost_mae,
        AVG(ABS(cost_actual - cost_estimate) / NULLIF(cost_estimate, 0)) as cost_mape,
        AVG(ABS(effort_hours_actual - effort_hours_estimate)) as effort_mae,
        AVG(ABS(effort_hours_actual - effort_hours_estimate) / NULLIF(effort_hours_estimate, 0)) as effort_mape
      FROM nodes
      WHERE status = 'done'
        AND cost_actual IS NOT NULL
        AND cost_estimate > 0
    `;

    const stmt = this.db.prepare(query);
    const result = stmt.get();

    return {
      completed_tasks: result.completed_tasks || 0,
      cost: {
        mae: result.cost_mae ? result.cost_mae.toFixed(2) : 'N/A',
        mape: result.cost_mape ? (result.cost_mape * 100).toFixed(1) + '%' : 'N/A'
      },
      effort: {
        mae: result.effort_mae ? result.effort_mae.toFixed(2) : 'N/A',
        mape: result.effort_mape ? (result.effort_mape * 100).toFixed(1) + '%' : 'N/A'
      }
    };
  }

  // Status summary: count by status
  statusSummary() {
    const query = `
      SELECT 
        status,
        COUNT(*) as count,
        SUM(value) as total_value,
        SUM(cost_estimate) as total_cost
      FROM nodes
      GROUP BY status
      ORDER BY 
        CASE status
          WHEN 'in_progress' THEN 1
          WHEN 'open' THEN 2
          WHEN 'blocked' THEN 3
          WHEN 'in_question' THEN 4
          WHEN 'done' THEN 5
          WHEN 'shelved' THEN 6
          WHEN 'out_of_budget' THEN 7
          WHEN 'refused' THEN 8
          WHEN 'rejected' THEN 9
          ELSE 10
        END
    `;

    const stmt = this.db.prepare(query);
    return stmt.all();
  }

  // Value analysis: value by type and status
  valueAnalysis() {
    const query = `
      SELECT 
        type,
        status,
        COUNT(*) as count,
        SUM(value) as total_value,
        AVG(roi) as avg_roi
      FROM nodes_with_roi
      GROUP BY type, status
      ORDER BY type, status
    `;

    const stmt = this.db.prepare(query);
    return stmt.all();
  }

  // Budget status: nodes approaching or exceeding budget
  budgetStatus() {
    const query = `
      SELECT 
        id,
        title,
        status,
        budget,
        cost_estimate,
        cost_actual,
        CASE
          WHEN cost_actual IS NULL THEN cost_estimate
          ELSE cost_actual
        END as current_cost,
        CASE
          WHEN budget IS NULL THEN NULL
          WHEN cost_actual IS NULL THEN (cost_estimate / budget * 100)
          ELSE (cost_actual / budget * 100)
        END as budget_used_pct
      FROM nodes
      WHERE budget IS NOT NULL
        AND status NOT IN ('done', 'refused', 'out_of_budget')
      ORDER BY budget_used_pct DESC
    `;

    const stmt = this.db.prepare(query);
    return stmt.all();
  }

  // Path to value: trace from task to root goal
  pathToValue(nodeId) {
    const query = `
      WITH RECURSIVE path AS (
        SELECT 
          id, parent_id, title, type, value, status, 0 as level
        FROM nodes
        WHERE id = @nodeId
        
        UNION ALL
        
        SELECT 
          n.id, n.parent_id, n.title, n.type, n.value, n.status, p.level + 1
        FROM nodes n
        JOIN path p ON n.id = p.parent_id
      )
      SELECT * FROM path ORDER BY level DESC
    `;

    const stmt = this.db.prepare(query);
    return stmt.all({ nodeId });
  }
}

module.exports = TelosQueries;
