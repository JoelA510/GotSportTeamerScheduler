import { describe, it, expect } from 'vitest';
import { evaluatePracticeSchedule } from '../../supabase/functions/_shared/engines/scoring-engine.js';

describe('evaluatePracticeSchedule', () => {
  it('calculates basic assignment metrics correctly', () => {
    const teams = [
      { id: 'team-1', division: 'U10', coachId: 'coach-a' },
      { id: 'team-2', division: 'U10', coachId: 'coach-b' },
    ];

    const slots = [
      { id: 'slot-1', capacity: 2, start: '2026-04-06T18:00:00Z', end: '2026-04-06T19:00:00Z' },
      { id: 'slot-2', capacity: 1, start: '2026-04-06T19:00:00Z', end: '2026-04-06T20:00:00Z' },
    ];

    const assignments = [
      { teamId: 'team-1', slotId: 'slot-1' },
      { teamId: 'team-2', slotId: 'slot-1' },
    ];

    const result = evaluatePracticeSchedule({ teams, slots, assignments });

    expect(result.summary.totalTeams).toBe(2);
    expect(result.summary.assignedTeams).toBe(2);
    expect(result.summary.assignmentRate).toBe(1.0);
    expect(result.slotUtilization[0].utilization).toBe(1.0);
    expect(result.slotUtilization[0].overbooked).toBe(false);
  });

  it('detects coach conflicts correctly', () => {
    const teams = [
      { id: 'team-1', division: 'U10', coachId: 'coach-a' },
      { id: 'team-2', division: 'U12', coachId: 'coach-a' },
    ];

    const slots = [
      { id: 'slot-1', capacity: 2, start: '2026-04-06T18:00:00Z', end: '2026-04-06T19:00:00Z' },
    ];

    const assignments = [
      { teamId: 'team-1', slotId: 'slot-1' },
      { teamId: 'team-2', slotId: 'slot-1' },
    ];

    const result = evaluatePracticeSchedule({ teams, slots, assignments });

    expect(result.coachConflicts.length).toBe(1);
    expect(result.coachConflicts[0].coachId).toBe('coach-a');
    expect(result.coachConflicts[0].reason).toContain('overlapping practices');
  });
});
