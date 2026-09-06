export interface ContextUser {
  id: string;
  name: string;
  role: string;
}

export interface ContextProject {
  id: string;
  name: string;
  client_name: string;
}

export interface TraceStep {
  agent: string;
  message: string;
  tool?: string;
  input?: unknown;
  output?: unknown;
  latencyMs?: number;
}

export interface Evidence {
  sourceId: string;
  sourceType: 'row' | 'chunk';
  content: string;
}

export async function fetchContext(): Promise<{ users: ContextUser[]; projects: ContextProject[] }> {
  const res = await fetch('/api/context');
  if (!res.ok) throw new Error('Failed to load users/projects');
  return res.json();
}

export interface AskHandlers {
  onTraceId?: (traceId: string) => void;
  onStep: (step: TraceStep) => void;
  onDone: (result: { answer: string; evidence: Evidence[] }) => void;
  onError: (message: string) => void;
}

/** Opens the SSE stream for one question and wires it to the given handlers. Caller owns closing it. */
export function askQuestion(
  question: string,
  userId: string,
  projectId: string,
  handlers: AskHandlers,
): EventSource {
  const params = new URLSearchParams({ question, userId, projectId });
  const es = new EventSource(`/api/ask?${params.toString()}`);

  es.addEventListener('trace_id', (e) => {
    const data = JSON.parse((e as MessageEvent).data) as { traceId: string };
    handlers.onTraceId?.(data.traceId);
  });
  es.addEventListener('step', (e) => {
    handlers.onStep(JSON.parse((e as MessageEvent).data) as TraceStep);
  });
  es.addEventListener('done', (e) => {
    handlers.onDone(JSON.parse((e as MessageEvent).data) as { answer: string; evidence: Evidence[] });
  });
  es.addEventListener('ask_error', (e) => {
    const data = JSON.parse((e as MessageEvent).data) as { message: string };
    handlers.onError(data.message);
  });
  es.onerror = () => {
    handlers.onError('Connection to the server was lost.');
  };

  return es;
}
