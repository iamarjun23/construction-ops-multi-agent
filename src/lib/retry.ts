export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export interface RetryOptions {
  retries?: number;
  timeoutMs?: number;
  baseDelayMs?: number;
  isRetryable?: (err: unknown) => boolean;
}

function defaultIsRetryable(err: unknown): boolean {
  if (err instanceof TimeoutError) return true;
  const status = (err as { status?: number } | undefined)?.status;
  if (typeof status === 'number') return status === 429 || status >= 500;
  const code = (err as { code?: string } | undefined)?.code;
  return code !== undefined && ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN'].includes(code);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(`Timed out after ${timeoutMs}ms`)), timeoutMs);
    fn().then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

// Applied to external LLM/embedding API calls (SPEC.md §12 Phase 4:
// "timeout/retry handling on every external call"). Deliberately NOT
// applied to DB writes — retrying a non-idempotent INSERT/UPDATE on a
// transient failure risks duplicating data; the DB pool gets a statement
// timeout instead (src/db/pool.ts), with no automatic retry.
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { retries = 3, timeoutMs = 30000, baseDelayMs = 500, isRetryable = defaultIsRetryable } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await withTimeout(fn, timeoutMs);
    } catch (err) {
      lastError = err;
      if (attempt === retries || !isRetryable(err)) throw err;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastError;
}
