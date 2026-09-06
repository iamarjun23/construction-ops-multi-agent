import { config } from '../config.js';
import type { LLMProvider } from './provider.js';
import { ClaudeProvider } from './providers/claude.js';

export function getLLMProvider(): LLMProvider {
  switch (config.llmProvider) {
    case 'claude':
      return new ClaudeProvider();
    default:
      throw new Error(`Unknown LLM_PROVIDER: ${config.llmProvider}`);
  }
}

export type { LLMProvider, LLMMessage, GenerateInput } from './provider.js';
