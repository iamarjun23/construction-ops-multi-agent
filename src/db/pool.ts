import pg from 'pg';
import { config } from '../config.js';

// statement_timeout bounds a hung query; no automatic retry is layered on
// top (unlike the LLM/embedding providers in src/lib/retry.ts) since
// retrying a non-idempotent write on transient failure risks duplicating
// data — see the reasoning in that file.
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  statement_timeout: 15_000,
  connectionTimeoutMillis: 10_000,
});
