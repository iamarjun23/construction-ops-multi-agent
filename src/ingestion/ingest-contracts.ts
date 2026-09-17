import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pool } from '../db/pool.js';
import { chunkText } from './chunk.js';
import { getEmbeddingProvider } from '../llm/embeddings/index.js';

async function main() {
  const embeddingProvider = getEmbeddingProvider();
  const { rows: documents } = await pool.query<{ id: string; source_path: string; title: string }>(
    `SELECT id, source_path, title FROM documents`,
  );

  if (documents.length === 0) {
    console.log('No documents found — run `npm run db:seed` first.');
    await pool.end();
    return;
  }

  for (const doc of documents) {
    const filePath = path.join(process.cwd(), doc.source_path);
    const text = readFileSync(filePath, 'utf8');
    const chunks = chunkText(text);
    const embeddings = await embeddingProvider.embed(chunks.map((c) => c.content));

    await pool.query(`DELETE FROM doc_chunks WHERE document_id = $1`, [doc.id]);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const vectorLiteral = `[${embeddings[i].join(',')}]`;
      await pool.query(
        `INSERT INTO doc_chunks (document_id, chunk_index, content, embedding, page_number)
         VALUES ($1, $2, $3, $4::vector, $5)`,
        [doc.id, chunk.chunkIndex, chunk.content, vectorLiteral, chunk.pageNumber],
      );
    }
    console.log(`Ingested ${chunks.length} chunks for "${doc.title}"`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
