import { config } from '../../config.js';
import type { EmbeddingProvider } from '../embeddings.js';
import { OpenAIEmbeddingProvider } from './openai.js';
import { OllamaEmbeddingProvider } from './ollama.js';

export function getEmbeddingProvider(): EmbeddingProvider {
  switch (config.embeddingProvider) {
    case 'openai':
      return new OpenAIEmbeddingProvider();
    case 'ollama':
      return new OllamaEmbeddingProvider();
    default:
      throw new Error(`Unknown EMBEDDING_PROVIDER: ${config.embeddingProvider}`);
  }
}

export type { EmbeddingProvider } from '../embeddings.js';
