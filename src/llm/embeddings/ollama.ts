import { config } from '../../config.js';
import { withRetry } from '../../lib/retry.js';
import { recordEmbeddingUsage } from '../usage.js';
import type { EmbeddingProvider } from '../embeddings.js';

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private baseUrl: string;
  private apiKey: string;
  private model: string;

  constructor() {
    this.baseUrl = config.ollamaBaseUrl;
    this.apiKey = config.ollamaApiKey;
    this.model = config.ollamaEmbeddingModel;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await withRetry(
      async () => {
        const res = await fetch(`${this.baseUrl}/api/embed`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
          },
          body: JSON.stringify({ model: this.model, input: texts }),
        });
        if (!res.ok) {
          const text = await res.text();
          const err = new Error(`Ollama embed request failed: ${res.status} ${text}`) as Error & { status?: number };
          err.status = res.status;
          throw err;
        }
        return res.json() as Promise<{ embeddings: number[][]; prompt_eval_count?: number }>;
      },
      { timeoutMs: 60_000, retries: 2 },
    );

    // Ollama's /api/embed doesn't report input token usage the way OpenAI
    // does; prompt_eval_count (when present) is the closest analog.
    recordEmbeddingUsage(response.prompt_eval_count ?? 0);
    return response.embeddings;
  }
}
