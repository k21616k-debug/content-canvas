import Anthropic from '@anthropic-ai/sdk';
import { addUsage } from './_usage.js';

const anthropic = new Anthropic();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { input } = req.body;
    if (!input?.trim()) {
      return res.status(400).json({ error: 'input required' });
    }

    const prompt = `你是摩托車裝備 YouTube 頻道「摩托麻吉」的內容策略師。

使用者輸入了一段影片規劃描述。你的任務是解讀這段描述的結構，判斷方向，拆解出具體影片節點。

## 使用者輸入
${input}

## 判斷規則

### direction（方向）
- product-led：從一個產品出發，往外延伸到開箱、評測、比較、短片 Clip 等內容。特徵：有具體產品名/型號/品牌。
- content-led：從一個觀眾問題或主題出發，往下找適合的產品做示範。特徵：有觀眾痛點、「怎麼選」、「推薦」、教學型描述。
- no-product：純教學、觀點、旅遊記錄、Vlog 類型，不依附特定產品。

### contentStructure（結構類型）
- single：只有一支影片
- series：明確的系列（有前後關係、共用主題）
- split：一個主要長片 + 幾個從它剪出來的短片
- mixed：以上混合

### video role（每支影片的角色）
- main：系列或拆片的主影片
- child：從 main 剪出的短片
- sibling：同系列的其他獨立影片
- standalone：沒有依附關係的單獨影片

### format
- long：長片（YouTube 正片，8 分鐘以上）
- short：短片（Shorts/Reels，60 秒以內）

## 回傳格式

請用繁體中文，以 JSON 格式回傳（不要加 markdown code block）：

{
  "direction": "product-led | content-led | no-product",
  "directionExplain": "一句話解釋為什麼是這個方向（給使用者看，確認 AI 有讀懂）",
  "contentStructure": "single | series | split | mixed",
  "videos": [
    {
      "tempId": "v1",
      "topic": "影片主題（具體到可以直接當節點標題，不能太模糊）",
      "format": "long | short",
      "role": "main | child | sibling | standalone",
      "parentRef": "對應 main 的 tempId（只有 child 才填，其他填 null）",
      "suggestedStage": "A | B | C | D",
      "suggestedJob": "吸引 | 培育 | 轉換",
      "userIdeas": ["使用者提到的具體拍攝想法或重點（原文摘錄）"],
      "order": 1
    }
  ],
  "sharedContext": "這批影片共用的背景知識或拍攝素材（例：三款背包已到手、騎士日常通勤場景），供各節點 expand 時共用。沒有就寫空字串。",
  "clipOpportunities": [
    {
      "moment": "適合拆成短片的精華時刻或知識點",
      "sourceVideoRef": "從哪支影片的 tempId 剪出來",
      "format": "Reels | Shorts | TikTok",
      "suggestedHook": "這支短片的前 3 秒開場白（15 字以內）"
    }
  ],
  "missingInfo": "如果使用者的描述有重要資訊缺口（例：沒說目標客群、產品沒有具體型號），在這裡用一句話說明缺什麼。沒有缺口就寫空字串。"
}

## 規則

- videos 至少 1 個，通常 1-6 個，不要超過 8 個
- 每個 video 的 topic 要具體，不能寫「影片一」「開箱影片」這種空泛標題
- 使用者提到的所有具體想法都要出現在 userIdeas 裡（原文摘錄，不要重新詮釋）
- clipOpportunities 只有當影片有明確可剪片時刻才填，沒有就給空陣列
- 整個判斷要以使用者的輸入為依據，不要自己發明影片主題`;

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    addUsage('parse', msg.usage.input_tokens, msg.usage.output_tokens);
    const text = msg.content[0].text.trim();
    const s = text.indexOf('{');
    const e = text.lastIndexOf('}');
    const clean = (s >= 0 && e > s) ? text.slice(s, e + 1) : text;

    let result;
    try {
      result = JSON.parse(clean);
    } catch {
      return res.status(500).json({ error: 'AI 回傳格式錯誤', raw: text.substring(0, 300) });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('Parse error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
