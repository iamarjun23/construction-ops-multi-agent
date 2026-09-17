import { pool } from '../db/pool.js';
import { AccessContext, AccessDeniedError } from './types.js';

// SPEC.md §9: access control is enforced inside tools, not via prompt
// instructions. Every agent call must go through this to get a scoped
// context before touching payment/contract/progress data.
export async function loadAccessContext(userId: string, projectId: string): Promise<AccessContext> {
  const { rows: userRows } = await pool.query<{ role: AccessContext['role'] }>(
    `SELECT role FROM users WHERE id = $1`,
    [userId],
  );
  if (userRows.length === 0) throw new AccessDeniedError(`Unknown user: ${userId}`);

  const { rows: accessRows } = await pool.query<{ permission: string; zone_id: string | null }>(
    `SELECT permission, zone_id FROM project_access WHERE user_id = $1 AND project_id = $2`,
    [userId, projectId],
  );
  if (accessRows.length === 0) {
    throw new AccessDeniedError(`User ${userId} has no access to project ${projectId}`);
  }

  const hasFullAccess = accessRows.some((r) => r.permission === 'full');
  const allowedZoneIds = hasFullAccess
    ? ('all' as const)
    : accessRows.filter((r) => r.zone_id).map((r) => r.zone_id as string);

  return { userId, role: userRows[0].role, projectId, allowedZoneIds };
}
