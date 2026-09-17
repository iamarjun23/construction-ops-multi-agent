# Trade-offs

SPEC.md §6 asks for an honest three-way comparison, not a foregone
conclusion, and explicitly says: *"if multi-agent doesn't beat single-agent
on accuracy, that is a legitimate, reportable finding... not a failed
project."* This document commits to that in writing, before the numbers
exist, so there's no temptation to spin them after the fact.

## Status: the harness exists, the numbers don't yet

`eval/run-eval.ts` (Phase 5) is built, unit-tested, and structurally
verified — but producing it requires `ANTHROPIC_API_KEY` and
`OPENAI_API_KEY`, neither of which is available in the environment this
project was built in (its network policy also blocks `api.openai.com`
outright). No `eval/report.md` is committed to this repo, and this
document will be updated with real numbers — replacing the qualitative
predictions below with what actually happened — the first time someone
runs `npm run eval:run` with live keys. Until then, everything below is a
design-level argument, clearly labeled as such, not a result.

## What should be true, and why

**Cost and latency: multi-agent should lose.** Per question, plain RAG
makes 2 API calls (one embed, one generate). Single-agent makes a variable
number of tool-use turns, typically 2-4. Multi-agent makes a planner call,
one call per delegated specialist (1-3), a draft call, an audit call, and
—on the minority of questions where Audit flags something—one retry
specialist call, one re-draft, and one revision. That's routinely 6-9 LLM
calls for a compound question versus single-agent's 2-4. `src/llm/usage.ts`
measures this directly (real token counts, not estimates), so this isn't a
guess to be confirmed later — it's arithmetic on what the code does.

**Evidence-completeness: multi-agent should win outright.** Plain RAG
never touches the payment or progress tables, so it structurally cannot
answer a compound question completely — not a training issue, a design
one. Single-agent has all three tools, so it should approach multi-agent's
evidence-completeness given enough turns; whether it reliably remembers to
call all three tools for a compound question without a supervisor forcing
task decomposition is exactly what `evidenceCompletenessRate` in
`eval/metrics.ts` will measure.

**Unsupported-claim rate: this is the real question.** The Audit Agent is
applied uniformly to all three conditions' outputs as an external judge
(`eval/judge.ts`), specifically so this comparison is fair rather than
structurally biased toward multi-agent (which would happen if only its own
internal audit pass counted). If multi-agent's rate isn't meaningfully
better than single-agent's, that's the headline finding this project is
built to surface honestly, not bury.

**Conflict detection: multi-agent's actual thesis.** The flagship scenario
(§3) and the 6 generated compound questions with a genuine conflict exist
specifically to test whether separating "what does the DB say," "what does
the contract permit," and "what do the logs show" into distinct specialist
calls — then explicitly auditing the synthesis — produces a more reliable
answer than one model juggling all three at once. This is the one metric
where a single-agent loss would validate the project's core design
argument; a tie or a single-agent win would be evidence the split isn't
earning its cost.

**Failure isolation, not just accuracy.** Even before real numbers exist,
one structural property is already true by construction, not prediction:
when the Contract Agent's `vector_search` call fails, `trace_steps`
records exactly which specialist failed and on which tool, with input and
latency — the single-agent baseline's failure mode is "the whole answer
didn't happen," while multi-agent's is "the payment and progress evidence
came back fine; the contract lookup specifically failed." That's a
qualitative auditability advantage independent of whatever the accuracy
numbers turn out to say — the honest framing SPEC.md §6 asks for is
"no measurable accuracy gain, but improved auditability and per-source
failure isolation" as an equally legitimate outcome, not a consolation
prize.

## What would change this analysis

- If `unsupportedClaimRate` and `evidenceCompletenessRate` come back
  statistically indistinguishable between single-agent and multi-agent,
  the honest conclusion is that a well-prompted single agent with three
  tools captures most of the value here, and the Supervisor/Audit split's
  case rests on auditability and cost transparency, not raw accuracy.
- If `conflictDetectionAccuracy` is where multi-agent actually pulls ahead
  (the single most likely scenario, given the design), that becomes the
  project's central, defensible claim — not "agents are better," but
  "structured decomposition catches contradictions between systems that
  one model juggling everything at once misses."
- If cost/latency overhead is far worse than the ~2-3x this document
  predicts, that's worth reporting too — it would mean the bounded-retry
  design in `src/supervisor/index.ts` isn't as bounded in practice as the
  code suggests, and the harness's own `avgLlmCalls` metric will catch it.
