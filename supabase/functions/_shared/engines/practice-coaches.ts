/**
 * Every coach a team carries, and the hard-constraint check the auto-scheduler runs before
 * seating a team. Mirrors `listTeamCoachIds` in packages/core/src/practiceScheduling.js and
 * `checkHardConstraints` in packages/core/src/autoScheduler.js (Phase 8.1). Kept in _shared so a
 * Deno test can reach the check without importing the serving module.
 */

export interface TimeWindow {
  start: Date;
  end: Date;
  teamId?: string;
  slotId?: string;
}

export interface CoachedTeam {
  id: string;
  coachId?: string | null;
  assistantCoachIds?: string[] | null;
}

/** A team with its coach list resolved once, at input preparation. */
export interface PreparedTeam extends CoachedTeam {
  coachIds: string[];
}

/**
 * Head coach plus assistants, deduplicated, empty ids dropped. An absent or null list means no
 * assistants (the same contract `if (team.coachId)` applies to a missing head coach); a list that
 * is present and not an array is rejected rather than read as "no coaches".
 */
export function listTeamCoachIds(team: CoachedTeam): string[] {
  const assistants = team.assistantCoachIds;
  if (assistants !== undefined && assistants !== null && !Array.isArray(assistants)) {
    throw new TypeError(`team ${team.id} assistantCoachIds must be an array when provided`);
  }
  const ids = new Set<string>();
  if (team.coachId) ids.add(team.coachId);
  for (const id of assistants ?? []) {
    if (id) ids.add(id);
  }
  return [...ids];
}

/**
 * Capacity, then unavailability and time overlap for every coach on the team.
 */
export function checkHardConstraints(
  team: PreparedTeam,
  slot: { id: string; start: Date; end: Date },
  coachAssignments: Map<string, TimeWindow[]>,
  slotCapacity: Map<string, number>,
  coachPreferences: Record<string, { unavailableSlotIds?: string[] }>
): boolean {
  if ((slotCapacity.get(slot.id) ?? 0) <= 0) return false;
  for (const coachId of team.coachIds) {
    if (coachPreferences[coachId]?.unavailableSlotIds?.includes(slot.id)) return false;
  }
  for (const coachId of team.coachIds) {
    const existing = coachAssignments.get(coachId) ?? [];
    for (const a of existing) {
      if (slot.start < a.end && slot.end > a.start) return false;
    }
  }
  return true;
}
