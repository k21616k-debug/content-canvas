import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { nodes, connections } = req.body;

    const nodesText = nodes.map((n, i) => {
      const parts = [`${i + 1}. 「${n.topic}」`];
      if (n.job) parts.push(`Job=${n.job}`);
      if (n.stage) parts.push(`階段=${n.stage}`);
      if (n.cta) parts.push(`CTA=${n.cta}`);
      if (n.hook) parts.push(`Hook=${n.hook}`);
      if (n.isMain) parts.push('★主節點');
      if (n.angles) parts.push(`拍攝角度：${n.angles}`);
      return parts.join(' | ');
    }).join('\n');

    const connsText = connections.length > 0
      ? connections.map(c => `${c.fromTopic} → ${c.toTopic}`).join('\n')
      : '（目前沒有連線）';

    const prompt = `你是摩托車裝備 YouTube 頻道「摩托麻吉」的內容策略顧問。
以下是目前畫布上的所有影片企劃節點：

${nodesText}

連線關係：
${connsText}

請用繁體中文，以 JSON 格式回傳你的策略檢討（不要加 markdown code block）：
{
  "issues": [
    {
      "type": "duplicate|gap|quality|conflict|opportunity",
      "severity": "high|medium|low",
      "title": "問題簡述（10字以內）",
      "detail": "具體說明（含哪些節點、為什麼是問題）",
      "suggestion": "建議怎麼修（具體可執行的動作）"
    }
  ],
  "overallScore": 1-10,
  "summary": "一句話總結目前策略的狀態"
}

檢查重點：
1. 主題有沒有重複或太相似（語意層面，不只是字面）
2. 購買旅程有沒有斷層（認知→評估→信任→安心）
3. Hook 和 CTA 的品質（夠不夠具體、有沒有吸引力）
4. 拍攝角度有沒有新意（還是都是老套開箱）
5. 整體節奏感（長片短片比例、吸引vs轉換的平衡）
6. 被忽略的機會點（觀眾可能想看但你沒規劃的）
7. SEO 關鍵字打架：如果多支影片的主題太接近，它們可能搶同一個搜尋關鍵字，建議差異化
8. 發布順序建議：根據目前的影片組合，建議最佳的發布順序（先發什麼、後發什麼、為什麼）

在 issues 之外，多回傳一個 publishOrder：
{
  "issues": [...],
  "overallScore": 1-10,
  "summary": "一句話總結",
  "publishOrder": "建議的發布順序和理由（50字以內，例：先發A認知拉新→再發B評估加深→穿插C信任促轉換）"
}

issues 最多 6 個，按 severity 排序。`;

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2500,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = msg.content[0].text.trim();
    const clean = text.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
    let result;
    try { result = JSON.parse(clean); } catch { result = { issues: [], overallScore: 5, summary: text.substring(0, 200) }; }

    return res.status(200).json(result);
  } catch (err) {
    console.error('Review error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
