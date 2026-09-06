/**
 * **The retirement and blackout RPCs, against the mock client.**
 *
 * These pin the behaviour the SQL states, on the client the whole E2E suite
 * runs against. The database's own guarantees -- RLS, SECURITY DEFINER,
 * search_path, the CHECK constraints -- are asserted structurally in
 * `docs/sql/20260906000000_smoke.sql` and `..._20260906000100_smoke.sql`, since
 * they need a real session to exercise.
 *
 * The load-bearing one is the `active`/`effective_to` pair. PR 2 keeps both
 * columns deliberately, because the shipped scheduler filters on `active`
 * (`GameSchedulingPage.jsx:253`). Two columns saying one thing is a hazard, and
 * the way it is bounded is that nothing writes one without the other.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { mockSupabase as supabase, getMockData } from '../frontend/src/lib/mockSupabaseClient.js';

const ORG = 'org-1';

const setMockSession = (userId) => {
  sessionStorage.setItem('__MOCK_SESSION__', JSON.stringify({ user: { id: userId } }));
};

/** The first field of the seeded org, whatever it is. */
const someField = () => getMockData('fields').find((f) => String(f.organization_id) === ORG);

describe('field lifecycle RPCs :: retirement writes active and effective_to together', () => {
  beforeEach(() => {
    sessionStorage.clear();
    delete window.__MOCK_DB__;
    setMockSession('mock-admin-id');
  });

  it('retires a field with no affected bookings, setting both columns', async () => {
    const field = someField();
    expect(field).toBeDefined();
    // The precondition, asserted so the assertion after the call is about the
    // RPC rather than about a field that was already retired.
    expect(field.active).not.toBe(false);
    expect(field.effective_to ?? null).toBeNull();

    const { data, error } = await supabase.rpc('admin_retire_field', {
      p_organization_id: ORG,
      p_field_id: field.id,
      p_effective_to: '2099-12-31',
      p_confirm: false,
    });
    expect(error).toBeNull();
    expect(data.retired).toBe(true);

    const after = getMockData('fields').find((f) => String(f.id) === String(field.id));
    expect(after.effective_to).toBe('2099-12-31');
    expect(after.active).toBe(false);
  });

  it('never leaves active and effective_to disagreeing, after either RPC', async () => {
    // **The hazard check.** The pair is the reason `active` survived; this is
    // what bounds it. Asserted over every field in the org after a retire and
    // after an unretire, not just the one touched.
    const field = someField();
    const disagrees = (f) =>
      (f.effective_to !== null && f.effective_to !== undefined && f.active === true) ||
      (f.active === false && (f.effective_to === null || f.effective_to === undefined));

    await supabase.rpc('admin_retire_field', {
      p_organization_id: ORG,
      p_field_id: field.id,
      p_effective_to: '2099-12-31',
      p_confirm: true,
    });
    let all = getMockData('fields').filter((f) => String(f.organization_id) === ORG);
    expect(all.length).toBeGreaterThan(0);
    expect(all.filter(disagrees)).toEqual([]);

    await supabase.rpc('admin_unretire_field', {
      p_organization_id: ORG,
      p_field_id: field.id,
    });
    all = getMockData('fields').filter((f) => String(f.organization_id) === ORG);
    expect(all.filter(disagrees)).toEqual([]);
    const after = getMockData('fields').find((f) => String(f.id) === String(field.id));
    expect(after.active).toBe(true);
    expect(after.effective_to).toBeNull();

    // The predicate is not vacuous: a hand-built disagreement is caught.
    expect(disagrees({ active: true, effective_to: '2026-01-01' })).toBe(true);
    expect(disagrees({ active: false, effective_to: null })).toBe(true);
    expect(disagrees({ active: false, effective_to: '2026-01-01' })).toBe(false);
  });

  it('refuses, writes nothing, and names the affected bookings', async () => {
    // The refusal is in the RPC, not the UI: a confirmation a caller can skip
    // by calling the RPC directly is not a guard.
    const field = someField();
    const slots = getMockData('game_slots').filter(
      (s) => String(s.organization_id) === ORG && String(s.field_id) === String(field.id)
    );
    expect(slots.length).toBeGreaterThan(0);

    const { data, error } = await supabase.rpc('admin_retire_field', {
      p_organization_id: ORG,
      p_field_id: field.id,
      p_effective_to: '2000-01-01',
      p_confirm: false,
    });
    expect(error).toBeNull();
    expect(data.retired).toBe(false);
    expect(data.reason).toBe('bookings_after_effective_to');
    expect(data.affected_count).toBe(slots.length);
    expect(data.affected.length).toBe(slots.length);

    // **Nothing was written.** A refusal that half-applied would be worse than
    // no guard at all.
    const after = getMockData('fields').find((f) => String(f.id) === String(field.id));
    expect(after.effective_to ?? null).toBeNull();
    expect(after.active).not.toBe(false);
  });

  it('counts an undated booking as affected rather than dropping it', async () => {
    // `game_slots.start` is nullable. A slot with no start date cannot be
    // judged against the retirement date, and excluding it would retire ground
    // out from under a booking nobody was warned about.
    const field = someField();
    const db = getMockData('game_slots');
    const undated = {
      ...db[0],
      id: 'slot-undated',
      field_id: field.id,
      organization_id: ORG,
      start: null,
    };
    await supabase.from('game_slots').insert(undated);

    const { data } = await supabase.rpc('admin_retire_field', {
      p_organization_id: ORG,
      p_field_id: field.id,
      p_effective_to: '2099-12-31',
      p_confirm: false,
    });
    expect(data.retired).toBe(false);
    const carried = data.affected.find((a) => String(a.game_slot_id) === 'slot-undated');
    expect(carried).toBeDefined();
    expect(carried.undated).toBe(true);
  });
});

describe('field lifecycle RPCs :: blackouts are scoped to exactly one thing', () => {
  beforeEach(() => {
    sessionStorage.clear();
    delete window.__MOCK_DB__;
    setMockSession('mock-admin-id');
  });

  it('creates a field-scoped blackout', async () => {
    const field = someField();
    const { data, error } = await supabase.rpc('admin_create_field_blackout', {
      p_organization_id: ORG,
      p_location_id: null,
      p_field_id: field.id,
      p_blackout_from: '2026-08-01',
      p_blackout_until: '2026-08-31',
      p_reason: 'maintenance',
    });
    expect(error).toBeNull();
    expect(data.field_id).toBe(field.id);
    expect(data.location_id).toBeNull();
    expect(data.reason).toBe('maintenance');
    expect(getMockData('field_blackouts').length).toBe(1);
  });

  it('refuses a blackout scoped to both, or to neither', async () => {
    const field = someField();
    const both = await supabase.rpc('admin_create_field_blackout', {
      p_organization_id: ORG,
      p_location_id: field.location_id,
      p_field_id: field.id,
      p_blackout_from: '2026-08-01',
      p_blackout_until: '2026-08-31',
    });
    expect(both.error).not.toBeNull();

    const neither = await supabase.rpc('admin_create_field_blackout', {
      p_organization_id: ORG,
      p_location_id: null,
      p_field_id: null,
      p_blackout_from: '2026-08-01',
      p_blackout_until: '2026-08-31',
    });
    expect(neither.error).not.toBeNull();
    // Neither call wrote anything.
    expect(getMockData('field_blackouts').length).toBe(0);
  });

  it('refuses ground belonging to another organization', async () => {
    // The RPC is SECURITY DEFINER and bypasses RLS, so the scope check is the
    // only thing standing between an admin of one org and another org's ground.
    const { error } = await supabase.rpc('admin_create_field_blackout', {
      p_organization_id: ORG,
      p_location_id: null,
      p_field_id: 'a-field-that-is-not-in-this-org',
      p_blackout_from: '2026-08-01',
      p_blackout_until: '2026-08-31',
    });
    expect(error).not.toBeNull();
    expect(getMockData('field_blackouts').length).toBe(0);
  });

  it('deletes a blackout and refuses an unknown id', async () => {
    const field = someField();
    const { data: created } = await supabase.rpc('admin_create_field_blackout', {
      p_organization_id: ORG,
      p_location_id: null,
      p_field_id: field.id,
      p_blackout_from: '2026-08-01',
      p_blackout_until: '2026-08-31',
    });
    const { data, error } = await supabase.rpc('admin_delete_field_blackout', {
      p_organization_id: ORG,
      p_blackout_id: created.id,
    });
    expect(error).toBeNull();
    expect(data.deleted).toBe(true);
    expect(getMockData('field_blackouts').length).toBe(0);

    const missing = await supabase.rpc('admin_delete_field_blackout', {
      p_organization_id: ORG,
      p_blackout_id: 'no-such-blackout',
    });
    expect(missing.error).not.toBeNull();
  });
});
