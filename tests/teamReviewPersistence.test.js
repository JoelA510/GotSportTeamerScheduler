import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  buildManualRosterSnapshot,
  buildTeamReviewSnapshot,
  isUuid,
} from '../frontend/src/utils/teamReviewPersistence.js';

test('buildTeamReviewSnapshot prepares uuid-backed team and roster payloads', () => {
  const snapshot = buildTeamReviewSnapshot({
    generatedResult: {
      teamsByDivision: {
        U10: [
          {
            id: 'generator-team-1',
            name: 'U10 Team 1',
            division: 'U10',
            players: [
              { id: '11111111-1111-4111-8111-111111111111', name: 'Alex Smith' },
              { id: '22222222-2222-4222-8222-222222222222', name: 'Sam Jones' },
            ],
          },
        ],
      },
      rosterBalanceByDivision: {
        U10: {
          teamStats: [{ teamId: 'generator-team-1', playerCount: 2, slotsRemaining: 10 }],
          summary: {
            totalPlayers: 2,
            totalCapacity: 12,
            averageFillRate: 0.1667,
            teamsNeedingPlayers: ['generator-team-1'],
          },
        },
      },
      skillBalanceByDivision: {
        U10: { teamStats: [{ teamId: 'generator-team-1', averageSkill: 3 }] },
      },
      overflowSummaryByDivision: {},
    },
    divisionKey: 'U10',
    divisionId: '33333333-3333-4333-8333-333333333333',
    organizationId: '44444444-4444-4444-8444-444444444444',
    seasonSettingsId: '55555555-5555-4555-8555-555555555555',
    userId: '66666666-6666-4666-8666-666666666666',
    selectedProgramId: 'U10',
    divisionConfig: { maxRosterSize: 12 },
    nowIso: '2026-05-03T12:00:00.000Z',
    idFactory: () => '77777777-7777-4777-8777-777777777777',
  });

  assert.equal(snapshot.lastRunId.length, 36);
  assert.equal(snapshot.payload.teamRows[0].id, '77777777-7777-4777-8777-777777777777');
  assert.equal(snapshot.payload.teamRows[0].division_id, '33333333-3333-4333-8333-333333333333');
  assert.deepEqual(snapshot.payload.teamPlayerRows, [
    {
      team_id: '77777777-7777-4777-8777-777777777777',
      player_id: '11111111-1111-4111-8111-111111111111',
      role: 'player',
      source: 'auto',
      player_name: 'Alex Smith',
      skill: null,
    },
    {
      team_id: '77777777-7777-4777-8777-777777777777',
      player_id: '22222222-2222-4222-8222-222222222222',
      role: 'player',
      source: 'auto',
      player_name: 'Sam Jones',
      skill: null,
    },
  ]);
  assert.equal(
    snapshot.runMetadata.results.rosterBalanceByDivision.U10.teamStats[0].teamId,
    '77777777-7777-4777-8777-777777777777'
  );
  assert.equal(isUuid(snapshot.payload.teamRows[0].id), true);
});

test('buildManualRosterSnapshot marks dragged players manual and creates a new run', () => {
  const baseSnapshot = {
    lastRunId: '88888888-8888-4888-8888-888888888888',
    payload: {
      teamRows: [
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          name: 'Team A',
          division_id: '33333333-3333-4333-8333-333333333333',
        },
        {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          name: 'Team B',
          division_id: '33333333-3333-4333-8333-333333333333',
        },
      ],
      teamPlayerRows: [],
    },
    runMetadata: {
      results: {
        teams: [],
        teamsByDivision: {
          U10: [
            { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Team A' },
            { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Team B' },
          ],
        },
      },
    },
  };

  const snapshot = buildManualRosterSnapshot({
    baseSnapshot,
    teams: [
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', players: [] },
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        players: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            name: 'Alex Smith',
            assignment_source: 'manual',
          },
        ],
      },
    ],
    organizationId: '44444444-4444-4444-8444-444444444444',
    seasonSettingsId: '55555555-5555-4555-8555-555555555555',
    userId: '66666666-6666-4666-8666-666666666666',
    runId: '99999999-9999-4999-8999-999999999999',
    nowIso: '2026-05-03T12:00:00.000Z',
  });

  assert.equal(snapshot.lastRunId, '99999999-9999-4999-8999-999999999999');
  assert.deepEqual(snapshot.payload.teamPlayerRows, [
    {
      team_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      player_id: '11111111-1111-4111-8111-111111111111',
      role: 'player',
      source: 'manual',
      player_name: 'Alex Smith',
      skill: null,
    },
  ]);
  assert.equal(snapshot.runMetadata.metrics.manualAssignments, 1);
  assert.equal(snapshot.runMetadata.parameters.previousRunId, baseSnapshot.lastRunId);
});

test('buildManualRosterSnapshot remaps legacy non-uuid team ids before persistence', () => {
  const baseSnapshot = {
    lastRunId: 'legacy-run',
    payload: {
      teamRows: [{ id: 'U10-T01', name: 'Legacy Team', division: 'U10' }],
      teamPlayerRows: [],
    },
    runMetadata: {
      results: {
        teamsByDivision: {
          U10: [{ id: 'U10-T01', name: 'Legacy Team', division: 'U10' }],
        },
      },
    },
  };

  const snapshot = buildManualRosterSnapshot({
    baseSnapshot,
    teams: [
      {
        id: 'U10-T01',
        division: 'U10',
        players: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            name: 'Alex Smith',
            assignment_source: 'manual',
          },
        ],
      },
    ],
    organizationId: '44444444-4444-4444-8444-444444444444',
    seasonSettingsId: '55555555-5555-4555-8555-555555555555',
    userId: '66666666-6666-4666-8666-666666666666',
    divisionRows: [{ id: '33333333-3333-4333-8333-333333333333', name: 'U10' }],
    runId: '99999999-9999-4999-8999-999999999999',
    idFactory: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    nowIso: '2026-05-03T12:00:00.000Z',
  });

  assert.equal(snapshot.payload.teamRows[0].id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal(snapshot.payload.teamRows[0].division_id, '33333333-3333-4333-8333-333333333333');
  assert.equal(snapshot.payload.teamPlayerRows[0].team_id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal(
    snapshot.runMetadata.results.teamsByDivision.U10[0].id,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  );
});
