import Anthropic from '@anthropic-ai/sdk';
import { addUsage } from './_usage.js';

const anthropic = new Anthropic();

/**
 * Run a prompt with web_search_20250305 enabled.
 * Handles the tool_use loop: for Anthropic's built-in web search,
 * the model searches automatically and the loop continues until end_turn.
 * Returns { text, inputTokens, outputTokens }.
 */
async function runWithSearch(messages, model, maxTokens) {
  const history = messages.map(m => ({ ...m }));
  let totalIn = 0, totalOut = 0, searchCount = 0;
  let accText = '';

  // round cap 5 (was 8): for Taiwan-gear vertical queries web_search saturates within
  // 1-3 calls; rounds 4+ fetch marginal/duplicate results at full latency cost.
  for (let round = 0; round < 5; round++) {
    const resp = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      tools: [{
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 3,
        user_location: { type: 'approximate', country: 'TW', timezone: 'Asia/Taipei' },
      }],
      messages: history,
    });

    totalIn  += resp.usage?.input_tokens  ?? 0;
    totalOut += resp.usage?.output_tokens ?? 0;
    // Instrumentation: count real web searches so a later speed change (fewer rounds /
    // smaller model) can be PROVEN not to have starved grounding, not guessed from confidence.
    searchCount += resp.usage?.server_tool_use?.web_search_requests ?? 0;

    const roundText = resp.content.filter(b => b.type === 'text').map(b => b.text).join('');

    // web_search_20250305 is server-side: Anthropic runs the search and embeds the
    // results in resp.content. A long-running search pauses the turn with
    // stop_reason 'pause_turn' — echo the assistant content back and continue the
    // same turn, accumulating text across rounds so nothing emitted before the pause
    // is lost. (Server-side tools need no client tool_result, so there is no
    // tool_use branch to handle here.)
    if (resp.stop_reason === 'pause_turn') {
      accText += roundText;
      history.push({ role: 'assistant', content: resp.content });
      continue;
    }

    // end_turn (done) or any other terminal stop_reason: return what we collected.
    return {
      text: (accText + roundText).trim(),
      inputTokens: totalIn,
      outputTokens: totalOut,
      searchCount,
    };
  }

  return { text: accText.trim(), inputTokens: totalIn, outputTokens: totalOut, searchCount };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { topic, userNotes, job, existingNodes, action, hook, angles, research, hookDirection } = req.body;

    // ── Hooks-only regeneration ──────────────────────────────────────────────
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

    // ── Titles action ────────────────────────────────────────────────────────
    if (action === 'titles') {
      const titlesPrompt = `你是摩托車裝備 YouTube 頻道「摩托麻吉」的標題和縮圖策略師。
根據以下影片資訊，產出 3 組 YouTube 標題 + 縮圖文字方向。

主題：${topic}
${hook ? `Hook：${hook}` : ''}
${job ? `Job：${job}` : ''}
${research?.insight ? `切入角度：${research.insight}` : ''}
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

    // ── Diverge action: propose 3 deep, distinct extending video concepts ──────
    if (action === 'diverge') {
      const srcStage = req.body.stage || '';
      const srcInsight = req.body.insight || '';
      const existingTopics = req.body.existingTopics || [];
      const divergePrompt = `你是摩托車裝備 YouTube 頻道「摩托麻吉」的內容策略師。

使用者正看著這支影片，想「發散」出更多可以延伸的新影片——不是擴寫這支，是衍生出別支新的。

來源影片：「${topic}」${job ? `（用途：${job}）` : ''}${srcStage ? `（階段：${srcStage}）` : ''}
${srcInsight ? `這支的切入點：${srcInsight}` : ''}
${userNotes ? `相關品牌筆記：${userNotes.substring(0, 400)}` : ''}
${existingTopics.length ? `\n畫布上已有的影片（含切入角度，用來判斷是否重複——不只看標題，要看論點）：\n${existingTopics.map(t => typeof t === 'string' ? `- ${t}` : `- ${t.topic}${t.insight ? `（已講的角度：${t.insight}）` : ''}`).join('\n')}` : ''}

請用 web search 查證後，發散出 3 個「深度、各不相同、可以直接拍」的延伸影片概念。
每個都要有查證過的具體差異化切入點，不要空泛、不要換湯不換藥的標題。

繁體中文，只回 JSON（不要 markdown code block）：
{
  "candidates": [
    {
      "topic": "新影片標題（具體到可以直接拍）",
      "insight": "為什麼這支值得拍——查證過的差異化切入點，具體到觀眾的情境",
      "audienceCares": "這支的目標觀眾最在意的 3 件事（具體到可當影片段落標題）",
      "searchKeywords": "3-5 個 YouTube 搜尋關鍵字（長尾詞，觀眾會打的）",
      "suggestedHook": "前 3 秒旁白，15 字內",
      "suggestedJob": "吸引|培育|轉換",
      "suggestedStage": "A|B|C|D",
      "angles": [{ "title": "拍攝角度", "why": "觀眾為何在意" }]
    }
  ]
}

規則：
- 3 個概念差異要夠大（不同切入點 / 不同階段 / 不同受眾），每個 insight 必須有具體根據，angles 給 2-3 個。
- 查不到足夠資料就少給幾個候選，寧缺勿濫——不要用聽起來合理但沒查證的內容湊滿 3 個。
- 【防重複契約】產出每個候選前，先比對它的核心切入角度是否與上面「畫布上已有的影片」任一支實質重疊（同產品同論點、同機制、換標題但同內容，都算重疊）。若有重疊，你必須在該候選 insight 開頭明確寫出「⚠與《那支影片標題》重疊，但因為＿＿所以仍值得拍」；如果你說不出一個非拍不可的全新理由，就不要產出這個候選——改換真正沒講過的角度，或寧可少給。禁止輸出你自己都判斷是重複的候選。`;

      let dresult;
      try {
        const dv = await runWithSearch(
          [{ role: 'user', content: divergePrompt }],
          'claude-sonnet-4-6',
          8000
        );
        addUsage('expand', dv.inputTokens, dv.outputTokens);
        if (!dv.searchCount) console.warn(`[diverge] ran 0 web searches for "${topic}" — candidates may rest on training data`);
        else console.log(`[diverge] web searches: ${dv.searchCount}`);
        const dtext = dv.text;
        const ds = dtext.indexOf('{'); const de = dtext.lastIndexOf('}');
        const dclean = (ds >= 0 && de > ds) ? dtext.slice(ds, de + 1) : dtext;
        dresult = JSON.parse(dclean);
      } catch (dErr) {
        // 429 = Anthropic rate limit (30k tok/min) — tell the user to wait instead of
        // surfacing a bare 500. Any other failure (search down / unparseable JSON)
        // degrades to an empty candidate list the frontend already handles.
        if (dErr?.status === 429) {
          return res.status(429).json({ error: '查詢太密集，請等約一分鐘再發散一次' });
        }
        console.warn('Diverge failed:', dErr.message);
        return res.status(200).json({ candidates: [], error: 'AI 查證或回傳格式出問題，請再試一次' });
      }
      // Drop candidates without a usable topic so the frontend never builds an
      // "undefined" node or throws in showToast.
      dresult.candidates = (dresult.candidates || []).filter(
        c => c && typeof c.topic === 'string' && c.topic.trim()
      );
      return res.status(200).json(dresult);
    }

    // ── Main expand ──────────────────────────────────────────────────────────
    const { stage } = req.body;
    const STAGE_LABELS = { A: 'A 認知', B: 'B 評估', C: 'C 信任', D: 'D 安心' };

    const existingContext = existingNodes?.length > 0
      ? `\n畫布上已有的其他影片：\n${existingNodes.map(n => `- 「${n.topic}」${n.job ? `(${n.job})` : ''}`).join('\n')}\n`
      : '';

    // ── Web search pre-pass ──────────────────────────────────────────────────
    // Always search when topic looks like a specific product/brand (no userNotes),
    // or when there are notes but they might have gaps.
    // We search regardless — let the AI decide what to look up.
    const searchPrompt = `你是在幫台灣摩托車裝備 YouTube 頻道「摩托麻吉」做影片企劃前的資料準備。

主題：「${topic}」
${userNotes ? `使用者已知資訊：${userNotes.substring(0, 300)}` : '（使用者尚未提供產品資訊）'}

請使用 web search 查詢以下資訊（優先查台灣市場）：
1. 產品正式規格（容量/重量/防水等級/材質）——如適用
2. 台灣代理商或購買通路（官網、momo、PChome、蝦皮等）
3. 台灣實際售價（新台幣）
4. 胸扣（sternum strap）、腰帶（waist belt）是否標配
5. 台灣 YouTube 上現有的類似影片有哪些？觀點是什麼？
6. 台灣騎士社群（論壇、PTT、FB）對這個主題的常見討論或誤解

查完後，用條列式整理你找到的事實。沒查到的項目直接標記「未找到」，不要猜。`;

    let webFacts = '';
    try {
      const searchResult = await runWithSearch(
        [{ role: 'user', content: searchPrompt }],
        'claude-haiku-4-5-20251001',
        2000
      );
      addUsage('expand', searchResult.inputTokens, searchResult.outputTokens);
      webFacts = searchResult.text;
      // searchCount surfaces whether the pre-pass actually searched. 0 = insight will rest on
      // training data, not verified facts (grounding starved) — logged so a speed tune can't hide it.
      if (!searchResult.searchCount) console.warn(`[expand] pre-pass ran 0 web searches for "${topic}" — grounding may rest on training data`);
      else console.log(`[expand] pre-pass web searches: ${searchResult.searchCount}`);
    } catch (searchErr) {
      console.warn('Web search pre-pass failed (non-fatal):', searchErr.message);
      // Non-fatal: fall through to main expand without web facts
    }

    // ── Build main expand prompt ─────────────────────────────────────────────
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
${webFacts ? `\n## 網路查詢結果（已驗證的公開資訊）\n${webFacts}\n\n這些是從網路查到的實際資料，優先級高於訓練資料中的印象，請據此修正任何不一致的地方。` : ''}
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
    "ctaSpoken": "觀眾看完，你口播的那一句話。15 字以內，直接說出口的句子，不要加任何解釋或說明",
    "ctaStrategy": "CTA 的策略說明：這個 CTA 為什麼有效、怎麼搭配影片末尾使用（這欄不會出現在影片中）",
    "suggestedHook": "前三秒旁白，15 字以內，能讓目標觀眾停止滑動",
    "confidence": "high|medium|low",
    "aiNeeds": "如果 confidence 是 medium 或 low，具體缺什麼資訊才能讓建議更準確。high 就給空字串",
    "suggestedJob": "吸引|培育|轉換——這支影片在觀眾心中的主要作用",
    "suggestedStage": "A|B|C|D——購買旅程階段（A認知 / B評估 / C信任 / D安心）"
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
- confidence 要誠實：
  - high = 你有足夠知識推導（包含網路查詢結果）
  - medium = 部分資訊仍不確定
  - low = 大部分是推測，或網路查詢也沒找到足夠資訊
  - 如果使用者沒有提供產品筆記且網路查詢也無結果，confidence 必須是 "low"
- suggestedJob/suggestedStage：吸引=讓陌生人認識(階段A)；培育=幫有興趣的人比較評估(B)；轉換=讓人信任並下單(信任填C、安心填D)。suggestedStage 必須是單一字母 A/B/C/D 其中一個，不可寫成 "C/D"、範圍或中文。沒把握也要給最合理的單一階段，不要空白
- ctaSpoken 必須 15 字以內，可以直接口播的那一句話，例：「留言告訴我你用哪種包」「連結在資訊欄下方」。不要是策略說明，不要包含「告訴觀眾」「影片結尾」等製作描述
- detailShots：product 型給 4 個以上；concept 型可以不給；comparison 型（多品比較）每個品牌給 2-3 個
- hooks 3 個風格差異要夠大，不能只是換詞，每個在 15 字以內`;

    // CLAUDE.md 審查第1題（採集/推導分層）: the haiku pre-pass above is now the SINGLE
    // web-search pass (採集 — slow, outward, once). The main sonnet call is pure 推導 —
    // NO web_search tool — so the same video is never searched twice (kills the redundant
    // ~60-90s second search). It reasons over the webFacts already fetched above.
    const mainMsg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    });
    addUsage('expand', mainMsg.usage.input_tokens, mainMsg.usage.output_tokens);
    const text = mainMsg.content.filter(b => b.type === 'text').map(b => b.text).join('');

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
        research: { insight: text.substring(0, 200) },
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
