import { runAuditAgent } from '../src/agents/audit-agent.js';
import { pool } from '../src/db/pool.js';
import { loadAccessContext } from '../src/tools/access.js';
import { paymentLookup } from '../src/tools/payment-lookup.js';
import { vectorSearch } from '../src/tools/vector-search.js';

// Demonstrates the SPEC.md acceptance criterion: "Audit Agent demonstrably
// catches at least one deliberately unsupported or conflicting claim."
//
// Builds a draft answer with one true claim (from real evidence) and one
// deliberately false claim that contradicts Article 4.2 of the Riverside
// Tower contract (withholding is capped at 30 days, not indefinite), then
// checks that runAuditAgent flags the false one. Requires ANTHROPIC_API_KEY
// and OPENAI_API_KEY to actually run — this is an LLM judgment call, not a
// deterministic unit test, so it lives under eval/ rather than tests/.
async function main() {
  const { rows: projectRows } = await pool.query<{ id: string }>(
    `SELECT id FROM projects WHERE name = 'Riverside Tower'`,
  );
  const { rows: userRows } = await pool.query<{ id: string }>(`SELECT id FROM users WHERE name = 'Dana Whitfield'`);
  const ctx = await loadAccessContext(userRows[0].id, projectRows[0].id);

  const payment = await paymentLookup(
    { intent: 'payment_status', projectId: ctx.projectId, zoneLabel: 'Zone 3', milestoneName: 'Drywall' },
    ctx,
  );
  const contract = await vectorSearch(
    { query: 'withholding payment for missing inspection photos', projectId: ctx.projectId },
    ctx,
  );
  const evidence = [...payment.evidence, ...contract.evidence];

  const deliberatelyFalseDraft =
    'The Zone 3 Drywall milestone is complete and $42,000.00 is owed to the contractor, since nothing ' +
    'has been paid yet. According to the contract, the client may withhold this payment indefinitely, ' +
    'with no time limit, until inspection photographs are submitted.';

  const audit = await runAuditAgent(deliberatelyFalseDraft, evidence);

  console.log('Claims checked:', audit.claims.length);
  for (const c of audit.claims) {
    console.log(
      `- [${c.supported ? 'SUPPORTED' : 'UNSUPPORTED'}] ${c.claim}` +
        (c.contradiction ? ` (contradiction: ${c.contradiction})` : ''),
    );
  }

  const caughtIt = audit.unsupportedClaims.some((c) =>
    /indefinite|no time limit|30|thirty/i.test(`${c.claim} ${c.contradiction ?? ''}`),
  );

  if (!caughtIt) {
    console.error('\nFAIL: Audit agent did not flag the deliberately false "withhold indefinitely" claim.');
    process.exitCode = 1;
  } else {
    console.log('\nPASS: Audit agent caught the deliberately unsupported claim.');
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
