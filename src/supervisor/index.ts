import { getLLMProvider } from '../llm/index.js';
import type { ToolDefinition } from '../llm/provider.js';
import { runContractAgent } from '../agents/contract-agent.js';
import { runPaymentAgent } from '../agents/payment-agent.js';
import { runProgressAgent } from '../agents/progress-agent.js';
import type { AgentResult } from '../agents/types.js';
import type { AccessContext, Evidence } from '../tools/types.js';

export interface TraceEvent {
  agent: string;
  message: string;
}

export interface SupervisorResult {
  answer: string;
  evidence: Evidence[];
  trace: TraceEvent[];
}

type SpecialistName = 'payment-agent' | 'contract-agent' | 'progress-agent';

interface PlanTask {
  agent: SpecialistName;
  instruction: string;
}

const PLAN_TOOL: ToolDefinition = {
  name: 'create_plan',
  description: 'Split the user question into one task per specialist agent needed to answer it fully.',
  inputSchema: {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            agent: { type: 'string', enum: ['payment-agent', 'contract-agent', 'progress-agent'] },
            instruction: { type: 'string', description: 'A focused natural-language instruction for that agent' },
          },
          required: ['agent', 'instruction'],
        },
      },
    },
    required: ['tasks'],
  },
};

const PLANNER_SYSTEM_PROMPT =
  'You are the Supervisor for a construction operations assistant. Split the user question into the ' +
  'minimum set of tasks needed to answer it fully: payment-agent for exact amount/status facts, ' +
  'contract-agent for what a contract or policy permits, progress-agent for what site records show. ' +
  'A compound question (e.g. asking about payment AND a contract condition) needs one task per ' +
  'relevant agent. Always call create_plan.';

const FINAL_SYSTEM_PROMPT =
  'You are the Supervisor for a construction operations assistant, producing the final answer for the ' +
  'user from evidence collected by specialist agents (payment records, contract clauses, progress ' +
  'logs). Distinguish clearly what the payment database says, what the contract permits, what the ' +
  'progress records show, and what remains uncertain. Cite evidence. Never state that withholding ' +
  'payment or any other action "is legally valid" — only report what the contract states. If evidence ' +
  'is missing or conflicting, say so rather than guessing.';

const AGENT_RUNNERS: Record<SpecialistName, (instruction: string, ctx: AccessContext) => Promise<AgentResult>> = {
  'payment-agent': runPaymentAgent,
  'contract-agent': runContractAgent,
  'progress-agent': runProgressAgent,
};

// SPEC.md §4: Supervisor splits compound questions into tasks, delegates to
// specialists, merges findings, and produces the final cited answer. Audit
// (verifying the draft against evidence, one bounded retry) is Phase 3 —
// not wired in yet.
export async function answerQuestion(question: string, ctx: AccessContext): Promise<SupervisorResult> {
  const llm = getLLMProvider();
  const trace: TraceEvent[] = [];

  const { toolUses } = await llm.generate({
    system: PLANNER_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: question }],
    tools: [PLAN_TOOL],
    toolChoice: { type: 'tool', name: PLAN_TOOL.name },
    maxTokens: 1024,
  });

  const planCall = toolUses[0];
  const tasks: PlanTask[] = (planCall?.input as { tasks?: PlanTask[] } | undefined)?.tasks ?? [];
  trace.push({ agent: 'supervisor', message: `question split into ${tasks.length} task(s)` });

  const results: AgentResult[] = [];
  for (const task of tasks) {
    const runner = AGENT_RUNNERS[task.agent];
    if (!runner) continue;
    const result = await runner(task.instruction, ctx);
    results.push(result);
    trace.push({ agent: task.agent, message: result.summary.slice(0, 160) });
  }

  trace.push({ agent: 'supervisor', message: `evidence collected from ${results.length} source(s)` });

  const evidenceBlock = results.map((r, i) => `[${r.agent} — task ${i + 1}]\n${r.summary}`).join('\n\n---\n\n');

  const { text } = await llm.generate({
    system: FINAL_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Original question: ${question}\n\nEvidence collected by specialist agents:\n\n${evidenceBlock}`,
      },
    ],
    maxTokens: 1500,
  });

  trace.push({ agent: 'done', message: 'answer finalized' });

  return {
    answer: text ?? '(no answer generated)',
    evidence: results.flatMap((r) => r.evidence),
    trace,
  };
}
