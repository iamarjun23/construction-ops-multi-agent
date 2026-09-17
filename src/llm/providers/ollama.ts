import { config } from '../../config.js';
import { withRetry } from '../../lib/retry.js';
import { recordLLMUsage } from '../usage.js';
import type { ContentPart, GenerateInput, GenerateResult, LLMMessage, LLMProvider } from '../provider.js';

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
}

// Ollama's tool-result convention: a 'tool' message per result, matched to
// the preceding assistant tool_calls by position — there's no tool_call_id
// concept like Anthropic/OpenAI, so order must be preserved.
function toOllamaMessages(system: string | undefined, messages: LLMMessage[]): OllamaMessage[] {
  const out: OllamaMessage[] = [];
  if (system) out.push({ role: 'system', content: system });

  for (const m of messages) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content });
      continue;
    }

    const textParts = m.content.filter((p): p is ContentPart & { type: 'text' } => p.type === 'text');
    const toolUseParts = m.content.filter((p): p is ContentPart & { type: 'tool_use' } => p.type === 'tool_use');
    const toolResultParts = m.content.filter(
      (p): p is ContentPart & { type: 'tool_result' } => p.type === 'tool_result',
    );

    if (toolUseParts.length > 0) {
      out.push({
        role: 'assistant',
        content: textParts.map((p) => p.text).join(''),
        tool_calls: toolUseParts.map((p) => ({ function: { name: p.name, arguments: p.input } })),
      });
    } else if (textParts.length > 0) {
      out.push({ role: m.role, content: textParts.map((p) => p.text).join('') });
    }

    for (const p of toolResultParts) {
      out.push({ role: 'tool', content: p.content });
    }
  }

  return out;
}

// llama3.1:8b (and other smaller tool-calling models) sometimes emit a
// nested array/object field of a tool call's arguments as a JSON-encoded
// string instead of a parsed structure — e.g. {"tasks": "[{...}, {...}]"}
// instead of {"tasks": [{...}, {...}]}. Recover the intended shape rather
// than let callers iterate over the string's characters.
function deepParseJsonStrings(value: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
      (trimmed.startsWith('{') && trimmed.endsWith('}'))
    ) {
      try {
        return deepParseJsonStrings(JSON.parse(trimmed));
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(deepParseJsonStrings);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deepParseJsonStrings(v)]));
  }
  return value;
}

export class OllamaProvider implements LLMProvider {
  private baseUrl: string;
  private apiKey: string;
  private model: string;

  constructor() {
    this.baseUrl = config.ollamaBaseUrl;
    this.apiKey = config.ollamaApiKey;
    this.model = config.ollamaModel;
  }

  async generate({ system, messages, tools, toolChoice }: GenerateInput): Promise<GenerateResult> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: toOllamaMessages(system, messages),
      stream: false,
    };

    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      }));
      // Ollama has no forced-single-tool choice like Anthropic's {type:"tool"} —
      // the closest approximation is restricting the tool list itself, which
      // callers of this provider already do (each specialist agent exposes
      // exactly one tool), so toolChoice.name is informational only here.
      void toolChoice;
    }

    const response = await withRetry(
      async () => {
        const res = await fetch(`${this.baseUrl}/api/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const text = await res.text();
          const err = new Error(`Ollama chat request failed: ${res.status} ${text}`) as Error & { status?: number };
          err.status = res.status;
          throw err;
        }
        return res.json() as Promise<{
          message: { content?: string; tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[] };
          prompt_eval_count?: number;
          eval_count?: number;
        }>;
      },
      { timeoutMs: 120_000, retries: 2 },
    );

    recordLLMUsage(response.prompt_eval_count ?? 0, response.eval_count ?? 0);

    const result: GenerateResult = { toolUses: [] };
    if (response.message.content) result.text = response.message.content;
    for (const call of response.message.tool_calls ?? []) {
      result.toolUses.push({
        id: crypto.randomUUID(),
        toolName: call.function.name,
        input: deepParseJsonStrings(call.function.arguments) as Record<string, unknown>,
      });
    }
    return result;
  }
}
