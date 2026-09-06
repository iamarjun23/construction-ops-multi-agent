# Construction Ops Assistant — Supervisor-Based Multi-Agent RAG

**Status:** spec v2 (supersedes v1's single-controller design)
**Owner:** Arjun L
**One-line pitch:** A supervisor-based multi-agent retrieval system that combines construction payment data, contract documents, progress logs, and evidence verification to answer complex payment and compliance questions.

---

## 1. Product goal

Construction information lives in different systems: Postgres tables hold exact payment/milestone/date/status facts; contract documents hold rules and conditions; progress logs hold what happened on site and whether inspection evidence exists. A plain vector-search chatbot can find a relevant paragraph but cannot reliably combine all three. This project uses specialized agents coordinated by a supervisor — and must prove that design is useful, not just impressive-looking.

## 2. Non-goals (v1)

- Not a general-purpose document Q&A tool — scope is fixed to payments, milestones, contracts, progress logs.
- Not a multi-tenant SaaS. Not a fine-tuned model. Not a broad question set — one flagship scenario (§4) fully instrumented beats ten shallow ones.
- Not a source of legal advice — the system reports what a contract states, never whether an action is legally valid (see §4).
- Not a distributed system: "agents" are scoped LLM calls orchestrated by one process, not separate services (see §11).

## 3. Flagship user question

> Is the Zone 3 contractor owed payment for the drywall milestone, and according to the contract, can the client withhold payment because inspection photos are missing?

The final answer must distinguish **what the payment database says**, **what the contract permits**, **what the progress records show**, and **what remains uncertain**. It says *"according to the contract"* — never that withholding payment "is legally valid," since the system is not a lawyer.

## 4. Architecture

```
                           ┌──────────────────────┐
                           │      Chat UI          │
                           │ answer + trace panel  │
                           └──────────┬────────────┘
                                      ▼
                           ┌──────────────────────┐
                           │  Express API /api/ask │
                           └──────────┬────────────┘
                                      ▼
                           ┌──────────────────────┐
                           │   Supervisor Agent    │
                           │ plans, delegates,     │
                           │ resolves, finalizes   │
                           └──────┬───┬───┬───┬────┘
                   ┌──────────────┘   │   │   └──────────────┐
                   ▼                  ▼   ▼                  ▼
          ┌────────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
          │ Payment Agent  │ │ Contract     │ │ Progress     │ │ Audit Agent  │
          │ safe SQL,      │ │ Agent        │ │ Agent        │ │ claims +     │
          │ exact facts    │ │ pgvector     │ │ logs/photos  │ │ citations    │
          └───────┬────────┘ └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
                  └─────────────────┴────────────────┴────────────────┘
                                      ▼
                           ┌──────────────────────┐
                           │   Evidence store      │
                           │ source IDs, chunks,   │
                           │ rows, citations       │
                           └──────────┬────────────┘
                                      ▼
                              Final cited answer
```

### Agent responsibilities

| Agent | Does | Never does |
|---|---|---|
| **Supervisor** | Splits compound questions into tasks, delegates to specialists, merges findings, sends draft to Audit, resolves/reports uncertainty, produces final cited answer | Fabricate evidence, skip Audit on a compound question |
| **Payment** | Typed payment/milestone lookup — exact amount, status, paid amount, due date | Generate or accept arbitrary SQL |
| **Contract** | pgvector search over contract chunks — returns clause + page number as evidence | Summarize vaguely without a source chunk |
| **Progress** | Searches progress logs / inspection-photo metadata; reports missing or conflicting records | Assume evidence exists because it's plausible |
| **Audit** | Extracts claims from the draft, checks each against retrieved rows/chunks, flags unsupported/contradictory claims, requests **at most one** targeted retrieval retry | Add new interpretation — verification only, no new claims |

**Supervisor vs. Audit boundary** (the one place this design tends to blur): Supervisor synthesizes and decides what to ask for; Audit strictly checks the draft against evidence and never introduces its own interpretation. Keep this as an explicit line in both prompts.

## 5. Example execution trace

```
[supervisor]    compound question detected → created 2 tasks
[payment-agent] exact amount/status required → queried payments table
[contract-agent] contract condition required → searched signed contract
[progress-agent] inspection evidence required → searched Zone 3 progress logs
[supervisor]    evidence collected from 3 sources
[audit-agent]   claim about automatic holdback is not fully supported
[contract-agent] re-retrieved contract section 4.2
[audit-agent]   final claims supported by 3 citations
[done]          answer finalized · 5 tool calls · 2.4s
```

UI shows operational events only — never raw chain-of-thought or private model reasoning.

## 6. Evaluation — the three-way comparison

Run the same eval set through:

1. **Plain RAG** — one vector search, one generation.
2. **Single-agent baseline** — one agent, all three tools (payment lookup, contract search, progress search), no supervisor/audit split.
3. **Multi-agent system** — supervisor + specialists + audit.

Metrics: answer completeness, citation correctness, unsupported-claim rate, conflict-detection accuracy, median/p95 latency, API cost, tool calls per question, agent disagreement/failed-task rate.

**Be honest about what this comparison can show.** Condition 2 exists specifically to test whether the multi-agent split earns its cost — expect multi-agent to add real latency and API cost over the single-agent baseline (roughly 2-3x the LLM calls per question, since each specialist and the audit pass are their own call). If multi-agent doesn't beat single-agent on accuracy, that is a legitimate, reportable finding — "no measurable accuracy gain, but improved auditability and per-source failure isolation" is a senior-level conclusion, not a failed project. Decide now that the README will report whichever result actually happens.

The README must report real measurements — no placeholder numbers in the final version.

## 7. Data model (Postgres + pgvector)

```sql
projects(id, name, client_name)
zones(id, project_id, label)
milestones(id, zone_id, name, amount_due, status, due_date)
payments(id, milestone_id, amount_paid, paid_at, method)
progress_logs(id, zone_id, milestone_id, entry_date, note, has_inspection_photos boolean)

documents(id, project_id, type, title, source_path)      -- type: contract|policy
doc_chunks(id, document_id, chunk_index, content, embedding vector(1536), page_number)

users(id, name, role)                                     -- role: admin|project_manager|contractor
project_access(user_id, project_id, permission)

query_traces(id, question, user_id, created_at)
trace_steps(id, trace_id, step_index, agent, tool, input jsonb, output jsonb, latency_ms)
```

**Data honesty (README line):** *"This dataset is synthetic and generated to reproduce realistic cross-system retrieval challenges. It is not derived from any real client engagement."*

**Initial scale:** 1–2 projects · 6–10 zones · 30–60 milestones · 100+ progress-log records · 3–5 contract documents · 60–100 evaluation questions.

## 8. Tool schemas

```ts
type VectorSearchInput = { query: string; documentType?: 'contract'|'policy'; projectId: string; topK?: number };

type PaymentLookupInput = {
  intent: 'payment_status' | 'milestone_status';
  projectId: string; zoneLabel?: string; milestoneName?: string;
}; // never raw SQL — typed intent + parameters, mapped internally to parameterized queries

type VerifyClaimInput = { claim: string; evidence: { sourceId: string; sourceType: 'chunk'|'row'; content: string }[] };
type VerifyClaimOutput = { supported: boolean; contradiction?: string; suggestedRetrieval?: string };
```

## 9. Security requirements

- Every agent call carries a scoped user + project context; access control enforced **inside tools**, not via prompt instructions.
- Contractors see only permitted zones/records; project managers/admins see the full project.
- Payment lookups: typed intent + parameters only, all SQL parameterized.
- Vector search applies project + permission filters before returning chunks.
- **Test requirement:** at least one automated test proving a contractor cannot retrieve another zone's payment or contract data, regardless of how the question is phrased.

## 10. Technology stack

| Layer | Choice |
|---|---|
| Language | TypeScript |
| API | Node.js + Express |
| Database | Postgres + pgvector |
| LLM | Provider-agnostic adapter (Claude or GPT) |
| Frontend | React (chat UI + trace panel) |
| Testing | Vitest/Jest (routing/security logic) + separate eval harness (retrieval quality) |
| Runtime | Docker Compose |
| Streaming | Server-Sent Events (simplest option that supports incremental trace events) |
| Observability | Structured trace records in Postgres |

**Implementation note:** agents are distinct system-prompt + tool-scoped LLM calls invoked by supervisor code — not separate services, queues, or processes. Use the simplest orchestration that supports typed agent outputs, bounded retries, and reliable traces; add a framework only if it reduces complexity over hand-rolled orchestration.

## 11. Repository structure

```
construction-ops-multi-agent/
├── src/
│   ├── supervisor/
│   ├── agents/{payment,contract,progress,audit}-agent.ts
│   ├── tools/
│   ├── db/
│   ├── api/
│   ├── evidence/
│   └── trace/
├── web/
├── eval/{questions.json, run-eval.ts, report.md}
├── tests/
├── docker-compose.yml
├── README.md
└── .env.example
```

## 12. Development phases

**Phase 1 — Data & baseline** *(~1/3 of total effort — biggest single chunk)*
Postgres schema + synthetic seed generator; contract ingestion/chunking/embeddings; plain-vector-RAG baseline (eval condition 1); flagship question + expected evidence written down before any agent code exists.

**Phase 2 — Specialist agents**
Payment, Contract, Progress agents with typed I/O; Supervisor Agent; evidence stored with source IDs. Build and eval-test the **single-agent baseline (condition 2) here too** — don't defer it to the end, since it's the number multi-agent has to beat.

**Phase 3 — Audit & conflict handling**
Audit Agent; unsupported-claim detection; contradiction detection across payment/contract/progress evidence; bounded to one retrieval retry.

**Phase 4 — Security & observability**
Tool-layer permission enforcement + the unauthorized-access test (§9); trace persistence + SSE streaming; React trace panel; timeout/retry handling on every external call.

**Phase 5 — Evaluation**
60–100 held-out questions; run all three conditions; generate real metrics + `report.md` from one command. Do this early against the single-agent baseline, not only at the end — you want a real number to beat while there's still time to change course.

**Phase 6 — Portfolio polish**
Architecture diagram, short demo recording, written trade-off discussion (including whatever the three-way comparison actually showed), README with setup instructions, case-study section on the landing page.

## 13. Acceptance criteria

- [ ] Flagship question (§3) answered correctly with evidence from payment, contract, and progress sources, consistently across 5+ phrasings.
- [ ] UI displays the supervisor + specialist-agent trace, operational events only.
- [ ] Audit Agent demonstrably catches at least one deliberately unsupported or conflicting claim.
- [ ] Unauthorized cross-zone retrieval is blocked and covered by a test.
- [ ] Evaluation compares plain RAG, single-agent, and multi-agent with real (non-placeholder) numbers, reproducible with one command.
- [ ] `docker compose up` starts the app + seeded database with no manual steps.
- [ ] README states real results, limitations, architecture, and the synthetic-data disclosure.

## 14. Scope guardrails

Do not add until the core evaluation works: voice interface, additional agents beyond the four specified, long-term autonomous memory, multi-tenant features, fine-tuning, large document collections, unbounded agent loops.

The project is impressive for measurable improvement, safe orchestration, and honestly reported trade-offs — not for agent count.

## 15. Final recruiter-facing description

> Built a supervisor-based multi-agent RAG system where specialized payment, contract, progress, and audit agents collaborate across Postgres, pgvector, and evidence validation. Compared plain RAG, single-agent, and multi-agent approaches using answer completeness, citation correctness, unsupported-claim rate, latency, and cost.

## 16. Open decisions

- **LLM provider** — Claude vs. GPT for the default adapter (either works given the provider-agnostic interface in §10). Starting with Claude (`claude-sonnet-5`) via a provider-agnostic adapter interface so the default can be swapped later without touching call sites.
