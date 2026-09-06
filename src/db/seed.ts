import { pool } from './pool.js';

// Deterministic PRNG (mulberry32) so the synthetic dataset is reproducible
// across runs without vendoring a faker-style dependency.
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

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
function toDateStr(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const TODAY = new Date('2026-09-06');

type MilestoneStatus = 'not_started' | 'in_progress' | 'completed' | 'paid';

interface MilestoneTemplate {
  name: string;
  amountDue: number;
}

const MILESTONE_SEQUENCE: MilestoneTemplate[] = [
  { name: 'Sitework & Excavation', amountDue: 38000 },
  { name: 'Framing', amountDue: 52000 },
  { name: 'Drywall', amountDue: 42000 },
  { name: 'Electrical Rough-in', amountDue: 31000 },
  { name: 'Plumbing Rough-in', amountDue: 27000 },
  { name: 'Final Finish', amountDue: 46000 },
];

interface ProjectDef {
  name: string;
  clientName: string;
  zoneLabels: string[];
}

const PROJECTS: ProjectDef[] = [
  {
    name: 'Riverside Tower',
    clientName: 'Meridian Development',
    zoneLabels: ['Zone 1', 'Zone 2', 'Zone 3', 'Zone 4'],
  },
  {
    name: 'Harbor Point Logistics Center',
    clientName: 'Cascade Industrial Partners',
    zoneLabels: ['Zone A', 'Zone B', 'Zone C'],
  },
];

interface DocumentDef {
  projectName: string;
  type: 'contract' | 'policy';
  title: string;
  sourcePath: string;
}

const DOCUMENTS: DocumentDef[] = [
  {
    projectName: 'Riverside Tower',
    type: 'contract',
    title: 'Riverside Tower — Master Construction Contract',
    sourcePath: 'data/contracts/riverside-tower-master-contract.txt',
  },
  {
    projectName: 'Riverside Tower',
    type: 'policy',
    title: 'Riverside Tower — Inspection & Quality Assurance Policy',
    sourcePath: 'data/contracts/riverside-tower-inspection-policy.txt',
  },
  {
    projectName: 'Harbor Point Logistics Center',
    type: 'contract',
    title: 'Harbor Point — Master Construction Contract',
    sourcePath: 'data/contracts/harbor-point-master-contract.txt',
  },
  {
    projectName: 'Harbor Point Logistics Center',
    type: 'policy',
    title: 'Company-Wide Payment Terms & Retainage Policy',
    sourcePath: 'data/contracts/company-payment-policy.txt',
  },
];

const PROGRESS_NOTE_TEMPLATES = [
  'Crew completed scheduled work for {milestone} in {zone}. Site walkthrough performed.',
  'Materials delivered and staged for {milestone} in {zone}. Work proceeding on schedule.',
  'Subcontractor reported {milestone} substantially complete in {zone}; awaiting client sign-off.',
  'Weekly site visit: {milestone} progressing in {zone}, no issues noted.',
  'Punch list items identified for {milestone} in {zone}; crew addressing before close-out.',
];

function statusForDueDate(dueDate: Date): MilestoneStatus {
  const daysUntilDue = (dueDate.getTime() - TODAY.getTime()) / 86_400_000;
  if (daysUntilDue < -60) return rng() < 0.85 ? 'paid' : 'completed';
  if (daysUntilDue < -10) return rng() < 0.5 ? 'completed' : 'paid';
  if (daysUntilDue < 20) return 'in_progress';
  return 'not_started';
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Wipe existing data for a clean, reproducible reseed.
    await client.query(`
      TRUNCATE trace_steps, query_traces, project_access, users,
        doc_chunks, documents, progress_logs, payments, milestones, zones, projects
      RESTART IDENTITY CASCADE
    `);

    const projectIds = new Map<string, string>();
    const zoneIds = new Map<string, string>(); // key: `${projectName}::${zoneLabel}`
    const milestoneIds = new Map<string, string>(); // key: `${projectName}::${zoneLabel}::${milestoneName}`

    for (const project of PROJECTS) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO projects (name, client_name) VALUES ($1, $2) RETURNING id`,
        [project.name, project.clientName],
      );
      const projectId = rows[0].id;
      projectIds.set(project.name, projectId);

      for (const zoneLabel of project.zoneLabels) {
        const { rows: zoneRows } = await client.query<{ id: string }>(
          `INSERT INTO zones (project_id, label) VALUES ($1, $2) RETURNING id`,
          [projectId, zoneLabel],
        );
        const zoneId = zoneRows[0].id;
        zoneIds.set(`${project.name}::${zoneLabel}`, zoneId);

        for (let i = 0; i < MILESTONE_SEQUENCE.length; i++) {
          const template = MILESTONE_SEQUENCE[i];
          const jitter = Math.floor(rng() * 14) - 7;
          const dueDate = addDays(new Date('2026-02-01'), i * 35 + jitter);

          let status = statusForDueDate(dueDate);
          let amountDue = template.amountDue;

          // Flagship scenario (SPEC.md §3): Zone 3 Drywall is finished but
          // unpaid because inspection photos have not been submitted.
          const isFlagship =
            project.name === 'Riverside Tower' && zoneLabel === 'Zone 3' && template.name === 'Drywall';
          if (isFlagship) {
            status = 'completed';
            amountDue = 42000;
          }

          const { rows: msRows } = await client.query<{ id: string }>(
            `INSERT INTO milestones (zone_id, name, amount_due, status, due_date)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [zoneId, template.name, amountDue, status, toDateStr(dueDate)],
          );
          const milestoneId = msRows[0].id;
          milestoneIds.set(`${project.name}::${zoneLabel}::${template.name}`, milestoneId);

          if (status === 'paid') {
            await client.query(
              `INSERT INTO payments (milestone_id, amount_paid, paid_at, method) VALUES ($1, $2, $3, $4)`,
              [milestoneId, amountDue, toDateStr(addDays(dueDate, -3)), rng() < 0.5 ? 'ach' : 'check'],
            );
          } else if (status === 'completed' && !isFlagship && rng() < 0.3) {
            // A minority of completed-but-unpaid milestones carry a partial deposit.
            const partial = Math.round(amountDue * 0.4 * 100) / 100;
            await client.query(
              `INSERT INTO payments (milestone_id, amount_paid, paid_at, method) VALUES ($1, $2, $3, $4)`,
              [milestoneId, partial, toDateStr(addDays(dueDate, -20)), 'ach'],
            );
          }
          // Zone 3 Drywall intentionally has $0 paid — see flagship question.

          const logCount = 2 + Math.floor(rng() * 3);
          for (let j = 0; j < logCount; j++) {
            const entryDate = addDays(dueDate, -j * 6 - Math.floor(rng() * 4));
            const template_ = PROGRESS_NOTE_TEMPLATES[Math.floor(rng() * PROGRESS_NOTE_TEMPLATES.length)];
            const note = template_.replace('{milestone}', template.name).replace('{zone}', zoneLabel);
            const hasPhotos = rng() < 0.85;
            await client.query(
              `INSERT INTO progress_logs (zone_id, milestone_id, entry_date, note, has_inspection_photos)
               VALUES ($1, $2, $3, $4, $5)`,
              [zoneId, milestoneId, toDateStr(entryDate), note, hasPhotos],
            );
          }

          if (isFlagship) {
            await client.query(
              `INSERT INTO progress_logs (zone_id, milestone_id, entry_date, note, has_inspection_photos)
               VALUES ($1, $2, $3, $4, $5)`,
              [
                zoneId,
                milestoneId,
                toDateStr(dueDate),
                'Drywall installation complete throughout Zone 3. Contractor has not yet submitted ' +
                  'date-stamped inspection photographs for client sign-off; client site rep flagged ' +
                  'this as outstanding before payment can be processed.',
                false,
              ],
            );
          }
        }
      }
    }

    for (const doc of DOCUMENTS) {
      const projectId = projectIds.get(doc.projectName);
      if (!projectId) throw new Error(`Unknown project in DOCUMENTS: ${doc.projectName}`);
      await client.query(
        `INSERT INTO documents (project_id, type, title, source_path) VALUES ($1, $2, $3, $4)`,
        [projectId, doc.type, doc.title, doc.sourcePath],
      );
    }

    const { rows: adminRows } = await client.query<{ id: string }>(
      `INSERT INTO users (name, role) VALUES ($1, 'admin') RETURNING id`,
      ['Dana Whitfield'],
    );
    const { rows: pmRows } = await client.query<{ id: string }>(
      `INSERT INTO users (name, role) VALUES ($1, 'project_manager') RETURNING id`,
      ['Marcus Ibe'],
    );
    const { rows: contractorZone3Rows } = await client.query<{ id: string }>(
      `INSERT INTO users (name, role) VALUES ($1, 'contractor') RETURNING id`,
      ['Priya Nandakumar'],
    );
    const { rows: contractorZoneARows } = await client.query<{ id: string }>(
      `INSERT INTO users (name, role) VALUES ($1, 'contractor') RETURNING id`,
      ['Owen Castellano'],
    );

    const riversideId = projectIds.get('Riverside Tower')!;
    const harborId = projectIds.get('Harbor Point Logistics Center')!;

    await client.query(
      `INSERT INTO project_access (user_id, project_id, permission, zone_id) VALUES
         ($1, $2, 'full', NULL), ($1, $3, 'full', NULL),
         ($4, $2, 'full', NULL), ($4, $3, 'full', NULL)`,
      [adminRows[0].id, riversideId, harborId, pmRows[0].id],
    );

    // Priya is the Zone 3 contractor on Riverside Tower — used later for the
    // §9 cross-zone access test (she must never see Zone 1/2/4 or Harbor Point data).
    await client.query(
      `INSERT INTO project_access (user_id, project_id, permission, zone_id) VALUES ($1, $2, 'zone_restricted', $3)`,
      [contractorZone3Rows[0].id, riversideId, zoneIds.get('Riverside Tower::Zone 3')],
    );
    await client.query(
      `INSERT INTO project_access (user_id, project_id, permission, zone_id) VALUES ($1, $2, 'zone_restricted', $3)`,
      [contractorZoneARows[0].id, harborId, zoneIds.get('Harbor Point Logistics Center::Zone A')],
    );

    await client.query('COMMIT');

    const counts = await client.query(`
      SELECT
        (SELECT count(*) FROM projects) AS projects,
        (SELECT count(*) FROM zones) AS zones,
        (SELECT count(*) FROM milestones) AS milestones,
        (SELECT count(*) FROM payments) AS payments,
        (SELECT count(*) FROM progress_logs) AS progress_logs,
        (SELECT count(*) FROM documents) AS documents,
        (SELECT count(*) FROM users) AS users
    `);
    console.log('Seed complete:', counts.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
