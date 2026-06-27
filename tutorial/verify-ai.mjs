import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS = path.join(__dirname, 'screenshots');
if (!fs.existsSync(SCREENSHOTS)) {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
}

const BASE = 'http://localhost:3456';
const PASSWORD = '01530246'; // From user's session gate password

async function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  console.log('Launching browser for automated UI/UX verification...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  try {
    // 1. Login
    console.log('Step 1: Navigating to index.html and logging in...');
    await page.goto(BASE);
    await page.fill('#gate-input', PASSWORD);
    await page.click('#gate-submit');
    await delay(1000);
    await page.screenshot({ path: path.join(SCREENSHOTS, 'verify-01-hub.png') });
    console.log('Logged in successfully, hub loaded.');

    // 2. Open Product V2
    console.log('Step 2: Entering Product V2...');
    await page.click('a[href="product-v2.html"]');
    await delay(1500);
    await page.screenshot({ path: path.join(SCREENSHOTS, 'verify-02-project-picker.png') });
    
    // Select the "SOL 安全帽系列" project
    console.log('Selecting SOL 安全帽系列 project...');
    await page.click('text=SOL 安全帽系列');
    await delay(2000);
    await page.screenshot({ path: path.join(SCREENSHOTS, 'verify-03-canvas-loaded.png') });
    console.log('Canvas loaded in V2 Journey View.');

    // 3. Test Stage Suggestion in Column B
    console.log('Step 3: Triggering AI Stage Suggestion for Column B...');
    const suggestBtn = await page.locator('.column:has(text="B 評估") .ai-suggest-stage-btn');
    await suggestBtn.click();
    
    // Wait a brief moment to capture loading/skeleton state
    await delay(500);
    await page.screenshot({ path: path.join(SCREENSHOTS, 'verify-04-suggestion-loading.png') });
    console.log('Loading state captured.');

    // Wait for the suggestion call to complete (Gemini takes ~10-15s)
    console.log('Waiting for AI suggestions from Gemini...');
    await page.waitForSelector('.column:has(text="B 評估") .ghost-node:not(.loading)', { timeout: 30000 });
    await delay(500);
    await page.screenshot({ path: path.join(SCREENSHOTS, 'verify-05-suggestions-rendered.png') });
    console.log('AI Suggestions successfully rendered in B column.');

    // 4. Test AI Merge (收束)
    console.log('Step 4: Testing AI merge (收束) via multi-select...');
    await page.evaluate(() => {
      window._cs.enterSplitMode();
    });
    await delay(500);
    await page.screenshot({ path: path.join(SCREENSHOTS, 'verify-06-split-mode-entered.png') });
    console.log('Multi-select mode active.');

    // Select two checkboxes on the cards
    const checkboxes = await page.locator('.split-checkbox');
    await checkboxes.nth(0).check();
    await checkboxes.nth(1).check();
    await delay(300);
    await page.screenshot({ path: path.join(SCREENSHOTS, 'verify-07-nodes-selected.png') });
    console.log('Two nodes selected for merge.');

    // Click "AI 合併收束" button in the split bar
    console.log('Clicking AI 合併收束...');
    const mergeBtn = await page.locator('text=AI 合併收束');
    await mergeBtn.click();
    await delay(500);
    await page.screenshot({ path: path.join(SCREENSHOTS, 'verify-08-merge-loading.png') });
    console.log('Merge loading view active.');

    // Wait for merge preview to render (Gemini takes ~15-20s)
    console.log('Waiting for AI merge output...');
    await page.waitForSelector('#btn-confirm-ai-merge', { timeout: 40000 });
    await delay(500);
    await page.screenshot({ path: path.join(SCREENSHOTS, 'verify-09-merge-preview.png') });
    console.log('AI Merge preview shown.');

    // Click "確認執行合併" to apply
    console.log('Applying merge...');
    await page.click('#btn-confirm-ai-merge');
    await delay(1500);
    await page.screenshot({ path: path.join(SCREENSHOTS, 'verify-10-merge-complete.png') });
    console.log('Merge operation complete.');

    console.log('✅ End-to-end Playwright verification PASSED successfully!');
  } catch (err) {
    console.error('❌ Verification FAILED:', err);
    await page.screenshot({ path: path.join(SCREENSHOTS, 'verify-error.png') });
  } finally {
    await browser.close();
  }
}

run();
