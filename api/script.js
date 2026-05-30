import Anthropic from '@anthropic-ai/sdk';
import { addUsage } from './_usage.js';

const anthropic = new Anthropic();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { topic, job, cta, guest, interviewType, angles, research, user, mode } = req.body;

    let prompt;

    if (mode === 'interview') {
      const anglesText = (angles || [])
        .map((a, i) => `Q${i + 1}. ${a.title}（${a.why}）追問方向：${a.howToShoot || '待定'}`)
        .join('\n');

      prompt = `你是摩托車裝備 YouTube 頻道「摩托麻吉」的訪談腳本企劃。
請為以下訪談影片寫一份腳本大綱：

訪談主題：${topic}
來賓：${guest || '未指定'}
訪談類型：${interviewType || '深度專訪'}
影片目的：${job || '未指定'}
CTA：${cta || '留言分享你的想法'}
${research?.positioning ? `來賓定位：${research.positioning}` : ''}
${research?.suggestedHook ? `Hook：${research.suggestedHook}` : ''}

訪綱問題：
${anglesText || '（無指定）'}

${user ? `使用者補充：${user}` : ''}

請用繁體中文寫訪談腳本大綱，格式如下：
- 用時間碼標記每個段落 [MM:SS-MM:SS]
- 結構：Cold Open → 來賓介紹 → 暖場題 → 核心題 → 情緒高點 → 收尾題 → 總結 CTA
- 每題包含：問法建議、預期回答方向、追問備案、畫面建議
- Cold Open：用最精彩的片段當開場（標註是哪一題的回答）
- 情緒高點放在全片 2/3 處
- 標註哪些段落有短影音潛力 🎬
- 總長度控制在 15-25 分鐘
- 直接輸出純文字，不要 markdown 格式`;
    } else {
      const anglesText = (angles || [])
        .map((a, i) => `${i + 1}. ${a.title}（${a.why}）拍法：${a.howToShoot || '待定'}`)
        .join('\n');

      prompt = `你是摩托車裝備 YouTube 頻道「摩托麻吉」的腳本企劃。
請為以下影片寫一份腳本大綱：

主題：${topic}
影片目的：${job || '未指定'}
CTA：${cta || '留言分享你的想法'}
${research?.insight ? `切入角度：${research.insight}` : ''}
${research?.suggestedHook ? `Hook：${research.suggestedHook}` : ''}

拍攝角度：
${anglesText || '（無指定）'}

${user ? `使用者補充：${user}` : ''}

請用繁體中文寫腳本大綱，格式如下：
- 用時間碼標記每個段落 [MM:SS-MM:SS]
- 每段包含：段落標題、重點、拍法建議、旁白方向
- 開頭要有 Hook（5 秒內抓住注意力）
- 結尾要有總結 + CTA
- 總長度控制在 8-12 分鐘
- 直接輸出純文字，不要 markdown 格式`;
    }

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const script = msg.content[0].text.trim();
    addUsage('script', msg.usage.input_tokens, msg.usage.output_tokens);
    return res.status(200).json({ script });
  } catch (err) {
    console.error('Script error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
