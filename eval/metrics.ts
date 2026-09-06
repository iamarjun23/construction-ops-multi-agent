export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}

export function median(values: number[]): number {
  return percentile(values, 0.5);
}

export function rate(count: number, total: number): number {
  if (total === 0) return 0;
  return count / total;
}

export type ConditionName = 'plain_rag' | 'single_agent' | 'multi_agent';

export interface ConditionRunResult {
  questionId: string;
  condition: ConditionName;
  latencyMs: number;
  llmCalls: number;
  embeddingCalls: number;
  costUsd: number;
  toolCalls: number;
  evidenceSourceTypes: ('payment' | 'contract' | 'progress')[];
  expectedSpecialists: ('payment' | 'contract' | 'progress')[];
  unsupportedClaimCount: number;
  totalClaimCount: number;
  completeness: number;
  citationsCorrect: boolean;
  expectedConflict: boolean | null;
  conflictSurfaced: boolean | null;
  failed: boolean;
  errorMessage?: string;
}

export interface ConditionSummary {
  condition: ConditionName;
  n: number;
  medianLatencyMs: number;
  p95LatencyMs: number;
  totalCostUsd: number;
  avgLlmCalls: number;
  avgEmbeddingCalls: number;
  avgToolCalls: number;
  evidenceCompletenessRate: number;
  unsupportedClaimRate: number;
  citationCorrectRate: number;
  avgCompleteness: number;
  conflictDetectionAccuracy: number | null;
  failedTaskRate: number;
}

/** Did the evidence actually touch every specialist type the question expected? */
function coversExpectedSpecialists(result: ConditionRunResult): boolean {
  return result.expectedSpecialists.every((s) => result.evidenceSourceTypes.includes(s));
}

export function summarizeCondition(condition: ConditionName, results: ConditionRunResult[]): ConditionSummary {
  const own = results.filter((r) => r.condition === condition);
  const ok = own.filter((r) => !r.failed);
  const failed = own.filter((r) => r.failed);

  const totalUnsupported = ok.reduce((sum, r) => sum + r.unsupportedClaimCount, 0);
  const totalClaims = ok.reduce((sum, r) => sum + r.totalClaimCount, 0);

  const conflictApplicable = ok.filter((r) => r.expectedConflict !== null);
  const conflictCorrect = conflictApplicable.filter((r) => r.conflictSurfaced === r.expectedConflict);

  return {
    condition,
    n: own.length,
    medianLatencyMs: median(ok.map((r) => r.latencyMs)),
    p95LatencyMs: percentile(ok.map((r) => r.latencyMs), 0.95),
    totalCostUsd: ok.reduce((sum, r) => sum + r.costUsd, 0),
    avgLlmCalls: mean(ok.map((r) => r.llmCalls)),
    avgEmbeddingCalls: mean(ok.map((r) => r.embeddingCalls)),
    avgToolCalls: mean(ok.map((r) => r.toolCalls)),
    evidenceCompletenessRate: rate(ok.filter(coversExpectedSpecialists).length, ok.length),
    unsupportedClaimRate: rate(totalUnsupported, totalClaims),
    citationCorrectRate: rate(ok.filter((r) => r.citationsCorrect).length, ok.length),
    avgCompleteness: mean(ok.map((r) => r.completeness)),
    conflictDetectionAccuracy: conflictApplicable.length > 0 ? rate(conflictCorrect.length, conflictApplicable.length) : null,
    failedTaskRate: rate(failed.length, own.length),
  };
}
