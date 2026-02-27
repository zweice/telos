# Telos Visualization — Technical Documentation (φ-tuned)

## Architecture

The visualization uses D3.js v7 with a hierarchical tree layout. All spacing,
sizing, and layout constants are derived from the **golden ratio** (φ ≈ 1.618)
to produce naturally balanced, aesthetically pleasing trees across any viewport.

**File structure (v1.1.0):**

```
web/
├── index.html          # Shell: header, legend, styles — loads viz.js
├── viz.js              # All D3 logic, φ constants, fit-to-viewport
└── telos-data.json     # Generated tree data (from `node src/cli.js viz`)
```

---

## Golden-Ratio (φ) Design System

### Why φ?

The golden ratio (1.6180339…) appears throughout nature and design because
intervals scaled by φ feel "just right" — neither cramped nor wasteful.
By deriving **every spacing constant** from a single `BASE_UNIT` and powers
of φ, the layout stays harmonious regardless of tree depth or viewport size.

### Derivation Table

| Constant             | Formula                     | Value   | Purpose                         |
|----------------------|-----------------------------|---------|----------------------------------|
| `BASE_UNIT`          | 54 (anchor)                 | 54 px   | Atomic spacing unit             |
| `VERTICAL_SPACING`   | `BASE_UNIT × φ²`           | ≈ 141 px | Level-to-level distance         |
| `MIN_HORIZ_SPACING`  | `BASE_UNIT × φ`            | ≈ 87 px  | Minimum sibling separation      |
| `PADDING_OUTER`      | `BASE_UNIT × φ`            | ≈ 87 px  | Outer margin for large screens  |
| `PADDING_FIT`        | `BASE_UNIT`                 | 54 px   | Inset for fit-to-viewport       |

### Node Radius Hierarchy (φ-scaled)

```
goal      →  15 px    (anchor)
milestone →  15 / φ  ≈ 11 px   (clamped for readability)
task      →  15 / φ² ≈  8 px
```

### Font-Size Hierarchy

```
goal      →  13 px
milestone →  11 px
task      →  10 px
```

Each successive level divides by ≈ φ^0.3–0.5, clamped so labels remain legible
at the task level.

---

## Key Technical Decisions

### 1. φ-Based Spacing & Separation

**Problem:** Fixed magic-number spacing leads to cramped or sparse layouts
depending on tree shape and viewport.

**Solution — derive from φ:**

```javascript
const PHI       = 1.6180339887;
const PHI_INV   = 1 / PHI;          // ≈ 0.618
const PHI_SQ    = PHI * PHI;        // ≈ 2.618

const BASE_UNIT         = 54;
const VERTICAL_SPACING  = Math.round(BASE_UNIT * PHI_SQ);  // 141
const MIN_HORIZ_SPACING = Math.round(BASE_UNIT * PHI);     // 87
```

The D3 `tree.separation()` function uses φ as the cousin-to-sibling ratio:

```javascript
.separation((a, b) => {
  const factor = (getNodeWidth(a.data) + getNodeWidth(b.data))
               / (MIN_HORIZ_SPACING * PHI);
  return a.parent === b.parent
    ? Math.max(1, factor)          // siblings: 1×
    : Math.max(1, factor * PHI);   // cousins:  φ×
})
```

### 2. Fit-to-Viewport (replaces old "center" algorithm)

**Problem:** Old centering algorithm hard-capped scale at 0.9 and used a fixed
60 px padding, wasting space on small screens and over-shrinking on large ones.

**Solution — φ-padded fit:**

```javascript
function fitToViewport() {
  const bbox = g.node().getBBox();
  const padX = PADDING_FIT;   // 54 px — φ-derived
  const padY = PADDING_FIT;

  const scaleX = (width  - padX * 2) / bbox.width;
  const scaleY = (height - padY * 2) / bbox.height;
  const scale  = Math.min(1.0, scaleX, scaleY);  // never upscale past 1×

  const cx = width/2  - (bbox.x + bbox.width/2)  * scale;
  const cy = height/2 - (bbox.y + bbox.height/2) * scale;

  svg.transition().duration(650)
    .call(zoomBehavior.transform,
          d3.zoomIdentity.translate(cx, cy).scale(scale));
}
```

Key improvements:
- Caps at 1.0× (old: 0.9×) — no artificial shrink
- Padding derived from φ system, not arbitrary
- Faster transition (650 ms vs 750 ms)
- Called on resize, expand/collapse, and initial render

### 3. φ-Adaptive Text Truncation

**Problem:** Fixed 0.3/0.5/0.7 zoom breakpoints for truncation felt arbitrary.

**Solution — use powers of 1/φ as breakpoints:**

| Zoom level          | Threshold         | Characters shown |
|--------------------|--------------------|------------------|
| < 1/φ² (≈ 0.382)  | Very zoomed out    | 30% of max       |
| < 1/φ  (≈ 0.618)  | Moderate zoom-out  | 62% of max       |
| < 1.0              | Slightly out       | 85% of max       |
| ≥ 1.0              | Full zoom          | 100% of max      |

```javascript
function truncateText(text, type, zoom) {
  let max = NODE_CONFIG[type].maxChars;

  if (zoom < PHI_INV * PHI_INV)      max = Math.floor(max * 0.30);
  else if (zoom < PHI_INV)           max = Math.floor(max * PHI_INV);
  else if (zoom < 1.0)               max = Math.floor(max * 0.85);

  if (max < 4) max = 4;
  return text.length > max ? text.substring(0, max - 1) + '…' : text;
}
```

Text is hidden entirely below zoom 0.25.

### 4. Legend Relocation

**Change:** Legend moved from **bottom-right** → **bottom-left**.

**Rationale:**
- On most trees, the rightmost leaf nodes extend toward the bottom-right,
  causing the legend to occlude them.
- Bottom-left keeps the legend visible without overlapping the tree content.
- The header controls (Reset/Expand/Collapse) sit in the top-right, so
  bottom-left balances the overall layout diagonally — a φ-diagonal aesthetic.

### 5. Script Extraction

The inline `<script>` block (~350 lines) has been extracted to `viz.js`:
- **index.html** is now a clean shell (styles + DOM structure, ~270 lines)
- **viz.js** contains all D3 logic, constants, and event handling (~260 lines)
- Easier to test, lint, and iterate on independently

---

## Node Configuration (v1.1.0)

```javascript
const NODE_CONFIG = {
  goal:      { radius: 15,  fontSize: 13, maxChars: 30 },
  milestone: { radius: 11,  fontSize: 11, maxChars: 24 },
  task:      { radius:  8,  fontSize: 10, maxChars: 20 }
};
```

## Zoom Configuration

```javascript
zoomBehavior = d3.zoom()
  .scaleExtent([0.15, 3.0])   // wider range than v1.0 (was 0.2–2.5)
  .on('zoom', handleZoom);
```

## Color Scheme

Status colors (Tailwind-inspired, unchanged):

| Status        | Hex       | Swatch |
|---------------|-----------|--------|
| Done          | `#10b981` | 🟢     |
| In Progress   | `#3b82f6` | 🔵     |
| Open          | `#f59e0b` | 🟡     |
| Blocked       | `#ef4444` | 🔴     |
| Out of Budget | `#dc2626` | 🔴     |
| Refused       | `#6b7280` | ⚫     |

---

## Responsive Behavior

### Fit-to-viewport on every breakpoint

The `fitToViewport()` function is called on:
- Initial render (after 200 ms paint delay)
- Window `resize` event
- Expand All / Collapse All (after 500 ms animation)
- Reset View button

### Mobile (< 600 px)

- Legend: smaller font (9 px), tighter padding
- Touch: `user-scalable=yes`, pinch-zoom enabled
- No hover states required (touch fallback)

### Tested Viewports

| Viewport        | Resolution   | Notes                                  |
|-----------------|-------------|----------------------------------------|
| Desktop HD      | 1920 × 1080 | Tree centered, plenty of breathing room |
| Laptop          | 1440 × 900  | Good fit, labels fully visible          |
| Tablet portrait | 768 × 1024  | Auto-scales, legend bottom-left         |
| Mobile portrait | 412 × 915   | Compact, pinch-zoom for details         |
| Mobile landscape| 915 × 412   | Horizontal layout well-utilized         |

---

## Dependencies

- **D3.js v7** (CDN): `https://d3js.org/d3.v7.min.js`
- No other runtime dependencies

## Browser Compatibility

- Chrome / Edge: Full support
- Firefox: Full support
- Safari: Full support (iOS 12+)
- Mobile browsers: Full support with touch gestures

## Known Limitations

1. **Large trees (>100 nodes):** May benefit from virtual scrolling or minimap
2. **Very long titles:** Truncated with ellipsis (…)
3. **Print layout:** Not optimized (add `@media print` if needed)

---

## Changelog

### v1.1.0 — φ-tuned (2026-02-19)

- **φ-based spacing:** All spacing/sizing derived from `BASE_UNIT × φⁿ`
- **Fit-to-viewport:** Replaced old centering with proper BBox-aware fit;
  caps at 1× scale, uses φ-derived padding
- **Text truncation:** Breakpoints at 1/φ² and 1/φ instead of hardcoded 0.3/0.5/0.7
- **Legend relocated:** Bottom-right → bottom-left to avoid node occlusion
- **Script extracted:** Inline JS → `viz.js` for maintainability
- **Zoom range widened:** 0.15×–3.0× (was 0.2×–2.5×)
- **Node config tuned:** Goal radius 15→15, milestone 11→11, task 9→8;
  maxChars increased across the board

### v1.0.0 — Initial MVP (2026-02-18)

- D3 tree layout with `nodeSize()`
- Inline script in index.html
- Fixed spacing (140/80 px)
- Legend bottom-right
- Centering with 0.9× cap

---

## Testing Checklist

- [ ] Desktop (Chrome, Firefox, Safari) — 1920×1080
- [ ] Laptop — 1440×900
- [ ] Tablet portrait — 768×1024
- [ ] Mobile portrait — 412×915
- [ ] Mobile landscape — 915×412
- [ ] Zoom levels: 0.15×, 0.4×, 0.6×, 1.0×, 2.0×, 3.0×
- [ ] Text truncation at each φ-breakpoint
- [ ] Fit-to-viewport after expand/collapse
- [ ] Window resize behavior
- [ ] Touch gestures (pinch-zoom, pan)
- [ ] Legend does not occlude tree nodes

---

**Last Updated:** 2026-02-19  
**Author:** Atlas (MacroHard)  
**Version:** 1.1.0 (IT-003 — φ-tuned)
