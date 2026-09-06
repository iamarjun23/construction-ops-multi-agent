import { pool } from '../db/pool.js';
import { AccessContext, AccessDeniedError, Evidence, PaymentLookupInput } from './types.js';

export interface MilestonePaymentRow {
  milestoneId: string;
  zoneLabel: string;
  milestoneName: string;
  amountDue: number;
  status: string;
  dueDate: string;
  totalPaid: number;
  amountOwed: number;
}

export interface PaymentLookupOutput {
  rows: MilestonePaymentRow[];
  evidence: Evidence[];
}

// Typed intent + parameters only, mapped to a parameterized query — never
// raw SQL (SPEC.md §8, §9). Zone-level access restriction is applied in the
// query itself, not filtered after the fact.
export async function paymentLookup(input: PaymentLookupInput, ctx: AccessContext): Promise<PaymentLookupOutput> {
  if (input.projectId !== ctx.projectId) {
    throw new AccessDeniedError("Tool called for a project outside the caller's scope");
  }
  if (ctx.allowedZoneIds !== 'all' && ctx.allowedZoneIds.length === 0) {
    return { rows: [], evidence: [] };
  }

  const params: unknown[] = [ctx.projectId];
  const conditions = ['z.project_id = $1'];

  if (input.zoneLabel) {
    params.push(input.zoneLabel);
    conditions.push(`z.label = $${params.length}`);
  }
  if (input.milestoneName) {
    params.push(input.milestoneName);
    conditions.push(`m.name ILIKE $${params.length}`);
  }
  if (ctx.allowedZoneIds !== 'all') {
    params.push(ctx.allowedZoneIds);
    conditions.push(`z.id = ANY($${params.length}::uuid[])`);
  }

  const { rows } = await pool.query<{
    milestone_id: string;
    zone_label: string;
    milestone_name: string;
    amount_due: string;
    status: string;
    due_date: string;
    total_paid: string | null;
  }>(
    `SELECT m.id AS milestone_id, z.label AS zone_label, m.name AS milestone_name,
            m.amount_due, m.status, m.due_date, COALESCE(SUM(p.amount_paid), 0) AS total_paid
     FROM milestones m
     JOIN zones z ON z.id = m.zone_id
     LEFT JOIN payments p ON p.milestone_id = m.id
     WHERE ${conditions.join(' AND ')}
     GROUP BY m.id, z.label, m.name, m.amount_due, m.status, m.due_date
     ORDER BY z.label, m.due_date`,
    params,
  );

  const result: MilestonePaymentRow[] = rows.map((r) => {
    const amountDue = Number(r.amount_due);
    const totalPaid = Number(r.total_paid ?? 0);
    return {
      milestoneId: r.milestone_id,
      zoneLabel: r.zone_label,
      milestoneName: r.milestone_name,
      amountDue,
      status: r.status,
      dueDate: r.due_date,
      totalPaid,
      amountOwed: Math.max(amountDue - totalPaid, 0),
    };
  });

  return {
    rows: result,
    evidence: result.map((r) => ({
      sourceId: r.milestoneId,
      sourceType: 'row',
      content:
        `${r.zoneLabel} — ${r.milestoneName}: status=${r.status}, amount_due=$${r.amountDue.toFixed(2)}, ` +
        `total_paid=$${r.totalPaid.toFixed(2)}, amount_owed=$${r.amountOwed.toFixed(2)}, due_date=${r.dueDate}`,
    })),
  };
}
