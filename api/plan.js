import Anthropic from '@anthropic-ai/sdk';
import { addUsage } from './_usage.js';

const anthropic = new Anthropic();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { fragments = [], existingPlan = null } = req.body;
    if (!fragments.length) {
      return res.status(400).json({ error: 'fragments required' });
    }

    const fragmentText = fragments.map((f, i) => `[${i + 1}] ${f}`).join('\n');
    const existingContext = existingPlan
      ? `\n## 目前的計劃（需要根據新條件更新）\n${JSON.stringify(existingPlan.videos?.map(v => ({ id: v.id, topic: v.topic, stage: v.stage })), null, 2)}`
      : '';

    const prompt = `你是摩托車裝備 YouTube 頻道「摩托麻吉」的內容策略師。

你的任務：根據使用者給的碎片，推導出一個完整的影片計劃。

## 推導原則

你在做的是「知識推導」，不是「文字接龍」。

每一個建議都要能回答：「這個判斷的根據是什麼？」

推導每支影片時，你要問自己：
- 這個產品或主題，在騎士社群裡有什麼具體的知識空白、常見誤解、或爭議？
- 目標觀眾在什麼具體情境下會需要這支影片？
- 市場上已有哪些類似內容？這支影片的切入點和那些的差異是什麼？
- 如果你對這個產品的了解不足，你具體缺什麼知識？

如果你不確定，誠實說出來，不要用聽起來合理但沒有根據的建議填滿空白。

## 使用者給的碎片
${fragmentText}
${existingContext}

## 購買旅程框架
- A 認知：讓陌生人知道這個產品或問題的存在
- B 評估：讓有興趣的人有足夠資訊做比較和選擇
- C 信任：讓猶豫的人相信這是對的選擇（使用心得、真實測試）
- D 安心：讓準備購買的人消除最後疑慮（價格、哪裡買、保固）

## 回傳格式

JSON，不要加 markdown code block：

{
  "reasoning": "一段話解釋你怎麼從這些碎片推導出這個計劃——讓使用者確認你的邏輯是否正確",
  "videos": [
    {
      "id": "v1",
      "topic": "具體到可以直接開始拍的標題（不是泛稱，不是『開箱影片』）",
      "insight": "這支影片為什麼值得拍——你的角度和市場上已有的有什麼不同，觀眾為什麼要看你而不是別人。如果你對市場現況不確定，說出來",
      "audience": "誰在什麼具體情境下會搜尋或需要這支影片（寫成一個真實的人的描述）",
      "stage": "A|B|C|D",
      "stageReason": "為什麼這支影片屬於這個階段",
      "hook": "前三秒旁白，15字以內，能讓目標觀眾停止滑動",
      "angles": [
        {
          "title": "拍攝方向（一句話）",
          "why": "觀眾為什麼在意這個具體點",
          "how": "怎麼拍——具體到片師不需要再問"
        }
      ],
      "cta": "觀眾看完要做什麼（具體行動，不是『歡迎留言』）",
      "format": "long|short",
      "confidence": "high|medium|low",
      "aiNeeds": "如果 confidence 是 medium 或 low，AI 需要什麼具體資訊才能讓這支影片更準確。confidence 是 high 就給空字串"
    }
  ],
  "portfolioNote": "這批影片整體的邏輯——哪個階段有覆蓋、哪個缺、整體策略是否合理",
  "aiQuestions": ["最重要的 1-2 個具體問題，能幫助 AI 大幅改進計劃品質。沒有就給空陣列"]
}

## 規則

- videos 1-6 支，寧少不濫，不確定的寧可問清楚再建議
- insight 是最重要的欄位。「介紹產品特色」是廢話，要說出具體的差異化角度
- confidence 要誠實：high 代表你有足夠知識推導，low 代表大部分是推測
- angles 每支影片 3-5 個，要具體到可以排拍攝表
- aiQuestions 只問最能改變計劃品質的問題，不要問可有可無的`;

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    });

    addUsage('plan', msg.usage.input_tokens, msg.usage.output_tokens);

    const text = msg.content[0].text.trim();
    const s = text.indexOf('{');
    const e = text.lastIndexOf('}');
    const clean = s >= 0 && e > s ? text.slice(s, e + 1) : text;

    let result;
    try {
      result = JSON.parse(clean);
    } catch {
      return res.status(500).json({ error: 'AI 回傳格式錯誤', raw: text.substring(0, 300) });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('Plan error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
