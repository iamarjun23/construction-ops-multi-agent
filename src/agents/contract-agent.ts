import { getLLMProvider } from '../llm/index.js';
import type { ToolDefinition } from '../llm/provider.js';
import { vectorSearch } from '../tools/vector-search.js';
import type { AccessContext, VectorSearchInput } from '../tools/types.js';
import type { AgentResult } from './types.js';

const TOOL: ToolDefinition = {
  name: 'vector_search',
  description:
    "Semantic search over the project's contract and policy documents. Returns clause text plus " +
    'the document title and page number as evidence.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Focused search query describing the contract condition to find' },
      documentType: { type: 'string', enum: ['contract', 'policy'] },
    },
    required: ['query'],
  },
};

const SYSTEM_PROMPT =
  'You are the Contract Agent. Your only job is to formulate a focused search query from the ' +
  'instruction and call vector_search. Never summarize vaguely without a source chunk, and never ' +
  'state that an action "is legally valid" — only report what the contract states.';

// SPEC.md §4: pgvector search over contract chunks — returns clause + page
// number as evidence. Never summarizes without a source chunk.
export async function runContractAgent(instruction: string, ctx: AccessContext): Promise<AgentResult> {
  const llm = getLLMProvider();
  const { toolUses } = await llm.generate({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: instruction }],
    tools: [TOOL],
    toolChoice: { type: 'tool', name: TOOL.name },
    maxTokens: 512,
  });

  const call = toolUses[0];
  if (!call) {
    return { agent: 'contract-agent', summary: 'No contract search could be formulated for this question.', evidence: [] };
  }

  const input = call.input as unknown as VectorSearchInput;
  const output = await vectorSearch({ ...input, projectId: ctx.projectId }, ctx);

  const summary =
    output.chunks.length === 0
      ? 'No relevant contract or policy clauses were found.'
      : output.chunks.map((c) => `(${c.documentTitle}, p.${c.pageNumber}) ${c.content}`).join('\n\n---\n\n');

  return { agent: 'contract-agent', summary, evidence: output.evidence };
}
