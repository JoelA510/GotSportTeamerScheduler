/**
 * Snapshot-aware (incremental) generation tests for PR 04: structural stability, team-count
 * policies, late/drop handling, and backward compatibility. Buddy routing and coach continuity
 * land in PR 05/06.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { generateTeams } from '../packages/core/src/teamGeneration.js';
import { createDeterministicRandom } from './fixtures/incrementalTeamingFixtures.js';

const U10_CONFIG = { id: 'U10', teamsCount: 3, slotsPerWeek: 4, maxRosterSize: 4 };

function makePlayers(ids, division = 'U10') {
  return ids.map((id) => ({ id, division }));
}

/** A published snapshot with three U10 teams (UUID-style ids) and 3 players each. */
function threeTeamSnapshot() {
  return {
    status: 'published',
    runId: 'run-1',
    teamsByDivision: {
      U10: [
        {
          id: 'uuid-team-1',
          name: 'Raptors',
          division: 'U10',
          coachId: 'coach-1',
          assistantCoachIds: ['asst-1'],
          players: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3', assignment_source: 'manual' }],
        },
        {
          id: 'uuid-team-2',
          name: 'Sharks',
          division: 'U10',
          players: [{ id: 'p4' }, { id: 'p5' }, { id: 'p6' }],
        },
        {
          id: 'uuid-team-3',
          name: 'Wolves',
          division: 'U10',
          players: [{ id: 'p7' }, { id: 'p8' }, { id: 'p9' }],
        },
      ],
    },
  };
}

const ALL_NINE = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9'];

test('no-snapshot output is byte-identical and carries no incremental keys', () => {
  const players = makePlayers(['a', 'b', 'c', 'd']);
  const base = generateTeams({
    players,
    divisionConfigs: { U10: U10_CONFIG },
    random: createDeterministicRandom(),
  });
  const withParams = generateTeams({
    players,
    divisionConfigs: { U10: U10_CONFIG },
    random: createDeterministicRandom(),
    existingSnapshot: null,
    generationMode: 'published',
    changePolicy: {},
  });

  assert.deepEqual(withParams, base);
  assert.ok(!('changeDiagnosticsByDivision' in withParams));
  assert.ok(!('snapshotDiagnostics' in withParams));
});

test('preserves team count, ids, and names after a player drops (published default)', () => {
  const players = makePlayers(ALL_NINE.filter((id) => id !== 'p5'));
  const result = generateTeams({
    players,
    divisionConfigs: { U10: U10_CONFIG },
    random: createDeterministicRandom(),
    existingSnapshot: threeTeamSnapshot(),
    generationMode: 'published',
  });

  const teams = result.teamsByDivision.U10;
  assert.equal(teams.length, 3, 'team count does not shrink after a drop');
  assert.deepEqual(
    teams.map((t) => t.id),
    ['uuid-team-1', 'uuid-team-2', 'uuid-team-3']
  );
  assert.deepEqual(
    teams.map((t) => t.name),
    ['Raptors', 'Sharks', 'Wolves']
  );
  const sharks = teams.find((t) => t.id === 'uuid-team-2');
  assert.deepEqual(
    sharks.players.map((p) => p.id).sort(),
    ['p4', 'p6'],
    'dropped player p5 leaves the roster'
  );
  const diag = result.changeDiagnosticsByDivision.U10;
  assert.equal(diag.mode, 'published');
  assert.equal(diag.teamCountPolicy, 'preserve-existing');
  assert.equal(diag.existingTeamsPreserved, 3);
  assert.equal(diag.newTeamsCreated, 0);
  assert.equal(diag.droppedPlayersRemoved, 1);
});

test('preserves coach metadata and manual assignment_source on preserved players', () => {
  const result = generateTeams({
    players: makePlayers(ALL_NINE),
    divisionConfigs: { U10: U10_CONFIG },
    random: createDeterministicRandom(),
    existingSnapshot: threeTeamSnapshot(),
    generationMode: 'review',
  });

  const raptors = result.teamsByDivision.U10.find((t) => t.id === 'uuid-team-1');
  assert.equal(raptors.coachId, 'coach-1');
  assert.equal(raptors.coachNeeded, false);
  assert.deepEqual(raptors.assistantCoachIds, ['asst-1']);
  const p3 = /** @type {any} */ (raptors.players.find((p) => p.id === 'p3'));
  assert.equal(p3.assignment_source, 'manual');
  assert.equal(p3.locked, true, 'manual assignment locked in review mode');
  assert.equal(result.changeDiagnosticsByDivision.U10.manualAssignmentsPreserved, 1);
});

test('preserves an empty team shell after all of its players drop', () => {
  const players = makePlayers(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']); // Wolves all dropped
  const result = generateTeams({
    players,
    divisionConfigs: { U10: U10_CONFIG },
    random: createDeterministicRandom(),
    existingSnapshot: threeTeamSnapshot(),
    generationMode: 'published',
  });

  const wolves = result.teamsByDivision.U10.find((t) => t.id === 'uuid-team-3');
  assert.ok(wolves, 'empty shell survives');
  assert.deepEqual(wolves.players, []);
  assert.equal(result.teamsByDivision.U10.length, 3);
});

test('assigns a late player into preserved capacity', () => {
  const players = makePlayers([...ALL_NINE.filter((id) => id !== 'p9'), 'late-1']);
  const result = generateTeams({
    players,
    divisionConfigs: { U10: U10_CONFIG },
    random: createDeterministicRandom(),
    existingSnapshot: threeTeamSnapshot(),
    generationMode: 'published',
  });

  const assignedTeam = result.teamsByDivision.U10.find((t) =>
    t.players.some((p) => p.id === 'late-1')
  );
  assert.ok(assignedTeam, 'late player placed on a preserved team');
  assert.deepEqual(result.overflowByDivision.U10, []);
  assert.equal(result.changeDiagnosticsByDivision.U10.latePlayersAssigned, 1);
});

test('overflows a late player when all preserved teams are full under preserve-existing', () => {
  // Make all 3 teams full (4 each = 12 players) + one late player.
  const snapshot = threeTeamSnapshot();
  snapshot.teamsByDivision.U10[0].players.push({ id: 'p10' });
  snapshot.teamsByDivision.U10[1].players.push({ id: 'p11' });
  snapshot.teamsByDivision.U10[2].players.push({ id: 'p12' });
  const players = makePlayers([...ALL_NINE, 'p10', 'p11', 'p12', 'late-1']);

  const result = generateTeams({
    players,
    divisionConfigs: { U10: U10_CONFIG },
    random: createDeterministicRandom(),
    existingSnapshot: snapshot,
    generationMode: 'published',
  });

  assert.equal(result.teamsByDivision.U10.length, 3, 'no team created');
  const overflow = result.overflowByDivision.U10;
  assert.equal(overflow.length, 1);
  assert.deepEqual(
    overflow[0].players.map((p) => p.id),
    ['late-1']
  );
  assert.equal(overflow[0].reason, 'insufficient-capacity');
  assert.equal(result.changeDiagnosticsByDivision.U10.latePlayersOverflowed, 1);
});

test('preserve-or-expand creates a new team only when capacity requires it', () => {
  const snapshot = threeTeamSnapshot();
  // Room available: late player fits, no expansion.
  const fits = generateTeams({
    players: makePlayers([...ALL_NINE, 'late-1']),
    divisionConfigs: { U10: U10_CONFIG },
    random: createDeterministicRandom(),
    existingSnapshot: snapshot,
    generationMode: 'draft',
  });
  assert.equal(fits.changeDiagnosticsByDivision.U10.teamCountPolicy, 'preserve-or-expand');
  assert.equal(fits.teamsByDivision.U10.length, 3, 'no expansion when capacity exists');

  // All teams full: expansion required.
  const fullSnapshot = threeTeamSnapshot();
  fullSnapshot.teamsByDivision.U10[0].players.push({ id: 'p10' });
  fullSnapshot.teamsByDivision.U10[1].players.push({ id: 'p11' });
  fullSnapshot.teamsByDivision.U10[2].players.push({ id: 'p12' });
  const expands = generateTeams({
    players: makePlayers([...ALL_NINE, 'p10', 'p11', 'p12', 'late-1']),
    divisionConfigs: { U10: U10_CONFIG },
    random: createDeterministicRandom(),
    existingSnapshot: fullSnapshot,
    generationMode: 'draft',
  });
  assert.equal(expands.teamsByDivision.U10.length, 4, 'exactly one new team created');
  assert.equal(expands.changeDiagnosticsByDivision.U10.newTeamsCreated, 1);
  const newTeam = expands.teamsByDivision.U10.find(
    (t) => !['uuid-team-1', 'uuid-team-2', 'uuid-team-3'].includes(t.id)
  );
  assert.deepEqual(
    newTeam.players.map((p) => p.id),
    ['late-1']
  );
  assert.deepEqual(expands.overflowByDivision.U10, []);
});

test('preserve-with-overflow overflows instead of expanding', () => {
  const fullSnapshot = threeTeamSnapshot();
  fullSnapshot.teamsByDivision.U10[0].players.push({ id: 'p10' });
  fullSnapshot.teamsByDivision.U10[1].players.push({ id: 'p11' });
  fullSnapshot.teamsByDivision.U10[2].players.push({ id: 'p12' });

  const result = generateTeams({
    players: makePlayers([...ALL_NINE, 'p10', 'p11', 'p12', 'late-1']),
    divisionConfigs: { U10: U10_CONFIG },
    random: createDeterministicRandom(),
    existingSnapshot: fullSnapshot,
    generationMode: 'draft',
    changePolicy: { teamCountPolicy: 'preserve-with-overflow' },
  });

  assert.equal(result.teamsByDivision.U10.length, 3, 'no expansion');
  assert.equal(result.overflowSummaryByDivision.U10.totalPlayers, 1);
  assert.equal(result.changeDiagnosticsByDivision.U10.teamCountPolicy, 'preserve-with-overflow');
});

test('underfilled published teams produce minRoster warnings instead of collapsing', () => {
  const players = makePlayers(['p1', 'p4', 'p7']); // one player left per team
  const result = generateTeams({
    players,
    divisionConfigs: { U10: { ...U10_CONFIG, minRosterSize: 3 } },
    random: createDeterministicRandom(),
    existingSnapshot: threeTeamSnapshot(),
    generationMode: 'published',
  });

  assert.equal(result.teamsByDivision.U10.length, 3, 'underfilled teams are not collapsed');
  assert.deepEqual(result.changeDiagnosticsByDivision.U10.minRosterWarnings.sort(), [
    'uuid-team-1',
    'uuid-team-2',
    'uuid-team-3',
  ]);
});

test('over-cap preserved teams are flagged and accept no more players by default', () => {
  const snapshot = threeTeamSnapshot();
  // Team 1 over cap: 5 players with maxRosterSize 4.
  snapshot.teamsByDivision.U10[0].players.push({ id: 'p10' }, { id: 'p11' });
  const players = makePlayers([...ALL_NINE, 'p10', 'p11', 'late-1']);

  const result = generateTeams({
    players,
    divisionConfigs: { U10: U10_CONFIG },
    random: createDeterministicRandom(),
    existingSnapshot: snapshot,
    generationMode: 'published',
  });

  const raptors = result.teamsByDivision.U10.find((t) => t.id === 'uuid-team-1');
  assert.equal(raptors.players.length, 5, 'over-cap preserved roster kept intact');
  assert.ok(
    !raptors.players.some((p) => p.id === 'late-1'),
    'no additional player joins an over-cap team'
  );
  const violations = result.changeDiagnosticsByDivision.U10.capacityViolations;
  assert.deepEqual(violations, [{ teamId: 'uuid-team-1', playerCount: 5, maxRosterSize: 4 }]);
});

test('allowOverCapAssignments permits placement beyond the cap when explicitly enabled', () => {
  const fullSnapshot = threeTeamSnapshot();
  fullSnapshot.teamsByDivision.U10[0].players.push({ id: 'p10' });
  fullSnapshot.teamsByDivision.U10[1].players.push({ id: 'p11' });
  fullSnapshot.teamsByDivision.U10[2].players.push({ id: 'p12' });

  const result = generateTeams({
    players: makePlayers([...ALL_NINE, 'p10', 'p11', 'p12', 'late-1']),
    divisionConfigs: { U10: U10_CONFIG },
    random: createDeterministicRandom(),
    existingSnapshot: fullSnapshot,
    generationMode: 'published',
    changePolicy: { allowOverCapAssignments: true },
  });

  assert.deepEqual(result.overflowByDivision.U10, []);
  const assigned = result.teamsByDivision.U10.find((t) => t.players.some((p) => p.id === 'late-1'));
  assert.ok(assigned, 'late player placed despite full teams');
  // The roster pushed past cap by the late assignment is reported as a violation.
  assert.ok(
    result.changeDiagnosticsByDivision.U10.capacityViolations.some(
      (v) => v.teamId === assigned.id && v.playerCount === 5
    ),
    'over-cap roster created via allowOverCapAssignments is flagged'
  );
});

test('preserves players with non-string or whitespace-padded ids; tolerates changePolicy null', () => {
  const snapshot = {
    status: 'review',
    teamsByDivision: {
      U10: [{ id: 'team-1', division: 'U10', players: [{ id: 42 }, { id: 'p2' }] }],
    },
  };
  const result = generateTeams({
    players: [
      { id: /** @type {any} */ (42), division: 'U10' },
      // Whitespace-padded incoming id must still match the trimmed snapshot id.
      { id: ' p2 ', division: 'U10' },
    ],
    divisionConfigs: { U10: U10_CONFIG },
    random: createDeterministicRandom(),
    existingSnapshot: snapshot,
    generationMode: 'review',
    changePolicy: /** @type {any} */ (null),
  });

  const roster = result.teamsByDivision.U10[0].players.map((p) => String(p.id).trim()).sort();
  assert.deepEqual(
    roster,
    ['42', 'p2'],
    'numeric/padded-id players preserved, not silently dropped'
  );
  assert.equal(result.changeDiagnosticsByDivision.U10.droppedPlayersRemoved, 0);
});

test('a division present only in the snapshot remains in the output', () => {
  const snapshot = {
    status: 'published',
    teamsByDivision: {
      U12: [{ id: 'uuid-u12-1', name: 'Eagles', division: 'U12', players: [{ id: 'q1' }] }],
    },
  };
  const result = generateTeams({
    players: makePlayers(['a', 'b']),
    divisionConfigs: {
      U10: U10_CONFIG,
      U12: { id: 'U12', teamsCount: 1, slotsPerWeek: 1, maxRosterSize: 4 },
    },
    random: createDeterministicRandom(),
    existingSnapshot: snapshot,
    generationMode: 'published',
  });

  assert.ok(result.teamsByDivision.U12, 'snapshot-only division returned');
  assert.equal(result.teamsByDivision.U12[0].id, 'uuid-u12-1');
  // q1 is not registered anymore: shell preserved, roster empty.
  assert.deepEqual(result.teamsByDivision.U12[0].players, []);
  assert.equal(result.changeDiagnosticsByDivision.U12.droppedPlayersRemoved, 1);
});

test('a snapshot-only division without a division config is preserved with a structural warning', () => {
  const snapshot = {
    status: 'published',
    teamsByDivision: {
      U14: [{ id: 'uuid-u14-1', division: 'U14', players: [{ id: 'z1' }] }],
    },
  };
  const result = generateTeams({
    players: makePlayers(['a']),
    divisionConfigs: { U10: U10_CONFIG },
    random: createDeterministicRandom(),
    existingSnapshot: snapshot,
    generationMode: 'published',
  });

  assert.ok(result.teamsByDivision.U14, 'division preserved despite missing config');
  assert.ok(
    result.changeDiagnosticsByDivision.U14.structuralWarnings.some((w) =>
      w.includes('no division config')
    )
  );
});

test('a late coach-anchored player joins their preserved coach team', () => {
  const players = [
    ...makePlayers(ALL_NINE),
    { id: 'late-coach-child', division: 'U10', coachId: 'coach-1' },
  ];
  const result = generateTeams({
    players,
    divisionConfigs: { U10: U10_CONFIG },
    random: createDeterministicRandom(),
    existingSnapshot: threeTeamSnapshot(),
    generationMode: 'published',
  });

  const raptors = result.teamsByDivision.U10.find((t) => t.id === 'uuid-team-1');
  assert.ok(
    raptors.players.some((p) => p.id === 'late-coach-child'),
    "late coach child lands on the coach's preserved team"
  );
});

test('an explicit auto policy with a snapshot falls back to fresh generation', () => {
  const players = makePlayers(['a', 'b', 'c', 'd']);
  const fresh = generateTeams({
    players,
    divisionConfigs: { U10: U10_CONFIG },
    random: createDeterministicRandom(),
  });
  const auto = generateTeams({
    players,
    divisionConfigs: { U10: U10_CONFIG },
    random: createDeterministicRandom(),
    existingSnapshot: threeTeamSnapshot(),
    generationMode: 'published',
    changePolicy: { teamCountPolicy: 'auto' },
  });

  assert.deepEqual(auto, fresh, 'auto ignores the snapshot entirely');
});
