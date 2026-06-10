/**
 * Coach continuity & assistant backfill (project-hardening PR 06): unit tests for
 * applyCoachContinuity plus generateTeams integration for the incremental coach paths.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { applyCoachContinuity } from '../packages/core/src/coachContinuity.js';
import { generateTeams } from '../packages/core/src/teamGeneration.js';
import { createDeterministicRandom } from './fixtures/incrementalTeamingFixtures.js';

const U10_CONFIG = { id: 'U10', teamsCount: 3, slotsPerWeek: 4, maxRosterSize: 4 };

function shellTeam(overrides = {}) {
  return {
    id: 'team-1',
    division: 'U10',
    coachId: null,
    assistantCoachIds: [],
    locked: false,
    players: [],
    ...overrides,
  };
}

// ---------- applyCoachContinuity (unit) ----------

test('a dropped head coach is cleared, recorded, and the roster preserved', () => {
  const result = applyCoachContinuity({
    teams: [shellTeam({ coachId: 'coach-gone', players: [{ id: 'p1' }, { id: 'p2' }] })],
    divisionPlayers: [{ id: 'p1' }, { id: 'p2' }],
    changePolicy: {},
  });

  const team = result.teams[0];
  assert.equal(team.coachId, null);
  assert.equal(team.previousCoachId, 'coach-gone');
  assert.equal(team.players.length, 2, 'roster untouched');
  assert.deepEqual(result.coachDrops, [{ teamId: 'team-1', coachId: 'coach-gone' }]);
});

test('an explicit coachReplacementMap updates the same team to the new coach id', () => {
  const result = applyCoachContinuity({
    teams: [shellTeam({ coachId: 'coach-old' })],
    divisionPlayers: [],
    changePolicy: { coachReplacementMap: { 'coach-old': 'coach-new' } },
  });

  assert.equal(result.teams[0].coachId, 'coach-new');
  assert.deepEqual(result.coachReplacements, [
    { teamId: 'team-1', fromCoachId: 'coach-old', toCoachId: 'coach-new' },
  ]);
  assert.deepEqual(result.coachDrops, []);
});

test('household replacement applies only with a single candidate and explicit opt-in', () => {
  const teams = [
    shellTeam({ coachId: 'coach-gone', players: [{ id: 'p1', coachId: 'parent-2' }] }),
  ];
  const divisionPlayers = [{ id: 'p1', coachId: 'parent-2' }];

  const withoutOptIn = applyCoachContinuity({ teams, divisionPlayers, changePolicy: {} });
  assert.equal(withoutOptIn.teams[0].coachId, null, 'no silent replacement');
  assert.ok(
    withoutOptIn.manualReview.some((m) => m.code === 'coach-replacement-candidate'),
    'candidate surfaced for manual review'
  );

  const withOptIn = applyCoachContinuity({
    teams,
    divisionPlayers,
    changePolicy: { allowHouseholdCoachReplacement: true },
  });
  assert.equal(withOptIn.teams[0].coachId, 'parent-2');
  assert.deepEqual(withOptIn.coachReplacements, [
    { teamId: 'team-1', fromCoachId: 'coach-gone', toCoachId: 'parent-2' },
  ]);
});

test('an ambiguous household replacement never mutates and emits manual review', () => {
  const result = applyCoachContinuity({
    teams: [
      shellTeam({
        coachId: 'coach-gone',
        players: [
          { id: 'p1', coachId: 'parent-a' },
          { id: 'p2', coachId: 'parent-b' },
        ],
      }),
    ],
    divisionPlayers: [
      { id: 'p1', coachId: 'parent-a' },
      { id: 'p2', coachId: 'parent-b' },
    ],
    changePolicy: { allowHouseholdCoachReplacement: true },
  });

  assert.equal(result.teams[0].coachId, null, 'ambiguity does not guess');
  assert.ok(result.manualReview.some((m) => m.code === 'ambiguous-coach-replacement'));
  assert.deepEqual(result.coachReplacements, []);
});

test('a late head coach attaches to their child’s coachless preserved team by default', () => {
  const result = applyCoachContinuity({
    teams: [shellTeam({ players: [{ id: 'p1', coachId: 'new-coach' }] })],
    divisionPlayers: [{ id: 'p1', coachId: 'new-coach' }],
    changePolicy: {},
  });

  assert.equal(result.teams[0].coachId, 'new-coach');
  assert.deepEqual(result.coachReplacements, [
    { teamId: 'team-1', fromCoachId: null, toCoachId: 'new-coach' },
  ]);

  const disabled = applyCoachContinuity({
    teams: [shellTeam({ players: [{ id: 'p1', coachId: 'new-coach' }] })],
    divisionPlayers: [{ id: 'p1', coachId: 'new-coach' }],
    changePolicy: { allowLateCoachAttachToChildTeam: false },
  });
  assert.equal(disabled.teams[0].coachId, null, 'opt-out respected');
});

test('an adult already anchoring another team is not attached a second time', () => {
  const result = applyCoachContinuity({
    teams: [
      shellTeam({ id: 'team-1', coachId: 'adult-1', players: [{ id: 'p1', coachId: 'adult-1' }] }),
      shellTeam({ id: 'team-2', players: [{ id: 'p2', coachId: 'adult-1' }] }),
    ],
    divisionPlayers: [
      { id: 'p1', coachId: 'adult-1' },
      { id: 'p2', coachId: 'adult-1' },
    ],
    changePolicy: {},
  });

  assert.equal(result.teams[0].coachId, 'adult-1', 'existing anchor kept');
  assert.equal(result.teams[1].coachId, null, 'no silent duplicate anchoring');
});

test('two preserved teams anchored by the same active adult both keep their coach', () => {
  const result = applyCoachContinuity({
    teams: [
      shellTeam({ id: 'team-1', coachId: 'multi-coach' }),
      shellTeam({ id: 'team-2', coachId: 'multi-coach' }),
    ],
    divisionPlayers: [{ id: 'p1', coachId: 'multi-coach' }],
    changePolicy: {},
  });

  assert.equal(result.teams[0].coachId, 'multi-coach');
  assert.equal(result.teams[1].coachId, 'multi-coach', 'distinct team anchors not collapsed');
});

test('a locked team never has its coach mutated, even via the replacement map', () => {
  const result = applyCoachContinuity({
    teams: [shellTeam({ coachId: 'coach-gone', locked: true })],
    divisionPlayers: [],
    changePolicy: { coachReplacementMap: { 'coach-gone': 'coach-new' } },
  });

  assert.equal(result.teams[0].coachId, 'coach-gone');
  assert.equal(result.teams[0].coachInactive, true);
  assert.deepEqual(result.coachDrops, [{ teamId: 'team-1', coachId: 'coach-gone' }]);
});

test('an explicit replacement target already anchoring another team goes to manual review', () => {
  const result = applyCoachContinuity({
    teams: [
      shellTeam({ id: 'team-1', coachId: 'coach-z' }),
      shellTeam({ id: 'team-2', coachId: 'coach-x' }),
    ],
    divisionPlayers: [
      { id: 'p1', coachId: 'coach-z' },
      { id: 'p2', coachId: 'coach-x' },
    ],
    changePolicy: { coachReplacementMap: { 'coach-x': 'coach-z' } },
  });

  assert.equal(result.teams[1].coachId, 'coach-x', 'no silent double anchoring');
  assert.ok(result.manualReview.some((m) => m.code === 'coach-replacement-target-anchored'));
});

test('a pathological coach id never resolves through the prototype chain', () => {
  const result = applyCoachContinuity({
    teams: [shellTeam({ coachId: 'constructor' })],
    divisionPlayers: [{ id: 'p1', coachId: 'constructor' }],
    changePolicy: { coachReplacementMap: {} },
  });

  assert.equal(result.teams[0].coachId, 'constructor', 'no inherited-property replacement');
  assert.deepEqual(result.coachReplacements, []);
});

test('a lone candidate anchored elsewhere is surfaced instead of vanishing silently', () => {
  const result = applyCoachContinuity({
    teams: [
      shellTeam({ id: 'team-1', coachId: 'adult-1' }),
      shellTeam({
        id: 'team-2',
        coachId: 'coach-gone',
        players: [{ id: 'p2', coachId: 'adult-1' }],
      }),
    ],
    divisionPlayers: [
      { id: 'p1', coachId: 'adult-1' },
      { id: 'p2', coachId: 'adult-1' },
    ],
    changePolicy: { allowHouseholdCoachReplacement: true },
  });

  assert.equal(result.teams[1].coachId, null);
  assert.ok(result.manualReview.some((m) => m.code === 'coach-candidates-anchored-elsewhere'));
});

test('snake_case coach_id references keep a preserved coach active', () => {
  const result = applyCoachContinuity({
    teams: [shellTeam({ coachId: 'c1', players: [{ id: 'p1', coach_id: 'c1' }] })],
    divisionPlayers: [{ id: 'p1', coach_id: 'c1' }],
    changePolicy: {},
  });

  assert.equal(result.teams[0].coachId, 'c1', 'import-shaped coach reference counts as active');
  assert.deepEqual(result.coachDrops, []);
});

test('an explicit replacement applies consistently across teams sharing the same coach', () => {
  const result = applyCoachContinuity({
    teams: [
      shellTeam({ id: 'team-1', coachId: 'coach-old' }),
      shellTeam({ id: 'team-2', coachId: 'coach-old' }),
    ],
    divisionPlayers: [],
    changePolicy: { coachReplacementMap: { 'coach-old': 'coach-new' } },
  });

  assert.equal(result.teams[0].coachId, 'coach-new');
  assert.equal(result.teams[1].coachId, 'coach-new', 'shared anchor replaced on every team');
  assert.equal(result.coachReplacements.length, 2);
  assert.deepEqual(result.manualReview, []);
});

// ---------- generateTeams integration (incremental) ----------

function snapshotWith(teams) {
  return { status: 'published', teamsByDivision: { U10: teams } };
}

test('integration: dropped head coach preserves roster and marks team coach-needed', () => {
  const result = generateTeams({
    players: [
      { id: 'p1', division: 'U10' },
      { id: 'p2', division: 'U10' },
    ],
    divisionConfigs: { U10: U10_CONFIG },
    random: createDeterministicRandom(),
    existingSnapshot: snapshotWith([
      {
        id: 'team-1',
        division: 'U10',
        coachId: 'coach-gone',
        players: [{ id: 'p1' }, { id: 'p2' }],
      },
    ]),
    generationMode: 'published',
  });

  const team = result.teamsByDivision.U10[0];
  assert.deepEqual(team.players.map((p) => p.id).sort(), ['p1', 'p2'], 'roster preserved');
  assert.equal(team.coachNeeded, true);
  assert.deepEqual(result.changeDiagnosticsByDivision.U10.coachDrops, [
    { teamId: 'team-1', coachId: 'coach-gone' },
  ]);
});

test('integration: late head coach attaches to the coachless team holding their child', () => {
  const result = generateTeams({
    players: [
      { id: 'p1', division: 'U10', coachId: 'new-coach' },
      { id: 'p2', division: 'U10' },
    ],
    divisionConfigs: { U10: U10_CONFIG },
    random: createDeterministicRandom(),
    existingSnapshot: snapshotWith([
      { id: 'team-1', division: 'U10', players: [{ id: 'p1' }, { id: 'p2' }] },
    ]),
    generationMode: 'published',
  });

  const team = result.teamsByDivision.U10[0];
  assert.equal(team.coachId, 'new-coach');
  assert.equal(team.coachNeeded, false);
  assert.deepEqual(result.changeDiagnosticsByDivision.U10.coachReplacements, [
    { teamId: 'team-1', fromCoachId: null, toCoachId: 'new-coach' },
  ]);
});

test('integration: a late assistant-only unit backfills a coached team without assistants', () => {
  const result = generateTeams({
    players: [
      { id: 'p1', division: 'U10', coachId: 'coach-1' },
      { id: 'p2', division: 'U10' },
      { id: 'late-kid', division: 'U10', assistantCoachId: 'asst-9' },
    ],
    divisionConfigs: { U10: U10_CONFIG },
    random: createDeterministicRandom(),
    existingSnapshot: snapshotWith([
      {
        id: 'team-1',
        division: 'U10',
        coachId: 'coach-1',
        players: [{ id: 'p1' }, { id: 'p2' }],
      },
    ]),
    generationMode: 'published',
  });

  const team = result.teamsByDivision.U10[0];
  assert.ok(
    team.players.some((p) => p.id === 'late-kid'),
    'assistant child joins the coached team'
  );
  assert.deepEqual(team.assistantCoachIds, ['asst-9']);
  assert.deepEqual(result.changeDiagnosticsByDivision.U10.assistantBackfills, [
    { teamId: 'team-1', assistantCoachIds: ['asst-9'] },
  ]);
  assert.equal(result.teamsByDivision.U10.length, 1, 'no ghost shell created');
});

test('integration: an assistant-only unit does not create a ghost team by default', () => {
  // The only preserved team is FULL, so no backfill target exists; under preserve-existing the
  // unit must not create a shell — it overflows like a general unit instead.
  const result = generateTeams({
    players: [
      { id: 'p1', division: 'U10' },
      { id: 'p2', division: 'U10' },
      { id: 'p3', division: 'U10' },
      { id: 'p4', division: 'U10' },
      { id: 'late-kid', division: 'U10', assistantCoachId: 'asst-9' },
    ],
    divisionConfigs: { U10: U10_CONFIG },
    random: createDeterministicRandom(),
    existingSnapshot: snapshotWith([
      {
        id: 'team-1',
        division: 'U10',
        coachId: 'coach-1',
        players: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }],
      },
    ]),
    generationMode: 'published',
  });

  assert.equal(result.teamsByDivision.U10.length, 1, 'no ghost team');
  assert.equal(result.overflowSummaryByDivision.U10.totalPlayers, 1, 'late kid overflows');
});

test('integration: a locked team with a dropped coach is emitted coach-needed', () => {
  const result = generateTeams({
    players: [{ id: 'p1', division: 'U10' }],
    divisionConfigs: { U10: U10_CONFIG },
    random: createDeterministicRandom(),
    existingSnapshot: snapshotWith([
      {
        id: 'team-1',
        division: 'U10',
        coachId: 'coach-gone',
        locked: true,
        players: [{ id: 'p1' }],
      },
    ]),
    generationMode: 'published',
  });

  const team = result.teamsByDivision.U10[0];
  assert.equal(team.coachId, 'coach-gone', 'locked coach assignment untouched');
  assert.equal(team.coachNeeded, true, 'inactive coach surfaces as coach-needed');
  // The coverage summary agrees with the team flag.
  const coverage = result.coachCoverageByDivision.U10;
  assert.equal(coverage.teamsWithoutCoach, 1);
  assert.equal(coverage.needsAdditionalCoaches, true);
  assert.equal(coverage.volunteerCoaches, 0, 'an inactive coach is not a volunteer');
});

test('integration: numeric coach ids match their continuity-attached team', () => {
  const result = generateTeams({
    players: [
      { id: 'p1', division: 'U10', coachId: /** @type {any} */ (42) },
      { id: 'late-kid', division: 'U10', coachId: /** @type {any} */ (42) },
    ],
    divisionConfigs: { U10: U10_CONFIG },
    random: createDeterministicRandom(),
    existingSnapshot: snapshotWith([{ id: 'team-1', division: 'U10', players: [{ id: 'p1' }] }]),
    generationMode: 'draft',
  });

  assert.equal(result.teamsByDivision.U10.length, 1, 'no duplicate team for the same adult');
  const team = result.teamsByDivision.U10[0];
  assert.ok(
    team.players.some((p) => p.id === 'late-kid'),
    'late coach child joins the attached team'
  );
});

test('integration: a snapshot-only division keeps its coach metadata intact', () => {
  const result = generateTeams({
    players: [{ id: 'a', division: 'U10' }],
    divisionConfigs: {
      U10: U10_CONFIG,
      U12: { id: 'U12', teamsCount: 1, slotsPerWeek: 1, maxRosterSize: 4 },
    },
    random: createDeterministicRandom(),
    existingSnapshot: {
      status: 'published',
      teamsByDivision: {
        U12: [{ id: 'u12-1', division: 'U12', coachId: 'coach-u12', players: [{ id: 'q1' }] }],
      },
    },
    generationMode: 'published',
  });

  const team = result.teamsByDivision.U12[0];
  assert.equal(team.coachId, 'coach-u12', 'partial import does not wipe coach anchors');
  assert.deepEqual(result.changeDiagnosticsByDivision.U12.coachDrops ?? [], []);
});

test('integration: fresh assistant-only units backfill existing teams instead of creating shells', () => {
  const result = generateTeams({
    players: [
      { id: 'a', division: 'U10', coachId: 'coach-1' },
      { id: 'b', division: 'U10' },
      { id: 'c', division: 'U10' },
      { id: 'd', division: 'U10', assistantCoachId: 'asst-1' },
    ],
    divisionConfigs: { U10: { id: 'U10', teamsCount: 1, slotsPerWeek: 1, maxRosterSize: 4 } },
    random: createDeterministicRandom(),
  });

  const teams = result.teamsByDivision.U10;
  assert.equal(teams.length, 1, 'assistant unit backfills the coached team, no ghost shell');
  assert.equal(teams[0].coachId, 'coach-1');
  assert.deepEqual(teams[0].assistantCoachIds, ['asst-1']);
});
