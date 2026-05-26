const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const PROJECT_INDEX_KEY = 'interview-canvas-projects';
let STORAGE_KEY = 'interview-canvas-v1'; // will be overwritten by active project
let currentProjectId = null;
const COLD_START_RATIOS = { A: 30, B: 30, C: 25, D: 15 };
const JOURNEY_LABELS = { A: 'A 拉新', B: 'B 深度', C: 'C 信任', D: 'D 社群' };
const JOURNEY_DESC = { A: '吸引新觀眾進來', B: '展現專業與深度', C: '建立真實可信度', D: '強化社群歸屬感' };
const MATERIAL_LABELS = { long: '長片', short: '短片' };
const MATERIAL_DESC = { long: '完整訪談影片', short: '短片（精華剪輯）' };
const JOB_DESC = { '吸引': '拉新觀眾進來', '培育': '加深興趣與信任', '轉換': '推動購買行動' };

const INTERVIEW_TYPES = ['深度專訪', '座談', '街訪', '技術專訪', '故事型', '快問快答', '騎乘訪談'];

// Stage → default Job mapping
const STAGE_DEFAULT_JOB = { A: '吸引', B: '培育', C: '培育', D: '吸引' };

const state = {
  currentView: 'topic',
  nodes: new Map(),
  connections: [],
  selectedNodeId: null,
  dragState: null,
  connectMode: false,
  connectFrom: null,
  pendingPosition: null,
  hoveredNodeId: null,
  topicMode: 'free',   // 'free' | 'list'
  zoomLevel: 1,
  ghostNodes: [],       // AI-suggested placeholder nodes
};

// ── Project Management ──

function getProjectList() {
  try {
    return JSON.parse(localStorage.getItem(PROJECT_INDEX_KEY)) || [];
  } catch { return []; }
}

function saveProjectList(list) {
  localStorage.setItem(PROJECT_INDEX_KEY, JSON.stringify(list));
}

function switchProject(projectId) {
  const list = getProjectList();
  const project = list.find(p => p.id === projectId);
  if (!project) return;
  currentProjectId = projectId;
  STORAGE_KEY = 'interview-canvas-' + projectId;
  // Reset state
  state.nodes = new Map();
  state.connections = [];
  state.selectedNodeId = null;
  state.ghostNodes = [];
  state.hoveredNodeId = null;
  state.topicMode = 'free';
  state.zoomLevel = 1;
  // Load this project's data
  loadProjectState();
}

function loadProjectState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) { render(); return; }
  try {
    const data = JSON.parse(raw);
    state.currentView = data.currentView || 'topic';
    state.nodes = new Map(data.nodes || []);
    state.connections = data.connections || [];
    for (const node of state.nodes.values()) {
      if (!node.aiResearch) node.aiResearch = null;
      if (!node.filmingAngles) node.filmingAngles = [];
    }
  } catch { /* corrupt data */ }
  render();
}

function createProject(name) {
  const list = getProjectList();
  const id = 'p' + Date.now();
  list.push({ id, name, createdAt: Date.now() });
  saveProjectList(list);
  switchProject(id);
  renderProjectSelect();
  return id;
}

function deleteProject(projectId) {
  let list = getProjectList();
  list = list.filter(p => p.id !== projectId);
  saveProjectList(list);
  localStorage.removeItem('interview-canvas-' + projectId);
  if (list.length === 0) {
    createProject('未命名專案');
  } else {
    switchProject(list[0].id);
  }
  renderProjectSelect();
}

function renameProject(projectId, newName) {
  const list = getProjectList();
  const p = list.find(p => p.id === projectId);
  if (p) { p.name = newName; saveProjectList(list); }
}

function renderProjectSelect() {
  const sel = $('#project-select');
  if (!sel) return;
  const list = getProjectList();
  sel.innerHTML = list.map(p =>
    `<option value="${p.id}" ${p.id === currentProjectId ? 'selected' : ''}>${esc(p.name)}</option>`
  ).join('');
}

// ── Persistence ──

function saveState() {
  const data = {
    currentView: state.currentView,
    nodes: [...state.nodes.entries()],
    connections: state.connections,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  saveToFile(data);
}

function saveToFile(data) {
  // Interview canvas saves to localStorage only; no server file
}

async function loadState() {
  let raw = localStorage.getItem(STORAGE_KEY);
  // Interview canvas uses only localStorage, no server file fallback
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    state.currentView = data.currentView || 'topic';
    state.nodes = new Map(data.nodes || []);
    state.connections = data.connections || [];
    // Migrate old material columns to new 2-column layout
    for (const node of state.nodes.values()) {
      const col = node.positions?.material?.column;
      if (col === 'longform') node.positions.material.column = 'long';
      else if (col === 'shortform' || col === 'clip') node.positions.material.column = 'short';
    }
    localStorage.setItem(STORAGE_KEY, raw);
  } catch { /* ignore corrupt data */ }
}

// ── Node CRUD ──

function createNode({ topic, job, cta, isMain, guest, interviewType }, x, y) {
  const id = 'n' + Date.now() + Math.random().toString(36).slice(2, 6);
  const node = {
    id,
    main: { topic, job: job || '', cta: cta || '' },
    guest: guest || '',
    interviewType: interviewType || '',
    user: '',
    aiSuggest: [],
    aiResearch: null,
    filmingAngles: [],
    isMain: !!isMain,
    positions: {
      topic: { x, y },
      material: { column: 'long', order: 0 },
      journey: { stage: 'A', order: 0 },
    },
    createdAt: Date.now(),
  };
  state.nodes.set(id, node);
  saveState();
  return node;
}

function deleteNode(id) {
  state.nodes.delete(id);
  state.connections = state.connections.filter(c => c.from !== id && c.to !== id);
  if (state.selectedNodeId === id) state.selectedNodeId = null;
  saveState();
}

function updateNode(id, updates) {
  const node = state.nodes.get(id);
  if (!node) return;
  if (updates.main) Object.assign(node.main, updates.main);
  if (updates.guest !== undefined) node.guest = updates.guest;
  if (updates.interviewType !== undefined) node.interviewType = updates.interviewType;
  if (updates.user !== undefined) node.user = updates.user;
  if (updates.aiSuggest) node.aiSuggest = updates.aiSuggest;
  if (updates.isMain !== undefined) node.isMain = updates.isMain;
  if (updates.positions) {
    for (const [view, pos] of Object.entries(updates.positions)) {
      Object.assign(node.positions[view], pos);
    }
  }
  saveState();
}

// ── Render ──

function render() {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === state.currentView));
  $('#node-count').textContent = `${state.nodes.size} 個節點`;
  $('#btn-connect').classList.toggle('active-mode', state.connectMode);

  const canvas = $('#canvas');
  const svg = $('#connections-svg');
  const area = $('#canvas-area');
  canvas.innerHTML = '';

  // Show/hide topic sub-toolbar
  const toolbar = $('#topic-toolbar');
  toolbar.classList.toggle('hidden', state.currentView !== 'topic');
  if (state.currentView === 'topic') {
    $$('#topic-toolbar .sub-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === state.topicMode));
    $('#zoom-level').textContent = Math.round(state.zoomLevel * 100) + '%';
    $('#zoom-controls').classList.toggle('hidden', state.topicMode !== 'free');
  }

  if (state.currentView === 'topic' && state.topicMode === 'free') {
    const z = state.zoomLevel;
    canvas.style.width = '3000px';
    canvas.style.height = '3000px';
    canvas.style.position = 'absolute';
    canvas.style.transform = `scale(${z})`;
    canvas.style.transformOrigin = '0 0';
    svg.style.display = '';
    svg.style.transform = `scale(${z})`;
    svg.style.transformOrigin = '0 0';
    area.classList.remove('list-mode');
    area.style.backgroundSize = `${24 * z}px ${24 * z}px`;
    renderTopicView(canvas);
    renderConnections(svg);
    $('#btn-add').style.display = '';
  } else if (state.currentView === 'topic' && state.topicMode === 'list') {
    canvas.style.width = '100%';
    canvas.style.height = '';
    canvas.style.position = 'relative';
    canvas.style.transform = '';
    svg.style.display = 'none';
    svg.style.transform = '';
    area.classList.add('list-mode');
    area.style.backgroundSize = '';
    renderTopicListView(canvas);
    $('#btn-add').style.display = '';
  } else {
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.position = 'relative';
    canvas.style.transform = '';
    svg.style.display = 'none';
    svg.style.transform = '';
    area.classList.remove('list-mode');
    area.style.backgroundSize = '';
    $('#btn-add').style.display = 'none';
    if (state.currentView === 'material') {
      renderMaterialView(canvas);
    } else if (state.currentView === 'journey') {
      renderJourneyView(canvas);
    }
  }

  renderPanel();
}

function renderTopicView(container) {
  for (const node of state.nodes.values()) {
    const el = buildNodeCard(node);
    const pos = node.positions.topic;
    el.style.left = pos.x + 'px';
    el.style.top = pos.y + 'px';

    // Hover → highlight only this node's connections
    el.addEventListener('mouseenter', () => {
      state.hoveredNodeId = node.id;
      highlightConnections(node.id);
    });
    el.addEventListener('mouseleave', () => {
      state.hoveredNodeId = null;
      highlightConnections(state.selectedNodeId); // keep selected node's lines lit
    });

    container.appendChild(el);
  }
}

function renderTopicListView(container) {
  const wrapper = document.createElement('div');
  wrapper.className = 'topic-list-view';

  // Build adjacency: which nodes connect to which
  const connMap = new Map();
  for (const node of state.nodes.values()) connMap.set(node.id, []);
  for (const conn of state.connections) {
    if (connMap.has(conn.from)) connMap.get(conn.from).push(conn.to);
    if (connMap.has(conn.to)) connMap.get(conn.to).push(conn.from);
  }

  // Sort: main nodes first, then by job
  const jobOrder = { '吸引': 0, '培育': 1, '轉換': 2 };
  const sorted = [...state.nodes.values()].sort((a, b) => {
    if (a.isMain !== b.isMain) return a.isMain ? -1 : 1;
    return (jobOrder[a.main.job] ?? 9) - (jobOrder[b.main.job] ?? 9);
  });

  for (const node of sorted) {
    const linked = connMap.get(node.id) || [];
    const linkedNames = linked
      .map(id => state.nodes.get(id))
      .filter(Boolean)
      .map(n => esc(n.main.topic));

    const jobClass = { '吸引': 'job-attract', '培育': 'job-nurture', '轉換': 'job-convert' }[node.main.job] || '';
    const stageLabel = JOURNEY_LABELS[node.positions.journey?.stage] || '';
    const matLabel = MATERIAL_LABELS[node.positions.material?.column] || '';

    const row = document.createElement('div');
    row.className = 'topic-list-row' + (node.isMain ? ' is-main' : '') + (node.id === state.selectedNodeId ? ' selected' : '');
    row.dataset.nodeId = node.id;
    row.innerHTML = `
      <div class="list-row-left">
        ${node.isMain ? '<span class="main-badge-sm">★</span>' : '<span class="list-row-num"></span>'}
        <div class="list-row-info">
          <div class="list-row-topic">${esc(node.main.topic)}</div>
          ${node.user ? `<div class="list-row-user">${esc(node.user).substring(0, 80)}${node.user.length > 80 ? '…' : ''}</div>` : ''}
        </div>
      </div>
      <div class="list-row-badges">
        ${node.main.job ? `<span class="job-badge ${jobClass}">${esc(node.main.job)}</span>` : ''}
        ${stageLabel ? `<span class="cross-badge">${stageLabel}</span>` : ''}
        ${matLabel ? `<span class="cross-badge">${matLabel}</span>` : ''}
      </div>
      <div class="list-row-links">
        ${linkedNames.length > 0
          ? linkedNames.map(n => `<span class="list-link-chip">↔ ${n}</span>`).join('')
          : '<span class="list-no-link">無連線</span>'}
      </div>
    `;
    row.addEventListener('click', () => selectNode(node.id));
    wrapper.appendChild(row);
  }
  container.appendChild(wrapper);
}

function renderColumnView(container, labels, viewKey, posKey) {
  const wrapper = document.createElement('div');
  wrapper.className = 'column-view';
  const crossLabels = viewKey === 'material' ? JOURNEY_LABELS : MATERIAL_LABELS;
  const crossKey = viewKey === 'material' ? 'journey' : 'material';
  const crossPosKey = viewKey === 'material' ? 'stage' : 'column';

  for (const [key, label] of Object.entries(labels)) {
    const col = document.createElement('div');
    col.className = 'column';
    const desc = (viewKey === 'material' ? MATERIAL_DESC : JOURNEY_DESC)[key] || '';
    col.innerHTML = `<div class="column-header">${label}${desc ? `<div class="column-desc">${desc}</div>` : ''}</div>`;
    col.dataset.columnKey = key;

    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const nodeId = e.dataTransfer.getData('text/plain');
      if (nodeId) {
        updateNode(nodeId, { positions: { [viewKey]: { [posKey]: key } } });
        render();
      }
    });

    const nodes = [...state.nodes.values()]
      .filter(n => n.positions[viewKey]?.[posKey] === key)
      .sort((a, b) => (a.positions[viewKey]?.order || 0) - (b.positions[viewKey]?.order || 0));

    if (viewKey === 'material' && key === 'clip') {
      const groups = new Map();
      for (const node of nodes) {
        let sourceName = '未連結來源';
        const conn = state.connections.find(c => c.to === node.id || c.from === node.id);
        if (conn) {
          const parentId = conn.from === node.id ? conn.to : conn.from;
          const parent = state.nodes.get(parentId);
          if (parent && parent.positions.material?.column === 'longform') {
            sourceName = parent.main.topic;
          }
        }
        if (!groups.has(sourceName)) groups.set(sourceName, []);
        groups.get(sourceName).push(node);
      }
      for (const [source, groupNodes] of groups) {
        const groupEl = document.createElement('div');
        groupEl.className = 'clip-group';
        groupEl.innerHTML = `<div class="clip-group-header">✂ ${esc(source)}</div>`;
        for (const node of groupNodes) {
          const crossVal = node.positions[crossKey]?.[crossPosKey];
          const crossLabel = crossLabels[crossVal] || '';
          const badge = crossLabel ? `<span class="cross-badge">${crossLabel}</span>` : '';
          const el = buildNodeCard(node, { compact: true, crossBadge: badge });
          groupEl.appendChild(el);
        }
        col.appendChild(groupEl);
      }
    } else {
      for (const node of nodes) {
        const crossVal = node.positions[crossKey]?.[crossPosKey];
        const crossLabel = crossLabels[crossVal] || '';
        const badge = crossLabel ? `<span class="cross-badge">${crossLabel}</span>` : '';
        const el = buildNodeCard(node, { compact: true, crossBadge: badge });
        col.appendChild(el);
      }
    }

    const addBtn = document.createElement('button');
    addBtn.className = 'column-add-btn';
    addBtn.textContent = '＋';
    addBtn.addEventListener('click', () => {
      state.pendingColumnAssign = { [viewKey]: { [posKey]: key } };
      const area = $('#canvas-area');
      showModal(area.clientWidth / 3, area.clientHeight / 3);
    });
    col.appendChild(addBtn);

    wrapper.appendChild(col);
  }
  container.style.position = 'relative';
  container.appendChild(wrapper);
}

function renderMaterialView(container) {
  const wrapper = document.createElement('div');
  wrapper.className = 'material-view';

  const arrowSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  arrowSvg.setAttribute('class', 'material-arrow-svg');
  arrowSvg.style.position = 'absolute';
  arrowSvg.style.top = '0';
  arrowSvg.style.left = '0';
  arrowSvg.style.pointerEvents = 'none';

  // Build defs for arrowhead
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
  marker.setAttribute('id', 'mat-arrowhead');
  marker.setAttribute('markerWidth', '8');
  marker.setAttribute('markerHeight', '6');
  marker.setAttribute('refX', '8');
  marker.setAttribute('refY', '3');
  marker.setAttribute('orient', 'auto');
  const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  polygon.setAttribute('points', '0 0, 8 3, 0 6');
  polygon.setAttribute('fill', '#64748b');
  marker.appendChild(polygon);
  defs.appendChild(marker);
  arrowSvg.appendChild(defs);

  for (const [key, label] of Object.entries(MATERIAL_LABELS)) {
    const col = document.createElement('div');
    col.className = 'column';
    const desc = MATERIAL_DESC[key] || '';
    col.innerHTML = `<div class="column-header">${label}${desc ? `<div class="column-desc">${desc}</div>` : ''}</div>`;
    col.dataset.columnKey = key;

    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const nodeId = e.dataTransfer.getData('text/plain');
      if (nodeId) {
        updateNode(nodeId, { positions: { material: { column: key } } });
        render();
      }
    });

    const nodes = [...state.nodes.values()]
      .filter(n => n.positions.material?.column === key)
      .sort((a, b) => (a.positions.material?.order || 0) - (b.positions.material?.order || 0));

    for (const node of nodes) {
      const crossVal = node.positions.journey?.stage;
      const crossLabel = JOURNEY_LABELS[crossVal] || '';
      const badge = crossLabel ? `<span class="cross-badge">${crossLabel}</span>` : '';

      // Determine if this short node is connected to a long node
      let isConnectedClip = false;
      if (key === 'short') {
        const conn = state.connections.find(c => c.to === node.id || c.from === node.id);
        if (conn) {
          const parentId = conn.from === node.id ? conn.to : conn.from;
          const parent = state.nodes.get(parentId);
          if (parent && parent.positions.material?.column === 'long') {
            isConnectedClip = true;
          }
        }
      }

      const el = buildNodeCard(node, { compact: true, crossBadge: badge });
      // Apply material-origin class for long videos and independent shorts
      if (key === 'long' || (key === 'short' && !isConnectedClip)) {
        el.classList.add('material-origin');
      }
      col.appendChild(el);
    }

    const addBtn = document.createElement('button');
    addBtn.className = 'column-add-btn';
    addBtn.textContent = '＋';
    addBtn.addEventListener('click', () => {
      state.pendingColumnAssign = { material: { column: key } };
      const area = $('#canvas-area');
      showModal(area.clientWidth / 3, area.clientHeight / 3);
    });
    col.appendChild(addBtn);

    wrapper.appendChild(col);
  }

  container.style.position = 'relative';
  container.appendChild(wrapper);
  wrapper.appendChild(arrowSvg);

  // Draw arrows after layout is computed
  requestAnimationFrame(() => {
    arrowSvg.setAttribute('width', wrapper.scrollWidth);
    arrowSvg.setAttribute('height', wrapper.scrollHeight);

    const shortNodes = [...state.nodes.values()].filter(n => n.positions.material?.column === 'short');
    for (const sNode of shortNodes) {
      const conn = state.connections.find(c => c.to === sNode.id || c.from === sNode.id);
      if (!conn) continue;
      const parentId = conn.from === sNode.id ? conn.to : conn.from;
      const parent = state.nodes.get(parentId);
      if (!parent || parent.positions.material?.column !== 'long') continue;

      const fromEl = wrapper.querySelector(`.node-card[data-node-id="${parentId}"]`);
      const toEl = wrapper.querySelector(`.node-card[data-node-id="${sNode.id}"]`);
      if (!fromEl || !toEl) continue;

      const wrapRect = wrapper.getBoundingClientRect();
      const fromRect = fromEl.getBoundingClientRect();
      const toRect = toEl.getBoundingClientRect();

      const x1 = fromRect.right - wrapRect.left;
      const y1 = fromRect.top + fromRect.height / 2 - wrapRect.top;
      const x2 = toRect.left - wrapRect.left;
      const y2 = toRect.top + toRect.height / 2 - wrapRect.top;
      const midX = (x1 + x2) / 2;

      const d = `M${x1},${y1} L${midX},${y1} L${midX},${y2} L${x2},${y2}`;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('stroke', '#64748b');
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('fill', 'none');
      path.setAttribute('marker-end', 'url(#mat-arrowhead)');
      arrowSvg.appendChild(path);
    }
  });
}

const GAP_HINTS = {
  A: '入門科普、懶人包、迷思破解',
  B: '開箱評測、規格比較、實測數據',
  C: '長期使用心得、第三方認證、用戶見證',
  D: '退換貨政策、保固說明、售後服務、滿意度回饋',
};

function renderJourneyView(container) {
  const wrapper = document.createElement('div');
  wrapper.className = 'column-view';
  const totalNodes = state.nodes.size || 1;

  for (const [key, label] of Object.entries(JOURNEY_LABELS)) {
    const col = document.createElement('div');
    col.className = 'column';

    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const nodeId = e.dataTransfer.getData('text/plain');
      if (nodeId) {
        updateNode(nodeId, { positions: { journey: { stage: key } } });
        render();
      }
    });

    const nodes = [...state.nodes.values()]
      .filter(n => n.positions.journey?.stage === key)
      .sort((a, b) => (a.positions.journey?.order || 0) - (b.positions.journey?.order || 0));

    const actual = Math.round((nodes.length / totalNodes) * 100);
    const target = COLD_START_RATIOS[key];
    const diff = actual - target;
    let healthClass = 'healthy';
    if (Math.abs(diff) > 15) healthClass = 'danger';
    else if (Math.abs(diff) > 8) healthClass = 'warning';

    const gapHtml = nodes.length === 0
      ? `<div class="gap-warning">⚠️ 缺口</div><div class="gap-hint">建議：${GAP_HINTS[key]}</div>`
      : (actual < target - 5 ? `<div class="gap-hint">可補：${GAP_HINTS[key]}</div>` : '');

    col.innerHTML = `
      <div class="column-header">${label}<div class="column-desc">${JOURNEY_DESC[key]}</div></div>
      <div class="health-bar"><div class="health-fill ${healthClass}" style="width:${Math.min(actual, 100)}%"></div></div>
      <div class="column-target">現有 ${actual}% ／目標 ${target}%</div>
      ${gapHtml}
    `;
    col.dataset.columnKey = key;

    for (const node of nodes) {
      const matCol = node.positions.material?.column;
      const matLabel = MATERIAL_LABELS[matCol] || '';
      const badge = matLabel ? `<span class="cross-badge">${matLabel}</span>` : '';
      const el = buildNodeCard(node, { compact: true, crossBadge: badge });
      col.appendChild(el);
    }

    // Render ghost nodes for this stage
    const ghosts = state.ghostNodes.filter(g => g.type === 'new-node' && g.stage === key);
    for (const ghost of ghosts) {
      const gel = document.createElement('div');
      gel.className = 'node-card compact ghost-node';
      gel.innerHTML = `
        <div class="ghost-label">🧩 AI 建議</div>
        <div class="compact-row">
          <span class="compact-topic">${esc(ghost.topic)}</span>
          <span class="job-badge ${{'吸引':'job-attract','培育':'job-nurture','轉換':'job-convert'}[ghost.job] || ''}">${esc(ghost.job)}</span>
        </div>
        <div class="ghost-reason">${esc(ghost.reason)}</div>
        <div class="ghost-actions">
          <button class="ai-action-btn adopt ghost-adopt-inline" data-ghost-id="${ghost.id}">採用</button>
          <button class="ai-action-btn dismiss ghost-dismiss-inline" data-ghost-id="${ghost.id}">跳過</button>
        </div>
      `;
      gel.querySelector('.ghost-adopt-inline').addEventListener('click', (e) => { e.stopPropagation(); adoptGhost(ghost.id); });
      gel.querySelector('.ghost-dismiss-inline').addEventListener('click', (e) => { e.stopPropagation(); dismissGhost(ghost.id); });
      col.appendChild(gel);
    }

    const addBtn = document.createElement('button');
    addBtn.className = 'column-add-btn';
    addBtn.textContent = '＋';
    addBtn.addEventListener('click', () => {
      state.pendingColumnAssign = { journey: { stage: key } };
      const area = $('#canvas-area');
      showModal(area.clientWidth / 3, area.clientHeight / 3);
    });
    col.appendChild(addBtn);

    wrapper.appendChild(col);
  }
  container.style.position = 'relative';
  container.appendChild(wrapper);
}

function buildNodeCard(node, opts = {}) {
  const compact = opts.compact || false;
  const crossBadge = opts.crossBadge || '';
  const sourceHtml = opts.sourceHtml || '';
  const el = document.createElement('div');
  el.className = 'node-card'
    + (node.isMain ? ' main-node' : '')
    + (node.id === state.selectedNodeId ? ' selected' : '')
    + (compact ? ' compact' : '');
  el.dataset.nodeId = node.id;

  const jobClass = { '吸引': 'job-attract', '培育': 'job-nurture', '轉換': 'job-convert' }[node.main.job] || '';

  if (compact) {
    el.setAttribute('draggable', 'true');
    el.innerHTML = `
      <div class="compact-row">
        ${node.isMain ? '<span class="main-badge-sm">★</span>' : ''}
        <span class="compact-topic">${esc(node.main.topic)}</span>
        ${node.main.job ? `<span class="job-badge ${jobClass}" title="${JOB_DESC[node.main.job] || ''}">${esc(node.main.job)}</span>` : ''}
      </div>
      ${node.user ? `<div class="compact-user">${esc(node.user)}</div>` : ''}
      ${sourceHtml}
      ${crossBadge ? `<div class="compact-badges">${crossBadge}</div>` : ''}
    `;
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', node.id);
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      selectNode(node.id);
    });
    return el;
  }

  el.innerHTML = `
    <div class="node-main">
      ${node.isMain ? '<span class="main-badge">主節點</span>' : ''}
      <div class="node-topic">${esc(node.main.topic)}</div>
      <div class="node-meta">
        ${node.main.job ? `<span class="job-badge ${jobClass}">${esc(node.main.job)}</span><span class="job-desc">${JOB_DESC[node.main.job] || ''}</span>` : ''}
        ${node.main.cta ? `<span class="cta-text">CTA: ${esc(node.main.cta)}</span>` : ''}
      </div>
    </div>
    <div class="node-user">
      <div class="node-user-label">USER</div>
      <div class="node-user-text ${node.user ? '' : 'empty'}" contenteditable="true" data-node-id="${node.id}">${node.user ? esc(node.user) : ''}</div>
    </div>
    ${node.aiSuggest.length > 0 ? `
    <div class="node-ai">
      <div class="node-ai-label">AI SUGGEST</div>
      <div class="ai-suggestion">
        ${node.aiSuggest.map((s, i) => `<div class="chip"><span class="chip-text">${esc(s)}</span><button class="ai-action-btn adopt" data-idx="${i}" title="採用">採用</button><button class="ai-action-btn dismiss" data-idx="${i}" title="移除">✕</button></div>`).join('')}
      </div>
    </div>` : ''}
  `;

  // AI suggestion adopt/dismiss handlers
  el.querySelectorAll('.ai-action-btn.adopt').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx, 10);
      const suggestion = node.aiSuggest[idx];
      if (suggestion == null) return;
      const newUser = node.user ? node.user + '\n' + suggestion : suggestion;
      node.user = newUser;
      node.aiSuggest.splice(idx, 1);
      saveState();
      render();
    });
  });
  el.querySelectorAll('.ai-action-btn.dismiss').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx, 10);
      if (idx >= 0 && idx < node.aiSuggest.length) {
        node.aiSuggest.splice(idx, 1);
        saveState();
        render();
      }
    });
  });

  const userEl = el.querySelector('.node-user-text');
  if (userEl) {
    userEl.setAttribute('placeholder', '備註...');
    userEl.addEventListener('focus', (e) => e.stopPropagation());
    userEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    userEl.addEventListener('blur', () => {
      const text = userEl.textContent.trim();
      if (text !== node.user) {
        updateNode(node.id, { user: text });
      }
    });
  }

  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('[contenteditable]')) return;
    onNodePointerDown(e, node.id);
  });
  el.addEventListener('click', (e) => {
    if (e.target.closest('[contenteditable]')) return;
    e.stopPropagation();
    if (state.connectMode) {
      handleConnectClick(node.id);
    } else {
      selectNode(node.id);
    }
  });

  return el;
}

function renderConnections(svg) {
  while (svg.children.length > 1) svg.removeChild(svg.lastChild);

  for (const conn of state.connections) {
    const fromNode = state.nodes.get(conn.from);
    const toNode = state.nodes.get(conn.to);
    if (!fromNode || !toNode) continue;

    const fp = fromNode.positions.topic;
    const tp = toNode.positions.topic;
    const fw = fromNode.isMain ? 280 : 240;
    const tw = toNode.isMain ? 280 : 240;
    const fEl = $(`.node-card[data-node-id="${conn.from}"]`);
    const tEl = $(`.node-card[data-node-id="${conn.to}"]`);
    const fh = fEl ? fEl.offsetHeight : 120;
    const th = tEl ? tEl.offsetHeight : 120;

    const fcx = fp.x + fw / 2, fcy = fp.y + fh / 2;
    const tcx = tp.x + tw / 2, tcy = tp.y + th / 2;

    // Calculate exit/entry points on edges
    let x1, y1, x2, y2;
    if (Math.abs(tcx - fcx) > Math.abs(tcy - fcy)) {
      if (tcx > fcx) {
        x1 = fp.x + fw + 8;  y1 = fcy;
        x2 = tp.x - 14;      y2 = tcy;
      } else {
        x1 = fp.x - 8;       y1 = fcy;
        x2 = tp.x + tw + 14; y2 = tcy;
      }
    } else {
      if (tcy > fcy) {
        x1 = fcx; y1 = fp.y + fh + 8;
        x2 = tcx; y2 = tp.y - 14;
      } else {
        x1 = fcx; y1 = fp.y - 8;
        x2 = tcx; y2 = tp.y + th + 14;
      }
    }

    const midX = (x1 + x2) / 2;
    const d = `M${x1},${y1} L${midX},${y1} L${midX},${y2} L${x2},${y2}`;

    // Determine if this connection should be highlighted
    const isActive = state.selectedNodeId === conn.from || state.selectedNodeId === conn.to
                  || state.hoveredNodeId === conn.from || state.hoveredNodeId === conn.to;

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.dataset.from = conn.from;
    g.dataset.to = conn.to;
    g.style.opacity = isActive ? '1' : '0.12';
    g.style.transition = 'opacity 0.2s';

    const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    hitArea.setAttribute('d', d);
    hitArea.setAttribute('stroke', 'transparent');
    hitArea.setAttribute('stroke-width', '16');
    hitArea.setAttribute('fill', 'none');
    hitArea.style.pointerEvents = 'stroke';
    hitArea.style.cursor = 'pointer';
    hitArea.addEventListener('click', () => {
      state.connections = state.connections.filter(c => c !== conn);
      saveState();
      render();
    });
    g.appendChild(hitArea);

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('stroke', isActive ? '#3b82f6' : '#64748b');
    path.setAttribute('stroke-width', isActive ? '2.5' : '1.5');
    path.setAttribute('fill', 'none');
    path.setAttribute('marker-end', isActive ? 'url(#arrowhead-active)' : 'url(#arrowhead)');
    path.style.pointerEvents = 'none';
    g.appendChild(path);

    svg.appendChild(g);
  }
}

function highlightConnections(nodeId) {
  const svg = $('#connections-svg');
  if (!svg) return;
  const groups = svg.querySelectorAll('g[data-from]');
  groups.forEach(g => {
    const active = nodeId && (g.dataset.from === nodeId || g.dataset.to === nodeId);
    g.style.opacity = active ? '1' : '0.12';
    const p = g.querySelector('path[stroke]:not([stroke="transparent"])');
    if (p) {
      p.setAttribute('stroke', active ? '#3b82f6' : '#64748b');
      p.setAttribute('stroke-width', active ? '2.5' : '1.5');
      p.setAttribute('marker-end', active ? 'url(#arrowhead-active)' : 'url(#arrowhead)');
    }
  });
}

function renderPanel() {
  const empty = $('#panel-empty');
  const detail = $('#panel-detail');
  const brief = $('#panel-brief');
  const review = $('#panel-review');

  if (state.selectedNodeId && state.nodes.has(state.selectedNodeId)) {
    const node = state.nodes.get(state.selectedNodeId);
    empty.classList.add('hidden');
    brief.classList.add('hidden');
    review.classList.add('hidden');
    detail.classList.remove('hidden');
    $('#panel-title').textContent = node.main.topic;

    const jobOptions = ['', '吸引', '培育', '轉換'].map(j => {
      const desc = JOB_DESC[j] ? ` — ${JOB_DESC[j]}` : '';
      return `<option value="${j}" ${node.main.job === j ? 'selected' : ''}>${j || '未指定'}${desc}</option>`;
    }).join('');

    const stageOptions = Object.entries(JOURNEY_LABELS).map(([k, v]) =>
      `<option value="${k}" ${node.positions.journey?.stage === k ? 'selected' : ''}>${v}</option>`
    ).join('');

    const matOptions = Object.entries(MATERIAL_LABELS).map(([k, v]) =>
      `<option value="${k}" ${node.positions.material?.column === k ? 'selected' : ''}>${v}</option>`
    ).join('');

    // AI research data
    const research = node.aiResearch || null;
    const angles = node.filmingAngles || [];

    const typeOptions = ['', ...INTERVIEW_TYPES].map(t =>
      `<option value="${t}" ${node.interviewType === t ? 'selected' : ''}>${t || '未指定'}</option>`
    ).join('');

    $('#panel-content').innerHTML = `
      <div class="detail-section">
        <label>訪談主題</label>
        <input type="text" id="edit-topic" value="${esc(node.main.topic)}">
      </div>

      <div class="detail-section">
        <label>來賓</label>
        <input type="text" id="edit-guest" value="${esc(node.guest || '')}" placeholder="姓名 / 身份 / 為什麼找他">
      </div>

      <div class="detail-row">
        <div class="detail-half">
          <label>訪談類型</label>
          <select id="edit-interview-type">${typeOptions}</select>
        </div>
        <div class="detail-half">
          <label>Job</label>
          <select id="edit-job">${jobOptions}</select>
        </div>
      </div>

      <div class="detail-row">
        <div class="detail-half">
          <label>階段</label>
          <select id="edit-stage">${stageOptions}</select>
        </div>
        <div class="detail-half">
          <label>素材</label>
          <select id="edit-material">${matOptions}</select>
        </div>
      </div>

      <div class="detail-row">
        <div class="detail-half">
          <label>
            <input type="checkbox" id="edit-main" ${node.isMain ? 'checked' : ''}> 主節點
          </label>
        </div>
      </div>

      <div class="detail-section">
        <label>CTA</label>
        <input type="text" id="edit-cta" value="${esc(node.main.cta)}">
      </div>

      <div class="detail-divider"></div>

      <div class="detail-section">
        <label>💬 我知道的（隨手寫）</label>
        <textarea id="edit-user" rows="3" placeholder="來賓背景、故事線索、你想聊的方向...">${esc(node.user)}</textarea>
        <button class="expand-btn" id="btn-expand">🔍 展開內容</button>
      </div>

      ${research ? `
      <div class="detail-divider"></div>
      <div class="ai-research-section">
        <label>📋 AI 訪談研究</label>
        <div class="ai-research-card">
          ${research.positioning ? `<div class="research-row"><span class="research-label">來賓定位</span><span>${esc(research.positioning)}</span></div>` : ''}
          ${research.features ? `<div class="research-row"><span class="research-label">獨家角度</span><span>${esc(research.features)}</span></div>` : ''}
          ${research.competitors ? `<div class="research-row"><span class="research-label">類似訪談</span><span>${esc(research.competitors)}</span></div>` : ''}
          ${research.audienceCares ? `<div class="research-row"><span class="research-label">觀眾想問</span><span>${esc(research.audienceCares)}</span></div>` : ''}
        </div>
      </div>
      ` : ''}

      ${angles.length > 0 ? `
      <div class="detail-divider"></div>
      <div class="ai-angles-section">
        <label>🎙️ 建議問題</label>
        ${angles.map((a, i) => `
          <div class="angle-card">
            <div class="angle-header">
              <span class="angle-num">${i + 1}</span>
              <strong>${esc(a.title)}</strong>
            </div>
            <div class="angle-reason">→ ${esc(a.why)}</div>
            ${a.howToShoot ? `<div class="angle-how">💡 ${esc(a.howToShoot)}</div>` : ''}
          </div>
        `).join('')}
        ${research?.suggestedHook ? `
        <div class="angle-card angle-hook">
          <div class="angle-header"><span class="angle-num">🎤</span><strong>建議 Hook</strong></div>
          <div class="angle-reason">「${esc(research.suggestedHook)}」</div>
        </div>` : ''}
        ${research?.suggestedCta ? `
        <div class="angle-card angle-cta">
          <div class="angle-header"><span class="angle-num">📣</span><strong>建議 CTA</strong></div>
          <div class="angle-reason">${esc(research.suggestedCta)}</div>
        </div>` : ''}
        <button class="adopt-all-btn" id="btn-adopt-research">✅ 採納研究結果到備註</button>
        <button class="expand-btn" id="btn-titles" style="margin-top:6px">🎬 YouTube 標題建議</button>
        <div id="titles-result"></div>
      </div>
      ` : ''}

      <div class="detail-divider"></div>

      <div class="detail-section">
        <label>連線</label>
        <div id="conn-list"></div>
        <div class="conn-add-row">
          <select id="conn-target"><option value="">連線到...</option></select>
          <button id="btn-add-conn" class="conn-add-btn">＋</button>
        </div>
      </div>
      ${node.aiSuggest.length > 0 ? `
        <div class="detail-section">
          <label>結構建議</label>
          ${node.aiSuggest.map((s, i) => `<div class="chip"><span class="chip-text">${esc(s)}</span><button class="ai-action-btn adopt panel-ai-adopt" data-idx="${i}" title="採用">採用</button><button class="ai-action-btn dismiss panel-ai-dismiss" data-idx="${i}" title="移除">✕</button></div>`).join('')}
        </div>
      ` : ''}
      <div class="detail-divider"></div>
      <div class="ask-section">
        <label>💬 針對這個節點提問</label>
        <div class="ask-input-row">
          <input type="text" id="ask-node-input" class="ask-input" placeholder="例：這個主題的 CTA 怎麼寫比較好？">
          <button id="ask-node-btn" class="ask-send-btn">送出</button>
        </div>
        <div id="ask-node-result"></div>
      </div>
      <div class="detail-actions">
        <button class="delete-btn" id="btn-delete-node">刪除</button>
        <button class="save-btn" id="btn-save-node">儲存</button>
      </div>
    `;

    $('#btn-save-node').addEventListener('click', () => {
      updateNode(node.id, {
        main: {
          topic: $('#edit-topic').value,
          job: $('#edit-job').value,
          cta: $('#edit-cta').value,
        },
        guest: $('#edit-guest').value,
        interviewType: $('#edit-interview-type').value,
        user: $('#edit-user').value,
        isMain: $('#edit-main').checked,
        positions: {
          journey: { stage: $('#edit-stage').value },
          material: { column: $('#edit-material').value },
        },
      });
      render();
    });

    $('#btn-delete-node').addEventListener('click', () => {
      if (confirm('刪除此節點？')) {
        deleteNode(node.id);
        render();
      }
    });

    const connList = $('#conn-list');
    const connTarget = $('#conn-target');
    const linked = state.connections
      .filter(c => c.from === node.id || c.to === node.id)
      .map(c => {
        const otherId = c.from === node.id ? c.to : c.from;
        const other = state.nodes.get(otherId);
        return other ? { id: otherId, topic: other.main.topic, conn: c } : null;
      })
      .filter(Boolean);

    if (linked.length === 0) {
      connList.innerHTML = '<div class="conn-empty">尚無連線</div>';
    } else {
      connList.innerHTML = linked.map(l =>
        `<div class="conn-item"><span>↔ ${esc(l.topic)}</span><button class="conn-remove" data-from="${l.conn.from}" data-to="${l.conn.to}">✕</button></div>`
      ).join('');
      connList.querySelectorAll('.conn-remove').forEach(btn => {
        btn.addEventListener('click', () => {
          state.connections = state.connections.filter(c =>
            !(c.from === btn.dataset.from && c.to === btn.dataset.to)
          );
          saveState();
          render();
        });
      });
    }

    const otherNodes = [...state.nodes.values()].filter(n =>
      n.id !== node.id && !linked.some(l => l.id === n.id)
    );
    for (const other of otherNodes) {
      const opt = document.createElement('option');
      opt.value = other.id;
      opt.textContent = other.main.topic;
      connTarget.appendChild(opt);
    }
    $('#btn-add-conn').addEventListener('click', () => {
      const targetId = connTarget.value;
      if (!targetId) return;
      state.connections.push({ from: node.id, to: targetId });
      saveState();
      render();
    });

    // Expand content button — calls API (or mock for now)
    $('#btn-expand')?.addEventListener('click', async () => {
      const btn = $('#btn-expand');
      const userText = $('#edit-user').value;
      const topic = $('#edit-topic').value;
      btn.textContent = '🔄 查詢中...';
      btn.disabled = true;

      try {
        const result = await expandContent(topic, userText, node.main.job, node.guest, node.interviewType);
        if (result) {
          node.aiResearch = result.research;
          node.filmingAngles = result.angles;
          saveState();
          renderPanel();
        }
      } catch (err) {
        console.error('Expand failed:', err);
        btn.textContent = '❌ 查詢失敗，再試一次';
        btn.disabled = false;
      }
    });

    // Adopt research results into user notes
    $('#btn-adopt-research')?.addEventListener('click', () => {
      const parts = [];
      if (node.aiResearch) {
        const r = node.aiResearch;
        if (r.positioning) parts.push(`定位：${r.positioning}`);
        if (r.features) parts.push(`特色：${r.features}`);
        if (r.competitors) parts.push(`競品：${r.competitors}`);
      }
      if (node.filmingAngles?.length > 0) {
        parts.push('拍攝方向：');
        node.filmingAngles.forEach((a, i) => {
          parts.push(`${i + 1}. ${a.title} → ${a.why}`);
        });
      }
      if (node.aiResearch?.suggestedHook) {
        parts.push(`Hook：${node.aiResearch.suggestedHook}`);
      }
      if (node.aiResearch?.suggestedCta) {
        node.main.cta = node.aiResearch.suggestedCta;
      }
      node.user = node.user ? node.user + '\n\n' + parts.join('\n') : parts.join('\n');
      saveState();
      renderPanel();
    });

    // YouTube title suggestions
    $('#btn-titles')?.addEventListener('click', async () => {
      const btn = $('#btn-titles');
      const container = $('#titles-result');
      btn.disabled = true;
      btn.textContent = '🎬 產生中...';
      const result = await aiTitles(node.id);
      btn.disabled = false;
      btn.textContent = '🎬 YouTube 標題建議';
      if (result?.options) {
        container.innerHTML = result.options.map((opt, i) => `
          <div class="angle-card" style="margin-top:8px">
            <div class="angle-header"><span class="angle-num">${i + 1}</span><strong>${esc(opt.title)}</strong></div>
            ${opt.subtitle ? `<div class="angle-reason" style="font-size:11px;color:#94a3b8">${esc(opt.subtitle)}</div>` : ''}
            <div class="angle-reason">縮圖文字：<strong>${esc(opt.thumbnail)}</strong></div>
            <div class="angle-how">📸 ${esc(opt.thumbnailDesc)}</div>
          </div>
        `).join('');
      }
    });

    // Node-specific ask
    $('#ask-node-btn')?.addEventListener('click', async () => {
      const input = $('#ask-node-input');
      const q = input.value.trim();
      if (!q) return;
      const btn = $('#ask-node-btn');
      btn.disabled = true;
      btn.textContent = '⏳';
      const result = await aiAsk(q, node.id);
      btn.disabled = false;
      btn.textContent = '送出';
      if (result) renderAskResult($('#ask-node-result'), result);
    });
    $('#ask-node-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('#ask-node-btn')?.click();
    });

    // Panel AI suggestion adopt/dismiss
    $$('.panel-ai-adopt').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        const suggestion = node.aiSuggest[idx];
        if (suggestion == null) return;
        node.user = node.user ? node.user + '\n' + suggestion : suggestion;
        node.aiSuggest.splice(idx, 1);
        saveState();
        render();
      });
    });
    $$('.panel-ai-dismiss').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        if (idx >= 0 && idx < node.aiSuggest.length) {
          node.aiSuggest.splice(idx, 1);
          saveState();
          render();
        }
      });
    });
  } else if (!review.classList.contains('hidden')) {
    // Keep review panel open if it's showing
    empty.classList.add('hidden');
    detail.classList.add('hidden');
    brief.classList.add('hidden');
  } else {
    empty.classList.remove('hidden');
    detail.classList.add('hidden');
    brief.classList.add('hidden');
    review.classList.add('hidden');
  }
}

function selectNode(id) {
  state.selectedNodeId = id;
  render();
}

// ── Drag ──

function onNodePointerDown(e, nodeId) {
  if (state.connectMode || e.button !== 0) return;
  if (state.currentView !== 'topic') return;

  const node = state.nodes.get(nodeId);
  if (!node) return;

  state.dragState = {
    nodeId,
    startX: e.clientX,
    startY: e.clientY,
    origX: node.positions.topic.x,
    origY: node.positions.topic.y,
    moved: false,
  };

  document.addEventListener('pointermove', onDragMove);
  document.addEventListener('pointerup', onDragEnd);
  e.preventDefault();
}

function onDragMove(e) {
  const ds = state.dragState;
  if (!ds) return;

  const z = state.zoomLevel;
  const dx = (e.clientX - ds.startX) / z;
  const ddy = (e.clientY - ds.startY) / z;

  if (!ds.moved && Math.abs(dx) + Math.abs(ddy) < 4) return;
  ds.moved = true;

  const newX = Math.max(0, ds.origX + dx);
  const newY = Math.max(0, ds.origY + ddy);

  const el = $(`.node-card[data-node-id="${ds.nodeId}"]`);
  if (el) {
    el.classList.add('dragging');
    el.style.left = newX + 'px';
    el.style.top = newY + 'px';
  }

  const node = state.nodes.get(ds.nodeId);
  if (node) {
    node.positions.topic.x = newX;
    node.positions.topic.y = newY;
  }
  renderConnections($('#connections-svg'));
}

function resolveCollisions(nodeId) {
  const node = state.nodes.get(nodeId);
  if (!node) return;
  const el = $(`.node-card[data-node-id="${nodeId}"]`);
  const w = el ? el.offsetWidth : (node.isMain ? 280 : 240);
  const h = el ? el.offsetHeight : 120;
  const pad = 10;

  for (let iter = 0; iter < 10; iter++) {
    let collided = false;
    for (const other of state.nodes.values()) {
      if (other.id === nodeId) continue;
      const oEl = $(`.node-card[data-node-id="${other.id}"]`);
      const ow = oEl ? oEl.offsetWidth : (other.isMain ? 280 : 240);
      const oh = oEl ? oEl.offsetHeight : 120;
      const op = other.positions.topic;
      const np = node.positions.topic;

      const overlapX = (np.x + w + pad) > op.x && np.x < (op.x + ow + pad);
      const overlapY = (np.y + h + pad) > op.y && np.y < (op.y + oh + pad);

      if (overlapX && overlapY) {
        // Push right by overlap width + 20px
        node.positions.topic.x = op.x + ow + 20;
        collided = true;
        break;
      }
    }
    if (!collided) break;
  }

  if (el) {
    el.style.left = node.positions.topic.x + 'px';
    el.style.top = node.positions.topic.y + 'px';
  }
}

function onDragEnd() {
  const ds = state.dragState;
  if (ds) {
    const el = $(`.node-card[data-node-id="${ds.nodeId}"]`);
    if (el) el.classList.remove('dragging');
    if (ds.moved) {
      resolveCollisions(ds.nodeId);
      saveState();
      renderConnections($('#connections-svg'));
    }
  }
  state.dragState = null;
  document.removeEventListener('pointermove', onDragMove);
  document.removeEventListener('pointerup', onDragEnd);
}

// ── Connections ──

function handleConnectClick(nodeId) {
  if (!state.connectFrom) {
    state.connectFrom = nodeId;
  } else if (state.connectFrom !== nodeId) {
    const exists = state.connections.some(
      c => (c.from === state.connectFrom && c.to === nodeId) || (c.from === nodeId && c.to === state.connectFrom)
    );
    if (!exists) {
      state.connections.push({ from: state.connectFrom, to: nodeId });
      saveState();
    }
    state.connectFrom = null;
    state.connectMode = false;
    render();
  }
}

// ── Content Expansion (API or Mock) ──

async function generateScript(node) {
  // Try real API first
  try {
    const res = await fetch('/api/script', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: node.main.topic,
        job: node.main.job,
        cta: node.main.cta,
        angles: node.filmingAngles,
        research: node.aiResearch,
        user: node.user,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.script) return data.script;
    }
  } catch { /* fall through */ }

  // Mock script generation
  return mockScript(node);
}

function mockScript(node) {
  const angles = node.filmingAngles || [];
  const hook = node.aiResearch?.suggestedHook || node.main.topic;
  const cta = node.main.cta || '留言分享你的想法';

  const lines = [];
  lines.push(`【${node.main.topic}】腳本大綱`);
  lines.push('');
  lines.push(`[00:00-00:05] Hook`);
  lines.push(`  「${hook}」`);
  lines.push(`  畫面：產品特寫 → 快速切換使用場景`);
  lines.push('');

  let timeStart = 5;
  angles.forEach((a, i) => {
    const duration = i === 0 ? 40 : 30;
    const end = timeStart + duration;
    const mm1 = String(Math.floor(timeStart / 60)).padStart(2, '0');
    const ss1 = String(timeStart % 60).padStart(2, '0');
    const mm2 = String(Math.floor(end / 60)).padStart(2, '0');
    const ss2 = String(end % 60).padStart(2, '0');
    lines.push(`[${mm1}:${ss1}-${mm2}:${ss2}] 段落 ${i + 1}：${a.title}`);
    lines.push(`  重點：${a.why}`);
    if (a.howToShoot) lines.push(`  拍法：${a.howToShoot}`);
    lines.push(`  旁白：（待撰寫）`);
    lines.push('');
    timeStart = end;
  });

  const mm = String(Math.floor(timeStart / 60)).padStart(2, '0');
  const ss = String(timeStart % 60).padStart(2, '0');
  lines.push(`[${mm}:${ss}-結尾] 總結 + CTA`);
  lines.push(`  「${cta}」`);
  lines.push(`  畫面：產品全貌 + 資訊欄連結提示`);

  return lines.join('\n');
}

async function expandContent(topic, userNotes, job, guest, interviewType) {
  // Try real API first, fall back to mock
  try {
    const res = await fetch('/api/interview-expand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, userNotes, job, guest, interviewType }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.research) return data;
    }
  } catch (e) { /* fall through to mock */ }

  // Mock: simulate API response for testing
  return mockExpand(topic, userNotes);
}

function mockExpand(topic, userNotes) {
  // Generic interview mock
  return {
    research: {
      positioning: `來賓能以第一人稱分享「${topic}」的實戰經驗，為觀眾提供可信的參考`,
      features: `來賓在這個領域有獨到見解，能講出一般人不知道的內幕或故事`,
      competitors: `YouTube 繁中搜「${topic} 訪談」前十名多為簡短片段，缺少深度對談`,
      audienceCares: '來賓的真實經歷、具體建議、踩過的坑、推薦的做法',
      suggestedHook: `他騎了十年的經驗，濃縮成這幾句話`,
      suggestedCta: `你也有類似的經驗嗎？留言分享你的故事`,
    },
    angles: [
      { title: '你怎麼開始騎車的？', why: '起源故事最容易引起共鳴', howToShoot: '暖場題，讓來賓放鬆，鏡頭帶到他的車或裝備' },
      { title: '騎車這些年最大的教訓是什麼？', why: '失敗經驗比成功更有學習價值，觀眾愛看', howToShoot: '情緒高點題，給來賓時間思考，不要急著接話' },
      { title: '給新手騎士一個最重要的建議？', why: '具體可執行的建議最適合剪短影音', howToShoot: '收尾題，答案通常簡短有力，適合做 Cold Open' },
    ],
  };
}

// ── API ──

async function fetchSuggestion(nodeId) {
  const node = state.nodes.get(nodeId);
  if (!node) return;
  try {
    const res = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'suggest',
        topic: node.main.topic,
        job: node.main.job,
        cta: node.main.cta,
      }),
    });
    const data = await res.json();
    if (data.result) {
      const suggestions = data.result.split('\n').map(s => s.trim()).filter(Boolean);
      updateNode(nodeId, { aiSuggest: suggestions });
      render();
    }
  } catch (err) {
    console.error('AI suggest failed:', err);
  }
}

// ── AI: Ask (global or node-specific) ──
async function aiAsk(question, focusNodeId) {
  const nodes = [...state.nodes.values()].map(n => ({
    id: n.id, topic: n.main.topic, job: n.main.job, cta: n.main.cta,
    guest: n.guest || '', interviewType: n.interviewType || '',
    stage: n.positions.journey?.stage, isMain: n.isMain,
    hook: n.aiResearch?.suggestedHook || '',
    user: n.user || '',
    angles: (n.filmingAngles || []).map(a => a.title).join('、'),
  }));
  const connections = state.connections.map(c => ({
    fromTopic: state.nodes.get(c.from)?.main.topic || '?',
    toTopic: state.nodes.get(c.to)?.main.topic || '?',
  }));
  const context = { nodes, connections };
  if (focusNodeId) {
    const fn = state.nodes.get(focusNodeId);
    if (fn) context.focusNode = { id: fn.id, topic: fn.main.topic };
  }
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, context }),
  });
  if (!res.ok) throw new Error('API error');
  return await res.json();
}

function executeAction(action) {
  if (action.type === 'update') {
    const node = state.nodes.get(action.nodeId);
    if (node && action.field && action.value) {
      if (action.field === 'job') node.main.job = action.value;
      else if (action.field === 'cta') node.main.cta = action.value;
      else if (action.field === 'topic') node.main.topic = action.value;
      saveState(); render();
    }
  } else if (action.type === 'connect') {
    const exists = state.connections.some(c =>
      (c.from === action.fromId && c.to === action.toId) ||
      (c.from === action.toId && c.to === action.fromId)
    );
    if (!exists && state.nodes.has(action.fromId) && state.nodes.has(action.toId)) {
      state.connections.push({ from: action.fromId, to: action.toId });
      saveState(); render();
    }
  } else if (action.type === 'move-stage') {
    const node = state.nodes.get(action.nodeId);
    if (node && action.stage) {
      node.positions.journey = { ...node.positions.journey, stage: action.stage };
      saveState(); render();
    }
  } else if (action.type === 'new-node') {
    const count = state.nodes.size;
    const x = 60 + (count % 4) * 280;
    const y = 60 + Math.floor(count / 4) * 220;
    createNode({ topic: action.topic, job: action.job || '', cta: '', isMain: false }, x, y);
    const node = [...state.nodes.values()].find(n => n.main.topic === action.topic);
    if (node && action.stage) node.positions.journey = { stage: action.stage };
    saveState(); render();
  }
}

function renderAskResult(container, result) {
  let html = `<div class="ask-answer">${esc(result.answer)}</div>`;
  if (result.actions?.length > 0) {
    html += `<div class="ask-actions">`;
    result.actions.forEach((a, i) => {
      html += `<button class="ai-action-btn adopt ask-action-btn" data-action-idx="${i}">${esc(a.label || '套用')}</button>`;
    });
    html += `</div>`;
  }
  container.innerHTML = html;
  container.querySelectorAll('.ask-action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.actionIdx, 10);
      const action = result.actions[idx];
      if (action) {
        executeAction(action);
        btn.textContent = '✅ 已套用';
        btn.disabled = true;
      }
    });
  });
}

// ── AI: Auto-classify node ──
async function aiClassifyNode(node) {
  try {
    const res = await fetch('/api/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: node.main.topic, userNotes: node.user || '' }),
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.job && !node.main.job) node.main.job = data.job;
    if (data.cta && !node.main.cta) node.main.cta = data.cta;
    if (data.stage) node.positions.journey = { ...node.positions.journey, stage: data.stage };
    saveState();
    render();
    if (state.selectedNodeId === node.id) renderPanel(node.id);
  } catch { /* silent fail */ }
}

// ── AI: YouTube title suggestions ──
async function aiTitles(nodeId) {
  const node = state.nodes.get(nodeId);
  if (!node) return;
  try {
    const res = await fetch('/api/titles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: node.main.topic,
        hook: node.aiResearch?.suggestedHook,
        angles: node.filmingAngles,
        research: node.aiResearch,
        job: node.main.job,
      }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// ── AI: Brief polish ──
async function aiBriefPolish(topic, fields) {
  try {
    const res = await fetch('/api/interview-brief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, fields }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// ── AI Puzzle: Rule-based Canvas Analyzer ──

function analyzeCanvas() {
  const nodes = [...state.nodes.values()];
  if (nodes.length === 0) return [];

  const suggestions = [];
  const totalNodes = nodes.length;

  // Extract themes/products from TITLES only (not user notes, to avoid false matches)
  const existingTopics = nodes.map(n => n.main.topic);
  const titleText = nodes.map(n => n.main.topic).join(' ');
  const productKeywords = [];
  const themeKeywords = ['背包', '安全帽', '手套', '護具', '防水包'];
  const brandKeywords = ['Alpaka', 'Boblbee', 'Stream Trail'];
  for (const kw of [...brandKeywords, ...themeKeywords]) {
    if (titleText.includes(kw) && !productKeywords.includes(kw)) productKeywords.push(kw);
  }
  const brandNames = productKeywords.filter(k => brandKeywords.includes(k));
  const themeWord = productKeywords.find(k => themeKeywords.includes(k)) || '裝備';

  // ── Layer 0: Incomplete nodes (auto-complete) ──
  for (const node of nodes) {
    const missing = [];
    if (!node.main.job) missing.push('job');
    if (!node.main.cta) missing.push('cta');

    if (missing.length > 0) {
      // Infer best Job from topic content
      let suggestedJob = '';
      let suggestedStage = node.positions.journey?.stage || 'A';
      const t = node.main.topic;
      if (t.match(/入門|新手|懶人|科普|怎麼選|分.*種|類型/)) {
        suggestedJob = '吸引'; suggestedStage = 'A';
      } else if (t.match(/評測|開箱|比較|對決|規格|評比|vs/i)) {
        suggestedJob = '培育'; suggestedStage = 'B';
      } else if (t.match(/心得|磨損|使用|回饋|見證|認證|實測/)) {
        suggestedJob = '轉換'; suggestedStage = 'C';
      } else if (t.match(/買|通路|比價|保固|退換|保養|售後/)) {
        suggestedJob = '轉換'; suggestedStage = 'D';
      } else if (t.match(/精華|剪輯|60秒|短/)) {
        suggestedJob = '吸引'; suggestedStage = 'A';
      }

      // Infer CTA
      let suggestedCta = '';
      if (suggestedJob === '吸引') suggestedCta = '看完整影片';
      else if (suggestedJob === '培育') suggestedCta = '留言你最在意的功能';
      else if (suggestedJob === '轉換') suggestedCta = '連結在資訊欄';

      const fills = {};
      if (!node.main.job && suggestedJob) fills.job = suggestedJob;
      if (!node.main.cta && suggestedCta) fills.cta = suggestedCta;

      if (Object.keys(fills).length > 0 || (node.positions.journey?.stage === 'A' && suggestedStage !== 'A' && !node.main.job)) {
        suggestions.push({
          id: 'ghost_fill_' + node.id,
          type: 'auto-fill',
          nodeId: node.id,
          nodeTopic: node.main.topic,
          fills,
          suggestedStage,
          reason: `「${node.main.topic}」的內容像是${suggestedJob === '吸引' ? '入門認知型' : suggestedJob === '培育' ? '評估比較型' : '信任轉換型'}影片，建議 Job 設為「${suggestedJob}」，放在 ${JOURNEY_LABELS[suggestedStage]}`,
        });
      }
    }
  }

  // ── Layer 0.3: Promotion / event ripple ──
  // Detect promotion-type nodes — TITLE ONLY (user notes may have false matches like "外送")
  const promoPatterns = /贈品|優惠|限定|折扣|免費|加碼|前\d+名|限量|促銷|送[^\s達出外寄]|^送/;
  const promoNodes = nodes.filter(n => promoPatterns.test(n.main.topic));

  for (const promo of promoNodes) {
    // Find which brand/product this promotion is about
    const promoBrands = brandKeywords.filter(k => promo.main.topic.includes(k) || (promo.user || '').includes(k));
    const promoTheme = themeKeywords.find(k => promo.main.topic.includes(k) || (promo.user || '').includes(k));

    // Find related nodes that should mention this promotion
    for (const node of nodes) {
      if (node.id === promo.id) continue;

      // Check if this node is about the same brand/theme
      const sameBrand = promoBrands.some(k => node.main.topic.includes(k));
      const sameTheme = promoTheme && node.main.topic.includes(promoTheme);
      if (!sameBrand && !sameTheme) continue;

      // Check if the node's CTA or user notes already mention THIS specific promotion
      const nodeText = (node.main.cta || '') + ' ' + (node.user || '');
      const alreadyMentioned = nodeText.includes('搭配活動') || nodeText.includes(promo.main.topic.substring(0, 15));
      if (alreadyMentioned) continue;

      // Suggest updating this node — extract a concise promo label for CTA
      const promoTitle = promo.main.topic;
      // Try to extract the core offer (e.g. "前30名送 Hub Keychain 鑰匙圈")
      const offerMatch = promoTitle.match(/(前\d+名.{2,25}|送.{2,20}|贈品.{0,15}|優惠.{0,15}|折扣.{0,15}|免費.{0,15}|限量.{0,15})/);
      const promoLabel = offerMatch ? offerMatch[1].replace(/[（(].*/,'').trim() : promoTitle.substring(0, 20);
      suggestions.push({
        id: 'ghost_update_' + node.id + '_' + promo.id,
        type: 'update',
        nodeId: node.id,
        nodeTopic: node.main.topic,
        promoId: promo.id,
        promoTopic: promoTitle,
        suggestedCtaAppend: `（${promoLabel}）`,
        suggestedUserAppend: `🎁 搭配活動：${promoTitle}${promo.user ? ' — ' + promo.user.substring(0, 50) : ''}`,
        reason: `「${node.main.topic}」跟促銷活動「${promoTitle}」是同品牌／同主題，CTA 和內容應該提到這個活動來推動轉換`,
      });
    }
  }

  // ── Layer 0.5: Restructure suggestions ──
  // Detect when a non-main node looks like a broader framework that should be the main
  const currentMain = nodes.find(n => n.isMain);
  if (currentMain) {
    const frameworkPatterns = /分.*種|類型|完整解析|怎麼選|入門|總覽|指南|懶人包|科普/;
    const specificPatterns = /評測|開箱|心得|磨損|回饋|比價|保固|精華|剪輯/;

    for (const node of nodes) {
      if (node.isMain || node.id === currentMain.id) continue;

      const nodeIsFramework = frameworkPatterns.test(node.main.topic);
      const mainIsSpecific = specificPatterns.test(currentMain.main.topic);

      if (nodeIsFramework && mainIsSpecific) {
        // This node looks broader than the current main
        // Check if the main node's product is a subset of this node's framework
        const mainBrands = brandKeywords.filter(k => currentMain.main.topic.includes(k));
        const nodeCoversTheme = themeKeywords.some(k => node.main.topic.includes(k));

        if (nodeCoversTheme || node.main.topic.length < currentMain.main.topic.length) {
          suggestions.push({
            id: 'ghost_restructure_' + node.id,
            type: 'restructure',
            newMainId: node.id,
            newMainTopic: node.main.topic,
            oldMainId: currentMain.id,
            oldMainTopic: currentMain.main.topic,
            suggestedNewMainStage: 'A',
            suggestedNewMainJob: '培育',
            suggestedOldMainStage: 'B',
            reason: `「${node.main.topic}」是總覽型內容，適合作為主節點引導觀眾進入整個系列。原本的「${currentMain.main.topic}」則變成系列中的一支細節影片，放在 B 評估階段`,
          });
        }
      }
    }
  }

  // ── Layer 1: Connection suggestions for orphan nodes ──
  // Only suggest connections for nodes that have ZERO connections (orphans)
  const connectedIds = new Set();
  for (const c of state.connections) { connectedIds.add(c.from); connectedIds.add(c.to); }

  const orphans = nodes.filter(n => !connectedIds.has(n.id));
  const connectedNodes = nodes.filter(n => connectedIds.has(n.id));

  for (const orphan of orphans) {
    // Find the best match among connected nodes by keyword overlap
    let bestMatch = null;
    let bestScore = 0;
    let bestKeywords = [];

    for (const other of connectedNodes.length > 0 ? connectedNodes : nodes.filter(n => n.id !== orphan.id)) {
      if (other.id === orphan.id) continue;
      const aWords = orphan.main.topic.split(/[\s：、—\-（）]+/).filter(w => w.length >= 2);
      const bWords = other.main.topic.split(/[\s：、—\-（）]+/).filter(w => w.length >= 2);
      const shared = aWords.filter(w => bWords.some(bw => bw.includes(w) || w.includes(bw)));
      const sharedBrands = brandKeywords.filter(k => orphan.main.topic.includes(k) && other.main.topic.includes(k));
      const score = shared.length + sharedBrands.length * 2 + (other.isMain ? 3 : 0);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = other;
        bestKeywords = [...new Set([...shared, ...sharedBrands])].slice(0, 3);
      }
    }

    if (bestMatch && bestScore >= 1) {
      const fromNode = bestMatch.isMain ? bestMatch : orphan;
      const toNode = fromNode === bestMatch ? orphan : bestMatch;
      suggestions.push({
        id: 'ghost_conn_orphan_' + orphan.id,
        type: 'connection',
        fromId: fromNode.id,
        toId: toNode.id,
        fromTopic: fromNode.main.topic,
        toTopic: toNode.main.topic,
        reason: `「${orphan.main.topic}」目前沒有連到任何節點${bestKeywords.length > 0 ? `，跟「${bestKeywords.join('、')}」相關` : ''}，建議連到「${bestMatch.main.topic}」`,
      });
    }
  }

  // ── Layer 1: Stage gap analysis ──
  const stageNodes = { A: [], B: [], C: [], D: [] };
  for (const n of nodes) {
    const s = n.positions.journey?.stage;
    if (s && stageNodes[s]) stageNodes[s].push(n);
  }

  const stageTemplates = {
    A: [
      { tpl: (th) => `${th}新手常犯的 5 個錯誤`, job: '吸引', material: 'short', reason: 'A 認知階段缺內容，需要入門向吸引新觀眾' },
      { tpl: (th) => `一分鐘搞懂${th}怎麼選`, job: '吸引', material: 'short', reason: '短秒數科普片適合拉新流量' },
    ],
    B: [
      { tpl: (th, brands) => brands.length >= 2 ? `${brands.slice(0, 2).join(' vs ')} 規格實測對決` : `${th}三大品牌橫向評比`, job: '培育', material: 'long', reason: 'B 評估階段需要比較型內容幫觀眾做選擇' },
      { tpl: (th) => `${th}隱藏規格解讀：廠商不會告訴你的事`, job: '培育', material: 'long', reason: '深度分析建立專業形象' },
    ],
    C: [
      { tpl: (th, brands) => brands.length > 0 ? `${brands[0]} 30天通勤真實磨損紀錄` : `${th}一個月使用心得老實說`, job: '轉換', material: 'long', reason: 'C 信任階段需要長期使用驗證，讓觀眾相信你不是業配' },
      { tpl: (th) => `三位車友的${th}真實使用回饋`, job: '培育', material: 'short', reason: '第三方用戶見證比自己說更有說服力' },
      { tpl: (th) => `${th}安全認證科普：CE/EN 標準到底在驗什麼`, job: '培育', material: 'short', reason: '專業認證內容建立信任' },
    ],
    D: [
      { tpl: (th) => `${th}哪裡買最划算？通路比價＋注意事項`, job: '轉換', material: 'short', reason: 'D 安心階段幫觀眾消除最後購買猶豫' },
      { tpl: (th, brands) => brands.length > 0 ? `${brands.join('／')} 保固售後完整比較` : `${th}退換貨＆保固完整指南`, job: '轉換', material: 'short', reason: '售後保障資訊降低購買風險感' },
      { tpl: (th) => `買了${th}之後你該知道的保養技巧`, job: '轉換', material: 'short', reason: '購後服務內容讓觀眾安心下單' },
    ],
  };

  for (const [stage, stageNodeList] of Object.entries(stageNodes)) {
    const actual = Math.round((stageNodeList.length / totalNodes) * 100);
    const target = COLD_START_RATIOS[stage];
    const deficit = target - actual;

    if (deficit > 5 || stageNodeList.length === 0) {
      // How many to suggest
      const count = stageNodeList.length === 0 ? 2 : 1;
      const templates = stageTemplates[stage] || [];

      // Filter out templates that overlap with existing topics
      const available = templates.filter(t => {
        const title = t.tpl(themeWord, brandNames);
        return !existingTopics.some(et => {
          const overlap = title.split('').filter(c => et.includes(c)).length;
          return overlap > title.length * 0.5;
        });
      });

      for (let i = 0; i < Math.min(count, available.length); i++) {
        const tmpl = available[i];
        const topic = tmpl.tpl(themeWord, brandNames);
        suggestions.push({
          id: 'ghost_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
          type: 'new-node',
          topic,
          job: tmpl.job,
          cta: '',
          stage,
          material: tmpl.material,
          reason: tmpl.reason,
          deficit: `${JOURNEY_LABELS[stage]} 現有 ${actual}%，目標 ${target}%`,
        });
      }
    }
  }

  // ── Layer 3: Missing clips from long videos ──
  const longNodes = nodes.filter(n => n.positions.material?.column === 'long');
  for (const ln of longNodes) {
    const hasClip = state.connections.some(c => {
      const otherId = c.from === ln.id ? c.to : c.from;
      const other = state.nodes.get(otherId);
      return other && other.positions.material?.column === 'short';
    });
    if (!hasClip) {
      suggestions.push({
        id: 'ghost_clip_' + ln.id,
        type: 'new-node',
        topic: `${ln.main.topic.substring(0, 15)}… 精華剪輯`,
        job: '吸引',
        cta: '看完整評測',
        stage: 'A',
        material: 'short',
        reason: `「${ln.main.topic}」是長片但沒有對應的短片剪輯，少了短影音導流入口`,
        connectTo: ln.id,
      });
    }
  }

  return suggestions;
}

async function runGlobalReview() {
  const suggestions = analyzeCanvas();
  state.ghostNodes = suggestions;
  render();
  showReviewPanel(suggestions, null);

  // Try AI review in parallel
  try {
    const nodes = [...state.nodes.values()].map(n => ({
      topic: n.main.topic, job: n.main.job, cta: n.main.cta,
      stage: n.positions.journey?.stage, isMain: n.isMain,
      hook: n.aiResearch?.suggestedHook || '',
      angles: (n.filmingAngles || []).map(a => a.title).join('、'),
    }));
    const connections = state.connections.map(c => ({
      fromTopic: state.nodes.get(c.from)?.main.topic || '?',
      toTopic: state.nodes.get(c.to)?.main.topic || '?',
    }));
    const res = await fetch('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodes, connections }),
    });
    if (res.ok) {
      const aiReview = await res.json();
      showReviewPanel(suggestions, aiReview);
    }
  } catch { /* AI review unavailable, rule-based still shown */ }
}

function showReviewPanel(suggestions, aiReview) {
  const empty = $('#panel-empty');
  const detail = $('#panel-detail');
  const brief = $('#panel-brief');
  const review = $('#panel-review');

  empty.classList.add('hidden');
  detail.classList.add('hidden');
  brief.classList.add('hidden');
  review.classList.remove('hidden');
  state.selectedNodeId = null;

  if (suggestions.length === 0) {
    $('#review-content').innerHTML = `
      <div class="review-perfect">
        <div class="review-perfect-icon">✅</div>
        <div>目前畫布結構完整，沒有明顯缺口</div>
      </div>`;
    return;
  }

  const updateSugs = suggestions.filter(s => s.type === 'update');
  const restructSugs = suggestions.filter(s => s.type === 'restructure');
  const fillSugs = suggestions.filter(s => s.type === 'auto-fill');
  const connSugs = suggestions.filter(s => s.type === 'connection');
  const nodeSugs = suggestions.filter(s => s.type === 'new-node');

  let html = '';

  // AI-powered review section
  if (aiReview) {
    const scoreColor = aiReview.overallScore >= 7 ? '#22c55e' : aiReview.overallScore >= 4 ? '#f59e0b' : '#ef4444';
    html += `<div class="ai-review-header">
      <div class="ai-review-score" style="border-color:${scoreColor};color:${scoreColor}">${aiReview.overallScore}/10</div>
      <div class="ai-review-summary">${esc(aiReview.summary || '')}</div>
    </div>`;
    if (aiReview.issues && aiReview.issues.length > 0) {
      html += `<div class="review-section-title">🤖 AI 策略分析</div>`;
      for (const issue of aiReview.issues) {
        const sevClass = issue.severity === 'high' ? 'sev-high' : issue.severity === 'medium' ? 'sev-medium' : 'sev-low';
        const typeEmoji = { duplicate: '🔁', gap: '🕳️', quality: '💡', conflict: '⚡', opportunity: '🎯' }[issue.type] || '📌';
        html += `
          <div class="review-card review-card-ai ${sevClass}">
            <div class="review-card-topic">${typeEmoji} ${esc(issue.title)}</div>
            <div class="review-card-reason">${esc(issue.detail)}</div>
            <div class="review-card-suggestion">💡 ${esc(issue.suggestion)}</div>
          </div>`;
      }
    }
    html += `<hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0">`;
  } else if (suggestions.length > 0) {
    html += `<div class="ai-review-loading">🤖 AI 策略分析載入中...</div>`;
  }

  html += `<div class="review-summary">找到 ${suggestions.length} 個結構建議</div>`;

  if (restructSugs.length > 0) {
    html += `<div class="review-section-title">🔄 建議調整架構</div>`;
    for (const s of restructSugs) {
      html += `
        <div class="review-card review-card-restructure" data-ghost-id="${s.id}">
          <div class="review-card-topic">主節點建議換成「${esc(s.newMainTopic)}」</div>
          <div class="review-card-changes">
            <div class="change-item change-promote">⬆ ${esc(s.newMainTopic)} → 主節點 · ${JOURNEY_LABELS[s.suggestedNewMainStage]}</div>
            <div class="change-item change-demote">⬇ ${esc(s.oldMainTopic)} → 子節點 · ${JOURNEY_LABELS[s.suggestedOldMainStage]}</div>
          </div>
          <div class="review-card-reason">${esc(s.reason)}</div>
          <div class="review-card-actions">
            <button class="ai-action-btn adopt ghost-adopt" data-ghost-id="${s.id}">調整</button>
            <button class="ai-action-btn dismiss ghost-dismiss" data-ghost-id="${s.id}">維持原樣</button>
          </div>
        </div>`;
    }
  }

  if (updateSugs.length > 0) {
    html += `<div class="review-section-title">📢 促銷活動連動更新</div>`;
    for (const s of updateSugs) {
      html += `
        <div class="review-card review-card-promo" data-ghost-id="${s.id}">
          <div class="review-card-topic">${esc(s.nodeTopic)}</div>
          <div class="review-card-changes">
            <div class="change-item change-promote">CTA 加入：${esc(s.suggestedCtaAppend)}</div>
            <div class="change-item change-promote">備註加入：${esc(s.suggestedUserAppend)}</div>
          </div>
          <div class="review-card-reason">${esc(s.reason)}</div>
          <div class="review-card-actions">
            <button class="ai-action-btn adopt ghost-adopt" data-ghost-id="${s.id}">套用</button>
            <button class="ai-action-btn dismiss ghost-dismiss" data-ghost-id="${s.id}">跳過</button>
          </div>
        </div>`;
    }
  }

  if (fillSugs.length > 0) {
    html += `<div class="review-section-title">✏️ 建議補全現有節點</div>`;
    for (const s of fillSugs) {
      const jobClass = {'吸引':'job-attract','培育':'job-nurture','轉換':'job-convert'}[s.fills.job] || '';
      html += `
        <div class="review-card" data-ghost-id="${s.id}">
          <div class="review-card-topic">${esc(s.nodeTopic)}</div>
          <div class="review-card-meta">
            ${s.fills.job ? `<span class="job-badge ${jobClass}">→ ${esc(s.fills.job)}</span>` : ''}
            <span class="cross-badge">→ ${JOURNEY_LABELS[s.suggestedStage]}</span>
            ${s.fills.cta ? `<span class="cross-badge">CTA: ${esc(s.fills.cta)}</span>` : ''}
          </div>
          <div class="review-card-reason">${esc(s.reason)}</div>
          <div class="review-card-actions">
            <button class="ai-action-btn adopt ghost-adopt" data-ghost-id="${s.id}">套用</button>
            <button class="ai-action-btn dismiss ghost-dismiss" data-ghost-id="${s.id}">跳過</button>
          </div>
        </div>`;
    }
  }

  if (connSugs.length > 0) {
    html += `<div class="review-section-title">🔗 建議連線</div>`;
    for (const s of connSugs) {
      html += `
        <div class="review-card" data-ghost-id="${s.id}">
          <div class="review-card-topic">${esc(s.fromTopic)} → ${esc(s.toTopic)}</div>
          <div class="review-card-reason">${esc(s.reason)}</div>
          <div class="review-card-actions">
            <button class="ai-action-btn adopt ghost-adopt" data-ghost-id="${s.id}">連線</button>
            <button class="ai-action-btn dismiss ghost-dismiss" data-ghost-id="${s.id}">跳過</button>
          </div>
        </div>`;
    }
  }

  if (nodeSugs.length > 0) {
    html += `<div class="review-section-title">🧩 建議新增的內容</div>`;
    for (const s of nodeSugs) {
      html += `
        <div class="review-card" data-ghost-id="${s.id}">
          <div class="review-card-topic">${esc(s.topic)}</div>
          <div class="review-card-meta">
            <span class="job-badge ${{'吸引':'job-attract','培育':'job-nurture','轉換':'job-convert'}[s.job] || ''}">${esc(s.job)}</span>
            <span class="cross-badge">${JOURNEY_LABELS[s.stage]}</span>
            <span class="cross-badge">${MATERIAL_LABELS[s.material]}</span>
          </div>
          <div class="review-card-reason">${esc(s.reason)}</div>
          <div class="review-card-deficit">${esc(s.deficit || '')}</div>
          <div class="review-card-actions">
            <button class="ai-action-btn adopt ghost-adopt" data-ghost-id="${s.id}">採用</button>
            <button class="ai-action-btn dismiss ghost-dismiss" data-ghost-id="${s.id}">跳過</button>
          </div>
        </div>`;
    }
  }

  html += `
    <div class="detail-divider"></div>
    <div class="ask-section">
      <label>💬 向 AI 提問（全域）</label>
      <div class="ask-input-row">
        <input type="text" id="ask-global-input" class="ask-input" placeholder="例：目前策略有什麼盲點？">
        <button id="ask-global-btn" class="ask-send-btn">送出</button>
      </div>
      <div id="ask-global-result"></div>
    </div>`;

  $('#review-content').innerHTML = html;

  // Global ask
  $('#ask-global-btn')?.addEventListener('click', async () => {
    const input = $('#ask-global-input');
    const q = input.value.trim();
    if (!q) return;
    const btn = $('#ask-global-btn');
    btn.disabled = true;
    btn.textContent = '⏳';
    const result = await aiAsk(q);
    btn.disabled = false;
    btn.textContent = '送出';
    if (result) renderAskResult($('#ask-global-result'), result);
  });
  $('#ask-global-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#ask-global-btn')?.click();
  });

  // Bind adopt/dismiss
  $$('.ghost-adopt').forEach(btn => {
    btn.addEventListener('click', () => adoptGhost(btn.dataset.ghostId));
  });
  $$('.ghost-dismiss').forEach(btn => {
    btn.addEventListener('click', () => dismissGhost(btn.dataset.ghostId));
  });
}

function adoptGhost(ghostId) {
  const ghost = state.ghostNodes.find(g => g.id === ghostId);
  if (!ghost) return;

  if (ghost.type === 'update') {
    const node = state.nodes.get(ghost.nodeId);
    if (node) {
      if (ghost.suggestedCtaAppend) {
        node.main.cta = (node.main.cta || '') + ' ' + ghost.suggestedCtaAppend;
      }
      if (ghost.suggestedUserAppend) {
        node.user = (node.user || '') + '\n' + ghost.suggestedUserAppend;
      }
      saveState();
    }
  } else if (ghost.type === 'restructure') {
    const newMain = state.nodes.get(ghost.newMainId);
    const oldMain = state.nodes.get(ghost.oldMainId);
    if (newMain) {
      newMain.isMain = true;
      newMain.positions.journey = { ...newMain.positions.journey, stage: ghost.suggestedNewMainStage };
      if (!newMain.main.job) newMain.main.job = ghost.suggestedNewMainJob || '';
    }
    if (oldMain) {
      oldMain.isMain = false;
      oldMain.positions.journey = { ...oldMain.positions.journey, stage: ghost.suggestedOldMainStage };
    }
    // Auto-connect if not already
    if (newMain && oldMain) {
      const exists = state.connections.some(c =>
        (c.from === newMain.id && c.to === oldMain.id) || (c.from === oldMain.id && c.to === newMain.id)
      );
      if (!exists) state.connections.push({ from: newMain.id, to: oldMain.id });
    }
    saveState();
  } else if (ghost.type === 'auto-fill') {
    const node = state.nodes.get(ghost.nodeId);
    if (node) {
      if (ghost.fills.job) node.main.job = ghost.fills.job;
      if (ghost.fills.cta) node.main.cta = ghost.fills.cta;
      if (ghost.suggestedStage) node.positions.journey = { ...node.positions.journey, stage: ghost.suggestedStage };
      saveState();
    }
  } else if (ghost.type === 'new-node') {
    // Place in a reasonable position
    const existingCount = state.nodes.size;
    const col = existingCount % 4;
    const row = Math.floor(existingCount / 4);
    const x = 60 + col * 280;
    const y = 60 + row * 220;
    const node = createNode({
      topic: ghost.topic,
      job: ghost.job,
      cta: ghost.cta || '',
      isMain: false,
    }, x, y);
    node.positions.journey = { stage: ghost.stage, order: 0 };
    node.positions.material = { column: ghost.material, order: 0 };
    if (ghost.connectTo) {
      state.connections.push({ from: ghost.connectTo, to: node.id });
    }
    saveState();
  } else if (ghost.type === 'connection') {
    const exists = state.connections.some(
      c => (c.from === ghost.fromId && c.to === ghost.toId) || (c.from === ghost.toId && c.to === ghost.fromId)
    );
    if (!exists) {
      state.connections.push({ from: ghost.fromId, to: ghost.toId });
      saveState();
    }
  }

  // Remove from ghosts and refresh
  state.ghostNodes = state.ghostNodes.filter(g => g.id !== ghostId);
  render();
  showReviewPanel(state.ghostNodes);
}

function dismissGhost(ghostId) {
  state.ghostNodes = state.ghostNodes.filter(g => g.id !== ghostId);
  const card = $(`.review-card[data-ghost-id="${ghostId}"]`);
  if (card) card.remove();
  // Update summary count
  const summary = $('.review-summary');
  if (summary) summary.textContent = `找到 ${state.ghostNodes.length} 個建議`;
  if (state.ghostNodes.length === 0) {
    $('#review-content').innerHTML = `
      <div class="review-perfect">
        <div class="review-perfect-icon">👍</div>
        <div>所有建議已處理完畢</div>
      </div>`;
  }
  render();
}

function generateBrief() {
  const nodes = [...state.nodes.values()];
  if (nodes.length === 0) return;

  // If a node is selected → single-node Brief; otherwise → global production schedule
  if (state.selectedNodeId) {
    generateNodeBrief(state.selectedNodeId);
  } else {
    generateGlobalBrief();
  }
}

function generateNodeBrief(nodeId) {
  const node = state.nodes.get(nodeId);
  if (!node) return;

  $('#panel-empty').classList.add('hidden');
  $('#panel-detail').classList.add('hidden');
  $('#panel-review').classList.add('hidden');
  $('#panel-brief').classList.remove('hidden');

  // Find connected nodes
  const linked = [];
  for (const c of state.connections) {
    if (c.from === nodeId) {
      const to = state.nodes.get(c.to);
      if (to) linked.push({ dir: '→', topic: to.main.topic, id: to.id });
    }
    if (c.to === nodeId) {
      const from = state.nodes.get(c.from);
      if (from) linked.push({ dir: '←', topic: from.main.topic, id: from.id });
    }
  }

  const matCol = node.positions.material?.column;
  const matLabel = matCol === 'short' ? '短片' : matCol === 'long' ? '長片' : '未分配';
  const stage = node.positions.journey?.stage;
  const stageLabel = stage ? JOURNEY_LABELS[stage] : '未分配';
  const stageDesc = stage ? JOURNEY_DESC[stage] : '';
  const r = node.aiResearch;
  const hasAngles = node.filmingAngles?.length > 0;
  const hasScript = !!node.scriptDraft;

  // Promo tie-in
  const promoPatterns = /贈品|優惠|限定|折扣|免費|加碼|前\d+名|限量|促銷/;
  const allNodes = [...state.nodes.values()];
  const promoNodes = allNodes.filter(n => n.id !== nodeId && promoPatterns.test(n.main.topic));

  let html = `<div class="brief-node-header">${esc(node.main.topic)}</div>`;
  html += `<div class="brief-meta">${esc(matLabel)} ｜ ${esc(stageLabel)} ｜ ${node.isMain ? '★ 主節點' : '支線'}</div>`;

  // ── 01 工作 Job ──
  html += `<div class="brief-field brief-field-numbered">
    <div class="brief-field-label">01 工作 Job</div>
    <div class="brief-field-value">${node.main.job ? esc(node.main.job + ' — ' + (JOB_DESC[node.main.job] || '')) : '⚠️ 未指定'}</div>
  </div>`;

  // ── 02 來賓介紹 Guest ──
  let guestText = node.guest || '';
  if (r?.positioning) guestText += (guestText ? '\n' : '') + r.positioning;
  html += `<div class="brief-field brief-field-numbered">
    <div class="brief-field-label">02 來賓介紹 Guest</div>
    <div class="brief-field-value">${guestText ? esc(guestText) : '<span class="brief-empty">請在節點填入來賓資訊</span>'}</div>
  </div>`;

  // ── 03 核心訊息 Core Message ──
  let coreMsg = '';
  if (r?.suggestedHook) coreMsg += r.suggestedHook;
  if (r?.features) coreMsg += (coreMsg ? '\n\n' : '') + '獨家角度：' + r.features;
  html += `<div class="brief-field brief-field-numbered">
    <div class="brief-field-label">03 觀眾看完要記住什麼</div>
    <div class="brief-field-value">${coreMsg ? esc(coreMsg) : '<span class="brief-empty">展開內容後自動填入</span>'}</div>
  </div>`;

  // ── 04 訪綱重點 Interview Outline ──
  let nonNeg = '';
  if (hasAngles) {
    nonNeg = node.filmingAngles.map((a, i) =>
      `${i + 1}. ${a.title}\n   為什麼問：${a.why}\n   追問方向：${a.howToShoot || '視回答追問'}`
    ).join('\n\n');
  }
  if (r?.audienceCares) nonNeg += (nonNeg ? '\n\n' : '') + '觀眾會想問：' + r.audienceCares;
  html += `<div class="brief-field brief-field-numbered">
    <div class="brief-field-label">04 訪綱重點 + 必問問題</div>
    <div class="brief-field-value">${nonNeg ? esc(nonNeg) : '<span class="brief-empty">展開內容後自動填入</span>'}</div>
  </div>`;

  // ── 05 短片潛力點 Short Clip Moments ──
  let shortClips = '';
  if (hasAngles) {
    shortClips = node.filmingAngles
      .filter(a => a.why.includes('短影音') || a.why.includes('共鳴') || a.howToShoot?.includes('Cold Open') || a.title.includes('建議'))
      .map(a => `• ${a.title}（可獨立為 30-60 秒短片）`)
      .join('\n');
  }
  if (!shortClips && hasAngles) {
    shortClips = '（拍完後由片師標記時間戳，此欄留白）';
  }
  html += `<div class="brief-field brief-field-numbered">
    <div class="brief-field-label">05 短片潛力點 Short Clip Moments</div>
    <div class="brief-field-value">${shortClips ? esc(shortClips) : '<span class="brief-empty">拍攝完成後補填</span>'}</div>
  </div>`;

  // ── 06 框架連結 Framework Link ──
  let framework = '';
  if (linked.length > 0) {
    framework = linked.map(l => `${l.dir} ${l.topic}`).join('\n');
  }
  html += `<div class="brief-field brief-field-numbered">
    <div class="brief-field-label">06 框架連結 Framework Link</div>
    <div class="brief-field-value">${framework ? esc(framework) : '<span class="brief-empty">無關聯節點</span>'}</div>
  </div>`;

  // ── CTA ──
  const ctaText = node.main.cta || (r?.suggestedCta) || '';
  html += `<div class="brief-field">
    <div class="brief-field-label">CTA（觀眾看完要做什麼）</div>
    <div class="brief-field-value brief-cta">${ctaText ? esc(ctaText) : '⚠️ 未設定'}</div>
  </div>`;

  // ── 製作備註 ──
  if (node.user) {
    html += `<div class="brief-field">
      <div class="brief-field-label">製作備註</div>
      <div class="brief-field-value brief-notes">${esc(node.user)}</div>
    </div>`;
  }

  // ── 腳本大綱 ──
  if (hasScript) {
    html += `<div class="brief-field">
      <div class="brief-field-label">📝 腳本大綱</div>
      <div class="brief-field-value brief-script">${esc(node.scriptDraft)}</div>
    </div>`;
  }

  if (hasAngles) {
    html += `<button class="expand-btn" id="btn-gen-script" style="margin-top:8px;">
      ${hasScript ? '🔄 重新展開腳本' : '📝 展開腳本大綱'}
    </button>`;
  } else {
    html += `<div class="brief-hint">💡 先在節點詳情按「展開內容」取得拍攝方向，才能展開腳本</div>`;
  }

  // ── AI 潤稿 + 複製按鈕 ──
  html += `<button class="expand-btn" id="btn-polish-brief" style="margin-top:12px;">
    ✨ AI 潤稿 Brief
  </button>`;
  html += `<button class="expand-btn" id="btn-copy-brief" style="margin-top:8px; border-style:solid; background:rgba(16,185,129,0.08); border-color:#10b981; color:#059669;">
    📋 複製 Brief 到剪貼簿
  </button>`;

  $('#brief-content').innerHTML = html;

  // Script generation event
  $('#btn-gen-script')?.addEventListener('click', async () => {
    const btn = $('#btn-gen-script');
    btn.textContent = '🔄 生成中...';
    btn.disabled = true;
    try {
      const script = await generateScript(node);
      node.scriptDraft = script;
      saveState();
      generateNodeBrief(nodeId);
    } catch (err) {
      btn.textContent = '❌ 失敗，再試一次';
      btn.disabled = false;
    }
  });

  // AI polish brief
  $('#btn-polish-brief')?.addEventListener('click', async () => {
    const btn = $('#btn-polish-brief');
    btn.disabled = true;
    btn.textContent = '✨ 潤稿中...';
    const fields = {
      job: node.main.job ? node.main.job + ' — ' + (JOB_DESC[node.main.job] || '') : '',
      guest: guestText,
      coreMessage: coreMsg,
      interviewOutline: nonNeg,
      shortClips: shortClips,
      frameworkLink: framework,
    };
    const result = await aiBriefPolish(node.main.topic, fields);
    btn.disabled = false;
    btn.textContent = '✨ AI 潤稿 Brief';
    if (result) {
      // Store polished version and re-render
      node._polishedBrief = result;
      saveState();
      // Update the brief fields in-place
      const fieldEls = document.querySelectorAll('.brief-field-numbered .brief-field-value');
      const polished = [result.job, result.person, result.coreMessage, result.nonNegotiables, result.shortClips, result.frameworkLink];
      fieldEls.forEach((el, i) => {
        if (polished[i]) {
          el.textContent = polished[i];
          el.style.borderLeft = '3px solid #8b5cf6';
          el.style.paddingLeft = '8px';
        }
      });
    }
  });

  // Copy brief to clipboard
  $('#btn-copy-brief')?.addEventListener('click', () => {
    const lines = [];
    lines.push(`# ${node.main.topic}`);
    lines.push('');
    lines.push(`## 01 工作 Job`);
    lines.push(node.main.job ? `${node.main.job} — ${JOB_DESC[node.main.job] || ''}` : '未指定');
    lines.push('');
    lines.push(`## 02 目標人物 Person`);
    lines.push(personText || '（待補）');
    lines.push('');
    lines.push(`## 03 核心訊息 Core Message`);
    lines.push(coreMsg || '（待補）');
    lines.push('');
    lines.push(`## 04 必留元素 Non-Negotiables`);
    lines.push(nonNeg || '（待補）');
    lines.push('');
    lines.push(`## 05 短片潛力點 Short Clip Moments`);
    lines.push(shortClips || '（拍攝完成後補填）');
    lines.push('');
    lines.push(`## 06 框架連結 Framework Link`);
    lines.push(framework || '無');
    lines.push('');
    lines.push(`## CTA`);
    lines.push(ctaText || '（待補）');
    if (node.scriptDraft) {
      lines.push('');
      lines.push(`## 腳本大綱`);
      lines.push(node.scriptDraft);
    }
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      const btn = $('#btn-copy-brief');
      btn.textContent = '✅ 已複製';
      setTimeout(() => { btn.textContent = '📋 複製 Brief 到剪貼簿'; }, 2000);
    });
  });
}

function generateGlobalBrief() {
  const nodes = [...state.nodes.values()];

  $('#panel-empty').classList.add('hidden');
  $('#panel-detail').classList.add('hidden');
  $('#panel-review').classList.add('hidden');
  $('#panel-brief').classList.remove('hidden');

  // Group by stage
  const stageGroups = { A: [], B: [], C: [], D: [] };
  for (const n of nodes) {
    const s = n.positions.journey?.stage || 'A';
    stageGroups[s].push(n);
  }

  const mainNode = nodes.find(n => n.isMain) || nodes[0];
  const longCount = nodes.filter(n => n.positions.material?.column === 'long').length;
  const shortCount = nodes.filter(n => n.positions.material?.column === 'short').length;

  let html = `<div class="brief-node-header">📋 全局製作排程</div>`;

  // Overview
  html += `<div class="brief-field">
    <div class="brief-field-label">內容主軸</div>
    <div class="brief-field-value">${esc(mainNode.main.topic)}</div>
  </div>`;

  html += `<div class="brief-field">
    <div class="brief-field-label">規模</div>
    <div class="brief-field-value">${nodes.length} 支內容（長片 ${longCount}、短片 ${shortCount}）· ${state.connections.length} 條連線</div>
  </div>`;

  // Per-stage breakdown
  for (const [key, label] of Object.entries(JOURNEY_LABELS)) {
    const group = stageGroups[key];
    if (group.length === 0) continue;
    html += `<div class="brief-field">
      <div class="brief-field-label">${label}（${group.length} 支）</div>
      <div class="brief-field-value">${group.map(n => {
        const mat = n.positions.material?.column === 'short' ? '🎬' : '📹';
        const job = n.main.job ? `[${n.main.job}]` : '';
        return `${mat} ${esc(n.main.topic)} ${job}`;
      }).join('<br>')}</div>
    </div>`;
  }

  // CTA summary
  const ctas = nodes.filter(n => n.main.cta).map(n => `${n.main.topic.substring(0, 20)}… → ${n.main.cta}`);
  if (ctas.length > 0) {
    html += `<div class="brief-field">
      <div class="brief-field-label">CTA 總覽</div>
      <div class="brief-field-value">${ctas.map(c => esc(c)).join('<br>')}</div>
    </div>`;
  }

  // Production order suggestion
  html += `<div class="brief-field">
    <div class="brief-field-label">建議出片順序</div>
    <div class="brief-field-value brief-checklist">${nodes.filter(n => n.positions.material?.column === 'long').map((n, i) => {
      return `${i + 1}. ${esc(n.main.topic)}`;
    }).join('<br>')}</div>
  </div>`;

  html += `<div class="brief-hint">💡 點選單一節點後按「生成 Brief」可查看該影片的詳細製作 Brief</div>`;

  $('#brief-content').innerHTML = html;
}

// ── Modal ──

function showModal(x, y) {
  state.pendingPosition = { x, y };
  const overlay = $('#modal-overlay');
  overlay.classList.remove('hidden');
  $('#input-topic').value = '';
  $('#input-guest') && ($('#input-guest').value = '');
  $('#input-cta').value = '';
  $('#input-main').checked = false;

  // Auto-fill Job when creating from a journey stage
  const stageAssign = state.pendingColumnAssign?.journey?.stage;
  if (stageAssign && STAGE_DEFAULT_JOB[stageAssign]) {
    $('#input-job').value = STAGE_DEFAULT_JOB[stageAssign];
  } else {
    $('#input-job').value = '';
  }

  setTimeout(() => $('#input-topic').focus(), 50);
}

function hideModal() {
  $('#modal-overlay').classList.add('hidden');
  state.pendingPosition = null;
}

// ── Events ──

function bindEvents() {
  $$('.tab').forEach(t => {
    t.addEventListener('click', () => {
      state.currentView = t.dataset.view;
      state.selectedNodeId = null;
      saveState();
      render();
    });
  });

  $('#btn-add').addEventListener('click', () => {
    const area = $('#canvas-area');
    const col = state.nodes.size % 4;
    const row = Math.floor(state.nodes.size / 4);
    const cx = area.scrollLeft + 60 + col * 280;
    const cy = area.scrollTop + 60 + row * 220;
    showModal(cx, cy);
  });

  $('#canvas-area').addEventListener('dblclick', (e) => {
    if (e.target.closest('.node-card')) return;
    if (state.currentView !== 'topic' || state.topicMode !== 'free') return;
    const area = $('#canvas-area');
    const z = state.zoomLevel;
    const x = (e.clientX - area.getBoundingClientRect().left + area.scrollLeft) / z;
    const y = (e.clientY - area.getBoundingClientRect().top + area.scrollTop) / z;
    showModal(x, y);
  });

  $('#canvas').addEventListener('click', (e) => {
    if (!e.target.closest('.node-card')) {
      state.selectedNodeId = null;
      render();
    }
  });

  $('#node-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const topic = $('#input-topic').value.trim();
    if (!topic) return;
    const pos = state.pendingPosition || { x: 100, y: 100 };
    const node = createNode({
      topic,
      guest: $('#input-guest')?.value || '',
      job: $('#input-job').value,
      cta: $('#input-cta').value,
      isMain: $('#input-main').checked,
    }, pos.x, pos.y);
    if (state.pendingColumnAssign) {
      for (const [view, vals] of Object.entries(state.pendingColumnAssign)) {
        if (!node.positions[view]) node.positions[view] = {};
        Object.assign(node.positions[view], vals);
      }
      state.pendingColumnAssign = null;
      saveState();
    }
    hideModal();
    selectNode(node.id);
    render();
    // Auto-classify with AI if Job not specified
    if (!node.main.job) {
      aiClassifyNode(node).catch(() => {});
    }
  });

  $('#modal-cancel').addEventListener('click', hideModal);
  $('#modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) hideModal();
  });

  $('#btn-connect').addEventListener('click', () => {
    state.connectMode = !state.connectMode;
    state.connectFrom = null;
    render();
  });

  // Topic sub-tabs (free / list)
  $$('#topic-toolbar .sub-tab').forEach(t => {
    t.addEventListener('click', () => {
      state.topicMode = t.dataset.mode;
      render();
    });
  });

  // Zoom controls
  $('#zoom-in').addEventListener('click', () => {
    state.zoomLevel = Math.min(2, +(state.zoomLevel + 0.15).toFixed(2));
    render();
  });
  $('#zoom-out').addEventListener('click', () => {
    state.zoomLevel = Math.max(0.3, +(state.zoomLevel - 0.15).toFixed(2));
    render();
  });
  $('#zoom-reset').addEventListener('click', () => {
    state.zoomLevel = 1;
    render();
  });

  // Mouse wheel zoom in free mode
  $('#canvas-area').addEventListener('wheel', (e) => {
    if (state.currentView !== 'topic' || state.topicMode !== 'free') return;
    if (!e.ctrlKey && !e.metaKey) return; // only pinch / ctrl+scroll
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    state.zoomLevel = Math.min(2, Math.max(0.3, +(state.zoomLevel + delta).toFixed(2)));
    render();
  }, { passive: false });

  $('#btn-review').addEventListener('click', runGlobalReview);
  $('#btn-brief').addEventListener('click', generateBrief);

  $('#review-close').addEventListener('click', () => {
    $('#panel-review').classList.add('hidden');
    $('#panel-empty').classList.remove('hidden');
    state.ghostNodes = [];
    render();
  });

  $('#panel-close').addEventListener('click', () => {
    state.selectedNodeId = null;
    render();
  });

  $('#brief-close').addEventListener('click', () => {
    $('#panel-brief').classList.add('hidden');
    $('#panel-empty').classList.remove('hidden');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('#modal-overlay').classList.contains('hidden')) {
        hideModal();
      } else {
        state.selectedNodeId = null;
        state.connectMode = false;
        state.connectFrom = null;
        render();
      }
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedNodeId) {
      if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
      deleteNode(state.selectedNodeId);
      render();
    }
  });
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ── Init ──
async function init() {
  // Bootstrap project system
  let list = getProjectList();
  if (list.length === 0) {
    // Migrate existing data into a default project
    const id = 'p' + Date.now();
    list = [{ id, name: '未命名專案', createdAt: Date.now() }];
    saveProjectList(list);
    // Move existing localStorage data to new key
    const oldData = localStorage.getItem('interview-canvas-v1');
    if (oldData) {
      localStorage.setItem('interview-canvas-' + id, oldData);
    }
    currentProjectId = id;
    STORAGE_KEY = 'interview-canvas-' + id;
  } else {
    currentProjectId = list[0].id;
    STORAGE_KEY = 'interview-canvas-' + currentProjectId;
  }

  await loadState();
  bindEvents();
  renderProjectSelect();

  // Project switcher events
  $('#project-select')?.addEventListener('change', (e) => {
    switchProject(e.target.value);
  });

  $('#project-select')?.addEventListener('dblclick', () => {
    const newName = prompt('重新命名專案：', $('#project-select').selectedOptions[0]?.text);
    if (newName && newName.trim()) {
      renameProject(currentProjectId, newName.trim());
      renderProjectSelect();
    }
  });

  $('#btn-new-project')?.addEventListener('click', () => {
    const name = prompt('新專案名稱：');
    if (name && name.trim()) {
      createProject(name.trim());
    }
  });

  $('#btn-delete-project')?.addEventListener('click', () => {
    const list = getProjectList();
    const current = list.find(p => p.id === currentProjectId);
    if (confirm(`刪除專案「${current?.name}」？此操作無法復原。`)) {
      deleteProject(currentProjectId);
    }
  });

  render();
  saveState();
}
init();

window._cs = { state, render, saveState, createNode, deleteNode, updateNode, renderMaterialView, resolveCollisions, highlightConnections, analyzeCanvas, runGlobalReview, adoptGhost, dismissGhost, expandContent, renderPanel, createProject, deleteProject, switchProject, renderProjectSelect, generateScript };
