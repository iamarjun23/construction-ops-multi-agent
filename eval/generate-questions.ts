import { readFileSync, writeFileSync } from 'node:fs';
import { pool } from '../src/db/pool.js';
import type { EvalQuestion } from './types.js';

// Generates the Phase 5 evaluation set (SPEC.md §12: 60-100 questions) from
// the live seeded DB rather than hand-authoring them, so every payment/
// progress fact attached to a question is verifiably true at generation
// time — not a guess. Contract-only facts are hand-pinned since they come
// from free-text contract clauses, not DB rows.

function mulberry32(seed: number) {
  let s = seed;
  return function rand(): number {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260906);

interface MilestoneRow {
  milestone_id: string;
  project_name: string;
  zone_label: string;
  milestone_name: string;
  amount_due: string;
  status: string;
  due_date: string;
  total_paid: string;
}

interface ProgressRow {
  milestone_id: string;
  has_inspection_photos: boolean;
  note: string;
  entry_date: string;
}

const PAYMENT_TEMPLATES = [
  (zone: string, milestone: string) => `What is the payment status of the ${milestone} milestone in ${zone}?`,
  (zone: string, milestone: string) => `Has the ${zone} contractor been paid for ${milestone}?`,
  (zone: string, milestone: string) => `How much is still owed for ${milestone} in ${zone}?`,
  (zone: string, milestone: string) => `Is the ${milestone} milestone in ${zone} fully paid?`,
];

const PROGRESS_TEMPLATES = [
  (zone: string, milestone: string) => `Have inspection photos been submitted for ${milestone} in ${zone}?`,
  (zone: string, milestone: string) => `What do the progress logs show for ${milestone} in ${zone}?`,
  (zone: string, milestone: string) =>
    `Is there any indication that ${milestone} work in ${zone} is behind schedule or incomplete?`,
];

const COMPOUND_TEMPLATES = [
  (zone: string) =>
    `Is the ${zone} contractor owed payment for the drywall milestone, and according to the contract, ` +
    `can the client withhold payment because inspection photos are missing?`,
  (zone: string) =>
    `Given the progress logs and payment records for drywall in ${zone}, is the client currently ` +
    `justified in withholding payment under the contract?`,
];

const CONTRACT_ONLY_QUESTIONS: Omit<EvalQuestion, 'id'>[] = [
  {
    type: 'contract_only',
    project: 'Riverside Tower',
    question: 'What does the Riverside Tower contract say about retainage withheld from milestone payments?',
    expectedSpecialists: ['contract'],
    hints: ['5% retainage', 'released upon Final Finish milestone acceptance', 'Article 6.3'],
  },
  {
    type: 'contract_only',
    project: 'Riverside Tower',
    question:
      "How many calendar days can Riverside Tower's client withhold payment for a milestone missing " +
      'inspection photographs before the dispute process applies?',
    expectedSpecialists: ['contract'],
    hints: ['30 calendar days', 'Article 4.2', 'Article 5 dispute resolution'],
  },
  {
    type: 'contract_only',
    project: 'Riverside Tower',
    question:
      'Within how many business days of a milestone being marked complete does payment become due ' +
      'under the Riverside Tower contract?',
    expectedSpecialists: ['contract'],
    hints: ['15 business days', 'Article 2.2', 'subject to Article 4.2 withholding'],
  },
  {
    type: 'contract_only',
    project: 'Riverside Tower',
    question: 'What must the Contractor submit before payment is released for a concealment milestone like Drywall?',
    expectedSpecialists: ['contract'],
    hints: ['date-stamped inspection photographs', 'Article 4.2'],
  },
  {
    type: 'contract_only',
    project: 'Riverside Tower',
    question: "What happens if the Contractor's inspection photographs reveal non-conforming work?",
    expectedSpecialists: ['contract'],
    hints: ['written notice within five business days', 'Article 4.3', 'milestone not complete until cured'],
  },
  {
    type: 'contract_only',
    project: 'Riverside Tower',
    question: 'What is the first step in resolving a dispute over withheld payment under the Riverside Tower contract?',
    expectedSpecialists: ['contract'],
    hints: ['joint meeting of project managers', 'within 10 business days', 'Article 5.1'],
  },
  {
    type: 'contract_only',
    project: 'Harbor Point Logistics Center',
    question:
      "How many calendar days can Harbor Point's client withhold payment for a milestone missing " +
      'inspection photographs?',
    expectedSpecialists: ['contract'],
    hints: ['45 calendar days', 'Article 4.2', 'differs from Riverside Tower\'s 30-day cap'],
  },
  {
    type: 'contract_only',
    project: 'Harbor Point Logistics Center',
    question:
      'Within how many business days of milestone completion does payment become due under the Harbor ' +
      'Point contract?',
    expectedSpecialists: ['contract'],
    hints: ['20 business days', 'Article 2.2'],
  },
  {
    type: 'contract_only',
    project: 'Harbor Point Logistics Center',
    question: 'What retainage percentage applies across all projects per the company-wide payment policy?',
    expectedSpecialists: ['contract'],
    hints: ['5% retainage', 'company-wide policy'],
  },
  {
    type: 'contract_only',
    project: 'Riverside Tower',
    question: "Does the company-wide payment policy allow withholding payment beyond what a project's own contract permits?",
    expectedSpecialists: ['contract'],
    hints: ['no — the project contract controls', 'policy does not independently authorize withholding'],
  },
];

async function main() {
  const { rows: milestones } = await pool.query<MilestoneRow>(`
    SELECT m.id AS milestone_id, p.name AS project_name, z.label AS zone_label, m.name AS milestone_name,
           m.amount_due, m.status, m.due_date, COALESCE(SUM(pay.amount_paid), 0) AS total_paid
    FROM milestones m
    JOIN zones z ON z.id = m.zone_id
    JOIN projects p ON p.id = z.project_id
    LEFT JOIN payments pay ON pay.milestone_id = m.id
    GROUP BY m.id, p.name, z.label, m.name, m.amount_due, m.status, m.due_date
    ORDER BY p.name, z.label, m.due_date
  `);

  const { rows: progressLogs } = await pool.query<ProgressRow>(`
    SELECT milestone_id, has_inspection_photos, note, entry_date
    FROM progress_logs
    ORDER BY entry_date DESC
  `);
  const progressByMilestone = new Map<string, ProgressRow[]>();
  for (const row of progressLogs) {
    const list = progressByMilestone.get(row.milestone_id) ?? [];
    list.push(row);
    progressByMilestone.set(row.milestone_id, list);
  }

  const questions: EvalQuestion[] = [];
  let idCounter = 0;
  const nextId = (prefix: string) => `${prefix}-${String(++idCounter).padStart(3, '0')}`;

  milestones.forEach((m, i) => {
    const amountDue = Number(m.amount_due);
    const totalPaid = Number(m.total_paid);
    const amountOwed = Math.max(amountDue - totalPaid, 0);

    if (i % 2 === 0) {
      const template = PAYMENT_TEMPLATES[Math.floor(rng() * PAYMENT_TEMPLATES.length)];
      questions.push({
        id: nextId('payment'),
        type: 'payment_only',
        project: m.project_name,
        question: template(m.zone_label, m.milestone_name),
        expectedSpecialists: ['payment'],
        facts: {
          zoneLabel: m.zone_label,
          milestoneName: m.milestone_name,
          amountDue,
          status: m.status,
          totalPaid,
          amountOwed,
        },
      });
    } else {
      const template = PROGRESS_TEMPLATES[Math.floor(rng() * PROGRESS_TEMPLATES.length)];
      const logs = progressByMilestone.get(m.milestone_id) ?? [];
      questions.push({
        id: nextId('progress'),
        type: 'progress_only',
        project: m.project_name,
        question: template(m.zone_label, m.milestone_name),
        expectedSpecialists: ['progress'],
        facts: {
          zoneLabel: m.zone_label,
          milestoneName: m.milestone_name,
          logCount: logs.length,
          allHaveInspectionPhotos: logs.length > 0 && logs.every((l) => l.has_inspection_photos),
          anyMissingInspectionPhotos: logs.some((l) => !l.has_inspection_photos),
        },
      });
    }
  });

  for (const q of CONTRACT_ONLY_QUESTIONS) {
    questions.push({ id: nextId('contract'), ...q });
  }

  const drywallMilestones = milestones.filter((m) => m.milestone_name === 'Drywall');
  for (const m of drywallMilestones) {
    const amountDue = Number(m.amount_due);
    const totalPaid = Number(m.total_paid);
    const amountOwed = Math.max(amountDue - totalPaid, 0);
    const logs = progressByMilestone.get(m.milestone_id) ?? [];
    const missingPhotos = logs.some((l) => !l.has_inspection_photos);
    // Genuine tension only when the milestone is actually done, money is
    // actually outstanding, AND photos are actually missing — matches the
    // flagship scenario's logic exactly, not a guess.
    const expectedConflict = m.status === 'completed' && amountOwed > 0 && missingPhotos;

    for (const template of COMPOUND_TEMPLATES) {
      questions.push({
        id: nextId('compound'),
        type: 'compound',
        project: m.project_name,
        question: template(m.zone_label),
        expectedSpecialists: ['payment', 'contract', 'progress'],
        facts: { zoneLabel: m.zone_label, status: m.status, amountDue, totalPaid, amountOwed, missingPhotos },
        hints: [
          m.project_name === 'Riverside Tower'
            ? 'Article 4.2 permits withholding for up to 30 calendar days from completion'
            : 'Article 4.2 permits withholding for up to 45 calendar days from completion',
          'never state that withholding "is legally valid" — only what the contract permits',
        ],
        expectedConflict,
      });
    }
  }

  const questionsPath = new URL('./questions.json', import.meta.url);
  const existing = JSON.parse(readFileSync(questionsPath, 'utf8'));
  existing.generated_at = new Date().toISOString();
  existing.questions = questions;
  writeFileSync(questionsPath, JSON.stringify(existing, null, 2) + '\n');

  console.log(
    `Generated ${questions.length} questions: ` +
      `${questions.filter((q) => q.type === 'payment_only').length} payment_only, ` +
      `${questions.filter((q) => q.type === 'progress_only').length} progress_only, ` +
      `${questions.filter((q) => q.type === 'contract_only').length} contract_only, ` +
      `${questions.filter((q) => q.type === 'compound').length} compound ` +
      `(${questions.filter((q) => q.expectedConflict).length} with a genuine conflict).`,
  );

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
