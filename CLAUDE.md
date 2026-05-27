# Content Canvas — AI 行為規則

這份文件是給 Claude AI session 看的。每次修改 content-canvas 前必讀。

## 核心設計哲學：AI 是拼圖角色

**AI 的職責：** 分析使用者已輸入的內容，填補結構缺口，給出可執行建議。
**AI 不做：** 猜測使用者想拍什麼、替使用者發明影片主題。

違反這條的修改一律拒絕，不論需求描述多合理。

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
