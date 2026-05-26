import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { topic, userNotes, guest } = req.body;

    const prompt = `你是摩托車裝備 YouTube 頻道的訪談內容分類專家。
根據以下訪談主題，判斷它的 Job（目的）、CTA、和內容目的階段。

訪談主題：${topic}
${guest ? `來賓：${guest}` : ''}
${userNotes ? `備註：${userNotes}` : ''}

請用繁體中文，以 JSON 格式回傳（不要加 markdown code block）：
{
  "job": "吸引|培育|轉換",
  "cta": "建議的CTA（一句話，引導觀眾互動）",
  "stage": "A|B|C|D",
  "reason": "為什麼這樣分類（一句話）"
}

分類邏輯：
- A 拉新（有趣話題、爭議性、故事性強、容易吸引路人點進來）→ Job=吸引
- B 深度（專業知識、技術細節、深度對談、展現頻道專業度）→ Job=培育
- C 信任（真實經驗、失敗故事、同業推薦、建立可信度）→ Job=培育
- D 社群（觀眾Q&A、社群人物、粉絲互動、強化歸屬感）→ Job=吸引`;

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = msg.content[0].text.trim();
    const clean = text.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
    const result = JSON.parse(clean);

    return res.status(200).json(result);
  } catch (err) {
    console.error('Interview classify error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
