import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool } from '../src/db/pool.js';
import { runPlainRag } from '../src/rag/plain-rag.js';
import { runSingleAgentBaseline } from '../src/rag/single-agent-baseline.js';
import { answerQuestion } from '../src/supervisor/index.js';
import { loadAccessContext } from '../src/tools/access.js';
import type { AccessContext, Evidence } from '../src/tools/types.js';
import { diffUsage, estimateCostUsd, resetUsage, snapshotUsage } from '../src/llm/usage.js';
import { gradeAnswer } from './judge.js';
import { summarizeCondition, type ConditionName, type ConditionRunResult, type ConditionSummary } from './metrics.js';
import type { EvalQuestion } from './types.js';

// SPEC.md §12 Phase 5: one command runs plain-RAG / single-agent / multi-
// agent against the eval set and produces real, non-placeholder metrics.
// Requires ANTHROPIC_API_KEY and OPENAI_API_KEY — every condition and the
// grading step make live LLM calls.

const EVAL_USER_NAME = 'Dana Whitfield'; // full-access admin; access control has its own suite (tests/access-control.test.ts)
const CONDITIONS: ConditionName[] = ['plain_rag', 'single_agent', 'multi_agent'];
const SPECIALIST_AGENT_NAMES = new Set(['payment-agent', 'contract-agent', 'progress-agent']);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runOne(condition: ConditionName, question: EvalQuestion, projectId: string, ctx: AccessContext): Promise<ConditionRunResult> {
  const usageBefore = snapshotUsage();
  const start = Date.now();

  try {
    let answer: string;
    let evidence: Evidence[];
    let toolCalls: number;

    if (condition === 'plain_rag') {
      const result = await runPlainRag(question.question, projectId);
      answer = result.answer;
      evidence = result.retrievedChunks.map((c) => ({
        sourceId: c.id,
        sourceType: 'chunk' as const,
        specialist: 'contract' as const,
        content: c.content,
      }));
      toolCalls = 1; // one vector search, by design (SPEC.md §6 condition 1)
    } else if (condition === 'single_agent') {
      const result = await runSingleAgentBaseline(question.question, ctx);
      answer = result.answer;
      evidence = result.evidence;
      toolCalls = result.toolCallCount;
    } else {
      const result = await answerQuestion(question.question, ctx);
      answer = result.answer;
      evidence = result.evidence;
      toolCalls = result.trace.filter((s) => SPECIALIST_AGENT_NAMES.has(s.agent)).length;
    }

    const latencyMs = Date.now() - start;
    const usage = diffUsage(usageBefore, snapshotUsage());
    const judged = await gradeAnswer(question, answer, evidence);

    return {
      questionId: question.id,
      condition,
      latencyMs,
      llmCalls: usage.llmCalls,
      embeddingCalls: usage.embeddingCalls,
      costUsd: estimateCostUsd(usage),
      toolCalls,
      evidenceSourceTypes: [...new Set(evidence.map((e) => e.specialist))],
      expectedSpecialists: question.expectedSpecialists,
      unsupportedClaimCount: judged.unsupportedClaimCount,
      totalClaimCount: judged.totalClaimCount,
      completeness: judged.completeness,
      citationsCorrect: judged.citationsCorrect,
      expectedConflict: question.expectedConflict ?? null,
      conflictSurfaced: judged.conflictSurfaced,
      failed: false,
    };
  } catch (err) {
    return {
      questionId: question.id,
      condition,
      latencyMs: Date.now() - start,
      llmCalls: 0,
      embeddingCalls: 0,
      costUsd: 0,
      toolCalls: 0,
      evidenceSourceTypes: [],
      expectedSpecialists: question.expectedSpecialists,
      unsupportedClaimCount: 0,
      totalClaimCount: 0,
      completeness: 0,
      citationsCorrect: false,
      expectedConflict: question.expectedConflict ?? null,
      conflictSurfaced: null,
      failed: true,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

function conditionLabel(condition: ConditionName): string {
  return { plain_rag: 'Plain RAG', single_agent: 'Single-agent', multi_agent: 'Multi-agent' }[condition];
}

function formatRow(s: ConditionSummary): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  return (
    `| ${conditionLabel(s.condition)} | ${s.n} | ${s.medianLatencyMs.toFixed(0)} | ${s.p95LatencyMs.toFixed(0)} | ` +
    `$${s.totalCostUsd.toFixed(4)} | ${s.avgLlmCalls.toFixed(1)} | ${s.avgToolCalls.toFixed(1)} | ` +
    `${pct(s.evidenceCompletenessRate)} | ${pct(s.unsupportedClaimRate)} | ${pct(s.citationCorrectRate)} | ` +
    `${s.avgCompleteness.toFixed(2)} | ${s.conflictDetectionAccuracy !== null ? pct(s.conflictDetectionAccuracy) : 'n/a'} | ` +
    `${pct(s.failedTaskRate)} |`
  );
}

function writeReport(summaries: ConditionSummary[], questionCount: number, timestamp: string, resultsFile: string) {
  const content = `# Evaluation Report

Generated ${timestamp} — ${questionCount} questions × 3 conditions (raw per-run data: \`eval/results/${resultsFile}\`).

This dataset is synthetic (see README.md's data-honesty note); these are real measurements from running the code in this repository against it, not projections.

| Condition | n | Median latency (ms) | p95 latency (ms) | Total cost | Avg LLM calls | Avg tool calls | Evidence-completeness | Unsupported-claim rate | Citation-correct rate | Avg completeness (0-1) | Conflict-detection accuracy | Failed-task rate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
${summaries.map(formatRow).join('\n')}

## Metric definitions

- **Evidence-completeness** — did the evidence actually touch every specialist domain (payment/contract/progress) the question required?
- **Unsupported-claim rate** — fraction of extracted factual claims the Audit Agent (used here as an external judge, applied uniformly to all three conditions) flags as unsupported or contradicted by the evidence.
- **Citation-correct rate** — LLM-judge verdict on whether cited facts are actually backed by the evidence shown.
- **Conflict-detection accuracy** — among compound questions with a genuine payment/contract/progress tension (see \`expectedConflict\` in \`eval/questions.json\`), the rate at which the answer explicitly surfaces it.
- **Failed-task rate** — fraction of runs that threw before producing an answer at all.

## Reading this honestly

SPEC.md §6 asks for an honest three-way comparison, not a foregone conclusion: if multi-agent doesn't win on every metric, that is a legitimate, reportable finding, not a bug in the harness.
`;

  const reportPath = path.join(__dirname, 'report.md');
  writeFileSync(reportPath, content);
  console.log(`\nWrote ${reportPath}`);
}

async function main() {
  const limitArg = process.argv[2] ? Number(process.argv[2]) : undefined;

  const questionsPath = path.join(__dirname, 'questions.json');
  const { questions } = JSON.parse(readFileSync(questionsPath, 'utf8')) as { questions: EvalQuestion[] };
  const selected = limitArg ? questions.slice(0, limitArg) : questions;

  const { rows: userRows } = await pool.query<{ id: string }>(`SELECT id FROM users WHERE name = $1`, [EVAL_USER_NAME]);
  const { rows: projectRows } = await pool.query<{ id: string; name: string }>(`SELECT id, name FROM projects`);
  const projectIdByName = new Map(projectRows.map((p) => [p.name, p.id]));

  const results: ConditionRunResult[] = [];

  for (const [i, question] of selected.entries()) {
    const projectId = projectIdByName.get(question.project);
    if (!projectId) {
      console.error(`Unknown project for question ${question.id}: ${question.project}`);
      continue;
    }
    const ctx = await loadAccessContext(userRows[0].id, projectId);

    for (const condition of CONDITIONS) {
      resetUsage();
      const result = await runOne(condition, question, projectId, ctx);
      results.push(result);
      console.log(
        `[${i + 1}/${selected.length}] ${question.id} · ${condition} · ` +
          (result.failed ? `FAILED: ${result.errorMessage}` : `${result.latencyMs}ms, $${result.costUsd.toFixed(4)}`),
      );
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const resultsDir = path.join(__dirname, 'results');
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });
  const resultsFile = `${timestamp}.json`;
  writeFileSync(path.join(resultsDir, resultsFile), JSON.stringify(results, null, 2));

  const summaries = CONDITIONS.map((c) => summarizeCondition(c, results));
  writeReport(summaries, selected.length, timestamp, resultsFile);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
