import Anthropic from '@anthropic-ai/sdk';
import { addUsage } from './_usage.js';

const anthropic = new Anthropic();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { question, context } = req.body;

    const nodesText = (context.nodes || []).map((n, i) => {
      const parts = [`${i + 1}. 「${n.topic}」`];
      if (n.id) parts.push(`id=${n.id}`);
      if (n.job) parts.push(`Job=${n.job}`);
      if (n.cta) parts.push(`CTA=${n.cta}`);
      if (n.stage) parts.push(`階段=${n.stage}`);
      if (n.hook) parts.push(`Hook=${n.hook}`);
      if (n.insight) parts.push(`切入點=${n.insight}`);
      if (n.audienceCares) parts.push(`觀眾在意=${n.audienceCares}`);
      if (n.isMain) parts.push('★主節點');
      if (n.user) parts.push(`備註=${n.user.substring(0, 100)}`);
      if (n.angles) parts.push(`拍攝角度：${n.angles}`);
      return parts.join(' | ');
    }).join('\n');

    const connsText = (context.connections || []).length > 0
      ? context.connections.map(c => `${c.fromTopic} → ${c.toTopic}`).join('\n')
      : '（無連線）';

    const focusText = context.focusNode
      ? `\n⚡ 使用者正在看的節點：「${context.focusNode.topic}」(id=${context.focusNode.id})`
      : '';

    const today = new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });
    const prompt = `你是摩托車裝備 YouTube 頻道「摩托麻吉」的內容策略顧問。
今天日期：${today}
使用者正在用內容策略畫布規劃影片，向你提問。

目前畫布上的節點：
${nodesText || '（空畫布）'}

連線：
${connsText}
${focusText}

使用者的問題：「${question}」

請用繁體中文回覆，以 JSON 格式回傳（不要加 markdown code block）：
{
  "answer": "你的回答（清楚、具體、可執行，不要超過 150 字）",
  "actions": []
}

actions 是你建議的具體操作，只在你認為應該修改畫布時才加。可用的 action type：
- {"type":"update","nodeId":"節點id","field":"job|cta|topic","value":"新值","label":"按鈕文字"}
- {"type":"connect","fromId":"id","toId":"id","label":"連線 A → B"}
- {"type":"move-stage","nodeId":"id","stage":"A|B|C|D","label":"移到 X 階段"}
- {"type":"new-node","topic":"主題","job":"吸引|培育|轉換","stage":"A|B|C|D","label":"新增「主題」"}

規則：
- 如果使用者只是問問題（「這樣好嗎？」「有什麼建議？」），answer 回答就好，actions 留空
- 如果使用者要你改東西（「幫我改 CTA」「把它移到 B」），answer 簡短說明 + actions 給操作
- 每個 action 必須有 label（顯示在按鈕上，5 字以內）
- actions 最多 4 個`;

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    addUsage('ask', msg.usage.input_tokens, msg.usage.output_tokens);
    const text = msg.content[0].text.trim();
    const s = text.indexOf('{'); const e = text.lastIndexOf('}');
    const clean = (s >= 0 && e > s) ? text.slice(s, e + 1) : text;
    const result = JSON.parse(clean);

    return res.status(200).json(result);
  } catch (err) {
    console.error('Ask error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
