export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface GenerateInput {
  system?: string;
  messages: LLMMessage[];
  maxTokens?: number;
}

export interface LLMProvider {
  generate(input: GenerateInput): Promise<string>;
}
