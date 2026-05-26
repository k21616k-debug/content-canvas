import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { topic, fields: f } = req.body;
    const fields = f || {};

    const prompt = `你是摩托車裝備 YouTube 頻道「摩托麻吉」的訪談製作人。
以下是一支訪談影片的 Brief 草稿，請潤稿成可以直接交給拍攝團隊的正式 Brief。

訪談主題：${topic}

草稿內容：
01 工作 Job：${fields.job || '（未填）'}
02 來賓介紹 Guest：${fields.guest || '（未填）'}
03 觀眾看完要記住什麼：${fields.coreMessage || '（未填）'}
04 訪綱重點 + 必問問題：${fields.interviewOutline || '（未填）'}
05 短片潛力點 Short Clip Moments：${fields.shortClips || '（未填）'}
06 框架連結 Framework Link：${fields.frameworkLink || '（未填）'}

請用繁體中文，以 JSON 格式回傳潤稿後的 6 個欄位（不要加 markdown code block）：
{
  "job": "潤稿後的 Job 描述（保留原意但更精準）",
  "guest": "潤稿後的來賓介紹（一段話讓團隊認識來賓，含經歷和為什麼找他）",
  "coreMessage": "潤稿後的核心訊息（觀眾看完這集要記住的一句話）",
  "interviewOutline": "潤稿後的訪綱（必問問題 + 每題追問方向 + 標註情緒高點放哪題）",
  "shortClips": "潤稿後的短片潛力點（哪幾題最適合剪短影音 + Cold Open 候選）",
  "frameworkLink": "潤稿後的框架連結（這集在整個系列中的角色）"
}

潤稿原則：
- 保留原意，不要改方向
- 讓團隊成員不用問問題就能理解
- 訪綱要具體到「問什麼 + 怎麼追問」
- 標註哪些問題是情緒高點、哪些適合剪短影音
- 短片潛力點要具體到「哪個回答的哪個瞬間」`;

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
    console.error('Interview brief error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
