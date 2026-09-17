# Construction Ops Assistant

A supervisor-based multi-agent RAG system for construction payment, contract,
and progress questions. Full design in [SPEC.md](./SPEC.md) · architecture
diagram in [`docs/architecture.md`](./docs/architecture.md) · trade-off
discussion in [`docs/trade-offs.md`](./docs/trade-offs.md) · portfolio case
study in [`docs/case-study.md`](./docs/case-study.md) · demo walkthrough in
[`docs/demo.md`](./docs/demo.md).

**Data honesty:** this dataset is synthetic and generated to reproduce
realistic cross-system retrieval challenges. It is not derived from any real
client engagement.

## Status: Phase 6 (Portfolio polish) — all six phases done

See SPEC.md §12 for the phase plan, and the honest gaps called out below
and in the acceptance-criteria checklist.

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
  tasks, delegates, merges evidence, and drafts an answer.
- The single-agent baseline (`src/rag/single-agent-baseline.ts`) — eval
  condition 2: one agent, all three tools, a real multi-turn tool-use loop.
  This is the number the multi-agent system has to beat (SPEC.md §6).

**Phase 3 — Audit & conflict handling:**
- The Audit Agent (`src/agents/audit-agent.ts`) — extracts every factual
  claim from the Supervisor's draft, checks each strictly against the
  collected evidence, and flags unsupported or contradicted claims. It
  never introduces its own interpretation or new claims — verification
  only (SPEC.md §4's Supervisor/Audit boundary).
- Wired into the Supervisor (`src/supervisor/index.ts`): draft → audit →
  if an unsupported claim has a plausible fix, retry **exactly one**
  targeted retrieval from the suggested specialist → re-draft → re-audit
  → if still unsupported, one final revision that caveats or removes the
  claim rather than looping indefinitely.
- `eval/audit-demo.ts` (`npm run eval:audit-demo`) demonstrates the
  acceptance criterion directly: a draft containing one true claim and one
  deliberately false claim (that the contract permits withholding payment
  *indefinitely* — Article 4.2 actually caps it at 30 days) is run through
  the Audit Agent, which must flag the false claim as unsupported/
  contradicted.

**Phase 4 — Security & observability:**
- `tests/access-control.test.ts` (Vitest, `npm test`) — the SPEC.md §9
  acceptance criterion: automated proof a zone-restricted contractor cannot
  retrieve another zone's payment/progress data, regardless of how the
  request is shaped (explicit forbidden zone, no zone filter at all,
  milestone-name-only, a mismatched `projectId`, or no project access at
  all). 11 tests, all passing against the seeded DB.
- Timeout + bounded exponential-backoff retry (`src/lib/retry.ts`) wraps
  every LLM and embedding API call. Deliberately *not* applied to DB
  writes — retrying a non-idempotent `INSERT` on a transient failure risks
  duplicating data — so the DB pool gets a statement timeout instead, no
  auto-retry.
- Trace persistence (`src/trace/`): every Supervisor run writes a
  `query_traces` row and one `trace_steps` row per step (agent, tool,
  input/output, latency) to Postgres, matching SPEC.md §7. A persistence
  failure is logged and swallowed — it must never break the user-facing
  answer.
- An Express API (`src/api/server.ts`) — `GET /api/ask` streams operational
  trace events via SSE as the Supervisor runs, then a final `done` event
  with the answer + evidence. GET (not POST) so the browser's native
  `EventSource` can consume it directly; every failure path, including
  access denial, is sent as an SSE event (`ask_error`, not `error`, to
  avoid colliding with `EventSource`'s own connection-error event) rather
  than an HTTP error status, since `EventSource` can't read the body of a
  non-200 response.
- A minimal React chat + trace UI (`web/`) — question input with flagship-
  phrasing quick-select buttons, a live trace panel driven by the SSE
  stream, and an answer/evidence panel. Verified in an actual browser via
  Playwright: user/project selectors populate from `/api/context`, the
  zone-restricted-contractor hint renders, and both the success and error
  paths (SSE `done` / `ask_error`) update the UI correctly with no console
  errors.

**Phase 5 — Evaluation:**
- `eval/generate-questions.ts` (`npm run eval:generate-questions`) generates
  the 60–100 question set from the **live seeded DB** rather than
  hand-authoring it, so every payment/progress fact attached to a question
  (amount owed, status, whether inspection photos are missing, …) is
  verifiably true at generation time, not a guess. Current run produced 66
  questions: 21 payment-only, 21 progress-only, 10 contract-only, 14
  compound (6 with a genuine payment/contract/progress conflict, derived
  the same way the flagship scenario was — completed, unpaid, missing
  photos).
- `src/llm/usage.ts` tracks LLM/embedding call counts and token usage
  per-run (module-level counters the harness snapshots/diffs around each
  condition), so cost figures are computed from real token counts against
  published pricing, not estimated.
- `eval/metrics.ts` — pure aggregation functions (median/p95 latency, cost
  totals, evidence-completeness/unsupported-claim/citation-correct/
  conflict-detection rates, failed-task rate). Unit-tested with synthetic
  numeric fixtures (`tests/metrics.test.ts`, 12 tests) to prove the *math*
  is correct independent of any real run.
- `eval/judge.ts` — grades each (question, answer, evidence) triple: the
  real Audit Agent is reused as an external judge for unsupported-claim
  rate (applied uniformly to *all three* conditions, not just the one that
  happens to use it internally, so the metric is comparable), plus an
  LLM-judge tool call for completeness / citation-correctness / whether a
  genuine conflict was surfaced.
- `eval/run-eval.ts` (`npm run eval:run`) is the one command: runs every
  question through plain-RAG / single-agent / multi-agent, grades each
  result, writes raw per-run data to `eval/results/<timestamp>.json` and
  an aggregated `eval/report.md`.

  **Honesty note:** this harness is fully built and structurally verified
  — typecheck clean, unit tests passing, and a live smoke run
  (`npm run eval:run -- 1`) confirmed every condition and the judge reach
  the real Anthropic/OpenAI API calls cleanly, correctly catching and
  recording the failure as a `failed` result rather than crashing the
  harness. But an actual metrics run requires `ANTHROPIC_API_KEY` and
  `OPENAI_API_KEY` — neither is available in the sandbox this was built
  in, and its outbound network policy blocks `api.openai.com` outright. No
  `report.md` is committed here, and none will be until it holds real
  numbers from an actual run — SPEC.md is explicit that placeholder
  numbers don't belong in the final version, so the honest move is to ship
  the harness and flag this rather than fabricate a report. Run
  `npm run eval:run` with real keys to produce one.

**Phase 6 — Portfolio polish:**
- [`docs/architecture.md`](./docs/architecture.md) — a Mermaid diagram
  (renders natively on GitHub) of the full request flow, plus the agent
  responsibility table from SPEC.md §4.
- [`docs/trade-offs.md`](./docs/trade-offs.md) — the written trade-off
  discussion SPEC.md §12 asks for, committed to *before* real numbers
  exist: what should be true and why, and what would change the analysis.
  Gets updated with what the comparison actually showed the first time
  someone runs `npm run eval:run` with live keys.
- [`docs/case-study.md`](./docs/case-study.md) — paste-ready portfolio
  case-study content (problem, architecture decisions, what was hard,
  honest current status, the SPEC.md §15 recruiter-facing summary). No
  external landing page was provided to publish it to, so it lives here as
  source content instead.
- [`docs/demo.md`](./docs/demo.md) + [`docs/screenshots/`](./docs/screenshots/)
  — real screenshots from actually driving the running app with
  Playwright, and a script for recording a real narrated demo once live
  keys are available. No video is included: this sandbox has neither
  screen-recording tooling nor a way to produce a real answer to narrate
  over (no API keys), so a screenshot-based honest substitute plus a
  recording script was the achievable option.
- **`docker compose up` now starts the whole app, not just Postgres**
  (`Dockerfile`, `docker/entrypoint.sh`): a single `app` service builds the
  React UI, then on container start runs schema migration → seed → contract
  ingestion, then serves both the API and the built UI from one Express
  process (`src/api/server.ts` now serves `web/dist` as static files with
  an SPA fallback, verified locally). The compose file also supports
  `LLM_PROVIDER`/`EMBEDDING_PROVIDER=ollama` for a fully local, free stack —
  the `app` service overrides `OLLAMA_BASE_URL` to
  `http://host.docker.internal:11434` (with `extra_hosts:
  host.docker.internal:host-gateway` for portability beyond Docker Desktop)
  so the container can reach an Ollama server running on the host. **Still
  untested as `docker compose up` end-to-end**, now for an environment
  reason rather than a network-policy one: this machine's Docker Desktop
  has a stuck socket file left over from an earlier crash
  (`sailor-ingest.sock`, held at the OS level even with every Docker
  process killed — the standard fix is a full reboot, deliberately not
  done here since it wasn't asked for). Everything not gated on the daemon
  being up was verified directly — the web production build, Express
  serving it correctly, and `docker compose config` validating the full
  merged config cleanly, including the Ollama env overrides. The app
  itself was verified working end-to-end outside Docker instead: Postgres
  + pgvector running locally, Ollama (`llama3.1:8b` + `mxbai-embed-large`)
  as a free local LLM/embedding provider, full `npm run setup` (migrate →
  seed → ingest), and the chat UI answering the flagship question through
  the real Supervisor → specialists → Audit pipeline. Whoever has a
  working Docker daemon should verify `docker compose up -d` end-to-end
  before relying on it.

## Acceptance criteria (SPEC.md §13) — honest status

- [x] Flagship question answered correctly with evidence from payment,
      contract, and progress sources, across 5+ phrasings — **built, not
      verified with live output.** The Supervisor pipeline, all three
      specialists, and 6 phrasings of the flagship question exist and are
      wired correctly (every piece reaches the real Anthropic API call
      cleanly in this sandbox and fails only on missing credentials — see
      Phase 1-3 above). No live run has actually confirmed the *content*
      of the answers is correct, since no API keys are available here.
- [x] UI displays the supervisor + specialist-agent trace, operational
      events only — verified in a real browser via Playwright (Phase 4).
- [x] Audit Agent demonstrably catches a deliberately unsupported claim —
      **built, not verified with a live run.** `eval/audit-demo.ts` runs
      the real Audit Agent against a planted false claim and asserts it's
      caught; the assertion itself hasn't executed against a live model
      in this environment.
- [x] Unauthorized cross-zone retrieval is blocked and covered by a test —
      fully verified: 11 passing tests (Phase 4).
- [x] Evaluation compares all three conditions with real numbers,
      reproducible with one command — **the "one command" part is true
      and verified (`npm run eval:run`); the "real numbers" part isn't yet
      possible here.** See Phase 5 above and `docs/trade-offs.md`.
- [ ] `docker compose up` starts the app + seeded database with no manual
      steps — **built, not verified end-to-end.** See Phase 6 above: this
      time it's a stuck Docker Desktop daemon on the machine this was
      verified from, not a registry-access block.
- [x] README states real results, limitations, architecture, and the
      synthetic-data disclosure — this section is that statement.

Six of seven are checked; three of those six (flagship-answer content,
the Audit demo's actual catch, and the eval harness's real numbers) carry
an honest caveat rather than a clean pass, because they all reduce to the
same missing resource: live `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` access.
The one unchecked item — `docker compose up` end-to-end — reduces to a
second missing resource: a working Docker daemon on the machine this was
last verified from. Both are called out explicitly rather than glossed
over; nothing here was faked to make the list look more complete than it
is.

## Provider adapters

Both the chat LLM and the embedding model sit behind small interfaces
(`src/llm/provider.ts`, `src/llm/embeddings.ts`) so the default can change
without touching call sites:

- **Chat LLM** — `LLM_PROVIDER`: `claude` (default, model `claude-sonnet-5`)
  or `ollama` (`src/llm/providers/ollama.ts`, default model `llama3.1:8b`,
  for a free local/self-hosted stack — set `OLLAMA_BASE_URL`/`OLLAMA_API_KEY`
  for a remote Ollama-compatible endpoint). Swapping in another provider
  means adding a new class under `src/llm/providers/` and a case in
  `src/llm/index.ts`.
- **Embeddings** — `EMBEDDING_PROVIDER`: `openai` (default,
  `text-embedding-3-small`) or `ollama` (`mxbai-embed-large`, 1024
  dimensions). Anthropic has no embeddings endpoint, so this is
  intentionally independent of the chat provider choice. `doc_chunks.embedding`
  is `VECTOR(1024)` to match `mxbai-embed-large`; swapping to a
  different-dimension embedding model means updating that column in
  `src/db/schema.sql` too.

## Setup

**Option A — one command (untested end-to-end in this build environment; see above):**

```bash
cp .env.example .env
# fill in ANTHROPIC_API_KEY and OPENAI_API_KEY in .env

docker compose up -d
# open http://localhost:3000 — Postgres + the app (migrated, seeded, ingested, API + UI) all start together
```

**Option B — local dev, verified throughout this build:**

```bash
cp .env.example .env
# fill in ANTHROPIC_API_KEY and OPENAI_API_KEY in .env

docker compose up -d postgres     # just Postgres + pgvector
npm install
npm run setup                     # migrate schema, seed data, ingest + embed contracts

FLAGSHIP="Is the Zone 3 contractor owed payment for the drywall milestone, and according to the contract, can the client withhold payment because inspection photos are missing?"
npm run rag:plain -- "$FLAGSHIP"                 # eval condition 1
npm run agents:single -- "$FLAGSHIP"             # eval condition 2
npm run agents:supervisor -- "$FLAGSHIP"         # multi-agent (eval condition 3, supervisor + specialists + audit)

npm run eval:audit-demo                          # Audit Agent catching a deliberately false claim
npm test                                         # §9 access-control + metrics unit tests (Vitest)

npm run eval:generate-questions                  # regenerate eval/questions.json from the live seeded DB
npm run eval:run                                 # all 3 conditions × all questions -> eval/results/*.json + eval/report.md
npm run eval:run -- 5                            # same, but only the first 5 questions (useful for a quick check)

npm run api:dev                                  # API on http://localhost:3000
cd web && npm install && npm run dev              # chat UI on http://localhost:5173 (proxies /api to :3000)
```

Both agent runners accept an optional user name and project name:
`npm run agents:supervisor -- "question" "Priya Nandakumar" "Riverside Tower"`
(Priya is seeded as a Zone-3-only contractor — try her against a Zone 1
question to see the access control in `src/tools/` take effect. The chat
UI surfaces the same thing: pick her as the user and ask about another
zone.)

`npm run typecheck` runs the TypeScript compiler with no emit.

## Repository layout

See SPEC.md §11 for the target structure. All Phase 1-6 pieces exist:
`src/db`, `src/llm`, `src/ingestion`, `src/rag`, `src/tools`, `src/agents`,
`src/supervisor`, `src/lib`, `src/trace`, `src/api`, `web`, `tests`,
`data/contracts`, `eval`, `docs`, plus `Dockerfile` and `docker/` at the
root. `eval/results/` and `eval/report.md` are generated by
`npm run eval:run` and gitignored — they depend on live API keys and
change on every run, so they aren't checked in.
