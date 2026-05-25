import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { topic, userNotes } = req.body;

    const prompt = `你是摩托車裝備 YouTube 頻道的內容分類專家。
根據以下影片標題，判斷它的 Job（目的）、CTA、和購買階段。

標題：${topic}
${userNotes ? `備註：${userNotes}` : ''}

請用繁體中文，以 JSON 格式回傳（不要加 markdown code block）：
{
  "job": "吸引|培育|轉換",
  "cta": "建議的CTA（一句話，引導觀眾互動）",
  "stage": "A|B|C|D",
  "reason": "為什麼這樣分類（一句話）"
}

分類邏輯：
- A 認知（入門、科普、新手、懶人包、怎麼選）→ Job=吸引
- B 評估（評測、比較、對決、開箱、規格）→ Job=培育
- C 信任（心得、磨損、實測、回饋、認證）→ Job=轉換
- D 安心（買、通路、比價、保固、保養）→ Job=轉換`;

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-20250414',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = msg.content[0].text.trim();
    const clean = text.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
    const result = JSON.parse(clean);

    return res.status(200).json(result);
  } catch (err) {
    console.error('Classify error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
