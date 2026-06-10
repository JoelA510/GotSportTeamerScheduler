/**
 * Pure helper coverage (project-hardening PR 08 review hardening): buildPayloadByDivision builds a
 * newest-wins, per-division { teamRows, teamPlayerRows } map so a re-run of any previously-persisted
 * division — not just the single most-recent one — finds its teams. Null team ids must not bucket
 * stray player rows.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  buildPayloadByDivision,
  resolveTeamRunDivision,
  selectLatestTeamRunsPerDivision,
} from '../frontend/src/utils/schedulerRunFilters.js';

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

test('resolveTeamRunDivision: selectedProgramId wins, then first team with a division key', () => {
  assert.equal(
    resolveTeamRunDivision({ parameters: { selectedProgramId: 'U10' }, results: { teams: [] } }),
    'U10'
  );
  // Empty-string selectedProgramId falls through (mirrors SQL NULLIF(...,'')).
  assert.equal(
    resolveTeamRunDivision({
      parameters: { selectedProgramId: '  ' },
      results: { teams: [{ division: 'U12' }] },
    }),
    'U12'
  );
  // First team lacking a key is skipped; a later team's division_id resolves.
  assert.equal(
    resolveTeamRunDivision({ results: { teams: [{ id: 'x' }, { division_id: 'div-uuid' }] } }),
    'div-uuid'
  );
  assert.equal(resolveTeamRunDivision({ results: { teams: [{ id: 'x' }] } }), null);
  assert.equal(resolveTeamRunDivision(undefined), null);
});

test('selectLatestTeamRunsPerDivision: newest per division, empty runs skipped', () => {
  const rows = selectLatestTeamRunsPerDivision([
    // older U10
    { id: 'u10-old', created_at: '2026-06-01', results: { teams: [{ division: 'U10' }] } },
    // newer U10 wins
    { id: 'u10-new', created_at: '2026-06-03', results: { teams: [{ division: 'U10' }] } },
    // a newer FAILED U10 attempt with no teams must NOT shadow u10-new
    { id: 'u10-empty', created_at: '2026-06-04', results: {} },
    // a different division is also returned
    { id: 'u12', created_at: '2026-06-02', results: { teams: [{ division: 'U12' }] } },
  ]);
  const byId = Object.fromEntries(rows.map((r) => [r.division, r.id]));
  assert.equal(byId.U10, 'u10-new', 'newest non-empty U10 run wins');
  assert.equal(byId.U12, 'u12');
  assert.equal(rows.length, 2, 'the empty run produced no division row');
  // Returned newest-first.
  assert.deepEqual(
    rows.map((r) => r.id),
    ['u10-new', 'u12']
  );
});

test('selectLatestTeamRunsPerDivision: tolerates missing/non-array input', () => {
  assert.deepEqual(selectLatestTeamRunsPerDivision(undefined), []);
  assert.deepEqual(selectLatestTeamRunsPerDivision([{}, { results: { teams: [] } }]), []);
});
