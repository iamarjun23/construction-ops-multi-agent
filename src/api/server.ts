import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import { pool } from '../db/pool.js';
import { answerQuestion } from '../supervisor/index.js';
import { loadAccessContext } from '../tools/access.js';
import { AccessDeniedError } from '../tools/types.js';
import { createQueryTrace } from '../trace/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Present only in the Docker image (web/dist is built and copied in during
// the image build — see Dockerfile). In local dev, the Vite dev server
// serves the UI directly and proxies /api to this server instead.
const WEB_DIST = path.join(__dirname, '../../web/dist');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Lets the chat UI populate user/project selectors without a real auth
// system — this is a portfolio demo, not a multi-tenant product (SPEC.md §2).
app.get('/api/context', async (_req, res, next) => {
  try {
    const { rows: users } = await pool.query(`SELECT id, name, role FROM users ORDER BY name`);
    const { rows: projects } = await pool.query(`SELECT id, name, client_name FROM projects ORDER BY name`);
    res.json({ users, projects });
  } catch (err) {
    next(err);
  }
});

// GET (not POST) so the browser's native EventSource can consume this
// directly — streams operational trace events via SSE as the Supervisor
// runs, then a final `done` event with the answer + evidence (SPEC.md §5,
// §10). Every failure path — including access denial — is sent as an SSE
// event rather than an HTTP error status, since EventSource can't read the
// body of a non-200 response; `ask_error` (not `error`) avoids colliding
// with EventSource's own connection-level `error` event.
app.get('/api/ask', async (req, res) => {
  const question = typeof req.query.question === 'string' ? req.query.question : '';
  const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : '';

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  if (!question.trim() || !userId || !projectId) {
    send('ask_error', { message: 'question, userId, and projectId are required' });
    res.end();
    return;
  }

  try {
    const ctx = await loadAccessContext(userId, projectId);
    const traceId = await createQueryTrace(question, userId);
    send('trace_id', { traceId });

    const result = await answerQuestion(question, ctx, {
      traceId,
      onStep: (step) => send('step', step),
    });

    send('done', { answer: result.answer, evidence: result.evidence });
  } catch (err) {
    const message =
      err instanceof AccessDeniedError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Unknown error';
    send('ask_error', { message });
  } finally {
    res.end();
  }
});

if (existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  // SPA fallback for any non-API GET route — must come after express.static
  // (which already served real asset files) and after the /api routes above.
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(WEB_DIST, 'index.html'));
  });
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
