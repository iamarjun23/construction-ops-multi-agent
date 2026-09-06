import { pool } from '../db/pool.js';
import { loadAccessContext } from '../tools/access.js';
import { answerQuestion } from './index.js';

async function main() {
  const question = process.argv[2];
  if (!question) {
    console.error('Usage: npm run agents:supervisor -- "your question" ["User Name"] ["Project Name"]');
    process.exit(1);
  }
  const userName = process.argv[3] ?? 'Dana Whitfield';
  const projectName = process.argv[4] ?? 'Riverside Tower';

  const { rows: userRows } = await pool.query<{ id: string }>(`SELECT id FROM users WHERE name = $1`, [userName]);
  const { rows: projectRows } = await pool.query<{ id: string }>(`SELECT id FROM projects WHERE name = $1`, [
    projectName,
  ]);
  if (userRows.length === 0) {
    console.error(`User not found: ${userName}`);
    process.exit(1);
  }
  if (projectRows.length === 0) {
    console.error(`Project not found: ${projectName}`);
    process.exit(1);
  }

  const ctx = await loadAccessContext(userRows[0].id, projectRows[0].id);
  const result = await answerQuestion(question, ctx);

  console.log('\n=== Trace ===');
  for (const step of result.trace) console.log(`[${step.agent}] ${step.message}`);
  console.log('\n=== Answer ===\n');
  console.log(result.answer);
  console.log('\n=== Evidence ===');
  for (const e of result.evidence) console.log(`- (${e.sourceType} ${e.sourceId}) ${e.content.slice(0, 120)}`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
