/**
 * Pure helper coverage (project-hardening PR 08 review hardening): buildPayloadByDivision builds a
 * newest-wins, per-division { teamRows, teamPlayerRows } map so a re-run of any previously-persisted
 * division — not just the single most-recent one — finds its teams. Null team ids must not bucket
 * stray player rows.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { buildPayloadByDivision } from '../frontend/src/utils/schedulerRunFilters.js';

test('buildPayloadByDivision returns an empty map for missing / malformed runs', () => {
  assert.deepEqual(buildPayloadByDivision(undefined), {});
  assert.deepEqual(buildPayloadByDivision([]), {});
  assert.deepEqual(buildPayloadByDivision([{}, { results: {} }]), {});
});

test('buildPayloadByDivision groups each division and scopes its player rows', () => {
  const runs = [
    {
      results: {
        teams: [
          { id: 'tA', division: 'U10' },
          { id: 'tB', division: 'U10' },
        ],
        team_players: [
          { team_id: 'tA', player_id: 'p1' },
          { team_id: 'tB', player_id: 'p2' },
          { team_id: 'tOther', player_id: 'pX' }, // belongs to no kept team
        ],
      },
    },
  ];
  const byDivision = buildPayloadByDivision(runs);
  assert.deepEqual(Object.keys(byDivision), ['U10']);
  assert.deepEqual(
    byDivision.U10.teamRows.map((t) => t.id),
    ['tA', 'tB']
  );
  assert.deepEqual(
    byDivision.U10.teamPlayerRows.map((r) => r.player_id),
    ['p1', 'p2'],
    'only rows for kept teams are included'
  );
});

test('buildPayloadByDivision keeps the newest run per division and spans divisions across runs', () => {
  const runs = [
    // newest first
    {
      results: {
        teams: [{ id: 'u10-new', division: 'U10' }],
        team_players: [{ team_id: 'u10-new', player_id: 'np' }],
      },
    },
    {
      results: {
        teams: [{ id: 'u12', division: 'U12' }],
        team_players: [{ team_id: 'u12', player_id: 'qp' }],
      },
    },
    {
      results: {
        teams: [{ id: 'u10-old', division: 'U10' }],
        team_players: [{ team_id: 'u10-old', player_id: 'op' }],
      },
    },
  ];
  const byDivision = buildPayloadByDivision(runs);
  assert.deepEqual(
    byDivision.U10.teamRows.map((t) => t.id),
    ['u10-new'],
    'newest U10 run wins'
  );
  assert.deepEqual(
    byDivision.U10.teamPlayerRows.map((r) => r.player_id),
    ['np']
  );
  assert.deepEqual(
    byDivision.U12.teamRows.map((t) => t.id),
    ['u12'],
    'an older division (U12) is still captured'
  );
});

test('buildPayloadByDivision does not bucket player rows under a null/undefined team id', () => {
  const runs = [
    {
      results: {
        teams: [{ id: null, division: 'U10' }], // a team row missing its id
        team_players: [
          { team_id: null, player_id: 'ghost' }, // must NOT match a null id in the set
          { team_id: undefined, player_id: 'ghost2' },
        ],
      },
    },
  ];
  const byDivision = buildPayloadByDivision(runs);
  assert.deepEqual(byDivision.U10.teamPlayerRows, [], 'no rows matched a null/undefined team id');
});
