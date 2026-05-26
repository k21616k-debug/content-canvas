import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { topic, userNotes, job, guest, interviewType } = req.body;

    const prompt = `你是摩托車裝備 YouTube 頻道「摩托麻吉」的訪談企劃顧問。
使用者正在規劃一支訪談影片，請根據以下資訊做訪談前研究。

訪談主題：${topic}
${guest ? `來賓：${guest}` : '（未指定來賓）'}
${interviewType ? `訪談類型：${interviewType}` : ''}
${job ? `內容目的：${job}` : ''}
${userNotes ? `使用者已知資訊：${userNotes}` : ''}

請用繁體中文，以 JSON 格式回傳（不要加 markdown code block）：
{
  "research": {
    "positioning": "來賓定位（為什麼找這個人、他的公信力、他能提供什麼觀眾想聽的）",
    "features": "獨家角度（這個人/這個議題能講出什麼別人講不出的）",
    "competitors": "YouTube 上類似訪談（有沒有人做過、怎麼差異化）",
    "audienceCares": "觀眾會想問的問題（預測留言區會出現的問題）",
    "suggestedHook": "建議的影片開場 Hook（一句話，讓人想點進來）",
    "suggestedCta": "建議的 CTA（引導觀眾互動）"
  },
  "angles": [
    {
      "title": "建議問題（一句話）",
      "why": "為什麼要問這題（對觀眾的價值 + 是否適合剪短影音）",
      "howToShoot": "追問方向或拍攝提示"
    }
  ]
}

訪談問題設計原則：
- 第 1 題：暖場題（開放、好回答、讓來賓放鬆）
- 第 2-3 題：核心題（深挖經驗、專業知識）
- 第 4 題：情緒高點題（最個人、最有故事性的問題，放在 2/3 處）
- 第 5 題：收尾題（簡短有力，適合剪短影音或做 Cold Open）
- 每題標註是否有短影音潛力
- 避免問來賓在其他地方已經回答過的老問題
- 用「怎麼」「為什麼」開頭的題目比「什麼」「哪個」更能引出故事
- angles 請給 5 題`;

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = msg.content[0].text.trim();
    const clean = text.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
    let result;
    try { result = JSON.parse(clean); } catch { result = { research: {}, angles: [] }; }

    return res.status(200).json(result);
  } catch (err) {
    console.error('Interview expand error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
