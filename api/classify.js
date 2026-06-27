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
    const { topic, userNotes } = req.body;

    const prompt = `你是摩托車裝備 YouTube 頻道的內容分類專家。
根據以下輸入，判斷它的用途和購買階段。

輸入：${topic}
${userNotes ? `補充資訊：${userNotes}` : ''}

⚠️ 重要判斷：
首先判斷這個輸入是不是一個明確的影片主題。
- 如果是明確主題（例：「SOL 安全帽開箱」「防水背包怎麼選」）→ 正常分類
- 如果是模糊概念（例：「觀眾一直問防水」「老闆說要拍新品」「背包」）→ 設 isVague=true，不強制分類

請用繁體中文，以 JSON 格式回傳（不要加 markdown code block）：
{
  "isVague": false,
  "primaryJob": "吸引|培育|轉換",
  "secondaryJob": "",
  "cta": "建議的CTA（一句話）",
  "stage": "A|B|C|D",
  "reason": "為什麼這樣分類（一句話）"
}

如果 isVague=true，primaryJob/secondaryJob/stage 都給空字串，reason 說明為什麼判斷為模糊。

分類邏輯（只在 isVague=false 時使用）：
- A 認知（入門、科普、新手、懶人包、怎麼選）→ primaryJob=吸引
- B 評估（評測、比較、對決、開箱、規格）→ primaryJob=培育
- C 信任（心得、磨損、實測、回饋、認證）→ primaryJob=轉換
- D 安心（買、通路、比價、保固、保養）→ primaryJob=轉換

如果影片有明顯的次要用途，填 secondaryJob（例：開箱影片主要是培育，但也有吸引新觀眾的作用）。
沒有明顯的次要用途就給空字串。`;

    const { text, inputTokens, outputTokens } = await aiChat(prompt, { maxTokens: 1000 });

    console.log('Classify raw:', JSON.stringify(text));
    addUsage('classify', inputTokens, outputTokens);
    const clean = cleanJson(text);
    console.log('Classify clean:', JSON.stringify(clean));
    const result = JSON.parse(clean);

    // Backward compatibility: also set "job" for existing code
    result.job = result.primaryJob || '';

    return res.status(200).json(result);
  } catch (err) {
    console.error('Classify error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
