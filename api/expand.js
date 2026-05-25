import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { topic, userNotes, job } = req.body;

    const prompt = `你是摩托車裝備 YouTube 頻道「摩托麻吉」的內容研究員。
使用者想做一支關於「${topic}」的影片。
${userNotes ? `使用者備註：${userNotes}` : ''}
${job ? `影片目的（Job）：${job}` : ''}

請用繁體中文回覆，以 JSON 格式回傳以下結構（不要加 markdown code block）：
{
  "research": {
    "positioning": "這個主題在摩托車裝備市場的定位（一句話）",
    "features": "重點規格或特色（用頓號分隔）",
    "competitors": "同類型競品比較（品牌+型號+大概價格）",
    "priceRange": "價格帶（NT$）",
    "audienceCares": "目標觀眾最在意的 3 件事",
    "suggestedHook": "建議的影片開頭 Hook（一句吸引人的話）",
    "suggestedCta": "建議的 CTA（一句引導留言的話）"
  },
  "angles": [
    {
      "title": "拍攝角度標題",
      "why": "為什麼觀眾會想看這個",
      "howToShoot": "具體怎麼拍"
    }
  ]
}

angles 請給 3 個最有潛力的拍攝角度。
盡量具體、接地氣，像是騎士真正會關心的事情。`;

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-20250414',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = msg.content[0].text.trim();
    const clean = text.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
    const result = JSON.parse(clean);

    return res.status(200).json(result);
  } catch (err) {
    console.error('Expand error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
