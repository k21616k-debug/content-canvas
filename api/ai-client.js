import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function getModel(opts = {}) {
  const config = { maxOutputTokens: opts.maxTokens || 16384 };
  // Default thinkingBudget to 0 to prevent token exhaustion/truncation in fast interactive tasks
  const budget = opts.thinkingBudget !== undefined ? opts.thinkingBudget : 0;
  config.thinkingConfig = { thinkingBudget: budget };
  if (opts.jsonMode) {
    config.responseMimeType = 'application/json';
  }
  console.log('getModel config:', JSON.stringify(config));
  const modelOpts = {
    model: 'gemini-2.5-flash',
    generationConfig: config,
  };
  if (opts.search) {
    modelOpts.tools = [{ googleSearch: {} }];
  }
  return genAI.getGenerativeModel(modelOpts);
}

function parseUsage(result) {
  const u = result.response.usageMetadata || {};
  return {
    inputTokens: u.promptTokenCount || 0,
    outputTokens: u.candidatesTokenCount || 0,
    totalTokens: u.totalTokenCount || 0,
  };
}

export async function aiChat(prompt, opts = {}) {
  const model = getModel(opts);
  const result = await model.generateContent(prompt);
  console.log('Gemini candidate:', JSON.stringify(result.response.candidates?.[0]));
  console.log('Gemini usageMetadata:', JSON.stringify(result.response.usageMetadata));
  const usage = parseUsage(result);
  const text = result.response.text();
  return { text, ...usage };
}

export async function aiChatWithSearch(prompt, opts = {}) {
  const model = getModel({ ...opts, search: true });
  const result = await model.generateContent(prompt);
  const usage = parseUsage(result);
  const grounding = result.response.candidates?.[0]?.groundingMetadata;
  const text = result.response.text();
  return {
    text,
    ...usage,
    searchCount: grounding?.webSearchQueries?.length || 0,
  };
}

export function cleanJson(text) {
  const t = text.trim();
  const stripped = t.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
  const s = stripped.indexOf('{');
  const e = stripped.lastIndexOf('}');
  return (s >= 0 && e > s) ? stripped.slice(s, e + 1) : stripped;
}
