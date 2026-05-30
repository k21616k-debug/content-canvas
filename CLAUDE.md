# Content Canvas — AI 行為規則

這份文件是給 Claude AI session 看的。每次修改 content-canvas 前必讀。

## 核心設計哲學：AI 是拼圖角色

**AI 的職責：** 分析使用者已輸入的內容與查證到的事實，在使用者指定的方向（發散/收斂）上做深度推導，填補結構缺口，給出可執行建議。

**界線是「有沒有根據 + 夠不夠深」，不是「是不是新節點」：**
- ✅ 允許：從累積線索（使用者輸入 + 查證事實 + 既有節點 + 前幾輪採用/拋棄）深度推導出延伸節點。這是分析。
- ❌ 禁止：沒線索就憑空發明主題、或生成淺殼（套模板、換關鍵字，如已禁用的 stageTemplates）。這是腦補與噪音。

**方向由使用者掌握，不由 AI 推斷：** AI 不自己決定計劃要做大（發散）還是做小（收斂），等使用者指定。

違反這條的修改一律拒絕，不論需求描述多合理。

---

## 資料一致性審查（每次改 AI 邏輯前必跑）

**為什麼有這條：** 「整個工具沒有 web search」這種洞能躺半年沒被發現，是因為過去每個功能都用「做得出來」驗收，沒用「接上真相沒、有沒有重工」驗收。`plausible-but-wrong`（聽起來合理但其實錯）不會報錯，它會微笑著給你錯答案。

**強制機制：** 全域 PreToolUse hook（`~/.claude/settings.json`）會在編輯 `api/*.js` 或 `app-v2.js` 前，自動把審查 checklist 注入 context。checklist 全文在 `~/.claude/content-canvas-audit-checklist.txt`。不靠記性，靠 hook。

**三題（答不出就先補再動工）：**

1. **採集 / 推導 / 產製分層** — 向外查的資料（web/YouTube/vision）有沒有存成 `node.sources`、被所有端點共讀，而不是埋進 expand 每次重查？採集（慢、向外、一次）必須和推導（快、向內、多次）分開。
2. **Ground-truth 接線表** — 改動碰到的每個 AI 欄位，真相住哪、AI 連上了沒？目前已接：規格/價格(web)。未接：競品影片/真實關鍵字(YouTube)、自家成效(後台)、縮圖/外觀(vision)、品牌語氣(你腦中)。任何「沒連上但 AI 照樣很有自信輸出」= 下一個洞。
3. **欄位扇出 / 序列化一致性** — 同一筆資料只生產一次、流到所有該去的欄位？別再多開 node→prompt 序列化（ask/review/plan/expand 已各一套），別開重複寫入路徑，下游別重推導 expand 已有的東西。

---

## 禁止重新引入的設計（永久移除）

### stageTemplates ghost node（已於 2026-05-27 移除）

**刪除原因：** 根據購買旅程缺口自動生成建議影片標題，本質是把 `themeWord` 套進模板關鍵字（例：「{themeWord}的三種分類」），屬於用關鍵字填模板的噪音，不是分析。

**被刪除的代碼特徵：**
- 一個叫 `stageTemplates` 的物件，key 是 A/B/C/D 四個購買旅程階段
- 每個 stage 有 `templates` 陣列，包含 `{themeWord}XXX` 格式的字串
- 生成 `type: 'new-node'` 的 ghost node，id 格式為 `ghost_gap_*`

**如果你看到類似設計出現，立即拒絕並說明原因。**

---

## Ghost Node 合法類型（目前保留）

| type | 用途 | 觸發條件 |
|------|------|----------|
| `auto-fill` | 補全節點缺失欄位（job/cta/hook） | 節點有 topic 但缺 meta |
| `connection` | 建議節點間連線 | 語意相關節點未連線 |
| `restructure` | 建議節點分組/排序 | 結構混亂 |
| `clip` | 建議把長片拆成短片 | 長片節點缺少短片配套 |

`new-node` 類型已永久移除，不可再加。

---

## AI Review（`/api/review.js`）

- 最多 6 個 issues，按 severity 排序
- `merge` 類型：必填 `targetNodeIndex`（保留）、`mergeWith`（刪除）、`mergedTopic`（合併後標題）
- `remove` 類型：必填 `targetNodeIndex`（要移除的節點）
- `gap` 類型：`newNode` 填具體建議標題（完整到可以直接拍）
- 知識空洞（`!node.user && !node.aiResearch`）必報 `quality` issue

---

## `themeWord` 提取規則

`app.js` 中 `analyzeCanvas()` 使用 `themeWord` 作為 ghost node 標題前綴。

**正確提取方式（particle regex）：**
```javascript
const _t0 = existingTopics[0] || '';
const _particleMatch = _t0.match(/^(.+?)(?:的|是|在|有|跟|和|與|vs|：|，)/);
const themeWord = commonWords[0] || (_particleMatch ? _particleMatch[1] : _t0.substring(0, 6)) || '產品';
```

**禁止回退到的寫法：**
```javascript
// WRONG — 會在助詞+數字位置切斷（例：「騎士背包的三」）
const themeWord = commonWords[0] || existingTopics[0]?.substring(0, 6) || '產品';
```

---

## Vercel 限制

- Hobby plan：12 個 serverless functions 上限，**已達上限**
- 新增 API endpoint 前必須先合併舊的

---

## 本地開發

- 路徑：`/Users/chunhuiliu/Moto-Claude Code/content-canvas/`
- 啟動：`node --env-file=content-canvas/.env content-canvas/server.js`（port 3456）
- 部署：Vercel，push to main 自動部署

## 跨 session 記憶

設計決策完整記錄在 Notion：https://www.notion.so/36de66c0245e81e08f52c254f4d104d3

---

## 當前狀態快照（每次重要工作結束後更新）

**最後更新：2026-05-30**

### 2026-05-30 ideation 強化（多角色 workflow 迴圈，⚠️ 全部本機未 commit）

**起因**：live 測「賣 3 款背包」發現 diverge 三問題：① D 安心盲點（9 候選 0 個 D）② 重複收斂（重複發散撞題）③ 慢（expand ~145s／diverge ~80s）。用 workflow 多角色迴圈解（設計 15 角色 → 9 修法 → 驗證 6 角色 → 補 1 blocking → 終點達成）。

- **D 盲點 → 改框架（非逼 AI 生）**：反向測試員證明「逼 diverge 補 D」= 被禁的 stageTemplates 換皮（D 的真相「你家退換/保固政策」web 查不到，逼 AI 生 = 腦補）。改 **D 走人工邊界**：`renderJourneyView` D 欄缺口文案改「AI 查不到你家政策、不代生，點＋手動補」、`column-add-btn` 傳預選 stage（`showModal` 第三參，本來沒人傳）、health `journey-view` action 加人工 SOP toast。終點重定義：A/B/C 由 diverge 接真相長出，D 交還人工，不假裝填滿。
- **重複 → 輸出契約（非輸入塞料）**：`api/expand.js` diverge prompt 加防重複契約（AI 必須自承「與《X》重疊但因為＿仍值得拍」否則棄）；`existingTopics` 改送 `{topic, insight}`（前端 app-v2.js、後端雙格式相容）。
- **慢 → 砍重複搜尋（呼應審查第1題 採集/推導分層）**：主 expand 改純 `messages.create` 不掛 web_search（採集只押 haiku pre-pass，推導不再上網）；`runWithSearch` 輪數 8→5、`max_uses:3`、`user_location:TW`、加 `searchCount` 哨兵（0 次搜尋 → console.warn）。實測 145→100s、80→70s（**真正的解是 node.sources 查一次共用，Andrew 之後做**）。
- **2 個真 bug**：`adoptDivergeCandidate` + `applyResearch` 的 `suggestedStage` 都加 `['A','B','C','D'].includes` enum 守衛（非法 stage 如 'C/D' 讓節點從旅程板蒸發 + 稀釋%——Fix 7 先只修了 diverge 那條，驗證 workflow 抓到主 expand 採納漏修）；prompt 不再把「轉換」誘導成 '(C/D)'（改要求單一字母）；移除 diverge 的 insight→`node.user` 雙寫汙染。

**旁支（非 blocking，待 Andrew 決定）**：後端查重無硬閘門（純 prompt 自律）；diverge 仍可生 AI 版 D 內容靜默蓋過人工邊界；`applyResearch` 635 的 insight→user 政策與 diverge 不一致；素材欄＋未傳預選 stage（舊回歸）；line 499 toast 文案與 D 欄鈕標籤不符。

### 2026-05-30 這個 session（⚠️ 全部本機 commit、尚未 push）

**新功能：一按發散（diverge）已蓋好並驗證**
- `api/expand.js` 新增 `action: 'diverge'`：給來源節點脈絡 → web search 查證 → 回 3 個深度候選新影片（topic/insight/suggestedHook/suggestedJob/suggestedStage/angles）。驗證過：候選有真實來源（台灣醫療站、PTT）。
- `app-v2.js` 重寫 `divergeFromNode`：呼叫 diverge → 渲染候選卡（reuse #parse-content）→ 採用候選 = `createNode` + 存研究到新節點 + 連回來源。新增 `renderDivergeCandidates`、`adoptDivergeCandidate`、`_divergeCands/_divergeSource`。
- `#btn-diverge`（🌿 發散）原本是死的（class 有 hidden），已移除 hidden 讓它顯示。
- 驗證方式：後端真實 curl；前端用 stub 真實點按鈕（預覽視窗長等待會自重整，故分兩半驗）。**尚未做完整單次 live 點擊串測。**

**Bug 修復 / 清理（這 session）**
- 採納（btn-adopt-research）：一次扇出 CTA+Job+階段+insight，加 `pushUndo`（可復原）+ adopt 後呼叫 `render()`（畫布即時更新）。移除 redundant 的 btn-apply-cta。
- expand 新增輸出 suggestedJob/suggestedStage（採納時套用）。
- 移除孤兒：AI 潤稿（按鈕+handler+`aiBriefPolish`+`_polishedBrief`）、死碼 `aiClassifyNode`（v2 從沒呼叫；但 /api/classify 仍被穩定版 app.js 用，端點別砍）。
- 修好 YouTube 標題按鈕：`aiTitles` 從壞的 `/api/titles` 改指 `/api/expand` `action:'titles'`。
- 死欄位 positioning/features/competitors → 改讀/顯示 insight（brief、匯出、發散種子、面板、mockExpand 全改）。
- review.js + ask.js + 前端 payload：新增傳/讀 `insight` + `audienceCares`（不再憑印象）。驗證過 review live 可跑、有根據。

**背包專案（p1780050433417）已跑完**：8 個節點全部重新擴寫+採納，有 insight/CTA/hooks/angles，已存進 canvas-data.json。

**防呆機制（hooks，全域 ~/.claude/settings.json + content-canvas/.claude/settings.json）**
- 改 api/*.js 或 app-v2.js 前：PreToolUse 硬閘門，要先 `touch ~/.claude/.cc-audit-ack`（20 分窗口）。
- 停下前：Stop hook 要 `touch ~/.claude/.cc-review-done` 才本機 commit；**已移除自動 push**（push 等 Andrew 確認）。
- checklist 全文：`~/.claude/content-canvas-audit-checklist.txt`。

**桌面捷徑**：`~/Desktop/啟動內容企劃.command`（點兩下啟動本機 server + 開瀏覽器）。

**已知未處理 / 留給未來**
- 死變數 coreMsg/nonNeg/shortClips（移除潤稿後留的，無害、grep 證實零讀取）。
- 大架構未做（Andrew 說之後）：node.sources「查一次共用」、serializeNode 統一、發散升級成「發散/收斂方向盤」+ 從整個計劃發散 + 候選間連結合併。
- **API 速率限制**：Anthropic 帳號 30k input tokens/分鐘（sonnet）。並行多個深度生成會撞限，未來並行功能要限流（一次 3 個）。這不是網站 bug，是帳號等級。
- 部署：本機完全可用；Vercel 版是舊的、且 serverless 存不住 canvas-data.json（用過即丟）→ 本機為主。Andrew 決定先用順再部署。

### 最近完成的 Bug 修復（2026-05-28，commit 5dbac13）

1. **suggestedCta → ctaSpoken 拆分** — research 物件的 CTA 欄改為 ctaSpoken（15字以內，可口播）+ ctaStrategy（策略說明），app-v2.js 全部對應欄位同步更新
2. **expand.js confidence 預設 low** — userNotes 為空時強制 confidence="low"，禁止 AI 亂猜
3. **review.js userNotes 傳遞** — runGlobalReview 傳 userNotes snippet，AI 不再自行腦補產品規格
4. **Ghost clip type 修正** — `type: 'new-node'`（已禁用）改為 `type: 'clip'`；主題不截斷；ID 加隨機後綴防碰撞
5. **Discuss 預填引號巢狀** — 移除 `「${ctx}」` 的外層引號，改用破折號分隔
6. **server.js 補 /api/brief + /api/classify 路由** — 這兩個路由原本未註冊，所有 brief 生成和 classify 的 API 呼叫都是 404

### 前期修復（2026-05-27）

1. **B1 `shortClips` undefined** — `generateNodeBrief()` 新增宣告
2. **B2 Review stale index** — merge/remove/quickWin 按鈕改用 node ID 而非 index
3. **U4 Copy Brief 格式** — 重寫為拍攝執行清單格式
4. **U5 merge/remove 無確認** — 加上 `confirm()` 對話框
5. **D1 知識空洞偵測** — runGlobalReview 傳 hasUserNotes/hasResearch
6. **Causal chain guard** — suggestCausalNode 防重複
7. **Auto-classify feedback** — 成功後顯示 inline toast

### 已知未處理項目

- 無（截至 2026-05-28）

### 下次 session 開始前必讀

1. 先讀完這個 `CLAUDE.md`
2. fetch Notion 頁面確認最新決策
3. 如有 `## 待處理` 項目，優先處理
