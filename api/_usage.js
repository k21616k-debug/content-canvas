// In-memory usage accumulator (resets on server restart)
// Pricing: claude-sonnet-4-6 — $3/MTok input, $15/MTok output
const PRICE_INPUT = 3 / 1_000_000;
const PRICE_OUTPUT = 15 / 1_000_000;

const usage = {
  expand: { calls: 0, inputTokens: 0, outputTokens: 0 },
  review: { calls: 0, inputTokens: 0, outputTokens: 0 },
  ask:    { calls: 0, inputTokens: 0, outputTokens: 0 },
};

export function addUsage(endpoint, inputTokens, outputTokens) {
  if (!usage[endpoint]) return;
  usage[endpoint].calls++;
  usage[endpoint].inputTokens += inputTokens;
  usage[endpoint].outputTokens += outputTokens;
}

export function getUsage() {
  let totalInput = 0, totalOutput = 0, totalCalls = 0;
  for (const k of Object.keys(usage)) {
    totalInput  += usage[k].inputTokens;
    totalOutput += usage[k].outputTokens;
    totalCalls  += usage[k].calls;
  }
  const costUSD = totalInput * PRICE_INPUT + totalOutput * PRICE_OUTPUT;
  return {
    breakdown: { ...usage },
    totalCalls,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    estimatedCostUSD: parseFloat(costUSD.toFixed(4)),
  };
}
