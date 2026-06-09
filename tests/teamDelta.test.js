import { test } from 'vitest';
import assert from 'node:assert/strict';
import { reconcileTeamDeltas } from '../packages/core/src/teamDelta.js';

/** A published snapshot: team-1 (coach-1 + asst-1) with one auto and one manual player. */
const baseSnapshot = {
  status: 'published',
  runId: 'run-1',
  teamsByDivision: {
    U10: [
      {
        id: 'team-1',
        division: 'U10',
        coachId: 'coach-1',
        assistantCoachIds: ['asst-1'],
        players: [
          { id: 'p1', assignment_source: 'auto' },
          { id: 'p2', assignment_source: 'manual' },
        ],
      },
    ],
  },
};

test('reconcileTeamDeltas classifies late (unassigned) players', () => {
  const result = reconcileTeamDeltas({
    players: [
      { id: 'p1', division: 'U10' },
      { id: 'late-1', division: 'U10' },
    ],
    existingSnapshot: baseSnapshot,
    generationMode: 'published',
  });

  assert.deepEqual(result.unassignedPlayersByDivision.U10, ['late-1']);
});

test('reconcileTeamDeltas classifies dropped players and reduces the active roster', () => {
  const result = reconcileTeamDeltas({
    players: [{ id: 'p1', division: 'U10' }],
    existingSnapshot: baseSnapshot,
    generationMode: 'published',
  });

  assert.deepEqual(result.droppedPlayersByDivision.U10, ['p2']);
  const team = result.preservedTeamsByDivision.U10[0];
  assert.equal(team.id, 'team-1');
  assert.deepEqual(
    team.players.map((p) => p.id),
    ['p1']
  );
});

test('reconcileTeamDeltas preserves an empty team shell when every player drops', () => {
  const result = reconcileTeamDeltas({
    players: [],
    existingSnapshot: baseSnapshot,
    generationMode: 'published',
  });

  const team = result.preservedTeamsByDivision.U10[0];
  assert.equal(team.id, 'team-1');
  assert.deepEqual(team.players, []);
  assert.deepEqual(result.droppedPlayersByDivision.U10.sort(), ['p1', 'p2']);
});

test('reconcileTeamDeltas preserves a division that appears only in the snapshot', () => {
  const result = reconcileTeamDeltas({
    players: [{ id: 'new-1', division: 'U10' }],
    existingSnapshot: {
      teamsByDivision: {
        U12: [{ id: 'team-x', division: 'U12', players: [{ id: 'q1' }] }],
      },
    },
    generationMode: 'review',
  });

  assert.ok(result.preservedTeamsByDivision.U12, 'U12 from the snapshot survives');
  assert.equal(result.preservedTeamsByDivision.U12[0].id, 'team-x');
  assert.deepEqual(result.droppedPlayersByDivision.U12, ['q1']);
  assert.deepEqual(result.unassignedPlayersByDivision.U10, ['new-1']);
});

test('reconcileTeamDeltas locks manual assignments only in review/published/locked modes', () => {
  for (const generationMode of ['review', 'published', 'locked']) {
    const result = reconcileTeamDeltas({
      players: [
        { id: 'p1', division: 'U10' },
        { id: 'p2', division: 'U10' },
      ],
      existingSnapshot: baseSnapshot,
      generationMode,
    });
    assert.deepEqual(
      result.activeLockedPlayerIds,
      ['p2'],
      `manual p2 is locked in ${generationMode}`
    );
    const team = result.preservedTeamsByDivision.U10[0];
    assert.equal(team.players.find((p) => p.id === 'p2').locked, true);
    assert.equal(team.players.find((p) => p.id === 'p1').locked, false);
  }

  const draft = reconcileTeamDeltas({
    players: [
      { id: 'p1', division: 'U10' },
      { id: 'p2', division: 'U10' },
    ],
    existingSnapshot: baseSnapshot,
    generationMode: 'draft',
  });
  assert.deepEqual(draft.activeLockedPlayerIds, []);
});

test('reconcileTeamDeltas preserves assignment metadata for retained players (rule 1)', () => {
  const result = reconcileTeamDeltas({
    players: [{ id: 'p2', division: 'U10' }],
    existingSnapshot: baseSnapshot,
    generationMode: 'review',
  });

  const p2 = result.preservedTeamsByDivision.U10[0].players.find((p) => p.id === 'p2');
  assert.equal(p2.assignment_source, 'manual');
  assert.equal(p2.locked, true);
});

test('reconcileTeamDeltas handles a null snapshot without breaking callers', () => {
  const result = reconcileTeamDeltas({
    players: [{ id: 'a', division: 'U10' }],
    existingSnapshot: null,
    generationMode: 'draft',
  });

  assert.deepEqual(result.preservedTeamsByDivision, {});
  assert.deepEqual(result.unassignedPlayersByDivision.U10, ['a']);
  assert.deepEqual(result.droppedPlayersByDivision, {});
  assert.deepEqual(result.diagnostics, []);
});

test('reconcileTeamDeltas detects dropped coaches/assistants without remediating', () => {
  const result = reconcileTeamDeltas({
    players: [
      { id: 'p1', division: 'U10' },
      { id: 'p2', division: 'U10' },
    ],
    existingSnapshot: baseSnapshot,
    generationMode: 'published',
  });

  assert.equal(result.coachDeltas.length, 1);
  assert.equal(result.coachDeltas[0].teamId, 'team-1');
  assert.equal(result.coachDeltas[0].coachDropped, true);
  assert.deepEqual(result.coachDeltas[0].droppedAssistantCoachIds, ['asst-1']);
  // No remediation in PR 02 — the preserved shell still carries the original coach id.
  assert.equal(result.preservedTeamsByDivision.U10[0].coachId, 'coach-1');
});

test('reconcileTeamDeltas flags players whose division changed', () => {
  const result = reconcileTeamDeltas({
    players: [
      { id: 'p1', division: 'U12' },
      { id: 'p2', division: 'U10' },
    ],
    existingSnapshot: baseSnapshot,
    generationMode: 'published',
  });

  assert.deepEqual(result.changedDivisionPlayers, [
    { playerId: 'p1', fromDivision: 'U10', toDivision: 'U12' },
  ]);
  // The moved player leaves the old team's active roster...
  assert.deepEqual(
    result.preservedTeamsByDivision.U10[0].players.map((p) => p.id),
    ['p2']
  );
  // ...and is surfaced as unassigned in the new division.
  assert.deepEqual(result.unassignedPlayersByDivision.U12, ['p1']);
});

test('reconcileTeamDeltas honors a per-player locked flag even in draft mode', () => {
  const snapshot = {
    teamsByDivision: {
      U10: [
        {
          id: 'team-1',
          division: 'U10',
          players: [
            { id: 'p1', assignment_source: 'auto', locked: true },
            { id: 'p2', assignment_source: 'auto', locked: false },
          ],
        },
      ],
    },
  };
  const result = reconcileTeamDeltas({
    players: [
      { id: 'p1', division: 'U10' },
      { id: 'p2', division: 'U10' },
    ],
    existingSnapshot: snapshot,
    // draft does NOT lock manual assignments, but an explicit per-player lock still holds.
    generationMode: 'draft',
  });

  assert.deepEqual(result.activeLockedPlayerIds, ['p1']);
});

test('reconcileTeamDeltas surfaces orphaned snapshot players in its output', () => {
  const result = reconcileTeamDeltas({
    players: [{ id: 'p1', division: 'U10' }],
    existingSnapshot: {
      payload: {
        teamRows: [{ id: 'team-1', division: 'U10' }],
        teamPlayerRows: [{ team_id: 'ghost', player_id: 'lost', role: 'player', source: 'auto' }],
      },
    },
    generationMode: 'review',
  });

  assert.deepEqual(result.orphanedSnapshotPlayers, [{ playerId: 'lost', teamId: 'ghost' }]);
});

test('reconcileTeamDeltas emits unknown-division only for late players outside divisionConfigs', () => {
  const unknown = reconcileTeamDeltas({
    players: [{ id: 'late-1', division: 'U14' }],
    existingSnapshot: null,
    generationMode: 'draft',
    divisionConfigs: { U10: { id: 'U10' } },
  });
  assert.deepEqual(unknown.unassignedPlayersByDivision.U14, ['late-1']);
  assert.ok(unknown.diagnostics.some((d) => d.code === 'unknown-division'));

  const known = reconcileTeamDeltas({
    players: [{ id: 'late-2', division: 'U10' }],
    existingSnapshot: null,
    generationMode: 'draft',
    divisionConfigs: { U10: { id: 'U10' } },
  });
  assert.ok(!known.diagnostics.some((d) => d.code === 'unknown-division'));
});

test('reconcileTeamDeltas reports coachDropped:false when the coach is still registered', () => {
  const result = reconcileTeamDeltas({
    players: [
      { id: 'p1', division: 'U10' },
      { id: 'coach-1', division: 'U10' },
    ],
    existingSnapshot: baseSnapshot,
    generationMode: 'published',
  });

  // asst-1 is still dropped (so a delta entry exists), but the head coach is not dropped.
  const delta = result.coachDeltas.find((d) => d.teamId === 'team-1');
  assert.ok(delta, 'a coach delta exists because asst-1 dropped');
  assert.equal(delta.coachDropped, false);
  assert.deepEqual(delta.droppedAssistantCoachIds, ['asst-1']);
});
