/**
 * **What a field delete does to each booking, against the mock client.**
 *
 * `tests/fieldLifecycleScenarios.test.js` runs the shared table and pins the
 * RPC's OUTCOME -- refused or not, how many bookings, which disposition words.
 * This file pins what the mock then does to the ROWS, which is schema
 * behaviour rather than RPC outcome: `game_slots`, `practice_slots` and
 * `field_blackouts` cascade with the field, while `game_assignments.field_id`
 * and `practice_assignments.field_id` are set null so the booking survives
 * with its venue visibly gone.
 *
 * It matters because the mock is what the E2E suite and 8.4 PR 3's UI are
 * built against. Before this, a confirmed delete removed the field and its
 * blackouts here and left everything else pointing at it -- so the operation
 * looked harmless in the mock and lost a schedule in Postgres.
 *
 * The expected dispositions are read out of the migration rather than written
 * down here, for the same reason `fieldLifecycleRpcs.test.js` reads the kind
 * literals: a list copied from one of two arms agrees with whichever it was
 * copied from.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

import { getMockData, mockSupabase as supabase } from '../frontend/src/lib/mockSupabaseClient.js';

const ORG = 'org-1';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * `kind -> disposition`, parsed out of `admin_delete_field`'s union.
 *
 * @returns {Record<string, string>}
 */
const migrationDispositions = () => {
  const sql = readFileSync(
    path.join(REPO_ROOT, 'supabase/migrations/20260907000000_field_delete_booking_guard.sql'),
    'utf8'
  );
  const start = sql.indexOf('WITH affected AS (');
  const end = sql.indexOf('INTO v_affected');
  expect(start, 'the affected-booking union moved; this parse is stale').toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const arms = sql.slice(start, end).split('UNION ALL');
  // The meta-assertion. A parse that found no arms would produce an empty map
  // and every comparison below would pass by comparing nothing with nothing.
  expect(arms.length).toBe(4);
  /** @type {Record<string, string>} */
  const map = {};
  for (const arm of arms) {
    const kind = /'([a-z_]+)'::text/.exec(arm);
    const disposition = /'(deleted|unassigned)'::text/.exec(arm);
    expect(kind, `an arm of the union names no kind: ${arm.slice(0, 80)}`).not.toBeNull();
    expect(disposition, `arm ${kind?.[1]} names no disposition`).not.toBeNull();
    map[kind[1]] = disposition[1];
  }
  return map;
};

const setMockSession = (userId) => {
  sessionStorage.setItem('__MOCK_SESSION__', JSON.stringify({ user: { id: userId } }));
};

/** The first field of the seeded org, whatever it is. */
const someField = () => getMockData('fields').find((f) => String(f.organization_id) === ORG);

/** One booking of every kind on `fieldId`, with ids this file can look up again. */
const seedEveryKind = async (fieldId) => {
  await supabase.from('game_slots').insert({
    id: 'guard-game-slot',
    organization_id: ORG,
    field_id: fieldId,
    slot_date: '2099-06-01',
    week_index: 1,
  });
  await supabase.from('game_assignments').insert({
    id: 'guard-game-assignment',
    organization_id: ORG,
    field_id: fieldId,
    start: '2099-06-01T18:00:00.000Z',
    week_index: 1,
  });
  await supabase.from('practice_slots').insert({
    id: 'guard-practice-slot',
    organization_id: ORG,
    field_id: fieldId,
    day_of_week: 'mon',
    start_time: '18:00',
    end_time: '19:30',
    valid_until: '2099-06-30',
  });
  await supabase.from('practice_assignments').insert({
    id: 'guard-practice-assignment',
    organization_id: ORG,
    team_id: 'guard-team',
    field_id: fieldId,
    effective_date_range: '[2099-01-01,2099-12-31]',
  });
  // Each seed landed. A seed that silently failed would turn a refusal case
  // into an unbooked one, and it would pass for entirely the wrong reason.
  for (const [table, id] of [
    ['game_slots', 'guard-game-slot'],
    ['game_assignments', 'guard-game-assignment'],
    ['practice_slots', 'guard-practice-slot'],
    ['practice_assignments', 'guard-practice-assignment'],
  ]) {
    const row = getMockData(table).find((r) => String(r.id) === id);
    expect(row, `${id} did not land in ${table}`).toBeDefined();
    expect(String(row.field_id)).toBe(String(fieldId));
  }
};

const rowById = (table, id) => getMockData(table).find((r) => String(r.id) === id);

describe('field delete guard :: the mock agrees with the migration about consequences', () => {
  beforeEach(() => {
    sessionStorage.clear();
    delete window.__MOCK_DB__;
    setMockSession('mock-admin-id');
  });

  it('declares the disposition the migration declares, for every kind', async () => {
    const field = someField();
    await seedEveryKind(field.id);

    const { data, error } = await supabase.rpc('admin_delete_field', {
      p_organization_id: ORG,
      p_field_id: field.id,
    });
    expect(error).toBeNull();
    expect(data.deleted).toBe(false);

    const expected = migrationDispositions();
    // Four kinds in the map, and each one the mock reported matches it. The
    // seeded corpus may add bookings of its own to this field, so the check is
    // per row rather than on a count.
    expect(Object.keys(expected).sort()).toEqual([
      'game_assignment',
      'game_slot',
      'practice_assignment',
      'practice_slot',
    ]);
    const seen = new Set();
    for (const row of data.affected) {
      expect(
        expected[row.kind],
        `${row.kind} is not a kind the migration enumerates`
      ).toBeDefined();
      expect(row.disposition, `${row.kind} disposition`).toBe(expected[row.kind]);
      seen.add(row.kind);
    }
    // ... and every kind was actually exercised, so the loop cannot pass by
    // iterating a payload that happened to contain only slots.
    expect([...seen].sort()).toEqual([
      'game_assignment',
      'game_slot',
      'practice_assignment',
      'practice_slot',
    ]);
  });

  it('writes nothing at all when it refuses', async () => {
    const field = someField();
    await seedEveryKind(field.id);
    await supabase.rpc('admin_delete_field', { p_organization_id: ORG, p_field_id: field.id });

    expect(rowById('fields', field.id)).toBeDefined();
    expect(rowById('game_slots', 'guard-game-slot')).toBeDefined();
    expect(rowById('game_assignments', 'guard-game-assignment').field_id).toBe(field.id);
    expect(rowById('practice_slots', 'guard-practice-slot')).toBeDefined();
    expect(rowById('practice_assignments', 'guard-practice-assignment').field_id).toBe(field.id);
  });

  it('cascades the slot tables and unassigns the assignment tables when confirmed', async () => {
    const field = someField();
    await seedEveryKind(field.id);
    await supabase.rpc('admin_create_field_blackout', {
      p_organization_id: ORG,
      p_location_id: null,
      p_field_id: field.id,
      p_blackout_from: '2099-08-01',
      p_blackout_until: '2099-08-31',
    });
    expect(getMockData('field_blackouts').length).toBe(1);

    const { data } = await supabase.rpc('admin_delete_field', {
      p_organization_id: ORG,
      p_field_id: field.id,
      p_confirm: true,
    });
    expect(data.deleted).toBe(true);
    expect(rowById('fields', field.id)).toBeUndefined();

    // CASCADE: the row goes with the field.
    expect(rowById('game_slots', 'guard-game-slot')).toBeUndefined();
    expect(rowById('practice_slots', 'guard-practice-slot')).toBeUndefined();
    expect(getMockData('field_blackouts').length).toBe(0);

    // SET NULL: the booking survives, venueless. **This is the defect the
    // migration exists for.** practice_assignments.field_id had no foreign key
    // at all, so the uuid was left pointing at a row that no longer existed and
    // nothing downstream could tell it from a live venue.
    const game = rowById('game_assignments', 'guard-game-assignment');
    expect(game, 'the game assignment was destroyed rather than unassigned').toBeDefined();
    expect(game.field_id).toBeNull();
    const practice = rowById('practice_assignments', 'guard-practice-assignment');
    expect(practice, 'the practice assignment was destroyed rather than unassigned').toBeDefined();
    expect(practice.field_id).toBeNull();

    // Nothing anywhere still points at the field that is gone.
    for (const table of [
      'game_slots',
      'practice_slots',
      'game_assignments',
      'practice_assignments',
      'field_blackouts',
    ]) {
      const dangling = getMockData(table).filter((r) => String(r.field_id) === String(field.id));
      expect(dangling, `${table} still points at the deleted field`).toHaveLength(0);
    }
  });
});
