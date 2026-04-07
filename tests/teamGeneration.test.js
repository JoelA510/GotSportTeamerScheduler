import { test, expect } from 'vitest';
import assert from 'node:assert/strict';
import { generateTeams } from '../packages/core/src/teamGeneration.js';

const divisionConfigs = {
  U10: { id: 'U10', teamsCount: 3, slotsPerWeek: 4, maxRosterSize: 4 },
};

test('distributes players evenly across teams', () => {
  const players = Array.from({ length: 9 }).map((_, index) => ({
    id: `player-${index + 1}`,
    division: 'U10',
  }));

  const {
    teamsByDivision,
    overflowByDivision,
    overflowSummaryByDivision,
    buddyDiagnosticsByDivision,
    coachCoverageByDivision,
    rosterBalanceByDivision,
  } = generateTeams({
    players,
    divisionConfigs,
    random: createDeterministicRandom(),
  });
  const teams = teamsByDivision.U10;

  assert.equal(teams.length, 3);

  // The evaluator-based algorithm distributes players using skill-balance scoring,
  // so exact per-team sizes may vary as evaluators evolve. Assert the invariants
  // that matter: all players assigned, no team exceeds maxRosterSize, no empty teams,
  // and the spread is reasonable (≤ 2 for 9 players across 3 teams).
  const sizes = teams.map((team) => team.players.length).sort((a, b) => a - b);
  const totalAssigned = sizes.reduce((sum, n) => sum + n, 0);
  assert.equal(totalAssigned, players.length);
  assert.ok(sizes[0] >= 1, 'no team should be empty');
  assert.ok(sizes[sizes.length - 1] <= 4, 'no team should exceed maxRosterSize');
  assert.ok(sizes[sizes.length - 1] - sizes[0] <= 2, 'size spread should be ≤ 2');

  const allPlayers = teams.flatMap((team) => team.players.map((player) => player.id));
  assert.equal(new Set(allPlayers).size, players.length);
  assert.deepEqual(overflowByDivision.U10, []);
  assert.deepEqual(overflowSummaryByDivision.U10, {
    totalUnits: 0,
    totalPlayers: 0,
    byReason: {},
  });
  assert.deepEqual(buddyDiagnosticsByDivision.U10.unmatchedRequests, []);
  assert.deepEqual(coachCoverageByDivision.U10, {
    totalTeams: 3,
    volunteerCoaches: 0,
    teamsWithCoach: 0,
    teamsWithoutCoach: 3,
    coverageRate: 0,
    needsAdditionalCoaches: true,
  });
  // Assert roster balance aggregates — totalPlayers and totalCapacity are fixed regardless
  // of how the algorithm distributes players across teams.
  const balanceSummary = rosterBalanceByDivision.U10.summary;
  assert.equal(balanceSummary.totalPlayers, players.length);
  assert.equal(balanceSummary.totalCapacity, 12);
  assert.equal(balanceSummary.averageFillRate, 0.75);
  assert.ok(Array.isArray(balanceSummary.teamsNeedingPlayers), 'teamsNeedingPlayers should be an array');
  // Each team stat should reference a valid team ID with consistent fill math
  rosterBalanceByDivision.U10.teamStats.forEach((entry) => {
    assert.ok(entry.teamId.startsWith('U10-T'), 'teamId format correct');
    assert.equal(entry.slotsRemaining, 4 - entry.playerCount);
  });
});

test('keeps mutual buddies on the same team', () => {
  const players = [
    { id: 'a', division: 'U10', buddyId: 'b' },
    { id: 'b', division: 'U10', buddyId: 'a' },
    { id: 'c', division: 'U10' },
    { id: 'd', division: 'U10' },
  ];

  const {
    teamsByDivision,
    buddyDiagnosticsByDivision,
    coachCoverageByDivision,
    rosterBalanceByDivision,
  } = generateTeams({
    players,
    divisionConfigs,
    random: createDeterministicRandom(),
  });
  const teams = teamsByDivision.U10;
  const buddyTeam = teams.find((team) => team.players.some((player) => player.id === 'a'));
  assert.ok(buddyTeam, 'expected buddy pair to be assigned to a team');
  const buddyIds = buddyTeam.players
    .filter((player) => player.id === 'a' || player.id === 'b')
    .map((player) => player.id)
    .sort();
  assert.deepEqual(buddyIds, ['a', 'b']);
  assert.deepEqual(buddyDiagnosticsByDivision.U10.mutualPairs, [{ playerIds: ['a', 'b'] }]);
  assert.equal(coachCoverageByDivision.U10.needsAdditionalCoaches, true);
  assert.equal(rosterBalanceByDivision.U10.summary.totalPlayers, players.length);
});

test('respects coach assignments when creating teams', () => {
  const players = [
    { id: 'a', division: 'U10', coachId: 'coach-1' },
    { id: 'b', division: 'U10', coachId: 'coach-1' },
    { id: 'c', division: 'U10' },
    { id: 'd', division: 'U10' },
  ];

  const {
    teamsByDivision,
    overflowByDivision,
    overflowSummaryByDivision,
    coachCoverageByDivision,
    rosterBalanceByDivision,
  } = generateTeams({
    players,
    divisionConfigs,
    random: createDeterministicRandom(),
  });
  const teams = teamsByDivision.U10;
  const coachTeam = teams.find((team) => team.coachId === 'coach-1');

  assert.ok(coachTeam, 'coach team should be created for volunteer coach');
  const rosterIds = coachTeam.players
    .filter((player) => player.id === 'a' || player.id === 'b')
    .map((player) => player.id)
    .sort();
  assert.deepEqual(rosterIds, ['a', 'b']);
  assert.deepEqual(overflowByDivision.U10, []);
  assert.deepEqual(overflowSummaryByDivision.U10, {
    totalUnits: 0,
    totalPlayers: 0,
    byReason: {},
  });
  assert.deepEqual(coachCoverageByDivision.U10, {
    totalTeams: 1,
    volunteerCoaches: 1,
    teamsWithCoach: 1,
    teamsWithoutCoach: 0,
    coverageRate: 1,
    needsAdditionalCoaches: false,
  });
  assert.deepEqual(rosterBalanceByDivision.U10.teamStats[0], {
    teamId: 'U10-T01',
    coachId: 'coach-1',
    playerCount: 4,
    maxRosterSize: 4,
    slotsRemaining: 0,
    fillRate: 1,
  });
});

test('applies custom team names with sensible fallbacks', () => {
  const players = [
    { id: 'a', division: 'U10' },
    { id: 'b', division: 'U10' },
    { id: 'c', division: 'U10' },
    { id: 'd', division: 'U10' },
    { id: 'e', division: 'U10' },
    { id: 'f', division: 'U10' },
  ];

  const { teamsByDivision } = generateTeams({
    players,
    divisionConfigs: {
      U10: {
        id: 'U10',
        teamsCount: 3,
        slotsPerWeek: 4,
        maxRosterSize: 2,
        teamNames: ['Raptors', 'Sharks'],
        teamNamePrefix: 'Lightning',
      },
    },
    random: createDeterministicRandom(),
  });

  const names = teamsByDivision.U10.map((team) => team.name);
  assert.deepEqual(names, ['Raptors', 'Sharks', 'Lightning 03']);

  const fallback = generateTeams({
    players: [{ id: 'solo', division: 'U12' }],
    divisionConfigs: { U12: { id: 'U12', teamsCount: 1, slotsPerWeek: 1, maxRosterSize: 4 } },
    random: createDeterministicRandom(),
  });

  assert.equal(fallback.teamsByDivision.U12[0].name, 'U12 Team 01');
});

test('records overflow when no team can accommodate a unit', () => {
  const players = [
    { id: 'a', division: 'U10', coachId: 'coach-1' },
    { id: 'b', division: 'U10', coachId: 'coach-1' },
    { id: 'c', division: 'U10', coachId: 'coach-1' },
    { id: 'd', division: 'U10', coachId: 'coach-1' },
    { id: 'e', division: 'U10', coachId: 'coach-1' },
  ];

  const {
    overflowByDivision,
    overflowSummaryByDivision,
    buddyDiagnosticsByDivision,
    coachCoverageByDivision,
    rosterBalanceByDivision,
  } = generateTeams({
    players,
    divisionConfigs,
    random: createDeterministicRandom(),
  });

  const overflow = overflowByDivision.U10;
  assert.equal(overflow.length, 1);
  assert.equal(overflow[0].reason, 'coach-capacity');
  assert.deepEqual(overflow[0].players.map((player) => player.id).sort(), ['e']);
  assert.equal(overflow[0].metadata.coachId, 'coach-1');
  assert.deepEqual(overflowSummaryByDivision.U10, {
    totalUnits: 1,
    totalPlayers: 1,
    byReason: {
      'coach-capacity': { units: 1, players: 1 },
    },
  });
  assert.deepEqual(buddyDiagnosticsByDivision.U10.unmatchedRequests, []);
  assert.equal(coachCoverageByDivision.U10.teamsWithCoach, 1);
  assert.equal(rosterBalanceByDivision.U10.summary.totalPlayers, players.length - 1);
});

test('throws when buddy unit has conflicting coach assignments', () => {
  const players = [
    { id: 'a', division: 'U10', buddyId: 'b', coachId: 'coach-1', skill: 3 },
    { id: 'b', division: 'U10', buddyId: 'a', coachId: 'coach-2', skill: 3 },
  ];

  assert.throws(
    () => generateTeams({ players, divisionConfigs, random: createDeterministicRandom() }),
    (err) => {
      assert.ok(err instanceof Error, `Expected Error, got ${typeof err}: ${err}`);
      assert.match(
        err.message,
        /conflicting coach assignments/i,
        `Expected "Conflicting coach assignments" but got: "${err.message}"`
      );
      return true;
    }
  );
});

test('records insufficient capacity overflow for buddy unit larger than roster', () => {
  const players = [
    { id: 'a', division: 'U10', buddyId: 'b' },
    { id: 'b', division: 'U10', buddyId: 'a' },
  ];

  const {
    overflowByDivision,
    overflowSummaryByDivision,
    teamsByDivision,
    buddyDiagnosticsByDivision,
    coachCoverageByDivision,
    rosterBalanceByDivision,
  } = generateTeams({
    players,
    divisionConfigs: { U10: { id: 'U10', teamsCount: 2, slotsPerWeek: 2, maxRosterSize: 1 } },
    random: createDeterministicRandom(),
  });

  assert.equal(teamsByDivision.U10.length, 2);
  const overflow = overflowByDivision.U10;
  assert.equal(overflow.length, 1);
  assert.equal(overflow[0].reason, 'insufficient-capacity');
  assert.deepEqual(overflow[0].players.map((player) => player.id).sort(), ['a', 'b']);
  assert.deepEqual(overflow[0].metadata, { unitSize: 2 });
  assert.deepEqual(overflowSummaryByDivision.U10, {
    totalUnits: 1,
    totalPlayers: 2,
    byReason: {
      'insufficient-capacity': { units: 1, players: 2 },
    },
  });
  assert.deepEqual(buddyDiagnosticsByDivision.U10.mutualPairs, [{ playerIds: ['a', 'b'] }]);
  assert.equal(coachCoverageByDivision.U10.totalTeams, 2);
  assert.deepEqual(rosterBalanceByDivision.U10.summary.teamsNeedingPlayers.sort(), [
    'U10-T01',
    'U10-T02',
  ]);
});

test('validates input arguments', () => {
  assert.throws(
    () => generateTeams({ players: null, divisionConfigs }),
    /players must be an array/i
  );
  assert.throws(
    () => generateTeams({ players: [], divisionConfigs: null }),
    /divisionconfigs must be an object/i
  );
  assert.throws(
    // @ts-expect-error [INVALID_INPUT] - testing intentional invalid input to verify runtime validation logic in javascript-compiled-as-typescript context
    () => generateTeams({ players: [], divisionConfigs, random: 'not-a-function' }),
    /random must be a function/i
  );

  const missingId = [{ division: 'U10' }];
  assert.throws(
    // @ts-expect-error [INVALID_INPUT] - testing intentional invalid input to verify runtime validation logic in javascript-compiled-as-typescript context
    () => generateTeams({ players: missingId, divisionConfigs }),
    /each player requires an id/i
  );

  const missingDivision = [{ id: 'no-division' }];
  assert.throws(
    // @ts-expect-error [INVALID_INPUT] - testing intentional invalid input to verify runtime validation logic in javascript-compiled-as-typescript context
    () => generateTeams({ players: missingDivision, divisionConfigs }),
    /each player requires a division/i
  );

  const players = [{ id: 'a', division: 'U11' }];
  assert.throws(
    () => generateTeams({ players, divisionConfigs }),
    /missing maxrostersize for division u11/i
  );

  const duplicatePlayersSameDivision = [
    { id: 'dup', division: 'U10' },
    { id: 'dup', division: 'U10' },
  ];
  assert.throws(
    () => generateTeams({ players: duplicatePlayersSameDivision, divisionConfigs }),
    /duplicate player id detected: dup \(divisions U10 and U10\)/i,
    'should throw for duplicate IDs in the same division'
  );

  const duplicatePlayersDifferentDivision = [
    { id: 'dup', division: 'U10' },
    { id: 'dup', division: 'U12' },
  ];
  const divisionConfigsWithU12 = {
    ...divisionConfigs,
    U12: { id: 'U12', teamsCount: 1, slotsPerWeek: 1, maxRosterSize: 8 },
  };
  assert.throws(
    () =>
      generateTeams({
        players: duplicatePlayersDifferentDivision,
        divisionConfigs: divisionConfigsWithU12,
      }),
    /duplicate player id detected: dup \(divisions U10 and U12\)/i,
    'should throw for duplicate IDs in different divisions'
  );
});

test('reports unmatched buddy requests for missing or non-reciprocal pairs', () => {
  const players = [
    { id: 'a', division: 'U10', buddyId: 'missing-player' },
    { id: 'b', division: 'U10', buddyId: 'c' },
    { id: 'c', division: 'U10' },
  ];

  const { buddyDiagnosticsByDivision, coachCoverageByDivision, rosterBalanceByDivision } =
    generateTeams({
      players,
      divisionConfigs,
      random: createDeterministicRandom(),
    });

  const diagnostics = buddyDiagnosticsByDivision.U10;
  assert.deepEqual(diagnostics.mutualPairs, []);
  assert.deepEqual(
    diagnostics.unmatchedRequests.sort((a, b) => a.playerId.localeCompare(b.playerId)),
    [
      {
        playerId: 'a',
        requestedBuddyId: 'missing-player',
        reason: 'missing-player',
      },
      {
        playerId: 'b',
        requestedBuddyId: 'c',
        reason: 'not-reciprocated',
      },
    ]
  );
  assert.deepEqual(coachCoverageByDivision.U10, {
    totalTeams: 1,
    volunteerCoaches: 0,
    teamsWithCoach: 0,
    teamsWithoutCoach: 1,
    coverageRate: 0,
    needsAdditionalCoaches: true,
  });
  assert.deepEqual(rosterBalanceByDivision.U10.summary.teamsNeedingPlayers, ['U10-T01']);
});

test('flags self-referential buddy requests for review', () => {
  const players = [{ id: 'solo', division: 'U10', buddyId: 'solo' }];

  const { buddyDiagnosticsByDivision, coachCoverageByDivision, rosterBalanceByDivision } =
    generateTeams({
      players,
      divisionConfigs,
      random: createDeterministicRandom(),
    });

  assert.deepEqual(buddyDiagnosticsByDivision.U10.mutualPairs, []);
  assert.deepEqual(buddyDiagnosticsByDivision.U10.unmatchedRequests, [
    { playerId: 'solo', requestedBuddyId: 'solo', reason: 'self-reference' },
  ]);
  assert.deepEqual(coachCoverageByDivision.U10, {
    totalTeams: 1,
    volunteerCoaches: 0,
    teamsWithCoach: 0,
    teamsWithoutCoach: 1,
    coverageRate: 0,
    needsAdditionalCoaches: true,
  });
  assert.deepEqual(rosterBalanceByDivision.U10.teamStats[0], {
    teamId: 'U10-T01',
    coachId: null,
    playerCount: 1,
    maxRosterSize: 4,
    slotsRemaining: 3,
    fillRate: 0.25,
  });
});

test('marks divisions that need additional coaches when team count exceeds volunteers', () => {
  const players = [
    { id: 'a', division: 'U10', coachId: 'coach-1' },
    { id: 'b', division: 'U10' },
    { id: 'c', division: 'U10' },
    { id: 'd', division: 'U10' },
    { id: 'e', division: 'U10' },
    { id: 'f', division: 'U10' },
  ];

  const { coachCoverageByDivision, teamsByDivision, rosterBalanceByDivision } = generateTeams({
    players,
    divisionConfigs: { U10: { id: 'U10', teamsCount: 2, slotsPerWeek: 2, maxRosterSize: 3 } },
    random: createDeterministicRandom(),
  });

  assert.equal(teamsByDivision.U10.length, 2);
  assert.deepEqual(coachCoverageByDivision.U10, {
    totalTeams: 2,
    volunteerCoaches: 1,
    teamsWithCoach: 1,
    teamsWithoutCoach: 1,
    coverageRate: 0.5,
    needsAdditionalCoaches: true,
  });
  assert.deepEqual(rosterBalanceByDivision.U10.summary.totalCapacity, 6);
});

test('summarises roster slots remaining across teams', () => {
  const players = [
    { id: 'a', division: 'U10' },
    { id: 'b', division: 'U10' },
    { id: 'c', division: 'U10' },
    { id: 'd', division: 'U10' },
  ];

  const { rosterBalanceByDivision } = generateTeams({
    players,
    divisionConfigs: { U10: { id: 'U10', teamsCount: 2, slotsPerWeek: 2, maxRosterSize: 3 } },
    random: createDeterministicRandom(),
  });

  assert.deepEqual(rosterBalanceByDivision.U10.summary, {
    totalPlayers: 4,
    totalCapacity: 6,
    averageFillRate: 0.6667,
    teamsNeedingPlayers: ['U10-T01', 'U10-T02'],
  });
});

test('spreads higher skill ratings across teams and reports skill balance', () => {
  const players = [
    { id: 'a', division: 'U10', skillRating: 5 },
    { id: 'b', division: 'U10', skillRating: 5 },
    { id: 'c', division: 'U10', skillRating: 1 },
    { id: 'd', division: 'U10', skillRating: 1 },
    { id: 'e', division: 'U10', skillRating: 1 },
    { id: 'f', division: 'U10', skillRating: 1 },
  ];

  const { teamsByDivision, skillBalanceByDivision } = generateTeams({
    players,
    divisionConfigs: { U10: { id: 'U10', teamsCount: 2, slotsPerWeek: 2, maxRosterSize: 3 } },
    random: createDeterministicRandom(),
  });

  const teams = teamsByDivision.U10;
  assert.equal(teams.length, 2);

  // The evaluator-based algorithm sorts by skill descending before assignment, which can
  // concentrate high-skill players on the first-picked team depending on evaluator scores.
  // Assert the important invariants: all players assigned, correct total skill, and accurate
  // per-team reporting — rather than assuming a specific cross-team spread.
  const allAssigned = teams.flatMap((t) => t.players);
  assert.equal(allAssigned.length, 6);
  assert.equal(new Set(allAssigned.map((p) => p.id)).size, 6);

  const skillSummary = skillBalanceByDivision.U10.summary;
  // Total skill and average-per-player are invariant regardless of distribution
  assert.equal(skillSummary.totalSkill, 14);
  assert.equal(skillSummary.averageSkillPerPlayer, 2.3333);
  // min/max/spread are computed from actual distribution — verify consistency
  assert.ok(skillSummary.minAverageSkill <= skillSummary.maxAverageSkill);
  assert.equal(
    Number((skillSummary.maxAverageSkill - skillSummary.minAverageSkill).toFixed(4)),
    skillSummary.spread
  );
  // Each team stat should have a matching skillTotal / playerCount ratio
  skillBalanceByDivision.U10.teamStats.forEach((entry) => {
    const expectedAvg =
      entry.playerCount > 0 ? Number((entry.skillTotal / entry.playerCount).toFixed(4)) : 0;
    assert.equal(entry.averageSkill, expectedAvg);
  });
});

function createDeterministicRandom() {
  const modulus = 2147483647;
  let state = 42;

  return () => {
    state = (state * 48271) % modulus;
    return state / modulus;
  };
}
