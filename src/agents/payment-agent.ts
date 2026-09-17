import { getLLMProvider } from '../llm/index.js';
import type { ToolDefinition } from '../llm/provider.js';
import { paymentLookup } from '../tools/payment-lookup.js';
import type { AccessContext, PaymentLookupInput } from '../tools/types.js';
import type { AgentResult } from './types.js';

const TOOL: ToolDefinition = {
  name: 'payment_lookup',
  description:
    'Look up exact milestone/payment facts: amount due, status, total paid, and amount owed. ' +
    'Use for any question about whether a contractor has been paid or is owed money.',
  inputSchema: {
    type: 'object',
    properties: {
      intent: { type: 'string', enum: ['payment_status', 'milestone_status'] },
      zoneLabel: { type: 'string', description: 'e.g. "Zone 3"' },
      milestoneName: { type: 'string', description: 'e.g. "Drywall"' },
    },
    required: ['intent'],
  },
};

const SYSTEM_PROMPT =
  'You are the Payment Agent for a construction operations assistant. Your only job is to extract ' +
  'the zoneLabel and milestoneName (if mentioned) from the instruction and call payment_lookup. ' +
  'You never generate or accept raw SQL, and you never state an amount you did not get from the tool.';

// SPEC.md §4: typed payment/milestone lookup — exact amount, status, paid
// amount, due date. Never generates or accepts arbitrary SQL.
export async function runPaymentAgent(instruction: string, ctx: AccessContext): Promise<AgentResult> {
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
    return { agent: 'payment-agent', summary: 'No payment data could be located for this question.', evidence: [] };
  }

  const input = call.input as unknown as PaymentLookupInput;
  const output = await paymentLookup({ ...input, projectId: ctx.projectId }, ctx);

  const summary =
    output.rows.length === 0
      ? "No matching milestone/payment records were found (or are outside the caller's access)."
      : output.rows
          .map(
            (r) =>
              `${r.zoneLabel} ${r.milestoneName}: ${r.status}, $${r.amountDue.toFixed(2)} due, ` +
              `$${r.totalPaid.toFixed(2)} paid, $${r.amountOwed.toFixed(2)} owed`,
          )
          .join('; ');

  return { agent: 'payment-agent', summary, evidence: output.evidence };
}
