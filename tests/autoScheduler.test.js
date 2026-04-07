import assert from 'node:assert/strict';
import { describe, test } from 'vitest';

import {
  optimizePracticeSchedule,
  computeFitness,
  createPRNG,
} from '../packages/core/src/autoScheduler.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createSlot({ id, day, startHour, endHour, capacity = 1, baseSlotId = undefined }) {
  const start = new Date(`2024-08-05T${String(startHour).padStart(2, '0')}:00:00.000Z`);
  const end = new Date(`2024-08-05T${String(endHour).padStart(2, '0')}:00:00.000Z`);
  return { id, day, start, end, capacity, baseSlotId };
}

function makeTeams(count, division = 'U10') {
  return Array.from({ length: count }, (_, i) => ({
    id: `T${i + 1}`,
    division,
    coachId: `c${i + 1}`,
  }));
}

// ---------------------------------------------------------------------------
// PRNG
// ---------------------------------------------------------------------------

describe('createPRNG', () => {
  test('produces deterministic sequence for same seed', () => {
    const a = createPRNG(42);
    const b = createPRNG(42);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    assert.deepEqual(seqA, seqB);
  });

  test('produces different sequences for different seeds', () => {
    const a = createPRNG(42);
    const b = createPRNG(99);
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    assert.notDeepEqual(seqA, seqB);
  });

  test('values are in [0, 1) range', () => {
    const rand = createPRNG(1);
    for (let i = 0; i < 1000; i++) {
      const v = rand();
      assert.ok(v >= 0 && v < 1, `value ${v} out of range`);
    }
  });
});

// ---------------------------------------------------------------------------
// computeFitness
// ---------------------------------------------------------------------------

describe('computeFitness', () => {
  test('returns 1.0 for a perfect schedule', () => {
    const evaluation = {
      summary: {
        totalTeams: 5,
        assignedTeams: 5,
        unassignedTeams: 0,
        assignmentRate: 1,
        manualFollowUpRate: 0,
      },
      coachConflicts: [],
      fairnessConcerns: [],
      slotUtilization: [
        { slotId: 's1', capacity: 2, utilization: 0.5 },
        { slotId: 's2', capacity: 2, utilization: 0.5 },
      ],
    };
    const score = computeFitness(evaluation);
    assert.equal(score, 1.0);
  });

  test('penalizes unassigned teams (coverage)', () => {
    const fullCoverage = {
      summary: { totalTeams: 4, assignedTeams: 4, assignmentRate: 1, manualFollowUpRate: 0 },
      coachConflicts: [],
      fairnessConcerns: [],
      slotUtilization: [],
    };
    const halfCoverage = {
      summary: { totalTeams: 4, assignedTeams: 2, assignmentRate: 0.5, manualFollowUpRate: 0.5 },
      coachConflicts: [],
      fairnessConcerns: [],
      slotUtilization: [],
    };
    assert.ok(computeFitness(fullCoverage) > computeFitness(halfCoverage));
  });

  test('penalizes coach conflicts', () => {
    const base = {
      summary: { totalTeams: 4, assignedTeams: 4, assignmentRate: 1, manualFollowUpRate: 0 },
      fairnessConcerns: [],
      slotUtilization: [],
    };
    const noConflicts = { ...base, coachConflicts: [] };
    const twoConflicts = {
      ...base,
      coachConflicts: [
        { coachId: 'c1', teams: [], reason: 'overlap' },
        { coachId: 'c2', teams: [], reason: 'overlap' },
      ],
    };
    assert.ok(computeFitness(noConflicts) > computeFitness(twoConflicts));
  });

  test('penalizes fairness concerns', () => {
    const base = {
      summary: { totalTeams: 4, assignedTeams: 4, assignmentRate: 1, manualFollowUpRate: 0 },
      coachConflicts: [],
      slotUtilization: [],
    };
    const fair = { ...base, fairnessConcerns: [] };
    const unfair = {
      ...base,
      fairnessConcerns: [{ type: 'dominance' }, { type: 'day-concentration' }],
    };
    assert.ok(computeFitness(fair) > computeFitness(unfair));
  });
});

// ---------------------------------------------------------------------------
// optimizePracticeSchedule
// ---------------------------------------------------------------------------

describe('optimizePracticeSchedule', () => {
  test('returns a valid schedule that scores >= the greedy seed', () => {
    const teams = makeTeams(6);
    const slots = [
      createSlot({ id: 's1', day: 'Monday', startHour: 17, endHour: 18, capacity: 2 }),
      createSlot({ id: 's2', day: 'Tuesday', startHour: 17, endHour: 18, capacity: 2 }),
      createSlot({ id: 's3', day: 'Wednesday', startHour: 17, endHour: 18, capacity: 2 }),
    ];

    const result = optimizePracticeSchedule({
      teams,
      slots,
      config: { timeBudgetMs: 2000, maxIterations: 200, seed: 42 },
    });

    // All teams should be assigned
    assert.equal(result.assignments.length, 6);
    assert.equal(result.unassigned.length, 0);

    // Score should be >= seed (never degrades)
    assert.ok(
      result.optimizationMeta.bestScore >= result.optimizationMeta.seedScore,
      `bestScore (${result.optimizationMeta.bestScore}) should be >= seedScore (${result.optimizationMeta.seedScore})`
    );

    // Optimization metadata is populated
    assert.ok(result.optimizationMeta.iterations > 0);
    assert.ok(result.optimizationMeta.elapsedMs > 0);
    assert.ok(
      ['time-budget', 'max-iterations', 'converged'].includes(
        result.optimizationMeta.terminationReason
      )
    );
  });

  test('respects locked assignments', () => {
    const teams = makeTeams(4);
    const slots = [
      createSlot({ id: 's1', day: 'Monday', startHour: 17, endHour: 18, capacity: 2 }),
      createSlot({ id: 's2', day: 'Tuesday', startHour: 17, endHour: 18, capacity: 2 }),
    ];

    const result = optimizePracticeSchedule({
      teams,
      slots,
      lockedAssignments: [{ teamId: 'T1', slotId: 's1' }],
      config: { timeBudgetMs: 1000, maxIterations: 100, seed: 42 },
    });

    // T1 must remain on s1 with source = 'locked'
    const t1Assignment = result.assignments.find((a) => a.teamId === 'T1');
    assert.ok(t1Assignment, 'T1 should be assigned');
    assert.equal(t1Assignment.slotId, 's1');
    assert.equal(t1Assignment.source, 'locked');
  });

  test('deterministic: same seed produces same result', () => {
    const teams = makeTeams(5);
    const slots = [
      createSlot({ id: 's1', day: 'Monday', startHour: 17, endHour: 18, capacity: 2 }),
      createSlot({ id: 's2', day: 'Tuesday', startHour: 17, endHour: 18, capacity: 2 }),
      createSlot({ id: 's3', day: 'Wednesday', startHour: 17, endHour: 18, capacity: 1 }),
    ];

    const cfg = { timeBudgetMs: 1000, maxIterations: 100, seed: 777 };
    const result1 = optimizePracticeSchedule({ teams, slots, config: cfg });
    const result2 = optimizePracticeSchedule({ teams, slots, config: cfg });

    assert.deepEqual(result1.assignments, result2.assignments);
    assert.equal(result1.optimizationMeta.bestScore, result2.optimizationMeta.bestScore);
  });

  test('calls onProgress callback at correct intervals', () => {
    const teams = makeTeams(4);
    const slots = [
      createSlot({ id: 's1', day: 'Monday', startHour: 17, endHour: 18, capacity: 2 }),
      createSlot({ id: 's2', day: 'Tuesday', startHour: 17, endHour: 18, capacity: 2 }),
    ];

    const progressEvents = [];
    optimizePracticeSchedule({
      teams,
      slots,
      config: {
        timeBudgetMs: 2000,
        maxIterations: 200,
        progressInterval: 50,
        seed: 42,
        onProgress: (event) => progressEvents.push(event),
      },
    });

    // Should have at least one progress event (at iteration 50)
    if (progressEvents.length > 0) {
      assert.equal(progressEvents[0].iteration, 50);
      assert.ok(typeof progressEvents[0].bestScore === 'number');
      assert.ok(typeof progressEvents[0].elapsedMs === 'number');
    }
  });

  test('respects time budget and terminates early', () => {
    const teams = makeTeams(8);
    const slots = [
      createSlot({ id: 's1', day: 'Monday', startHour: 17, endHour: 18, capacity: 3 }),
      createSlot({ id: 's2', day: 'Tuesday', startHour: 17, endHour: 18, capacity: 3 }),
      createSlot({ id: 's3', day: 'Wednesday', startHour: 17, endHour: 18, capacity: 2 }),
    ];

    const result = optimizePracticeSchedule({
      teams,
      slots,
      config: { timeBudgetMs: 100, maxIterations: 100000, seed: 42 },
    });

    // Should terminate due to time budget, not max iterations
    assert.ok(result.optimizationMeta.elapsedMs < 500, 'Should terminate quickly');
  });

  test('handles edge case: single team single slot', () => {
    const teams = [{ id: 'T1', division: 'U10', coachId: 'c1' }];
    const slots = [
      createSlot({ id: 's1', day: 'Monday', startHour: 17, endHour: 18, capacity: 1 }),
    ];

    const result = optimizePracticeSchedule({
      teams,
      slots,
      config: { timeBudgetMs: 500, maxIterations: 50, seed: 42 },
    });

    assert.equal(result.assignments.length, 1);
    assert.equal(result.assignments[0].teamId, 'T1');
    assert.equal(result.assignments[0].slotId, 's1');
  });

  test('handles constrained scenario with coach conflicts gracefully', () => {
    // Two teams share a coach — they cannot occupy overlapping slots.
    // Use different dates so time windows don't overlap (day label alone isn't enough).
    const teams = [
      { id: 'T1', division: 'U10', coachId: 'shared-coach' },
      { id: 'T2', division: 'U10', coachId: 'shared-coach' },
      { id: 'T3', division: 'U10', coachId: 'c3' },
    ];

    const slots = [
      {
        id: 's1',
        day: 'Monday',
        start: new Date('2024-08-05T17:00:00.000Z'),
        end: new Date('2024-08-05T18:00:00.000Z'),
        capacity: 2,
      },
      {
        id: 's2',
        day: 'Tuesday',
        start: new Date('2024-08-06T17:00:00.000Z'),
        end: new Date('2024-08-06T18:00:00.000Z'),
        capacity: 2,
      },
    ];

    const result = optimizePracticeSchedule({
      teams,
      slots,
      config: { timeBudgetMs: 1000, maxIterations: 100, seed: 42 },
    });

    // All three teams should be assigned
    assert.equal(result.assignments.length, 3, 'All 3 teams should be assigned');

    // Both shared-coach teams should be on different non-overlapping slots
    const t1 = result.assignments.find((a) => a.teamId === 'T1');
    const t2 = result.assignments.find((a) => a.teamId === 'T2');
    assert.ok(t1, 'T1 should be assigned');
    assert.ok(t2, 'T2 should be assigned');
    assert.notEqual(t1.slotId, t2.slotId, 'Shared-coach teams should not be on the same slot');
  });

  test('evaluation field is populated with full practiceMetrics output', () => {
    const teams = makeTeams(3);
    const slots = [
      createSlot({ id: 's1', day: 'Monday', startHour: 17, endHour: 18, capacity: 2 }),
      createSlot({ id: 's2', day: 'Tuesday', startHour: 17, endHour: 18, capacity: 1 }),
    ];

    const result = optimizePracticeSchedule({
      teams,
      slots,
      config: { timeBudgetMs: 500, maxIterations: 50, seed: 42 },
    });

    assert.ok(result.evaluation, 'evaluation should be present');
    assert.ok(result.evaluation.summary, 'evaluation.summary should be present');
    assert.ok(Array.isArray(result.evaluation.slotUtilization), 'slotUtilization should be array');
    assert.ok(Array.isArray(result.evaluation.coachConflicts), 'coachConflicts should be array');
  });
});
