/* Telos — D3 tree visualization */
(function () {
  'use strict';

  // ── Config ────────────────────────────────────────────────────────────────
  const NODE_RADIUS = { goal: 22, milestone: 16, task: 10 };
  const NODE_LABEL_OFFSET = { goal: 30, milestone: 24, task: 16 };
  const LINK_COLOR = 'rgba(255,255,255,0.1)';
  const COLLAPSED_SYMBOL = '+';
  const EXPANDED_SYMBOL = '−';

  // ── Done-filter state ─────────────────────────────────────────────────────
  const LS_FILTER_KEY = 'telos_done_filter_days';
  let doneFilterDays = (() => {
    const v = localStorage.getItem(LS_FILTER_KEY);
    return v !== null ? parseInt(v, 10) : 1; // default: 1 day
  })();

  /** Raw tree data from last API fetch — preserved so filter can be re-applied
   *  without a network round-trip. */
  let rawTreeData = null;

  /** Return seconds cutoff: nodes completed before this timestamp are hidden.
   *  Returns 0 when filtering is off (days === 0). */
  function getCutoffSecs(days) {
    if (!days || days <= 0) return 0;
    return Math.floor(Date.now() / 1000) - days * 86400;
  }

  /** Deep-clone + prune done nodes whose completed_at < cutoffSecs.
   *  Operates on plain JS objects (before D3 hierarchy wrapping). */
  function applyDoneFilter(node, cutoffSecs) {
    if (!node) return node;
    if (!node.children || node.children.length === 0) return node;
    node.children = node.children
      .filter(c => {
        if (c.status === 'done' && cutoffSecs > 0) {
          // Hide if completed before cutoff (or never recorded → hide conservatively)
          if (!c.completed_at || c.completed_at < cutoffSecs) return false;
        }
        return true;
      })
      .map(c => applyDoneFilter(c, cutoffSecs));
    return node;
  }

  /** Sync the <select> element to the current doneFilterDays value. */
  function syncFilterSelect() {
    const sel = document.getElementById('done-filter');
    if (!sel) return;
    // Find closest matching option; fall back to first
    const opt = Array.from(sel.options).find(o => parseInt(o.value, 10) === doneFilterDays);
    sel.value = opt ? opt.value : String(doneFilterDays);
  }

  // ── State ─────────────────────────────────────────────────────────────────
  let root, svg, gAll, gLinks, gNodes, treeLayout, width, height;
  let simulation = null;
  const tooltip = document.getElementById('tooltip');

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  // Fetch from API endpoint for live data (falls back to static file if API fails)
  fetch('http://localhost:8089/api/tree', { cache: 'no-store' })
    .then(r => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json();
    })
    .then(data => {
      rawTreeData = data.tree[0];
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

    // Apply done-task filter before building hierarchy
    const cutoff = getCutoffSecs(doneFilterDays);
    if (cutoff > 0) applyDoneFilter(treeData, cutoff);

    // Build hierarchy
    root = d3.hierarchy(treeData, d => d.children && d.children.length ? d.children : null);
    root.x0 = height / 2;
    root.y0 = 0;
    window._telosRoot = root; // expose for list view

    // Collapse everything beyond depth 1 by default
    root.descendants().forEach(d => {
      if (d.depth > 1) {
        d._children = d.children;
        d.children = null;
      }
    });

    // SVG
    svg = d3.select('#container')
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('role', 'img')
      .attr('aria-label', 'Telos goal tree');

    // Zoom
    const zoom = d3.zoom()
      .scaleExtent([0.1, 3])
      .on('zoom', e => gAll.attr('transform', e.transform));
    svg.call(zoom);

    gAll   = svg.append('g').attr('class', 'all');
    gLinks = gAll.append('g').attr('class', 'links');
    gNodes = gAll.append('g').attr('class', 'nodes');

    treeLayout = d3.tree().nodeSize([44, 220]);

    update(root);
    resetView();

    // Expose globals for buttons
    window.resetView    = resetView;
    window.expandAll    = expandAll;
    window.collapseAll  = collapseAll;
    window.toggleLegend = toggleLegend;

    // Done-filter setter (called by the <select> onchange)
    window.setDoneFilter = function setDoneFilter(days) {
      doneFilterDays = isNaN(days) ? 0 : days;
      localStorage.setItem(LS_FILTER_KEY, doneFilterDays);
      if (!rawTreeData) return;
      // Re-apply filter from stored raw data and re-render
      const filtered = applyDoneFilter(JSON.parse(JSON.stringify(rawTreeData)), getCutoffSecs(doneFilterDays));
      // Rebuild hierarchy in place
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

    // Resize
    window.addEventListener('resize', () => {
      width  = container.clientWidth;
      height = container.clientHeight;
      svg.attr('width', width).attr('height', height);
    });
  }

  // ── Update / render ───────────────────────────────────────────────────────
  function update(source) {
    treeLayout(root);

    const nodes = root.descendants();
    const links = root.links();

    const t = d3.transition().duration(350).ease(d3.easeCubicInOut);

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
      .attr('aria-label', d => d.data.title)
      .on('click', (e, d) => { e.stopPropagation(); showDetailPanel(d); })
      .on('dblclick', (e, d) => { e.stopPropagation(); toggle(d); })
      .on('keydown', (e, d) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showDetailPanel(d); }
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); toggle(d); }
      })
      .on('mouseenter', showTooltip)
      .on('mousemove',  moveTooltip)
      .on('mouseleave', hideTooltip);

    const r = d => NODE_RADIUS[d.data.type] || 10;

    nodeEnter.append('circle').attr('r', 0);

    // Label
    nodeEnter.append('text')
      .attr('class', 'label')
      .attr('dy', d => -(NODE_LABEL_OFFSET[d.data.type] || 14))
      .attr('font-size', d => d.data.type === 'goal' ? 13 : d.data.type === 'milestone' ? 11 : 9)
      .text(d => truncate(d.data.title, d.data.type === 'goal' ? 36 : d.data.type === 'milestone' ? 30 : 24));

    // Expand indicator
    nodeEnter.append('text')
      .attr('class', 'indicator')
      .attr('font-size', d => Math.max(r(d) * 0.7, 7));
    // Progress bar (in_progress nodes only)
    const progG = nodeEnter.append('g')
      .attr('class', 'progress-bar')
      .attr('transform', d => `translate(${-r(d)}, ${r(d) + 4})`);

    progG.append('rect')
      .attr('class', 'progress-bg')
      .attr('width', d => r(d) * 2)
      .attr('height', 3)
      .attr('rx', 1.5)
      .attr('fill', 'rgba(255,255,255,0.15)');

    progG.append('rect')
      .attr('class', 'progress-fill')
      .attr('height', 3)
      .attr('rx', 1.5)
      .attr('fill', '#4ade80')
      .attr('width', 0);



    // Merged update
    const nodeMerge = node.merge(nodeEnter);

    nodeMerge
      .transition(t)
      .attr('transform', d => `translate(${d.y},${d.x})`)
      .attr('class', d => `node status-${d.data.status}`);

    nodeMerge.select('circle')
      .transition(t)
      .attr('r', r);

    nodeMerge.select('.indicator')
      .text(d => {
        if (!d._children && !d.children) return '';
        return d.children ? EXPANDED_SYMBOL : COLLAPSED_SYMBOL;
      });


    // Update progress bars
    nodeMerge.select('.progress-bar')
      .attr('transform', d => `translate(${-r(d)}, ${r(d) + 4})`)
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
      .select('circle').attr('r', 0);

    // Save positions
    root.descendants().forEach(d => { d.x0 = d.x; d.y0 = d.y; });
  }

  // ── Toggle collapse/expand ────────────────────────────────────────────────
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

  // ── Global controls ───────────────────────────────────────────────────────
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
    const nodes = root.descendants();
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
        d3.zoom().scaleExtent([0.1, 3]).on('zoom', e => gAll.attr('transform', e.transform))
          .transform,
        d3.zoomIdentity.translate(tx, ty).scale(scale)
      );
  }

  function toggleLegend() {
    const legend = document.getElementById('legend');
    legend.classList.toggle('legend-expanded');
  }

  // ── Detail Panel ──────────────────────────────────────────────────────────
  function showDetailPanel(d) {
    const nd = d.data;
    const panel = document.getElementById('detail-panel');
    const titleEl = document.getElementById('detail-panel-title');
    const body = document.getElementById('detail-panel-body');

    titleEl.textContent = nd.title;

    const roi = nd.roi != null ? parseFloat(nd.roi).toFixed(2) : '—';
    const fmt2 = v => v != null ? '€' + Number(v).toLocaleString() : '—';
    const fmtDate = ts => ts ? new Date(ts * 1000).toLocaleDateString() : '—';
    const badgeClass = `badge-${nd.status}`;
    const statusLabel = nd.status.replace('_', ' ');

    // Description handling
    const desc = nd.description || '';
    const PREVIEW_LEN = 150;
    const hasMore = desc.length > PREVIEW_LEN;
    const preview = hasMore ? desc.slice(0, PREVIEW_LEN).trimEnd() + '…' : desc;
    const descHTML = desc
      ? `<div class="dp-description-box dp-desc-collapsed" id="dp-desc-box">
           <span class="dp-desc-preview">${escHtml(preview)}</span>
           <span class="dp-desc-full">${escHtml(desc)}</span>
           ${hasMore ? `<button class="dp-desc-toggle" onclick="toggleDesc()">▼ Show more</button>` : ''}
         </div>`
      : `<div class="dp-description-box" style="color:rgba(255,255,255,0.3);font-style:italic">No description</div>`;

    // Progress
    const pct = nd.progress || 0;
    const progressHTML = `
      <div class="dp-progress-bar-bg">
        <div class="dp-progress-bar-fill" style="width:${pct}%"></div>
      </div>
      <div style="font-size:10px;color:var(--text-secondary);margin-top:4px">${pct}% complete</div>`;

    // Notes (from metadata - not always in exported viz data, so guard)
    const notes = (nd.notes || []).slice(-5);
    const notesHTML = notes.length
      ? notes.map(n => {
          const ts = new Date(n.ts * 1000).toLocaleString();
          const pctStr = n.progress != null ? `<span class="dp-note-pct"> [${n.progress}%]</span>` : '';
          return `<div class="dp-note"><span class="dp-note-ts">${ts}</span>${pctStr}<br>${escHtml(n.text)}</div>`;
        }).join('')
      : `<div style="font-size:10px;color:rgba(255,255,255,0.3)">No step notes yet</div>`;

    body.innerHTML = `
      <div class="dp-section">
        <div class="dp-section-title">Status</div>
        <span class="dp-badge ${badgeClass}">${statusLabel}</span>
        &nbsp;<span style="font-size:10px;color:var(--text-secondary)">${nd.type} · ${nd.owner || '—'}</span>
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
    const btn = box.querySelector('.dp-desc-toggle');
    if (!box) return;
    const isCollapsed = box.classList.contains('dp-desc-collapsed');
    box.classList.toggle('dp-desc-collapsed', !isCollapsed);
    box.classList.toggle('dp-desc-expanded', isCollapsed);
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

  // Close panel when clicking background
  document.getElementById('container').addEventListener('click', () => {
    closeDetailPanel();
  });

  window.closeDetailPanel = closeDetailPanel;
  window.toggleDesc = toggleDesc;

  // ── Diagonal path ─────────────────────────────────────────────────────────
  function diagonal(s, d) {
    return `M ${s.y} ${s.x}
            C ${(s.y + d.y) / 2} ${s.x},
              ${(s.y + d.y) / 2} ${d.x},
              ${d.y} ${d.x}`;
  }

  // ── Tooltip ───────────────────────────────────────────────────────────────
  function fmt(n) {
    if (n == null) return '—';
    if (n >= 1_000_000) return `€${(n/1_000_000).toFixed(1)}M`;
    if (n >= 1_000)     return `€${(n/1_000).toFixed(0)}K`;
    return `€${n}`;
  }

  function showTooltip(event, d) {
    const nd = d.data;
    const roi = nd.roi != null ? parseFloat(nd.roi).toFixed(2) : '—';
    tooltip.innerHTML = `
      <div class="title">${nd.title}</div>
      <div class="row"><span class="label">Type</span>   <span class="value">${nd.type}</span></div>
      <div class="row"><span class="label">Status</span> <span class="value">${nd.status.replace('_',' ')}</span></div>
      <div class="row"><span class="label">Owner</span>  <span class="value">${nd.owner}</span></div>
      <div class="row"><span class="label">Value</span>  <span class="value">${fmt(nd.value)}</span></div>
      <div class="row"><span class="label">Cost</span>   <span class="value">${fmt(nd.cost_estimate)}</span></div>
      <div class="row"><span class="label">ROI</span>    <span class="value">${roi}</span></div>
      ${nd.effort_hours_estimate != null ? `<div class="row"><span class="label">Effort</span><span class="value">${nd.effort_hours_estimate}h</span></div>` : ''}
      ${nd.progress > 0 ? `<div class="row"><span class="label">Progress</span><span class="value">${nd.progress}%</span></div>` : ''}
    `;
    tooltip.classList.add('visible');
    moveTooltip(event);
  }

  function moveTooltip(event) {
    const margin = 12;
    const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
    let left = event.clientX + margin;
    let top  = event.clientY + margin;
    if (left + tw > window.innerWidth)  left = event.clientX - tw - margin;
    if (top  + th > window.innerHeight) top  = event.clientY - th - margin;
    tooltip.style.left = `${left}px`;
    tooltip.style.top  = `${top}px`;
  }

  function hideTooltip() {
    tooltip.classList.remove('visible');
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function truncate(str, max) {
    return str.length > max ? str.slice(0, max - 1) + '…' : str;
  }

  // ── Tab switching ─────────────────────────────────────────────────────────
  let currentTab = 'tree';

  window.switchTab = function switchTab(tab) {
    currentTab = tab;
    const container   = document.getElementById('container');
    const listView    = document.getElementById('list-view');
    const ideasPanel  = document.getElementById('ideas-panel');
    const treeBtn     = document.getElementById('tab-tree');
    const ideasBtn    = document.getElementById('tab-ideas');
    const controls    = document.getElementById('controls');
    const legend      = document.getElementById('legend');
    const legendToggle = document.getElementById('legend-toggle');
    const filterWrap  = document.getElementById('done-filter-wrap');

    // Reset all
    container.style.display = 'none';
    if (listView) listView.classList.remove('active');
    ideasPanel.classList.remove('visible');
    [treeBtn, ideasBtn].forEach(b => { if (b) { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); } });
    if (controls) controls.style.display = 'none';
    if (legend) legend.style.display = 'none';
    if (legendToggle) legendToggle.style.display = 'none';
    if (filterWrap) filterWrap.style.display = 'none';

    // Update bottom nav
    ['tree','list','ideas'].forEach(t => {
      const b = document.getElementById(`bnav-${t}`);
      if (b) b.classList.toggle('active', t === tab);
    });

    if (tab === 'tree') {
      container.style.display = '';
      if (treeBtn) { treeBtn.classList.add('active'); treeBtn.setAttribute('aria-selected', 'true'); }
      if (controls) controls.style.display = '';
      if (legend) legend.style.display = '';
      if (legendToggle) legendToggle.style.display = '';
      if (filterWrap) filterWrap.style.display = '';
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

    // Flatten all nodes from the loaded tree data
    const allNodes = [];
    function flatten(nodes) {
      nodes.forEach(n => {
        allNodes.push(n);
        if (n.children && n.children.length) flatten(n.children);
        if (n._children && n._children.length) flatten(n._children);
      });
    }

    // Use the D3 root if available
    if (window._telosRoot) {
      flatten(window._telosRoot.descendants().map(d => d.data));
    } else {
      el.innerHTML = '<p style="color:var(--text-secondary);padding:16px;font-size:12px">Load the tree first to use list view.</p>';
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

    const groupOrder = ['in_progress', 'blocked', 'in_question', 'open', 'done', 'shelved', 'rejected', 'refused', 'out_of_budget'];
    const groupLabels = {
      in_progress:  '🔵 In Progress',
      blocked:      '🔴 Blocked',
      in_question:  '🟠 In Question',
      open:         '🟡 Open',
      done:         '✅ Done',
      shelved:      '⬜ Shelved',
      rejected:     '🚫 Rejected',
      refused:      '⚫ Refused',
      out_of_budget: '💸 Out of Budget'
    };

    let html = '';
    for (const g of groupOrder) {
      const nodes = statusGroups[g];
      if (!nodes || !nodes.length) continue;
      html += `<div class="lv-group">
        <div class="lv-group-title">${groupLabels[g] || g} (${nodes.length})</div>`;
      for (const n of nodes) {
        const roi = n.roi != null ? `ROI ${parseFloat(n.roi).toFixed(0)}` : '';
        const owner = n.owner ? `· ${n.owner}` : '';
        const pct = n.progress || 0;
        const progressBar = pct > 0
          ? `<div class="lv-card-progress"><div class="lv-card-progress-fill" style="width:${pct}%"></div></div>` : '';
        const badgeClass = `badge-${n.status}`;
        html += `<div class="lv-card" onclick="openNodeDetail(${n.id})" role="listitem">
          <div class="lv-card-top">
            <div class="lv-card-title">${escHtml(n.title)}</div>
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

    el.innerHTML = html || '<p style="color:var(--text-secondary);padding:16px;font-size:12px">No tasks found.</p>';
  }

  window.openNodeDetail = function(id) {
    // Find node in D3 root and open detail panel
    if (!window._telosRoot) return;
    const desc = window._telosRoot.descendants().find(d => d.data.id === id);
    if (desc) showDetailPanel(desc);
  };

  function loadIdeas() {
    const panel = document.getElementById('ideas-panel');
    panel.innerHTML = '<p style="color:var(--text-secondary);font-size:12px;padding:8px 0">Loading…</p>';

    const cacheBuster = Date.now();
    fetch(`http://localhost:8089/api/ideas?_=${cacheBuster}`, { cache: 'no-store' })
      .then(r => {
        if (!r.ok) throw new Error(`API error: ${r.status}`);
        return r.json();
      })
      .then(data => renderIdeas(data.ideas))
      .catch(err => {
        // Fall back to static file
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
      if (list.length === 0) continue;
      html += `<div class="ideas-section">
        <h2>${label} <span class="badge">${list.length}</span> <span style="font-weight:400;font-size:10px;color:var(--text-secondary)">${desc}</span></h2>`;
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

  // ── Live data refresh ─────────────────────────────────────────────────────
  // Re-fetch /api/tree with cache-buster and re-init the tree
  window.refreshData = function refreshData() {
    const btn = document.getElementById('refresh-data-btn');
    const originalText = btn.innerText;
    btn.innerText = '↺';
    btn.disabled = true;

    const cacheBuster = Date.now();
    fetch(`http://localhost:8089/api/tree?_=${cacheBuster}`, { cache: 'no-store' })
      .then(r => {
        if (!r.ok) throw new Error(`API error: ${r.status}`);
        return r.json();
      })
      .then(data => {
        // Store raw data and apply filter
        rawTreeData = data.tree[0];
        const filtered = applyDoneFilter(JSON.parse(JSON.stringify(rawTreeData)), getCutoffSecs(doneFilterDays));

        // Replace root data
        root = d3.hierarchy(filtered, d => d.children && d.children.length ? d.children : null);
        root.x0 = height / 2;
        root.y0 = 0;

        // Collapse beyond depth 1
        root.descendants().forEach(d => {
          if (d.depth > 1) {
            d._children = d.children;
            d.children = null;
          }
        });

        gLinks.selectAll('.link').remove();
        gNodes.selectAll('.node').remove();
        update(root);
        resetView();

        btn.innerText = '✓';
        setTimeout(() => { btn.innerText = originalText; btn.disabled = false; }, 1000);
      })
      .catch(err => {
        document.getElementById('container').innerHTML =
          `<div id="error">⚠️ Could not reload data<br><small>${err.message}</small></div>`;
        btn.innerText = originalText;
        btn.disabled = false;
      });
  };
})();
