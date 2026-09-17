import { getLLMProvider } from '../llm/index.js';
import type { ToolDefinition } from '../llm/provider.js';
import { progressLookup } from '../tools/progress-lookup.js';
import type { AccessContext, ProgressLookupInput } from '../tools/types.js';
import type { AgentResult } from './types.js';

const TOOL: ToolDefinition = {
  name: 'progress_lookup',
  description:
    'Search site progress logs, including whether inspection photos have been submitted for a ' +
    'zone/milestone. Reports missing or conflicting records rather than assuming evidence exists.',
  inputSchema: {
    type: 'object',
    properties: {
      zoneLabel: { type: 'string', description: 'e.g. "Zone 3"' },
      milestoneName: { type: 'string', description: 'e.g. "Drywall"' },
    },
  },
};

const SYSTEM_PROMPT =
  'You are the Progress Agent. Your only job is to extract the zoneLabel and milestoneName (if ' +
  'mentioned) from the instruction and call progress_lookup. Never assume inspection evidence exists ' +
  'because it is plausible — only report what the logs actually show.';

// SPEC.md §4: searches progress logs / inspection-photo metadata; reports
// missing or conflicting records rather than assuming evidence exists.
export async function runProgressAgent(instruction: string, ctx: AccessContext): Promise<AgentResult> {
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
    return { agent: 'progress-agent', summary: 'No progress-log search could be formulated for this question.', evidence: [] };
  }

  const input = call.input as unknown as ProgressLookupInput;
  const output = await progressLookup({ ...input, projectId: ctx.projectId }, ctx);

  const summary =
    output.rows.length === 0
      ? "No matching progress-log records were found (or are outside the caller's access)."
      : output.rows
          .map(
            (r) =>
              `${r.zoneLabel}${r.milestoneName ? ' ' + r.milestoneName : ''} (${r.entryDate}): ${r.note} ` +
              `[inspection photos: ${r.hasInspectionPhotos ? 'yes' : 'no'}]`,
          )
          .join('\n');

  return { agent: 'progress-agent', summary, evidence: output.evidence };
}
