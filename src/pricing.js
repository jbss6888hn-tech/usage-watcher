// USD per million tokens. Reference: Anthropic public pricing (subject to change).
// Cache reads are billed at ~10% of input, cache writes at ~25% above input.
export const CLAUDE_PRICING = {
  "claude-opus-4-7":   { input: 15.00, output: 75.00, cache_write: 18.75, cache_read: 1.50 },
  "claude-opus-4-5":   { input: 15.00, output: 75.00, cache_write: 18.75, cache_read: 1.50 },
  "claude-opus-4":     { input: 15.00, output: 75.00, cache_write: 18.75, cache_read: 1.50 },
  "claude-sonnet-4-6": { input:  3.00, output: 15.00, cache_write:  3.75, cache_read: 0.30 },
  "claude-sonnet-4-5": { input:  3.00, output: 15.00, cache_write:  3.75, cache_read: 0.30 },
  "claude-sonnet-4":   { input:  3.00, output: 15.00, cache_write:  3.75, cache_read: 0.30 },
  "claude-haiku-4-5":  { input:  1.00, output:  5.00, cache_write:  1.25, cache_read: 0.10 },
};

const DEFAULT = CLAUDE_PRICING["claude-sonnet-4-6"];

export function priceForModel(modelId) {
  if (!modelId) return DEFAULT;
  for (const [prefix, p] of Object.entries(CLAUDE_PRICING)) {
    if (modelId === prefix || modelId.startsWith(prefix)) return p;
  }
  return DEFAULT;
}

export function costUSD({ model, input_tokens = 0, output_tokens = 0, cache_creation_input_tokens = 0, cache_read_input_tokens = 0 }) {
  const p = priceForModel(model);
  return (
    (input_tokens * p.input
      + output_tokens * p.output
      + cache_creation_input_tokens * p.cache_write
      + cache_read_input_tokens * p.cache_read)
    / 1_000_000
  );
}
