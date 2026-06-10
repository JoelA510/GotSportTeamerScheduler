/**
 * Change diagnostics & generation summaries (project-hardening PR 07): the finalized
 * changeDiagnosticsByDivision shape and the summarizeTeamGeneration extension.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { generateTeams } from '../packages/core/src/teamGeneration.js';
import { summarizeTeamGeneration } from '../packages/core/src/teamDiagnostics.js';
import { createDeterministicRandom } from './fixtures/incrementalTeamingFixtures.js';

const U10_CONFIG = { id: 'U10', teamsCount: 3, slotsPerWeek: 4, maxRosterSize: 4 };

function makePlayers(ids, division = 'U10') {
  return ids.map((id) => ({ id, division }));
}

function fullTwoTeamSnapshot() {
  return {
    status: 'published',
    teamsByDivision: {
      U10: [
        {
          id: 'team-1',
          division: 'U10',
          players: [
            { id: 'p1', assignment_source: 'manual' },
            { id: 'p2' },
            { id: 'p3' },
            { id: 'p4' },
          ],
        },
        {
          id: 'team-2',
          division: 'U10',
          players: [{ id: 'p5' }, { id: 'p6' }, { id: 'p7' }, { id: 'p8' }],
        },
      ],
    },
  };
}

test('changeDiagnostics exposes the full documented field set with stable types', () => {
  const result = generateTeams({
    players: makePlayers(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'late-1']),
    divisionConfigs: { U10: U10_CONFIG },
    random: createDeterministicRandom(),
    existingSnapshot: fullTwoTeamSnapshot(),
    generationMode: 'published',
  });

  const diag = result.changeDiagnosticsByDivision.U10;
  assert.equal(diag.mode, 'published');
  assert.equal(diag.teamCountPolicy, 'preserve-existing');
  assert.equal(typeof diag.existingTeamsPreserved, 'number');
  assert.equal(typeof diag.newTeamsCreated, 'number');
  assert.equal(typeof diag.teamCountChangeBlocked, 'boolean');
  assert.equal(typeof diag.lockedAssignmentsPreserved, 'number');
  assert.equal(typeof diag.latePlayersAssigned, 'number');
  assert.equal(typeof diag.latePlayersOverflowed, 'number');
  assert.equal(typeof diag.droppedPlayersRemoved, 'number');
  assert.equal(typeof diag.manualAssignmentsPreserved, 'number');
  for (const key of [
    'buddyTargetAssignments',
    'assistantBackfills',
    'coachDrops',
    'coachReplacements',
    'manualReview',
    'capacityViolations',
    'minRosterWarnings',
    'structuralWarnings',
  ]) {
    assert.ok(Array.isArray(diag[key]), `${key} is an array`);
  }
});

test('teamCountChangeBlocked is true when capacity overflow occurs under preserve-existing', () => {
  // Both preserved teams are full; the late player cannot fit and no team may be created.
  const blocked = generateTeams({
    players: makePlayers(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'late-1']),
    divisionConfigs: { U10: U10_CONFIG },
    random: createDeterministicRandom(),
    existingSnapshot: fullTwoTeamSnapshot(),
    generationMode: 'published',
  });
  assert.equal(blocked.changeDiagnosticsByDivision.U10.teamCountChangeBlocked, true);
  assert.equal(blocked.changeDiagnosticsByDivision.U10.latePlayersOverflowed, 1);

  // With room available nothing is blocked.
  const open = generateTeams({
    players: makePlayers(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']),
    divisionConfigs: { U10: U10_CONFIG },
    random: createDeterministicRandom(),
    existingSnapshot: fullTwoTeamSnapshot(),
    generationMode: 'published',
  });
  assert.equal(open.changeDiagnosticsByDivision.U10.teamCountChangeBlocked, false);
});

test('lockedAssignmentsPreserved counts manual locks in published mode', () => {
  const result = generateTeams({
    players: makePlayers(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']),
    divisionConfigs: { U10: U10_CONFIG },
    random: createDeterministicRandom(),
    existingSnapshot: fullTwoTeamSnapshot(),
    generationMode: 'published',
  });

  const diag = result.changeDiagnosticsByDivision.U10;
  assert.equal(diag.lockedAssignmentsPreserved, 1, 'the manual p1 assignment is locked');
  assert.equal(diag.manualAssignmentsPreserved, 1);

  const draft = generateTeams({
    players: makePlayers(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']),
    divisionConfigs: { U10: U10_CONFIG },
    random: createDeterministicRandom(),
    existingSnapshot: fullTwoTeamSnapshot(),
    generationMode: 'draft',
  });
  assert.equal(
    draft.changeDiagnosticsByDivision.U10.lockedAssignmentsPreserved,
    0,
    'draft mode does not lock manual assignments'
  );
});

test('summarizeTeamGeneration surfaces change diagnostics and incremental totals', () => {
  const result = generateTeams({
    players: makePlayers(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'late-1']),
    divisionConfigs: { U10: U10_CONFIG },
    random: createDeterministicRandom(),
    existingSnapshot: fullTwoTeamSnapshot(),
    generationMode: 'published',
  });

  const summary = summarizeTeamGeneration(result);
  const division = summary.divisions.find((d) => d.divisionId === 'U10');
  assert.ok(division.changes, 'per-division change diagnostics attached');
  assert.equal(division.changes.teamCountPolicy, 'preserve-existing');
  assert.equal(summary.totals.latePlayersOverflowed, 1);
  assert.equal(summary.totals.droppedPlayersRemoved, 0);
  assert.equal(typeof summary.totals.manualReviewCount, 'number');
});

test('summarizeTeamGeneration keeps the historical shape for fresh generation', () => {
  const result = generateTeams({
    players: makePlayers(['a', 'b', 'c', 'd']),
    divisionConfigs: { U10: U10_CONFIG },
    random: createDeterministicRandom(),
  });

  const summary = summarizeTeamGeneration(result);
  assert.ok(!('changes' in summary.divisions[0]), 'no changes key for fresh runs');
  assert.deepEqual(Object.keys(summary.totals).sort(), [
    'divisions',
    'divisionsNeedingCoaches',
    'divisionsWithOpenRosterSlots',
    'overflowPlayers',
    'playersAssigned',
    'teams',
  ]);
});

test('overflow entries carry actionable reason codes (no string parsing required)', () => {
  const result = generateTeams({
    players: makePlayers(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'late-1']),
    divisionConfigs: { U10: U10_CONFIG },
    random: createDeterministicRandom(),
    existingSnapshot: fullTwoTeamSnapshot(),
    generationMode: 'published',
  });

  for (const entry of result.overflowByDivision.U10) {
    assert.equal(typeof entry.reason, 'string');
    assert.match(entry.reason, /^[a-z-]+$/, 'machine-readable kebab-case reason');
  }
  assert.ok(result.overflowSummaryByDivision.U10.byReason['insufficient-capacity']);
});
