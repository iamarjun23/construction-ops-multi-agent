import { runAuditAgent } from '../src/agents/audit-agent.js';
import { getLLMProvider } from '../src/llm/index.js';
import type { ToolDefinition } from '../src/llm/provider.js';
import type { Evidence } from '../src/tools/types.js';
import type { EvalQuestion } from './types.js';

export interface JudgeResult {
  unsupportedClaimCount: number;
  totalClaimCount: number;
  completeness: number;
  citationsCorrect: boolean;
  conflictSurfaced: boolean | null;
}

const GRADE_TOOL: ToolDefinition = {
  name: 'grade_answer',
  description: 'Grade an answer against the question intent and expected evidence sources.',
  inputSchema: {
    type: 'object',
    properties: {
      completeness: {
        type: 'number',
        description: '0 to 1: how completely the answer addresses the question given the expected evidence sources',
      },
      citationsCorrect: {
        type: 'boolean',
        description: 'Whether the evidence actually supports the specific facts stated in the answer',
      },
      conflictSurfaced: {
        type: 'boolean',
        description: 'Whether the answer explicitly surfaces the tension/uncertainty named in the grading hints, if any',
      },
      notes: { type: 'string' },
    },
    required: ['completeness', 'citationsCorrect', 'conflictSurfaced'],
  },
};

const JUDGE_SYSTEM_PROMPT =
  "You are grading a construction-operations assistant's answer for an evaluation harness. You are " +
  'strict and skeptical: only credit facts the evidence actually supports. Grade completeness as how ' +
  'fully the answer addresses the question given what the expected evidence sources should cover — a ' +
  'complete answer distinguishes what the payment database says, what the contract permits, and what ' +
  'progress records show, and states what remains uncertain rather than guessing. Grade ' +
  'citationsCorrect as false if the answer states a specific fact (an amount, a date, a clause) that ' +
  'is not actually supported by the evidence provided. Grade conflictSurfaced based on whether the ' +
  'answer explicitly acknowledges the tension described in the grading hints, if any were given — set ' +
  'it to false if no such hints were given or the tension is not mentioned. Always call grade_answer.';

// Reuses the real Audit Agent (src/agents/audit-agent.ts) as an external
// judge for the unsupported-claim-rate metric, applied uniformly across
// all three eval conditions — not just the multi-agent one that happens to
// use it internally — so the metric is comparable across conditions.
export async function gradeAnswer(question: EvalQuestion, answer: string, evidence: Evidence[]): Promise<JudgeResult> {
  const llm = getLLMProvider();
  const evidenceBlock = evidence.map((e, i) => `[${i + 1}] (${e.sourceType} ${e.sourceId}) ${e.content}`).join('\n');
  const hints = question.hints?.length
    ? `\n\nGrading hints (facts/tensions a complete answer should reflect):\n${question.hints.join('\n')}`
    : '';

  const { toolUses } = await llm.generate({
    system: JUDGE_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content:
          `Question: ${question.question}\n` +
          `Expected evidence sources: ${question.expectedSpecialists.join(', ')}${hints}\n\n` +
          `Answer given:\n${answer}\n\nEvidence available to the system:\n${evidenceBlock}`,
      },
    ],
    tools: [GRADE_TOOL],
    toolChoice: { type: 'tool', name: GRADE_TOOL.name },
    maxTokens: 512,
  });

  const call = toolUses[0];
  const parsed = call?.input as
    | { completeness?: number; citationsCorrect?: boolean; conflictSurfaced?: boolean }
    | undefined;

  const audit = await runAuditAgent(answer, evidence);

  return {
    unsupportedClaimCount: audit.unsupportedClaims.length,
    totalClaimCount: audit.claims.length,
    completeness: parsed?.completeness ?? 0,
    citationsCorrect: parsed?.citationsCorrect ?? false,
    conflictSurfaced: question.expectedConflict !== undefined ? (parsed?.conflictSurfaced ?? false) : null,
  };
}
