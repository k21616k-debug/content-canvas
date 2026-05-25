import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { topic, job, cta, angles, research, user } = req.body;

    const anglesText = (angles || [])
      .map((a, i) => `${i + 1}. ${a.title}（${a.why}）拍法：${a.howToShoot || '待定'}`)
      .join('\n');

    const prompt = `你是摩托車裝備 YouTube 頻道「摩托麻吉」的腳本企劃。
請為以下影片寫一份腳本大綱：

主題：${topic}
影片目的：${job || '未指定'}
CTA：${cta || '留言分享你的想法'}
${research?.positioning ? `定位：${research.positioning}` : ''}
${research?.suggestedHook ? `Hook：${research.suggestedHook}` : ''}

拍攝角度：
${anglesText || '（無指定）'}

${user?.notes ? `使用者補充：${user.notes}` : ''}

請用繁體中文寫腳本大綱，格式如下：
- 用時間碼標記每個段落 [MM:SS-MM:SS]
- 每段包含：段落標題、重點、拍法建議、旁白方向
- 開頭要有 Hook（5 秒內抓住注意力）
- 結尾要有總結 + CTA
- 總長度控制在 8-12 分鐘
- 直接輸出純文字，不要 markdown 格式`;

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-20250414',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const script = msg.content[0].text.trim();
    return res.status(200).json({ script });
  } catch (err) {
    console.error('Script error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
