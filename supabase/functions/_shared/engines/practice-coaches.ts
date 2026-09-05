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
  /** The `teams` column spelling; read when `assistantCoachIds` is absent. */
  assistant_coach_ids?: string[] | null;
}

/** A team with its coach list resolved once, at input preparation. */
export interface PreparedTeam extends CoachedTeam {
  coachIds: string[];
}

/**
 * Head coach plus assistants, deduplicated, empty ids dropped. The assistant list is read as
 * `assistantCoachIds` first, then `assistant_coach_ids`, the precedence the core helper applies.
 * An absent or null list means no assistants (the same contract `if (team.coachId)` applies to a
 * missing head coach); a list that is present and not an array is rejected rather than read as
 * "no coaches".
 */
export function listTeamCoachIds(team: CoachedTeam): string[] {
  const assistants = team.assistantCoachIds ?? team.assistant_coach_ids;
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
 * The narrow team the optimiser seats and the evaluator scores: request passthrough keys dropped,
 * the assistant list normalised onto the engine spelling, and the coach set resolved once.
 * `assistantCoachIds` must survive the projection — the evaluator recomputes the conflict set from
 * it rather than trusting a `coachIds` key a request could supply, so dropping it here would
 * silently narrow that check back to head coaches.
 */
export function prepareTeam<T extends CoachedTeam & { division: string }>(
  team: T
): PreparedTeam & { division: string } {
  return {
    id: team.id,
    division: team.division,
    coachId: team.coachId ?? null,
    assistantCoachIds: team.assistantCoachIds ?? team.assistant_coach_ids ?? null,
    coachIds: listTeamCoachIds(team),
  };
}

/**
 * Key for one overlapping pair of assignments, the same whichever side is named first, so the
 * pair merges across coaches regardless of the order each coach's list produced it.
 */
export function conflictPairKey(
  a: { teamId: string; slotId: string },
  b: { teamId: string; slotId: string }
): string {
  return [`${a.teamId}::${a.slotId}`, `${b.teamId}::${b.slotId}`].sort().join('|');
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
