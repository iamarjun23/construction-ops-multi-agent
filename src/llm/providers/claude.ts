import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config.js';
import type { GenerateInput, LLMProvider } from '../provider.js';

export class ClaudeProvider implements LLMProvider {
  private client: Anthropic;
  private model: string;

  constructor() {
    this.client = new Anthropic({ apiKey: config.anthropicApiKey });
    this.model = config.claudeModel;
  }

  async generate({ system, messages, maxTokens = 1024 }: GenerateInput): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('Claude response contained no text block');
    }
    return textBlock.text;
  }
}
