const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const PROJECT_INDEX_KEY = 'content-canvas-projects';
let STORAGE_KEY = 'content-canvas-v1'; // will be overwritten by active project
let currentProjectId = null;
const COLD_START_RATIOS = { A: 25, B: 35, C: 30, D: 10 };
const JOURNEY_LABELS = { A: 'A 認知', B: 'B 評估', C: 'C 信任', D: 'D 安心' };
const JOURNEY_DESC = { A: '讓人知道你', B: '讓人比較選擇', C: '讓人相信你', D: '讓人放心買' };
const MATERIAL_LABELS = { long: '長片', short: '短片' };
const MATERIAL_DESC = { long: '完整主題影片', short: '短片（剪輯或獨立）' };
const JOB_DESC = { '吸引': '拉新觀眾進來', '培育': '加深興趣與信任', '轉換': '推動購買行動' };

// Stage → default Job mapping
const STAGE_DEFAULT_JOB = { A: '吸引', B: '培育', C: '轉換', D: '轉換' };

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
  dismissedSuggestions: new Set(), // IDs of skipped suggestions (persisted per project)
  lastAiReview: null,   // Cached AI review result (preserved across adopt/dismiss)
  // Canvas panning
  panState: null,        // { startX, startY, scrollLeft, scrollTop }
  // Edge-drag connection
  connDragState: null,   // { fromNodeId, startX, startY }
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
  STORAGE_KEY = 'content-canvas-' + projectId;
  // Reset state
  state.nodes = new Map();
  state.connections = [];
  state.selectedNodeId = null;
  state.ghostNodes = [];
  state.hoveredNodeId = null;
  state.topicMode = 'free';
  state.zoomLevel = 1;
  state.dismissedSuggestions = new Set();
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
    state.dismissedSuggestions = new Set(data.dismissedSuggestions || []);
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
  list.push({ id, name, createdAt: Date.now(), updatedAt: Date.now(), nodeCount: 0 });
  saveProjectList(list);
  switchProject(id);
  renderProjectSelect();
  return id;
}

function deleteProject(projectId) {
  let list = getProjectList();
  list = list.filter(p => p.id !== projectId);
  saveProjectList(list);
  localStorage.removeItem('content-canvas-' + projectId);
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
    dismissedSuggestions: [...state.dismissedSuggestions],
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  saveToFile(data);
  // Update project metadata (updatedAt, nodeCount)
  const list = getProjectList();
  const proj = list.find(p => p.id === currentProjectId);
  if (proj) {
    proj.updatedAt = Date.now();
    proj.nodeCount = state.nodes.size;
    saveProjectList(list);
  }
}

function saveToFile(data) {
  fetch('/api/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).catch(() => {});
}

async function loadState() {
  let raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    try {
      const res = await fetch('/api/data');
      const text = await res.text();
      if (text && text !== 'null') raw = text;
    } catch { /* offline is fine */ }
  }
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

function createNode({ topic, job, jobSecondary, cta, isMain }, x, y) {
  const id = 'n' + Date.now() + Math.random().toString(36).slice(2, 6);
  const node = {
    id,
    main: { topic, job: job || '', jobSecondary: jobSecondary || '', cta: cta || '' },
    user: '',
    aiSuggest: [],
    aiResearch: null,
    filmingAngles: [],
    detailShots: [],
    hooks: [],
    aiInputType: '',
    aiReceivedSummary: '',
    targetAudience: '',
    ecosystemNotes: '',
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
  if (updates.main) {
    // Ensure jobSecondary field exists
    if (!node.main.jobSecondary) node.main.jobSecondary = '';
    Object.assign(node.main, updates.main);
  }
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

function renderHealthBar() {
  const nodes = [...state.nodes.values()];
  if (nodes.length < 2) {
    const existing = document.getElementById('canvas-health');
    if (existing) existing.remove();
    return;
  }

  let healthEl = document.getElementById('canvas-health');
  if (!healthEl) {
    healthEl = document.createElement('div');
    healthEl.id = 'canvas-health';
    healthEl.className = 'canvas-health-bar';
    const area = document.getElementById('canvas-area');
    area.insertBefore(healthEl, area.firstChild);
  }

  // Calculate metrics
  const jobCounts = { '吸引': 0, '培育': 0, '轉換': 0, '': 0 };
  const stageCounts = { A: 0, B: 0, C: 0, D: 0 };
  const materialCounts = { long: 0, short: 0 };
  let hasMain = false;

  for (const n of nodes) {
    jobCounts[n.main.job || ''] = (jobCounts[n.main.job || ''] || 0) + 1;
    const stage = n.positions?.journey?.stage || 'A';
    stageCounts[stage] = (stageCounts[stage] || 0) + 1;
    const mat = n.positions?.material?.column || 'long';
    materialCounts[mat] = (materialCounts[mat] || 0) + 1;
    if (n.isMain) hasMain = true;
  }

  // Build alerts
  const alerts = [];
  const total = nodes.length;

  // Check Job distribution
  if (jobCounts['吸引'] === 0) alerts.push({ type: 'warn', msg: '缺少「吸引」類影片 — 新觀眾沒有入口' });
  if (jobCounts['轉換'] === 0 && total >= 3) alerts.push({ type: 'warn', msg: '缺少「轉換」類影片 — 沒有推動購買的內容' });
  if (jobCounts[''] > 0) alerts.push({ type: 'info', msg: `${jobCounts['']} 支影片尚未指定目的` });

  // Check stage coverage
  const emptyStages = Object.entries(stageCounts).filter(([k, v]) => v === 0).map(([k]) => k);
  if (emptyStages.length > 0 && total >= 3) {
    const labels = emptyStages.map(s => JOURNEY_LABELS[s]).join('、');
    alerts.push({ type: 'warn', msg: `購買階段缺口：${labels} 沒有影片覆蓋` });
  }

  // Check material balance
  if (materialCounts.short === 0 && total >= 3) {
    alerts.push({ type: 'info', msg: '全部都是長片 — 考慮加幾支短片當入口' });
  }

  // Check main node
  if (!hasMain && total >= 2) {
    alerts.push({ type: 'info', msg: '尚未設定主節點 — 標記你這個系列最重要的影片' });
  }

  // ── Strategy-level insights ──

  // 1. Funnel ratio check: ideal is ~30% attract, 40% nurture, 30% convert
  if (total >= 4) {
    const attractPct = (jobCounts['吸引'] / total) * 100;
    const nurturePct = (jobCounts['培育'] / total) * 100;
    const convertPct = (jobCounts['轉換'] / total) * 100;

    if (attractPct > 60) alerts.push({ type: 'info', msg: '「吸引」佔比偏高 — 觀眾進來了但沒有內容留住他們，考慮加「培育」' });
    if (convertPct > 50 && attractPct < 20) alerts.push({ type: 'warn', msg: '轉換多但吸引少 — 漏斗頂部太窄，新觀眾進不來' });
    if (nurturePct > 60) alerts.push({ type: 'info', msg: '「培育」比例很高 — 很棒的深度內容，但記得加幾支吸引型影片拉新觀眾' });
  }

  // 2. Main node check: series should have a clear anchor
  const mainNodes = nodes.filter(n => n.isMain);
  if (mainNodes.length > 1) {
    alerts.push({ type: 'info', msg: `有 ${mainNodes.length} 個主節點 — 通常一個系列只需要一個核心影片` });
  }

  // 3. CTA diversity check
  const ctaNodes = nodes.filter(n => n.main.cta);
  if (ctaNodes.length === 0 && total >= 3) {
    alerts.push({ type: 'warn', msg: '沒有任何影片設定 CTA — 觀眾看完不知道要做什麼' });
  } else if (ctaNodes.length > 0) {
    const ctas = ctaNodes.map(n => n.main.cta.trim().toLowerCase());
    const uniqueCtas = new Set(ctas);
    if (uniqueCtas.size === 1 && ctas.length >= 3) {
      alerts.push({ type: 'info', msg: '所有 CTA 都一樣 — 不同階段的觀眾需要不同的行動指引' });
    }
  }

  // 4. Connection check: orphan nodes
  if (total >= 3) {
    const connectedIds = new Set();
    for (const c of state.connections) {
      connectedIds.add(c.from);
      connectedIds.add(c.to);
    }
    const orphanCount = nodes.filter(n => !connectedIds.has(n.id)).length;
    if (orphanCount > 0 && state.connections.length > 0) {
      alerts.push({ type: 'info', msg: `${orphanCount} 支影片沒有連線 — 孤立內容不利於觀眾流動` });
    } else if (state.connections.length === 0 && total >= 3) {
      alerts.push({ type: 'info', msg: '還沒建立任何連線 — 用 🔗 把相關影片串起來引導觀眾' });
    }
  }

  // 5. Short-form gateway check
  if (total >= 4) {
    const shortAttract = nodes.filter(n => (n.positions?.material?.column === 'short') && n.main.job === '吸引');
    const longAttract = nodes.filter(n => (n.positions?.material?.column !== 'short') && n.main.job === '吸引');
    if (longAttract.length > 0 && shortAttract.length === 0) {
      alerts.push({ type: 'info', msg: '「吸引」類都是長片 — 短片更容易讓新觀眾點進來' });
    }
  }

  // Show max 3 most important alerts to avoid overwhelming
  const sortedAlerts = alerts.sort((a, b) => (a.type === 'warn' ? 0 : 1) - (b.type === 'warn' ? 0 : 1));
  const displayAlerts = sortedAlerts.slice(0, 3);
  const hiddenCount = alerts.length - displayAlerts.length;

  // Job distribution pills
  const jobPills = ['吸引', '培育', '轉換'].map(j => {
    const count = jobCounts[j] || 0;
    const cls = j === '吸引' ? 'attract' : j === '培育' ? 'nurture' : 'convert';
    return `<span class="health-pill health-${cls}">${j} ${count}</span>`;
  }).join('');

  // Stage distribution pills
  const stagePills = Object.entries(JOURNEY_LABELS).map(([k, label]) => {
    const count = stageCounts[k] || 0;
    return `<span class="health-pill ${count === 0 ? 'health-empty' : 'health-ok'}">${label.split(' ')[0]}${label.split(' ')[1] || ''} ${count}</span>`;
  }).join('');

  // Compose health bar
  const alertsHtml = displayAlerts.length > 0
    ? `<div class="health-alerts">${displayAlerts.map(a => `<span class="health-alert health-alert-${a.type}">${a.type === 'warn' ? '⚠️' : '💡'} ${a.msg}</span>`).join('')}${hiddenCount > 0 ? `<span class="health-alert health-alert-more">還有 ${hiddenCount} 項建議…</span>` : ''}</div>`
    : `<div class="health-alerts"><span class="health-alert health-alert-good">✅ 內容策略看起來不錯！</span></div>`;

  healthEl.innerHTML = `
    <div class="health-row">
      <div class="health-group"><span class="health-label">目的</span>${jobPills}</div>
      <div class="health-group"><span class="health-label">階段</span>${stagePills}</div>
    </div>
    ${alertsHtml}
  `;
}

function updateSmartHint() {
  const addBtn = document.getElementById('btn-add');
  if (!addBtn) return;
  const nodes = [...state.nodes.values()];
  if (nodes.length < 2) {
    addBtn.textContent = '＋ 新增節點';
    addBtn.title = '新增節點 (或雙擊畫布)';
    return;
  }

  // Analyze gaps
  const jobCounts = { '吸引': 0, '培育': 0, '轉換': 0 };
  const stageCounts = { A: 0, B: 0, C: 0, D: 0 };
  for (const n of nodes) {
    if (n.main.job && jobCounts[n.main.job] !== undefined) jobCounts[n.main.job]++;
    const stage = n.positions?.journey?.stage || 'A';
    stageCounts[stage]++;
  }

  // Find biggest gap
  let hint = '';
  if (jobCounts['吸引'] === 0) {
    hint = '💡 建議加一支「吸引」影片讓新觀眾認識你';
  } else if (jobCounts['轉換'] === 0) {
    hint = '💡 建議加一支「轉換」影片推動購買行動';
  } else if (jobCounts['培育'] === 0) {
    hint = '💡 建議加一支「培育」影片加深觀眾信任';
  } else {
    const emptyStages = Object.entries(stageCounts).filter(([k, v]) => v === 0);
    if (emptyStages.length > 0) {
      const label = JOURNEY_LABELS[emptyStages[0][0]];
      hint = `💡 「${label}」階段還沒有影片`;
    }
  }

  if (hint) {
    addBtn.innerHTML = `＋ 新增節點 <span class="smart-hint">${hint}</span>`;
    addBtn.title = hint;
  } else {
    addBtn.textContent = '＋ 新增節點';
    addBtn.title = '新增節點 (或雙擊畫布)';
  }
}

function calcCompleteness() {
  const nodes = [...state.nodes.values()];
  if (nodes.length === 0) return 0;

  let score = 0;
  const total = 100;

  // 1. Has at least 3 nodes (20 pts)
  if (nodes.length >= 3) score += 20;
  else if (nodes.length >= 1) score += nodes.length * 7;

  // 2. All nodes have Job assigned (20 pts)
  const withJob = nodes.filter(n => n.main.job).length;
  score += Math.round((withJob / nodes.length) * 20);

  // 3. At least 2 different Jobs covered (15 pts)
  const uniqueJobs = new Set(nodes.filter(n => n.main.job).map(n => n.main.job));
  if (uniqueJobs.size >= 3) score += 15;
  else if (uniqueJobs.size >= 2) score += 10;
  else if (uniqueJobs.size >= 1) score += 5;

  // 4. At least 2 stages covered (15 pts)
  const uniqueStages = new Set(nodes.map(n => n.positions?.journey?.stage || 'A'));
  if (uniqueStages.size >= 4) score += 15;
  else if (uniqueStages.size >= 3) score += 10;
  else if (uniqueStages.size >= 2) score += 7;

  // 5. Has connections (10 pts)
  if (state.connections.length >= 2) score += 10;
  else if (state.connections.length >= 1) score += 5;

  // 6. Has at least one CTA (10 pts)
  if (nodes.some(n => n.main.cta)) score += 10;

  // 7. Has a main node (10 pts)
  if (nodes.some(n => n.isMain)) score += 10;

  return Math.min(score, 100);
}

// Per-node readiness score (0-100) — how ready is this node to film?
function nodeReadiness(node) {
  let score = 0;
  if (node.main.topic) score += 15;
  if (node.main.job) score += 15;
  if (node.main.cta) score += 15;
  if (node.positions?.journey?.stage) score += 10;
  if (node.positions?.material?.column) score += 5;
  if (node.user && node.user.length > 20) score += 15;
  if (node.aiResearch) score += 15;
  if (node.filmingAngles?.length > 0) score += 10;
  return Math.min(score, 100);
}

function render() {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === state.currentView));
  const completenessScore = calcCompleteness();
  $('#node-count').innerHTML = `${state.nodes.size} 個節點 ${completenessScore > 0 ? `<span class="completeness-badge" title="企劃完成度">${completenessScore}%</span>` : ''}`;
  // Color the completeness badge based on score
  const badge = document.querySelector('.completeness-badge');
  if (badge) {
    if (completenessScore >= 80) { badge.style.background = '#f0fdf4'; badge.style.color = '#166534'; }
    else if (completenessScore >= 50) { badge.style.background = '#fffbeb'; badge.style.color = '#92400e'; }
    else { badge.style.background = '#f1f5f9'; badge.style.color = '#64748b'; }
  }
  $('#btn-connect').classList.toggle('active-mode', state.connectMode);

  // Connect mode hint banner
  let connectHint = document.getElementById('connect-hint');
  if (state.connectMode) {
    if (!connectHint) {
      connectHint = document.createElement('div');
      connectHint.id = 'connect-hint';
      connectHint.className = 'connect-hint-banner';
      connectHint.innerHTML = '🔗 連線模式：點擊第一個節點，再點擊第二個節點即可建立連線。按 Esc 取消。';
      document.getElementById('canvas-area').prepend(connectHint);
    }
  } else {
    if (connectHint) connectHint.remove();
  }

  const canvas = $('#canvas');
  const svg = $('#connections-svg');
  const area = $('#canvas-area');

  // ── Canvas Health Bar ──
  renderHealthBar();

  canvas.innerHTML = '';

  // Empty canvas welcome
  let emptyState = document.getElementById('canvas-empty-welcome');
  if (state.nodes.size === 0) {
    if (!emptyState) {
      emptyState = document.createElement('div');
      emptyState.id = 'canvas-empty-welcome';
      emptyState.className = 'canvas-empty-state';
      emptyState.innerHTML = `
        <div class="empty-icon">📦</div>
        <h3>開始規劃你的商品內容策略</h3>
        <p>每支影片建立一個節點，從主題發想到完整企劃一步步完成</p>
        <button class="empty-start-btn" id="empty-start-btn">＋ 建立第一個節點</button>
      `;
      area.appendChild(emptyState);
      document.getElementById('empty-start-btn').addEventListener('click', () => {
        showModal(area.offsetWidth / 2 - 120, 100);
      });
    }
  } else if (emptyState) {
    emptyState.remove();
  }

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
    // After innerHTML='' + appendChild, offsetWidth/Height may return 0 until
    // the browser completes layout.  Render once now with fallback dimensions,
    // then schedule a second pass after paint for pixel-perfect accuracy.
    renderConnections(svg);
    requestAnimationFrame(() => requestAnimationFrame(() => renderConnections(svg)));
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
  updateSmartHint();
}

function renderTopicView(container) {
  renderKanbanLanes(container);
  let idx = 0;
  for (const node of state.nodes.values()) {
    const el = buildNodeCard(node);
    if (!node.positions.topic) {
      node.positions.topic = { x: 60 + (idx % 4) * 280, y: 60 + Math.floor(idx / 4) * 220 };
    }
    const pos = node.positions.topic;
    el.style.left = pos.x + 'px';
    el.style.top = pos.y + 'px';
    idx++;

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

function renderKanbanLanes(container) {
  container.querySelectorAll('.kanban-lane').forEach(el => el.remove());
  const LANE_W = 360, LANE_GAP = 20;
  const STAGES = ['A', 'B', 'C', 'D'];
  const COLORS  = { A: '#3b82f6', B: '#10b981', C: '#f59e0b', D: '#8b5cf6' };
  const BG      = { A: 'rgba(59,130,246,0.03)', B: 'rgba(16,185,129,0.03)', C: 'rgba(245,158,11,0.03)', D: 'rgba(139,92,246,0.03)' };
  const LABELS  = { A: 'A 認知／吸引', B: 'B 評估／培育', C: 'C 信任／轉換', D: 'D 安心' };

  STAGES.forEach((stage, i) => {
    const lane = document.createElement('div');
    lane.className = `kanban-lane kanban-lane-${stage}`;
    lane.style.cssText = `left:${i * (LANE_W + LANE_GAP)}px;width:${LANE_W}px;background:${BG[stage]}`;
    lane.innerHTML = `<div class="kanban-lane-header"><span class="lane-dot" style="background:${COLORS[stage]}"></span><span class="lane-title">${LABELS[stage]}</span></div>`;
    container.appendChild(lane);
  });
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
  // Contextual tip for material view
  if (state.nodes.size > 0 && state.nodes.size <= 12) {
    const tip = document.createElement('div');
    tip.className = 'view-tip';
    tip.innerHTML = '<strong>💡 素材準備</strong>：把長片（深度內容）和短片（快速吸引）搭配使用。建議每支長片搭配 1-2 支短片當入口。';
    container.appendChild(tip);
  }

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

    if (col.querySelectorAll('.node-card').length === 0) {
      const emptyHint = document.createElement('div');
      emptyHint.className = 'column-empty-hint';
      emptyHint.textContent = '拖曳節點到此分類';
      col.appendChild(emptyHint);
    }

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
  // Contextual tip for journey view
  if (state.nodes.size > 0 && state.nodes.size <= 12) {
    const tip = document.createElement('div');
    tip.className = 'view-tip';
    tip.innerHTML = '<strong>💡 購買階段</strong>：確保每個階段都有影片。觀眾從「認知」→「評估」→「信任」→「安心」，缺任何一環都會斷裂。';
    container.appendChild(tip);
  }

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
  const stage = node.positions?.journey?.stage;
  el.className = 'node-card'
    + (node.isMain ? ' main-node' : '')
    + (node.id === state.selectedNodeId ? ' selected' : '')
    + (compact ? ' compact' : '')
    + (stage ? ` card-stage-${stage}` : '');
  el.dataset.nodeId = node.id;

  const jobClass = { '吸引': 'job-attract', '培育': 'job-nurture', '轉換': 'job-convert' }[node.main.job] || '';
  const connCount = state.connections.filter(c => c.from === node.id || c.to === node.id).length;

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

  const readiness = nodeReadiness(node);
  const readyClass = readiness >= 80 ? 'ready-green' : readiness >= 50 ? 'ready-yellow' : 'ready-red';

  el.innerHTML = `
    <div class="node-main">
      <div class="node-top-row">
        ${node.isMain ? '<span class="main-badge">主節點</span>' : ''}
        <span class="readiness-dot ${readyClass}" title="準備度 ${readiness}%"></span>
      </div>
      <div class="node-topic" title="${esc(node.main.topic)}">${esc(node.main.topic)}</div>
      <div class="node-meta">
        ${node.main.job ? `<span class="job-badge ${jobClass}">${esc(node.main.job)}</span>` : '<span class="job-badge job-unset">未指定</span>'}
        ${node.main.jobSecondary ? `<span class="job-badge-secondary ${{'吸引':'job-attract','培育':'job-nurture','轉換':'job-convert'}[node.main.jobSecondary] || ''}">${esc(node.main.jobSecondary)}</span>` : ''}
        ${node.main.cta ? `<span class="cta-text">CTA: ${esc(node.main.cta)}</span>` : ''}
      </div>
    </div>
    ${node.user ? `<div class="node-user">
      <div class="node-user-label">筆記</div>
      <div class="node-user-text" contenteditable="true" data-node-id="${node.id}">${esc(node.user)}</div>
    </div>` : ''}
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

  // Hover-to-highlight connections
  el.addEventListener('mouseenter', () => {
    state.hoveredNodeId = node.id;
    highlightConnections(node.id);
  });
  el.addEventListener('mouseleave', () => {
    state.hoveredNodeId = null;
    highlightConnections(state.selectedNodeId);
  });

  // Add connection handles (only in non-compact mode for topic free view)
  if (!compact) {
    ['top', 'right', 'bottom', 'left'].forEach(pos => {
      const handle = document.createElement('div');
      handle.className = `conn-handle conn-handle-${pos}`;
      handle.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        state.connDragState = {
          fromNodeId: node.id,
          startX: e.clientX,
          startY: e.clientY,
        };
        // Create temp SVG line
        const svg = document.getElementById('connections-svg');
        if (svg) {
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.id = 'conn-temp-line';
          line.classList.add('temp-line');
          const area = $('#canvas-area');
          const z = state.zoomLevel;
          line.setAttribute('x1', (e.clientX - area.getBoundingClientRect().left + area.scrollLeft) / z);
          line.setAttribute('y1', (e.clientY - area.getBoundingClientRect().top + area.scrollTop) / z);
          line.setAttribute('x2', line.getAttribute('x1'));
          line.setAttribute('y2', line.getAttribute('y1'));
          svg.appendChild(line);
        }
      });
      el.appendChild(handle);
    });
  }

  return el;
}

/* ── Edge connection point: determine which side to exit and snap to the
      midpoint of that side (XMind-style flush attachment).
      Endpoints extend 3px PAST the card border into the card interior.
      Since the SVG layer is behind cards (z-index 1 vs 2), these pixels
      are hidden, but they guarantee the line visually touches the border
      at every zoom level — no sub-pixel gap possible. ── */
function edgePoint(nx, ny, nw, nh, tx, ty) {
  const cx = nx + nw / 2, cy = ny + nh / 2;
  const dx = tx - cx,     dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: nx + nw - 3, y: cy, side: 'right' };

  // Determine exit side via aspect-ratio–weighted comparison
  const halfW = nw / 2, halfH = nh / 2;
  const absDx = Math.abs(dx), absDy = Math.abs(dy);
  let side;
  if (absDx * halfH >= absDy * halfW) {
    side = dx > 0 ? 'right' : 'left';
  } else {
    side = dy > 0 ? 'bottom' : 'top';
  }

  // Snap to midpoint of the chosen side, then extend 3px inward past border
  const inset = 3;
  switch (side) {
    case 'right':  return { x: nx + nw - inset, y: cy, side };
    case 'left':   return { x: nx + inset,      y: cy, side };
    case 'bottom': return { x: cx, y: ny + nh - inset, side };
    case 'top':    return { x: cx, y: ny + inset,      side };
  }
}

function renderConnections(svg) {
  while (svg.children.length > 1) svg.removeChild(svg.lastChild);

  for (const conn of state.connections) {
    const fromNode = state.nodes.get(conn.from);
    const toNode   = state.nodes.get(conn.to);
    if (!fromNode || !toNode) continue;

    // Use actual DOM element positions and dimensions for pixel-perfect alignment.
    // Stored positions (positions.topic) can diverge from CSS left/top after
    // drag, auto-arrange, or view transitions — reading the live DOM values
    // guarantees line endpoints match the on-screen card positions.
    const fEl = $(`.node-card[data-node-id="${conn.from}"]`);
    const tEl = $(`.node-card[data-node-id="${conn.to}"]`);
    const fp = fEl
      ? { x: parseFloat(fEl.style.left) || 0, y: parseFloat(fEl.style.top) || 0 }
      : fromNode.positions.topic;
    const tp = tEl
      ? { x: parseFloat(tEl.style.left) || 0, y: parseFloat(tEl.style.top) || 0 }
      : toNode.positions.topic;
    const fw = fEl ? (fEl.offsetWidth  || 280) : 280;
    const tw = tEl ? (tEl.offsetWidth  || 280) : 280;
    const fh = fEl ? (fEl.offsetHeight || 90) : 90;
    const th = tEl ? (tEl.offsetHeight || 90) : 90;

    // Fixed anchors: source always exits right-center, target always enters left-center
    const x1 = fp.x + fw;
    const y1 = fp.y + fh / 2;
    const x2 = tp.x;
    const y2 = tp.y + th / 2;

    let d;
    if (x2 >= x1 - 8) {
      // Forward (left→right): simple Z-elbow
      const midX = (x1 + x2) / 2;
      d = `M${x1},${y1} L${midX},${y1} L${midX},${y2} L${x2},${y2}`;
    } else {
      // Backward: U-turn routed above or below both cards
      const topClear = Math.min(fp.y, tp.y) - 24;
      const botClear = Math.max(fp.y + fh, tp.y + th) + 24;
      const bypassY  = Math.abs(y1 - topClear) <= Math.abs(y1 - botClear) ? topClear : botClear;
      d = `M${x1},${y1} L${x1+16},${y1} L${x1+16},${bypassY} L${x2-16},${bypassY} L${x2-16},${y2} L${x2},${y2}`;
    }

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

    const jobSecondaryOptions = ['', '吸引', '培育', '轉換'].map(j => {
      const desc = JOB_DESC[j] ? ` — ${JOB_DESC[j]}` : '';
      return `<option value="${j}" ${(node.main.jobSecondary || '') === j ? 'selected' : ''}>${j || '無'}${desc}</option>`;
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

    $('#panel-content').innerHTML = `
      <div class="detail-section">
        <label>主題</label>
        <input type="text" id="edit-topic" value="${esc(node.main.topic)}">
      </div>

      <div class="detail-row">
        <div class="detail-half">
          <label>主要用途</label>
          <select id="edit-job">${jobOptions}</select>
        </div>
        <div class="detail-half">
          <label>次要用途</label>
          <select id="edit-job-secondary">${jobSecondaryOptions}</select>
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

      <div class="checkbox-row">
        <label class="checkbox-label-inline">
          <input type="checkbox" id="edit-main" ${node.isMain ? 'checked' : ''}>
          <span>主節點</span>
          <span class="field-hint">— 這個系列最重要的核心影片</span>
        </label>
      </div>

      <div class="detail-section">
        <label>CTA <span class="field-hint-inline">— 影片結尾叫觀眾做的事（留言、點連結、追蹤…）</span></label>
        <input type="text" id="edit-cta" value="${esc(node.main.cta)}">
      </div>

      <div class="detail-divider"></div>

      <div class="detail-section">
        <label>💬 我知道的（隨手寫）</label>
        <textarea id="edit-user" rows="3" placeholder="材質、特色、你覺得好用的地方、價格...">${esc(node.user)}</textarea>
        <button class="expand-btn" id="btn-expand" title="根據你的筆記，用 AI 自動擴寫成影片企劃">✨ AI 擴寫企劃</button>
      </div>

      ${node.aiReceivedSummary ? `
      <div class="detail-divider"></div>
      <div class="ai-transparency-section">
        <details class="ai-transparency-details">
          <summary>📋 AI 收到的資訊</summary>
          <div class="ai-transparency-card">
            <div class="research-row"><span class="research-label">AI 理解</span><span>${esc(node.aiReceivedSummary)}</span></div>
            ${node.aiInputType ? `<div class="research-row"><span class="research-label">輸入類型</span><span>${esc({product:'產品型',concept:'概念型','pain-point':'痛點型',trend:'趨勢型'}[node.aiInputType] || node.aiInputType)}</span></div>` : ''}
            ${node.targetAudience ? `<div class="research-row"><span class="research-label">目標觀眾</span><span>${esc(node.targetAudience)}</span></div>` : ''}
          </div>
        </details>
      </div>
      ` : ''}

      ${research ? `
      <div class="detail-divider"></div>
      <details class="panel-accordion" open>
        <summary>📋 AI 研究摘要</summary>
        <div class="ai-research-card">
          ${research.positioning ? `<div class="research-row"><span class="research-label">定位</span><span>${esc(research.positioning)}</span></div>` : ''}
          ${research.features ? `<div class="research-row"><span class="research-label">特色</span><span>${esc(research.features)}</span></div>` : ''}
          ${research.competitors ? `<div class="research-row"><span class="research-label">競品</span><span>${esc(research.competitors)}</span></div>` : ''}
          ${research.priceRange ? `<div class="research-row"><span class="research-label">價格帶</span><span>${esc(research.priceRange)}</span></div>` : ''}
          ${research.audienceCares ? `<div class="research-row"><span class="research-label">觀眾在意</span><span>${esc(research.audienceCares)}</span></div>` : ''}
          ${research.searchKeywords ? `<div class="research-row"><span class="research-label">🔍 搜尋關鍵字</span><span class="search-keywords">${esc(research.searchKeywords)}</span></div>` : ''}
        </div>
      </details>
      ` : ''}

      ${(node.hooks?.length > 0) ? `
      <div class="detail-divider"></div>
      <details class="panel-accordion" open>
        <summary>🎤 建議 Hook — 3 種風格選一個</summary>
        ${node.hooks.map((h, i) => `
          <div class="hook-card">
            <span class="hook-style">${esc(h.style)}</span>
            <span class="hook-text">「${esc(h.text)}」</span>
          </div>
        `).join('')}
      </details>
      ` : (research?.suggestedHook ? `
      <div class="detail-divider"></div>
      <details class="panel-accordion">
        <summary>🎤 建議 Hook</summary>
        <div class="hook-card">
          <span class="hook-text">「${esc(research.suggestedHook)}」</span>
        </div>
      </details>
      ` : '')}

      ${angles.length > 0 ? `
      <div class="detail-divider"></div>
      <details class="panel-accordion" open>
        <summary>🎬 建議拍攝方向 (${angles.length})</summary>
        ${angles.map((a, i) => `
          <div class="angle-card">
            <div class="angle-header">
              <span class="angle-num">${i + 1}</span>
              <strong>${esc(a.title)}</strong>
              <button class="angle-dismiss-btn" data-angle-idx="${i}" title="移除此建議">✕</button>
            </div>
            <div class="angle-reason">→ 觀眾在意：${esc(a.why)}</div>
            ${a.howToShoot ? `<div class="angle-how">💡 ${esc(a.howToShoot)}</div>` : ''}
          </div>
        `).join('')}
      </details>
      ` : ''}

      ${(node.detailShots?.length > 0) ? `
      <div class="detail-divider"></div>
      <details class="panel-accordion">
        <summary>📸 產品細節拍攝清單 (${node.detailShots.length})</summary>
        ${node.detailShots.map((d, i) => `
          <div class="detail-shot-card">
            <div class="detail-shot-header">
              <span class="angle-num">📷</span>
              <strong>${esc(d.what)}</strong>
              <button class="detail-shot-dismiss-btn" data-shot-idx="${i}" title="移除">✕</button>
            </div>
            <div class="angle-reason">→ ${esc(d.why)}</div>
            ${d.cameraSetup ? `<div class="angle-how">🎥 ${esc(d.cameraSetup)}</div>` : ''}
          </div>
        `).join('')}
      </details>
      ` : ''}

      ${node.ecosystemNotes ? `
      <div class="detail-divider"></div>
      <details class="panel-accordion">
        <summary>🔗 和其他影片的關聯</summary>
        <div class="ecosystem-card">${esc(node.ecosystemNotes)}</div>
      </details>
      ` : ''}

      ${(research || angles.length > 0) ? `
      <div class="detail-divider"></div>
      <div class="ai-actions-section">
        ${research?.suggestedCta ? `
        <div class="angle-card angle-cta">
          <div class="angle-header"><span class="angle-num">📣</span><strong>建議 CTA</strong> <span class="field-hint-inline">— 影片結尾叫觀眾做的事</span></div>
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
        <button class="save-btn" id="btn-save-node">儲存變更</button>
      </div>
      <div class="detail-danger-zone">
        <button class="duplicate-btn" id="btn-duplicate-node">📋 複製節點</button>
        <button class="delete-btn" id="btn-delete-node">🗑 刪除此節點</button>
      </div>
    `;

    $('#btn-save-node').addEventListener('click', () => {
      const jobSecEl = $('#edit-job-secondary');
      updateNode(node.id, {
        main: {
          topic: $('#edit-topic').value,
          job: $('#edit-job').value,
          jobSecondary: jobSecEl ? jobSecEl.value : '',
          cta: $('#edit-cta').value,
        },
        user: $('#edit-user').value,
        isMain: $('#edit-main').checked,
        positions: {
          journey: { stage: $('#edit-stage').value },
          material: { column: $('#edit-material').value },
        },
      });
      render();
    });

    // Auto-save on change for all fields
    function autoSaveNode() {
      const jobSecEl = $('#edit-job-secondary');
      const updates = {
        main: {
          topic: $('#edit-topic').value,
          job: $('#edit-job').value,
          jobSecondary: jobSecEl ? jobSecEl.value : '',
          cta: $('#edit-cta').value,
        },
        user: $('#edit-user').value,
        isMain: $('#edit-main').checked,
        positions: {
          journey: { stage: $('#edit-stage').value },
          material: { column: $('#edit-material').value },
        },
      };
      updateNode(node.id, updates);
      // Show saved indicator
      const saveBtn = $('#btn-save-node');
      if (saveBtn) {
        saveBtn.textContent = '已儲存 ✓';
        saveBtn.classList.add('saved-flash');
        setTimeout(() => {
          saveBtn.textContent = '儲存變更';
          saveBtn.classList.remove('saved-flash');
        }, 1500);
      }
    }

    ['#edit-topic', '#edit-cta', '#edit-user'].forEach(sel => {
      const el = $(sel);
      if (el) el.addEventListener('blur', autoSaveNode);
    });
    ['#edit-job', '#edit-job-secondary', '#edit-stage', '#edit-material', '#edit-main'].forEach(sel => {
      const el = $(sel);
      if (el) el.addEventListener('change', autoSaveNode);
    });

    $('#btn-delete-node').addEventListener('click', () => {
      if (confirm('刪除此節點？')) {
        deleteNode(node.id);
        render();
      }
    });

    $('#btn-duplicate-node').addEventListener('click', () => {
      const newNode = createNode({
        topic: node.main.topic + ' (副本)',
        job: node.main.job,
        cta: node.main.cta,
        isMain: false,
      }, (node.positions.topic?.x || 100) + 30, (node.positions.topic?.y || 100) + 30);
      newNode.user = node.user;
      if (node.positions.journey?.stage) {
        newNode.positions.journey = { stage: node.positions.journey.stage };
      }
      if (node.positions.material?.column) {
        newNode.positions.material = { column: node.positions.material.column };
      }
      if (node.aiResearch) newNode.aiResearch = JSON.parse(JSON.stringify(node.aiResearch));
      if (node.filmingAngles?.length) newNode.filmingAngles = JSON.parse(JSON.stringify(node.filmingAngles));
      saveState();
      selectNode(newNode.id);
      render();
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

      // Save all current form fields BEFORE the async call
      // so renderPanel() won't wipe unsaved textarea content
      node.user = userText;
      node.main.topic = topic;
      node.main.job = $('#edit-job').value;
      node.main.cta = $('#edit-cta').value;
      saveState();

      btn.textContent = '🔄 查詢中...';
      btn.disabled = true;

      try {
        const result = await expandContent(topic, userText, node.main.job);
        if (result) {
          node.aiResearch = result.research;
          node.filmingAngles = result.angles || [];
          node.detailShots = result.detailShots || [];
          node.hooks = result.hooks || [];
          node.aiInputType = result.inputType || '';
          node.aiReceivedSummary = result.aiReceivedSummary || '';
          node.targetAudience = result.targetAudience || '';
          node.ecosystemNotes = result.ecosystemNotes || '';
          saveState();
          renderPanel();
        }
      } catch (err) {
        console.error('Expand failed:', err);
        btn.textContent = '❌ 查詢失敗，再試一次';
        btn.disabled = false;
      }
    });

    // Dismiss individual filming angles
    $$('.angle-dismiss-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.angleIdx, 10);
        if (node.filmingAngles && node.filmingAngles[idx] != null) {
          node.filmingAngles.splice(idx, 1);
          saveState();
          renderPanel(node);
        }
      });
    });

    // Dismiss individual detail shots
    $$('.detail-shot-dismiss-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.shotIdx, 10);
        if (node.detailShots && node.detailShots[idx] != null) {
          node.detailShots.splice(idx, 1);
          saveState();
          renderPanel(node);
        }
      });
    });

    // Adopt research results into user notes
    $('#btn-adopt-research')?.addEventListener('click', () => {
      const parts = [];
      if (node.aiResearch) {
        const r = node.aiResearch;
        if (r.positioning) parts.push(`定位：${r.positioning}`);
        if (r.features) parts.push(`特色：${r.features}`);
        if (r.competitors) parts.push(`競品：${r.competitors}`);
        if (r.searchKeywords) parts.push(`搜尋關鍵字：${r.searchKeywords}`);
      }
      if (node.hooks?.length > 0) {
        parts.push('Hook 選項：');
        node.hooks.forEach(h => parts.push(`- ${h.style}：${h.text}`));
      } else if (node.aiResearch?.suggestedHook) {
        parts.push(`Hook：${node.aiResearch.suggestedHook}`);
      }
      if (node.filmingAngles?.length > 0) {
        parts.push('拍攝方向：');
        node.filmingAngles.forEach((a, i) => {
          parts.push(`${i + 1}. ${a.title} → ${a.why}`);
        });
      }
      if (node.detailShots?.length > 0) {
        parts.push('產品細節拍攝：');
        node.detailShots.forEach(d => parts.push(`- ${d.what}：${d.why}`));
      }
      if (node.aiResearch?.suggestedCta) {
        node.main.cta = node.aiResearch.suggestedCta;
      }
      if (node.ecosystemNotes) {
        parts.push(`影片關聯：${node.ecosystemNotes}`);
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
      try {
        const result = await aiAsk(q, node.id);
        if (result) renderAskResult($('#ask-node-result'), result);
      } catch (err) {
        $('#ask-node-result').innerHTML = `<div class="ask-error">⚠️ AI 回覆失敗：${err.message || '請確認網路連線或稍後再試'}</div>`;
      } finally {
        btn.disabled = false;
        btn.textContent = '送出';
      }
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
      // Trigger causal chain reasoning
      suggestCausalNode(state.connectFrom, nodeId);
    }
    state.connectFrom = null;
    state.connectMode = false;
    render();
  }
}

// ── Causal Chain: Suggest node C when A→B is connected ──
async function suggestCausalNode(fromId, toId) {
  const fromNode = state.nodes.get(fromId);
  const toNode = state.nodes.get(toId);
  if (!fromNode || !toNode) return;

  try {
    const result = await aiAsk(
      `我剛把「${fromNode.main.topic}」和「${toNode.main.topic}」連在一起。根據這兩支影片的關聯，建議下一支可以延伸的影片主題是什麼？同時告訴我 End Screen 怎麼互相推薦。請用 new-node action 建議一個新節點。`,
      fromId
    );
    if (result?.actions?.length > 0) {
      for (const action of result.actions) {
        if (action.type === 'new-node' && action.topic) {
          // Add as ghost node
          const ghostId = 'ghost_causal_' + Date.now();
          state.ghostNodes.push({
            id: ghostId,
            type: 'new-node',
            topic: action.topic,
            job: action.job || '',
            stage: action.stage || 'A',
            reason: `由「${fromNode.main.topic}」→「${toNode.main.topic}」的連線推導` + (result.answer ? `：${result.answer}` : ''),
            connectTo: toId,
          });
        }
      }
      saveState();
      render();
    }
  } catch (err) {
    console.error('Causal chain suggestion failed:', err);
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

async function expandContent(topic, userNotes, job) {
  // Collect existing node topics for ecosystem awareness
  const existingNodes = [...state.nodes.values()]
    .filter(n => n.main.topic !== topic) // exclude self
    .map(n => ({ topic: n.main.topic, job: n.main.job }));

  // Try real API first, fall back to mock
  try {
    const res = await fetch('/api/expand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, userNotes, job, existingNodes }),
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
  // Generic fallback mock — only used when API is unavailable
  return {
    inputType: 'concept',
    aiReceivedSummary: `收到主題「${topic}」${userNotes ? `，使用者想拍：${userNotes.substring(0, 50)}` : ''}`,
    targetAudience: '對摩托車裝備感興趣的騎士',
    research: {
      positioning: `${topic} — 需要更多資訊來定位`,
      features: userNotes || '（請補充產品特色）',
      audienceCares: '品質、價格、實用性',
      searchKeywords: `${topic}推薦、${topic}評測、${topic}怎麼選`,
      suggestedCta: `你用過${topic}嗎？留言分享你的經驗`,
    },
    hooks: [
      { style: '好奇缺口', text: `關於${topic}，你可能不知道的三件事` },
      { style: '大膽宣言', text: `${topic}我用了一年，結論是...` },
      { style: '故事引入', text: `上次騎車遇到的事讓我重新想了${topic}這件事` },
    ],
    angles: [
      { title: '開箱 & 第一印象', why: '觀眾想看到實際產品的樣子', howToShoot: '從包裝到拿出來的完整過程' },
      { title: '實際使用心得', why: '真實使用感受比規格更有說服力', howToShoot: '記錄日常使用畫面，搭配旁白說感想' },
    ],
    detailShots: [],
    ecosystemNotes: '這是第一支影片，建議之後規劃相關的比較或教學類內容',
  };
}

// ── AI: Ask (global or node-specific) ──
async function aiAsk(question, focusNodeId) {
  const nodes = [...state.nodes.values()].map(n => ({
    id: n.id, topic: n.main.topic, job: n.main.job, cta: n.main.cta,
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

    // If input is too vague, skip auto-classification
    if (data.isVague) {
      // Show a hint that user should use AI expand
      console.log('Vague input detected, skipping auto-classify');
      return;
    }

    if (data.primaryJob && !node.main.job) node.main.job = data.primaryJob;
    if (data.secondaryJob && !node.main.jobSecondary) node.main.jobSecondary = data.secondaryJob;
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
    const res = await fetch('/api/brief', {
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

  // ── Dynamic keyword extraction from actual canvas content ──
  const existingTopics = nodes.map(n => n.main.topic);
  const titleText = nodes.map(n => n.main.topic).join(' ');

  // Extract meaningful words (2+ chars) from all titles
  const wordFreq = {};
  for (const title of existingTopics) {
    const words = title.split(/[\s：、—\-（）()\|｜]+|\bvs\b/i).filter(w => w.length >= 2);
    const unique = [...new Set(words)];
    for (const w of unique) {
      // Skip generic/stop words
      if (/^(新手|入門|指南|完整|如何|怎麼|什麼|一個|精華|剪輯|比較|評測|開箱|心得|使用|回饋)$/.test(w)) continue;
      wordFreq[w] = (wordFreq[w] || 0) + 1;
    }
  }

  // Words appearing in 2+ titles are likely brand/product names
  const commonWords = Object.entries(wordFreq)
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([w]) => w);

  // Main theme = most common word; brands = top few common words
  const themeWord = commonWords[0] || existingTopics[0]?.substring(0, 6) || '產品';
  const brandNames = commonWords.filter(w => w.length >= 2).slice(0, 3);

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
    // Find which brand/product this promotion is about (using dynamically extracted keywords)
    const promoBrands = brandNames.filter(k => promo.main.topic.includes(k) || (promo.user || '').includes(k));
    const promoTheme = commonWords.find(k => promo.main.topic.includes(k) || (promo.user || '').includes(k));

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
        const mainBrands = brandNames.filter(k => currentMain.main.topic.includes(k));
        const nodeCoversTheme = commonWords.some(k => node.main.topic.includes(k));

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
      const sharedBrands = brandNames.filter(k => orphan.main.topic.includes(k) && other.main.topic.includes(k));
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

  // Build dynamic stage templates based on actual canvas content
  const mainNode = nodes.find(n => n.isMain);
  const mainLabel = mainNode ? mainNode.main.topic.substring(0, 10) : themeWord;
  const stageTemplates = {
    A: [
      { tpl: (th) => `${th}新手常犯的 5 個錯誤`, job: '吸引', material: 'short', reason: 'A 認知階段缺內容，需要入門向吸引新觀眾' },
      { tpl: (th) => `一分鐘搞懂${th}怎麼選`, job: '吸引', material: 'short', reason: '短秒數科普片適合拉新流量' },
    ],
    B: [
      { tpl: (th, brands) => brands.length >= 2 ? `${brands.slice(0, 2).join(' vs ')} 規格實測對決` : `${th}品牌橫向評比`, job: '培育', material: 'long', reason: 'B 評估階段需要比較型內容幫觀眾做選擇' },
      { tpl: (th) => `${th}隱藏規格解讀：廠商不會告訴你的事`, job: '培育', material: 'long', reason: '深度分析建立專業形象' },
    ],
    C: [
      { tpl: (th, brands) => brands.length > 0 ? `${brands[0]} 30天真實使用紀錄` : `${th}一個月使用心得老實說`, job: '轉換', material: 'long', reason: 'C 信任階段需要長期使用驗證，讓觀眾相信不是業配' },
      { tpl: (th) => `${th}真實使用回饋合集`, job: '培育', material: 'short', reason: '第三方用戶見證比自己說更有說服力' },
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
          id: 'ghost_gap_' + stage + '_' + i,
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
  const allSuggestions = analyzeCanvas();
  // Filter out previously dismissed suggestions
  const suggestions = allSuggestions.filter(s => !state.dismissedSuggestions.has(s.id));
  state.ghostNodes = suggestions;
  state.lastAiReview = null; // Reset cached AI review
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
      state.lastAiReview = aiReview; // Cache for adopt/dismiss
      showReviewPanel(suggestions, aiReview);
    } else {
      // API returned error — remove loading indicator
      const el = document.querySelector('.ai-review-loading');
      if (el) el.remove();
    }
  } catch {
    // Network error or API unavailable — remove loading indicator
    const el = document.querySelector('.ai-review-loading');
    if (el) el.remove();
  }
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

  if (suggestions.length === 0 && (!aiReview || (!aiReview.issues?.length && !aiReview.quickWins?.length))) {
    const hasSkipped = state.dismissedSuggestions.size > 0;
    $('#review-content').innerHTML = `
      <div class="review-perfect">
        <div class="review-perfect-icon">✅</div>
        <div>目前畫布結構完整，沒有明顯缺口</div>
        ${hasSkipped ? `<button onclick="resetDismissedSuggestions()" style="margin-top:12px;padding:6px 16px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#64748b;cursor:pointer;font-size:13px">重新顯示已跳過的 ${state.dismissedSuggestions.size} 項建議</button>` : ''}
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
    if (aiReview.quickWins && aiReview.quickWins.length > 0) {
      html += `<div class="review-section-title">⚡ 馬上可以做</div>`;
      for (const qw of aiReview.quickWins) {
        html += `
          <div class="review-card review-card-quickwin">
            <div class="review-card-topic">✅ ${esc(qw.action)}</div>
            <div class="review-card-reason">${esc(qw.why)}</div>
          </div>`;
      }
    }
    if (aiReview.issues && aiReview.issues.length > 0) {
      html += `<div class="review-section-title">🤖 AI 策略分析</div>`;
      for (const issue of aiReview.issues) {
        const sevClass = issue.severity === 'high' ? 'sev-high' : issue.severity === 'medium' ? 'sev-medium' : 'sev-low';
        const typeEmoji = { duplicate: '🔁', gap: '🕳️', quality: '💡', conflict: '⚡', opportunity: '🎯' }[issue.type] || '📌';
        const newNodeHtml = issue.newNode ? `
            <div class="review-card-newnode">
              <span class="review-newnode-label">💡 建議新增：「${esc(issue.newNode.topic)}」</span>
              <span class="review-newnode-meta">${esc(issue.newNode.job)} · ${esc(issue.newNode.reason)}</span>
              <button class="ai-action-btn adopt review-create-node" data-topic="${esc(issue.newNode.topic)}" data-job="${esc(issue.newNode.job)}" data-stage="${esc(issue.newNode.stage)}">一鍵建立</button>
            </div>` : '';
        html += `
          <div class="review-card review-card-ai ${sevClass}">
            <div class="review-card-topic">${typeEmoji} ${esc(issue.title)}</div>
            <div class="review-card-reason">${esc(issue.detail)}</div>
            <div class="review-card-suggestion">💡 ${esc(issue.suggestion)}</div>
            ${newNodeHtml}
          </div>`;
      }
    }
    if (aiReview.publishOrder) {
      html += `
        <div class="review-card review-card-ai sev-low">
          <div class="review-card-topic">📅 建議發布順序</div>
          <div class="review-card-reason">${esc(aiReview.publishOrder)}</div>
        </div>`;
    }
    if (aiReview.strategyMap) {
      html += `
        <div class="review-card review-card-strategy">
          <div class="review-card-topic">🗺️ 接下來怎麼做</div>
          <div class="review-card-reason">${esc(aiReview.strategyMap)}</div>
        </div>`;
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
    try {
      const result = await aiAsk(q);
      if (result) renderAskResult($('#ask-global-result'), result);
    } catch (err) {
      $('#ask-global-result').innerHTML = `<div class="ask-error">⚠️ AI 回覆失敗：${err.message || '請確認網路連線或稍後再試'}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = '送出';
    }
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

  // Review one-click create node buttons
  $$('.review-create-node').forEach(btn => {
    btn.addEventListener('click', () => {
      const topic = btn.dataset.topic;
      const job = btn.dataset.job;
      const stage = btn.dataset.stage;
      const nodes = [...state.nodes.values()];
      const maxX = nodes.length > 0 ? nodes.reduce((m, n) => Math.max(m, n.positions.topic.x), 0) : 0;
      const node = createNode({ topic, job, jobSecondary: '', cta: '', isMain: false }, maxX + 240, 60);
      if (stage) node.positions.journey = { stage, order: 0 };
      saveState();
      render();
      btn.textContent = '已建立 ✓';
      btn.disabled = true;
    });
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

  // Remove from ghosts and refresh (preserve AI review)
  state.ghostNodes = state.ghostNodes.filter(g => g.id !== ghostId);
  render();
  showReviewPanel(state.ghostNodes, state.lastAiReview);
}

function dismissGhost(ghostId) {
  // Persist the dismissed ID so it won't reappear on next review
  state.dismissedSuggestions.add(ghostId);
  saveState();

  state.ghostNodes = state.ghostNodes.filter(g => g.id !== ghostId);
  render();
  // Re-render full panel to clean up empty sections and preserve AI review
  showReviewPanel(state.ghostNodes, state.lastAiReview);
}

function resetDismissedSuggestions() {
  state.dismissedSuggestions.clear();
  saveState();
  runGlobalReview();
}

function exportAllBriefs() {
  const nodes = [...state.nodes.values()];
  if (nodes.length === 0) return;

  const projectName = getProjectList().find(p => p.id === currentProjectId)?.name || '未命名';
  const longCount = nodes.filter(n => (n.positions.material?.column || 'long') === 'long').length;
  const shortCount = nodes.filter(n => n.positions.material?.column === 'short').length;

  let text = '# 內容企劃書\n';
  text += `專案：${projectName}\n`;
  text += `匯出時間：${new Date().toLocaleString('zh-TW')}\n`;
  text += `共 ${nodes.length} 支影片（長片 ${longCount}、短片 ${shortCount}）\n\n`;

  // Production order summary
  const scored = nodes.map(n => {
    let priority = 0;
    if (n.isMain) priority += 50;
    if (n.main.job === '吸引') priority += 30;
    else if (n.main.job === '培育') priority += 15;
    else if (n.main.job === '轉換') priority += 5;
    if ((n.positions.material?.column || 'long') === 'long') priority += 10;
    const conns = state.connections.filter(c => c.from === n.id || c.to === n.id).length;
    priority += conns * 8;
    return { node: n, priority };
  }).sort((a, b) => b.priority - a.priority);

  text += '## 建議出片順序\n';
  scored.forEach((s, i) => {
    const ready = nodeReadiness(s.node);
    const readyTag = ready >= 80 ? '[可開拍]' : ready >= 50 ? '[需補充]' : '[缺資訊]';
    text += `${i + 1}. ${s.node.main.topic} ${readyTag}\n`;
  });
  text += '\n---\n\n';

  // Per-node details
  for (const node of nodes) {
    text += `## ${node.main.topic}\n`;
    text += `影片目的：${node.main.job || '未指定'}\n`;
    text += `階段：${JOURNEY_LABELS[node.positions?.journey?.stage || 'A']}\n`;
    text += `素材：${MATERIAL_LABELS[node.positions?.material?.column || 'long']}\n`;
    text += `準備度：${nodeReadiness(node)}%\n`;
    if (node.main.cta) text += `CTA：${node.main.cta}\n`;
    if (node.isMain) text += `★ 主節點\n`;
    if (node.user) text += `\n備註：\n${node.user}\n`;

    if (node.aiResearch) {
      const r = node.aiResearch;
      text += '\nAI 研究：\n';
      if (r.positioning) text += `- 定位：${r.positioning}\n`;
      if (r.features) text += `- 特色：${r.features}\n`;
      if (r.competitors) text += `- 競品：${r.competitors}\n`;
      if (r.audienceCares) text += `- 觀眾在意：${r.audienceCares}\n`;
    }

    if (node.filmingAngles?.length > 0) {
      text += '\n拍攝方向：\n';
      node.filmingAngles.forEach((a, i) => {
        text += `${i+1}. ${a.title}：${a.why}\n`;
      });
    }

    text += '\n---\n\n';
  }

  // Download as text file
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `內容企劃_${projectName}_${new Date().toISOString().slice(0,10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
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

  // ── 01 影片目的 ──
  html += `<div class="brief-field brief-field-numbered">
    <div class="brief-field-label">01 影片目的</div>
    <div class="brief-field-value">${node.main.job ? esc(node.main.job + ' — ' + (JOB_DESC[node.main.job] || '')) : '⚠️ 未指定'}</div>
  </div>`;

  // ── 02 目標人物 Person ──
  let personText = '';
  if (r?.audienceCares) personText += r.audienceCares;
  if (stageDesc) personText += (personText ? '\n' : '') + '購買階段：' + stageLabel + ' — ' + stageDesc;
  html += `<div class="brief-field brief-field-numbered">
    <div class="brief-field-label">02 目標人物 Person</div>
    <div class="brief-field-value">${personText ? esc(personText) : '<span class="brief-empty">按「✨ AI 擴寫企劃」後自動填入</span>'}</div>
  </div>`;

  // ── 03 核心訊息 Core Message ──
  let coreMsg = '';
  if (r?.suggestedHook) coreMsg += r.suggestedHook;
  if (r?.positioning) coreMsg += (coreMsg ? '\n\n' : '') + '定位：' + r.positioning;
  html += `<div class="brief-field brief-field-numbered">
    <div class="brief-field-label">03 核心訊息 Core Message</div>
    <div class="brief-field-value">${coreMsg ? esc(coreMsg) : '<span class="brief-empty">按「✨ AI 擴寫企劃」後自動填入</span>'}</div>
  </div>`;

  // ── 04 必留元素 Non-Negotiables ──
  let nonNeg = '';
  if (hasAngles) {
    nonNeg = node.filmingAngles.map((a, i) =>
      `${i + 1}. ${a.title}\n   為什麼：${a.why}\n   拍法：${a.howToShoot || '待定'}`
    ).join('\n\n');
  }
  if (r?.features) nonNeg += (nonNeg ? '\n\n' : '') + '產品特色（不可刪）：' + r.features;
  if (r?.competitors) nonNeg += '\n競品參照：' + r.competitors;
  // Promo tie-in as non-negotiable
  if (promoNodes.length > 0) {
    nonNeg += '\n\n🔴 搭配活動（必須口播）：' + promoNodes.map(p => p.main.topic).join('、');
  }
  html += `<div class="brief-field brief-field-numbered">
    <div class="brief-field-label">04 必留元素 Non-Negotiables</div>
    <div class="brief-field-value">${nonNeg ? esc(nonNeg) : '<span class="brief-empty">按「✨ AI 擴寫企劃」後自動填入</span>'}</div>
  </div>`;

  // ── 05 短片潛力點 Short Clip Moments ──
  let shortClips = '';
  if (hasAngles) {
    shortClips = node.filmingAngles
      .filter(a => a.title.includes('實測') || a.title.includes('對比') || a.title.includes('測試') || a.title.includes('vs'))
      .map(a => `• ${a.title}（可獨立為 60 秒短片）`)
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
    html += `<div class="brief-hint">💡 先在節點詳情按「✨ AI 擴寫企劃」取得拍攝方向，才能展開腳本</div>`;
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
      person: personText,
      coreMessage: coreMsg,
      nonNegotiables: nonNeg,
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
    lines.push(`## 01 影片目的`);
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

  // Visual funnel
  const maxStage = Math.max(...Object.values(stageGroups).map(g => g.length), 1);
  html += `<div class="brief-field">
    <div class="brief-field-label">內容漏斗</div>
    <div class="brief-funnel">
      ${Object.entries(JOURNEY_LABELS).map(([k, label]) => {
        const count = stageGroups[k].length;
        const pct = Math.round((count / maxStage) * 100);
        const barClass = count === 0 ? 'funnel-empty' : '';
        return `<div class="funnel-row">
          <span class="funnel-label">${label}</span>
          <div class="funnel-bar-bg"><div class="funnel-bar funnel-${k} ${barClass}" style="width:${Math.max(pct, 8)}%">${count}</div></div>
        </div>`;
      }).join('')}
    </div>
  </div>`;

  // Publishing cadence suggestion
  const weeksNeeded = Math.ceil(longCount / 2) || 1;
  const totalWeeks = Math.ceil(nodes.length / 2) || 1;
  html += `<div class="brief-field">
    <div class="brief-field-label">建議發布節奏</div>
    <div class="brief-field-value">以每週 2 支的頻率，${nodes.length} 支內容約需 <strong>${totalWeeks} 週</strong>完成發布。建議先集中拍攝長片（${longCount} 支），再從中剪輯短片素材。</div>
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

  // Smart production order — prioritize by strategic importance
  const scored = nodes.map(n => {
    let priority = 0;
    // Main node gets highest priority
    if (n.isMain) priority += 50;
    // Attract content early to build audience
    if (n.main.job === '吸引') priority += 30;
    else if (n.main.job === '培育') priority += 15;
    else if (n.main.job === '轉換') priority += 5;
    // Long-form before short-form
    if ((n.positions.material?.column || 'long') === 'long') priority += 10;
    // Nodes with more connections are strategically important
    const conns = state.connections.filter(c => c.from === n.id || c.to === n.id).length;
    priority += conns * 8;
    // Nodes with AI research are more ready
    if (n.aiResearch) priority += 5;
    if (n.filmingAngles?.length) priority += 5;
    return { node: n, priority };
  }).sort((a, b) => b.priority - a.priority);

  html += `<div class="brief-field">
    <div class="brief-field-label">建議出片順序</div>
    <div class="brief-field-value brief-checklist">${scored.map((s, i) => {
      const mat = (s.node.positions.material?.column || 'long') === 'short' ? '🎬' : '📹';
      const ready = nodeReadiness(s.node);
      const readyIcon = ready >= 80 ? '🟢' : ready >= 50 ? '🟡' : '🔴';
      const job = s.node.main.job ? `[${s.node.main.job}]` : '';
      return `${i + 1}. ${mat} ${esc(s.node.main.topic)} ${job} ${readyIcon}`;
    }).join('<br>')}</div>
  </div>`;

  // Readiness legend
  html += `<div class="brief-hint" style="margin-top:4px;font-size:11px">🟢 可以開拍 · 🟡 還需補充 · 🔴 缺太多資訊</div>`;

  html += `<div class="brief-hint">💡 點選單一節點後按「生成 Brief」可查看該影片的詳細製作 Brief</div>`;

  html += `<div class="brief-export"><button class="export-btn" id="btn-export-brief">📋 匯出全部企劃書</button></div>`;

  $('#brief-content').innerHTML = html;

  // Bind export button if present
  const exportBtn = document.getElementById('btn-export-brief');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      exportAllBriefs();
    });
  }
}

// ── Auto-arrange nodes ──

function autoArrangeNodes() {
  const nodes = [...state.nodes.values()];
  if (nodes.length === 0) return;

  const STAGES = ['A', 'B', 'C', 'D'];
  const LANE_W = 360, LANE_GAP = 20, LANE_PAD_X = 40;
  const LANE_PAD_TOP = 80, CARD_H = 140, CARD_GAP_Y = 20;

  // Kahn's topological sort within a stage group (respects connection order)
  function topoSort(group) {
    if (group.length <= 1) return group;
    const ids  = new Set(group.map(n => n.id));
    const inDeg = new Map(group.map(n => [n.id, 0]));
    const adj   = new Map(group.map(n => [n.id, []]));
    for (const c of state.connections) {
      if (ids.has(c.from) && ids.has(c.to)) {
        adj.get(c.from).push(c.to);
        inDeg.set(c.to, inDeg.get(c.to) + 1);
      }
    }
    const queue  = group.filter(n => inDeg.get(n.id) === 0);
    const result = [];
    while (queue.length) {
      const n = queue.shift();
      result.push(n);
      for (const toId of (adj.get(n.id) || [])) {
        const d = inDeg.get(toId) - 1;
        inDeg.set(toId, d);
        if (d === 0) { const tn = group.find(x => x.id === toId); if (tn) queue.push(tn); }
      }
    }
    for (const n of group) if (!result.includes(n)) result.push(n); // cycles
    return result;
  }

  // Group by journey stage
  const byStage = Object.fromEntries(STAGES.map(s => [s, []]));
  const noStage = [];
  for (const n of nodes) {
    const s = n.positions?.journey?.stage;
    if (s && byStage[s]) byStage[s].push(n);
    else noStage.push(n);
  }

  // Snapshot current DOM positions for FLIP animation
  const oldPos = new Map();
  for (const n of nodes) {
    const el = document.querySelector(`.node-card[data-node-id="${n.id}"]`);
    if (el) oldPos.set(n.id, { x: parseFloat(el.style.left) || 0, y: parseFloat(el.style.top) || 0 });
  }

  // Assign new positions: main nodes first within each lane, then topo order
  for (let si = 0; si < STAGES.length; si++) {
    const laneLeft = si * (LANE_W + LANE_GAP);
    const sorted = topoSort(byStage[STAGES[si]]);
    sorted.sort((a, b) => (b.isMain ? 1 : 0) - (a.isMain ? 1 : 0));
    sorted.forEach((n, row) => {
      n.positions.topic = { x: laneLeft + LANE_PAD_X, y: LANE_PAD_TOP + row * (CARD_H + CARD_GAP_Y) };
    });
  }
  const rightX = STAGES.length * (LANE_W + LANE_GAP) + 20;
  noStage.forEach((n, i) => {
    n.positions.topic = { x: rightX, y: LANE_PAD_TOP + i * (CARD_H + CARD_GAP_Y) };
  });

  const canvasEl = document.getElementById('canvas-area');
  if (canvasEl) { canvasEl.scrollLeft = 0; canvasEl.scrollTop = 0; }
  saveState();
  render(); // creates elements at new positions

  // FLIP: teleport each card to its old position, then transition to new
  for (const [id, op] of oldPos) {
    const el = document.querySelector(`.node-card[data-node-id="${id}"]`);
    if (!el) continue;
    el.style.transition = 'none';
    el.style.left = op.x + 'px';
    el.style.top  = op.y + 'px';
    el.offsetHeight; // force reflow
    el.style.transition = 'left 0.45s ease, top 0.45s ease';
    const n = state.nodes.get(id);
    el.style.left = n.positions.topic.x + 'px';
    el.style.top  = n.positions.topic.y + 'px';
  }
  setTimeout(() => {
    document.querySelectorAll('.node-card').forEach(el => { el.style.transition = ''; });
    renderConnections(document.getElementById('connections-svg'));
  }, 480);
}

// ── Modal ──

function showModal(x, y) {
  state.pendingPosition = { x, y };
  const overlay = $('#modal-overlay');
  overlay.classList.remove('hidden');
  $('#input-topic').value = '';
  $('#input-cta').value = '';
  $('#input-main').checked = false;

  // Reset secondary job
  const jobSecondaryEl = $('#input-job-secondary');
  if (jobSecondaryEl) jobSecondaryEl.value = '';

  // Auto-fill Job when creating from a journey stage
  const stageAssign = state.pendingColumnAssign?.journey?.stage;
  if (stageAssign && STAGE_DEFAULT_JOB[stageAssign]) {
    $('#input-job').value = STAGE_DEFAULT_JOB[stageAssign];
  } else {
    $('#input-job').value = '';
  }

  const stageInput = $('#input-stage');
  if (stageInput) {
    stageInput.value = stageAssign || '';
  }

  setTimeout(() => $('#input-topic').focus(), 50);
}

function hideModal() {
  $('#modal-overlay').classList.add('hidden');
  state.pendingPosition = null;
}

// ── View Toast ──

function showViewToast(view) {
  const nodes = [...state.nodes.values()];
  if (nodes.length < 2) return;

  let msg = '';
  if (view === 'material') {
    const longCount = nodes.filter(n => (n.positions?.material?.column || 'long') === 'long').length;
    const shortCount = nodes.filter(n => n.positions?.material?.column === 'short').length;
    msg = `長片 ${longCount} 支 · 短片 ${shortCount} 支`;
  } else if (view === 'journey') {
    const stages = { A: 0, B: 0, C: 0, D: 0 };
    nodes.forEach(n => { stages[n.positions?.journey?.stage || 'A']++; });
    const covered = Object.values(stages).filter(v => v > 0).length;
    msg = `${covered}/4 個階段有覆蓋`;
  } else if (view === 'topic') {
    const connCount = state.connections.length;
    msg = connCount > 0 ? `${connCount} 條連線` : '尚無連線';
  }

  if (!msg) return;

  let toast = document.getElementById('view-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'view-toast';
    toast.className = 'view-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.remove('toast-fade');
  void toast.offsetWidth; // force reflow
  toast.classList.add('toast-show');
  setTimeout(() => {
    toast.classList.remove('toast-show');
    toast.classList.add('toast-fade');
  }, 2000);
}

// ── Events ──

function bindEvents() {
  $$('.tab').forEach(t => {
    t.addEventListener('click', () => {
      state.currentView = t.dataset.view;
      state.selectedNodeId = null;
      saveState();
      render();
      showViewToast(t.dataset.view);
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
    const stageVal = $('#input-stage') ? $('#input-stage').value : '';
    const jobSecondaryEl = $('#input-job-secondary');
    const node = createNode({
      topic,
      job: $('#input-job').value,
      jobSecondary: jobSecondaryEl ? jobSecondaryEl.value : '',
      cta: $('#input-cta').value,
      isMain: $('#input-main').checked,
    }, pos.x, pos.y);
    if (stageVal) {
      node.positions.journey = node.positions.journey || {};
      node.positions.journey.stage = stageVal;
      saveState();
    }
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

  // Canvas panning — drag empty space to move canvas
  const canvasArea = $('#canvas-area');
  canvasArea.addEventListener('pointerdown', (e) => {
    // Only pan when clicking empty canvas (not nodes, handles, etc.)
    if (e.target.closest('.node-card') || e.target.closest('.conn-handle') || e.target.closest('.ghost-node')) return;
    if (state.currentView !== 'topic' || state.topicMode !== 'free') return;
    if (e.button !== 0) return;
    state.panState = {
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: canvasArea.scrollLeft,
      scrollTop: canvasArea.scrollTop,
    };
    canvasArea.style.cursor = 'grabbing';
  });

  // Global move handler for canvas pan + connection drag
  document.addEventListener('pointermove', (e) => {
    // Canvas panning
    if (state.panState) {
      canvasArea.scrollLeft = state.panState.scrollLeft - (e.clientX - state.panState.startX);
      canvasArea.scrollTop = state.panState.scrollTop - (e.clientY - state.panState.startY);
    }

    // Connection drag
    if (state.connDragState) {
      const line = document.getElementById('conn-temp-line');
      if (line) {
        const area = $('#canvas-area');
        const z = state.zoomLevel;
        line.setAttribute('x2', (e.clientX - area.getBoundingClientRect().left + area.scrollLeft) / z);
        line.setAttribute('y2', (e.clientY - area.getBoundingClientRect().top + area.scrollTop) / z);
      }
    }
  });

  // Global up handler for canvas pan + connection drag
  document.addEventListener('pointerup', (e) => {
    // End canvas panning
    if (state.panState) {
      state.panState = null;
      canvasArea.style.cursor = '';
    }

    // End connection drag
    if (state.connDragState) {
      const fromId = state.connDragState.fromNodeId;
      state.connDragState = null;

      // Remove temp line
      const line = document.getElementById('conn-temp-line');
      if (line) line.remove();

      // Check if dropped on another node
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const targetCard = target?.closest('.node-card');
      if (targetCard) {
        const toId = targetCard.dataset.nodeId;
        if (toId && toId !== fromId) {
          const exists = state.connections.some(
            c => (c.from === fromId && c.to === toId) || (c.from === toId && c.to === fromId)
          );
          if (!exists) {
            state.connections.push({ from: fromId, to: toId });
            saveState();
            render();
            // Trigger causal chain reasoning
            suggestCausalNode(fromId, toId);
          }
        }
      }
    }
  });

  $('#btn-review').addEventListener('click', runGlobalReview);
  $('#btn-brief').addEventListener('click', generateBrief);
  $('#btn-auto-arrange')?.addEventListener('click', autoArrangeNodes);
  $('#btn-help')?.addEventListener('click', () => {
    const helpEl = document.getElementById('shortcut-overlay');
    if (helpEl) helpEl.classList.toggle('hidden');
  });

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
      const helpEl = document.getElementById('shortcut-overlay');
      if (helpEl && !helpEl.classList.contains('hidden')) {
        helpEl.classList.add('hidden');
        return;
      }
      if (!$('#modal-overlay').classList.contains('hidden')) {
        hideModal();
      } else {
        state.selectedNodeId = null;
        state.connectMode = false;
        state.connectFrom = null;
        render();
      }
    }
    if (e.key === '?' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA' && document.activeElement.tagName !== 'SELECT') {
      const helpEl = document.getElementById('shortcut-overlay');
      if (helpEl) helpEl.classList.toggle('hidden');
      return;
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

function formatRelativeTime(ts) {
  if (!ts) return '尚未修改';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '剛剛';
  if (mins < 60) return `${mins} 分鐘前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小時前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  return `${months} 個月前`;
}

// ── Project Picker ──

function showProjectPicker() {
  const picker = $('#project-picker');
  if (!picker) return;
  picker.classList.remove('hidden');
  $('#header').style.display = 'none';
  $('#main').style.display = 'none';

  const list = getProjectList();
  const pickerList = $('#picker-list');

  if (list.length === 0) {
    pickerList.innerHTML = '<p class="picker-empty">還沒有專案，點下方按鈕建立第一個</p>';
  } else {
    const sorted = [...list].sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    pickerList.innerHTML = sorted.map(p => {
      let count = p.nodeCount;
      if (count == null) {
        try {
          const data = JSON.parse(localStorage.getItem('content-canvas-' + p.id));
          count = data?.nodes?.length || 0;
        } catch { count = 0; }
      }
      const timeStr = formatRelativeTime(p.updatedAt || p.createdAt);
      return `<div class="picker-item" data-project-id="${p.id}">
        <div class="picker-item-left">
          <span class="picker-item-name">${esc(p.name)}</span>
          <span class="picker-item-meta">${count} 個節點 · ${timeStr}</span>
        </div>
        <div class="picker-item-actions">
          <button class="picker-rename-btn" data-id="${p.id}" data-name="${esc(p.name)}" title="重新命名">✏️</button>
          ${list.length > 1 ? `<button class="picker-delete-btn" data-id="${p.id}" title="刪除專案">🗑</button>` : ''}
        </div>
      </div>`;
    }).join('');

    pickerList.querySelectorAll('.picker-item').forEach(item => {
      item.addEventListener('click', () => {
        selectProjectFromPicker(item.dataset.projectId);
      });
    });
    pickerList.querySelectorAll('.picker-rename-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const projId = btn.dataset.id;
        const oldName = btn.dataset.name;
        showProjectNameModal('重新命名專案', oldName, (newName) => {
          const projList = getProjectList();
          const proj = projList.find(p => p.id === projId);
          if (proj) {
            proj.name = newName;
            saveProjectList(projList);
            showProjectPicker(); // refresh
          }
        });
      });
    });
    pickerList.querySelectorAll('.picker-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const projId = btn.dataset.id;
        if (confirm('確定刪除此專案？此操作無法復原。')) {
          deleteProject(projId);
          showProjectPicker(); // refresh
        }
      });
    });
  }

  // Re-bind new project button (clone to remove old listeners)
  const btn = $('#picker-new');
  const fresh = btn.cloneNode(true);
  btn.parentNode.replaceChild(fresh, btn);
  fresh.addEventListener('click', () => {
    showProjectNameModal('新增專案', '', (name) => {
      createProject(name);
      hideProjectPicker();
    });
  });
}

function selectProjectFromPicker(projectId) {
  switchProject(projectId);
  renderProjectSelect();
  hideProjectPicker();
}

function hideProjectPicker() {
  const picker = $('#project-picker');
  if (picker) picker.classList.add('hidden');
  $('#header').style.display = '';
  $('#main').style.display = '';
}

// ── Inline project name modal (replaces blocking prompt()) ──
function showProjectNameModal(title, defaultValue, onConfirm) {
  // Remove existing if any
  document.querySelector('.project-name-modal-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'project-name-modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:24px;width:360px;box-shadow:0 8px 32px rgba(0,0,0,0.2);">
      <h3 style="margin:0 0 16px;font-size:16px;color:#1e293b;">${esc(title)}</h3>
      <input type="text" class="pnm-input" value="${esc(defaultValue)}" placeholder="輸入專案名稱"
        style="width:100%;padding:10px 12px;border:1.5px solid #cbd5e1;border-radius:8px;font-size:15px;outline:none;box-sizing:border-box;">
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
        <button class="pnm-cancel" style="padding:8px 16px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;color:#64748b;cursor:pointer;font-size:14px;">取消</button>
        <button class="pnm-confirm" style="padding:8px 16px;border:none;border-radius:8px;background:#3b82f6;color:#fff;cursor:pointer;font-size:14px;font-weight:500;">確定</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('.pnm-input');
  input.focus();
  input.select();

  const close = () => overlay.remove();
  const confirm = () => {
    const val = input.value.trim();
    if (val) { onConfirm(val); close(); }
  };

  overlay.querySelector('.pnm-cancel').addEventListener('click', close);
  overlay.querySelector('.pnm-confirm').addEventListener('click', confirm);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirm();
    if (e.key === 'Escape') close();
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
}

// ── Init ──
async function init() {
  // Always bind events first (canvas/button handlers)
  bindEvents();

  // Project switcher events (header dropdown)
  $('#project-select')?.addEventListener('change', (e) => {
    switchProject(e.target.value);
  });

  $('#project-select')?.addEventListener('dblclick', () => {
    showProjectNameModal('重新命名專案', $('#project-select').selectedOptions[0]?.text || '', (name) => {
      renameProject(currentProjectId, name);
      renderProjectSelect();
    });
  });

  $('#btn-new-project')?.addEventListener('click', () => {
    showProjectNameModal('新增專案', '', (name) => {
      createProject(name);
    });
  });

  $('#btn-delete-project')?.addEventListener('click', () => {
    const list = getProjectList();
    const current = list.find(p => p.id === currentProjectId);
    if (confirm(`刪除專案「${current?.name}」？此操作無法復原。`)) {
      deleteProject(currentProjectId);
    }
  });

  // Bootstrap project system
  let list = getProjectList();
  if (list.length === 0) {
    // First time: migrate old data into a default project, go straight in
    const id = 'p' + Date.now();
    list = [{ id, name: '未命名專案', createdAt: Date.now(), updatedAt: Date.now(), nodeCount: 0 }];
    saveProjectList(list);
    const oldData = localStorage.getItem('content-canvas-v1');
    if (oldData) {
      localStorage.setItem('content-canvas-' + id, oldData);
    }
    currentProjectId = id;
    STORAGE_KEY = 'content-canvas-' + id;
    await loadState();
    renderProjectSelect();
    render();
    saveState();
  } else {
    // Show project picker — let user choose which project to open
    showProjectPicker();
  }
}
init();

window._cs = { state, render, saveState, createNode, deleteNode, updateNode, renderMaterialView, resolveCollisions, highlightConnections, analyzeCanvas, runGlobalReview, adoptGhost, dismissGhost, expandContent, renderPanel, createProject, deleteProject, switchProject, renderProjectSelect, generateScript, showProjectPicker, hideProjectPicker };
