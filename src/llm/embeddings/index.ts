import { config } from '../../config.js';
import type { EmbeddingProvider } from '../embeddings.js';
import { OpenAIEmbeddingProvider } from './openai.js';

export function getEmbeddingProvider(): EmbeddingProvider {
  switch (config.embeddingProvider) {
    case 'openai':
      return new OpenAIEmbeddingProvider();
    default:
      throw new Error(`Unknown EMBEDDING_PROVIDER: ${config.embeddingProvider}`);
  }
}

export type { EmbeddingProvider } from '../embeddings.js';
