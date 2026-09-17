import { pathToFileURL } from 'node:url';
import { pool } from '../db/pool.js';
import { getLLMProvider } from '../llm/index.js';
import type { LLMMessage, ToolDefinition, ToolUseResult } from '../llm/provider.js';
import { loadAccessContext } from '../tools/access.js';
import { paymentLookup } from '../tools/payment-lookup.js';
import { progressLookup } from '../tools/progress-lookup.js';
import { vectorSearch } from '../tools/vector-search.js';
import type { AccessContext, Evidence, PaymentLookupInput, ProgressLookupInput, VectorSearchInput } from '../tools/types.js';

const TOOLS: ToolDefinition[] = [
  {
    name: 'payment_lookup',
    description: 'Look up exact milestone/payment facts: amount due, status, total paid, amount owed.',
    inputSchema: {
      type: 'object',
      properties: {
        intent: { type: 'string', enum: ['payment_status', 'milestone_status'] },
        zoneLabel: { type: 'string' },
        milestoneName: { type: 'string' },
      },
      required: ['intent'],
    },
  },
  {
    name: 'vector_search',
    description: "Semantic search over the project's contract and policy documents.",
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        documentType: { type: 'string', enum: ['contract', 'policy'] },
      },
      required: ['query'],
    },
  },
  {
    name: 'progress_lookup',
    description: 'Search site progress logs, including whether inspection photos have been submitted.',
    inputSchema: {
      type: 'object',
      properties: { zoneLabel: { type: 'string' }, milestoneName: { type: 'string' } },
    },
  },
];

const SYSTEM_PROMPT =
  'You are a construction operations assistant with three tools: payment_lookup (exact payment/' +
  'milestone facts), vector_search (contract/policy clauses), and progress_lookup (site progress logs ' +
  'and inspection-photo status). Call as many tools as needed, across multiple turns, to gather enough ' +
  'evidence before answering. Distinguish what the payment database says, what the contract permits, ' +
  'and what progress records show. Never state that an action "is legally valid" — only report what ' +
  'the contract states. Cite evidence. If you cannot find enough evidence, say what is missing.';

const MAX_TURNS = 6;

export interface SingleAgentResult {
  answer: string;
  evidence: Evidence[];
  toolCallCount: number;
}

// Eval condition 2 (SPEC.md §6): one agent, all three tools, no supervisor/
// audit split. This is the number the multi-agent system has to beat.
export async function runSingleAgentBaseline(question: string, ctx: AccessContext): Promise<SingleAgentResult> {
  const llm = getLLMProvider();
  const messages: LLMMessage[] = [{ role: 'user', content: question }];
  const evidence: Evidence[] = [];
  let toolCallCount = 0;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const result = await llm.generate({
      system: SYSTEM_PROMPT,
      messages,
      tools: TOOLS,
      toolChoice: { type: 'auto' },
      maxTokens: 1500,
    });

    if (result.toolUses.length === 0) {
      return { answer: result.text ?? '(no answer generated)', evidence, toolCallCount };
    }

    messages.push({
      role: 'assistant',
      content: [
        ...(result.text ? [{ type: 'text' as const, text: result.text }] : []),
        ...result.toolUses.map((call) => ({
          type: 'tool_use' as const,
          id: call.id,
          name: call.toolName,
          input: call.input,
        })),
      ],
    });

    const toolResultParts = [];
    for (const call of result.toolUses) {
      toolCallCount++;
      const { summary, newEvidence } = await executeTool(call, ctx);
      evidence.push(...newEvidence);
      toolResultParts.push({ type: 'tool_result' as const, toolUseId: call.id, content: summary });
    }
    messages.push({ role: 'user', content: toolResultParts });
  }

  return { answer: '(reached max tool-call turns without a final answer)', evidence, toolCallCount };
}

async function executeTool(
  call: ToolUseResult,
  ctx: AccessContext,
): Promise<{ summary: string; newEvidence: Evidence[] }> {
  switch (call.toolName) {
    case 'payment_lookup': {
      const output = await paymentLookup(
        { ...(call.input as unknown as PaymentLookupInput), projectId: ctx.projectId },
        ctx,
      );
      const summary =
        output.rows
          .map((r) => `${r.zoneLabel} ${r.milestoneName}: ${r.status}, owed $${r.amountOwed.toFixed(2)}`)
          .join('; ') || 'No matching milestone/payment records found.';
      return { summary, newEvidence: output.evidence };
    }
    case 'vector_search': {
      const output = await vectorSearch(
        { ...(call.input as unknown as VectorSearchInput), projectId: ctx.projectId },
        ctx,
      );
      const summary =
        output.chunks.map((c) => `(${c.documentTitle}, p.${c.pageNumber}) ${c.content}`).join('\n\n---\n\n') ||
        'No relevant contract or policy clauses found.';
      return { summary, newEvidence: output.evidence };
    }
    case 'progress_lookup': {
      const output = await progressLookup(
        { ...(call.input as unknown as ProgressLookupInput), projectId: ctx.projectId },
        ctx,
      );
      const summary =
        output.rows
          .map((r) => `${r.zoneLabel} (${r.entryDate}): ${r.note} [photos: ${r.hasInspectionPhotos ? 'yes' : 'no'}]`)
          .join('\n') || 'No matching progress-log records found.';
      return { summary, newEvidence: output.evidence };
    }
    default:
      return { summary: `Unknown tool: ${call.toolName}`, newEvidence: [] };
  }
}

async function main() {
  const question = process.argv[2];
  if (!question) {
    console.error('Usage: npm run agents:single -- "your question" ["User Name"] ["Project Name"]');
    process.exit(1);
  }
  const userName = process.argv[3] ?? 'Dana Whitfield';
  const projectName = process.argv[4] ?? 'Riverside Tower';

  const { rows: userRows } = await pool.query<{ id: string }>(`SELECT id FROM users WHERE name = $1`, [userName]);
  const { rows: projectRows } = await pool.query<{ id: string }>(`SELECT id FROM projects WHERE name = $1`, [
    projectName,
  ]);
  if (userRows.length === 0) {
    console.error(`User not found: ${userName}`);
    process.exit(1);
  }
  if (projectRows.length === 0) {
    console.error(`Project not found: ${projectName}`);
    process.exit(1);
  }

  const ctx = await loadAccessContext(userRows[0].id, projectRows[0].id);
  const result = await runSingleAgentBaseline(question, ctx);

  console.log(`\n=== Single-Agent Baseline (${result.toolCallCount} tool calls) ===\n`);
  console.log(result.answer);
  console.log('\n=== Evidence ===');
  for (const e of result.evidence) console.log(`- (${e.sourceType} ${e.sourceId}) ${e.content.slice(0, 120)}`);

  await pool.end();
}

// See plain-rag.ts: this comparison needs pathToFileURL() to work on Windows.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
