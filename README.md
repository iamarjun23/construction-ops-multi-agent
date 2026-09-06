# Construction Ops Assistant

A supervisor-based multi-agent RAG system for construction payment, contract,
and progress questions. Full design in [SPEC.md](./SPEC.md).

**Data honesty:** this dataset is synthetic and generated to reproduce
realistic cross-system retrieval challenges. It is not derived from any real
client engagement.

## Status: Phase 2 (Specialist agents)

Two of six planned phases done (see SPEC.md §12).

**Phase 1 — Data & baseline:**
- Postgres + pgvector schema (`src/db/schema.sql`) matching SPEC.md §7.
- A deterministic synthetic seed generator (`src/db/seed.ts`) — 2 projects,
  7 zones, 42 milestones, 125+ progress-log records, 4 documents, 4 users
  with project/zone-scoped access.
- Contract ingestion: chunking (`src/ingestion/chunk.ts`) + embedding
  (`src/ingestion/ingest-contracts.ts`).
- A plain-vector-RAG baseline (`src/rag/plain-rag.ts`) — eval condition 1.
  By design it only searches contract chunks, so it cannot combine payment
  or progress-log facts; that gap is what the Phase 2 specialist agents
  exist to close.
- The flagship question, all expected phrasings, and the expected evidence
  from each source, written down in `eval/questions.json` before any agent
  code exists.

**Phase 2 — Specialist agents:**
- Typed, access-controlled tools (`src/tools/`) — `paymentLookup`,
  `vectorSearch`, `progressLookup`, all parameterized SQL, all enforcing
  project/zone access inside the tool itself (SPEC.md §9), not via prompt
  instructions. `loadAccessContext` resolves a user+project into an
  `AccessContext` (full or zone-restricted).
- Three specialist agents (`src/agents/`) — Payment, Contract, Progress —
  each a scoped system prompt + one forced tool call, returning evidence
  with source IDs.
- The Supervisor (`src/supervisor/`) — splits a question into per-agent
  tasks, delegates, merges evidence, and synthesizes the final cited
  answer. (Audit — verifying the draft against evidence — is Phase 3, not
  wired in yet.)
- The single-agent baseline (`src/rag/single-agent-baseline.ts`) — eval
  condition 2: one agent, all three tools, a real multi-turn tool-use loop.
  This is the number the multi-agent system has to beat (SPEC.md §6).

Not yet built: audit agent, the chat UI, the dedicated cross-zone security
test, trace persistence/SSE, and the three-way evaluation. Those are
Phases 3–6.

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

FLAGSHIP="Is the Zone 3 contractor owed payment for the drywall milestone, and according to the contract, can the client withhold payment because inspection photos are missing?"
npm run rag:plain -- "$FLAGSHIP"                 # eval condition 1
npm run agents:single -- "$FLAGSHIP"             # eval condition 2
npm run agents:supervisor -- "$FLAGSHIP"         # multi-agent (eval condition 3, minus Audit until Phase 3)
```

Both agent runners accept an optional user name and project name:
`npm run agents:supervisor -- "question" "Priya Nandakumar" "Riverside Tower"`
(Priya is seeded as a Zone-3-only contractor — try her against a Zone 1
question to see the access control in `src/tools/` take effect.)

`npm run typecheck` runs the TypeScript compiler with no emit.

## Repository layout

See SPEC.md §11 for the target structure; the Phase 1–2 pieces
(`src/db`, `src/llm`, `src/ingestion`, `src/rag`, `src/tools`, `src/agents`,
`src/supervisor`, `data/contracts`, `eval`) exist so far.
