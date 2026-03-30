/**
 * Real-time validation functions for the GameScheduleGrid drag-and-drop interface.
 *
 * These are lightweight checks designed to run on every dragOver event.
 * They complement the comprehensive evaluateGameSchedule() in gameMetrics.js
 * by providing fast, targeted answers to two questions:
 *   1. "Is this field+slot combination already occupied?"
 *   2. "Would this move create a coach scheduling conflict?"
 *
 * @module gameValidation
 */

/**
 * Check whether a field+slot combination is available for a game assignment.
 *
 * A slot is unavailable if another assignment (excluding the one being moved)
 * already occupies the same field at the same time.
 *
 * @param {Object} params
 * @param {string} params.fieldId          - Target field identifier.
 * @param {string} params.slotId           - Target slot identifier.
 * @param {Array}  params.assignments      - Current list of all game assignments.
 * @param {string} [params.excludeId]      - Assignment ID to exclude (the one being dragged).
 * @returns {{ available: boolean, blockingAssignment: Object|null }}
 */
export function checkSlotAvailability({ fieldId, slotId, assignments, excludeId }) {
  if (!fieldId || !slotId || !Array.isArray(assignments)) {
    return { available: false, blockingAssignment: null };
  }

  const blocker = assignments.find(
    (a) => a.id !== excludeId && String(a.fieldId) === String(fieldId) && String(a.slotId) === String(slotId)
  );

  return {
    available: !blocker,
    blockingAssignment: blocker || null,
  };
}

/**
 * Check whether moving a game to a new time window would create a coach conflict.
 *
 * A coach conflict exists when the same coach has two games with overlapping times.
 * Both the home and away team coaches of the moved game are checked.
 *
 * @param {Object} params
 * @param {Object} params.game             - The game assignment being moved.
 * @param {string} params.targetStart      - ISO datetime string of the proposed new start.
 * @param {string} params.targetEnd        - ISO datetime string of the proposed new end.
 * @param {Array}  params.assignments      - Current list of all game assignments.
 * @param {Array}  params.teams            - All teams (must include coachId property).
 * @returns {{ hasConflict: boolean, conflictingCoachId: string|null, conflictingAssignment: Object|null }}
 */
export function checkCoachConflict({ game, targetStart, targetEnd, assignments, teams }) {
  if (!game || !targetStart || !targetEnd || !Array.isArray(assignments) || !Array.isArray(teams)) {
    return { hasConflict: false, conflictingCoachId: null, conflictingAssignment: null };
  }

  const teamsById = new Map(teams.map((t) => [String(t.id), t]));

  const homeTeam = teamsById.get(String(game.homeTeamId));
  const awayTeam = teamsById.get(String(game.awayTeamId));
  const coachIds = [homeTeam?.coachId, awayTeam?.coachId].filter(Boolean);

  if (coachIds.length === 0) {
    return { hasConflict: false, conflictingCoachId: null, conflictingAssignment: null };
  }

  const tStart = new Date(targetStart).getTime();
  const tEnd = new Date(targetEnd).getTime();

  for (const assignment of assignments) {
    if (assignment.id === game.id) continue;

    const aHome = teamsById.get(String(assignment.homeTeamId));
    const aAway = teamsById.get(String(assignment.awayTeamId));
    const aCoachIds = [aHome?.coachId, aAway?.coachId].filter(Boolean);

    for (const coachId of coachIds) {
      if (!aCoachIds.includes(coachId)) continue;

      const aStart = new Date(assignment.start).getTime();
      const aEnd = new Date(assignment.end).getTime();

      if (tStart < aEnd && tEnd > aStart) {
        return {
          hasConflict: true,
          conflictingCoachId: coachId,
          conflictingAssignment: assignment,
        };
      }
    }
  }

  return { hasConflict: false, conflictingCoachId: null, conflictingAssignment: null };
}

/**
 * Validate a proposed game move combining both slot availability and coach conflict checks.
 *
 * This is the primary entry point for dragOver validation in the GameScheduleGrid.
 *
 * @param {Object} params
 * @param {Object} params.game             - The game assignment being moved.
 * @param {string} params.targetFieldId    - Destination field ID.
 * @param {string} params.targetSlotId     - Destination slot ID.
 * @param {string} params.targetStart      - ISO datetime of the proposed new start.
 * @param {string} params.targetEnd        - ISO datetime of the proposed new end.
 * @param {Array}  params.assignments      - Current list of all game assignments.
 * @param {Array}  params.teams            - All teams with coachId.
 * @returns {{ valid: boolean, reason: string|null }}
 */
export function validateGameMove({ game, targetFieldId, targetSlotId, targetStart, targetEnd, assignments, teams }) {
  const slot = checkSlotAvailability({
    fieldId: targetFieldId,
    slotId: targetSlotId,
    assignments,
    excludeId: game?.id,
  });

  if (!slot.available) {
    const blocker = slot.blockingAssignment;
    return {
      valid: false,
      reason: `Field is occupied by ${blocker?.homeTeamId ?? '?'} vs ${blocker?.awayTeamId ?? '?'}`,
    };
  }

  const coach = checkCoachConflict({
    game,
    targetStart,
    targetEnd,
    assignments,
    teams,
  });

  if (coach.hasConflict) {
    return {
      valid: false,
      reason: `Coach ${coach.conflictingCoachId} has an overlapping game`,
    };
  }

  return { valid: true, reason: null };
}
