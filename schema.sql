-- Telos Database Schema v0.1.0
-- Hierarchical goal and task management with value-based prioritization

CREATE TABLE IF NOT EXISTS nodes (
  -- Identity
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER REFERENCES nodes(id) ON DELETE CASCADE,
  
  -- Classification
  type TEXT NOT NULL CHECK(type IN ('goal', 'milestone', 'task')),
  title TEXT NOT NULL,
  description TEXT,
  owner TEXT NOT NULL,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'open' 
    CHECK(status IN ('open', 'in_progress', 'blocked', 'done', 'out_of_budget', 'refused', 'shelved', 'rejected', 'in_question')),
  
  -- Value model
  value REAL NOT NULL DEFAULT 0,
  cost_estimate REAL NOT NULL DEFAULT 0,
  cost_actual REAL DEFAULT NULL,
  risk REAL DEFAULT 0 CHECK(risk >= 0 AND risk <= 1),
  budget REAL DEFAULT NULL,
  roi INTEGER NOT NULL DEFAULT 0 CHECK(roi IN (0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89)),
  
  -- Time tracking
  effort_hours_estimate REAL DEFAULT NULL,
  effort_hours_actual REAL DEFAULT NULL,
  
  -- Planning dates (user-set, epoch seconds)
  start_date INTEGER DEFAULT NULL,
  end_date INTEGER DEFAULT NULL,
  
  -- Progress (0-100)
  progress INTEGER DEFAULT 0 CHECK(progress >= 0 AND progress <= 100),
  
  -- Success criteria
  success_criteria TEXT,
  
  -- Timestamps
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  started_at INTEGER DEFAULT NULL,
  completed_at INTEGER DEFAULT NULL,
  
  -- Flexible metadata (JSON)
  metadata TEXT DEFAULT '{}' CHECK(json_valid(metadata))
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status);
CREATE INDEX IF NOT EXISTS idx_nodes_owner ON nodes(owner);
CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
CREATE INDEX IF NOT EXISTS idx_nodes_created ON nodes(created_at DESC);

-- Compound index for prioritization queries
CREATE INDEX IF NOT EXISTS idx_nodes_priority ON nodes(status, value, cost_estimate, risk);

-- Index for ROI-based queries
CREATE INDEX IF NOT EXISTS idx_nodes_roi ON nodes(roi DESC);

-- Compound index for ROI + status (common prioritization query)
CREATE INDEX IF NOT EXISTS idx_nodes_roi_status ON nodes(status, roi DESC);

-- View: Nodes with computed ROI
CREATE VIEW IF NOT EXISTS nodes_with_roi AS
SELECT 
  n.*,
  CASE 
    WHEN (n.cost_estimate + (n.value * n.risk)) = 0 THEN 0
    ELSE n.value / (n.cost_estimate + (n.value * n.risk))
  END as roi,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM nodes c 
      WHERE c.parent_id = n.id 
        AND c.status != 'done'
    ) THEN 1
    ELSE 0
  END as has_incomplete_children,
  (
    SELECT COUNT(*) 
    FROM nodes c 
    WHERE c.parent_id = n.id
  ) as child_count,
  (
    SELECT COUNT(*) 
    FROM nodes c 
    WHERE c.parent_id = n.id 
      AND c.status = 'done'
  ) as children_done
FROM nodes n;

-- View: Node path to root (breadcrumb)
CREATE VIEW IF NOT EXISTS node_paths AS
WITH RECURSIVE path(id, parent_id, title, level, path_ids, path_titles) AS (
  SELECT 
    id, 
    parent_id, 
    title,
    0 as level,
    CAST(id AS TEXT) as path_ids,
    title as path_titles
  FROM nodes
  WHERE parent_id IS NULL
  
  UNION ALL
  
  SELECT 
    n.id,
    n.parent_id,
    n.title,
    p.level + 1,
    p.path_ids || '/' || CAST(n.id AS TEXT),
    p.path_titles || ' > ' || n.title
  FROM nodes n
  JOIN path p ON n.parent_id = p.id
)
SELECT * FROM path;

-- View: Downstream value (sum of all descendant values)
CREATE VIEW IF NOT EXISTS downstream_values AS
WITH RECURSIVE descendants(id, value) AS (
  SELECT id, value FROM nodes
  
  UNION ALL
  
  SELECT n.id, n.value
  FROM nodes n
  JOIN descendants d ON n.parent_id = d.id
)
SELECT id, SUM(value) as downstream_value
FROM descendants
GROUP BY id;

-- Trigger: Auto-mark out_of_budget when cost_actual exceeds budget
CREATE TRIGGER IF NOT EXISTS check_budget_exceeded
AFTER UPDATE OF cost_actual ON nodes
FOR EACH ROW
WHEN NEW.budget IS NOT NULL 
  AND NEW.cost_actual IS NOT NULL 
  AND NEW.cost_actual > NEW.budget
  AND NEW.status != 'out_of_budget'
BEGIN
  UPDATE nodes 
  SET status = 'out_of_budget',
      completed_at = strftime('%s', 'now')
  WHERE id = NEW.id;
END;

-- Trigger: Set started_at when status changes to in_progress
CREATE TRIGGER IF NOT EXISTS set_started_at
AFTER UPDATE OF status ON nodes
FOR EACH ROW
WHEN NEW.status = 'in_progress' AND OLD.status != 'in_progress'
BEGIN
  UPDATE nodes 
  SET started_at = strftime('%s', 'now')
  WHERE id = NEW.id;
END;

-- Trigger: Set completed_at when status changes to done
CREATE TRIGGER IF NOT EXISTS set_completed_at
AFTER UPDATE OF status ON nodes
FOR EACH ROW
WHEN NEW.status = 'done' AND OLD.status != 'done'
BEGIN
  UPDATE nodes 
  SET completed_at = strftime('%s', 'now')
  WHERE id = NEW.id;
END;

-- ── Ideas Backlog ─────────────────────────────────────────────────────────────
-- Track business ideas independently of the goal/task hierarchy
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

CREATE INDEX IF NOT EXISTS idx_ideas_status ON ideas(status);
CREATE INDEX IF NOT EXISTS idx_ideas_created ON ideas(created_at DESC);

-- Trigger: auto-update updated_at
CREATE TRIGGER IF NOT EXISTS ideas_updated_at
AFTER UPDATE ON ideas
FOR EACH ROW
BEGIN
  UPDATE ideas SET updated_at = strftime('%s', 'now') WHERE id = NEW.id;
END;
