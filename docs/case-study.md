# Case study: Construction Ops Assistant

*A supervisor-based multi-agent RAG system for construction payment,
contract, and progress questions — built to prove a specific claim, not
just to look impressive.*

## The problem

Construction information lives in different systems: Postgres tables hold
exact payment/milestone/status facts; contract PDFs hold rules and
conditions; progress logs hold what happened on site and whether
inspection evidence exists. A plain vector-search chatbot can find a
relevant contract paragraph, but it can't combine all three — and getting
the combination wrong has real consequences (a contractor wrongly told
they aren't owed money; a client told they can withhold payment
indefinitely when the contract caps it at 30 days).

## The flagship question

> *Is the Zone 3 contractor owed payment for the drywall milestone, and
> according to the contract, can the client withhold payment because
> inspection photos are missing?*

Answering this correctly means checking three independent sources and
reconciling them: the payment database (is the milestone complete? has it
been paid?), the contract (does it actually permit withholding for this
reason, and for how long?), and the progress logs (are photos actually
missing, or has this already been resolved?). The system has to state each
source's answer distinctly, flag what remains uncertain, and — critically
— never claim that withholding payment "is legally valid." It reports what
the contract states; it isn't a lawyer.

## Architecture: why a supervisor, not one big prompt

The design bet: split the work across scoped specialist agents (Payment,
Contract, Progress) coordinated by a Supervisor, with an Audit agent that
checks the draft against evidence before it ships. See
[`architecture.md`](./architecture.md) for the full diagram. Three
decisions mattered most:

- **Typed tools, not free-form SQL.** The Payment and Progress agents
  never generate SQL — they extract a typed `{intent, zoneLabel,
  milestoneName}` via a forced tool call, and a hand-written parameterized
  query does the rest. Access control (project + zone scoping) is baked
  into that query, not left to a prompt instruction an attacker could talk
  the model out of.
- **Evidence with source IDs, always.** Every fact the system states
  traces back to a `sourceId` (a milestone row, a payment row, a progress
  log row, or a contract chunk) and a `specialist` tag. This is what makes
  the Audit agent's job — and the eval harness's citation-correctness
  check — possible at all.
- **Audit as verification only.** The one design boundary that's easy to
  blur: the Supervisor synthesizes and decides what's missing; Audit
  *only* checks the draft against evidence and is never allowed to
  introduce a new interpretation. Both system prompts state this
  explicitly, and `eval/audit-demo.ts` proves it catches a deliberately
  planted false claim (a "withhold indefinitely" claim the contract
  actually caps at 30 days).

## What was genuinely hard

- **Fair cross-condition comparison.** It would have been easy to let
  the multi-agent condition "win" by construction — it has an audit pass
  the others don't. Instead, `eval/judge.ts` reuses the *same* Audit agent
  as an external judge against **all three** conditions' outputs, so
  unsupported-claim rate means the same thing regardless of which system
  produced the answer.
- **Ground-truth eval data, not guesses.** Hand-writing 60-100 "expected
  evidence" answers invites subtle self-serving drift. Instead,
  `eval/generate-questions.ts` derives every payment/progress fact
  directly from the live seeded database at generation time — the
  question set is only as good as the seed, but at least it's never wrong
  about what the seed actually contains.
- **A genuinely bounded retry.** "Audit requests at most one targeted
  retrieval retry" is easy to state and easy to accidentally implement as
  an unbounded loop. The Supervisor's draft → audit → retry → re-audit →
  *one* final revision path in `src/supervisor/index.ts` is structured so
  there is no code path that retries twice.

## Where it stands

Five of six planned phases are complete: data + baseline, specialist
agents, audit, security/observability (including an automated test
proving cross-zone access is blocked regardless of how a request is
phrased), and a fully-built evaluation harness. What's *not* done, and
said plainly rather than hidden: the harness hasn't been run against live
API keys yet, so there are no real accuracy/cost/latency numbers to report
here — see [`trade-offs.md`](./trade-offs.md) for what the comparison is
expected to show and why, updated with real numbers the moment it runs.
Shipping the harness and saying so is the more defensible choice than
fabricating a report.

## Recruiter-facing summary

> Built a supervisor-based multi-agent RAG system where specialized
> payment, contract, progress, and audit agents collaborate across
> Postgres, pgvector, and evidence validation. Compared plain RAG,
> single-agent, and multi-agent approaches using answer completeness,
> citation correctness, unsupported-claim rate, latency, and cost.

**Stack:** TypeScript, Node.js/Express, PostgreSQL + pgvector, React,
Server-Sent Events, Vitest. LLM: Claude (Sonnet 5) behind a
provider-agnostic adapter. Embeddings: OpenAI `text-embedding-3-small`.

**Data honesty:** the dataset is synthetic, generated to reproduce
realistic cross-system retrieval challenges. It is not derived from any
real client engagement.
