# Construction Ops Assistant

Ask a plain-English question about a project's payments, contract terms, or
site progress — get back one answer that reconciles all three, with every
claim traced to its source row or contract clause.

> *"Is the Zone 3 contractor owed payment for the drywall milestone, and
> according to the contract, can the client withhold payment because
> inspection photos are missing?"*
>
> **Payment Database** — owed $42,000.00, $0 paid.
> **Contract** — Section 4.2 lets the client withhold payment for missing
> photos, but caps it at 30 days.
> **Progress Records** — the milestone is marked complete.
> **Uncertainty** — flags the open question: can the client withhold past
> the 30-day cap?

Construction payment disputes happen because the answer to a question like
that lives in three different places — a payments table, a PDF contract,
and a site progress log — and nobody has time to cross-check all three by
hand. This tool does that reconciliation automatically and shows its work.

## How it works

A **Supervisor** agent breaks the question into per-source tasks and hands
them to three specialists — **Payment**, **Contract**, and **Progress** —
each restricted to its own typed, access-controlled tool (no free-form
SQL). The Supervisor merges their evidence into a draft answer, and an
**Audit** agent checks every claim in that draft against the collected
evidence before it ships, catching unsupported or contradicted statements
and triggering one targeted re-check when needed.

Every fact in the final answer carries a source ID back to the exact
payment row, progress-log entry, or contract chunk it came from — so the
answer panel and the evidence list always agree.

See [`docs/architecture.md`](./docs/architecture.md) for the full request-flow
diagram and agent responsibilities.

## Features

- **Cross-source reasoning** — combines payment records, contract text, and
  site progress logs into one reconciled answer instead of three separate
  lookups.
- **Cited evidence** — every claim links to the row or contract clause that
  backs it, shown alongside the answer.
- **Self-checking answers** — an audit pass verifies the draft against
  evidence and flags or removes anything unsupported before it's shown.
- **Zone-scoped access control** — contractors only ever see data for the
  zones they're assigned to, enforced in the data-access layer itself, not
  by prompt instructions.
- **Live reasoning trace** — watch the Supervisor delegate to each
  specialist in real time via the trace panel.
- **Works fully offline** — runs against local Ollama models
  (`llama3.1:8b` + `mxbai-embed-large`) with no API keys, or against
  Claude + OpenAI for higher-quality answers.

## Quickstart

```bash
cp .env.example .env
docker compose up -d          # Postgres+pgvector, and (with a full .env) the app itself

npm install
npm run setup                 # migrate schema, seed sample data, ingest + embed contracts

npm run api:dev                       # API on http://localhost:3000
cd web && npm install && npm run dev  # UI on http://localhost:5173
```

By default the app runs entirely on local models via [Ollama](https://ollama.com)
— install it, pull `llama3.1:8b` and `mxbai-embed-large`, and no API keys
are needed. To use Claude + OpenAI instead, set `ANTHROPIC_API_KEY` /
`OPENAI_API_KEY` and `LLM_PROVIDER=claude` / `EMBEDDING_PROVIDER=openai` in
`.env`. See [`.env.example`](./.env.example) for every option.

The seeded data includes a zone-restricted contractor account — pick them
as the user and ask about a different zone to see access control block the
request.

## Stack

TypeScript, Node.js/Express, PostgreSQL + pgvector, React, Server-Sent
Events. LLM and embedding providers are swappable (Claude/OpenAI or fully
local Ollama) behind a small adapter interface — see
[`src/llm/provider.ts`](./src/llm/provider.ts).

## Repository layout

```
src/db          schema + migrations + seed data
src/ingestion   contract chunking + embedding
src/tools       typed, access-controlled data access (payment, vector search, progress)
src/agents      Payment / Contract / Progress specialists + Audit
src/supervisor  orchestration: delegate -> merge -> draft -> audit -> revise
src/api         Express server (SSE streaming)
web/            React chat + trace UI
docs/           architecture
```

**Data note:** the seeded projects, contracts, and payment records are
synthetic test data, not a real client engagement.
