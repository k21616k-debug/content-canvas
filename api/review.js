import Anthropic from '@anthropic-ai/sdk';
import { addUsage } from './_usage.js';

const anthropic = new Anthropic();

export default async function handler(req, res) {
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
      if (n.isMain) parts.push('★主節點');
      if (n.angles) parts.push(`拍攝角度：${n.angles}`);
      return parts.join(' | ');
    }).join('\n');

    const connsText = connections.length > 0
      ? connections.map(c => `${c.fromTopic} → ${c.toTopic}`).join('\n')
      : '（目前沒有連線）';

    const prompt = `你是摩托車裝備 YouTube 頻道「摩托麻吉」的內容策略顧問。
你的工作不是批評，是給出「馬上能執行」的解決方案。每個建議都要具體到看完就能動手。

目前畫布上的影片企劃：
${nodesText}

連線關係：
${connsText}

用繁體中文，以 JSON 回傳（不要 markdown code block）：
{
  "overallScore": 1-10,
  "summary": "一句話總結目前策略狀態",
  "publishOrder": "建議發布順序和理由（50字以內）",
  "quickWins": [
    {
      "action": "馬上可以做的具體動作（指出哪個節點、改什麼、改成什麼）",
      "why": "為什麼有效（15字以內）",
      "targetNodeIndex": 節點編號(1-based)或null
    }
  ],
  "issues": [
    {
      "type": "duplicate|merge|remove|gap|quality|conflict|opportunity",
      "severity": "high|medium|low",
      "title": "問題簡述（10字以內）",
      "detail": "具體說明",
      "suggestion": "具體怎麼修",
      "targetNodeIndex": 節點編號(1-based)或null,
      "mergeWith": 要合併的另一個節點編號(1-based)或null,
      "mergedTopic": "合併後的建議標題（type=merge 時必填）",
      "newNode": {
        "topic": "建議新增的影片主題（要完整到可以直接拍）",
        "job": "吸引|培育|轉換",
        "stage": "A|B|C|D",
        "reason": "為什麼需要這支（15字以內）"
      }
    }
  ],
  "strategyMap": "用條列式寫出接下來 1-2 個月的具體計畫，格式：第一週：做什麼（目的）→ 第二週：做什麼（目的）→ 第三-四週：做什麼（目的）。像行銷主管在排程，不是在寫作文"
}

規則：
- quickWins 最多 3 個：「現在改一行字就能提升效果」的調整
- issues 最多 6 個，按 severity 排序
- issue type 使用說明：
  - duplicate：主題高度相似但未合併，suggestion 說明差異化方向，newNode=null
  - merge：兩支主題重疊到必須擇一或合併，必填 targetNodeIndex（保留節點）、mergeWith（刪除節點）、mergedTopic（合併後標題），newNode=null
  - remove：某節點是其他節點的純子集、完全冗餘，必填 targetNodeIndex（要移除的節點），newNode=null
  - gap：購買旅程某階段缺乏內容，newNode 填入具體建議標題
  - quality/conflict/opportunity：newNode=null 或填具體建議
- newNode 的 topic 要完整（不要「拍比較片」，要「SHOEI Z-8 vs AGV K3：通勤族安全帽怎麼選？」）
- suggestion 要具體到可執行（不要「建議改善 CTA」，要「CTA 改成：留言告訴我你的安全帽品牌，下支影片幫你分析」）
- strategyMap 要有時間感：第一週做什麼、第二週做什麼，不是空泛的方向

檢查重點：
1. 主題重複（語意層面）
2. 購買旅程斷層（認知→評估→信任→安心）
3. Hook/CTA 品質
4. 拍攝角度新意
5. 長片短片節奏
6. 被忽略的機會點
7. SEO 關鍵字打架
8. 發布順序
9. 知識空洞（哪些節點既無使用者筆記、也沒做過 AI 擴寫？這些節點 AI 只能靠猜，quality issue 必報）`;

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    });

    addUsage('review', msg.usage.input_tokens, msg.usage.output_tokens);
    const text = msg.content[0].text.trim();
    const s = text.indexOf('{'); const e = text.lastIndexOf('}');
    const clean = (s >= 0 && e > s) ? text.slice(s, e + 1) : text;
    let result;
    try { result = JSON.parse(clean); } catch { result = { issues: [], overallScore: 5, summary: text.substring(0, 200) }; }

    return res.status(200).json(result);
  } catch (err) {
    console.error('Review error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
