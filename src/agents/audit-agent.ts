import { getLLMProvider } from '../llm/index.js';
import type { ToolDefinition } from '../llm/provider.js';
import type { Evidence } from '../tools/types.js';

export type SpecialistName = 'payment-agent' | 'contract-agent' | 'progress-agent';

export interface ClaimVerification {
  claim: string;
  supported: boolean;
  contradiction?: string;
}

export interface SuggestedRetrieval {
  agent: SpecialistName;
  instruction: string;
}

export interface AuditResult {
  claims: ClaimVerification[];
  unsupportedClaims: ClaimVerification[];
  suggestedRetrieval?: SuggestedRetrieval;
}

const AUDIT_TOOL: ToolDefinition = {
  name: 'audit_report',
  description: 'Report the verification result for every factual claim extracted from the draft answer.',
  inputSchema: {
    type: 'object',
    properties: {
      claims: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            claim: { type: 'string', description: 'The factual claim as stated in the draft' },
            supported: { type: 'boolean' },
            contradiction: { type: 'string', description: 'Set only if evidence directly contradicts the claim' },
          },
          required: ['claim', 'supported'],
        },
      },
      suggestedRetrieval: {
        type: 'object',
        description: 'At most one targeted retrieval that could resolve an unsupported claim, if any.',
        properties: {
          agent: { type: 'string', enum: ['payment-agent', 'contract-agent', 'progress-agent'] },
          instruction: { type: 'string' },
        },
      },
    },
    required: ['claims'],
  },
};

const SYSTEM_PROMPT =
  'You are the Audit Agent for a construction operations assistant. Extract every discrete factual ' +
  'claim from the draft answer and check each one strictly against the evidence provided. A claim is ' +
  'supported only if the evidence actually states it. Never introduce your own interpretation, never ' +
  "add a new claim, and never rely on what seems plausible — verification only. If exactly one issue " +
  'could plausibly be resolved by one additional targeted retrieval from a specialist agent, propose ' +
  'it as suggestedRetrieval; otherwise omit it. Always call audit_report.';

// SPEC.md §4: Audit extracts claims from the draft, checks each against
// retrieved evidence, flags unsupported/contradictory claims, and requests
// at most one targeted retrieval retry. It never adds new interpretation.
export async function runAuditAgent(draftAnswer: string, evidence: Evidence[]): Promise<AuditResult> {
  const llm = getLLMProvider();
  const evidenceBlock = evidence
    .map((e, i) => `[${i + 1}] (${e.sourceType} ${e.sourceId}) ${e.content}`)
    .join('\n');

  const { toolUses } = await llm.generate({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `Draft answer:\n${draftAnswer}\n\nEvidence:\n${evidenceBlock}` }],
    tools: [AUDIT_TOOL],
    toolChoice: { type: 'tool', name: AUDIT_TOOL.name },
    maxTokens: 1500,
  });

  const call = toolUses[0];
  const parsed = call?.input as { claims?: ClaimVerification[]; suggestedRetrieval?: SuggestedRetrieval } | undefined;
  const claims = parsed?.claims ?? [];

  return {
    claims,
    unsupportedClaims: claims.filter((c) => !c.supported),
    suggestedRetrieval: parsed?.suggestedRetrieval,
  };
}
