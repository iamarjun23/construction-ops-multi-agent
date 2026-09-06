export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean };

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
}

export type ToolChoice = { type: 'auto' } | { type: 'tool'; name: string };

export interface ToolUseResult {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface GenerateInput {
  system?: string;
  messages: LLMMessage[];
  maxTokens?: number;
  tools?: ToolDefinition[];
  toolChoice?: ToolChoice;
}

export interface GenerateResult {
  text?: string;
  toolUses: ToolUseResult[];
}

export interface LLMProvider {
  generate(input: GenerateInput): Promise<GenerateResult>;
}
