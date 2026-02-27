-- Migration 001: Add dependencies table (DAG layer)
-- Idempotent: uses CREATE TABLE IF NOT EXISTS
-- Fibonacci ROI convention: [0,1,2,3,5,8,13,21,34,55,89]
-- 0 = no direct business value (infrastructure/support tasks)

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
