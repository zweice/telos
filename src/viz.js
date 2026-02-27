// viz.js - Visualization export for Telos
const fs = require('fs');
const path = require('path');

function exportForViz(db, outputPath, format = 'json') {
  const nodes = db.getTree();

  if (format === 'json') {
    exportJSON(nodes, outputPath, db);
  } else if (format === 'mermaid') {
    exportMermaid(nodes, outputPath);
  } else if (format === 'dot') {
    exportGraphViz(nodes, outputPath);
  } else {
    throw new Error(`Unknown format: ${format}`);
  }
}

function exportJSON(nodes, outputPath, db) {
  // Build hierarchical tree structure
  const nodeMap = new Map();
  const roots = [];

  // First pass: create node map
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
      children: []
    });
  });

  // Second pass: build hierarchy
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

  // Mark locked nodes (gated by pending milestones) — locked is derived, not stored
  if (db) {
    try {
      const lockedMap = db.getLockedNodeIds();
      for (const [nodeId, { blocker_id, blocker_title }] of lockedMap) {
        const node = nodeMap.get(nodeId);
        if (node) {
          node.locked    = true;
          node.locked_by = { id: blocker_id, title: blocker_title };
        }
      }
    } catch (_) {
      // locked computation may fail in edge cases — skip gracefully
    }
  }

  // Include ideas if db is available
  let ideas = [];
  if (db) {
    try {
      db.ensureIdeasTable();
      ideas = db.getAllIdeas().map(i => ({
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
    } catch (e) {
      // Ideas table may not exist yet in older DBs — that's fine
    }
  }

  // Include dependencies (DAG edges) if db is available
  let dependencies = [];
  if (db) {
    try {
      dependencies = db.getAllDeps();
    } catch (e) {
      // Dependencies table may not exist yet — that's fine
    }
  }

  const output = {
    version: '0.1.0',
    generated_at: new Date().toISOString(),
    tree: roots,
    ideas,
    dependencies
  };

  const fullPath = path.resolve(outputPath);
  fs.writeFileSync(fullPath, JSON.stringify(output, null, 2));
}

function exportMermaid(nodes, outputPath) {
  let mermaid = 'graph TD\n';

  nodes.forEach(n => {
    const label = `${n.title} [${n.status}]`;
    const shape = n.type === 'goal' ? '([' : n.type === 'milestone' ? '[[' : '[';
    const shapeEnd = n.type === 'goal' ? '])' : n.type === 'milestone' ? ']]' : ']';
    mermaid += `  ${n.id}${shape}"${label}"${shapeEnd}\n`;

    if (n.parent_id) {
      mermaid += `  ${n.parent_id} --> ${n.id}\n`;
    }
  });

  const fullPath = path.resolve(outputPath);
  fs.writeFileSync(fullPath, mermaid);
}

function exportGraphViz(nodes, outputPath) {
  let dot = 'digraph Telos {\n';
  dot += '  node [shape=box, style=rounded];\n';

  nodes.forEach(n => {
    const color = getStatusColor(n.status);
    const shape = n.type === 'goal' ? 'ellipse' : n.type === 'milestone' ? 'diamond' : 'box';
    dot += `  ${n.id} [label="${n.title}\\n[${n.status}]", shape=${shape}, color="${color}"];\n`;

    if (n.parent_id) {
      dot += `  ${n.parent_id} -> ${n.id};\n`;
    }
  });

  dot += '}\n';

  const fullPath = path.resolve(outputPath);
  fs.writeFileSync(fullPath, dot);
}

function getStatusColor(status) {
  const colors = {
    done: 'green',
    in_progress: 'blue',
    open: 'yellow',
    blocked: 'red',
    out_of_budget: 'red',
    refused: 'gray',
    shelved: '#888888',
    rejected: '#8B0000',
    in_question: '#FFA500'
  };
  return colors[status] || 'black';
}

module.exports = { exportForViz };
