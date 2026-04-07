// @ts-ignore [Deno] .ts extension required for Edge Functions
import { Team, Slot, PracticeAssignment, GameAssignment } from '../schemas/scoring.ts';

export type Severity = 'info' | 'warning' | 'error';

export interface Issue {
  category: string;
  message: string;
  severity: Severity;
  details?: Record<string, unknown>;
}

export type EvaluationStatus = 'ok' | 'attention-needed' | 'action-required';

export interface EvaluationResult {
  status: EvaluationStatus;
  issues: Issue[];
  practice?: ReturnType<typeof evaluatePracticeSchedule> | null;
  games?: ReturnType<typeof evaluateGameSchedule> | null;
  metrics: {
    fairnessScore: number;
    combinedScore: number;
    executionTimeMs?: number;
  };
}

/**
 * Fairness Scoring Engine (Isomorphic Deno/TS)
 * Migrated from packages/core/src/practiceMetrics.js and gameMetrics.js
 */

const FAIRNESS_DOMINANCE_THRESHOLD = 0.7;
const UNDERUTILIZATION_THRESHOLD = 0.25;
const DAY_CONCENTRATION_THRESHOLD = 0.65;
const MIN_ASSIGNMENTS_FOR_CONCENTRATION = 3;

export const MANUAL_FOLLOW_UP_CATEGORIES = {
  CAPACITY: 'capacity',
  COACH_AVAILABILITY: 'coach-availability',
  EXCLUDED_SLOTS: 'excluded-slots',
  UNKNOWN: 'constraints-or-unknown',
} as const;

function categorizeManualFollowUpReason(rawReason: string) {
  const value = (rawReason ?? 'unspecified').toLowerCase();

  if (value.includes('capacity')) {
    return MANUAL_FOLLOW_UP_CATEGORIES.CAPACITY;
  }
  if (value.includes('coach')) {
    return MANUAL_FOLLOW_UP_CATEGORIES.COACH_AVAILABILITY;
  }
  if (value.includes('exclude') || value.includes('alternative slot')) {
    return MANUAL_FOLLOW_UP_CATEGORIES.EXCLUDED_SLOTS;
  }
  return MANUAL_FOLLOW_UP_CATEGORIES.UNKNOWN;
}

/**
 * Core Logic for evaluating Practice Schedules
 */
export function evaluatePracticeSchedule(params: {
  assignments: PracticeAssignment[];
  unassigned?: Array<{ teamId: string; reason: string }> | null;
  teams: Team[];
  slots: Slot[];
}) {
  const { assignments, unassigned = [], teams, slots } = params;

  const totalTeams = teams.length;
  const assignedTeams = assignments.length;
  const unassignedTeams = totalTeams - assignedTeams;

  const teamsById = new Map<string, Team>(teams.map((t) => [t.id, t]));
  const slotsById = new Map<string, Slot>(slots.map((s) => [s.id, s]));

  const issues: Issue[] = [];

  // 1. Summary Metrics
  const summary = {
    totalTeams,
    assignedTeams,
    unassignedTeams,
    assignmentRate: totalTeams > 0 ? assignedTeams / totalTeams : 0,
    coveragePercent: totalTeams > 0 ? (assignedTeams / totalTeams) * 100 : 0,
  };

  if (summary.coveragePercent < 90) {
    issues.push({
      category: 'coverage',
      severity: summary.coveragePercent < 75 ? 'error' : 'warning',
      message: `Low practice assignment coverage: ${summary.coveragePercent.toFixed(1)}%`,
    });
  }

  // 2. Slot Utilization
  const slotUtilization = slots.map((slot) => {
    const assignedInSlot = assignments.filter((a) => a.slotId === slot.id).length;
    const utilization = slot.capacity > 0 ? assignedInSlot / slot.capacity : null;

    if (utilization && utilization > 1.0) {
      issues.push({
        category: 'utilization',
        severity: 'error',
        message: `Slot ${slot.id} is overbooked (${assignedInSlot}/${slot.capacity})`,
        details: {
          slotId: slot.id,
          assignedCount: assignedInSlot,
          capacity: slot.capacity,
        } as Record<string, unknown>,
      });
    }

    return {
      slotId: slot.id,
      assignedCount: assignedInSlot,
      capacity: slot.capacity,
      utilization,
      overbooked: assignedInSlot > slot.capacity,
    };
  });

  // 3. Coach Load & Conflicts
  const coachConflicts: Array<{
    coachId: string;
    teams: Array<{ teamId: string; slotId: string }>;
    reason: string;
  }> = [];
  const coachSchedules = new Map<
    string,
    Array<{ teamId: string; slotId: string; start: Date; end: Date; day: string }>
  >();

  assignments.forEach((a) => {
    const team = teamsById.get(a.teamId);
    const slot = slotsById.get(a.slotId);
    if (!team?.coachId || !slot) return;

    if (!coachSchedules.has(team.coachId)) coachSchedules.set(team.coachId, []);
    const schedule = coachSchedules.get(team.coachId)!;

    const start = new Date(slot.start);
    const end = new Date(slot.end);
    const day = slot.day || start.toLocaleDateString('en-US', { weekday: 'long' });

    // Check for overlap
    const conflict = schedule.find((s) => start < s.end && end > s.start);
    if (conflict) {
      const conflictMsg = `Coach ${team.coachId} has overlapping practices on ${day}`;
      coachConflicts.push({
        coachId: team.coachId,
        teams: [
          { teamId: a.teamId, slotId: a.slotId },
          { teamId: conflict.teamId, slotId: conflict.slotId },
        ],
        reason: conflictMsg,
      });
      issues.push({
        category: 'coach-conflict',
        severity: 'error',
        message: conflictMsg,
        details: { coachId: team.coachId, day } as Record<string, unknown>,
      });
    }

    schedule.push({ teamId: a.teamId, slotId: a.slotId, start, end, day });
  });

  // Fairness Score Calculation
  const conflictPenalty = coachConflicts.length * 0.15;
  const coveragePenalty = (1 - summary.assignmentRate) * 0.5;
  const fairnessScore = Math.max(0, 1 - (conflictPenalty + coveragePenalty));

  // Determine Status
  const status: EvaluationStatus = issues.some((i) => i.severity === 'error')
    ? 'action-required'
    : issues.some((i) => i.severity === 'warning')
      ? 'attention-needed'
      : 'ok';

  return {
    status,
    issues,
    summary: { ...summary, fairnessScore },
    slotUtilization,
    coachConflicts,
    manualFollowUpResults: (unassigned || []).map((u) => ({
      ...u,
      category: categorizeManualFollowUpReason(u.reason),
    })),
  };
}

interface TimedGameAssignment extends GameAssignment {
  start: Date;
  end: Date;
}

/**
 * Core Logic for evaluating Game Schedules
 */
export function evaluateGameSchedule(params: { assignments: GameAssignment[]; teams: Team[] }) {
  const { assignments, teams } = params;
  const teamsById = new Map<string, Team>(teams.map((t) => [t.id, t]));

  const issues: Issue[] = [];
  const summary = {
    totalAssignments: assignments.length,
    coveragePercent: assignments.length > 0 ? 100 : 0, // Simplified
    divisionGameDistribution: {} as Record<string, number>,
  };

  const teamAssignments = new Map<string, TimedGameAssignment[]>();
  const coachAssignments = new Map<string, TimedGameAssignment[]>();

  assignments.forEach((a) => {
    summary.divisionGameDistribution[a.division] =
      (summary.divisionGameDistribution[a.division] ?? 0) + 1;

    const start = new Date(a.start);
    const end = new Date(a.end);

    const participants = [
      { teamId: a.homeTeamId, role: 'home' },
      { teamId: a.awayTeamId, role: 'away' },
    ];

    participants.forEach(({ teamId }) => {
      const team = teamsById.get(teamId);
      if (!team) return;

      if (!teamAssignments.has(teamId)) teamAssignments.set(teamId, []);
      teamAssignments.get(teamId)!.push({ ...a, start, end });

      if (team.coachId) {
        if (!coachAssignments.has(team.coachId)) coachAssignments.set(team.coachId, []);
        coachAssignments.get(team.coachId)!.push({ ...a, start, end });
      }
    });
  });

  const detectConflicts = (
    map: Map<string, TimedGameAssignment[]>,
    type: string,
    severity: Severity,
  ) => {
    map.forEach((events, id) => {
      events.sort((a, b) => a.start.getTime() - b.start.getTime());
      for (let i = 1; i < events.length; i++) {
        if (events[i].start < events[i - 1].end) {
          issues.push({
            category: type,
            severity,
            message: `${type.replace('-', ' ')} conflict for ${id}`,
            details: {
              id,
              events: [
                events[i - 1] as unknown as Record<string, unknown>,
                events[i] as unknown as Record<string, unknown>,
              ],
            },
          });
        }
      }
    });
  };

  detectConflicts(teamAssignments, 'team-double-booked', 'error');
  detectConflicts(coachAssignments, 'coach-game-conflict', 'error');

  const status: EvaluationStatus = issues.some((i) => i.severity === 'error')
    ? 'action-required'
    : issues.some((i) => i.severity === 'warning')
      ? 'attention-needed'
      : 'ok';

  return {
    status,
    issues,
    summary,
  };
}
