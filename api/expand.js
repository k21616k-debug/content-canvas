import Anthropic from '@anthropic-ai/sdk';
import { addUsage } from './_usage.js';

const anthropic = new Anthropic();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { topic, userNotes, job, existingNodes, action, hook, angles, research } = req.body;

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

    // Build existing nodes context for ecosystem awareness
    const existingContext = existingNodes?.length > 0
      ? `\n畫布上已有的其他影片：\n${existingNodes.map(n => `- 「${n.topic}」${n.job ? `(${n.job})` : ''}`).join('\n')}\n`
      : '';

    const prompt = `你是摩托車裝備 YouTube 頻道「摩托麻吉」的資深內容策略顧問。

## 第一步：判斷使用者輸入的類型

使用者輸入：「${topic}」

判斷這是哪一種輸入：
- product：具體產品（含品牌名、型號、產品類型）→ 需要產品研究 + 產品細節拍攝清單
- concept：概念型內容（怎麼選、什麼是、教學）→ 需要知識架構 + 觀眾痛點
- pain-point：觀眾痛點或需求（觀眾一直問、大家都想知道）→ 需要先聚焦方向
- trend：趨勢或話題（最近流行、新發表、爭議）→ 需要時效性角度

## 第二步：使用者的創意方向（最重要）

${userNotes ? `🔴 使用者已經有想法，你的建議必須以此為基礎延伸，不能忽略：\n「${userNotes}」\n\n使用者寫的每一個具體方向（產品特色、拍攝想法、觀眾痛點）都必須出現在你的建議中。先採納使用者的方向，再補充他沒想到的。` : '使用者還沒有具體方向，請根據主題給出全面建議。'}
${job ? `影片目的：${job}` : ''}
${existingContext}

## 第三步：產出研究結果

請用繁體中文，以 JSON 格式回傳（不要加 markdown code block）：
{
  "inputType": "product|concept|pain-point|trend",
  "aiReceivedSummary": "用一句話總結你理解使用者想做什麼（讓使用者確認你有聽懂）",
  "targetAudience": "這支影片主要給誰看（例：剛入門的新手騎士 / 想升級裝備的進階騎士 / 預算有限的學生騎士）",
  "research": {
    "positioning": "這個主題在摩托車裝備市場的定位（一句話）",
    "features": "重點規格或特色（用頓號分隔）",
    "competitors": "同類型競品或相關內容比較",
    "priceRange": "價格帶（NT$），如果是概念型內容可以寫適用範圍",
    "audienceCares": "目標觀眾最在意的 3 件事（具體到可以當影片段落標題）",
    "searchKeywords": "建議這支影片要打的 3-5 個 YouTube 搜尋關鍵字（長尾詞優先，觀眾會搜什麼就寫什麼）",
    "suggestedCta": "建議的 CTA（一句引導留言或互動的話）"
  },
  "hooks": [
    { "style": "好奇缺口", "text": "讓人好奇到非點不可的開場（知識落差型）" },
    { "style": "大膽宣言", "text": "有爭議性、有立場的開場（觀點型）" },
    { "style": "故事引入", "text": "用個人經驗開場（共鳴型）" }
  ],
  "angles": [
    {
      "title": "拍攝角度標題（一句話）",
      "why": "為什麼觀眾會想看這個（具體到觀眾的情境）",
      "howToShoot": "具體怎麼拍（鏡位、道具、對比方式）"
    }
  ],
  "detailShots": [
    {
      "what": "要拍的細節（例：600D 尼龍布料特寫）",
      "why": "為什麼觀眾想看這個細節",
      "cameraSetup": "拍攝建議（鏡頭、角度、光線）"
    }
  ],
  "ecosystemNotes": "和畫布上其他影片的關聯建議（差異化方向、End Screen 互推建議、避免重複角度）。如果沒有其他影片就給「這是第一支影片，建議之後規劃 [方向]」"
}

## 規則

angles 規則：
- 給 5 個拍攝方向
- 前 2 個是「必拍基礎鏡頭」（開箱/外觀/基本功能展示）
- 後 3 個是「差異化角度」（觀眾沒在別的頻道看過的）
- 每個角度要具體到可以直接排拍攝表
- 如果使用者有寫具體方向，至少 2 個 angle 要根據使用者的方向延伸

detailShots 規則（產品型內容必填，概念型可選）：
- 如果 inputType 是 product，至少給 4 個產品細節拍攝
- 包含：材質特寫、功能演示、尺寸/重量比較、使用場景
- 如果使用者有提到具體細節（例：水壺袋、600D布料），必須包含
- 概念型內容可以給 0-2 個（例如比較圖表、數據畫面）

hooks 規則：
- 3 個 Hook 風格要差異夠大
- 不能只是換詞，要是完全不同的切入角度
- 每個 Hook 都要在 15 字以內、能當影片前 3 秒的旁白

searchKeywords 規則：
- 用觀眾會打的搜尋詞，不是專業術語
- 長尾關鍵字優先（「機車背包推薦 2024」比「背包」好）
- 至少 1 個要適合放進影片標題`;

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
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
