import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { topic, fields } = req.body;

    const prompt = `你是摩托車裝備 YouTube 頻道「摩托麻吉」的製作人。
以下是一支影片的 Brief 草稿，請潤稿成可以直接交給拍攝團隊的正式 Brief。

影片主題：${topic}

草稿內容：
01 工作 Job：${fields.job || '（未填）'}
02 目標人物 Person：${fields.person || '（未填）'}
03 核心訊息 Core Message：${fields.coreMessage || '（未填）'}
04 必留元素 Non-Negotiables：${fields.nonNegotiables || '（未填）'}
05 短片潛力點 Short Clip Moments：${fields.shortClips || '（未填）'}
06 框架連結 Framework Link：${fields.frameworkLink || '（未填）'}

請用繁體中文，以 JSON 格式回傳潤稿後的 6 個欄位（不要加 markdown code block）：
{
  "job": "潤稿後的 Job 描述（保留原意但更精準）",
  "person": "潤稿後的目標人物（具體化，加上痛點和動機）",
  "coreMessage": "潤稿後的核心訊息（一句話，觀眾看完要記得的）",
  "nonNegotiables": "潤稿後的必留元素（條列，每項加上為什麼必留）",
  "shortClips": "潤稿後的短片潛力點（標註哪幾秒最適合剪短影音）",
  "frameworkLink": "潤稿後的框架連結（說明這支片在整個系列中的角色）"
}

潤稿原則：
- 保留原意，不要改方向
- 讓團隊成員不用問問題就能理解
- 必留元素要具體到「拍什麼畫面」
- 短片潛力點要具體到「哪個動作/瞬間」`;

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = msg.content[0].text.trim();
    const clean = text.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
    const result = JSON.parse(clean);

    return res.status(200).json(result);
  } catch (err) {
    console.error('Brief error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
