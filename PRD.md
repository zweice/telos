# Telos — Product Requirements Document

**Version:** 0.1.0  
**Date:** 2026-02-18  
**Owner:** Andreas Weiss  
**Agent:** Atlas  
**Project:** IT-003

---

## Vision

A hierarchical goal and task management system that optimizes decision-making through value-based prioritization. Telos maps the path from top-level strategic goals to executable tasks, tracking cost, value, risk, and progress to surface the highest-ROI work at any moment.

**Core insight:** Most tools track *what* needs doing. Telos calculates *what to do next*.

---

## Problem Statement

Current work management tools fail to:
1. **Model hierarchical goals** — flat task lists or rigid project structures
2. **Optimize prioritization** — no cost/value/risk modeling for rational decision-making
3. **Track empirical learning** — estimates never improve
4. **Surface bottlenecks** — no dependency-aware critical path analysis
5. **Support agent assignment** — no capability matching or workload tracking

**Result:** Time wasted on low-value work, unclear priorities, blocked progress.

---

## Core Principles

1. **Hierarchy is king** — Goals decompose into sub-goals, then tasks. Parent blocked until all children complete.
2. **Value-driven** — Every node has explicit value, cost, risk. ROI = value / (cost + risk).
3. **Owner accountability** — Every node has one owner who decides breakdown and estimates.
4. **Empirical learning** — Track estimated vs actual cost/time to improve future estimates.
5. **Transparent status** — Every node: open | in_progress | blocked | done | out_of_budget | refused.
6. **No cross-dependencies** — Only parent-child blocking. Simpler mental model, easier to reason about.

---

## User Stories

### As Andreas (strategist):
- I want to **define top-level goals** with explicit value and success criteria
- I want to **see the highest ROI tasks** to decide what to work on next
- I want to **track budget** per goal so I know when to kill underperforming branches
- I want to **visualize the tree** to understand structure and progress

### As Atlas (COO):
- I want to **break down goals** into actionable sub-goals and tasks
- I want to **assign nodes** to agents based on capability and capacity
- I want to **surface bottlenecks** (blocked parents with high downstream value)
- I want to **track completion** and update parent status automatically

### As an agent:
- I want to **query my assigned work** sorted by priority
- I want to **report progress** (start, complete, block)
- I want to **learn from history** (actual vs estimated cost)

---

## Data Model

### Node (core entity)

| Field | Type | Description |
|-------|------|-------------|
| `id` | INTEGER | Primary key |
| `parent_id` | INTEGER | Foreign key to parent node (NULL = root) |
| `type` | TEXT | `goal` \| `milestone` \| `task` |
| `title` | TEXT | Human-readable name |
| `description` | TEXT | Context and details |
| `owner` | TEXT | Responsible agent/person |
| `status` | TEXT | `open` \| `in_progress` \| `blocked` \| `done` \| `out_of_budget` \| `refused` |
| `value` | REAL | Business value (currency or arbitrary scale) |
| `cost_estimate` | REAL | Estimated effort/expense |
| `cost_actual` | REAL | Actual cost (updated on completion) |
| `risk` | REAL | Probability of failure (0.0-1.0) |
| `budget` | REAL | Max allowed cost (node dies if exceeded) |
| `effort_hours_estimate` | REAL | Estimated time |
| `effort_hours_actual` | REAL | Actual time |
| `success_criteria` | TEXT | Definition of done |
| `created_at` | INTEGER | Unix timestamp |
| `started_at` | INTEGER | Unix timestamp |
| `completed_at` | INTEGER | Unix timestamp |
| `metadata` | JSON | Flexible context (links, notes, etc.) |

### Computed fields (queries)
- `roi` = `value / (cost_estimate + (value * risk))`
- `blocked` = any child with status != `done`
- `children_done` = COUNT(children WHERE status='done') / COUNT(children)
- `path_to_root` = recursive parent chain
- `downstream_value` = SUM(value of all descendants)

---

## Node Lifecycle

```
open → in_progress → done
  ↓         ↓          
blocked  out_of_budget
  ↓
refused
```

**State transitions:**
- `open` → `in_progress`: work started
- `in_progress` → `blocked`: waiting on child/external dependency
- `blocked` → `in_progress`: blocker resolved
- `in_progress` → `done`: success criteria met
- `in_progress` → `out_of_budget`: cost_actual > budget
- `open` → `refused`: decided not to pursue

**Parent auto-blocking:**
- If any child is not `done`, parent is implicitly blocked
- Parent can only be marked `done` when all children are `done`

---

## Prioritization Algorithm

**Next best action query:**
```sql
SELECT 
  id, 
  title, 
  value, 
  cost_estimate, 
  risk,
  (value / (cost_estimate + (value * risk))) as roi
FROM nodes
WHERE status = 'open'
  AND parent_id NOT IN (
    SELECT DISTINCT parent_id 
    FROM nodes 
    WHERE status != 'done' AND parent_id IS NOT NULL
  )
ORDER BY roi DESC
LIMIT 10;
```

**Explanation:**
- Only show `open` nodes
- Exclude nodes whose parent has other incomplete children (parent is blocked)
- Sort by ROI descending
- Return top 10

---

## Budget Tracking

Each node has a `budget` field. When `cost_actual` exceeds `budget`, the node is automatically marked `out_of_budget`.

**Kill criteria:**
- Manual: owner decides to refuse the node
- Automatic: `cost_actual > budget` triggers `out_of_budget` status
- Cascade: if a critical child dies, owner may refuse the parent

**Budget allocation:**
- Top-level goals set by Andreas
- Sub-goals inherit proportion of parent budget (can be overridden)
- Tasks inherit remaining parent budget / remaining children

---

## KPIs vs Binary Completion

**For tasks and milestones:** Binary done/not done.

**For top-level goals:** KPIs track ongoing success.

| Node Type | Completion Model |
|-----------|------------------|
| Task | Binary (done / not done) |
| Milestone | Binary (criteria met / not met) |
| Goal | KPI-based (e.g., "Revenue > $1M", "Users > 10K") |

**KPI tracking (future iteration):**
- `kpi_metric` (e.g., "revenue", "users")
- `kpi_target` (e.g., 1000000, 10000)
- `kpi_current` (updated regularly)
- Status: `in_progress` until `kpi_current >= kpi_target`, then `done`

**MVP:** Start with binary completion for all nodes. Add KPI support in v0.2.

---

## MVP Feature Set (IT-003)

### Core functionality:
1. ✅ **CLI for CRUD operations**
   - `telos add <title> --parent <id> --value <n> --cost <n>`
   - `telos list --status open --sort roi`
   - `telos show <id>`
   - `telos update <id> --status in_progress`
   - `telos assign <id> --owner atlas`
   - `telos delete <id>`

2. ✅ **SQLite backend with schema**
   - Nodes table
   - Indexes for fast queries
   - Recursive CTE for parent chains

3. ✅ **Prioritization queries**
   - Next best action (ROI-sorted)
   - Bottleneck report (parents blocked by most children)
   - Workload by owner

4. ✅ **Browser visualization**
   - Interactive tree view (D3.js)
   - Color-coded by status
   - Hover for node details
   - Click to expand/collapse
   - Export to SVG/PNG

5. ✅ **Empirical learning**
   - Track `cost_estimate` vs `cost_actual`
   - Track `effort_hours_estimate` vs `effort_hours_actual`
   - Report on estimation accuracy

### Out of scope (v0.2+):
- KPI tracking for goals
- Cross-node dependencies (only parent-child for MVP)
- Agent capability matching (manual assignment only)
- Rollback/version history
- Multi-user access control
- Real-time collaboration

---

## Technical Stack

| Component | Technology |
|-----------|-----------|
| Backend | SQLite (better-sqlite3) |
| CLI | Node.js (commander.js) |
| Visualization | Static HTML + D3.js v7 |
| Query Engine | SQL with recursive CTEs |
| Data Export | JSON, CSV, Mermaid, GraphViz |

**Why SQLite?**
- Local-first (no server)
- Fast queries (indexes + CTEs)
- Single file (easy backup/sync)
- Flexible (JSON columns for metadata)

**Why static HTML + D3.js?**
- No server needed
- Works offline
- Fast rendering
- Export/screenshot capability

---

## File Structure

```
it003-telos/
├── PRD.md                  # This document
├── README.md               # User guide
├── schema.sql              # Database schema
├── telos.db                # SQLite database (created on first run)
├── src/
│   ├── cli.js              # CLI entry point
│   ├── db.js               # Database operations
│   ├── queries.js          # Prioritization and reporting
│   └── viz.js              # Visualization export
├── web/
│   ├── index.html          # Tree visualization UI
│   ├── telos-data.json     # Exported data for viz
│   └── style.css           # Visualization styles
└── docs/
    └── examples.md         # Usage examples
```

---

## CLI Examples

### Initialize and add root goal
```bash
telos init
telos add "MacroHard: One-person $1B company" --type goal --value 1000000000 --owner andreas
```

### Break down into sub-goals
```bash
telos add "IT-003: Work management MVP" --parent 1 --type milestone --value 50000 --cost 10000 --budget 15000 --owner atlas
telos add "Build Telos CLI" --parent 2 --type task --value 15000 --cost 3000 --effort 20 --owner atlas
telos add "Build browser viz" --parent 2 --type task --value 20000 --cost 4000 --effort 25 --owner atlas
```

### Query next best actions
```bash
telos next --limit 5
# Output:
# ID  Title                     ROI    Value  Cost  Status
# 3   Build Telos CLI          4.29   15000  3000  open
# 4   Build browser viz        4.55   20000  4000  open
```

### Update status
```bash
telos start 3
telos complete 3 --cost-actual 2800 --effort-actual 18
```

### Visualize
```bash
telos viz --output web/telos-data.json
# Open web/index.html in browser
```

### Report bottlenecks
```bash
telos bottlenecks
# Output:
# Parent                       Blocked By  Downstream Value
# IT-003: Work management MVP  2           50000
```

---

## Success Metrics (for Telos itself)

| Metric | Target | Measure |
|--------|--------|---------|
| Time to first value | < 5 min | Andreas can add goals and see ROI ranking |
| Query speed | < 100ms | Next-best-action query on 1000 nodes |
| Estimation accuracy | Improve 20% | MAE (actual vs estimate) decreases over 10 tasks |
| Adoption | Daily use | Andreas uses Telos for all IT-004+ planning |

---

## Risks & Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Over-engineering | Medium | High | Start with MVP, defer features to v0.2 |
| Estimation overhead | Low | Medium | Make estimates optional, default to parent/avg |
| Visualization complexity | Medium | Medium | Use proven D3.js templates, limit interactivity |
| Schema changes | Low | High | Use migrations (simple SQL scripts) |

---

## Timeline (Estimated)

| Phase | Tasks | Effort | Owner |
|-------|-------|--------|-------|
| 1. Schema + DB | Write schema.sql, db.js | 3h | Atlas |
| 2. Core CLI | cli.js, queries.js | 5h | Atlas |
| 3. Visualization | web/index.html, D3.js integration | 6h | Atlas |
| 4. Testing | Sample data, query validation | 2h | Atlas |
| 5. Documentation | README, examples | 2h | Atlas |
| **Total** | | **18h** | |

**Target delivery:** 2026-02-19 (tomorrow)

---

## Open Questions

1. **KPI tracking:** Start with binary or implement KPI fields in MVP?
   - **Decision:** Binary for MVP, KPI in v0.2
2. **Budget inheritance:** Auto-allocate or manual only?
   - **Decision:** Manual only for MVP
3. **Visualization interactivity:** How much is needed?
   - **Decision:** Read-only tree view, click to expand/collapse
4. **Export formats:** Which ones matter most?
   - **Decision:** JSON (for viz), Mermaid (for docs), CSV (for analysis)

---

## Next Steps

1. ✅ Write PRD (this document)
2. ⏳ Create schema.sql
3. ⏳ Build db.js (CRUD operations)
4. ⏳ Build cli.js (commander interface)
5. ⏳ Build queries.js (prioritization)
6. ⏳ Build viz.js (export for D3)
7. ⏳ Build web/index.html (tree visualization)
8. ⏳ Test with real IT-003 data
9. ⏳ Document in README.md

---

**Approved by:** [Andreas signature pending]  
**Start date:** 2026-02-18  
**Target delivery:** 2026-02-19
