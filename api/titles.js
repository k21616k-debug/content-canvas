import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { topic, hook, angles, research, job } = req.body;

    const prompt = `你是摩托車裝備 YouTube 頻道「摩托麻吉」的標題和縮圖策略師。
根據以下影片資訊，產出 3 組 YouTube 標題 + 縮圖文字方向。

主題：${topic}
${hook ? `Hook：${hook}` : ''}
${job ? `Job：${job}` : ''}
${research?.positioning ? `定位：${research.positioning}` : ''}
${research?.audienceCares ? `觀眾在意：${research.audienceCares}` : ''}
${angles ? `拍攝角度：${angles.map(a => a.title).join('、')}` : ''}

請用繁體中文，以 JSON 格式回傳（不要加 markdown code block）：
{
  "options": [
    {
      "title": "YouTube 標題（30字以內，要有吸引力）",
      "subtitle": "副標題或系列名（可選）",
      "thumbnail": "縮圖上的大字（6字以內，要震撼）",
      "thumbnailDesc": "縮圖畫面建議（一句話）",
      "style": "curiosity|comparison|authority|controversy"
    }
  ]
}

標題策略：
- 第 1 組：好奇心型（讓人想點進來）
- 第 2 組：對比型（A vs B、before/after）
- 第 3 組：權威型（數據、測試結果、專業觀點）
每組標題要差異夠大，不要只是換詞。`;

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-20250414',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = msg.content[0].text.trim();
    const clean = text.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
    const result = JSON.parse(clean);

    return res.status(200).json(result);
  } catch (err) {
    console.error('Titles error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
