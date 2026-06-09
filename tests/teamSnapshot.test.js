import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  normalizeExistingSnapshot,
  indexTeamSnapshot,
  SNAPSHOT_STATUSES,
} from '../packages/core/src/teamSnapshot.js';

test('SNAPSHOT_STATUSES lists the lifecycle statuses in order', () => {
  assert.deepEqual(SNAPSHOT_STATUSES, ['draft', 'review', 'published', 'locked']);
});

test('normalizeExistingSnapshot normalizes a minimal valid snapshot', () => {
  const result = normalizeExistingSnapshot({
    status: 'review',
    runId: 'run-9',
    teamsByDivision: {
      U10: [{ id: 'team-1', division: 'U10', players: [{ id: 'p1' }] }],
    },
  });

  assert.equal(result.status, 'review');
  assert.equal(result.runId, 'run-9');
  const team = result.teamsByDivision.U10[0];
  assert.equal(team.id, 'team-1');
  assert.equal(team.division, 'U10');
  assert.equal(team.coachId, null);
  assert.deepEqual(team.assistantCoachIds, []);
  assert.equal(team.locked, false);
  assert.deepEqual(team.players, [{ id: 'p1', assignment_source: 'auto', locked: false }]);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.orphanedPlayers, []);
});

test('indexTeamSnapshot indexes teams by id and players by id', () => {
  const normalized = normalizeExistingSnapshot({
    teamsByDivision: {
      U10: [
        {
          id: 'team-1',
          division: 'U10',
          coachId: 'coach-1',
          players: [{ id: 'p1', assignment_source: 'manual' }],
        },
        { id: 'team-2', division: 'U10', players: [{ id: 'p2' }] },
      ],
    },
  });
  const index = indexTeamSnapshot(normalized);

  assert.equal(index.teamsById['team-1'].coachId, 'coach-1');
  assert.equal(index.teamsById['team-2'].id, 'team-2');
  assert.equal(index.teamIdByPlayerId.p1, 'team-1');
  assert.equal(index.teamIdByPlayerId.p2, 'team-2');
  assert.equal(index.playersById.p1.assignment_source, 'manual');
  assert.equal(index.playersById.p1.division, 'U10');
  assert.deepEqual(index.divisions, ['U10']);
});

test('normalizeExistingSnapshot emits a diagnostic for duplicate player ids across teams', () => {
  const result = normalizeExistingSnapshot({
    teamsByDivision: {
      U10: [
        { id: 'team-1', division: 'U10', players: [{ id: 'dup' }] },
        { id: 'team-2', division: 'U10', players: [{ id: 'dup' }] },
      ],
    },
  });

  const duplicate = result.diagnostics.find((d) => d.code === 'duplicate-player-id');
  assert.ok(duplicate, 'expected a duplicate-player-id diagnostic');
  assert.match(duplicate.message, /dup/);
});

test('normalizeExistingSnapshot emits a diagnostic for team division mismatch', () => {
  const result = normalizeExistingSnapshot({
    teamsByDivision: {
      U10: [{ id: 'team-1', division: 'U12', players: [] }],
    },
  });

  const mismatch = result.diagnostics.find((d) => d.code === 'team-division-mismatch');
  assert.ok(mismatch, 'expected a team-division-mismatch diagnostic');
  // The grouping key is authoritative for placement.
  assert.equal(result.teamsByDivision.U10[0].division, 'U10');
});

test('normalizeExistingSnapshot treats null/undefined/non-object as an empty snapshot', () => {
  for (const input of [null, undefined]) {
    const result = normalizeExistingSnapshot(input);
    assert.deepEqual(result.teamsByDivision, {});
    assert.equal(result.runId, null);
    assert.equal(result.status, 'draft');
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(result.orphanedPlayers, []);
  }

  const bad = normalizeExistingSnapshot(42);
  assert.deepEqual(bad.teamsByDivision, {});
  assert.ok(bad.diagnostics.some((d) => d.code === 'invalid-snapshot'));
});

test('normalizeExistingSnapshot normalizes the relational persistence/review payload shape', () => {
  const result = normalizeExistingSnapshot({
    lastRunId: 'run-3',
    runHistory: [{ status: 'review' }],
    payload: {
      teamRows: [{ id: 'uuid-1', division: 'U10', name: 'Raptors', coach_id: 'coach-1' }],
      teamPlayerRows: [
        { team_id: 'uuid-1', player_id: 'p1', role: 'player', source: 'manual' },
        { team_id: 'uuid-1', player_id: 'asst-1', role: 'assistant_coach', source: 'auto' },
      ],
    },
  });

  assert.equal(result.status, 'review');
  assert.equal(result.runId, 'run-3');
  const team = result.teamsByDivision.U10[0];
  assert.equal(team.id, 'uuid-1');
  assert.equal(team.name, 'Raptors');
  assert.equal(team.coachId, 'coach-1');
  assert.deepEqual(team.assistantCoachIds, ['asst-1']);
  assert.deepEqual(team.players, [{ id: 'p1', assignment_source: 'manual', locked: false }]);
});

test('normalizeExistingSnapshot flags orphaned player rows that reference a missing team', () => {
  const result = normalizeExistingSnapshot({
    payload: {
      teamRows: [{ id: 'team-1', division: 'U10' }],
      teamPlayerRows: [
        { team_id: 'ghost-team', player_id: 'lost', role: 'player', source: 'auto' },
      ],
    },
  });

  assert.deepEqual(result.orphanedPlayers, [{ playerId: 'lost', teamId: 'ghost-team' }]);
  assert.ok(result.diagnostics.some((d) => d.code === 'orphaned-player-row'));
});

test('normalizeExistingSnapshot preserves a per-player locked flag', () => {
  const result = normalizeExistingSnapshot({
    teamsByDivision: {
      U10: [{ id: 'team-1', division: 'U10', players: [{ id: 'p1', locked: true }] }],
    },
  });

  assert.equal(result.teamsByDivision.U10[0].players[0].locked, true);
});

test('normalizeExistingSnapshot keeps a relational head-coach row out of the roster', () => {
  const result = normalizeExistingSnapshot({
    payload: {
      teamRows: [{ id: 'team-1', division: 'U10', coach_id: 'c1' }],
      teamPlayerRows: [
        { team_id: 'team-1', player_id: 'c1', role: 'coach', source: 'auto' },
        { team_id: 'team-1', player_id: 'p1', role: 'player', source: 'auto' },
      ],
    },
  });

  assert.deepEqual(
    result.teamsByDivision.U10[0].players.map((p) => p.id),
    ['p1']
  );
});

test('normalizeExistingSnapshot falls through to payload.teamRows when teamsByDivision is empty', () => {
  const result = normalizeExistingSnapshot({
    teamsByDivision: {},
    payload: {
      teamRows: [{ id: 't1', division: 'U10' }],
      teamPlayerRows: [{ team_id: 't1', player_id: 'p1', role: 'player', source: 'auto' }],
    },
  });

  assert.ok(result.teamsByDivision.U10, 'the relational payload is not silently dropped');
  assert.equal(result.teamsByDivision.U10[0].id, 't1');
});

test('normalizeExistingSnapshot resolves assignment_source consistently across input shapes', () => {
  // assignment_source wins over a conflicting source in BOTH normalization paths.
  const fromDesign = normalizeExistingSnapshot({
    teamsByDivision: {
      U10: [
        {
          id: 't1',
          division: 'U10',
          players: [{ id: 'p1', assignment_source: 'manual', source: 'auto' }],
        },
      ],
    },
  });
  const fromRelational = normalizeExistingSnapshot({
    payload: {
      teamRows: [{ id: 't1', division: 'U10' }],
      teamPlayerRows: [
        { team_id: 't1', player_id: 'p1', assignment_source: 'manual', source: 'auto' },
      ],
    },
  });

  assert.equal(fromDesign.teamsByDivision.U10[0].players[0].assignment_source, 'manual');
  assert.equal(fromRelational.teamsByDivision.U10[0].players[0].assignment_source, 'manual');
});

test('indexTeamSnapshot returns empty lookups for a null/undefined snapshot', () => {
  for (const input of [null, undefined]) {
    const index = indexTeamSnapshot(input);
    assert.deepEqual(index.teamsById, {});
    assert.deepEqual(index.playersById, {});
    assert.deepEqual(index.teamIdByPlayerId, {});
    assert.deepEqual(index.divisions, []);
  }
});

test('normalizeExistingSnapshot merges assistants from a team row assistant_coach_ids column', () => {
  const result = normalizeExistingSnapshot({
    payload: {
      teamRows: [
        { id: 't1', division: 'U10', coach_id: 'c1', assistant_coach_ids: ['asst-row-1'] },
      ],
      teamPlayerRows: [
        { team_id: 't1', player_id: 'asst-role-1', role: 'assistant_coach', source: 'auto' },
        { team_id: 't1', player_id: 'p1', role: 'player', source: 'auto' },
      ],
    },
  });

  const team = result.teamsByDivision.U10[0];
  assert.deepEqual(team.assistantCoachIds.sort(), ['asst-role-1', 'asst-row-1']);
  assert.deepEqual(
    team.players.map((p) => p.id),
    ['p1']
  );
});

test('normalizeExistingSnapshot maps division_id to a generator key via divisionKeyById', () => {
  const mapped = normalizeExistingSnapshot(
    {
      payload: {
        teamRows: [{ id: 't1', division_id: 'uuid-div-10' }],
        teamPlayerRows: [{ team_id: 't1', player_id: 'p1', role: 'player', source: 'auto' }],
      },
    },
    { divisionKeyById: { 'uuid-div-10': 'U10' } }
  );
  assert.ok(mapped.teamsByDivision.U10, 'team is keyed by the generator division key');
  assert.ok(!mapped.diagnostics.some((d) => d.code === 'division-id-without-key'));

  const unmapped = normalizeExistingSnapshot({
    payload: {
      teamRows: [{ id: 't1', division_id: 'uuid-div-10' }],
      teamPlayerRows: [{ team_id: 't1', player_id: 'p1', role: 'player', source: 'auto' }],
    },
  });
  assert.ok(unmapped.teamsByDivision['uuid-div-10'], 'falls back to the raw division_id key');
  assert.ok(unmapped.diagnostics.some((d) => d.code === 'division-id-without-key'));
});
