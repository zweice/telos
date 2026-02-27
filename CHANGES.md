Telos IT-003: Summary of changes (phi-based Telos viz) - [wip]

## 2026-02-24 — Idea Backlog Feature (Task #14) ✅

**CLI (`src/cli.js`):**
- Added `telos idea add <title>` — add idea with description, rationale, status, key-decisions, tags
- Added `telos idea list [--status active|parked|rejected]` — tabular list with filtering
- Added `telos idea show <id>` — full detail view
- Added `telos idea update <id>` — update any field
- Added `telos idea delete <id>` — remove an idea

**Database (`src/db.js`, `schema.sql`):**
- New `ideas` table: title, description, rationale, status (active/parked/rejected), key_decisions, tags (JSON array), created_at/updated_at
- Auto-updated `updated_at` trigger
- `ensureIdeasTable()` method — idempotent, safe for existing DBs (no migration needed)
- Methods: `addIdea`, `getIdea`, `listIdeas`, `updateIdea`, `deleteIdea`, `getAllIdeas`

**Viz export (`src/viz.js`):**
- JSON export now includes `ideas` array alongside the tree

**API server (`api-server.js`):**
- New `GET /api/ideas[?status=active|parked|rejected]` endpoint

**Web UI (`web/index.html`, `web/viz.js`):**
- Tab bar: 🌳 Tree | 💡 Ideas
- Ideas panel renders cards grouped by status: Active / Parked / Rejected
- Live fetch from `/api/ideas` with fallback to static `telos-data.json`
- Cards show title, rationale, description, key-decisions, tags, created date
- Seed data: 3 ideas added (OpenClaw SaaS, Atlas vector DB memory, Telos mobile app)

- Modified index.html to introduce premium UI, accessibility hooks, responsive legend collapse toggle for narrow viewports (<400px).
- Reworked styling to use a more polished, Apple-like aesthetic with glassy panels and smooth shadows.
- Added ARIA roles and keyboard accessibility scaffolding to the container and controls.
- Added a legend toggle button for narrow viewports; legend hides by default under 400px and can be revealed by tapping the toggle.
- Fit-to-viewport hook is wired in a resize handler in viz.js (placeholder in current iteration).
- telos-data.json remains unchanged.

Notes:
- viz.js implementation currently replaced with placeholder during the migration; core φ-driven layout logic not included in this patch. The finale should restore the φ-based diagram rendering, spacing tuning, truncation, and interactions as described in the request.
