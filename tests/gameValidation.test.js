import { describe, test, expect } from 'vitest';
import {
  checkSlotAvailability,
  checkCoachConflict,
  validateGameMove,
} from '../packages/core/src/gameValidation.js';

// ── Test Data ───────────────────────────────────────────────────────────────

const TEAMS = [
  { id: 'team-1', division: 'U10', coachId: 'coach-a' },
  { id: 'team-2', division: 'U10', coachId: 'coach-b' },
  { id: 'team-3', division: 'U10', coachId: 'coach-a' },  // same coach as team-1
  { id: 'team-4', division: 'U10', coachId: 'coach-c' },
  { id: 'team-5', division: 'U12', coachId: null },        // no coach
  { id: 'team-6', division: 'U12', coachId: null },
];

const BASE_ASSIGNMENTS = [
  {
    id: 'ga-1',
    slotId: 'gs-1',
    fieldId: 'v1',
    homeTeamId: 'team-1',
    awayTeamId: 'team-2',
    start: '2026-04-04T08:00:00Z',
    end: '2026-04-04T09:00:00Z',
    weekIndex: 1,
    division: 'U10',
    assignmentSource: 'auto',
  },
  {
    id: 'ga-2',
    slotId: 'gs-2',
    fieldId: 'v2',
    homeTeamId: 'team-3',
    awayTeamId: 'team-4',
    start: '2026-04-04T08:00:00Z',
    end: '2026-04-04T09:00:00Z',
    weekIndex: 1,
    division: 'U10',
    assignmentSource: 'auto',
  },
  {
    id: 'ga-3',
    slotId: 'gs-3',
    fieldId: 'v1',
    homeTeamId: 'team-5',
    awayTeamId: 'team-6',
    start: '2026-04-04T09:30:00Z',
    end: '2026-04-04T10:30:00Z',
    weekIndex: 1,
    division: 'U12',
    assignmentSource: 'auto',
  },
];

// ── checkSlotAvailability ───────────────────────────────────────────────────

describe('checkSlotAvailability', () => {
  test('returns available when slot is empty', () => {
    const result = checkSlotAvailability({
      fieldId: 'v3',
      slotId: 'gs-1',
      assignments: BASE_ASSIGNMENTS,
      excludeId: null,
    });
    expect(result.available).toBe(true);
    expect(result.blockingAssignment).toBeNull();
  });

  test('returns unavailable when slot is occupied', () => {
    const result = checkSlotAvailability({
      fieldId: 'v1',
      slotId: 'gs-1',
      assignments: BASE_ASSIGNMENTS,
      excludeId: null,
    });
    expect(result.available).toBe(false);
    expect(result.blockingAssignment).toEqual(BASE_ASSIGNMENTS[0]);
  });

  test('excludes the dragged assignment from conflict check', () => {
    // ga-1 occupies v1:gs-1, but if we're dragging ga-1, it should be excluded
    const result = checkSlotAvailability({
      fieldId: 'v1',
      slotId: 'gs-1',
      assignments: BASE_ASSIGNMENTS,
      excludeId: 'ga-1',
    });
    expect(result.available).toBe(true);
  });

  test('handles string/number coercion for fieldId and slotId', () => {
    const assignments = [
      { ...BASE_ASSIGNMENTS[0], fieldId: 1, slotId: 100 },
    ];
    const result = checkSlotAvailability({
      fieldId: '1',
      slotId: '100',
      assignments,
    });
    expect(result.available).toBe(false);
  });

  test('returns available:false for missing parameters', () => {
    expect(checkSlotAvailability({ fieldId: null, slotId: 'gs-1', assignments: [] }).available).toBe(false);
    expect(checkSlotAvailability({ fieldId: 'v1', slotId: null, assignments: [] }).available).toBe(false);
    expect(checkSlotAvailability({ fieldId: 'v1', slotId: 'gs-1', assignments: null }).available).toBe(false);
  });
});

// ── checkCoachConflict ──────────────────────────────────────────────────────

describe('checkCoachConflict', () => {
  test('returns no conflict when coaches have no overlapping games', () => {
    // Move ga-1 (teams 1+2, coaches a+b) to a time that doesn't overlap with ga-2
    const result = checkCoachConflict({
      game: BASE_ASSIGNMENTS[0],
      targetStart: '2026-04-04T11:00:00Z',
      targetEnd: '2026-04-04T12:00:00Z',
      assignments: BASE_ASSIGNMENTS,
      teams: TEAMS,
    });
    expect(result.hasConflict).toBe(false);
  });

  test('detects conflict when same coach has overlapping games', () => {
    // ga-2 has team-3 (coach-a). Moving ga-1 (team-1, also coach-a) to overlap with ga-2
    const result = checkCoachConflict({
      game: BASE_ASSIGNMENTS[0], // team-1 (coach-a) vs team-2 (coach-b)
      targetStart: '2026-04-04T08:00:00Z',
      targetEnd: '2026-04-04T09:00:00Z',
      assignments: BASE_ASSIGNMENTS,
      teams: TEAMS,
    });
    // coach-a coaches both team-1 (ga-1) and team-3 (ga-2), both at 08:00-09:00
    expect(result.hasConflict).toBe(true);
    expect(result.conflictingCoachId).toBe('coach-a');
    expect(result.conflictingAssignment).toEqual(BASE_ASSIGNMENTS[1]);
  });

  test('allows overlap when coaches are different', () => {
    // ga-3 has teams 5+6 (no coaches). Moving to overlap ga-1 should be fine
    const result = checkCoachConflict({
      game: BASE_ASSIGNMENTS[2], // team-5 (null) vs team-6 (null)
      targetStart: '2026-04-04T08:00:00Z',
      targetEnd: '2026-04-04T09:00:00Z',
      assignments: BASE_ASSIGNMENTS,
      teams: TEAMS,
    });
    expect(result.hasConflict).toBe(false);
  });

  test('detects partial time overlap', () => {
    // Move ga-1 to start 30 min before ga-2 ends — still overlaps
    const result = checkCoachConflict({
      game: BASE_ASSIGNMENTS[0],
      targetStart: '2026-04-04T08:30:00Z',
      targetEnd: '2026-04-04T09:30:00Z',
      assignments: BASE_ASSIGNMENTS,
      teams: TEAMS,
    });
    expect(result.hasConflict).toBe(true);
    expect(result.conflictingCoachId).toBe('coach-a');
  });

  test('no conflict when times are adjacent but not overlapping', () => {
    // ga-2 ends at 09:00. Move ga-1 to start exactly at 09:00 — no overlap
    const result = checkCoachConflict({
      game: BASE_ASSIGNMENTS[0],
      targetStart: '2026-04-04T09:00:00Z',
      targetEnd: '2026-04-04T10:00:00Z',
      assignments: BASE_ASSIGNMENTS,
      teams: TEAMS,
    });
    expect(result.hasConflict).toBe(false);
  });

  test('returns safe defaults for invalid inputs', () => {
    const result = checkCoachConflict({
      game: null,
      targetStart: null,
      targetEnd: null,
      assignments: null,
      teams: null,
    });
    expect(result.hasConflict).toBe(false);
  });
});

// ── validateGameMove ────────────────────────────────────────────────────────

describe('validateGameMove', () => {
  test('valid move to empty slot with no coach conflicts', () => {
    const result = validateGameMove({
      game: BASE_ASSIGNMENTS[0],
      targetFieldId: 'v3',
      targetSlotId: 'gs-99',
      targetStart: '2026-04-04T11:00:00Z',
      targetEnd: '2026-04-04T12:00:00Z',
      assignments: BASE_ASSIGNMENTS,
      teams: TEAMS,
    });
    expect(result.valid).toBe(true);
    expect(result.reason).toBeNull();
  });

  test('rejects move to occupied slot', () => {
    const result = validateGameMove({
      game: BASE_ASSIGNMENTS[1], // ga-2
      targetFieldId: 'v1',
      targetSlotId: 'gs-1',      // occupied by ga-1
      targetStart: '2026-04-04T08:00:00Z',
      targetEnd: '2026-04-04T09:00:00Z',
      assignments: BASE_ASSIGNMENTS,
      teams: TEAMS,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('occupied');
  });

  test('rejects move that creates coach conflict even if slot is open', () => {
    // Move ga-1 to v3:gs-overlap at same time as ga-2 — different field but same coach
    const result = validateGameMove({
      game: BASE_ASSIGNMENTS[0],
      targetFieldId: 'v3',
      targetSlotId: 'gs-open',
      targetStart: '2026-04-04T08:00:00Z',
      targetEnd: '2026-04-04T09:00:00Z',
      assignments: BASE_ASSIGNMENTS,
      teams: TEAMS,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Coach');
    expect(result.reason).toContain('coach-a');
  });

  test('allows move back to own slot (self-exclusion)', () => {
    // ga-1 is on v1:gs-1. "Moving" it to the same spot should be valid
    const result = validateGameMove({
      game: BASE_ASSIGNMENTS[0],
      targetFieldId: 'v1',
      targetSlotId: 'gs-1',
      targetStart: '2026-04-04T11:00:00Z',  // different time → no coach conflict
      targetEnd: '2026-04-04T12:00:00Z',
      assignments: BASE_ASSIGNMENTS,
      teams: TEAMS,
    });
    expect(result.valid).toBe(true);
  });
});
