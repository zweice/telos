/* Telos — D3 visualization */
(function () {
  'use strict';

  // ── Constants ────────────────────────────────────────────────────────────
  const EDGE_TREE_STROKE  = 'rgba(99,120,150,0.35)';
  const EDGE_DEP_COLOR    = 'var(--edge-dep, #f97316)';
  const EDGE_DIM_OPACITY  = 0.15;

  // Border glow colors per status
  const BORDER_COLORS = {
    open:          '#6366f1',
    in_progress:   '#3b82f6',
    done:          '#4ade80',
    blocked:       '#ef4444',
    out_of_budget: '#ef4444',
    shelved:       '#475569',
    rejected:      '#374151',
    refused:       '#374151',
    in_question:   '#eab308',
    locked:        '#6b7280',
  };

  // ── Settings ─────────────────────────────────────────────────────────────
  const DEFAULT_SETTINGS = {
    layout:             'horizontal',
    fontSize:           1,
    labelThreshold:     0.55,
    nodeScale:          0.7,
    spacingH:           240,
    spacingV:           60,
    levelSpacing:       80,
    edgeWidth:          2,
    edgeOpacity:        0.6,
    animations:         true,
    nodeShape:          'rect',
    nodeCornerRadius:   8,
    truncMinChars:      8,
    truncMaxChars:      40,
    truncWhitespaceMax: 28,
    secondaryField:     'none',
    hideShelved:        false,
    nodeTextColor:      '#c9d1d9',
    viewMode:           'combined-tree',
    scaleTextToFit:     false,
    // Edge colors
    treeEdgeColor:      '#637896',
    depEdgeColor:       '#f97316',
    // Status colors (border)
    colorOpen:          '#6366f1',
    colorInProgress:    '#3b82f6',
    colorDone:          '#10b981',
    colorBlocked:       '#ef4444',
    colorShelved:       '#71717a',
    colorRejected:      '#475569',
    colorRefused:       '#475569',
    colorInQuestion:    '#f59e0b',
    colorOutOfBudget:   '#e11d48',
  };

  // ── Cookie helpers ────────────────────────────────────────────────────────
  function saveCookie(name, value) {
    const exp = new Date(Date.now() + 365 * 864e5).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(String(value))}; expires=${exp}; path=/; SameSite=Lax`;
  }
  function loadCookie(name, defaultVal) {
    try {
      const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
      if (m) return decodeURIComponent(m[1]);
    } catch {}
    return defaultVal;
  }
  function saveSettings(s) {
    const exp = new Date(Date.now() + 365 * 864e5).toUTCString();
    document.cookie = `telos_settings=${encodeURIComponent(JSON.stringify(s))}; expires=${exp}; path=/; SameSite=Lax`;
  }
  function loadSettings() {
    try {
      const m = document.cookie.match(/(?:^|;\s*)telos_settings=([^;]*)/);
      if (m) return { ...DEFAULT_SETTINGS, ...JSON.parse(decodeURIComponent(m[1])) };
    } catch {}
    return { ...DEFAULT_SETTINGS };
  }

  let settings = loadSettings();

  // ── Smart truncation ──────────────────────────────────────────────────────
  function smartTruncate(text, s) {
    const { truncMinChars, truncMaxChars, truncWhitespaceMax } = s;
    if (text.length <= truncMaxChars) return text;
    const sub       = text.slice(0, truncWhitespaceMax);
    const lastSpace = sub.lastIndexOf(' ');
    if (lastSpace >= truncMinChars) return text.slice(0, lastSpace); // clean cut, no ellipsis
    return text.slice(0, truncMaxChars) + '…'; // hard mid-word fallback only
  }

  function getSecondaryText(d, s) {
    const nd = d.data;
    switch (s.secondaryField) {
      case 'owner':  return nd.owner           ? String(nd.owner)  : '';
      case 'roi':    return nd.roi    != null   ? `ROI ${parseFloat(nd.roi).toFixed(1)}` : '';
      case 'cost':   return nd.cost_estimate != null ? `€${Number(nd.cost_estimate).toLocaleString()}` : '';
      case 'status': return nd.status          ? nd.status.replace(/_/g, ' ') : '';
      case 'type':   return nd.type            ? nd.type : '';
      default:       return '';
    }
  }

  // Approximate rect dimensions for a node (text-width based)
  function nodeRectDims(d, s) {
    const scale    = s.nodeScale || 1;
    const fontSize = 11 * s.fontSize;
    const charW    = fontSize * 0.58;
    const lockPrefix = d.data.locked ? '🔒 ' : '';
    const label    = `${lockPrefix}#${d.data.id} ${d.data.title || ''}`;
    const text1    = smartTruncate(label, s);
    const w1       = text1.length * charW + 32;
    const hasSec   = s.secondaryField && s.secondaryField !== 'none';
    const text2    = hasSec ? getSecondaryText(d, s) : '';
    const w2       = text2 ? (text2.length * charW * 0.8 + 32) : 0;
    const w        = Math.max(w1, w2, 60) * scale;
    const lineH    = fontSize * 1.4;
    const h        = ((hasSec && text2) ? (lineH * 2 + 16) : (lineH + 16)) * scale;
    return { w, h };
  }

  // Bottom half-height (for progress-bar placement)
  function nodeBottom(d, radii, s) {
    if (s.nodeShape === 'circle') return radii[d.data.type] || radii.task;
    return nodeRectDims(d, s).h / 2;
  }

  // Half-width (for progress-bar width)
  function nodeHalfWidth(d, radii, s) {
    if (s.nodeShape === 'circle') return radii[d.data.type] || radii.task;
    return nodeRectDims(d, s).w / 2;
  }

  // Effective collision radius for force layout + hit-target
  function nodeCollisionR(d, radii, s) {
    if (s.nodeShape === 'circle') return radii[d.data.type] || radii.task;
    const { w, h } = nodeRectDims(d, s);
    return Math.sqrt(w * w + h * h) / 2;
  }

  // ── Dynamic node sizing ──────────────────────────────────────────────────
  function computeNodeRadius(count) {
    const base  = Math.min(width, height) / Math.sqrt(Math.max(count, 1)) * 0.38;
    const scale = settings.nodeScale;
    return {
      goal:      Math.max(24, Math.min(base * 1.4, 72)) * scale,
      milestone: Math.max(18, Math.min(base,       54)) * scale,
      task:      Math.max(12, Math.min(base * 0.7, 38)) * scale,
    };
  }

  // ── Done-filter state ────────────────────────────────────────────────────
  let doneFilterDays = (() => {
    const v = loadCookie('telos_done_filter_days', null);
    return v !== null ? parseInt(v, 10) : 1;
  })();

  let rawTreeData = null;

  function getCutoffSecs(days) {
    if (days === -1) return Infinity;
    if (!days || days <= 0) return 0;
    return Math.floor(Date.now() / 1000) - days * 86400;
  }

  function applyDoneFilter(node, cutoffSecs) {
    if (!node) return node;
    if (!node.children || node.children.length === 0) return node;
    node.children = node.children
      .filter(c => {
        if (c.status === 'done' && cutoffSecs > 0) {
          if (!c.completed_at || c.completed_at < cutoffSecs) return false;
        }
        return true;
      })
      .map(c => applyDoneFilter(c, cutoffSecs));
    return node;
  }

  function syncFilterSelect() {
    const sel = document.getElementById('done-filter');
    if (!sel) return;
    const opt = Array.from(sel.options).find(o => parseInt(o.value, 10) === doneFilterDays);
    sel.value = opt ? opt.value : String(doneFilterDays);
  }

  // ── Hide-rejected filter state ───────────────────────────────────────────
  let hideRejected = loadCookie('telos_hide_rejected', 'false') === 'true';
  let hideShelved  = loadCookie('telos_hide_shelved',  'false') === 'true';
  let hideBlocked  = loadCookie('telos_hide_blocked',  'false') === 'true';

  function applyRejectedFilter(node) {
    if (!node) return node;
    if (!node.children || node.children.length === 0) return node;
    node.children = node.children
      .filter(c => c.status !== 'rejected')
      .map(c => applyRejectedFilter(c));
    return node;
  }

  function applyShelvedFilter(node) {
    if (!node) return node;
    if (!node.children || node.children.length === 0) return node;
    node.children = node.children
      .filter(c => c.status !== 'shelved')
      .map(c => applyShelvedFilter(c));
    return node;
  }
  function applyBlockedFilter(node) {
    if (!node) return node;
    if (!node.children || node.children.length === 0) return node;
    node.children = node.children
      .filter(c => c.status !== 'blocked' && !c.locked)
      .map(c => applyBlockedFilter(c));
    return node;
  }

  function syncHideRejectedBtn() {
    const btn = document.getElementById('hide-rejected-btn');
    if (!btn) return;
    btn.textContent = hideRejected ? 'Show rejected' : 'Hide rejected';
    btn.classList.toggle('btn-active', hideRejected);
    btn.setAttribute('aria-pressed', String(hideRejected));
  }

  function syncHideShelvedBtn() {
    const btn = document.getElementById('hide-shelved-btn');
    if (!btn) return;
    btn.textContent = hideShelved ? 'Show shelved' : 'Hide shelved';
    btn.classList.toggle('btn-active', hideShelved);
    btn.setAttribute('aria-pressed', String(hideShelved));
  }
  function syncHideBlockedBtn() {
    const btn = document.getElementById('hide-blocked-btn');
    if (!btn) return;
    btn.textContent = hideBlocked ? 'Show blocked' : '🔒 Hide blocked';
    btn.classList.toggle('btn-active', hideBlocked);
    btn.setAttribute('aria-pressed', String(hideBlocked));
    document.body.classList.toggle('hide-blocked', hideBlocked);
  }

  window.toggleHideRejected = function () {
    hideRejected = !hideRejected;
    saveCookie('telos_hide_rejected', hideRejected);
    syncHideRejectedBtn();
    if (!rawTreeData) return;
    let copy = JSON.parse(JSON.stringify(rawTreeData));
    const cutoff = getCutoffSecs(doneFilterDays);
    if (cutoff > 0) applyDoneFilter(copy, cutoff);
    if (hideRejected) applyRejectedFilter(copy);
    if (hideShelved)  applyShelvedFilter(copy);
    if (hideBlocked)  applyBlockedFilter(copy);
    const newRoot = d3.hierarchy(copy, d => d.children && d.children.length ? d.children : null);
    newRoot.x0 = width / 2;
    newRoot.y0 = height / 2;
    newRoot.descendants().forEach(d => {
      if (d.depth > 1) { d._children = d.children; d.children = null; }
    });
    root = newRoot;
    window._telosRoot = root;
    gLinks.selectAll('.link').remove();
    gNodes.selectAll('.node').remove();
    update(root);
    setTimeout(resetView, 400);
    if (typeof renderListView === 'function') renderListView();
  };

  window.toggleHideShelved = function () {
    hideShelved = !hideShelved;
    saveCookie('telos_hide_shelved', hideShelved);
    syncHideShelvedBtn();
    if (!rawTreeData) return;
    let copy = JSON.parse(JSON.stringify(rawTreeData));
    const cutoff = getCutoffSecs(doneFilterDays);
    if (cutoff > 0) applyDoneFilter(copy, cutoff);
    if (hideRejected) applyRejectedFilter(copy);
    if (hideShelved)  applyShelvedFilter(copy);
    if (hideBlocked)  applyBlockedFilter(copy);
    const newRoot = d3.hierarchy(copy, d => d.children && d.children.length ? d.children : null);
    newRoot.x0 = width / 2;
    newRoot.y0 = height / 2;
    newRoot.descendants().forEach(d => {
      if (d.depth > 1) { d._children = d.children; d.children = null; }
    });
    root = newRoot;
    window._telosRoot = root;
    gLinks.selectAll('.link').remove();
    gNodes.selectAll('.node').remove();
    update(root);
    setTimeout(resetView, 400);
    if (typeof renderListView === 'function') renderListView();
  };
  window.toggleHideBlocked = function () {
    hideBlocked = !hideBlocked;
    saveCookie('telos_hide_blocked', hideBlocked);
    syncHideBlockedBtn();
    document.body.classList.toggle('hide-blocked', hideBlocked);
    if (!rawTreeData) return;
    let copy = JSON.parse(JSON.stringify(rawTreeData));
    const cutoff = getCutoffSecs(doneFilterDays);
    if (cutoff > 0) applyDoneFilter(copy, cutoff);
    if (hideRejected) applyRejectedFilter(copy);
    if (hideShelved)  applyShelvedFilter(copy);
    if (hideBlocked)  applyBlockedFilter(copy);
    const newRoot = d3.hierarchy(copy, d => d.children && d.children.length ? d.children : null);
    newRoot.x0 = width / 2;
    newRoot.y0 = height / 2;
    newRoot.descendants().forEach(d => {
      if (d.depth > 1) { d._children = d.children; d.children = null; }
    });
    root = newRoot;
    window._telosRoot = root;
    gLinks.selectAll('.link').remove();
    gNodes.selectAll('.node').remove();
    update(root);
    setTimeout(resetView, 400);
    if (typeof renderListView === 'function') renderListView();
  };

  // ── State ────────────────────────────────────────────────────────────────
  let root, svg, gAll, gLinks, gNodes, gDepEdges, width, height;
  let zoomBehavior    = null;
  let simulation      = null;
  let currentZoom     = 1;
  let lastUpdatedTime = null;
  let depsVisible = (() => {
    const v = loadCookie('telos_deps_visible', null);
    return v !== null ? v === 'true' : true; // default ON
  })();
  let cachedDeps      = null;
  const tooltip       = document.getElementById('tooltip');


  function updateLastUpdatedDisplay() {
    const el = document.getElementById('last-updated');
    if (!el || !lastUpdatedTime) return;
    const t  = new Date(lastUpdatedTime);
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    const ss = String(t.getSeconds()).padStart(2, '0');
    el.textContent = `${hh}:${mm}:${ss}`;
  }

  // ── Theme ────────────────────────────────────────────────────────────────
  (function initTheme() {
    const saved       = loadCookie('telos_theme', '');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme       = saved || (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = theme === 'dark' ? '☀' : '🌙';
  })();

  window.toggleTheme = function () {
    const cur  = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    saveCookie('telos_theme', next);
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = next === 'dark' ? '☀' : '🌙';
    // Auto-switch node text color if still at the per-theme default
    const DARK_DEFAULT = '#c9d1d9', LIGHT_DEFAULT = '#444c56';
    if (next === 'light' && settings.nodeTextColor === DARK_DEFAULT) {
      settings.nodeTextColor = LIGHT_DEFAULT;
      saveSettings(settings);
    } else if (next === 'dark' && settings.nodeTextColor === LIGHT_DEFAULT) {
      settings.nodeTextColor = DARK_DEFAULT;
      saveSettings(settings);
    }
    const colorEl = document.getElementById('s-nodeTextColor');
    if (colorEl) colorEl.value = settings.nodeTextColor;
    updateLabels();
  };

  // ── Bootstrap ────────────────────────────────────────────────────────────
  fetch('http://localhost:8089/api/tree', { cache: 'no-store', signal: AbortSignal.timeout(3000) })
    .then(r => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json();
    })
    .then(data => {
      rawTreeData = data.tree[0];
      lastUpdatedTime = Date.now();
      syncFilterSelect();
      init(JSON.parse(JSON.stringify(rawTreeData)));
    })
    .catch(err => {
      console.warn('API fetch failed, trying static file:', err.message);
      fetch('telos-data.json')
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then(data => {
          rawTreeData = data.tree[0];
          lastUpdatedTime = Date.now();
          syncFilterSelect();
          init(JSON.parse(JSON.stringify(rawTreeData)));
        })
        .catch(err2 => {
          document.getElementById('container').innerHTML =
            `<div id="error">⚠️ Could not load data<br><small>${err2.message}</small></div>`;
        });
    });

  function init(treeData) {
    const container = document.getElementById('container');
    width  = container.clientWidth;
    height = container.clientHeight;

    const cutoff = getCutoffSecs(doneFilterDays);
    if (cutoff > 0) applyDoneFilter(treeData, cutoff);
    if (hideRejected) applyRejectedFilter(treeData);
    if (hideShelved)  applyShelvedFilter(treeData);
    if (hideBlocked)  applyBlockedFilter(treeData);

    root = d3.hierarchy(treeData, d => d.children && d.children.length ? d.children : null);
    root.x0 = width  / 2;
    root.y0 = height / 2;
    window._telosRoot = root;

    root.descendants().forEach(d => {
      if (d.depth > 1) {
        d._children = d.children;
        d.children  = null;
      }
    });

    svg = d3.select('#container')
      .append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('width',  width)
      .attr('height', height)
      .attr('role',   'img')
      .attr('aria-label', 'Telos goal tree');

    // Zoom — tracks currentZoom for label scaling
    zoomBehavior = d3.zoom()
      .scaleExtent([0.05, 6])
      .on('zoom', e => {
        gAll.attr('transform', e.transform);
        currentZoom = e.transform.k;
        updateLabels();
      });
    svg.call(zoomBehavior);
    svg.on('dblclick.zoom', null); // Fix 1: let dblclick open detail panel, not zoom

    gAll      = svg.append('g').attr('class', 'all');
    gLinks    = gAll.append('g').attr('class', 'links');
    gNodes    = gAll.append('g').attr('class', 'nodes');
    gDepEdges = gAll.append('g').attr('id', 'dep-edges'); // LAST = on top

    // Dep arrow marker
    const defs = svg.append('defs');
    defs.append('marker')
      .attr('id',           'dep-arrow')
      .attr('markerWidth',  10)
      .attr('markerHeight', 7)
      .attr('refX',         9)
      .attr('refY',         3.5)
      .attr('orient',       'auto')
      .append('path')
        .attr('d',    'M 0 0 L 0 7 L 10 3.5 z')
        .attr('fill', EDGE_DEP_COLOR);

    update(root);
    resetView();

    window.resetView    = resetView;
    window.expandAll    = expandAll;
    window.collapseAll  = collapseAll;
    window.toggleLegend = toggleLegend;
    window.toggleDeps   = toggleDeps;

    // Auto-load deps on init if depsVisible (default true or saved cookie)
    if (depsVisible) {
      const btn = document.getElementById('deps-btn');
      if (btn) { btn.classList.add('btn-active'); btn.setAttribute('aria-pressed', 'true'); }
      fetch(`http://localhost:8089/api/dependencies?_=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(3000) })
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(data => drawDepEdges(Array.isArray(data) ? data : (data.dependencies || [])))
        .catch(() => fetch('telos-data.json').then(r => r.json())
          .then(d => drawDepEdges((d.dependencies || []))));
    }

    window.setDoneFilter = function setDoneFilter(days) {
      doneFilterDays = isNaN(days) ? 0 : days;
      saveCookie('telos_done_filter_days', doneFilterDays);
      if (!rawTreeData) return;
      let filtered = applyDoneFilter(
        JSON.parse(JSON.stringify(rawTreeData)),
        getCutoffSecs(doneFilterDays)
      );
      if (hideRejected) applyRejectedFilter(filtered);
      if (hideShelved)  applyShelvedFilter(filtered);
    if (hideBlocked)  applyBlockedFilter(filtered);
      const newRoot = d3.hierarchy(filtered, d => d.children && d.children.length ? d.children : null);
      newRoot.x0 = width  / 2;
      newRoot.y0 = height / 2;
      newRoot.descendants().forEach(d => {
        if (d.depth > 1) { d._children = d.children; d.children = null; }
      });
      root = newRoot;
      window._telosRoot = root;
      gLinks.selectAll('.link').remove();
      gNodes.selectAll('.node').remove();
      update(root);
      setTimeout(resetView, 400);
    };

    window.addEventListener('resize', resize);
    updateLastUpdatedDisplay();
    setInterval(() => refreshData(true), 30000);

    // ── Global keyboard shortcuts ──────────────────────────────────────────
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeDetailPanel();
        closeSettingsPanel();
        dismissContextMenu();
      }
      if (e.key === 's' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = document.activeElement && document.activeElement.tagName;
        if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) {
          e.preventDefault();
          toggleSettingsPanel();
        }
      }
      if (e.key === 'r' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = document.activeElement && document.activeElement.tagName;
        if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) {
          e.preventDefault();
          window.toggleHideRejected();
        }
      }
      if (e.key === 'h' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = document.activeElement && document.activeElement.tagName;
        if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) {
          e.preventDefault();
          window.toggleHideShelved();
        }
      }
    });

    // Click outside dismisses context menu
    document.addEventListener('click', () => dismissContextMenu());

    initSettingsPanel();
    syncHideRejectedBtn();
    syncHideShelvedBtn();
  }

  // ── Resize ───────────────────────────────────────────────────────────────
  function resize() {
    const container = document.getElementById('container');
    width  = container.clientWidth;
    height = container.clientHeight;
    svg.attr('viewBox', `0 0 ${width} ${height}`)
       .attr('width',  width)
       .attr('height', height);
    if (root) update(root);
  }

  // ── Layout: Force-directed ────────────────────────────────────────────────
  function runForceLayout(nodes, links) {
    const radii    = computeNodeRadius(nodes.length);
    const maxDepth = d3.max(nodes, d => d.depth) || 1;
    const isMobile = width < 768;

    // Seed positions for nodes without them
    nodes.forEach(d => {
      if (d.x == null || d.y == null) {
        d.x = width  * (0.15 + d.depth / maxDepth * 0.7) + (Math.random() - 0.5) * 80;
        d.y = height / 2 + (Math.random() - 0.5) * 80;
      }
    });

    if (simulation) simulation.stop();

    simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links)
        .id(d => String(d.data.id))
        .distance(d => isMobile ? 40 : 80 + (d.target.depth || 0) * 20)
        .strength(0.4))
      .force('charge', d3.forceManyBody()
        .strength(d => {
          const kids = (d.children || []).length + (d._children || []).length;
          return isMobile ? -80 : -(200 + kids * 30 + width * height / 12000);
        }))
      .force('center',  d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide(d => {
        const base = nodeCollisionR(d, radii, settings);
        return isMobile ? base + 8 : base + 12;
      }))
      .force('x', d3.forceX(d => width * (0.15 + (d.depth || 0) / maxDepth * 0.7))
        .strength(isMobile ? 0.2 : 0.12))
      .force('y', d3.forceY(height / 2).strength(0.03))
      .alphaDecay(0.03)
      .stop();

    // Run synchronously to convergence
    const n = Math.ceil(Math.log(simulation.alphaMin()) / Math.log(1 - simulation.alphaDecay()));
    for (let i = 0; i < n; i++) simulation.tick();
  }

  // ── Layout: Tree (top-down) ───────────────────────────────────────────────
  function runTreeLayout() {
    if (simulation) { simulation.stop(); simulation = null; }
    d3.tree()
      .nodeSize([settings.spacingH, settings.levelSpacing])
      .separation((a, b) => a.parent === b.parent ? 1 : 1.2)
      (root);
    // d3.tree sets x=horizontal, y=depth — correct orientation
  }

  // ── Layout: Horizontal (left-to-right) ───────────────────────────────────
  function runHorizontalLayout() {
    if (simulation) { simulation.stop(); simulation = null; }
    // nodeSize[0] = sibling spacing (becomes Y after swap)
    // nodeSize[1] = level depth spacing (becomes X after swap = horizontal spacing)
    d3.tree()
      .nodeSize([settings.spacingV, settings.spacingH])
      .separation((a, b) => a.parent === b.parent ? 1 : 1.2)
      (root);
    // Swap x ↔ y for left-to-right orientation
    // After swap: x = depth * spacingH (horizontal), y = sibling * spacingV (vertical)
    root.descendants().forEach(d => {
      const tmp = d.x;
      d.x = d.y;
      d.y = tmp;
    });
  }

  // ── Layout: Radial ────────────────────────────────────────────────────────
  function runRadialLayout() {
    if (simulation) { simulation.stop(); simulation = null; }
    const maxDepth = d3.max(root.descendants(), d => d.depth) || 1;
    d3.tree().size([2 * Math.PI, settings.levelSpacing * maxDepth])(root);
    // Convert polar (angle, radius) → cartesian (x, y) centered on canvas
    root.descendants().forEach(d => {
      const [cx, cy] = d3.pointRadial(d.x, d.y);
      d.x = cx + width  / 2;
      d.y = cy + height / 2;
    });
  }

  // ── Layout dispatcher ─────────────────────────────────────────────────────
  function positionNodes(nodes, links) {
    const view = settings.viewMode;
    const hasDeps = cachedDeps && cachedDeps.length;
    const nodeIds = new Set(nodes.map(d => String(d.data.id)));

    // DAG or Combined-DAG modes use Force Layout
    if ((view === 'dag' || view === 'combined-dag') && hasDeps) {
      const forceLinks = [];
      
      // Filter dependencies: only include if BOTH nodes are in current tree view
      cachedDeps.forEach(d => {
        const s = String(d.blocked_id);
        const t = String(d.blocker_id);
        if (nodeIds.has(s) && nodeIds.has(t)) {
          forceLinks.push({ source: s, target: t });
        }
      });

      // If combined, also include tree hierarchy links
      if (view === 'combined-dag') {
        links.forEach(l => {
          const s = String(l.source.data ? l.source.data.id : l.source);
          const t = String(l.target.data ? l.target.data.id : l.target);
          if (nodeIds.has(s) && nodeIds.has(t)) {
            forceLinks.push({ source: s, target: t });
          }
        });
      }

      runForceLayout(nodes, forceLinks);
      return;
    }

    // Default to hierarchical layouts
    switch (settings.layout) {
      case 'force':      
        runForceLayout(nodes, links.map(l => ({
          source: String(l.source.data ? l.source.data.id : l.source),
          target: String(l.target.data ? l.target.data.id : l.target)
        }))); 
        break;
      case 'horizontal': runHorizontalLayout(); break;
      case 'radial':     runRadialLayout();     break;
      default:           runTreeLayout();       break;
    }
  }

  // ── Link path (layout-aware) ──────────────────────────────────────────────
  function linkPath(s, d) {
    switch (settings.layout) {
      case 'tree': {
        // Vertical cubic bezier for top-down tree
        const midY = (s.y + d.y) / 2;
        return `M ${s.x} ${s.y} C ${s.x} ${midY}, ${d.x} ${midY}, ${d.x} ${d.y}`;
      }
      case 'horizontal': {
        // Horizontal cubic bezier for left-right tree
        const midX = (s.x + d.x) / 2;
        return `M ${s.x} ${s.y} C ${midX} ${s.y}, ${midX} ${d.y}, ${d.x} ${d.y}`;
      }
      default: {
        // Diagonal bezier for force / radial
        const mx = (s.x + d.x) / 2;
        return `M ${s.x} ${s.y} C ${mx} ${s.y}, ${mx} ${d.y}, ${d.x} ${d.y}`;
      }
    }
  }

  // ── Edge style helpers ────────────────────────────────────────────────────
  function edgeStroke() {
    const c = settings.treeEdgeColor || '#637896';
    // Parse hex to rgba with edgeOpacity
    const r = parseInt(c.slice(1,3),16), g = parseInt(c.slice(3,5),16), b = parseInt(c.slice(5,7),16);
    return `rgba(${r},${g},${b},${settings.edgeOpacity})`;
  }
  function edgeStrokeWidth()  { return `${settings.edgeWidth}px`; }

  // ── Rebuild (re-render with current layout) ───────────────────────────────
  let rebuildDebouncer = null;

  function rebuildLayout(keepView) {
    if (!root || !gLinks || !gNodes) return;
    gLinks.selectAll('.link').remove();
    gNodes.selectAll('.node').remove();
    update(root);
    // Don't auto-fit when adjusting spacing/size settings — user wants to
    // see the effect at their current zoom level, not have it cancelled out.
    if (!keepView) setTimeout(resetView, 400);
  }

  function debouncedRebuild() {
    clearTimeout(rebuildDebouncer);
    // keepView=true so spacing/size changes are visible without zoom compensation
    rebuildDebouncer = setTimeout(() => rebuildLayout(true), 130);
  }

  window.setLayout      = function (name) {
    settings.layout = name;
    saveSettings(settings);
    rebuildLayout();
    syncSettingsUI();
    // Highlight active layout button in toolbar if present
    document.querySelectorAll('#layout-btns button').forEach(b => {
      b.classList.toggle('btn-active', b.dataset.layout === name);
    });
  };
  window.rebuildLayout = rebuildLayout;

  // ── Context Menu ──────────────────────────────────────────────────────────
  let ctxNode       = null;
  let longPressTimer = null;

  function showContextMenu(event, d) {
    ctxNode = d;
    const menu = document.getElementById('ctx-menu');
    if (!menu) return;

    let x, y;
    if (event.touches && event.touches.length) {
      x = event.touches[0].clientX;
      y = event.touches[0].clientY;
    } else {
      x = event.clientX;
      y = event.clientY;
    }

    // Keep menu in viewport
    const mw = 160, mh = 110;
    menu.style.left = `${Math.min(x, window.innerWidth  - mw - 8)}px`;
    menu.style.top  = `${Math.min(y, window.innerHeight - mh - 8)}px`;
    menu.classList.add('visible');
  }

  function dismissContextMenu() {
    const menu = document.getElementById('ctx-menu');
    if (menu) menu.classList.remove('visible');
    ctxNode = null;
  }

  window.ctxOpenDetail = function () {
    if (ctxNode) showDetailPanel(ctxNode);
    dismissContextMenu();
  };

  window.ctxExpandAll = function () {
    if (!ctxNode) return;
    dismissContextMenu();
    ctxNode.descendants().forEach(d => {
      if (d._children) { d.children = d._children; d._children = null; }
    });
    update(ctxNode);
  };

  window.ctxCollapseAll = function () {
    if (!ctxNode) return;
    dismissContextMenu();
    ctxNode.descendants().forEach(d => {
      if (d.depth > ctxNode.depth && d.children) {
        d._children = d.children;
        d.children  = null;
      }
    });
    update(ctxNode);
  };

  // ── Update / render ──────────────────────────────────────────────────────
  function update(source) {
    const nodes = root.descendants();
    const allLinks = root.links();
    // Only render tree links if viewMode is NOT 'dag'
    const treeLinks = settings.viewMode === 'dag' ? [] : allLinks;
    const radii = computeNodeRadius(nodes.length);
    const dur   = settings.animations ? 350 : 0;
    const t     = d3.transition().duration(dur).ease(d3.easeCubicInOut);
    const r     = d => radii[d.data.type] || radii.task;

    // Position all nodes via selected layout
    positionNodes(nodes, allLinks);

    // Dependency edge visibility
    const showDeps = settings.viewMode !== 'tree' && depsVisible;
    if (!showDeps) gDepEdges.selectAll('*').remove();

    // ── Tree links ──  (use .style() so inline style overrides CSS rules)
    const link = gLinks.selectAll('.link').data(treeLinks, d => d.target.data.id);

    const linkEnter = link.enter().append('path')
      .attr('class', 'link')
      .attr('fill',  'none')
      .style('stroke',       edgeStroke())
      .style('stroke-width', edgeStrokeWidth())
      .attr('d', () => {
        const o = { x: source.x0 ?? source.x, y: source.y0 ?? source.y };
        return linkPath(o, o);
      });

    link.merge(linkEnter)
      .transition(t)
      .style('stroke',       edgeStroke())
      .style('stroke-width', edgeStrokeWidth())
      .attr('d', d => linkPath(d.source, d.target));

    link.exit()
      .transition(t)
      .attr('d', () => {
        const o = { x: source.x, y: source.y };
        return linkPath(o, o);
      })
      .remove();

    // ── Nodes ──
    const node = gNodes.selectAll('.node').data(nodes, d => d.data.id);

    const nodeEnter = node.enter().append('g')
      .attr('class',      d => `node status-${d.data.status}${d.data.locked ? ' locked' : ''}`)
      .attr('transform',  () => `translate(${source.x0 ?? source.x},${source.y0 ?? source.y})`)
      .attr('tabindex',   0)
      .attr('role',       'treeitem')
      .attr('aria-label', d => `#${d.data.id} ${d.data.title}`)
      .on('click', (e, d) => { e.stopPropagation(); dismissContextMenu(); toggle(d); })
      .on('dblclick', (e, d) => { e.stopPropagation(); showDetailPanel(d); })
      .on('contextmenu', (e, d) => { e.preventDefault(); e.stopPropagation(); showContextMenu(e, d); })
      .on('touchstart', (e, d) => {
        longPressTimer = setTimeout(() => { longPressTimer = null; showContextMenu(e, d); }, 500);
      })
      .on('touchend',  () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } })
      .on('touchmove', () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } })
      .on('keydown', (e, d) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showDetailPanel(d); }
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); toggle(d); }
      })
      .on('mouseenter', (e, d) => onNodeHover(e, d))
      .on('mousemove',  moveTooltip)
      .on('mouseleave', (e, d) => onNodeHoverEnd(e, d));

    // Invisible hit-target
    nodeEnter.append('rect')
      .attr('class',  'hit-target')
      .attr('fill',   'transparent')
      .attr('stroke', 'none');

    // Bottleneck ring
    nodeEnter.append('circle')
      .attr('class',        'bottleneck-ring')
      .attr('fill',         'none')
      .attr('stroke',       '#ff4444')
      .attr('stroke-width', 2)
      .attr('r', 0);

    // Main shape
    if (settings.nodeShape === 'circle') {
      nodeEnter.append('circle')
        .attr('class', 'node-shape node-circle')
        .attr('r', 0);
    } else {
      nodeEnter.append('rect')
        .attr('class', 'node-shape node-rect')
        .attr('x', 0).attr('y', 0)
        .attr('width', 0).attr('height', 0)
        .attr('rx', 0).attr('ry', 0);
    }

    // Primary label
    nodeEnter.append('text')
      .attr('class',             'label')
      .attr('text-anchor',       'middle')
      .attr('dominant-baseline', 'central')
      .attr('pointer-events',    'none');

    // Secondary label
    nodeEnter.append('text')
      .attr('class',             'secondary-label')
      .attr('text-anchor',       'middle')
      .attr('dominant-baseline', 'central')
      .attr('pointer-events',    'none')
      .style('display',          'none');

    // Progress bar
    const progG = nodeEnter.append('g').attr('class', 'progress-bar');
    progG.append('rect')
      .attr('class', 'progress-bg').attr('height', 3).attr('rx', 1.5)
      .attr('fill', 'rgba(255,255,255,0.12)');
    progG.append('rect')
      .attr('class', 'progress-fill').attr('height', 3).attr('rx', 1.5)
      .attr('fill', '#4ade80').attr('width', 0);

    // ── Merged update ──
    const nodeMerge = node.merge(nodeEnter);

    nodeMerge
      .transition(t)
      .attr('transform', d => `translate(${d.x},${d.y})`)
      .attr('class',     d => `node status-${d.data.status}${d.data.locked ? ' locked' : ''}`);

    nodeMerge.style('display', d =>
      (hideBlocked && (d.data.locked || d.data.status === 'blocked')) ? 'none' : null
    );

    // Size hit-target
    nodeMerge.select('.hit-target').each(function(d) {
      let w, h, rx;
      if (settings.nodeShape === 'circle') {
        const cr = Math.max(r(d), 22);
        w = cr * 2; h = cr * 2; rx = cr;
      } else {
        const dims = nodeRectDims(d, settings);
        w = Math.max(dims.w, 44);
        h = Math.max(dims.h, 44);
        rx = settings.nodeShape === 'pill' ? h / 2 : (settings.nodeCornerRadius || 0);
      }
      d3.select(this)
        .attr('x', -w / 2).attr('y', -h / 2)
        .attr('width', w).attr('height', h)
        .attr('rx', rx).attr('ry', rx);
    });

    // Update main shape
    if (settings.nodeShape === 'circle') {
      nodeMerge.select('circle.node-shape').transition(t).attr('r', r);
    } else {
      nodeMerge.select('rect.node-shape').each(function (d) {
        const { w, h } = nodeRectDims(d, settings);
        const rx = settings.nodeShape === 'pill'
          ? h / 2 : (settings.nodeCornerRadius || 0);
        d3.select(this).transition(t)
          .attr('x', -w / 2).attr('y', -h / 2)
          .attr('width', w).attr('height', h)
          .attr('rx', rx).attr('ry', rx);
      });
    }

    // Update bottleneck rings
    nodeMerge.select('.bottleneck-ring')
      .classed('bottleneck-pulse', d => !!d.data.is_bottleneck)
      .transition(t)
      .attr('r', d => {
        if (!d.data.is_bottleneck || d.data.status === 'done') return 0;
        if (settings.nodeShape === 'circle') return r(d) + 4;
        const { w, h } = nodeRectDims(d, settings);
        return Math.sqrt(w * w + h * h) / 2 + 4;
      });

    // Progress bar positioning
    nodeMerge.select('.progress-bar')
      .attr('transform', d => {
        const hw  = nodeHalfWidth(d, radii, settings);
        const bot = nodeBottom(d, radii, settings);
        return `translate(${-hw}, ${bot + 5})`;
      })
      .attr('display', d => (d.data.status === 'in_progress' && d.data.progress > 0) ? null : 'none');
    nodeMerge.select('.progress-bar rect.progress-bg')
      .attr('width', d => nodeHalfWidth(d, radii, settings) * 2);
    nodeMerge.select('.progress-bar rect.progress-fill')
      .transition(t)
      .attr('width', d => nodeHalfWidth(d, radii, settings) * 2 * ((d.data.progress || 0) / 100));

    // Sync dependency arrows
    if (showDeps && cachedDeps) {
       t.on('end.deps', () => { drawDepEdges(cachedDeps); });
       setTimeout(() => drawDepEdges(cachedDeps), dur + 50);
    }

    node.exit()
      .transition(t)
      .attr('transform', `translate(${source.x},${source.y})`)
      .style('opacity',   0)
      .remove();

    root.descendants().forEach(d => { d.x0 = d.x; d.y0 = d.y; });
    updateLabels();
  }

  // ── Labels ─────────
  function updateLabels() {
    if (!gNodes) return;
    const zoom      = currentZoom;
    const fontSize  = settings.scaleTextToFit ? (11 * settings.fontSize) : (11 * settings.fontSize / zoom);
    const fsStr     = fontSize + 'px';
    const threshold = settings.labelThreshold;
    const hasSec    = settings.secondaryField && settings.secondaryField !== 'none';

    gNodes.selectAll('text.label').each(function (d) {
      const el   = d3.select(this);
      const kids = (d.children || []).length + (d._children || []).length;
      const isImportant = d.data.type === 'goal' || d.data.type === 'milestone' || kids >= 3;

      if (zoom < threshold && !isImportant) { el.style('display', 'none'); return; }
      el.style('display', null);
      el.attr('font-size', fsStr);

      const lockPrefix = d.data.locked ? '🔒 ' : '';
      const raw   = `${lockPrefix}#${d.data.id} ${d.data.title || ''}`;
      const label = smartTruncate(raw, settings);

      // If secondary visible, shift primary upward so both lines centre together
      const secText  = hasSec ? getSecondaryText(d, settings) : '';
      const hasSecNow = hasSec && !!secText;
      const yPrimary  = hasSecNow ? -(fontSize * 0.65) : 0;

      el.selectAll('tspan').remove();
      el.append('tspan')
        .attr('x',   0)
        .attr('dy',  yPrimary)
        .attr('fill', settings.nodeTextColor)
        .text(label);
    });

    // ── Secondary labels ──
    gNodes.selectAll('text.secondary-label').each(function (d) {
      const el   = d3.select(this);
      if (!hasSec) { el.style('display', 'none'); return; }
      const kids = (d.children || []).length + (d._children || []).length;
      const isImportant = d.data.type === 'goal' || d.data.type === 'milestone' || kids >= 3;
      if (!settings.scaleTextToFit && zoom < threshold && !isImportant) { el.style('display', 'none'); return; }
      const text = getSecondaryText(d, settings);
      if (!text) { el.style('display', 'none'); return; }
      el.style('display', null);
      const secFs = settings.scaleTextToFit ? (11 * settings.fontSize * 0.8) + 'px' : (11 * settings.fontSize * 0.8 / zoom) + 'px';
      el.attr('font-size', secFs)
        .attr('fill', 'var(--text-muted, #7d8590)');
      el.selectAll('tspan').remove();
      el.append('tspan')
        .attr('x',  0)
        .attr('dy', fontSize * 0.65)
        .text(text);
    });
  }

  // ── Live edge style update (no full rebuild) ──────────────────────────────
  function updateEdgeStyles() {
    if (gLinks) {
      // Use .style() so inline styles override CSS presentation rules
      gLinks.selectAll('.link')
        .style('stroke',       edgeStroke())
        .style('stroke-width', edgeStrokeWidth());
    }
    if (gDepEdges) {
      gDepEdges.selectAll('path')
        .style('stroke-width', settings.edgeWidth + 'px');
    }
  }

  // ── Update corner radius live (no full rebuild needed) ────────────────────
  function updateNodeCornerRadius() {
    if (!gNodes || settings.nodeShape !== 'rect') return;
    gNodes.selectAll('rect.node-shape')
      .attr('rx', settings.nodeCornerRadius)
      .attr('ry', settings.nodeCornerRadius);
  }

  // ── Toggle collapse/expand ───────────────────────────────────────────────
  function toggle(d) {
    if (d.children) {
      d._children = d.children;
      d.children  = null;
    } else if (d._children) {
      d.children  = d._children;
      d._children = null;
    }
    update(d);
  }

  // ── Global controls ──────────────────────────────────────────────────────
  function expandAll() {
    root.descendants().forEach(d => {
      if (d._children) { d.children = d._children; d._children = null; }
    });
    update(root);
    setTimeout(resetView, 400);
  }

  function collapseAll() {
    root.descendants().forEach(d => {
      if (d.depth > 0 && d.children) { d._children = d.children; d.children = null; }
    });
    update(root);
    setTimeout(resetView, 400);
  }

  function resetView() {
    const padding = 60;
    const nodes   = root.descendants();
    const xs      = nodes.map(d => d.x);
    const ys      = nodes.map(d => d.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const treeW = maxX - minX || 1;
    const treeH = maxY - minY || 1;
    const scale = Math.min(
      (width  - padding * 2) / treeW,
      (height - padding * 2) / treeH,
      1
    );
    const tx = padding - minX * scale + (width  - padding * 2 - treeW * scale) / 2;
    const ty = padding - minY * scale + (height - padding * 2 - treeH * scale) / 2;

    currentZoom = scale;
    svg.transition().duration(500).ease(d3.easeCubicInOut)
      .call(zoomBehavior.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));

    setTimeout(updateLabels, 520);
  }

  function toggleLegend() {
    document.getElementById('legend').classList.toggle('legend-expanded');
  }

  // ── Hover: dim unrelated nodes/links ─────────────────────────────────────
  function getConnectedNodeIds(d) {
    const ids = new Set([d.data.id]);
    if (d.parent) ids.add(d.parent.data.id);
    [...(d.children || []), ...(d._children || [])].forEach(c => ids.add(c.data.id));
    if (cachedDeps) {
      cachedDeps.forEach(dep => {
        if (dep.blocker_id === d.data.id) ids.add(dep.blocked_id);
        if (dep.blocked_id === d.data.id) ids.add(dep.blocker_id);
      });
    }
    return ids;
  }

  function onNodeHover(event, d) {
    showTooltip(event, d);

    const connected = getConnectedNodeIds(d);
    const glowColor = d.data.locked ? BORDER_COLORS.locked : (BORDER_COLORS[d.data.status] || '#3b82f6');

    d3.select(event.currentTarget).select('.node-shape')
      .attr('filter', `drop-shadow(0 0 10px ${glowColor})`);

    gNodes.selectAll('.node').each(function (nd) {
      d3.select(this).style('opacity', connected.has(nd.data.id) ? 1.0 : 0.2);
    });

    gLinks.selectAll('.link').each(function (ld) {
      const inv = connected.has(ld.source.data.id) || connected.has(ld.target.data.id);
      d3.select(this).style('opacity', inv ? 1.0 : EDGE_DIM_OPACITY);
    });

    if (depsVisible) {
      gDepEdges.selectAll('.dep-link').each(function () {
        const src    = +d3.select(this).attr('data-src');
        const tgt    = +d3.select(this).attr('data-tgt');
        const isConn = connected.has(src) || connected.has(tgt);
        d3.select(this).style('opacity', isConn ? 1.0 : EDGE_DIM_OPACITY);
      });
    }
  }

  function onNodeHoverEnd(event, d) {
    hideTooltip();
    d3.select(event.currentTarget).select('.node-shape').attr('filter', null);
    gNodes.selectAll('.node').style('opacity', null);
    gLinks.selectAll('.link').style('opacity', null);
    if (depsVisible) {
      gDepEdges.selectAll('.dep-link').style('opacity', null);
    }
  }

  // ── Detail Panel ─────────────────────────────────────────────────────────
  function showDetailPanel(d) {
    const nd      = d.data;
    const panel   = document.getElementById('detail-panel');
    const titleEl = document.getElementById('detail-panel-title');
    const body    = document.getElementById('detail-panel-body');

    titleEl.innerHTML =
      `<span style="color:var(--text-accent);font-weight:800;font-size:16px">#${nd.id}</span>` +
      ` <span style="color:var(--text-muted);font-weight:400">—</span> ` +
      `${escHtml(nd.title)}`;

    const roi        = nd.roi != null ? parseFloat(nd.roi).toFixed(2) : '—';
    const fmt2       = v => v != null ? '€' + Number(v).toLocaleString() : '—';
    const fmtDate    = ts => ts ? new Date(ts * 1000).toLocaleDateString() : '—';
    const badgeClass = `badge-${nd.status}`;
    const statusLabel = nd.status.replace(/_/g, ' ');

    const desc       = nd.description || '';
    const PREVIEW_LEN = 150;
    const hasMore    = desc.length > PREVIEW_LEN;
    const preview    = hasMore ? desc.slice(0, PREVIEW_LEN).trimEnd() + '…' : desc;
    const descHTML   = desc
      ? `<div class="dp-description-box dp-desc-collapsed" id="dp-desc-box">
           <span class="dp-desc-preview">${escHtml(preview)}</span>
           <span class="dp-desc-full">${escHtml(desc)}</span>
           ${hasMore ? `<button class="dp-desc-toggle" onclick="toggleDesc()">▼ Show more</button>` : ''}
         </div>`
      : `<div class="dp-description-box" style="color:rgba(255,255,255,0.3);font-style:italic">No description</div>`;

    const pct = nd.progress || 0;
    const progressHTML = `
      <div class="dp-progress-bar-bg">
        <div class="dp-progress-bar-fill" style="width:${pct}%"></div>
      </div>
      <div style="font-size:10px;color:var(--text-muted);margin-top:4px">${pct}% complete</div>`;

    const notes     = (nd.notes || []).slice(-5);
    const notesHTML = notes.length
      ? notes.map(n => {
          const ts     = new Date(n.ts * 1000).toLocaleString();
          const pctStr = n.progress != null ? `<span class="dp-note-pct"> [${n.progress}%]</span>` : '';
          return `<div class="dp-note"><span class="dp-note-ts">${ts}</span>${pctStr}<br>${escHtml(n.text)}</div>`;
        }).join('')
      : `<div style="font-size:10px;color:rgba(255,255,255,0.3)">No step notes yet</div>`;

    const depsInfo = nd.depends_on && nd.depends_on.length
      ? `<div class="dp-row"><span class="dp-label">Depends on</span><span class="dp-value">${nd.depends_on.map(id => `#${id}`).join(', ')}</span></div>`
      : '';

    body.innerHTML = `
      <div class="dp-section">
        <div class="dp-section-title">Identity</div>
        <div class="dp-row">
          <span class="dp-label">ID</span>
          <span class="dp-value" style="color:var(--text-accent);font-weight:700">#${nd.id}</span>
        </div>
        <div class="dp-row"><span class="dp-label">Type</span><span class="dp-value">${nd.type}</span></div>
        <div class="dp-row"><span class="dp-label">Owner</span><span class="dp-value">${nd.owner || '—'}</span></div>
      </div>

      <div class="dp-section">
        <div class="dp-section-title">Status</div>
        <span class="dp-badge ${badgeClass}">${statusLabel}</span>
        ${depsInfo ? `<div style="margin-top:8px">${depsInfo}</div>` : ''}
      </div>

      <div class="dp-section">
        <div class="dp-section-title">Value Model</div>
        <div class="dp-row"><span class="dp-label">Value</span><span class="dp-value">${fmt2(nd.value)}</span></div>
        <div class="dp-row"><span class="dp-label">Cost est.</span><span class="dp-value">${fmt2(nd.cost_estimate)}</span></div>
        <div class="dp-row"><span class="dp-label">ROI</span><span class="dp-value">${roi}</span></div>
        <div class="dp-row"><span class="dp-label">Effort</span><span class="dp-value">${nd.effort_hours_estimate != null ? nd.effort_hours_estimate + 'h' : '—'}</span></div>
      </div>

      <div class="dp-section">
        <div class="dp-section-title">Timeline</div>
        <div class="dp-row"><span class="dp-label">Planned start</span><span class="dp-value">${fmtDate(nd.start_date)}</span></div>
        <div class="dp-row"><span class="dp-label">Planned end</span><span class="dp-value">${fmtDate(nd.end_date)}</span></div>
      </div>

      <div class="dp-section">
        <div class="dp-section-title">Progress</div>
        ${progressHTML}
      </div>

      <div class="dp-section">
        <div class="dp-section-title">Description</div>
        ${descHTML}
      </div>

      <div class="dp-section">
        <div class="dp-section-title">Step Notes</div>
        ${notesHTML}
      </div>
    `;

    panel.classList.add('open');
  }

  function closeDetailPanel() {
    document.getElementById('detail-panel').classList.remove('open');
  }

  function toggleDesc() {
    const box = document.getElementById('dp-desc-box');
    const btn = box && box.querySelector('.dp-desc-toggle');
    if (!box) return;
    const isCollapsed = box.classList.contains('dp-desc-collapsed');
    box.classList.toggle('dp-desc-collapsed', !isCollapsed);
    box.classList.toggle('dp-desc-expanded',   isCollapsed);
    if (btn) btn.textContent = isCollapsed ? '▲ Show less' : '▼ Show more';
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/\n/g, '<br>');
  }

  document.getElementById('container').addEventListener('click', () => {
    closeDetailPanel();
    dismissContextMenu();
  });
  window.closeDetailPanel = closeDetailPanel;
  window.toggleDesc       = toggleDesc;

  // ── Settings Panel ────────────────────────────────────────────────────────
  function toggleSettingsPanel() {
    const panel = document.getElementById('settings-panel');
    if (!panel) return;
    const isOpen = panel.classList.toggle('open');
    const btn    = document.getElementById('settings-btn');
    if (btn) btn.classList.toggle('btn-active', isOpen);
  }

  function closeSettingsPanel() {
    const panel = document.getElementById('settings-panel');
    if (panel) panel.classList.remove('open');
    const btn = document.getElementById('settings-btn');
    if (btn) btn.classList.remove('btn-active');
  }

  window.toggleSettingsPanel = toggleSettingsPanel;
  window.closeSettingsPanel  = closeSettingsPanel;

  // Format a setting value for display
  function fmtSettingVal(key, val) {
    if (key === 'labelThreshold' || key === 'edgeOpacity') return val.toFixed(2);
    if (Number.isInteger(val)) return String(val);
    return val.toFixed(1);
  }

  function syncSettingsUI() {
    const get    = id => document.getElementById(id);
    const setV   = (id, v) => { const el = get(id); if (el) el.value = v; };
    const setChk = (id, v) => { const el = get(id); if (el) el.checked = v; };
    const setTxt = (id, v) => { const el = get(id); if (el) el.textContent = v; };

    setV('s-layout',            settings.layout);
    setV('s-viewMode',          settings.viewMode);
    setV('s-fontSize',          settings.fontSize);
    setV('s-labelThreshold',    settings.labelThreshold);
    setV('s-nodeScale',         settings.nodeScale);
    setV('s-spacingH',          settings.spacingH);
    setV('s-spacingV',          settings.spacingV);
    setV('s-levelSpacing',      settings.levelSpacing);
    setV('s-edgeWidth',         settings.edgeWidth);
    setV('s-edgeOpacity',       settings.edgeOpacity);
    setChk('s-animations',      settings.animations);
    setChk('s-scaleTextToFit',  settings.scaleTextToFit);
    setV('s-nodeShape',         settings.nodeShape);
    setV('s-nodeCornerRadius',  settings.nodeCornerRadius);
    setV('s-truncMinChars',     settings.truncMinChars);
    setV('s-truncMaxChars',     settings.truncMaxChars);
    setV('s-truncWhitespaceMax', settings.truncWhitespaceMax);
    setV('s-secondaryField',    settings.secondaryField);
    const colorEl = document.getElementById('s-nodeTextColor');
    if (colorEl) colorEl.value = settings.nodeTextColor || '#c9d1d9';

    // Edge colors
    setV('s-treeEdgeColor', settings.treeEdgeColor || '#637896');
    setV('s-depEdgeColor',  settings.depEdgeColor  || '#f97316');

    // Status colors
    const statusColorMap = {
      's-colorOpen':        'colorOpen',
      's-colorInProgress':  'colorInProgress',
      's-colorDone':        'colorDone',
      's-colorBlocked':     'colorBlocked',
      's-colorShelved':     'colorShelved',
      's-colorRejected':    'colorRejected',
      's-colorRefused':     'colorRefused',
      's-colorInQuestion':  'colorInQuestion',
      's-colorOutOfBudget': 'colorOutOfBudget',
    };
    for (const [elId, key] of Object.entries(statusColorMap)) {
      const el = document.getElementById(elId);
      if (el) el.value = settings[key] || DEFAULT_SETTINGS[key];
    }

    setTxt('sv-fontSize',          fmtSettingVal('fontSize',          settings.fontSize));
    setTxt('sv-labelThreshold',    fmtSettingVal('labelThreshold',    settings.labelThreshold));
    setTxt('sv-nodeScale',         fmtSettingVal('nodeScale',         settings.nodeScale));
    setTxt('sv-spacingH',          fmtSettingVal('spacingH',          settings.spacingH));
    setTxt('sv-spacingV',          fmtSettingVal('spacingV',          settings.spacingV));
    setTxt('sv-levelSpacing',      fmtSettingVal('levelSpacing',      settings.levelSpacing));
    setTxt('sv-edgeWidth',         fmtSettingVal('edgeWidth',         settings.edgeWidth));
    setTxt('sv-edgeOpacity',       fmtSettingVal('edgeOpacity',       settings.edgeOpacity));
    setTxt('sv-nodeCornerRadius',  fmtSettingVal('nodeCornerRadius',  settings.nodeCornerRadius));
    setTxt('sv-truncMinChars',     fmtSettingVal('truncMinChars',     settings.truncMinChars));
    setTxt('sv-truncMaxChars',     fmtSettingVal('truncMaxChars',     settings.truncMaxChars));
    setTxt('sv-truncWhitespaceMax', fmtSettingVal('truncWhitespaceMax', settings.truncWhitespaceMax));

    // Show corner-radius row only when shape = rect
    const crRow = document.getElementById('sp-cornerRadius-row');
    if (crRow) crRow.style.display = settings.nodeShape === 'rect' ? '' : 'none';

    const modeEl = document.getElementById('s-viewMode');
    if (modeEl) modeEl.value = settings.viewMode || 'combined-tree';

    applyStatusColors();
  }

  // Apply status colors from settings to CSS variables on :root
  function applyStatusColors() {
    const root = document.documentElement;
    const map = {
      open:          settings.colorOpen          || DEFAULT_SETTINGS.colorOpen,
      in_progress:   settings.colorInProgress    || DEFAULT_SETTINGS.colorInProgress,
      done:          settings.colorDone          || DEFAULT_SETTINGS.colorDone,
      blocked:       settings.colorBlocked       || DEFAULT_SETTINGS.colorBlocked,
      shelved:       settings.colorShelved       || DEFAULT_SETTINGS.colorShelved,
      rejected:      settings.colorRejected      || DEFAULT_SETTINGS.colorRejected,
      refused:       settings.colorRefused       || DEFAULT_SETTINGS.colorRefused,
      in_question:   settings.colorInQuestion    || DEFAULT_SETTINGS.colorInQuestion,
      out_of_budget: settings.colorOutOfBudget   || DEFAULT_SETTINGS.colorOutOfBudget,
    };
    for (const [status, color] of Object.entries(map)) {
      root.style.setProperty(`--border-${status}`, color);
      // Compute a subtle fill from the border color at 15% opacity
      const r = parseInt(color.slice(1,3),16), g = parseInt(color.slice(3,5),16), b = parseInt(color.slice(5,7),16);
      root.style.setProperty(`--node-${status}`, `rgba(${r},${g},${b},0.15)`);
    }
    // Update the dep edge CSS variable too
    root.style.setProperty('--edge-dep', settings.depEdgeColor || DEFAULT_SETTINGS.depEdgeColor);
  }

  function initSettingsPanel() {
    syncSettingsUI();

    // Generic slider binder
    function bind(id, key, parse, onUpdate) {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => {
        settings[key] = parse(el.value);
        saveSettings(settings);
        const valEl = document.getElementById('sv-' + id.slice(2));
        if (valEl) valEl.textContent = fmtSettingVal(key, settings[key]);
        if (typeof onUpdate === 'function') onUpdate();
      });
    }

    bind('s-fontSize',           'fontSize',          parseFloat, updateLabels);
    bind('s-labelThreshold',     'labelThreshold',    parseFloat, updateLabels);
    bind('s-nodeScale',          'nodeScale',          parseFloat, debouncedRebuild);
    bind('s-spacingH',           'spacingH',           parseInt,   debouncedRebuild);
    bind('s-spacingV',           'spacingV',           parseInt,   debouncedRebuild);
    bind('s-levelSpacing',       'levelSpacing',       parseInt,   debouncedRebuild);
    bind('s-edgeWidth',          'edgeWidth',          parseFloat, updateEdgeStyles);
    bind('s-edgeOpacity',        'edgeOpacity',        parseFloat, updateEdgeStyles);
    bind('s-nodeCornerRadius',   'nodeCornerRadius',   parseInt,   updateNodeCornerRadius);
    bind('s-truncMinChars',      'truncMinChars',      parseInt,   updateLabels);
    bind('s-truncMaxChars',      'truncMaxChars',      parseInt,   updateLabels);
    bind('s-truncWhitespaceMax', 'truncWhitespaceMax', parseInt,   updateLabels);

    // Animations toggle
    const animEl = document.getElementById('s-animations');
    if (animEl) {
      animEl.addEventListener('change', () => {
        settings.animations = animEl.checked;
        saveSettings(settings);
      });
    }

    // Layout select
    const layoutEl = document.getElementById('s-layout');
    if (layoutEl) {
      layoutEl.addEventListener('change', () => { window.setLayout(layoutEl.value); });
    }

    // View mode select
    const modeEl = document.getElementById('s-viewMode');
    if (modeEl) {
      modeEl.addEventListener('change', () => {
        settings.viewMode = modeEl.value;
        saveSettings(settings);
        rebuildLayout();
      });
    }

    // Scale text toggle
    const scaleTextEl = document.getElementById('s-scaleTextToFit');
    if (scaleTextEl) {
      scaleTextEl.addEventListener('change', () => {
        settings.scaleTextToFit = scaleTextEl.checked;
        saveSettings(settings);
        updateLabels();
      });
    }

    // Node shape select
    const shapeEl = document.getElementById('s-nodeShape');
    if (shapeEl) {
      shapeEl.addEventListener('change', () => {
        settings.nodeShape = shapeEl.value;
        saveSettings(settings);
        syncSettingsUI();
        rebuildLayout();
      });
    }

    // Secondary field select
    const secEl = document.getElementById('s-secondaryField');
    if (secEl) {
      secEl.addEventListener('change', () => {
        settings.secondaryField = secEl.value;
        saveSettings(settings);
        rebuildLayout();
      });
    }

    // Node text color picker
    const nodeTextColorEl = document.getElementById('s-nodeTextColor');
    if (nodeTextColorEl) {
      nodeTextColorEl.addEventListener('input', () => {
        settings.nodeTextColor = nodeTextColorEl.value;
        saveSettings(settings);
        updateLabels();
      });
    }

    // Tree edge color picker
    const treeColorEl = document.getElementById('s-treeEdgeColor');
    if (treeColorEl) {
      treeColorEl.addEventListener('input', () => {
        settings.treeEdgeColor = treeColorEl.value;
        saveSettings(settings);
        updateEdgeStyles();
      });
    }

    // Dep edge color picker
    const depColorEl = document.getElementById('s-depEdgeColor');
    if (depColorEl) {
      depColorEl.addEventListener('input', () => {
        settings.depEdgeColor = depColorEl.value;
        saveSettings(settings);
        applyStatusColors();
        if (depsVisible && cachedDeps) drawDepEdges(cachedDeps);
      });
    }

    // Status color pickers
    const statusColorInputs = {
      's-colorOpen':        'colorOpen',
      's-colorInProgress':  'colorInProgress',
      's-colorDone':        'colorDone',
      's-colorBlocked':     'colorBlocked',
      's-colorShelved':     'colorShelved',
      's-colorRejected':    'colorRejected',
      's-colorRefused':     'colorRefused',
      's-colorInQuestion':  'colorInQuestion',
      's-colorOutOfBudget': 'colorOutOfBudget',
    };
    for (const [elId, key] of Object.entries(statusColorInputs)) {
      const el = document.getElementById(elId);
      if (el) {
        el.addEventListener('input', () => {
          settings[key] = el.value;
          saveSettings(settings);
          applyStatusColors();
        });
      }
    }

    // Export
    window.exportSettings = function () {
      const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = 'telos-settings.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    // Import
    window.importSettings = function () {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.json,application/json';
      input.onchange = e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
          try {
            const parsed = JSON.parse(ev.target.result);
            settings = { ...DEFAULT_SETTINGS, ...parsed };
            saveSettings(settings);
            syncSettingsUI();
            rebuildLayout();
          } catch { alert('Invalid settings JSON — check file format'); }
        };
        reader.readAsText(file);
      };
      input.click();
    };

    // Reset
    window.resetSettings = function () {
      settings = { ...DEFAULT_SETTINGS };
      saveSettings(settings);
      syncSettingsUI();
      rebuildLayout();
    };
  }

  // ── Tooltip ──────────────────────────────────────────────────────────────
  function fmtVal(n) {
    if (n == null) return '—';
    if (n >= 1_000_000) return `€${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)     return `€${(n / 1_000).toFixed(0)}K`;
    return `€${n}`;
  }

  function showTooltip(event, d) {
    const nd     = d.data;
    const status = nd.status.replace(/_/g, ' ');
    tooltip.innerHTML = `
      <div class="title">
        <span style="color:var(--text-accent);font-weight:800">#${nd.id}</span>
        <span style="color:var(--text-muted)"> — </span>${escHtml(nd.title)}
      </div>
      <div class="row">
        <span class="label">Status</span><span class="value">${status}</span>
        <span style="color:var(--text-muted);margin-left:8px">|</span>
        <span class="label" style="margin-left:8px">Type</span><span class="value">${nd.type}</span>
        <span style="color:var(--text-muted);margin-left:8px">|</span>
        <span class="label" style="margin-left:8px">Owner</span><span class="value">${nd.owner || '—'}</span>
      </div>
      ${nd.locked ? `
      <div class="row" style="color:#9ca3af">
        <span class="label">🔒 Locked</span><span class="value">Waiting for: ${escHtml(nd.locked_by ? nd.locked_by.title : 'milestone')}</span>
      </div>` : ''}
      ${nd.value != null || nd.cost_estimate != null ? `
      <div class="row">
        <span class="label">Value</span><span class="value">${fmtVal(nd.value)}</span>
        &nbsp;&nbsp;
        <span class="label">Cost</span><span class="value">${fmtVal(nd.cost_estimate)}</span>
      </div>` : ''}
      ${nd.progress > 0 ? `<div class="row"><span class="label">Progress</span><span class="value">${nd.progress}%</span></div>` : ''}
    `;
    tooltip.classList.add('visible');
    moveTooltip(event);
  }

  function moveTooltip(event) {
    const margin = 14;
    const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
    let left = event.clientX + margin;
    let top  = event.clientY + margin;
    if (left + tw > window.innerWidth)  left = event.clientX - tw - margin;
    if (top  + th > window.innerHeight) top  = event.clientY - th - margin;
    tooltip.style.left = `${left}px`;
    tooltip.style.top  = `${top}px`;
  }

  function hideTooltip() { tooltip.classList.remove('visible'); }

  // ── Tab switching ────────────────────────────────────────────────────────
  window.switchTab = function switchTab(tab) {
    const container    = document.getElementById('container');
    const listView     = document.getElementById('list-view');
    const ideasPanel   = document.getElementById('ideas-panel');
    const treeBtn      = document.getElementById('tab-tree');
    const ideasBtn     = document.getElementById('tab-ideas');
    const controls     = document.getElementById('controls');
    const legend       = document.getElementById('legend');
    const legendToggle = document.getElementById('legend-toggle');
    const filterWrap   = document.getElementById('done-filter-wrap');

    container.style.display = 'none';
    if (listView) listView.classList.remove('active');
    ideasPanel.classList.remove('visible');
    [treeBtn, ideasBtn].forEach(b => {
      if (b) { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); }
    });
    if (controls)     controls.style.display    = 'none';
    if (legend)       legend.style.display       = 'none';
    if (legendToggle) legendToggle.style.display = 'none';
    if (filterWrap)   filterWrap.style.display   = 'none';

    ['tree', 'list', 'ideas'].forEach(t => {
      const b = document.getElementById(`bnav-${t}`);
      if (b) b.classList.toggle('active', t === tab);
    });

    if (tab === 'tree') {
      container.style.display = '';
      if (treeBtn) { treeBtn.classList.add('active'); treeBtn.setAttribute('aria-selected', 'true'); }
      if (controls)     controls.style.display    = '';
      if (legend)       legend.style.display       = '';
      if (legendToggle) legendToggle.style.display = '';
      if (filterWrap)   filterWrap.style.display   = '';
    } else if (tab === 'list') {
      if (listView) { listView.classList.add('active'); renderListView(); }
    } else {
      ideasPanel.classList.add('visible');
      if (ideasBtn) { ideasBtn.classList.add('active'); ideasBtn.setAttribute('aria-selected', 'true'); }
      loadIdeas();
    }
  };

  function renderListView() {
    const el = document.getElementById('list-view');
    if (!el) return;

    const allNodes = [];
    function flatten(nodes) {
      nodes.forEach(n => {
        allNodes.push(n);
        if (n.children  && n.children.length)  flatten(n.children);
        if (n._children && n._children.length) flatten(n._children);
      });
    }

    if (window._telosRoot) {
      flatten(window._telosRoot.descendants().map(d => d.data));
    } else {
      el.innerHTML = '<p style="color:var(--text-muted);padding:16px;font-size:12px">Load the tree first.</p>';
      return;
    }

    const STATUS_ORDER = {
      in_progress: 0, blocked: 1, in_question: 2, open: 3,
      done: 4, shelved: 5, refused: 6, rejected: 7, out_of_budget: 8
    };
    const statusGroups = {};
    allNodes
      .filter(n => !hideBlocked || (n.status !== 'blocked' && !n.locked))
      .filter(n => n.type === 'task' || n.type === 'milestone')
      .sort((a, b) => {
        const so = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
        if (so !== 0) return so;
        return (parseFloat(b.roi) || 0) - (parseFloat(a.roi) || 0);
      })
      .forEach(n => {
        const g = n.status;
        if (!statusGroups[g]) statusGroups[g] = [];
        statusGroups[g].push(n);
      });

    const groupOrder  = ['in_progress', 'blocked', 'in_question', 'open', 'done', 'shelved', 'rejected', 'refused', 'out_of_budget'];
    const groupLabels = {
      in_progress:   '🔵 In Progress',
      blocked:       '🔴 Blocked',
      in_question:   '🟠 In Question',
      open:          '🟡 Open',
      done:          '✅ Done',
      shelved:       '⬜ Shelved',
      rejected:      '🚫 Rejected',
      refused:       '⚫ Refused',
      out_of_budget: '💸 Out of Budget',
    };

    let html = '';
    for (const g of groupOrder) {
      const gnodes = statusGroups[g];
      if (!gnodes || !gnodes.length) continue;
      html += `<div class="lv-group"><div class="lv-group-title">${groupLabels[g] || g} (${gnodes.length})</div>`;
      for (const n of gnodes) {
        const roi  = n.roi != null ? `ROI ${parseFloat(n.roi).toFixed(0)}` : '';
        const owner = n.owner ? `· ${n.owner}` : '';
        const pct  = n.progress || 0;
        const progressBar = pct > 0
          ? `<div class="lv-card-progress"><div class="lv-card-progress-fill" style="width:${pct}%"></div></div>` : '';
        const badgeClass = `badge-${n.status}`;
        const lockedBadge = n.locked
          ? `<span class="dp-badge" style="background:rgba(107,114,128,0.18);color:#9ca3af">🔒 locked</span>`
          : '';
        html += `<div class="lv-card${n.locked ? ' lv-card-locked' : ''}" onclick="openNodeDetail(${n.id})" role="listitem" style="${n.locked ? 'opacity:0.7' : ''}">
          <div class="lv-card-top">
            <div class="lv-card-title">
              <span style="color:var(--text-accent);font-weight:700">#${n.id}</span> ${escHtml(n.title)}
            </div>
            <div style="display:flex;gap:4px;align-items:center">${lockedBadge}<span class="dp-badge ${badgeClass}">${n.type}</span></div>
          </div>
          <div class="lv-card-meta">
            ${roi ? `<span class="lv-card-roi">${roi}</span>` : ''}
            <span>${owner}</span>
            ${pct > 0 ? `<span>${pct}%</span>` : ''}
            ${n.locked && n.locked_by ? `<span style="color:#6b7280">⬡ ${escHtml(n.locked_by.title)}</span>` : ''}
          </div>
          ${progressBar}
        </div>`;
      }
      html += '</div>';
    }
    el.innerHTML = html || '<p style="color:var(--text-muted);padding:16px;font-size:12px">No tasks found.</p>';
  }

  window.openNodeDetail = function (id) {
    if (!window._telosRoot) return;
    const desc = window._telosRoot.descendants().find(d => d.data.id === id);
    if (desc) showDetailPanel(desc);
  };

  // ── Rect boundary intersection for dep arrow edge-to-edge placement ──────
  function rectEdgePoint(cx, cy, w, h, tx, ty) {
    const dx = tx - cx, dy = ty - cy;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };
    const sx = dx !== 0 ? (w / 2) / Math.abs(dx) : Infinity;
    const sy = dy !== 0 ? (h / 2) / Math.abs(dy) : Infinity;
    const s  = Math.min(sx, sy);
    return { x: cx + dx * s, y: cy + dy * s };
  }

  // ── Dependency edges ─────────────────────────────────────────────────────
  function drawDepEdges(deps) {
    cachedDeps = deps;
    if (!gDepEdges) return;
    gDepEdges.selectAll('*').remove();
    if (!deps || !deps.length || !root) return;

    const nodeMap  = new Map(root.descendants().map(d => [d.data.id, d]));
    const allNodes = root.descendants();
    const radii    = computeNodeRadius(allNodes.length);

    // Group deps by TARGET (blocker_id) — spread arrival points along target node edge
    const tgtGroups = new Map();
    deps.forEach(dep => {
      if (!nodeMap.get(dep.blocker_id) || !nodeMap.get(dep.blocked_id)) return;
      if (!tgtGroups.has(dep.blocker_id)) tgtGroups.set(dep.blocker_id, []);
      tgtGroups.get(dep.blocker_id).push(dep);
    });
    tgtGroups.forEach(group => {
      group.sort((a, b) => {
        const na = nodeMap.get(a.blocked_id), nb = nodeMap.get(b.blocked_id);
        const ta = nodeMap.get(a.blocker_id);
        return Math.atan2(na.y - ta.y, na.x - ta.x) - Math.atan2(nb.y - ta.y, nb.x - ta.x);
      });
    });

    const arrowLength = 10;
    const arrowHalfW  = 4;
    const depColor    = settings.depEdgeColor || '#f97316';

    deps.forEach(dep => {
      const blocker = nodeMap.get(dep.blocker_id);
      const blocked = nodeMap.get(dep.blocked_id);
      if (!blocker || !blocked) return;

      const sx = blocked.x, sy = blocked.y;
      const dx = blocker.x, dy = blocker.y;

      const groupIdx = tgtGroups.get(dep.blocker_id).indexOf(dep);
      const groupCount = tgtGroups.get(dep.blocker_id).length;

      let ssx, ssy, ddx, ddy;

      if (settings.nodeShape === 'circle') {
        const tgtR = (radii[blocker.data.type] || radii.task) + 2;
        const srcR = (radii[blocked.data.type] || radii.task) + 2;
        const baseAngle  = Math.atan2(sy - dy, sx - dx);
        const spreadStep = groupCount > 1 ? Math.min(0.35, (groupCount * 0.15)) : 0;
        const entryAngle = baseAngle + (groupIdx - (groupCount - 1) / 2) * spreadStep;
        ddx = dx + Math.cos(entryAngle) * tgtR;
        ddy = dy + Math.sin(entryAngle) * tgtR;
        const s2dLen = Math.sqrt((ddx - sx) ** 2 + (ddy - sy) ** 2) || 1;
        ssx = sx + ((ddx - sx) / s2dLen) * srcR;
        ssy = sy + ((ddy - sy) / s2dLen) * srcR;
      } else {
        const tgtDims = nodeRectDims(blocker, settings);
        const tw = tgtDims.w / 2, th = tgtDims.h / 2;
        const ax = dx - sx, ay = dy - sy;

        if (Math.abs(ax) >= Math.abs(ay)) {
          const faceX   = dx + (ax > 0 ? -tw : tw);
          const maxSpan = (th * 2 - 8) * 0.85;
          const step    = groupCount > 1 ? maxSpan / (groupCount - 1) : 0;
          ddx = faceX;
          ddy = Math.max(dy - th + 4, Math.min(dy + th - 4,
                  dy + (groupIdx - (groupCount - 1) / 2) * step));
        } else {
          const faceY   = dy + (ay > 0 ? -th : th);
          const maxSpan = (tw * 2 - 8) * 0.85;
          const step    = groupCount > 1 ? maxSpan / (groupCount - 1) : 0;
          ddx = Math.max(dx - tw + 4, Math.min(dx + tw - 4,
                  dx + (groupIdx - (groupCount - 1) / 2) * step));
          ddy = faceY;
        }

        const srcDims = nodeRectDims(blocked, settings);
        const srcPt   = rectEdgePoint(sx, sy, srcDims.w, srcDims.h, ddx, ddy);
        ssx = srcPt.x; ssy = srcPt.y;
      }

      const totalDist = Math.hypot(ddx - ssx, ddy - ssy);
      const curveDist = totalDist * 0.35;

      const ovx1 = ssx - sx, ovy1 = ssy - sy;
      const len1  = Math.hypot(ovx1, ovy1) || 1;
      const cp1x  = ssx + (ovx1 / len1) * curveDist;
      const cp1y  = ssy + (ovy1 / len1) * curveDist;

      const ovx2  = ddx - dx, ovy2 = ddy - dy;
      const len2  = Math.hypot(ovx2, ovy2) || 1;
      const cp2x  = ddx + (ovx2 / len2) * curveDist;
      const cp2y  = ddy + (ovy2 / len2) * curveDist;

      const pathData = `M ${ssx} ${ssy} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${ddx} ${ddy}`;

      // Create a link group with group-level opacity for perfect anti-overlap rendering
      const linkG = gDepEdges.append('g')
        .attr('class', 'dep-link')
        .style('opacity', 0.45)
        .attr('data-src', dep.blocked_id)
        .attr('data-tgt', dep.blocker_id);

      const pathEl = linkG.append('path')
        .attr('d',          pathData)
        .attr('fill',       'none')
        .attr('stroke',     depColor)
        .style('stroke-width', settings.edgeWidth + 'px');

      const pathNode = pathEl.node();
      const totalLen = pathNode.getTotalLength();
      if (totalLen < arrowLength) return;

      // Clip the stroke but extend slightly into polygon to avoid gaps
      pathEl.attr('stroke-dasharray', `${totalLen - arrowLength + 4} ${totalLen}`);

      const tipPt  = pathNode.getPointAtLength(totalLen);
      const basePt = pathNode.getPointAtLength(totalLen - arrowLength);

      const adx = tipPt.x - basePt.x, ady = tipPt.y - basePt.y;
      const aLen = Math.hypot(adx, ady) || 1;
      const ux = adx / aLen, uy = ady / aLen, px = -uy, py = ux;

      linkG.append('polygon')
        .attr('points', `${tipPt.x},${tipPt.y} ${basePt.x + px * arrowHalfW},${basePt.y + py * arrowHalfW} ${basePt.x - px * arrowHalfW},${basePt.y - py * arrowHalfW}`)
        .attr('fill', depColor);
    });

    // Keep dep edges below nodes but above tree links
    if (gAll && gDepEdges && gNodes) {
      gAll.node().insertBefore(gDepEdges.node(), gNodes.node());
    }
  }

  window.toggleDeps = function toggleDeps() {
    const btn = document.getElementById('deps-btn');
    depsVisible = !depsVisible;
    saveCookie('telos_deps_visible', String(depsVisible), 365);

    if (!depsVisible) {
      gDepEdges.selectAll('*').remove();
      if (btn) { btn.classList.remove('btn-active'); btn.setAttribute('aria-pressed', 'false'); }
      return;
    }

    if (btn) { btn.classList.add('btn-active'); btn.setAttribute('aria-pressed', 'true'); }

    const cacheBuster = Date.now();
    fetch(`http://localhost:8089/api/dependencies?_=${cacheBuster}`, { cache: 'no-store', signal: AbortSignal.timeout(3000) })
      .then(r => {
        if (!r.ok) throw new Error(`API error: ${r.status}`);
        return r.json();
      })
      .then(data => drawDepEdges(Array.isArray(data) ? data : (data.dependencies || [])))
      .catch(() => {
        fetch('telos-data.json')
          .then(r => r.json())
          .then(data => drawDepEdges(data.dependencies || []))
          .catch(err => console.warn('Could not load dependencies:', err));
      });
  };

  // ── Ideas panel ──────────────────────────────────────────────────────────
  function loadIdeas() {
    const panel = document.getElementById('ideas-panel');
    panel.innerHTML = '<p style="color:var(--text-muted);font-size:12px;padding:8px 0">Loading…</p>';

    const cacheBuster = Date.now();
    fetch(`http://localhost:8089/api/ideas?_=${cacheBuster}`, { cache: 'no-store', signal: AbortSignal.timeout(3000) })
      .then(r => {
        if (!r.ok) throw new Error(`API error: ${r.status}`);
        return r.json();
      })
      .then(data => renderIdeas(data.ideas))
      .catch(err => {
        fetch('telos-data.json')
          .then(r => r.json())
          .then(data => renderIdeas(data.ideas || []))
          .catch(() => {
            panel.innerHTML = `<div id="error">⚠️ Could not load ideas<br><small>${err.message}</small></div>`;
          });
      });
  }

  function esc(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderIdeas(ideas) {
    const panel = document.getElementById('ideas-panel');
    if (!ideas || ideas.length === 0) {
      panel.innerHTML = `
        <div class="ideas-section">
          <h2>💡 Idea Backlog</h2>
          <p class="ideas-empty">No ideas yet. Use <code>telos idea add "My Idea"</code> to add one.</p>
        </div>`;
      return;
    }

    const grouped = { active: [], parked: [], rejected: [] };
    ideas.forEach(i => { (grouped[i.status] || grouped.active).push(i); });

    const sections = [
      { key: 'active',   label: '🟢 Active',   desc: 'Worth pursuing now' },
      { key: 'parked',   label: '🟡 Parked',   desc: 'Good ideas, not now' },
      { key: 'rejected', label: '⬜ Rejected',  desc: 'Decided against' },
    ];

    let html = '';
    for (const { key, label, desc } of sections) {
      const list = grouped[key];
      if (!list || list.length === 0) continue;
      html += `<div class="ideas-section">
        <h2>${label} <span class="badge">${list.length}</span> <span style="font-weight:400;font-size:10px;color:var(--text-muted)">${desc}</span></h2>`;
      for (const idea of list) {
        let tags = [];
        try { tags = Array.isArray(idea.tags) ? idea.tags : JSON.parse(idea.tags || '[]'); } catch {}
        const created = new Date(idea.created_at * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

        html += `<div class="idea-card">
          <div class="idea-header">
            <div class="idea-status-dot idea-status-${esc(idea.status)}"></div>
            <span class="idea-title">${esc(idea.title)}</span>
            <span class="idea-id">#${idea.id} · ${created}</span>
          </div>`;

        if (idea.description || idea.rationale || idea.key_decisions) {
          html += '<div class="idea-body">';
          if (idea.description)   html += `<p>${esc(idea.description)}</p>`;
          if (idea.rationale)     html += `<p><strong>Why:</strong> ${esc(idea.rationale)}</p>`;
          if (idea.key_decisions) html += `<p><strong>Decisions:</strong> ${esc(idea.key_decisions)}</p>`;
          html += '</div>';
        }

        if (tags.length > 0) {
          html += '<div class="idea-tags">';
          tags.forEach(t => { html += `<span class="idea-tag">${esc(t)}</span>`; });
          html += '</div>';
        }
        html += '</div>';
      }
      html += '</div>';
    }
    panel.innerHTML = html;
  }

  // ── Live data refresh ────────────────────────────────────────────────────
  window.refreshData = function refreshData(silent) {
    const btn = document.getElementById('refresh-data-btn');
    if (!silent) {
      btn.innerText = '↺';
      btn.disabled  = true;
    }

    const cacheBuster = Date.now();
    fetch(`http://localhost:8089/api/tree?_=${cacheBuster}`, { cache: 'no-store', signal: AbortSignal.timeout(3000) })
      .then(r => {
        if (!r.ok) throw new Error(`API error: ${r.status}`);
        return r.json();
      })
      .then(data => {
        rawTreeData     = data.tree[0];
        lastUpdatedTime = Date.now();
        let filtered  = applyDoneFilter(
          JSON.parse(JSON.stringify(rawTreeData)),
          getCutoffSecs(doneFilterDays)
        );
        if (hideRejected) applyRejectedFilter(filtered);
        if (hideShelved)  applyShelvedFilter(filtered);
    if (hideBlocked)  applyBlockedFilter(filtered);

        root = d3.hierarchy(filtered, d => d.children && d.children.length ? d.children : null);
        root.x0 = width  / 2;
        root.y0 = height / 2;
        root.descendants().forEach(d => {
          if (d.depth > 1) { d._children = d.children; d.children = null; }
        });
        window._telosRoot = root;

        gLinks.selectAll('.link').remove();
        gNodes.selectAll('.node').remove();
        update(root);
        if (!silent) resetView();

        updateLastUpdatedDisplay();

        if (!silent) {
          btn.innerText = '✓';
          setTimeout(() => { btn.innerText = '↻'; btn.disabled = false; }, 1000);
        }
      })
      .catch(err => {
        if (!silent) {
          document.getElementById('container').innerHTML =
            `<div id="error">⚠️ Could not reload data<br><small>${err.message}</small></div>`;
          btn.innerText = '↻';
          btn.disabled  = false;
        }
        if (silent) console.warn('Auto-refresh failed:', err.message);
      });
  };

})();
