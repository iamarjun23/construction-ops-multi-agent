import 'dotenv/config';

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  databaseUrl: required('DATABASE_URL', process.env.DATABASE_URL),
  llmProvider: process.env.LLM_PROVIDER ?? 'claude',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  claudeModel: process.env.CLAUDE_MODEL ?? 'claude-sonnet-5',
  embeddingProvider: process.env.EMBEDDING_PROVIDER ?? 'openai',
  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  openaiEmbeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small',
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
  ollamaApiKey: process.env.OLLAMA_API_KEY ?? '',
  ollamaModel: process.env.OLLAMA_MODEL ?? 'llama3.1:8b',
  ollamaEmbeddingModel: process.env.OLLAMA_EMBEDDING_MODEL ?? 'mxbai-embed-large',
};
