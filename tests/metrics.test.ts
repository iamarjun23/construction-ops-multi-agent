import { describe, expect, it } from 'vitest';
import { median, percentile, rate, summarizeCondition, type ConditionRunResult } from '../eval/metrics.js';

// Pure-math unit tests using synthetic numeric fixtures — these are NOT
// real evaluation results (no placeholder product metrics are asserted
// anywhere in this repo); they only prove the aggregation logic itself is
// correct, so a real eval:run against live API keys can be trusted.

describe('median / percentile', () => {
  it('computes the median of an odd-length list', () => {
    expect(median([1, 3, 2])).toBe(2);
  });

  it('computes the median of an even-length list (lower-of-pair, matching our nearest-rank method)', () => {
    expect(median([1, 2, 3, 4])).toBe(2);
  });

  it('computes p95 correctly on a larger sample', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(percentile(values, 0.95)).toBe(95);
  });

  it('returns 0 for an empty list rather than NaN', () => {
    expect(median([])).toBe(0);
    expect(percentile([], 0.95)).toBe(0);
  });
});

describe('rate', () => {
  it('computes a simple rate', () => {
    expect(rate(3, 12)).toBeCloseTo(0.25);
  });

  it('returns 0 rather than NaN when total is 0', () => {
    expect(rate(0, 0)).toBe(0);
  });
});

function fixture(overrides: Partial<ConditionRunResult>): ConditionRunResult {
  return {
    questionId: 'q1',
    condition: 'multi_agent',
    latencyMs: 1000,
    llmCalls: 3,
    embeddingCalls: 1,
    costUsd: 0.01,
    toolCalls: 3,
    evidenceSourceTypes: ['payment', 'contract', 'progress'],
    expectedSpecialists: ['payment', 'contract', 'progress'],
    unsupportedClaimCount: 0,
    totalClaimCount: 4,
    completeness: 1,
    citationsCorrect: true,
    expectedConflict: null,
    conflictSurfaced: null,
    failed: false,
    ...overrides,
  };
}

describe('summarizeCondition', () => {
  it('aggregates latency, cost, and rates across a set of synthetic results', () => {
    const results: ConditionRunResult[] = [
      fixture({ latencyMs: 1000, costUsd: 0.01 }),
      fixture({ latencyMs: 2000, costUsd: 0.02 }),
      fixture({ latencyMs: 3000, costUsd: 0.03, unsupportedClaimCount: 1, totalClaimCount: 4 }),
    ];

    const summary = summarizeCondition('multi_agent', results);
    expect(summary.n).toBe(3);
    expect(summary.medianLatencyMs).toBe(2000);
    expect(summary.totalCostUsd).toBeCloseTo(0.06);
    expect(summary.unsupportedClaimRate).toBeCloseTo(1 / 12); // 1 unsupported out of 3*4 total claims
  });

  it('excludes failed runs from latency/cost/rate stats but counts them in failedTaskRate', () => {
    const results: ConditionRunResult[] = [
      fixture({ latencyMs: 1000 }),
      fixture({ failed: true, latencyMs: 999999, errorMessage: 'timeout' }),
    ];

    const summary = summarizeCondition('multi_agent', results);
    expect(summary.n).toBe(2);
    expect(summary.failedTaskRate).toBeCloseTo(0.5);
    expect(summary.medianLatencyMs).toBe(1000); // the failed run's bogus latency must not pollute this
  });

  it('flags evidence-completeness failures when a question needed a specialist that was never consulted', () => {
    const results: ConditionRunResult[] = [
      fixture({ evidenceSourceTypes: ['payment'], expectedSpecialists: ['payment', 'contract'] }),
    ];
    expect(summarizeCondition('multi_agent', results).evidenceCompletenessRate).toBe(0);
  });

  it('computes conflict-detection accuracy only over questions where a conflict was applicable', () => {
    const results: ConditionRunResult[] = [
      fixture({ expectedConflict: true, conflictSurfaced: true }), // correct
      fixture({ expectedConflict: true, conflictSurfaced: false }), // incorrect
      fixture({ expectedConflict: null, conflictSurfaced: null }), // not applicable — excluded
    ];
    expect(summarizeCondition('multi_agent', results).conflictDetectionAccuracy).toBeCloseTo(0.5);
  });

  it('returns null conflict-detection accuracy when no question in the set had an applicable conflict', () => {
    const results: ConditionRunResult[] = [fixture({ expectedConflict: null })];
    expect(summarizeCondition('multi_agent', results).conflictDetectionAccuracy).toBeNull();
  });

  it('only summarizes results for the requested condition', () => {
    const results: ConditionRunResult[] = [
      fixture({ condition: 'multi_agent', latencyMs: 1000 }),
      fixture({ condition: 'plain_rag', latencyMs: 5000 }),
    ];
    expect(summarizeCondition('multi_agent', results).n).toBe(1);
    expect(summarizeCondition('multi_agent', results).medianLatencyMs).toBe(1000);
  });
});
