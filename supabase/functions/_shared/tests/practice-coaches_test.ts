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
import { AutoSchedulerInputSchema } from '../schemas/auto-scheduler.ts';
import { type PracticeAssignment, type Slot, type Team, TeamSchema } from '../schemas/scoring.ts';

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

Deno.test('listTeamCoachIds - reads the teams-column spelling assistant_coach_ids as well', () => {
  assertEquals(listTeamCoachIds({ id: 'T1', coachId: 'h1', assistant_coach_ids: ['a1'] }), [
    'h1',
    'a1',
  ]);
  // The engine spelling wins when both are present, as in the core helper.
  assertEquals(
    listTeamCoachIds({
      id: 'T1',
      coachId: null,
      assistantCoachIds: ['a1'],
      assistant_coach_ids: ['a2'],
    }),
    ['a1']
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

Deno.test(
  'TeamSchema - assistantCoachIds: null validates, and the team is scheduled on its head coach',
  () => {
    const parsed = TeamSchema.parse({
      id: 'T1',
      division: 'U10',
      coachId: 'h1',
      assistantCoachIds: null,
    });
    const prepared: PreparedTeam = { ...parsed, coachIds: listTeamCoachIds(parsed) };
    assertEquals(prepared.coachIds, ['h1']);
    assertEquals(checkHardConstraints(prepared, early, new Map(), capacity(), {}), true);
    // Control: the schema still rejects a non-array list.
    assertThrows(() =>
      TeamSchema.parse({ id: 'T1', division: 'U10', coachId: 'h1', assistantCoachIds: 'a1' })
    );
  }
);

Deno.test(
  'AutoSchedulerInputSchema - a request with assistantCoachIds: null validates and schedules',
  () => {
    const parsed = AutoSchedulerInputSchema.safeParse({
      organizationId: '11111111-1111-4111-8111-111111111111',
      teams: [{ id: 'T1', division: 'U10', coachId: 'h1', assistantCoachIds: null }],
      slots: [
        { id: 'early', start: '2026-04-06T17:00:00Z', end: '2026-04-06T18:00:00Z', capacity: 1 },
      ],
    });
    assertEquals(parsed.success, true, JSON.stringify(parsed.success ? null : parsed.error.issues));
    if (!parsed.success) return;
    // The same preparation index.ts performs, then the seat check the greedy pass runs.
    const prepared = parsed.data.teams.map((t) => ({ ...t, coachIds: listTeamCoachIds(t) }));
    assertEquals(prepared[0].coachIds, ['h1']);
    assertEquals(checkHardConstraints(prepared[0], early, new Map(), capacity(), {}), true);
    // Control: the request schema still rejects a non-array list.
    const rejected = AutoSchedulerInputSchema.safeParse({
      organizationId: '11111111-1111-4111-8111-111111111111',
      teams: [{ id: 'T1', division: 'U10', coachId: 'h1', assistantCoachIds: 'a1' }],
      slots: [
        { id: 'early', start: '2026-04-06T17:00:00Z', end: '2026-04-06T18:00:00Z', capacity: 1 },
      ],
    });
    assertEquals(rejected.success, false);
  }
);

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
  'scoring-engine - a pair sharing head and assistant is one conflict and one issue naming both',
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
    const issues = conflictIssues(result);
    assertEquals(issues.length, 1);
    assertEquals(issues[0].message, 'Coaches h, shared have overlapping practices on Monday');
    assertEquals(issues[0].details?.coachIds, ['h', 'shared']);
    // Control: a pair sharing one coach keeps the singular rendering.
    const single = evaluatePracticeSchedule({
      teams: [
        { id: 'T1', division: 'U10', coachId: 'h' },
        { id: 'T2', division: 'U12', coachId: 'h' },
      ],
      slots: scoringSlots,
      assignments: scoringAssignments,
    });
    assertEquals(conflictIssues(single)[0].message, 'Coach h has overlapping practices on Monday');
  }
);

Deno.test('scoring-engine - every overlapping pair is visited and merges across coaches', () => {
  // T1{h}, T2{h,s}, T3{h,s} all at the same hour: T2/T3 share both coaches, T1/T2 and T1/T3 only h.
  const teams: Team[] = [
    { id: 'T1', division: 'U10', coachId: 'h' },
    { id: 'T2', division: 'U10', coachId: 'h', assistantCoachIds: ['s'] },
    { id: 'T3', division: 'U10', coachId: 'h', assistantCoachIds: ['s'] },
  ];
  const slots: Slot[] = ['s1', 's2', 's3'].map((id) => ({
    id,
    capacity: 1,
    start: '2026-04-06T17:00:00Z',
    end: '2026-04-06T18:00:00Z',
  }));
  const assignments: PracticeAssignment[] = [
    { teamId: 'T1', slotId: 's1' },
    { teamId: 'T2', slotId: 's2' },
    { teamId: 'T3', slotId: 's3' },
  ];
  const result = evaluatePracticeSchedule({ teams, slots, assignments });
  const pairs = result.coachConflicts.map((c) => [
    c.teams
      .map((t) => t.teamId)
      .sort()
      .join('/'),
    c.coachIds,
  ]);
  assertEquals(pairs.length, 3);
  assertEquals(pairs.find(([pair]) => pair === 'T2/T3')?.[1], ['h', 's']);
  assertEquals(pairs.find(([pair]) => pair === 'T1/T2')?.[1], ['h']);
  assertEquals(pairs.find(([pair]) => pair === 'T1/T3')?.[1], ['h']);
  assertEquals(conflictIssues(result).length, 3);
});

Deno.test(
  'scoring-engine - a row carrying only assistant_coach_ids is conflict-checked on its assistant',
  () => {
    const teams: Team[] = [
      { id: 'T1', division: 'U10', coachId: 'h1', assistant_coach_ids: ['shared'] },
      { id: 'T2', division: 'U12', coachId: null, assistant_coach_ids: ['shared'] },
    ];
    const result = evaluatePracticeSchedule({
      teams,
      slots: scoringSlots,
      assignments: scoringAssignments,
    });
    assertEquals(result.coachConflicts.length, 1);
    assertEquals(result.coachConflicts[0].coachIds, ['shared']);
  }
);

Deno.test('scoring-engine - a precomputed coachIds list is honoured over the raw fields', () => {
  const teams: Team[] = [
    { id: 'T1', division: 'U10', coachId: 'h1', assistantCoachIds: ['raw'], coachIds: ['pre'] },
    { id: 'T2', division: 'U12', coachId: 'h2', assistantCoachIds: ['raw'], coachIds: ['pre'] },
  ];
  const result = evaluatePracticeSchedule({
    teams,
    slots: scoringSlots,
    assignments: scoringAssignments,
  });
  assertEquals(result.coachConflicts.length, 1);
  assertEquals(result.coachConflicts[0].coachIds, ['pre']);
});
