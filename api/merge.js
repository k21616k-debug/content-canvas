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
    const { selectedNodes } = req.body;
    if (!selectedNodes || selectedNodes.length < 2) {
      return res.status(400).json({ error: 'At least two nodes are required for merging' });
    }

    const selectedText = selectedNodes.map((n, i) => {
      const parts = [`影片 ${i + 1}: 「${n.topic}」`];
      if (n.job) parts.push(`主要用途=${n.job}`);
      if (n.stage) parts.push(`購買階段=${n.stage}`);
      if (n.cta) parts.push(`CTA=${n.cta}`);
      if (n.userNotes) parts.push(`隨手筆記=${n.userNotes}`);
      if (n.angles && n.angles.length > 0) {
        parts.push(`拍攝角度：${n.angles.map(a => a.title).join('、')}`);
      }
      return parts.join('\n');
    }).join('\n\n---\n\n');

    const prompt = `你是台灣摩托車裝備 YouTube 頻道「摩托麻吉」的內容策略顧問。
我們在內容規劃中發現以下幾支影片企劃有高度重疊、定位不清，需要將它們「收束合併」成單一支更強大、更有含金量的影片。

要合併的影片：
${selectedText}

請分析這些影片的重複之處與核心價值，將它們整合成一支影片企劃。
用繁體中文，以 JSON 回傳（不要 markdown code block），格式如下：

{
  "merged": {
    "topic": "整合成的一支影片標題（15字以內，要具體有吸引力，例如：三款防潑水背包極限實測）",
    "job": "建議的主要用途（吸引 / 培育 / 轉換）",
    "stage": "建議的購買階段（A / B / C / D）",
    "cta": "建議的影片結尾 CTA（例：點連結看詳細規格、留言索取折價券）",
    "userNotes": "合併與整理後的隨手筆記（將舊有的重點整理成條理分明的影片大綱，約 200 字）",
    "filmingAngles": [
      {
        "title": "拍攝鏡位主題",
        "cameraSetup": "具體鏡頭設計與說明"
      }
    ],
    "explain": "合併說明的理由，解釋為什麼這幾支影片該合併、合併後的策略優勢是什麼（100字以內）"
  }
}

規則：
1. 必須將舊有影片的所有關鍵知識點與優點保留，在大綱（userNotes）與拍攝角度中體現。
2. 只能回傳 JSON，不要有額外文字。`;

    const { text, inputTokens, outputTokens } = await aiChat(prompt, { maxTokens: 3000, jsonMode: true, thinkingBudget: 0 });
    addUsage('merge', inputTokens, outputTokens);

    const clean = cleanJson(text);
    let result;
    try {
      result = JSON.parse(clean);
    } catch (parseErr) {
      console.error('[merge] JSON parse failed:', parseErr.message, 'raw text:', text);
      return res.status(500).json({ error: 'AI 回傳格式解析失敗' });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('Merge error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
