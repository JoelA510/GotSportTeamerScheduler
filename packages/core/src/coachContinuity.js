/**
 * Coach continuity for snapshot-aware incremental generation (project-hardening PR 06).
 *
 * Reconciles realistic coach deltas against preserved team shells WITHOUT destabilizing
 * rosters: dropped head coaches, explicit replacements, evidence-based household
 * replacements, and late head coaches attaching to their child's coachless team.
 * Mutation is explicit/evidence-based only — ambiguity becomes a manual-review entry,
 * never a guess. Pure module — no React / Supabase imports; inputs are not mutated.
 *
 * Policy knobs (all under `changePolicy`):
 *   - `coachReplacementMap`: `{ [oldCoachId]: newCoachId }` — explicit, always wins.
 *   - `allowHouseholdCoachReplacement` (default false): when a team's head coach dropped
 *     and EXACTLY ONE of the team's preserved children now carries a different active
 *     coachId (the other parent stepping up), replace.
 *   - `allowLateCoachAttachToChildTeam` (default true): when a coachless preserved team
 *     has EXACTLY ONE active coach candidate among its preserved children, attach.
 */

/** Coerce an id-like value to a trimmed non-empty string, or undefined. */
function coerceId(value) {
  if (value === undefined || value === null) return undefined;
  const str = String(value).trim();
  return str === '' ? undefined : str;
}

/**
 * Apply coach continuity to a division's rehydrated preserved team shells.
 *
 * @param {{
 *   teams: any[],            // rehydrated preserved shells (players carry incoming coach fields)
 *   divisionPlayers: any[],  // ALL incoming players of the division (preserved + late)
 *   changePolicy?: any,
 * }} params
 * @returns {{
 *   teams: any[],
 *   coachDrops: Array<{ teamId: string, coachId: string }>,
 *   coachReplacements: Array<{ teamId: string, fromCoachId: string | null, toCoachId: string }>,
 *   manualReview: Array<{ code: string, teamId: string, message: string, candidateCoachIds?: string[] }>,
 * }}
 */
export function applyCoachContinuity({ teams, divisionPlayers, changePolicy }) {
  const policy = changePolicy ?? {};
  const replacementMap = policy.coachReplacementMap ?? {};
  const allowHousehold = policy.allowHouseholdCoachReplacement === true;
  const allowLateAttach = policy.allowLateCoachAttachToChildTeam !== false;

  // An adult is an "active coach" when any incoming player of the division references them.
  const activeCoachIds = new Set();
  for (const player of divisionPlayers ?? []) {
    const coachId = coerceId(player?.coachId);
    if (coachId) activeCoachIds.add(coachId);
  }

  const coachDrops = [];
  const coachReplacements = [];
  const manualReview = [];

  // Coach ids currently anchoring a team in this division (kept up to date as we mutate),
  // so one adult is never silently attached to two teams.
  const anchoredCoachIds = new Set(
    (teams ?? []).map((team) => coerceId(team.coachId)).filter(Boolean)
  );

  /** Distinct active coach candidates carried by a team's preserved children. */
  const candidatesFor = (team) => {
    const candidates = new Set();
    for (const player of team.players ?? []) {
      const coachId = coerceId(player?.coachId);
      if (coachId && activeCoachIds.has(coachId) && !anchoredCoachIds.has(coachId)) {
        candidates.add(coachId);
      }
    }
    return [...candidates];
  };

  const nextTeams = (teams ?? []).map((team) => {
    const originalCoachId = coerceId(team.coachId) ?? null;
    const result = { ...team };

    if (team.locked) {
      // A locked team's coach assignment is never mutated; still report a drop.
      if (originalCoachId && !activeCoachIds.has(originalCoachId)) {
        coachDrops.push({ teamId: team.id, coachId: originalCoachId });
        result.coachInactive = true;
      }
      return result;
    }

    // 1. Explicit replacement always wins.
    const mappedReplacement = originalCoachId
      ? coerceId(replacementMap[originalCoachId])
      : undefined;
    if (mappedReplacement) {
      result.coachId = mappedReplacement;
      anchoredCoachIds.delete(originalCoachId);
      anchoredCoachIds.add(mappedReplacement);
      coachReplacements.push({
        teamId: team.id,
        fromCoachId: originalCoachId,
        toCoachId: mappedReplacement,
      });
      return result;
    }

    // 2. Dropped head coach: clear the anchor (preserving it as previousCoachId), then look
    //    for single-candidate household evidence.
    if (originalCoachId && !activeCoachIds.has(originalCoachId)) {
      coachDrops.push({ teamId: team.id, coachId: originalCoachId });
      result.coachId = null;
      result.previousCoachId = originalCoachId;
      anchoredCoachIds.delete(originalCoachId);

      const candidates = candidatesFor(result);
      if (candidates.length === 1 && allowHousehold) {
        result.coachId = candidates[0];
        anchoredCoachIds.add(candidates[0]);
        coachReplacements.push({
          teamId: team.id,
          fromCoachId: originalCoachId,
          toCoachId: candidates[0],
        });
      } else if (candidates.length >= 1) {
        manualReview.push({
          code:
            candidates.length > 1 ? 'ambiguous-coach-replacement' : 'coach-replacement-candidate',
          teamId: team.id,
          message:
            candidates.length > 1
              ? `team ${team.id} lost coach ${originalCoachId} and has ${candidates.length} possible replacements`
              : `team ${team.id} lost coach ${originalCoachId}; ${candidates[0]} could replace them (enable allowHouseholdCoachReplacement)`,
          candidateCoachIds: candidates,
        });
      }
      return result;
    }

    // 3. Late head coach attaching to their child's coachless preserved team.
    if (!originalCoachId) {
      const candidates = candidatesFor(result);
      if (candidates.length === 1 && allowLateAttach) {
        result.coachId = candidates[0];
        anchoredCoachIds.add(candidates[0]);
        coachReplacements.push({ teamId: team.id, fromCoachId: null, toCoachId: candidates[0] });
      } else if (candidates.length > 1) {
        manualReview.push({
          code: 'ambiguous-coach-attachment',
          teamId: team.id,
          message: `coachless team ${team.id} has ${candidates.length} possible coach attachments`,
          candidateCoachIds: candidates,
        });
      }
    }

    return result;
  });

  return { teams: nextTeams, coachDrops, coachReplacements, manualReview };
}
