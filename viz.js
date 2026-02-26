/* Telos — D3 tree visualization */
(function () {
  'use strict';

  // ── Edge colors (used in JS since SVG attrs can't read CSS vars) ─────────
  const EDGE_DEP        = 'rgba(99, 120, 150, 0.6)';
  const EDGE_DEP_HOVER  = 'rgba(148, 163, 184, 0.9)';
  const EDGE_DIM_OPACITY = 0.1;

  // Border colors per status (for glow effects)
  const BORDER_COLORS = {
    open:        '#3b82f6',
    in_progress: '#22c55e',
    done:        '#4ade80',
    blocked:     '#ef4444',
    out_of_budget: '#ef4444',
    shelved:     '#475569',
    rejected:    '#374151',
    refused:     '#374151',
    in_question: '#eab308',
  };

  // ── Dynamic node sizing ──────────────────────────────────────────────────
  function computeNodeRadius(count) {
    const base = Math.min(width, height) / Math.sqrt(Math.max(count, 1)) * 0.38;
    return {
      goal:      Math.max(24, Math.min(base * 1.4, 72)),
      milestone: Math.max(18, Math.min(base,       54)),
      task:      Math.max(12, Math.min(base * 0.7, 38))
    };
  }

  function nodeFontSize(r) {
    return Math.max(7, Math.min(Math.round(r * 0.32), 13));
  }

  // ── Done-filter state ────────────────────────────────────────────────────
  const LS_FILTER_KEY = 'telos_done_filter_days';
  let doneFilterDays = (() => {
    const v = localStorage.getItem(LS_FILTER_KEY);
    return v !== null ? parseInt(v, 10) : 1;
  })();

  /** Raw tree data from last API fetch */
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

  // ── State ────────────────────────────────────────────────────────────────
  let root, svg, gAll, gLinks, gNodes, gDepEdges, treeLayout, width, height;
  let simulation = null;
  let lastUpdatedTime = null;
  let depsVisible = false;
  let cachedDeps = null;
  const tooltip = document.getElementById('tooltip');

  const COLLAPSED_SYMBOL = '+';
  const EXPANDED_SYMBOL  = '−';

  function updateLastUpdatedDisplay() {
    const el = document.getElementById('last-updated');
    if (!el || !lastUpdatedTime) return;
    const t = new Date(lastUpdatedTime);
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    const ss = String(t.getSeconds()).padStart(2, '0');
    el.textContent = `${hh}:${mm}:${ss}`;
  }

  // ── Bootstrap ────────────────────────────────────────────────────────────
  fetch('http://localhost:8089/api/tree', { cache: 'no-store' })
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

    root = d3.hierarchy(treeData, d => d.children && d.children.length ? d.children : null);
    root.x0 = height / 2;
    root.y0 = 0;
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
      .attr('width', width)
      .attr('height', height)
      .attr('role', 'img')
      .attr('aria-label', 'Telos goal tree');

    // Zoom with touch (pinch + pan)
    const zoom = d3.zoom()
      .scaleExtent([0.05, 6])
      .on('zoom', e => gAll.attr('transform', e.transform));
    svg.call(zoom);

    gAll      = svg.append('g').attr('class', 'all');
    gLinks    = gAll.append('g').attr('class', 'links');
    gDepEdges = gAll.append('g').attr('id', 'dep-edges');
    gNodes    = gAll.append('g').attr('class', 'nodes');

    // Arrowhead markers for dep edges
    const defs = svg.append('defs');
    defs.append('marker')
      .attr('id', 'dep-arrow')
      .attr('markerWidth', 8).attr('markerHeight', 6)
      .attr('refX', 8).attr('refY', 3)
      .attr('orient', 'auto')
      .append('path')
        .attr('d', 'M 0 0 L 0 6 L 8 3 z')
        .attr('fill', 'rgba(99,120,150,0.8)');

    defs.append('marker')
      .attr('id', 'dep-arrow-hover')
      .attr('markerWidth', 8).attr('markerHeight', 6)
      .attr('refX', 8).attr('refY', 3)
      .attr('orient', 'auto')
      .append('path')
        .attr('d', 'M 0 0 L 0 6 L 8 3 z')
        .attr('fill', 'rgba(148,163,184,0.9)');

    treeLayout = d3.tree().nodeSize([60, 240]);

    update(root);
    resetView();

    window.resetView    = resetView;
    window.expandAll    = expandAll;
    window.collapseAll  = collapseAll;
    window.toggleLegend = toggleLegend;
    window.toggleDeps   = toggleDeps;

    window.setDoneFilter = function setDoneFilter(days) {
      doneFilterDays = isNaN(days) ? 0 : days;
      localStorage.setItem(LS_FILTER_KEY, doneFilterDays);
      if (!rawTreeData) return;
      const filtered = applyDoneFilter(JSON.parse(JSON.stringify(rawTreeData)), getCutoffSecs(doneFilterDays));
      const newRoot = d3.hierarchy(filtered, d => d.children && d.children.length ? d.children : null);
      newRoot.x0 = height / 2;
      newRoot.y0 = 0;
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
  }

  // ── Resize handler ───────────────────────────────────────────────────────
  function resize() {
    const container = document.getElementById('container');
    width  = container.clientWidth;
    height = container.clientHeight;
    svg.attr('viewBox', `0 0 ${width} ${height}`)
       .attr('width', width).attr('height', height);
    if (simulation) {
      let strength = -(120 + (width * height) / 8000);
      if (width > 2560) strength *= 2;
      simulation.force('charge', d3.forceManyBody().strength(strength));
      simulation.alpha(0.3).restart();
    }
    if (root) {
      update(root);
    }
  }

  // ── Update / render ──────────────────────────────────────────────────────
  function update(source) {
    const nodes    = root.descendants();
    const radii    = computeNodeRadius(nodes.length);
    const maxR     = Math.max(radii.goal, radii.milestone, radii.task);
    const vSpacing = Math.max(50, maxR * 2 + 12);
    const hSpacing = Math.max(200, maxR * 3.8);
    treeLayout.nodeSize([vSpacing, hSpacing]);
    treeLayout(root);

    const links = root.links();
    const t = d3.transition().duration(350).ease(d3.easeCubicInOut);

    const r  = d => radii[d.data.type] || radii.task;
    const fs = d => nodeFontSize(r(d));

    // ── Links ──
    const link = gLinks.selectAll('.link').data(links, d => d.target.data.id);

    const linkEnter = link.enter().append('path')
      .attr('class', 'link')
      .attr('d', () => {
        const o = { x: source.x0 ?? source.x, y: source.y0 ?? source.y };
        return diagonal(o, o);
      });

    link.merge(linkEnter)
      .transition(t)
      .attr('d', d => diagonal(d.source, d.target));

    link.exit()
      .transition(t)
      .attr('d', () => {
        const o = { x: source.x, y: source.y };
        return diagonal(o, o);
      })
      .remove();

    // ── Nodes ──
    const node = gNodes.selectAll('.node').data(nodes, d => d.data.id);

    const nodeEnter = node.enter().append('g')
      .attr('class', d => `node status-${d.data.status}`)
      .attr('transform', () => `translate(${source.y0 ?? source.y},${source.x0 ?? source.x})`)
      .attr('tabindex', 0)
      .attr('role', 'treeitem')
      .attr('aria-label', d => `#${d.data.id} ${d.data.title}`)
      .on('click', (e, d) => { e.stopPropagation(); showDetailPanel(d); })
      .on('dblclick', (e, d) => { e.stopPropagation(); toggle(d); })
      .on('keydown', (e, d) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showDetailPanel(d); }
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); toggle(d); }
      })
      .on('mouseenter', (e, d) => onNodeHover(e, d))
      .on('mousemove',  moveTooltip)
      .on('mouseleave', (e, d) => onNodeHoverEnd(e, d));

    // Invisible hit-target for mobile (min 44px radius)
    nodeEnter.append('circle')
      .attr('class', 'hit-target')
      .attr('fill', 'transparent')
      .attr('stroke', 'none')
      .attr('r', d => Math.max(r(d), 22));

    // Bottleneck ring (behind main circle)
    nodeEnter.append('circle')
      .attr('class', 'bottleneck-ring')
      .attr('fill', 'none')
      .attr('stroke', '#ff4444')
      .attr('stroke-width', 2)
      .attr('r', 0);

    // Main circle
    nodeEnter.append('circle').attr('class', 'node-circle').attr('r', 0);

    // Node label: #ID + title inside circle
    nodeEnter.append('text')
      .attr('class', 'label')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('pointer-events', 'none');

    // Expand/collapse indicator
    nodeEnter.append('text')
      .attr('class', 'indicator')
      .attr('dominant-baseline', 'central')
      .attr('text-anchor', 'middle');

    // Progress bar below node
    const progG = nodeEnter.append('g')
      .attr('class', 'progress-bar');
    progG.append('rect')
      .attr('class', 'progress-bg')
      .attr('height', 3)
      .attr('rx', 1.5)
      .attr('fill', 'rgba(255,255,255,0.12)');
    progG.append('rect')
      .attr('class', 'progress-fill')
      .attr('height', 3)
      .attr('rx', 1.5)
      .attr('fill', '#4ade80')
      .attr('width', 0);

    // ── Merged update ──
    const nodeMerge = node.merge(nodeEnter);

    nodeMerge
      .transition(t)
      .attr('transform', d => `translate(${d.y},${d.x})`)
      .attr('class', d => `node status-${d.data.status}`);

    // Hit target
    nodeMerge.select('.hit-target')
      .attr('r', d => Math.max(r(d), 22));

    // Main circle
    nodeMerge.select('.node-circle')
      .transition(t)
      .attr('r', r);

    // Bottleneck ring
    nodeMerge.select('.bottleneck-ring')
      .classed('bottleneck-pulse', d => !!d.data.is_bottleneck)
      .transition(t)
      .attr('r', d => d.data.is_bottleneck ? r(d) + 4 : 0);

    // Label: rebuild tspans each update (handles radius changes on expand/collapse)
    nodeMerge.select('text.label').each(function(d) {
      const el       = d3.select(this);
      const rr       = r(d);
      const fontSize = fs(d);
      const id       = d.data.id;
      const title    = d.data.title || '';
      el.attr('font-size', fontSize).selectAll('tspan').remove();

      if (rr >= 18) {
        const charsPerLine = Math.max(4, Math.floor((rr * 1.7) / (fontSize * 0.58)));
        const shortTitle   = title.length > charsPerLine
          ? title.slice(0, charsPerLine - 1) + '…'
          : title;
        el.append('tspan')
          .attr('x', 0)
          .attr('dy', '-0.52em')
          .attr('fill', '#58a6ff')
          .attr('font-size', Math.max(fontSize - 1, 7))
          .attr('font-weight', 700)
          .text(`#${id}`);
        el.append('tspan')
          .attr('x', 0)
          .attr('dy', '1.1em')
          .attr('fill', '#e6edf3')
          .text(shortTitle);
      } else {
        el.append('tspan')
          .attr('x', 0)
          .attr('dy', 0)
          .attr('fill', '#58a6ff')
          .attr('font-size', Math.max(fontSize - 1, 7))
          .text(`#${id}`);
      }
    });

    // Expand/collapse indicator
    nodeMerge.select('text.indicator')
      .attr('font-size', d => Math.max(r(d) * 0.55, 7))
      .attr('dy', d => r(d) + 12)
      .text(d => {
        if (!d._children && !d.children) return '';
        return d.children ? EXPANDED_SYMBOL : COLLAPSED_SYMBOL;
      });

    // Progress bars
    nodeMerge.select('.progress-bar')
      .attr('transform', d => `translate(${-r(d)}, ${r(d) + 5})`)
      .attr('display', d => (d.data.status === 'in_progress' && d.data.progress > 0) ? null : 'none');
    nodeMerge.select('.progress-bar rect.progress-bg')
      .attr('width', d => r(d) * 2);
    nodeMerge.select('.progress-bar rect.progress-fill')
      .transition(t)
      .attr('width', d => r(d) * 2 * ((d.data.progress || 0) / 100));

    node.exit()
      .transition(t)
      .attr('transform', `translate(${source.y},${source.x})`)
      .remove()
      .select('.node-circle').attr('r', 0);

    root.descendants().forEach(d => { d.x0 = d.x; d.y0 = d.y; });

    if (depsVisible && cachedDeps) drawDepEdges(cachedDeps);
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
    const xs = nodes.map(d => d.y);
    const ys = nodes.map(d => d.x);
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

    svg.transition().duration(500).ease(d3.easeCubicInOut)
      .call(
        d3.zoom().scaleExtent([0.05, 6]).on('zoom', e => gAll.attr('transform', e.transform))
          .transform,
        d3.zoomIdentity.translate(tx, ty).scale(scale)
      );
  }

  function toggleLegend() {
    document.getElementById('legend').classList.toggle('legend-expanded');
  }

  // ── Hover dim effect ─────────────────────────────────────────────────────
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

    const connected  = getConnectedNodeIds(d);
    const glowColor  = BORDER_COLORS[d.data.status] || '#3b82f6';

    // Glow on hovered node
    d3.select(event.currentTarget).select('.node-circle')
      .attr('filter', `drop-shadow(0 0 10px ${glowColor})`);

    // Dim unconnected nodes
    gNodes.selectAll('.node').each(function(nd) {
      d3.select(this).style('opacity', connected.has(nd.data.id) ? 1.0 : 0.2);
    });

    // Dim unconnected tree links
    gLinks.selectAll('.link').each(function(ld) {
      const inv = connected.has(ld.source.data.id) || connected.has(ld.target.data.id);
      d3.select(this).style('opacity', inv ? 1.0 : EDGE_DIM_OPACITY);
    });

    // Highlight/dim dep edges
    if (depsVisible) {
      gDepEdges.selectAll('path').each(function() {
        const src = +d3.select(this).attr('data-src');
        const tgt = +d3.select(this).attr('data-tgt');
        const inv = connected.has(src) || connected.has(tgt);
        d3.select(this)
          .attr('stroke', inv ? EDGE_DEP_HOVER : EDGE_DEP)
          .style('opacity', inv ? 1.0 : EDGE_DIM_OPACITY)
          .attr('marker-end', inv ? 'url(#dep-arrow-hover)' : 'url(#dep-arrow)');
      });
    }
  }

  function onNodeHoverEnd(event, d) {
    hideTooltip();

    d3.select(event.currentTarget).select('.node-circle')
      .attr('filter', null);

    gNodes.selectAll('.node').style('opacity', null);
    gLinks.selectAll('.link').style('opacity', null);

    if (depsVisible) {
      gDepEdges.selectAll('path')
        .attr('stroke', EDGE_DEP)
        .style('opacity', null)
        .attr('marker-end', 'url(#dep-arrow)');
    }
  }

  // ── Detail Panel ─────────────────────────────────────────────────────────
  function showDetailPanel(d) {
    const nd     = d.data;
    const panel  = document.getElementById('detail-panel');
    const titleEl = document.getElementById('detail-panel-title');
    const body   = document.getElementById('detail-panel-body');

    // #ID prominently before title
    titleEl.innerHTML =
      `<span style="color:#58a6ff;font-weight:800;font-size:16px">#${nd.id}</span>` +
      ` <span style="color:#7d8590;font-weight:400">—</span> ` +
      `${escHtml(nd.title)}`;

    const roi      = nd.roi != null ? parseFloat(nd.roi).toFixed(2) : '—';
    const fmt2     = v => v != null ? '€' + Number(v).toLocaleString() : '—';
    const fmtDate  = ts => ts ? new Date(ts * 1000).toLocaleDateString() : '—';
    const badgeClass  = `badge-${nd.status}`;
    const statusLabel = nd.status.replace(/_/g, ' ');

    const desc     = nd.description || '';
    const PREVIEW_LEN = 150;
    const hasMore  = desc.length > PREVIEW_LEN;
    const preview  = hasMore ? desc.slice(0, PREVIEW_LEN).trimEnd() + '…' : desc;
    const descHTML = desc
      ? `<div class="dp-description-box dp-desc-collapsed" id="dp-desc-box">
           <span class="dp-desc-preview">${escHtml(preview)}</span>
           <span class="dp-desc-full">${escHtml(desc)}</span>
           ${hasMore ? `<button class="dp-desc-toggle" onclick="toggleDesc()">▼ Show more</button>` : ''}
         </div>`
      : `<div class="dp-description-box" style="color:rgba(255,255,255,0.3);font-style:italic">No description</div>`;

    const pct          = nd.progress || 0;
    const progressHTML = `
      <div class="dp-progress-bar-bg">
        <div class="dp-progress-bar-fill" style="width:${pct}%"></div>
      </div>
      <div style="font-size:10px;color:var(--text-muted);margin-top:4px">${pct}% complete</div>`;

    const notes    = (nd.notes || []).slice(-5);
    const notesHTML = notes.length
      ? notes.map(n => {
          const ts     = new Date(n.ts * 1000).toLocaleString();
          const pctStr = n.progress != null ? `<span class="dp-note-pct"> [${n.progress}%]</span>` : '';
          return `<div class="dp-note"><span class="dp-note-ts">${ts}</span>${pctStr}<br>${escHtml(n.text)}</div>`;
        }).join('')
      : `<div style="font-size:10px;color:rgba(255,255,255,0.3)">No step notes yet</div>`;

    // Depends-on / blocked-by info
    const depsInfo = nd.depends_on && nd.depends_on.length
      ? `<div class="dp-row"><span class="dp-label">Depends on</span><span class="dp-value">${nd.depends_on.map(id => `#${id}`).join(', ')}</span></div>`
      : '';

    body.innerHTML = `
      <div class="dp-section">
        <div class="dp-section-title">Identity</div>
        <div class="dp-row">
          <span class="dp-label">ID</span>
          <span class="dp-value" style="color:#58a6ff;font-weight:700">#${nd.id}</span>
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
    box.classList.toggle('dp-desc-expanded',  isCollapsed);
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

  document.getElementById('container').addEventListener('click', () => closeDetailPanel());
  window.closeDetailPanel = closeDetailPanel;
  window.toggleDesc = toggleDesc;

  // ── Diagonal path ────────────────────────────────────────────────────────
  function diagonal(s, d) {
    return `M ${s.y} ${s.x}
            C ${(s.y + d.y) / 2} ${s.x},
              ${(s.y + d.y) / 2} ${d.x},
              ${d.y} ${d.x}`;
  }

  // ── Tooltip ──────────────────────────────────────────────────────────────
  function fmtVal(n) {
    if (n == null) return '—';
    if (n >= 1_000_000) return `€${(n/1_000_000).toFixed(1)}M`;
    if (n >= 1_000)     return `€${(n/1_000).toFixed(0)}K`;
    return `€${n}`;
  }

  function showTooltip(event, d) {
    const nd     = d.data;
    const roi    = nd.roi != null ? parseFloat(nd.roi).toFixed(2) : '—';
    const status = nd.status.replace(/_/g, ' ');
    tooltip.innerHTML = `
      <div class="title">
        <span style="color:#58a6ff;font-weight:800">#${nd.id}</span>
        <span style="color:#7d8590"> — </span>${escHtml(nd.title)}
      </div>
      <div class="row">
        <span class="label">Status</span>
        <span class="value">${status}</span>
        <span style="color:#7d8590;margin-left:8px">|</span>
        <span class="label" style="margin-left:8px">Type</span>
        <span class="value">${nd.type}</span>
        <span style="color:#7d8590;margin-left:8px">|</span>
        <span class="label" style="margin-left:8px">Owner</span>
        <span class="value">${nd.owner || '—'}</span>
      </div>
      ${nd.value != null || nd.cost_estimate != null ? `
      <div class="row">
        <span class="label">Value</span> <span class="value">${fmtVal(nd.value)}</span>
        &nbsp;&nbsp;
        <span class="label">Cost</span> <span class="value">${fmtVal(nd.cost_estimate)}</span>
        &nbsp;&nbsp;
        <span class="label">ROI</span> <span class="value">${roi}</span>
      </div>` : ''}
      ${nd.progress > 0 ? `<div class="row"><span class="label">Progress</span><span class="value">${nd.progress}%</span></div>` : ''}
    `;
    tooltip.classList.add('visible');
    moveTooltip(event);
  }

  function moveTooltip(event) {
    const margin = 14;
    const tw     = tooltip.offsetWidth, th = tooltip.offsetHeight;
    let left     = event.clientX + margin;
    let top      = event.clientY + margin;
    if (left + tw > window.innerWidth)  left = event.clientX - tw - margin;
    if (top  + th > window.innerHeight) top  = event.clientY - th - margin;
    tooltip.style.left = `${left}px`;
    tooltip.style.top  = `${top}px`;
  }

  function hideTooltip() {
    tooltip.classList.remove('visible');
  }

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
    if (controls)     controls.style.display = 'none';
    if (legend)       legend.style.display   = 'none';
    if (legendToggle) legendToggle.style.display = 'none';
    if (filterWrap)   filterWrap.style.display   = 'none';

    ['tree','list','ideas'].forEach(t => {
      const b = document.getElementById(`bnav-${t}`);
      if (b) b.classList.toggle('active', t === tab);
    });

    if (tab === 'tree') {
      container.style.display = '';
      if (treeBtn) { treeBtn.classList.add('active'); treeBtn.setAttribute('aria-selected', 'true'); }
      if (controls)     controls.style.display     = '';
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
        if (n.children && n.children.length) flatten(n.children);
        if (n._children && n._children.length) flatten(n._children);
      });
    }

    if (window._telosRoot) {
      flatten(window._telosRoot.descendants().map(d => d.data));
    } else {
      el.innerHTML = '<p style="color:var(--text-muted);padding:16px;font-size:12px">Load the tree first.</p>';
      return;
    }

    const STATUS_ORDER = { in_progress: 0, blocked: 1, in_question: 2, open: 3, done: 4, shelved: 5, refused: 6, rejected: 7, out_of_budget: 8 };
    const statusGroups = {};
    allNodes
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

    const groupOrder = ['in_progress','blocked','in_question','open','done','shelved','rejected','refused','out_of_budget'];
    const groupLabels = {
      in_progress:   '🔵 In Progress',
      blocked:       '🔴 Blocked',
      in_question:   '🟠 In Question',
      open:          '🟡 Open',
      done:          '✅ Done',
      shelved:       '⬜ Shelved',
      rejected:      '🚫 Rejected',
      refused:       '⚫ Refused',
      out_of_budget: '💸 Out of Budget'
    };

    let html = '';
    for (const g of groupOrder) {
      const gnodes = statusGroups[g];
      if (!gnodes || !gnodes.length) continue;
      html += `<div class="lv-group"><div class="lv-group-title">${groupLabels[g] || g} (${gnodes.length})</div>`;
      for (const n of gnodes) {
        const roi    = n.roi != null ? `ROI ${parseFloat(n.roi).toFixed(0)}` : '';
        const owner  = n.owner ? `· ${n.owner}` : '';
        const pct    = n.progress || 0;
        const progressBar = pct > 0
          ? `<div class="lv-card-progress"><div class="lv-card-progress-fill" style="width:${pct}%"></div></div>` : '';
        const badgeClass = `badge-${n.status}`;
        html += `<div class="lv-card" onclick="openNodeDetail(${n.id})" role="listitem">
          <div class="lv-card-top">
            <div class="lv-card-title">
              <span style="color:#58a6ff;font-weight:700">#${n.id}</span> ${escHtml(n.title)}
            </div>
            <span class="dp-badge ${badgeClass}">${n.type}</span>
          </div>
          <div class="lv-card-meta">
            ${roi ? `<span class="lv-card-roi">${roi}</span>` : ''}
            <span>${owner}</span>
            ${pct > 0 ? `<span>${pct}%</span>` : ''}
          </div>
          ${progressBar}
        </div>`;
      }
      html += '</div>';
    }

    el.innerHTML = html || '<p style="color:var(--text-muted);padding:16px;font-size:12px">No tasks found.</p>';
  }

  window.openNodeDetail = function(id) {
    if (!window._telosRoot) return;
    const desc = window._telosRoot.descendants().find(d => d.data.id === id);
    if (desc) showDetailPanel(desc);
  };

  // ── Dependency edges ─────────────────────────────────────────────────────
  // Direction: arrow FROM blocked node TO its blocker (A → B means "A needs B")
  function drawDepEdges(deps) {
    cachedDeps = deps;
    gDepEdges.selectAll('path').remove();
    if (!deps || !deps.length || !root) return;

    const nodeMap  = new Map(root.descendants().map(d => [d.data.id, d]));
    const allNodes = root.descendants();
    const radii    = computeNodeRadius(allNodes.length);

    deps.forEach(dep => {
      const blocker = nodeMap.get(dep.blocker_id);
      const blocked = nodeMap.get(dep.blocked_id);
      if (!blocker || !blocked) return;

      // Source = blocked (the dependent), target = blocker (what it needs)
      const sx = blocked.y, sy = blocked.x;
      const dx = blocker.y, dy = blocker.x;

      const mx  = (sx + dx) / 2;
      const my  = (sy + dy) / 2 - 60;

      const srcR = (radii[blocked.data.type] || radii.task) + 2;
      const tgtR = (radii[blocker.data.type] || radii.task) + 2;

      // Offset start from source circle edge
      const s2mx = mx - sx, s2my = my - sy;
      const s2mLen = Math.sqrt(s2mx * s2mx + s2my * s2my) || 1;
      const ssx = sx + (s2mx / s2mLen) * srcR;
      const ssy = sy + (s2my / s2mLen) * srcR;

      // Offset end to target circle edge
      const m2dx = dx - mx, m2dy = dy - my;
      const m2dLen = Math.sqrt(m2dx * m2dx + m2dy * m2dy) || 1;
      const ddx = dx - (m2dx / m2dLen) * tgtR;
      const ddy = dy - (m2dy / m2dLen) * tgtR;

      gDepEdges.append('path')
        .attr('d', `M ${ssx} ${ssy} Q ${mx} ${my} ${ddx} ${ddy}`)
        .attr('fill', 'none')
        .attr('stroke', EDGE_DEP)
        .attr('stroke-width', 1.8)
        .attr('marker-end', 'url(#dep-arrow)')
        .attr('data-src', dep.blocked_id)
        .attr('data-tgt', dep.blocker_id);
    });
  }

  window.toggleDeps = function toggleDeps() {
    const btn = document.getElementById('deps-btn');
    depsVisible = !depsVisible;

    if (!depsVisible) {
      gDepEdges.selectAll('path').remove();
      if (btn) { btn.classList.remove('btn-active'); btn.setAttribute('aria-pressed', 'false'); }
      return;
    }

    if (btn) { btn.classList.add('btn-active'); btn.setAttribute('aria-pressed', 'true'); }

    const cacheBuster = Date.now();
    fetch(`http://localhost:8089/api/dependencies?_=${cacheBuster}`, { cache: 'no-store' })
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
    fetch(`http://localhost:8089/api/ideas?_=${cacheBuster}`, { cache: 'no-store' })
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
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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
      { key: 'rejected', label: '⬜ Rejected',  desc: 'Decided against' }
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
        const created = new Date(idea.created_at * 1000).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });

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
      btn.disabled = true;
    }

    const cacheBuster = Date.now();
    fetch(`http://localhost:8089/api/tree?_=${cacheBuster}`, { cache: 'no-store' })
      .then(r => {
        if (!r.ok) throw new Error(`API error: ${r.status}`);
        return r.json();
      })
      .then(data => {
        rawTreeData = data.tree[0];
        lastUpdatedTime = Date.now();
        const filtered = applyDoneFilter(JSON.parse(JSON.stringify(rawTreeData)), getCutoffSecs(doneFilterDays));

        root = d3.hierarchy(filtered, d => d.children && d.children.length ? d.children : null);
        root.x0 = height / 2;
        root.y0 = 0;
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
