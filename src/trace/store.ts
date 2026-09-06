import { pool } from '../db/pool.js';

// Persists SPEC.md §7's query_traces / trace_steps tables. Trace-step writes
// are best-effort observability, not part of answering the question, so a
// persistence failure here is logged and swallowed rather than propagated —
// it must never break the user-facing answer.

export async function createQueryTrace(question: string, userId: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO query_traces (question, user_id) VALUES ($1, $2) RETURNING id`,
    [question, userId],
  );
  return rows[0].id;
}

export interface TraceStepRecord {
  agent: string;
  tool?: string | null;
  input?: unknown;
  output?: unknown;
  latencyMs: number;
}

export async function recordTraceStep(traceId: string, stepIndex: number, step: TraceStepRecord): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO trace_steps (trace_id, step_index, agent, tool, input, output, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        traceId,
        stepIndex,
        step.agent,
        step.tool ?? null,
        JSON.stringify(step.input ?? null),
        JSON.stringify(step.output ?? null),
        step.latencyMs,
      ],
    );
  } catch (err) {
    console.error(`Failed to persist trace step ${stepIndex} for trace ${traceId}:`, err);
  }
}
