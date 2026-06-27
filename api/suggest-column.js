import { aiChat, cleanJson } from './ai-client.js';
import { addUsage } from './_usage.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).json({});
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { stage, nodes, connections } = req.body;
    if (!stage) {
      return res.status(400).json({ error: 'Missing target stage' });
    }

    const nodesText = nodes.map((n, i) => {
      const parts = [`${i + 1}. 「${n.topic}」`];
      if (n.job) parts.push(`用途=${n.job}`);
      if (n.stage) parts.push(`階段=${n.stage}`);
      if (n.cta) parts.push(`CTA=${n.cta}`);
      if (n.userNotes) parts.push(`筆記=${n.userNotes.substring(0, 100)}`);
      return parts.join(' | ');
    }).join('\n');

    const connsText = connections.length > 0
      ? connections.map(c => `${c.fromTopic} → ${c.toTopic}`).join('\n')
      : '（無）';

    const stageNames = { A: '認知/吸引', B: '評估/培育', C: '信任/轉換', D: '安心' };
    const stageDesc = {
      A: '吸引新觀眾，擴大流量。適合開箱、大眾興趣話題、常見問題引導。',
      B: '培育意向，協助比較選擇。適合規格比較、實測數據、競品對決。',
      C: '建立信任，促成轉換。適合長期使用心得、第三方認證、用戶見證。',
      D: '安心保障，售後與回饋。適合退換政策、售後服務、滿意度回饋。'
    };

    const prompt = `你是摩托車裝備 YouTube 頻道「摩托麻吉」的內容策略顧問。
目前畫布上的影片企劃：
${nodesText}

現有連線關係：
${connsText}

我們希望在「${stageNames[stage]}」階段（${stageDesc[stage]}）新增一些影片，來補足購買漏斗的缺口。

請根據現有的影片脈絡（避免重複，且能與現有影片產生關聯或連線），建議 3 支適合該階段的影片主題。
用繁體中文，以 JSON 回傳（不要 markdown code block），格式如下：

{
  "suggestions": [
    {
      "topic": "建議的影片主題（15字以內，要具體，例如：SHOEI Z-8 vs AGV K3：通勤族安全帽怎麼選？）",
      "job": "主要用途（吸引 / 培育 / 轉換）",
      "reason": "為什麼需要這支影片，以及如何與現有影片（如：OOO）串聯（2-3句）",
      "connectToTopic": "建議與其連線的現有影片完整標題（如果沒有，請填 null。必須是上面『目前畫布上的影片企劃』中列出的完整主題字串）"
    }
  ]
}

規則：
1. 主題要具體到可以直接拍，不要空泛。
2. 說明中要指出跟現有影片的策略關係（例如：「在觀眾看過 A 影片的開箱後，這支影片提供詳細的規格對比，引導他們到 C 階段」）。
3. 只能回傳 JSON，不要有額外文字。`;

    const { text, inputTokens, outputTokens } = await aiChat(prompt, { maxTokens: 2000, jsonMode: true, thinkingBudget: 0 });
    addUsage('suggest-column', inputTokens, outputTokens);
    
    const clean = cleanJson(text);
    let result;
    try {
      result = JSON.parse(clean);
    } catch (parseErr) {
      console.error('[suggest-column] JSON parse failed:', parseErr.message, 'raw text:', text);
      return res.status(500).json({ error: 'AI 回傳格式解析失敗' });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('Suggest column error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
