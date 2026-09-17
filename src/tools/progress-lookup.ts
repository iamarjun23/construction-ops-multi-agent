import { pool } from '../db/pool.js';
import { AccessContext, AccessDeniedError, Evidence, ProgressLookupInput } from './types.js';

export interface ProgressLogRow {
  id: string;
  zoneLabel: string;
  milestoneName: string | null;
  entryDate: string;
  note: string;
  hasInspectionPhotos: boolean;
}

export interface ProgressLookupOutput {
  rows: ProgressLogRow[];
  evidence: Evidence[];
}

// Progress logs are zone-scoped, so this is the other place (besides
// payment lookups) where a contractor's zone restriction actually bites.
export async function progressLookup(input: ProgressLookupInput, ctx: AccessContext): Promise<ProgressLookupOutput> {
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
    id: string;
    zone_label: string;
    milestone_name: string | null;
    entry_date: string;
    note: string;
    has_inspection_photos: boolean;
  }>(
    `SELECT pl.id, z.label AS zone_label, m.name AS milestone_name, pl.entry_date, pl.note, pl.has_inspection_photos
     FROM progress_logs pl
     JOIN zones z ON z.id = pl.zone_id
     LEFT JOIN milestones m ON m.id = pl.milestone_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY pl.entry_date DESC`,
    params,
  );

  const result: ProgressLogRow[] = rows.map((r) => ({
    id: r.id,
    zoneLabel: r.zone_label,
    milestoneName: r.milestone_name,
    entryDate: r.entry_date,
    note: r.note,
    hasInspectionPhotos: r.has_inspection_photos,
  }));

  return {
    rows: result,
    evidence: result.map((r) => ({
      sourceId: r.id,
      sourceType: 'row',
      specialist: 'progress',
      content: `${r.zoneLabel}${r.milestoneName ? ' — ' + r.milestoneName : ''} (${r.entryDate}): ${r.note} [inspection photos: ${r.hasInspectionPhotos ? 'yes' : 'no'}]`,
    })),
  };
}
