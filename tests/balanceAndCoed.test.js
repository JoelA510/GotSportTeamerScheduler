import { describe, expect, it } from 'vitest';
import {
  balanceSignalKind,
  playerSignal,
  teamBalanceMetrics,
  buddyStats,
  serpentineAssign,
} from '../packages/core/src/balanceSignals.js';
import {
  normalizeGender,
  planCoedMerge,
  planGenderSplit,
} from '../packages/core/src/coedTransition.js';

/** @returns {any} */
const player = (id, overrides = {}) => ({
  id,
  first_name: `P${id}`,
  last_name: 'Test',
  gender: 'm',
  ...overrides,
});

describe('balanceSignals', () => {
  it('selects the signal kind from the feature config', () => {
    expect(balanceSignalKind({ player_rating: true, years_played: true })).toBe('rating');
    expect(balanceSignalKind({ years_played: true })).toBe('years');
    expect(balanceSignalKind({})).toBe('size');
  });

  it('computes player signals per kind (years = yearsPlayed + 1)', () => {
    expect(playerSignal({ rating: 4 }, 'rating')).toBe(4);
    expect(playerSignal({ years_played: 2 }, 'years')).toBe(3);
    expect(playerSignal({ years_played: 0 }, 'years')).toBe(1);
    expect(playerSignal({}, 'size')).toBe(1);
  });

  it('computes team metrics', () => {
    const metrics = teamBalanceMetrics([
      player(1, { gender: 'm', rating: 4, years_played: 2 }),
      player(2, { gender: 'f', rating: 2, years_played: 0 }),
    ]);
    expect(metrics).toMatchObject({ size: 2, boys: 1, girls: 1, avgRating: 3, avgYears: 1 });
  });

  it('tracks buddy satisfaction by shared team', () => {
    const players = [
      player('a', { first_name: 'Sam', last_name: 'Lee', buddy_request: 'Kim Cho', team_id: 't1' }),
      player('b', { first_name: 'Kim', last_name: 'Cho', team_id: 't1' }),
      player('c', { first_name: 'Joy', last_name: 'Wu', buddy_request: 'Sam Lee', team_id: 't2' }),
      player('d', { first_name: 'Ana', last_name: 'Iz', buddy_request: 'Nobody Here' }),
    ];
    expect(buddyStats(players)).toEqual({ requested: 2, satisfied: 1 });
  });

  it('serpentine-assigns with buddies kept together and coach parents spread', () => {
    const players = [
      player(1, { rating: 5, willing_to_coach: true }),
      player(2, { rating: 5, willing_to_coach: true }),
      player(3, {
        rating: 4,
        first_name: 'Ben',
        last_name: 'Kay',
        buddy_request: 'Lia Ray',
      }),
      player(4, { rating: 1, first_name: 'Lia', last_name: 'Ray' }),
      player(5, { rating: 3 }),
      player(6, { rating: 2 }),
    ];
    const teams = [{ id: 't1' }, { id: 't2' }];
    const assignments = serpentineAssign({
      players,
      teams,
      signalKind: 'rating',
      respectBuddies: true,
      respectCoach: true,
    });

    expect(assignments).toHaveLength(6);
    const teamOf = Object.fromEntries(assignments.map((a) => [a.playerId, a.teamId]));
    // buddy pair shares a team
    expect(teamOf[3]).toBe(teamOf[4]);
    // coach parents land on different teams
    expect(teamOf[1]).not.toBe(teamOf[2]);
    // signal totals are balanced within one unit
    const totals = { t1: 0, t2: 0 };
    assignments.forEach((a) => {
      const p = players.find((entry) => entry.id === a.playerId);
      totals[a.teamId] += Number(p?.rating) || 0;
    });
    expect(Math.abs(totals.t1 - totals.t2)).toBeLessThanOrEqual(2);
  });

  it('returns no assignments when there are no teams', () => {
    expect(serpentineAssign({ players: [player(1)], teams: [] })).toEqual([]);
  });
});

describe('coedTransition', () => {
  const divisions = [
    { id: 'd-u8b', name: 'U8B', gender_policy: 'boys' },
    { id: 'd-u8g', name: 'U8G', gender_policy: 'girls' },
    { id: 'd-u10', name: 'U10 Coed', gender_policy: 'coed' },
  ];

  it('plans a co-ed merge per age group with summed team counts', () => {
    const players = [
      player('p1', { division_id: 'd-u8b' }),
      player('p2', { division_id: 'd-u8b' }),
      player('p3', { division_id: 'd-u8g', gender: 'f' }),
    ];
    const teams = [
      { id: 't1', division_id: 'd-u8b' },
      { id: 't2', division_id: 'd-u8g' },
    ];
    const { merges } = planCoedMerge({ divisions, players, teams });
    expect(merges).toHaveLength(1);
    expect(merges[0]).toMatchObject({
      age: 8,
      divisionUpsert: { name: 'U8', gender_policy: 'coed' },
      teamCount: 2,
    });
    expect(merges[0].sourceDivisionIds.sort()).toEqual(['d-u8b', 'd-u8g']);
    expect(merges[0].playerIds.sort()).toEqual(['p1', 'p2', 'p3']);
  });

  it('plans a gender split with proportional teams and each gender ≥ 1', () => {
    const players = [
      ...Array.from({ length: 9 }, (_, i) => player(`b${i}`, { division_id: 'd-u10' })),
      ...Array.from({ length: 3 }, (_, i) =>
        player(`g${i}`, { division_id: 'd-u10', gender: 'f' })
      ),
    ];
    const teams = [
      { id: 't1', division_id: 'd-u10' },
      { id: 't2', division_id: 'd-u10' },
      { id: 't3', division_id: 'd-u10' },
    ];
    const { splits } = planGenderSplit({ divisions, players, teams });
    expect(splits).toHaveLength(1);
    const [split] = splits;
    expect(split.sourceDivisionId).toBe('d-u10');
    const boys = split.targets.find((t) => t.divisionUpsert.gender_policy === 'boys');
    const girls = split.targets.find((t) => t.divisionUpsert.gender_policy === 'girls');
    expect(boys.divisionUpsert.name).toBe('U10B');
    expect(girls.divisionUpsert.name).toBe('U10G');
    expect(boys.playerIds).toHaveLength(9);
    expect(girls.playerIds).toHaveLength(3);
    // 3 teams, 75%/25% headcount → 2 + 1 with each gender ≥ 1
    expect(boys.teamCount).toBe(2);
    expect(girls.teamCount).toBe(1);
    expect(boys.teamCount + girls.teamCount).toBe(3);
  });

  it('gives each gender at least one team even when the source had a single team', () => {
    const players = [
      ...Array.from({ length: 12 }, (_, i) => player(`b${i}`, { division_id: 'd-u10' })),
      ...Array.from({ length: 2 }, (_, i) =>
        player(`g${i}`, { division_id: 'd-u10', gender: 'f' })
      ),
    ];
    const teams = [{ id: 't1', division_id: 'd-u10' }];
    const { splits } = planGenderSplit({ divisions, players, teams });
    const boys = splits[0].targets.find((t) => t.divisionUpsert.gender_policy === 'boys');
    const girls = splits[0].targets.find((t) => t.divisionUpsert.gender_policy === 'girls');
    expect(boys.teamCount).toBeGreaterThanOrEqual(1);
    expect(girls.teamCount).toBeGreaterThanOrEqual(1);
  });

  it('keeps preferred-name buddy requests together in serpentineAssign', () => {
    const players = [
      player('a', {
        first_name: 'Samantha',
        last_name: 'Brown',
        preferred_name: 'Sam',
        rating: 3,
      }),
      player('b', { first_name: 'Kim', last_name: 'Cho', buddy_request: 'Sam Brown', rating: 3 }),
      player('c', { rating: 5 }),
      player('d', { rating: 1 }),
    ];
    const assignments = serpentineAssign({
      players,
      teams: [{ id: 't1' }, { id: 't2' }],
      signalKind: 'rating',
      respectBuddies: true,
      respectCoach: false,
    });
    const teamOf = Object.fromEntries(assignments.map((x) => [x.playerId, x.teamId]));
    expect(teamOf.a).toBe(teamOf.b);
  });

  it('skips age groups that are already co-ed only', () => {
    const { merges } = planCoedMerge({
      divisions: [{ id: 'd-u10', name: 'U10 Coed' }],
      players: [],
      teams: [],
    });
    expect(merges).toEqual([]);
  });

  it('normalizes raw imported gender text', () => {
    expect(normalizeGender('Male')).toBe('m');
    expect(normalizeGender('M')).toBe('m');
    expect(normalizeGender('boy')).toBe('m');
    expect(normalizeGender('Female')).toBe('f');
    expect(normalizeGender('F')).toBe('f');
    expect(normalizeGender('Girl')).toBe('f');
    expect(normalizeGender('')).toBe(null);
    expect(normalizeGender(null)).toBe(null);
    expect(normalizeGender('x')).toBe(null);
  });

  it('splits divisions whose players carry raw imported gender values', () => {
    const divisions = [{ id: 'd-u10', name: 'U10', gender_policy: 'coed' }];
    const players = [
      player('b1', { division_id: 'd-u10', gender: 'Male' }),
      player('b2', { division_id: 'd-u10', gender: 'Boy' }),
      player('g1', { division_id: 'd-u10', gender: 'Female' }),
      player('g2', { division_id: 'd-u10', gender: 'GIRL' }),
    ];
    const { splits } = planGenderSplit({ divisions, players, teams: [] });
    expect(splits).toHaveLength(1);
    const boys = splits[0].targets.find((t) => t.divisionUpsert.gender_policy === 'boys');
    const girls = splits[0].targets.find((t) => t.divisionUpsert.gender_policy === 'girls');
    expect(boys.playerIds.sort()).toEqual(['b1', 'b2']);
    expect(girls.playerIds.sort()).toEqual(['g1', 'g2']);
  });
});
