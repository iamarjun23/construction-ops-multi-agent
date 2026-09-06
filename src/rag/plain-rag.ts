import { pool } from '../db/pool.js';
import { getEmbeddingProvider } from '../llm/embeddings/index.js';
import { getLLMProvider } from '../llm/index.js';

export interface RetrievedChunk {
  id: string;
  content: string;
  documentTitle: string;
  pageNumber: number;
  distance: number;
}

export interface PlainRagResult {
  answer: string;
  retrievedChunks: RetrievedChunk[];
}

const SYSTEM_PROMPT =
  'You are a construction operations assistant. Answer the question using ONLY the numbered ' +
  'context excerpts below. Cite excerpt numbers like [1] inline. If the excerpts do not fully ' +
  'answer the question, say plainly what information is missing rather than guessing. Never state ' +
  'that an action "is legally valid" — only report what the contract states.';

// Eval condition 1 (SPEC.md §6): one vector search over contract chunks, one
// generation. No payment or progress-log data — by design, this baseline can
// only ever answer the contract half of a compound question like the
// flagship one.
export async function runPlainRag(question: string, projectId: string, topK = 5): Promise<PlainRagResult> {
  const embeddingProvider = getEmbeddingProvider();
  const [queryEmbedding] = await embeddingProvider.embed([question]);
  const vectorLiteral = `[${queryEmbedding.join(',')}]`;

  const { rows } = await pool.query<{
    id: string;
    content: string;
    document_title: string;
    page_number: number;
    distance: number;
  }>(
    `SELECT dc.id, dc.content, d.title AS document_title, dc.page_number,
            dc.embedding <=> $1::vector AS distance
     FROM doc_chunks dc
     JOIN documents d ON d.id = dc.document_id
     WHERE d.project_id = $2
     ORDER BY dc.embedding <=> $1::vector
     LIMIT $3`,
    [vectorLiteral, projectId, topK],
  );

  const context = rows
    .map((r, i) => `[${i + 1}] (${r.document_title}, p.${r.page_number})\n${r.content}`)
    .join('\n\n---\n\n');

  const llm = getLLMProvider();
  const { text } = await llm.generate({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `Context:\n${context}\n\nQuestion: ${question}` }],
    maxTokens: 1024,
  });

  return {
    answer: text ?? '(no answer generated)',
    retrievedChunks: rows.map((r) => ({
      id: r.id,
      content: r.content,
      documentTitle: r.document_title,
      pageNumber: r.page_number,
      distance: r.distance,
    })),
  };
}

async function main() {
  const question = process.argv[2];
  if (!question) {
    console.error('Usage: npm run rag:plain -- "your question" ["Project Name"]');
    process.exit(1);
  }
  const projectName = process.argv[3] ?? 'Riverside Tower';

  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM projects WHERE name = $1`, [projectName]);
  if (rows.length === 0) {
    console.error(`Project not found: ${projectName}`);
    process.exit(1);
  }

  const result = await runPlainRag(question, rows[0].id);
  console.log('\n=== Plain RAG Answer ===\n');
  console.log(result.answer);
  console.log('\n=== Retrieved chunks ===');
  for (const c of result.retrievedChunks) {
    console.log(`- [${c.documentTitle} p.${c.pageNumber}] distance=${c.distance.toFixed(4)}`);
  }
  await pool.end();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
