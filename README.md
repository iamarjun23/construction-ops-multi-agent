# Construction Ops Assistant

A supervisor-based multi-agent RAG system for construction payment, contract,
and progress questions. Full design in [SPEC.md](./SPEC.md).

**Data honesty:** this dataset is synthetic and generated to reproduce
realistic cross-system retrieval challenges. It is not derived from any real
client engagement.

## Status: Phase 1 (Data & baseline)

This is the first of six planned phases (see SPEC.md §12). What's here:

- Postgres + pgvector schema (`src/db/schema.sql`) matching SPEC.md §7.
- A deterministic synthetic seed generator (`src/db/seed.ts`) — 2 projects,
  7 zones, 42 milestones, 125+ progress-log records, 4 documents, 4 users
  with project/zone-scoped access.
- Contract ingestion: chunking (`src/ingestion/chunk.ts`) + embedding
  (`src/ingestion/ingest-contracts.ts`).
- A plain-vector-RAG baseline (`src/rag/plain-rag.ts`) — eval condition 1.
  By design it only searches contract chunks, so it cannot combine payment
  or progress-log facts; that gap is what Phase 2's specialist agents exist
  to close.
- The flagship question, all expected phrasings, and the expected evidence
  from each source, written down in `eval/questions.json` before any agent
  code exists.

Not yet built: specialist agents, supervisor, audit agent, the chat UI,
security enforcement tests, and the three-way evaluation. Those are Phases
2–6.

## Provider adapters

Both the chat LLM and the embedding model sit behind small interfaces
(`src/llm/provider.ts`, `src/llm/embeddings.ts`) so the default can change
without touching call sites:

- **Chat LLM** — `LLM_PROVIDER` (default `claude`, model `claude-sonnet-5`).
  Only a Claude implementation exists today; swapping providers later means
  adding a new class under `src/llm/providers/` and a case in
  `src/llm/index.ts`.
- **Embeddings** — `EMBEDDING_PROVIDER` (default `openai`,
  `text-embedding-3-small`, 1536 dimensions to match `doc_chunks.embedding`).
  Anthropic has no embeddings endpoint, so this is intentionally independent
  of the chat provider choice.

## Setup

```bash
cp .env.example .env
# fill in ANTHROPIC_API_KEY and OPENAI_API_KEY in .env

docker compose up -d          # starts Postgres + pgvector
npm install
npm run setup                 # migrate schema, seed data, ingest + embed contracts
npm run rag:plain -- "Is the Zone 3 contractor owed payment for the drywall milestone, and according to the contract, can the client withhold payment because inspection photos are missing?"
```

`npm run typecheck` runs the TypeScript compiler with no emit.

## Repository layout

See SPEC.md §11 for the target structure; only the Phase 1 pieces
(`src/db`, `src/llm`, `src/ingestion`, `src/rag`, `data/contracts`, `eval`)
exist so far.
