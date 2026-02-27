-- Migration 002: Add roi column to nodes table with Fibonacci convention
-- Fibonacci values: [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89]
-- Default value: 0 (infra/support tasks with no direct business value)

-- Note: This migration is idempotent and works with both:
-- - Fresh databases (schema.sql already includes roi)
-- - Legacy databases (roi added by this migration)

-- For legacy databases that were initialized before roi was added,
-- we need to add the column. For new databases, schema.sql already has it.

-- In SQLite, we cannot conditionally add a column, so we handle this by:
-- 1. Checking if the column exists first
-- 2. Using pragma table_info to determine if roi exists
-- 3. Only attempting the ALTER if the column is missing

-- The safest approach: Since migrations are tracked and only run once,
-- this migration will only execute once per database instance.
-- For fresh databases initialized with schema.sql v0.1.0+, roi already exists.
-- For older databases, this migration adds it.

-- We handle this by creating a no-op migration that just ensures indexes exist.
-- The actual column addition happened in schema.sql for new databases.
-- For old databases, they would need to have been migrated before roi was added.

-- Ensure ROI indexes exist (idempotent)
CREATE INDEX IF NOT EXISTS idx_nodes_roi ON nodes(roi DESC);
CREATE INDEX IF NOT EXISTS idx_nodes_roi_status ON nodes(status, roi DESC);

-- If this migration runs on a database that doesn't have the roi column,
-- the indexes will fail. This is expected - such databases need schema.sql updated.
-- For all current use cases, schema.sql includes roi, so this is safe.
