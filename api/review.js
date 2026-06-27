import { aiChat, aiChatWithSearch, cleanJson } from './ai-client.js';
import { addUsage } from './_usage.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).json({});
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { nodes, connections } = req.body;

    const nodesText = nodes.map((n, i) => {
      const parts = [`${i + 1}. 「${n.topic}」`];
      if (n.job) parts.push(`用途=${n.job}`);
      if (n.jobSecondary) parts.push(`次要=${n.jobSecondary}`);
      if (n.stage) parts.push(`階段=${n.stage}`);
      if (n.cta) parts.push(`CTA=${n.cta}`);
      if (n.hook) parts.push(`Hook=${n.hook}`);
      if (n.insight) parts.push(`切入點=${n.insight}`);
      if (n.audienceCares) parts.push(`觀眾在意=${n.audienceCares}`);
      if (n.isMain) parts.push('★主節點');
      if (n.angles) parts.push(`拍攝角度：${n.angles}`);
      if (n.userNotes) parts.push(`筆記摘要=${n.userNotes.substring(0, 120)}`);
      if (!n.hasUserNotes && !n.hasResearch) parts.push('⚠️知識空洞');
      else if (!n.hasResearch) parts.push('未做AI擴寫');
      return parts.join(' | ');
    }).join('\n');

    const connsText = connections.length > 0
      ? connections.map(c => `${c.fromTopic} → ${c.toTopic}`).join('\n')
      : '（目前沒有連線）';

    const topicsForSearch = nodes.map(n => n.topic).join('、');
    const reviewSearchPrompt = `你是在幫台灣摩托車裝備 YouTube 頻道「摩托麻吉」做影片策略審查前的市場調查。

畫布上的影片主題：${topicsForSearch}

請使用 web search 查詢（優先查台灣市場）：
1. 這些主題在台灣 YouTube 上已有哪些影片？競爭程度如何？
2. 台灣騎士社群對這些主題目前討論最熱的是什麼？有哪些未被滿足的需求？
3. 這些主題的搜尋關鍵字中，哪些有明顯的內容空白？

查完後，條列整理事實。沒查到的項目標記「未找到」，不要猜。`;

    let webFacts = '';
    try {
      const searchResult = await aiChatWithSearch(reviewSearchPrompt, { maxTokens: 2000 });
      addUsage('review', searchResult.inputTokens, searchResult.outputTokens);
      webFacts = searchResult.text;
      if (!searchResult.searchCount) console.warn(`[review] pre-pass ran 0 web searches — opportunity analysis may rest on training data`);
      else console.log(`[review] web searches: ${searchResult.searchCount}`);
    } catch (searchErr) {
      console.warn('Review web search pre-pass failed (non-fatal):', searchErr.message);
    }

    const today = new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });
    const prompt = `你是摩托車裝備 YouTube 頻道「摩托麻吉」的內容策略顧問。
今天日期：${today}

目前畫布上的影片企劃：
${nodesText}
${webFacts ? '\n## 市場查證結果（web search，優先於訓練資料）\n' + webFacts + '\n' : ''}
用繁體中文，以 JSON 回傳（不要 markdown code block），只回答這三件事：

{
  "actions": [
    {
      "type": "merge",
      "title": "哪兩支高度重複、建議合併",
      "detail": "具體說明重複在哪、合併後標題建議",
      "nodeA": 節點編號(1-based)或null,
      "nodeB": 節點編號(1-based)或null,
      "mergedTopic": "合併後的建議標題（若找不到重複則 null）"
    },
    {
      "type": "gap",
      "title": "哪個購買階段缺口最大、最需要補",
      "detail": "缺口在哪個階段（A認知/B評估/C信任/D安心）、建議拍的主題",
      "suggestedTopic": "具體建議的影片主題（完整到可以直接拍）"
    },
    {
      "type": "ready",
      "title": "哪支影片現在最適合開拍",
      "detail": "為什麼它最ready（有Hook、有CTA、有拍攝角度、市場需求清楚）",
      "nodeIndex": 節點編號(1-based)
    }
  ]
}

規則：
- 每種 type 恰好一個，固定順序：merge → gap → ready
- 如果沒有重複的節點，merge.nodeA 和 merge.nodeB 和 merge.mergedTopic 填 null，title 改成「目前無明顯重複，內容分布健康」
- detail 要具體到看完就能動手，不要空泛方向
- suggestedTopic 要完整（不要「拍比較片」，要「SHOEI Z-8 vs AGV K3：通勤族安全帽怎麼選？」）`;

    const { text, inputTokens, outputTokens } = await aiChat(prompt, { maxTokens: 3000, jsonMode: true, thinkingBudget: 0 });
    addUsage('review', inputTokens, outputTokens);
    const clean = cleanJson(text);
    let result;
    try { result = JSON.parse(clean); } catch (parseErr) {
      console.error('[review] JSON parse failed:', parseErr.message, '| cleaned length:', clean.length, '| last 100:', clean.slice(-100));
      result = { actions: [{ type: 'merge', title: '分析失敗', detail: text.substring(0, 200) }, { type: 'gap', title: '分析失敗', detail: '' }, { type: 'ready', title: '分析失敗', detail: '' }] };
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('Review error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
