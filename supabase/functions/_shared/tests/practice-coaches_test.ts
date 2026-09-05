/**
 * Phase 8.1: assistant coaches enter the auto-scheduler's conflict check.
 * Covers the hard-constraint seam the Edge Function seats teams through and the scoring
 * engine's conflict report; the serving module itself cannot be imported by a test.
 */
import { assertEquals, assertThrows } from 'https://deno.land/std@0.203.0/assert/mod.ts';
import {
  checkHardConstraints,
  listTeamCoachIds,
  type PreparedTeam,
  type TimeWindow,
} from '../engines/practice-coaches.ts';
import { evaluatePracticeSchedule } from '../engines/scoring-engine.ts';
import type { PracticeAssignment, Slot, Team } from '../schemas/scoring.ts';

const hour = (h: number) => new Date(`2026-04-06T${String(h).padStart(2, '0')}:00:00Z`);
const slotAt = (id: string, startHour: number) => ({
  id,
  start: hour(startHour),
  end: hour(startHour + 1),
});
const early = slotAt('early', 17);
const overlap = slotAt('overlap', 17);
const late = slotAt('late', 19);

/** Book a team the way index.ts does: one window per coach on the team. */
function book(team: PreparedTeam, slot: { id: string; start: Date; end: Date }) {
  const coachAssignments = new Map<string, TimeWindow[]>();
  for (const coachId of team.coachIds) {
    coachAssignments.set(coachId, [{ teamId: team.id, slotId: slot.id, ...slot }]);
  }
  return coachAssignments;
}
const capacity = () =>
  new Map([
    ['early', 1],
    ['overlap', 1],
    ['late', 1],
  ]);

Deno.test('listTeamCoachIds - head plus assistants once each, empty ids dropped', () => {
  assertEquals(listTeamCoachIds({ id: 'T1', coachId: 'h1' }), ['h1']);
  assertEquals(listTeamCoachIds({ id: 'T1', coachId: null, assistantCoachIds: null }), []);
  assertEquals(
    listTeamCoachIds({ id: 'T1', coachId: 'h1', assistantCoachIds: ['a1', 'h1', '', 'a1'] }),
    ['h1', 'a1']
  );
});

Deno.test('listTeamCoachIds - a present non-array is rejected, never read as no assistants', () => {
  assertThrows(
    () =>
      listTeamCoachIds({ id: 'T1', coachId: 'h1', assistantCoachIds: 'a1' as unknown as string[] }),
    TypeError
  );
});

Deno.test('checkHardConstraints - two teams sharing an assistant cannot overlap', () => {
  const t1: PreparedTeam = { id: 'T1', coachId: 'h1', coachIds: ['h1', 'shared'] };
  const t2: PreparedTeam = { id: 'T2', coachId: 'h2', coachIds: ['h2', 'shared'] };
  const booked = book(t1, early);

  assertEquals(checkHardConstraints(t2, overlap, booked, capacity(), {}), false);
  assertEquals(checkHardConstraints(t2, late, booked, capacity(), {}), true);

  // Control: a distinct assistant fits the overlapping slot.
  const t3: PreparedTeam = { id: 'T3', coachId: 'h3', coachIds: ['h3', 'other'] };
  assertEquals(checkHardConstraints(t3, overlap, booked, capacity(), {}), true);
});

Deno.test(
  'checkHardConstraints - a team with no head coach is still checked via its assistant',
  () => {
    const t1: PreparedTeam = { id: 'T1', coachId: 'h1', coachIds: ['h1', 'shared'] };
    const t2: PreparedTeam = { id: 'T2', coachId: null, coachIds: ['shared'] };
    assertEquals(checkHardConstraints(t2, overlap, book(t1, early), capacity(), {}), false);
  }
);

Deno.test("checkHardConstraints - an assistant coach's unavailability blocks the slot", () => {
  const t2: PreparedTeam = { id: 'T2', coachId: null, coachIds: ['shared'] };
  const prefs = { shared: { unavailableSlotIds: ['late'] } };
  assertEquals(checkHardConstraints(t2, late, new Map(), capacity(), prefs), false);
  // Control: the same team on a slot the assistant is available for.
  assertEquals(checkHardConstraints(t2, early, new Map(), capacity(), prefs), true);
});

const scoringSlots: Slot[] = [
  { id: 'early', capacity: 1, start: '2026-04-06T17:00:00Z', end: '2026-04-06T18:00:00Z' },
  { id: 'overlap', capacity: 1, start: '2026-04-06T17:00:00Z', end: '2026-04-06T18:00:00Z' },
];
const scoringAssignments: PracticeAssignment[] = [
  { teamId: 'T1', slotId: 'early' },
  { teamId: 'T2', slotId: 'overlap' },
];
const conflictIssues = (result: ReturnType<typeof evaluatePracticeSchedule>) =>
  result.issues.filter((issue) => issue.category === 'coach-conflict');

Deno.test(
  'scoring-engine - a shared assistant overlap is reported once, naming the assistant',
  () => {
    // T2 has no head coach at all, so a head-only evaluator would never see it.
    const teams: Team[] = [
      { id: 'T1', division: 'U10', coachId: 'h1', assistantCoachIds: ['shared'] },
      { id: 'T2', division: 'U12', coachId: null, assistantCoachIds: ['shared'] },
    ];
    const result = evaluatePracticeSchedule({
      teams,
      slots: scoringSlots,
      assignments: scoringAssignments,
    });
    assertEquals(result.coachConflicts.length, 1);
    assertEquals(result.coachConflicts[0].coachId, 'shared');
    assertEquals(result.coachConflicts[0].coachIds, ['shared']);
    assertEquals(conflictIssues(result).length, 1);
  }
);

Deno.test(
  'scoring-engine - control: distinct assistants on overlapping slots raise no conflict',
  () => {
    const teams: Team[] = [
      { id: 'T1', division: 'U10', coachId: 'h1', assistantCoachIds: ['a1'] },
      { id: 'T2', division: 'U12', coachId: null, assistantCoachIds: ['a2'] },
    ];
    const result = evaluatePracticeSchedule({
      teams,
      slots: scoringSlots,
      assignments: scoringAssignments,
    });
    assertEquals(result.coachConflicts, []);
    assertEquals(conflictIssues(result).length, 0);
  }
);

Deno.test(
  'scoring-engine - a pair sharing head and assistant is one conflict and one issue',
  () => {
    const teams: Team[] = [
      { id: 'T1', division: 'U10', coachId: 'h', assistantCoachIds: ['shared'] },
      { id: 'T2', division: 'U12', coachId: 'h', assistantCoachIds: ['shared'] },
    ];
    const result = evaluatePracticeSchedule({
      teams,
      slots: scoringSlots,
      assignments: scoringAssignments,
    });
    assertEquals(result.coachConflicts.length, 1);
    assertEquals(result.coachConflicts[0].coachIds, ['h', 'shared']);
    assertEquals(conflictIssues(result).length, 1);
  }
);
