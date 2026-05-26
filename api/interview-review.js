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
      if (n.guest) parts.push(`來賓=${n.guest}`);
      if (n.interviewType) parts.push(`類型=${n.interviewType}`);
      if (n.job) parts.push(`Job=${n.job}`);
      if (n.stage) parts.push(`階段=${n.stage}`);
      if (n.cta) parts.push(`CTA=${n.cta}`);
      if (n.hook) parts.push(`Hook=${n.hook}`);
      if (n.isMain) parts.push('★主節點');
      if (n.angles) parts.push(`問題方向：${n.angles}`);
      return parts.join(' | ');
    }).join('\n');

    const connsText = connections.length > 0
      ? connections.map(c => `${c.fromTopic} → ${c.toTopic}`).join('\n')
      : '（目前沒有連線）';

    const prompt = `你是摩托車裝備 YouTube 頻道「摩托麻吉」的訪談策略顧問。
以下是目前訪談畫布上的所有訪談企劃節點：

${nodesText}

連線關係：
${connsText}

請用繁體中文，以 JSON 格式回傳你的訪談策略檢討（不要加 markdown code block）：
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
  "summary": "一句話總結目前訪談策略的狀態"
}

檢查重點：
1. 來賓多樣性（有沒有都找同一類型的人、有沒有涵蓋不同專業角度）
2. 訪談類型多樣性（深度專訪/座談/街訪/快問快答是否有節奏變化）
3. 內容目的平衡（拉新→深度→信任→社群四階段是否都有覆蓋）
4. 主題重複或太相似（語意層面，不只是字面）
5. 問題設計品質（Hook 是否有吸引力、有沒有情緒高點、CTA 是否具體）
6. 短影音潛力（有沒有規劃能剪短片的高點題目）
7. 系列感（訪談之間有沒有串聯、能不能組成系列）
8. 被忽略的機會點（觀眾可能想看但你沒規劃的訪談方向）

issues 最多 6 個，按 severity 排序。`;

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = msg.content[0].text.trim();
    const clean = text.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
    const result = JSON.parse(clean);

    return res.status(200).json(result);
  } catch (err) {
    console.error('Interview review error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
