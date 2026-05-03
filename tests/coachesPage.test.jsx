import { describe, expect, it } from 'vitest';
import {
  buildCoachReviewRows,
  filterCoachReviewRows,
  summarizeCoachRows,
} from '../frontend/src/pages/CoachesPage.jsx';

const divisions = [
  { id: 'u8', name: 'U8 Coed' },
  { id: 'u10', name: 'U10 Girls' },
];

const players = [
  { id: 'p1', first_name: 'Riley', last_name: 'Reyes' },
  { id: 'p2', first_name: 'Jordan', last_name: 'Brooks' },
];

const coaches = [
  {
    id: 'coach-active',
    full_name: 'Alex Active',
    email: 'alex@example.com',
    phone: '555-1000',
    status: 'active',
    last_imported_at: '2026-04-01T00:00:00Z',
    can_coach_multiple_teams: true,
  },
  {
    id: 'coach-lead',
    full_name: 'Morgan Lead',
    email: 'morgan@example.com',
    status: 'interested',
    import_source: 'player_import_lead',
  },
  {
    id: 'coach-inactive',
    full_name: 'Inactive Coach',
    email: 'inactive@example.com',
    status: 'inactive',
  },
];

const interestedPrograms = [
  {
    id: 'interest-1',
    coach_id: 'coach-lead',
    division_id: 'u8',
    inferred_from_player_id: 'p1',
  },
  {
    id: 'interest-2',
    coach_id: 'coach-lead',
    division_id: 'u10',
    inferred_from_player_id: 'p2',
  },
];

const teams = [{ id: 'team-1', name: 'Blue Sharks', coach_id: 'coach-active', division_id: 'u8' }];

describe('coach review page helpers', () => {
  it('builds coach rows with status groups, lead programs, source players, and teams', () => {
    const rows = buildCoachReviewRows({ coaches, interestedPrograms, divisions, players, teams });

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      id: 'coach-active',
      statusLabel: 'Registered',
      statusGroup: 'registered',
      canCoachMultipleTeams: true,
      teams: [{ id: 'team-1', name: 'Blue Sharks', divisionId: 'u8' }],
    });
    expect(rows[1]).toMatchObject({
      id: 'coach-lead',
      statusLabel: 'Interested',
      statusGroup: 'interested',
      programNames: ['U8 Coed', 'U10 Girls'],
      playerNames: ['Riley Reyes', 'Jordan Brooks'],
    });
  });

  it('summarizes roster action buckets', () => {
    const rows = buildCoachReviewRows({ coaches, interestedPrograms, divisions, players, teams });

    expect(summarizeCoachRows(rows)).toEqual({
      total: 3,
      registered: 1,
      interested: 1,
      inactive: 1,
      unassigned: 2,
    });
  });

  it('filters by status, division, and visible text search', () => {
    const rows = buildCoachReviewRows({ coaches, interestedPrograms, divisions, players, teams });

    expect(filterCoachReviewRows(rows, { status: 'interested' }).map((row) => row.id)).toEqual([
      'coach-lead',
    ]);
    expect(filterCoachReviewRows(rows, { divisionId: 'u10' }).map((row) => row.id)).toEqual([
      'coach-lead',
    ]);
    expect(filterCoachReviewRows(rows, { search: 'blue sharks' }).map((row) => row.id)).toEqual([
      'coach-active',
    ]);
  });
});
