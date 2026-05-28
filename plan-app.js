// ── State ──

const PROJECTS_KEY = 'content-plan-projects';
let PROJECT_KEY = 'content-plan-draft';

const state = {
  projectId: null,
  fragments: [],     // accumulated user inputs
  plan: null,        // { reasoning, videos, portfolioNote, aiQuestions }
  confirmedIds: new Set(),
  selectedVideoId: null,
  loading: false,
};

const STAGE_LABELS = { A: '認知', B: '評估', C: '信任', D: '安心' };
const STAGE_COLORS = { A: '#3b82f6', B: '#10b981', C: '#f59e0b', D: '#8b5cf6' };

// ── Persistence ──

function saveState() {
  const data = {
    fragments: state.fragments,
    plan: state.plan,
    confirmedIds: [...state.confirmedIds],
  };
  localStorage.setItem(PROJECT_KEY, JSON.stringify(data));
}

function loadState() {
  const raw = localStorage.getItem(PROJECT_KEY);
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    state.fragments = data.fragments || [];
    state.plan = data.plan || null;
    state.confirmedIds = new Set(data.confirmedIds || []);
  } catch {}
}

// ── Projects ──

function getProjects() {
  try { return JSON.parse(localStorage.getItem(PROJECTS_KEY)) || []; } catch { return []; }
}

function saveProjects(projects) {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
}

function createProject(name) {
  const projects = getProjects();
  const id = 'plan_' + Date.now();
  projects.push({ id, name: name || '未命名計劃', createdAt: Date.now() });
  saveProjects(projects);
  return id;
}

function switchProject(id) {
  state.projectId = id;
  PROJECT_KEY = `content-plan-${id}`;
  state.fragments = [];
  state.plan = null;
  state.confirmedIds = new Set();
  state.selectedVideoId = null;
  loadState();
  renderProjectSelect();
  renderPage();
}

function renderProjectSelect() {
  const sel = document.getElementById('project-select');
  const projects = getProjects();
  sel.innerHTML = projects.map(p =>
    `<option value="${p.id}"${p.id === state.projectId ? ' selected' : ''}>${p.name}</option>`
  ).join('');
}

// ── API ──

async function callPlanAPI() {
  if (!state.fragments.length) return;
  state.loading = true;
  renderLoading(true);

  try {
    const res = await fetch('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fragments: state.fragments,
        existingPlan: state.plan,
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    state.plan = await res.json();
    saveState();
  } catch (err) {
    showToast('❌ 計劃生成失敗：' + err.message);
  } finally {
    state.loading = false;
    renderLoading(false);
    renderPlan();
  }
}

// ── Render ──

function renderLoading(show) {
  document.getElementById('plan-loading').classList.toggle('hidden', !show);
  document.getElementById('plan-empty').classList.toggle('hidden', show || !!state.plan);
  document.getElementById('plan-content').classList.toggle('hidden', show || !state.plan);
}

function renderPage() {
  renderFragmentChips();
  renderLoading(false);
  if (state.plan) renderPlan();
  else document.getElementById('plan-empty').classList.remove('hidden');
}

function renderFragmentChips() {
  const el = document.getElementById('fragment-chips');
  if (!state.fragments.length) { el.innerHTML = ''; return; }
  el.innerHTML = state.fragments.map((f, i) => `
    <div class="fragment-chip">
      <span class="chip-text">${esc(f.length > 60 ? f.slice(0, 60) + '…' : f)}</span>
      <button class="chip-remove" data-idx="${i}" title="移除">✕</button>
    </div>
  `).join('');
  el.querySelectorAll('.chip-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      state.fragments.splice(parseInt(btn.dataset.idx), 1);
      saveState();
      if (state.fragments.length > 0) callPlanAPI();
      else { state.plan = null; saveState(); renderPage(); }
    });
  });
}

function renderPlan() {
  const plan = state.plan;
  if (!plan) return;

  document.getElementById('plan-empty').classList.add('hidden');
  document.getElementById('plan-content').classList.remove('hidden');

  // Reasoning
  document.getElementById('plan-reasoning-text').textContent = plan.reasoning || '';

  // AI questions
  const qBlock = document.getElementById('ai-questions-block');
  const qList = document.getElementById('ai-questions-list');
  if (plan.aiQuestions?.length > 0) {
    qBlock.classList.remove('hidden');
    qList.innerHTML = plan.aiQuestions.map(q => `
      <div class="ai-question-item">
        <span class="q-icon">?</span>
        <span>${esc(q)}</span>
        <button class="q-answer-btn" data-q="${esc(q)}">回答這個問題</button>
      </div>
    `).join('');
    qList.querySelectorAll('.q-answer-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = document.getElementById('main-input');
        input.value = '';
        input.focus();
        input.placeholder = btn.dataset.q;
      });
    });
  } else {
    qBlock.classList.add('hidden');
  }

  // Video grid
  const grid = document.getElementById('video-grid');
  grid.innerHTML = (plan.videos || []).map(v => renderVideoCard(v)).join('');
  grid.querySelectorAll('.video-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.btn-confirm-card')) return;
      openVideoPanel(card.dataset.id);
    });
  });
  grid.querySelectorAll('.btn-confirm-card').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      confirmVideo(btn.dataset.id);
    });
  });

  // Portfolio note
  document.getElementById('portfolio-note-text').textContent = plan.portfolioNote || '';

  showToast(`✅ 計劃已更新 — ${plan.videos?.length || 0} 支影片`);
}

function renderVideoCard(v) {
  const confirmed = state.confirmedIds.has(v.id);
  const stageColor = STAGE_COLORS[v.stage] || '#64748b';
  const confidenceMap = { high: '●', medium: '◑', low: '○' };
  const confidenceTitle = { high: '推導可信度高', medium: '部分推測', low: '資訊不足，需補充' };

  return `
    <div class="video-card${confirmed ? ' confirmed' : ''}" data-id="${v.id}">
      <div class="card-meta">
        <span class="stage-badge" style="background:${stageColor}20;color:${stageColor};border-color:${stageColor}40">
          ${v.stage} ${STAGE_LABELS[v.stage] || ''}
        </span>
        <span class="format-badge">${v.format === 'short' ? '短片' : '長片'}</span>
        <span class="confidence-dot ${v.confidence}" title="${confidenceTitle[v.confidence] || ''}">${confidenceMap[v.confidence] || '●'}</span>
        ${confirmed ? '<span class="confirmed-tag">✓ 已確認</span>' : ''}
      </div>
      <div class="card-topic">${esc(v.topic)}</div>
      <div class="card-insight">${esc(v.insight)}</div>
      <div class="card-audience">👤 ${esc(v.audience)}</div>
      ${v.aiNeeds ? `<div class="card-needs">⚠ AI 需要：${esc(v.aiNeeds)}</div>` : ''}
      <div class="card-actions">
        <span class="card-hint">點擊查看完整草稿</span>
        ${!confirmed
          ? `<button class="btn-confirm-card" data-id="${v.id}">✓ 確認這支</button>`
          : `<button class="btn-brief-card" data-id="${v.id}" onclick="event.stopPropagation();showBrief('${v.id}')">查看 Brief</button>`
        }
      </div>
    </div>
  `;
}

function openVideoPanel(videoId) {
  const plan = state.plan;
  if (!plan) return;
  const v = plan.videos?.find(x => x.id === videoId);
  if (!v) return;

  state.selectedVideoId = videoId;
  const confirmed = state.confirmedIds.has(videoId);
  const stageColor = STAGE_COLORS[v.stage] || '#64748b';

  const panel = document.getElementById('video-panel');
  const btnConfirm = document.getElementById('btn-confirm-video');
  btnConfirm.textContent = confirmed ? '查看 Brief' : '✓ 確認這支，生成 Brief';
  btnConfirm.onclick = () => confirmed ? showBrief(videoId) : confirmVideo(videoId);

  document.getElementById('panel-body').innerHTML = `
    <div class="panel-video-header">
      <span class="stage-badge" style="background:${stageColor}20;color:${stageColor};border-color:${stageColor}40">
        ${v.stage} ${STAGE_LABELS[v.stage] || ''}
      </span>
      <span class="format-badge">${v.format === 'short' ? '短片' : '長片'}</span>
    </div>

    <h2 class="panel-topic">${esc(v.topic)}</h2>

    <div class="panel-section">
      <div class="section-label">洞見</div>
      <div class="section-body insight-body">${esc(v.insight)}</div>
    </div>

    <div class="panel-section">
      <div class="section-label">目標觀眾</div>
      <div class="section-body">${esc(v.audience)}</div>
    </div>

    <div class="panel-section">
      <div class="section-label">Hook（前三秒）</div>
      <div class="section-body hook-body">「${esc(v.hook)}」</div>
    </div>

    <div class="panel-section">
      <div class="section-label">拍攝方向</div>
      <div class="angles-list">
        ${(v.angles || []).map((a, i) => `
          <div class="angle-item">
            <div class="angle-title">${i + 1}. ${esc(a.title)}</div>
            <div class="angle-why">→ 觀眾在意：${esc(a.why)}</div>
            <div class="angle-how">📷 ${esc(a.how)}</div>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="panel-section">
      <div class="section-label">CTA</div>
      <div class="section-body">${esc(v.cta)}</div>
    </div>

    ${v.aiNeeds ? `
    <div class="panel-section needs-section">
      <div class="section-label">⚠ AI 還需要</div>
      <div class="section-body">${esc(v.aiNeeds)}</div>
    </div>` : ''}

    <div class="redirect-block">
      <div class="section-label">調整這支影片的方向</div>
      <textarea id="redirect-input" class="redirect-input" rows="2"
        placeholder="例：角度要更強調長期使用，不要只說開箱。觀眾是已經有包的人，在考慮換包…"></textarea>
      <button id="btn-redirect" class="redirect-btn">更新這支 ↺</button>
    </div>
  `;

  document.getElementById('btn-redirect').addEventListener('click', () => {
    const note = document.getElementById('redirect-input').value.trim();
    if (!note) return;
    addFragment(`關於「${v.topic}」的調整：${note}`);
  });

  panel.classList.remove('hidden');
}

function confirmVideo(videoId) {
  state.confirmedIds.add(videoId);
  saveState();
  renderPlan();
  openVideoPanel(videoId);
  showBrief(videoId);
}

function showBrief(videoId) {
  const v = state.plan?.videos?.find(x => x.id === videoId);
  if (!v) return;

  const stageColor = STAGE_COLORS[v.stage] || '#64748b';

  document.getElementById('brief-body').innerHTML = `
    <div class="brief-section">
      <div class="brief-field-label">影片主題</div>
      <div class="brief-field-value">${esc(v.topic)}</div>
    </div>
    <div class="brief-section">
      <div class="brief-field-label">洞見（為什麼拍）</div>
      <div class="brief-field-value insight-body">${esc(v.insight)}</div>
    </div>
    <div class="brief-section">
      <div class="brief-field-label">目標觀眾</div>
      <div class="brief-field-value">${esc(v.audience)}</div>
    </div>
    <div class="brief-section">
      <div class="brief-field-label">購買旅程定位</div>
      <div class="brief-field-value">
        <span class="stage-badge" style="background:${stageColor}20;color:${stageColor};border-color:${stageColor}40">
          ${v.stage} ${STAGE_LABELS[v.stage] || ''}
        </span>
        — ${esc(v.stageReason || '')}
      </div>
    </div>
    <div class="brief-section">
      <div class="brief-field-label">Hook（前三秒）</div>
      <div class="brief-field-value hook-body">「${esc(v.hook)}」</div>
    </div>
    <div class="brief-section">
      <div class="brief-field-label">拍攝方向</div>
      <div class="brief-angles">
        ${(v.angles || []).map((a, i) => `
          <div class="brief-angle">
            <strong>${i + 1}. ${esc(a.title)}</strong>
            <div>→ ${esc(a.why)}</div>
            <div>📷 ${esc(a.how)}</div>
          </div>
        `).join('')}
      </div>
    </div>
    <div class="brief-section">
      <div class="brief-field-label">CTA</div>
      <div class="brief-field-value">${esc(v.cta)}</div>
    </div>
  `;

  document.getElementById('brief-overlay').classList.remove('hidden');

  document.getElementById('btn-copy-brief').onclick = () => {
    const text = buildBriefText(v);
    navigator.clipboard.writeText(text).then(() => showToast('✅ Brief 已複製'));
  };
}

function buildBriefText(v) {
  const stage = `${v.stage} ${STAGE_LABELS[v.stage] || ''}`;
  const angles = (v.angles || []).map((a, i) =>
    `${i + 1}. ${a.title}\n   → ${a.why}\n   📷 ${a.how}`
  ).join('\n');

  return `【${v.topic}】

＝ 為什麼拍這支 ＝
${v.insight}

＝ 目標觀眾 ＝
${v.audience}

＝ 定位 ＝
${stage} — ${v.stageReason || ''}

＝ Hook（前三秒）＝
「${v.hook}」

＝ 拍攝方向 ＝
${angles}

＝ CTA ＝
${v.cta}`;
}

function addFragment(text) {
  state.fragments.push(text);
  document.getElementById('main-input').value = '';
  saveState();
  renderFragmentChips();
  closePanels();
  callPlanAPI();
}

function closePanels() {
  document.getElementById('video-panel').classList.add('hidden');
  document.getElementById('brief-overlay').classList.add('hidden');
  state.selectedVideoId = null;
}

// ── Utils ──

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(msg) {
  let el = document.getElementById('plan-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'plan-toast';
    el.className = 'plan-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('visible'), 2800);
}

// ── Events ──

function bindEvents() {
  document.getElementById('btn-generate').addEventListener('click', () => {
    const input = document.getElementById('main-input').value.trim();
    if (!input) return;
    addFragment(input);
  });

  document.getElementById('main-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      const input = e.target.value.trim();
      if (input) addFragment(input);
    }
  });

  document.getElementById('panel-close').addEventListener('click', () => {
    document.getElementById('video-panel').classList.add('hidden');
    state.selectedVideoId = null;
  });

  document.getElementById('brief-close').addEventListener('click', () => {
    document.getElementById('brief-overlay').classList.add('hidden');
  });

  document.getElementById('btn-new-project').addEventListener('click', () => {
    const name = prompt('新計劃名稱：');
    if (!name?.trim()) return;
    const id = createProject(name.trim());
    switchProject(id);
  });

  document.getElementById('btn-delete-project').addEventListener('click', () => {
    const projects = getProjects();
    if (projects.length <= 1) { alert('至少保留一個計劃'); return; }
    const current = projects.find(p => p.id === state.projectId);
    if (!confirm(`刪除計劃「${current?.name}」？此操作無法復原。`)) return;
    const remaining = projects.filter(p => p.id !== state.projectId);
    saveProjects(remaining);
    localStorage.removeItem(PROJECT_KEY);
    switchProject(remaining[0].id);
  });

  document.getElementById('project-select').addEventListener('change', (e) => {
    switchProject(e.target.value);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePanels();
  });
}

// ── Project picker (first time) ──

function showProjectPicker() {
  const picker = document.getElementById('project-picker');
  const list = document.getElementById('picker-list');
  const projects = getProjects();

  list.innerHTML = projects.map(p => `
    <div class="picker-item" data-id="${p.id}">
      <div class="picker-name">${esc(p.name)}</div>
      <div class="picker-meta">${(p.plan?.videos?.length || 0)} 支影片計劃</div>
    </div>
  `).join('');

  list.querySelectorAll('.picker-item').forEach(item => {
    item.addEventListener('click', () => {
      picker.classList.add('hidden');
      switchProject(item.dataset.id);
    });
  });

  document.getElementById('picker-new').addEventListener('click', () => {
    const name = prompt('新計劃名稱：') || '未命名計劃';
    const id = createProject(name);
    picker.classList.add('hidden');
    switchProject(id);
  });

  picker.classList.remove('hidden');
}

// ── Boot ──

function boot() {
  // Version badge
  fetch('/api/version').then(r => r.json()).then(v => {
    document.getElementById('version-badge').textContent = `${v.env} · ${v.commit}`;
  }).catch(() => {});

  let projects = getProjects();
  if (projects.length === 0) {
    const id = createProject('未命名計劃');
    projects = getProjects();
    switchProject(id);
    bindEvents();
    return;
  }

  if (projects.length === 1) {
    switchProject(projects[0].id);
    bindEvents();
    return;
  }

  // Multiple projects → show picker
  renderProjectSelect();
  showProjectPicker();
  bindEvents();
}

boot();
