import { pool } from '../db/pool.js';
import { getEmbeddingProvider } from '../llm/embeddings/index.js';
import { AccessContext, AccessDeniedError, Evidence, VectorSearchInput } from './types.js';

export interface ChunkResult {
  chunkId: string;
  documentTitle: string;
  documentType: string;
  pageNumber: number;
  content: string;
  distance: number;
}

export interface VectorSearchOutput {
  chunks: ChunkResult[];
  evidence: Evidence[];
}

// Vector search applies project + permission filters before returning
// chunks (SPEC.md §9). Contract/policy documents are project-scoped, not
// zone-scoped, so a valid AccessContext for the project is sufficient.
export async function vectorSearch(input: VectorSearchInput, ctx: AccessContext): Promise<VectorSearchOutput> {
  if (input.projectId !== ctx.projectId) {
    throw new AccessDeniedError("Tool called for a project outside the caller's scope");
  }

  const embeddingProvider = getEmbeddingProvider();
  const [queryEmbedding] = await embeddingProvider.embed([input.query]);
  const vectorLiteral = `[${queryEmbedding.join(',')}]`;

  const params: unknown[] = [vectorLiteral, ctx.projectId];
  const conditions = ['d.project_id = $2'];
  if (input.documentType) {
    params.push(input.documentType);
    conditions.push(`d.type = $${params.length}`);
  }
  params.push(input.topK ?? 5);

  const { rows } = await pool.query<{
    id: string;
    title: string;
    type: string;
    page_number: number;
    content: string;
    distance: number;
  }>(
    `SELECT dc.id, d.title, d.type, dc.page_number, dc.content, dc.embedding <=> $1::vector AS distance
     FROM doc_chunks dc
     JOIN documents d ON d.id = dc.document_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY dc.embedding <=> $1::vector
     LIMIT $${params.length}`,
    params,
  );

  const chunks: ChunkResult[] = rows.map((r) => ({
    chunkId: r.id,
    documentTitle: r.title,
    documentType: r.type,
    pageNumber: r.page_number,
    content: r.content,
    distance: r.distance,
  }));

  return {
    chunks,
    evidence: chunks.map((c) => ({
      sourceId: c.chunkId,
      sourceType: 'chunk',
      specialist: 'contract',
      content: `(${c.documentTitle}, p.${c.pageNumber}) ${c.content}`,
    })),
  };
}
