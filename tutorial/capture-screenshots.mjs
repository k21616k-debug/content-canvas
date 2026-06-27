import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS = path.join(__dirname, 'screenshots');
const BASE = 'http://localhost:3456';
const PASSWORD = process.env.CANVAS_GATE_PASSWORD;
if (!PASSWORD) {
  console.error('Set CANVAS_GATE_PASSWORD env var before running (the content-canvas password-gate value).');
  process.exit(1);
}

async function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
let shotIdx = 0;

async function shot(page, name) {
  shotIdx++;
  const num = String(shotIdx).padStart(2, '0');
  const filename = `${num}-${name}.png`;
  await delay(400);
  await page.screenshot({ path: path.join(SCREENSHOTS, filename), fullPage: false });
  console.log(`  [${num}] ${filename}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();

  // ── Scene 01: Password Gate + Hub ──
  console.log('\n=== Scene 01: Hub ===');
  await page.goto(BASE);
  await delay(300);
  await shot(page, 'password-gate');

  await page.fill('#gate-input', PASSWORD);
  await page.click('#gate-submit');
  await delay(600);
  await shot(page, 'hub');

  // ── Scene 02: Enter Product Canvas ──
  console.log('\n=== Scene 02: Product Canvas ===');
  await page.click('a[href="product.html"]');
  await delay(1500);
  // Take whatever default view loads
  await shot(page, 'canvas-default');

  // ── Scene 03: Material View (likely default) ──
  console.log('\n=== Scene 03: Material View ===');
  await page.click('button[data-view="material"]');
  await delay(600);
  await shot(page, 'view-material');

  // ── Scene 04: Add Node Modal ──
  console.log('\n=== Scene 04: Add Node Modal ===');
  // The ＋ buttons in material view columns
  const addBtns = await page.$$('.column button');
  // Or use the modal trigger via JS
  await page.evaluate(() => {
    document.getElementById('modal-overlay').classList.remove('hidden');
  });
  await delay(400);
  await shot(page, 'modal-empty');

  // Fill form
  await page.fill('#input-topic', 'SHOEI Z-8 vs GT-Air 3 完整對比');
  await page.selectOption('#input-job', '培育');
  await page.fill('#input-cta', '留言你最在意的功能');
  await delay(300);
  await shot(page, 'modal-filled');

  // Close modal (don't add, keep existing data)
  await page.click('#modal-cancel');
  await delay(400);

  // ── Scene 05: Click Node → Panel ──
  console.log('\n=== Scene 05: Node Panel ===');
  const firstCard = await page.$('.node-card');
  if (firstCard) {
    await firstCard.click();
    await delay(800);
    await shot(page, 'panel-open');
  }

  // ── Scene 06: AI Research (inject mock data) ──
  console.log('\n=== Scene 06: AI Research ===');
  await page.evaluate(() => {
    const first = window._cs.state.nodes.values().next().value;
    if (first) {
      if (!first.aiResearch) {
        first.aiResearch = {
          positioning: '騎士背包市場混亂，觀眾分不清軟包/硬殼/防水的差別跟適用場景。這支的價值是「幫觀眾建立分類框架」',
          features: '三種分類：軟包（通勤日用，輕便防護低）、硬殼（長途賽道，防摔重）、防水包（雨天探險，密封散熱差）',
          competitors: 'YouTube 繁中搜「騎士背包推薦」前十名都是單品開箱，沒有分類教學角度',
          audienceCares: '會不會晃、能不能放筆電、下雨怎麼辦、預算多少合理',
          suggestedHook: '騎車背包老是晃？因為你根本選錯類型了',
          suggestedCta: '留言你現在騎車背什麼包'
        };
      }
      if (!first.filmingAngles || first.filmingAngles.length === 0) {
        first.filmingAngles = [
          { title: '三種背包外觀差異', why: '讓觀眾一眼看懂分類', howToShoot: '三包並排特寫' },
          { title: '實際騎乘晃動測試', why: '觀眾最在意的痛點', howToShoot: '車上 GoPro 前後對比' },
          { title: '防水實測淋水挑戰', why: '視覺衝擊力強', howToShoot: '慢動作潑水特寫' },
        ];
      }
      window._cs.saveState();
      window._cs.renderPanel(first.id);
    }
  });
  await delay(600);

  // Panel top (research header)
  await page.evaluate(() => {
    const pd = document.getElementById('panel-detail');
    if (pd) pd.scrollTop = 0;
  });
  await delay(300);
  await shot(page, 'research-top');

  // Scroll to angles
  await page.evaluate(() => {
    const pd = document.getElementById('panel-detail');
    if (pd) pd.scrollTop = 500;
  });
  await delay(300);
  await shot(page, 'research-angles');

  // ── Scene 07: Brief ──
  console.log('\n=== Scene 07: Brief ===');
  // Inject brief data
  await page.evaluate(() => {
    const first = window._cs.state.nodes.values().next().value;
    if (first && !first.aiBrief) {
      first.aiBrief = {
        hook: '騎車背包老是晃、東西被壓壞？其實不是包的問題，是你根本選錯類型了。',
        painPoints: '市面上背包百百種，但騎士需求完全不同。通勤要快取、長途要防摔、雨天要防水。',
        anglesUsed: '軟包 vs 硬殼 vs 防水三大類實測對比：外觀、騎乘晃動、防水能力。',
        ctaScript: '留言你現在騎車背什麼包，我幫你診斷適不適合！'
      };
      window._cs.saveState();
    }
  });

  // Click Brief tab
  const allTabs = await page.$$('.panel-tab');
  for (const tab of allTabs) {
    const txt = await tab.textContent();
    if (txt && txt.includes('Brief')) {
      await tab.click();
      await delay(600);
      break;
    }
  }
  await shot(page, 'brief');

  // ── Scene 08: Journey View ──
  console.log('\n=== Scene 08: Journey View ===');
  // Close panel for cleaner screenshots
  try { await page.click('#panel-close', { timeout: 2000 }); } catch {}
  try { await page.click('#brief-close', { timeout: 2000 }); } catch {}
  await delay(300);

  await page.click('button[data-view="journey"]');
  await delay(600);
  await shot(page, 'view-journey');

  // ── Scene 09: Back to Material View ──
  console.log('\n=== Scene 09: Material Full ===');
  await page.click('button[data-view="material"]');
  await delay(600);
  await shot(page, 'view-material-full');

  // ── Scene 10: Connections ──
  console.log('\n=== Scene 10: Connections ===');
  // Add connections if none exist
  await page.evaluate(() => {
    if (window._cs.state.connections.length === 0) {
      const ids = [...window._cs.state.nodes.keys()];
      if (ids.length >= 3) {
        window._cs.state.connections.push({ from: ids[0], to: ids[1] });
        window._cs.state.connections.push({ from: ids[0], to: ids[2] });
        window._cs.saveState();
        window._cs.render();
      }
    }
  });
  await delay(500);
  // Click a node to highlight connections
  const card = await page.$('.node-card');
  if (card) { await card.click(); await delay(500); }
  await shot(page, 'connections');

  // ── Scene 11: AI Review ──
  console.log('\n=== Scene 11: AI Review ===');
  await page.evaluate(() => {
    const suggestions = window._cs.analyzeCanvas();
    window._cs.state.ghostNodes = suggestions;
    window._cs.state.selectedNodeId = null;

    ['panel-empty','panel-detail','panel-brief'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
    document.getElementById('panel-review')?.classList.remove('hidden');

    const review = {
      overallScore: 7,
      summary: '整體結構不錯，但 D 安心階段偏薄，建議補一支購買指南。',
      issues: [
        { type: 'gap', severity: 'high', title: 'D 階段缺口', detail: 'D 安心階段只有一支促銷短片，缺乏購買決策類內容。', suggestion: '新增「騎士背包哪裡買最划算？通路比較」' },
        { type: 'opportunity', severity: 'medium', title: '短片比例可提高', detail: '短片是演算法推薦利器，目前比例偏低。', suggestion: '從三種背包對比中各剪一支 60 秒短片' },
        { type: 'quality', severity: 'low', title: 'CTA 可更具體', detail: '部分影片 CTA 偏通用。', suggestion: '改成和影片主題直接相關的互動引導' }
      ]
    };

    const scoreColor = '#22c55e';
    let html = `<div class="ai-review-header">
      <div class="ai-review-score" style="border-color:${scoreColor};color:${scoreColor}">${review.overallScore}/10</div>
      <div class="ai-review-summary">${review.summary}</div>
    </div>`;
    html += '<div class="review-section-title">\u{1F916} AI 策略分析</div>';
    for (const issue of review.issues) {
      const sc = issue.severity === 'high' ? 'sev-high' : issue.severity === 'medium' ? 'sev-medium' : 'sev-low';
      const em = { gap: '\u{1F573}️', opportunity: '\u{1F3AF}', quality: '\u{1F4A1}' }[issue.type] || '\u{1F4CC}';
      html += `<div class="review-card review-card-ai ${sc}">
        <div class="review-card-topic">${em} ${issue.title}</div>
        <div class="review-card-reason">${issue.detail}</div>
        <div class="review-card-suggestion">\u{1F4A1} ${issue.suggestion}</div>
      </div>`;
    }

    if (suggestions.length > 0) {
      html += '<div class="review-section-title">\u{1F9E9} 規則建議</div>';
      for (const s of suggestions.slice(0, 3)) {
        html += `<div class="review-card"><div class="review-card-topic">${s.main?.topic || ''}</div><div class="review-card-reason">${s.reason || ''}</div></div>`;
      }
    }

    document.getElementById('review-content').innerHTML = html;
    window._cs.render();
  });
  await delay(600);
  await shot(page, 'ai-review');

  // Scroll review
  await page.evaluate(() => {
    const rp = document.getElementById('panel-review');
    if (rp) rp.scrollTop = 300;
  });
  await delay(300);
  await shot(page, 'ai-review-detail');

  // ── Scene 12: Hub Return ──
  console.log('\n=== Scene 12: Return to Hub ===');
  await page.click('.back-link');
  await delay(800);
  await shot(page, 'hub-final');

  await browser.close();
  console.log(`\n✅ Done! ${shotIdx} screenshots saved to tutorial/screenshots/`);
})();
