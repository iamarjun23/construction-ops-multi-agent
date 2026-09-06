export interface UsageStats {
  llmCalls: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  embeddingCalls: number;
  embeddingTokens: number;
}

// Module-level counters, not per-instance — the eval harness (Phase 5)
// snapshots/resets these around each condition run to measure per-question
// API cost and call counts without threading a counter through every
// function signature in src/agents, src/supervisor, and src/rag.
const usage: UsageStats = {
  llmCalls: 0,
  llmInputTokens: 0,
  llmOutputTokens: 0,
  embeddingCalls: 0,
  embeddingTokens: 0,
};

export function recordLLMUsage(inputTokens: number, outputTokens: number): void {
  usage.llmCalls += 1;
  usage.llmInputTokens += inputTokens;
  usage.llmOutputTokens += outputTokens;
}

export function recordEmbeddingUsage(tokens: number): void {
  usage.embeddingCalls += 1;
  usage.embeddingTokens += tokens;
}

export function snapshotUsage(): UsageStats {
  return { ...usage };
}

export function resetUsage(): void {
  usage.llmCalls = 0;
  usage.llmInputTokens = 0;
  usage.llmOutputTokens = 0;
  usage.embeddingCalls = 0;
  usage.embeddingTokens = 0;
}

export function diffUsage(before: UsageStats, after: UsageStats): UsageStats {
  return {
    llmCalls: after.llmCalls - before.llmCalls,
    llmInputTokens: after.llmInputTokens - before.llmInputTokens,
    llmOutputTokens: after.llmOutputTokens - before.llmOutputTokens,
    embeddingCalls: after.embeddingCalls - before.embeddingCalls,
    embeddingTokens: after.embeddingTokens - before.embeddingTokens,
  };
}

// Pricing snapshot (see SPEC.md's LLM adapter notes). Claude Sonnet 5:
// $2/$10 per MTok (input/output). OpenAI text-embedding-3-small: ~$0.02
// per MTok, per OpenAI's published pricing — approximate and configurable
// here rather than asserted as exact, since embedding pricing isn't pinned
// anywhere else in this codebase.
const CLAUDE_SONNET_5_INPUT_PER_MTOK = 2;
const CLAUDE_SONNET_5_OUTPUT_PER_MTOK = 10;
const OPENAI_EMBEDDING_SMALL_PER_MTOK = 0.02;

export function estimateCostUsd(stats: UsageStats): number {
  const llmCost =
    (stats.llmInputTokens / 1_000_000) * CLAUDE_SONNET_5_INPUT_PER_MTOK +
    (stats.llmOutputTokens / 1_000_000) * CLAUDE_SONNET_5_OUTPUT_PER_MTOK;
  const embeddingCost = (stats.embeddingTokens / 1_000_000) * OPENAI_EMBEDDING_SMALL_PER_MTOK;
  return llmCost + embeddingCost;
}
