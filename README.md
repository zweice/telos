# Telos

**Hierarchical goal and task management with value-based prioritization.**

Telos helps you answer: *"What should I work on next?"*

---

## Quick Start

```bash
# Initialize database
node src/cli.js init

# Add root goal
node src/cli.js add "MacroHard: $1B company" \
  --type goal \
  --value 1000000000 \
  --owner andreas

# Add sub-goal
node src/cli.js add "IT-003: Telos MVP" \
  --parent 1 \
  --type milestone \
  --value 50000 \
  --cost 10000 \
  --budget 15000 \
  --owner atlas

# Add tasks
node src/cli.js add "Build CLI" \
  --parent 2 \
  --type task \
  --value 15000 \
  --cost 3000 \
  --effort 20 \
  --owner atlas

# Query next best action
node src/cli.js next --limit 5

# Start work
node src/cli.js start 3

# Mark complete
node src/cli.js complete 3 --cost-actual 2800 --effort-actual 18

# Visualize
node src/cli.js viz
# Then open web/index.html
```

---

## Core Concepts

### Hierarchy
- **Goals** decompose into **milestones** which decompose into **tasks**
- Parent is blocked until all children are `done`
- No cross-dependencies — only parent-child relationships

### Value Model
Every node has:
- **Value**: Business value (currency or arbitrary scale)
- **Cost estimate**: Expected effort/expense
- **Risk**: Probability of failure (0.0-1.0)
- **ROI**: `value / (cost + value * risk)` — higher is better

### Status Lifecycle
```
open → in_progress → done
  ↓         ↓
blocked  out_of_budget
  ↓
refused
```

### Budget Tracking
- Each node can have a `budget` (max allowed cost)
- When `cost_actual > budget`, node auto-transitions to `out_of_budget`
- Helps kill underperforming work early

---

## CLI Reference

### Initialize
```bash
node src/cli.js init
```
Creates `telos.db` with schema.

### Add node
```bash
node src/cli.js add <title> [options]

Options:
  --parent <id>         Parent node ID
  --type <type>         goal | milestone | task (default: task)
  --value <n>           Business value
  --cost <n>            Cost estimate
  --budget <n>          Max allowed cost
  --risk <n>            Risk (0.0-1.0)
  --effort <n>          Effort in hours
  --owner <name>        Owner (default: atlas)
  --description <text>  Details
```

### List nodes
```bash
node src/cli.js list [options]

Options:
  --status <status>     Filter by status (open, in_progress, done, etc.)
  --owner <name>        Filter by owner
  --type <type>         Filter by type
  --parent <id>         Filter by parent
  --sort <field>        Sort by: roi, value, cost, created (default: roi)
  --limit <n>           Limit results
```

### Show node details
```bash
node src/cli.js show <id>
```

### Update node
```bash
node src/cli.js update <id> [options]

Options:
  --title <text>
  --status <status>
  --value <n>
  --cost <n>
  --budget <n>
  --owner <name>
  --description <text>
```

### Start work
```bash
node src/cli.js start <id>
```
Sets status to `in_progress`, records `started_at`.

### Complete work
```bash
node src/cli.js complete <id> [options]

Options:
  --cost-actual <n>     Actual cost
  --effort-actual <n>   Actual effort hours
```
Sets status to `done`, records `completed_at`, updates actuals.

### Block work
```bash
node src/cli.js block <id> --reason <text>
```
Sets status to `blocked`, stores reason in metadata.

### Refuse work
```bash
node src/cli.js refuse <id> --reason <text>
```
Sets status to `refused`, stores reason in metadata.

### Delete node
```bash
node src/cli.js delete <id>
```
Deletes node and all descendants (CASCADE).

### Next best action
```bash
node src/cli.js next [options]

Options:
  --limit <n>           Number of results (default: 10)
  --owner <name>        Filter by owner
```
Shows top tasks by ROI, excluding blocked nodes.

### Bottleneck report
```bash
node src/cli.js bottlenecks
```
Shows parents blocked by incomplete children, sorted by downstream value.

### Workload report
```bash
node src/cli.js workload
```
Shows effort hours by owner for in-progress tasks.

### Estimation accuracy
```bash
node src/cli.js accuracy
```
Shows mean absolute error for cost and effort estimates on completed tasks.

### Visualize
```bash
node src/cli.js viz [options]

Options:
  --output <path>       Output JSON path (default: web/telos-data.json)
  --format <format>     Export format: json | mermaid | dot (default: json)
```
Exports data for browser visualization or diagram generation.

---

## Browser Visualization

After running `node src/cli.js viz`, open `web/index.html` in a browser.

**Features:**
- Interactive tree view (D3.js)
- Color-coded by status:
  - 🟢 Green: done
  - 🔵 Blue: in_progress
  - 🟡 Yellow: open
  - 🔴 Red: blocked / out_of_budget / refused
- Hover for node details (value, cost, ROI)
- Click to expand/collapse branches
- Pan and zoom

---

## Data Export

### JSON (for visualization)
```bash
node src/cli.js viz --format json --output export.json
```

### Mermaid (for documentation)
```bash
node src/cli.js viz --format mermaid --output tree.mmd
```
Then render with Mermaid CLI or paste into docs.

### GraphViz DOT (for diagrams)
```bash
node src/cli.js viz --format dot --output tree.dot
dot -Tpng tree.dot -o tree.png
```

---

## Database

**Location:** `it003-telos/telos.db`

**Schema:** See `schema.sql`

**Backup:**
```bash
cp telos.db telos.db.backup
```

**Reset:**
```bash
rm telos.db
node src/cli.js init
```

---

## Examples

See `docs/examples.md` for detailed workflows.

---

## Project Status

**Version:** 0.1.0 (MVP)  
**Status:** In development  
**Owner:** Atlas  
**Timeline:** 2026-02-18 to 2026-02-19

---

## License

Proprietary — MacroHard internal tool.
