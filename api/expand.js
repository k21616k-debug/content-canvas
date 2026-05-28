import Anthropic from '@anthropic-ai/sdk';
import { addUsage } from './_usage.js';

const anthropic = new Anthropic();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { topic, userNotes, job, existingNodes, action, hook, angles, research, hookDirection } = req.body;

    // Hooks-only regeneration with direction refinement
    if (action === 'hooks') {
      const hooksPrompt = `你是摩托車裝備 YouTube 頻道「摩托麻吉」的 Hook 策略師。

影片主題：${topic}
${job ? `影片目的：${job}` : ''}
${userNotes ? `使用者備註：${userNotes}` : ''}
${hookDirection ? `🔴 使用者的調整方向（最優先）：${hookDirection}` : ''}

請根據以上資訊產出 3 個差異夠大的 Hook 開場。
每個 Hook 15 字以內，可直接當影片前 3 秒的旁白。

請用繁體中文，以 JSON 格式回傳（不要加 markdown code block）：
{
  "hooks": [
    { "style": "Hook 風格名稱", "text": "Hook 文字（15字以內）" },
    { "style": "Hook 風格名稱", "text": "Hook 文字（15字以內）" },
    { "style": "Hook 風格名稱", "text": "Hook 文字（15字以內）" }
  ]
}`;

      const hooksMsg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content: hooksPrompt }],
      });
      addUsage('expand', hooksMsg.usage.input_tokens, hooksMsg.usage.output_tokens);
      const hooksText = hooksMsg.content[0].text.trim();
      const hooksClean = hooksText.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
      return res.status(200).json(JSON.parse(hooksClean));
    }

    // Titles action — separate lightweight prompt
    if (action === 'titles') {
      const titlesPrompt = `你是摩托車裝備 YouTube 頻道「摩托麻吉」的標題和縮圖策略師。
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

      const titlesMsg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        messages: [{ role: 'user', content: titlesPrompt }],
      });
      addUsage('expand', titlesMsg.usage.input_tokens, titlesMsg.usage.output_tokens);
      const titlesText = titlesMsg.content[0].text.trim();
      const titlesClean = titlesText.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
      return res.status(200).json(JSON.parse(titlesClean));
    }

    const { stage } = req.body;
    const STAGE_LABELS = { A: 'A 認知', B: 'B 評估', C: 'C 信任', D: 'D 安心' };

    const existingContext = existingNodes?.length > 0
      ? `\n畫布上已有的其他影片：\n${existingNodes.map(n => `- 「${n.topic}」${n.job ? `(${n.job})` : ''}`).join('\n')}\n`
      : '';

    const prompt = `你是摩托車裝備 YouTube 頻道「摩托麻吉」的內容策略師。

## 工作原則：知識推導，不是文字接龍

每一個建議都必須能回答：「這個判斷的根據是什麼？」

推導這支影片時，你要問自己：
- 台灣騎士社群對這個主題有什麼具體的知識空白、常見誤解、或爭議？
- YouTube 上現有的相關內容視角是什麼？這支影片的切入點和那些的差異是什麼？
- 目標觀眾在什麼具體情境下會需要這支影片？
- 如果你對這個產品或主題了解不足，你具體缺什麼知識？

如果你不確定，誠實說出來，不要用聽起來合理但沒有根據的建議填滿空白。

## 影片資訊

主題：${topic}
${stage ? `購買旅程階段：${STAGE_LABELS[stage] || stage}` : ''}
${job ? `影片目的（在觀眾心中的作用）：${job}` : ''}
${userNotes ? `🔴 使用者的已知方向（最優先）：\n「${userNotes}」\n\n每一個使用者提到的具體方向都必須出現在建議中。先採納，再補充他沒想到的。` : ''}
${existingContext}

## 回傳格式

JSON，不要加 markdown code block：

{
  "inputType": "product|concept|pain-point|trend",
  "aiReceivedSummary": "一句話說你理解使用者要做什麼",
  "targetAudience": "誰在什麼具體情境下需要這支影片（寫成一個真實的人）",
  "research": {
    "insight": "這支影片為什麼值得拍——你的角度和市場上已有的有什麼不同，觀眾為什麼要看你而不是別人。如果你對市場現況不確定，說出來",
    "audienceCares": "目標觀眾最在意的 3 件事（具體到可以當影片段落標題）",
    "searchKeywords": "3-5 個 YouTube 搜尋關鍵字（長尾詞，觀眾會打什麼就寫什麼）",
    "suggestedCta": "觀眾看完要做什麼（具體行動，不是「歡迎留言」）",
    "suggestedHook": "前三秒旁白，15 字以內，能讓目標觀眾停止滑動",
    "confidence": "high|medium|low",
    "aiNeeds": "如果 confidence 是 medium 或 low，具體缺什麼資訊才能讓建議更準確。high 就給空字串"
  },
  "hooks": [
    { "style": "Hook 風格名稱", "text": "Hook 文字（15字以內）" }
  ],
  "angles": [
    {
      "title": "拍攝方向標題",
      "why": "觀眾為什麼在意這個——具體到觀眾的情境，不是「大家都想知道」",
      "howToShoot": "具體怎麼拍，具體到片師不需要再問"
    }
  ],
  "detailShots": [
    {
      "what": "要拍的細節",
      "why": "為什麼觀眾想看這個細節",
      "cameraSetup": "拍攝建議"
    }
  ],
  "ecosystemNotes": "和畫布上其他影片的關聯建議。沒有其他影片就給「這是第一支影片，建議之後規劃 [方向]」"
}

## 規則

- angles 給 4-5 個。如果使用者有具體方向，至少 2 個必須根據使用者方向延伸
- insight 是最重要的欄位。「介紹產品特色」是廢話，要說出具體的差異化角度
- confidence 要誠實：high = 你有足夠知識推導，low = 大部分是推測
- detailShots：product 型給 4 個以上；concept 型可以不給
- hooks 3 個風格差異要夠大，不能只是換詞，每個在 15 字以內`;

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    });

    addUsage('expand', msg.usage.input_tokens, msg.usage.output_tokens);
    const text = msg.content[0].text.trim();
    const s = text.indexOf('{'); const e = text.lastIndexOf('}');
    const clean = (s >= 0 && e > s) ? text.slice(s, e + 1) : text;
    let result;
    try {
      result = JSON.parse(clean);
    } catch {
      result = {
        inputType: 'concept',
        aiReceivedSummary: topic,
        targetAudience: '',
        research: { positioning: text.substring(0, 200) },
        hooks: [],
        angles: [],
        detailShots: [],
        ecosystemNotes: '',
      };
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('Expand error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
