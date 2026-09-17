import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool.js';
import { loadAccessContext } from '../src/tools/access.js';
import { paymentLookup } from '../src/tools/payment-lookup.js';
import { progressLookup } from '../src/tools/progress-lookup.js';
import { AccessDeniedError } from '../src/tools/types.js';

// SPEC.md §9: "at least one automated test proving a contractor cannot
// retrieve another zone's payment or contract data, regardless of how the
// question is phrased." Different phrasings of the same underlying question
// map to different combinations of typed tool parameters (explicit zone,
// no zone filter, milestone-name-only, an outright wrong projectId), so
// this suite exercises every one of those shapes against the seeded DB.

let riversideId: string;
let harborId: string;
let zone3ContractorId: string; // Priya Nandakumar — Zone 3 only, Riverside Tower
let zoneAContractorId: string; // Owen Castellano — Zone A only, Harbor Point
let adminId: string; // Dana Whitfield — full access to both projects

beforeAll(async () => {
  const { rows: projects } = await pool.query<{ id: string; name: string }>(`SELECT id, name FROM projects`);
  riversideId = projects.find((p) => p.name === 'Riverside Tower')!.id;
  harborId = projects.find((p) => p.name === 'Harbor Point Logistics Center')!.id;

  const { rows: users } = await pool.query<{ id: string; name: string }>(`SELECT id, name FROM users`);
  zone3ContractorId = users.find((u) => u.name === 'Priya Nandakumar')!.id;
  zoneAContractorId = users.find((u) => u.name === 'Owen Castellano')!.id;
  adminId = users.find((u) => u.name === 'Dana Whitfield')!.id;
});

afterAll(async () => {
  await pool.end();
});

describe('loadAccessContext', () => {
  it('grants a zone-restricted contractor only their own zone', async () => {
    const ctx = await loadAccessContext(zone3ContractorId, riversideId);
    expect(ctx.allowedZoneIds).not.toBe('all');
    expect(ctx.allowedZoneIds).toHaveLength(1);
  });

  it('grants an admin full access', async () => {
    const ctx = await loadAccessContext(adminId, riversideId);
    expect(ctx.allowedZoneIds).toBe('all');
  });

  it('denies a user with no project_access row for that project outright', async () => {
    await expect(loadAccessContext(zone3ContractorId, harborId)).rejects.toThrow(AccessDeniedError);
  });
});

describe('paymentLookup — cross-zone access is blocked regardless of parameter shape', () => {
  it('returns zero rows when explicitly targeting a forbidden zone', async () => {
    const ctx = await loadAccessContext(zone3ContractorId, riversideId);
    const output = await paymentLookup({ intent: 'payment_status', projectId: riversideId, zoneLabel: 'Zone 1' }, ctx);
    expect(output.rows).toHaveLength(0);
  });

  it('scopes an unfiltered query to only the allowed zone, never leaking other zones', async () => {
    const ctx = await loadAccessContext(zone3ContractorId, riversideId);
    const output = await paymentLookup({ intent: 'milestone_status', projectId: riversideId }, ctx);
    expect(output.rows.length).toBeGreaterThan(0);
    expect(new Set(output.rows.map((r) => r.zoneLabel))).toEqual(new Set(['Zone 3']));
  });

  it('scopes a milestone-name-only query (no zone mentioned) to the allowed zone', async () => {
    const ctx = await loadAccessContext(zone3ContractorId, riversideId);
    // "Drywall" exists in every zone of this project — a milestone-only
    // filter must not surface Zone 1/2/4's Drywall rows.
    const output = await paymentLookup({ intent: 'payment_status', projectId: riversideId, milestoneName: 'Drywall' }, ctx);
    expect(output.rows.length).toBeGreaterThan(0);
    expect(output.rows.every((r) => r.zoneLabel === 'Zone 3')).toBe(true);
  });

  it('rejects a tool call whose projectId does not match the caller\'s resolved context', async () => {
    const ctx = await loadAccessContext(zone3ContractorId, riversideId);
    await expect(
      paymentLookup({ intent: 'payment_status', projectId: harborId }, ctx),
    ).rejects.toThrow(AccessDeniedError);
  });

  it('still returns the full picture for a full-access admin (regression guard)', async () => {
    const ctx = await loadAccessContext(adminId, riversideId);
    const output = await paymentLookup(
      { intent: 'payment_status', projectId: riversideId, zoneLabel: 'Zone 3', milestoneName: 'Drywall' },
      ctx,
    );
    expect(output.rows).toHaveLength(1);
    expect(output.rows[0].amountOwed).toBeGreaterThan(0);
  });
});

describe('progressLookup — cross-zone access is blocked regardless of parameter shape', () => {
  it('returns zero rows when explicitly targeting a forbidden zone', async () => {
    const ctx = await loadAccessContext(zone3ContractorId, riversideId);
    const output = await progressLookup({ projectId: riversideId, zoneLabel: 'Zone 2' }, ctx);
    expect(output.rows).toHaveLength(0);
  });

  it('scopes an unfiltered query to only the allowed zone', async () => {
    const ctx = await loadAccessContext(zone3ContractorId, riversideId);
    const output = await progressLookup({ projectId: riversideId }, ctx);
    expect(output.rows.length).toBeGreaterThan(0);
    expect(new Set(output.rows.map((r) => r.zoneLabel))).toEqual(new Set(['Zone 3']));
  });

  it('rejects a tool call for a project the caller has no access to at all', async () => {
    const ctx = await loadAccessContext(zoneAContractorId, harborId);
    await expect(progressLookup({ projectId: riversideId }, ctx)).rejects.toThrow(AccessDeniedError);
  });
});
