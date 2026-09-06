import OpenAI from 'openai';
import { config } from '../../config.js';
import { withRetry } from '../../lib/retry.js';
import type { EmbeddingProvider } from '../embeddings.js';

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private client: OpenAI;
  private model: string;

  constructor() {
    this.client = new OpenAI({ apiKey: config.openaiApiKey });
    this.model = config.openaiEmbeddingModel;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await withRetry(() => this.client.embeddings.create({ model: this.model, input: texts }), {
      timeoutMs: 30_000,
      retries: 2,
    });
    return response.data.map((d) => d.embedding);
  }
}
