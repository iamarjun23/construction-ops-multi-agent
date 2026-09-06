import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config.js';
import type { GenerateInput, GenerateResult, LLMProvider } from '../provider.js';

export class ClaudeProvider implements LLMProvider {
  private client: Anthropic;
  private model: string;

  constructor() {
    this.client = new Anthropic({ apiKey: config.anthropicApiKey });
    this.model = config.claudeModel;
  }

  async generate({ system, messages, maxTokens = 1024, tools, toolChoice }: GenerateInput): Promise<GenerateResult> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      system,
      messages: messages.map((m) => ({
        role: m.role,
        content:
          typeof m.content === 'string'
            ? m.content
            : m.content.map((part) => {
                if (part.type === 'text') return { type: 'text' as const, text: part.text };
                if (part.type === 'tool_use') {
                  return { type: 'tool_use' as const, id: part.id, name: part.name, input: part.input };
                }
                return {
                  type: 'tool_result' as const,
                  tool_use_id: part.toolUseId,
                  content: part.content,
                  is_error: part.isError,
                };
              }),
      })),
      tools: tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
      })),
      tool_choice: toolChoice
        ? toolChoice.type === 'auto'
          ? { type: 'auto' }
          : { type: 'tool', name: toolChoice.name }
        : undefined,
    });

    const result: GenerateResult = { toolUses: [] };
    for (const block of response.content) {
      if (block.type === 'text') {
        result.text = (result.text ?? '') + block.text;
      } else if (block.type === 'tool_use') {
        result.toolUses.push({
          id: block.id,
          toolName: block.name,
          input: block.input as Record<string, unknown>,
        });
      }
    }
    return result;
  }
}
