/**
 * **The shared scenario table, run against the mock client.**
 *
 * `tests/fixtures/fieldLifecycleScenarios.json` is the single statement of what
 * the lifecycle and blackout RPCs must do. This file executes it against the
 * mock; `scripts/dbharness/scenarios.py` executes the SAME file against
 * Postgres from `npm run test:db:local`. Neither side is asserted against the
 * other -- both are asserted against the table -- so a fix that lands on one
 * implementation and not the other fails on the side it missed.
 *
 * That is the gap round 3 found. Round 2 fixed `admin_retire_field` and
 * `admin_unretire_field` in the SQL; both fixes were absent from the mock, and
 * one of them was CERTIFIED by a passing test asserting the wrong outcome. The
 * kind-literal contract test could not have caught it: literals are text in one
 * file, behaviour is PL/pgSQL on one side and JavaScript on the other.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

import { getMockData, mockSupabase as supabase } from '../frontend/src/lib/mockSupabaseClient.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TABLE = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'tests/fixtures/fieldLifecycleScenarios.json'), 'utf8')
);

const ORG = 'org-1';

/** Today, as the mock computes it, so an offset here matches one in the SQL. */
const today = () => new Date().toISOString().slice(0, 10);

/**
 * An offset in days from today, as `YYYY-MM-DD`. `null` stays null.
 *
 * @param {number|null} offset
 * @returns {string|null}
 */
const dateAt = (offset) => {
  if (offset === null || offset === undefined) return null;
  const d = new Date(`${today()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

const setMockSession = (userId) => {
  sessionStorage.setItem('__MOCK_SESSION__', JSON.stringify({ user: { id: userId } }));
};

let seq = 0;
/** A field in the seeded org, put into `before` state without going through an RPC. */
const fieldInState = async (before) => {
  seq += 1;
  const id = `scenario-field-${seq}`;
  const template = getMockData('fields').find((f) => String(f.organization_id) === ORG);
  expect(template).toBeDefined();
  await supabase.from('fields').insert({
    id,
    organization_id: ORG,
    location_id: template.location_id,
    name: `Scenario Pitch ${seq}`,
    active: before.active,
    effective_to: dateAt(before.effectiveTo),
  });
  const row = getMockData('fields').find((f) => String(f.id) === id);
  // The seeding really produced the state the scenario is about. Without this a
  // scenario whose `before` never landed would assert against whatever the
  // insert happened to do, and pass for the wrong reason.
  expect(row.active).toBe(before.active);
  expect(row.effective_to ?? null).toBe(dateAt(before.effectiveTo));
  return row;
};

describe('scenario table :: the table itself', () => {
  it('holds scenarios, and every one is shaped like a scenario', () => {
    // The meta-assertion. A table that failed to parse, or that lost its
    // entries, would make every `it.each` below run zero cases and the file
    // would pass green having asserted nothing at all.
    expect(TABLE.fieldScenarios.length).toBe(10);
    expect(TABLE.blackoutScenarios.length).toBe(9);
    const all = [...TABLE.fieldScenarios, ...TABLE.blackoutScenarios];
    expect(all.length).toBe(19);
    for (const scenario of all) {
      expect(typeof scenario.id).toBe('string');
      expect(scenario.why.length).toBeGreaterThan(10);
      expect(scenario.expect).toBeTypeOf('object');
      expect(typeof scenario.expect.ok).toBe('boolean');
    }
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
  });

  it('covers both outcomes on both halves, so neither is all-accept', () => {
    // A table of nothing but successes would be satisfied by an RPC that never
    // refuses; a table of nothing but refusals by one that never works.
    const outcomes = (list) => new Set(list.map((s) => s.expect.ok));
    expect(outcomes(TABLE.blackoutScenarios)).toEqual(new Set([true, false]));
    // The field half is all-accept by nature -- the retirement RPCs refuse on
    // bookings, which `fieldLifecycleRpcs.test.js` covers -- so what is
    // asserted here is that it exercises both ACTIVITY outcomes instead.
    const activities = new Set(TABLE.fieldScenarios.map((s) => s.expect.active));
    expect(activities).toEqual(new Set([true, false]));
  });
});

describe('scenario table :: the mock honours it', () => {
  beforeEach(() => {
    sessionStorage.clear();
    delete window.__MOCK_DB__;
    setMockSession('mock-admin-id');
  });

  it.each(TABLE.fieldScenarios.map((s) => [s.id, s]))('%s', async (_id, scenario) => {
    const field = await fieldInState(scenario.before);

    const args = { p_organization_id: ORG, p_field_id: field.id };
    if (scenario.rpc === 'admin_retire_field') {
      args.p_effective_to = dateAt(scenario.args.effectiveTo);
      args.p_confirm = Boolean(scenario.args.confirm);
    }
    const { data, error } = await supabase.rpc(scenario.rpc, args);
    expect(error).toBeNull();
    expect(data).not.toBeNull();

    const after = getMockData('fields').find((f) => String(f.id) === String(field.id));
    expect(after.active).toBe(scenario.expect.active);
    expect(after.effective_to ?? null).toBe(dateAt(scenario.expect.effectiveTo));

    // Both audit phases, on every accepted call. The SQL RPCs audit before AND
    // after; the mock recorded only `after`, and `admin_unretire_field`
    // recorded no `phase` at all -- so an audit reader could not tell an
    // unretire's record from a legacy one.
    const phases = getMockData('audit_log')
      .filter(
        (row) =>
          String(row.resource_id) === String(field.id) && row.metadata?.operation === scenario.rpc
      )
      .map((row) => row.metadata.phase)
      .sort();
    expect(phases).toEqual(['after', 'before']);
  });

  it.each(TABLE.blackoutScenarios.map((s) => [s.id, s]))('%s', async (_id, scenario) => {
    const field = getMockData('fields').find((f) => String(f.organization_id) === ORG);
    const scopes = {
      location: { p_location_id: field.location_id, p_field_id: null },
      field: { p_location_id: null, p_field_id: field.id },
      both: { p_location_id: field.location_id, p_field_id: field.id },
      neither: { p_location_id: null, p_field_id: null },
    };
    const scope = scopes[scenario.scope];
    // Every `switch` over a union throws on the value it does not know. A
    // scenario naming a scope this file has never heard of must stop the run,
    // not quietly test the field-scoped case.
    if (scope === undefined) throw new Error(`unknown scope "${scenario.scope}"`);

    const before = getMockData('field_blackouts').length;
    const { data, error } = await supabase.rpc('admin_create_field_blackout', {
      p_organization_id: ORG,
      ...scope,
      p_blackout_from: dateAt(scenario.args.from),
      p_blackout_until: dateAt(scenario.args.until),
      p_reason: scenario.args.reason ?? null,
      p_start_minutes: scenario.args.startMinutes ?? null,
      p_end_minutes: scenario.args.endMinutes ?? null,
      p_note: null,
    });

    const after = getMockData('field_blackouts').length;
    if (scenario.expect.ok) {
      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(after).toBe(before + 1);
      const phases = getMockData('audit_log')
        .filter((row) => row.metadata?.operation === 'admin_create_field_blackout')
        .map((row) => row.metadata.phase);
      expect(phases).toContain('before');
      expect(phases).toContain('after');
    } else {
      expect(error).not.toBeNull();
      // **Refused means nothing was written.** A refusal that half-applied
      // would be worse than no constraint at all.
      expect(after).toBe(before);
    }
  });
});
