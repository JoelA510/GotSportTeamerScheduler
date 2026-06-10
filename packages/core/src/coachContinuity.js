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

  // An adult is an "active coach" when any incoming player of the division references them
  // (both engine camelCase and import snake_case shapes count).
  const playerCoachRef = (player) => coerceId(player?.coachId) ?? coerceId(player?.coach_id);
  const activeCoachIds = new Set();
  for (const player of divisionPlayers ?? []) {
    const coachId = playerCoachRef(player);
    if (coachId) activeCoachIds.add(coachId);
  }

  const coachDrops = [];
  const coachReplacements = [];
  const manualReview = [];
  // original coach id → replacement already applied, so a coach intentionally shared across
  // multiple preserved teams replaces consistently on every one of them.
  const appliedReplacements = new Map();

  // Coach ids currently anchoring a team in this division (kept up to date as we mutate),
  // so one adult is never silently attached to two teams.
  const anchoredCoachIds = new Set(
    (teams ?? []).map((team) => coerceId(team.coachId)).filter(Boolean)
  );

  /**
   * Distinct active coach candidates carried by a team's preserved children, split into the
   * usable set and those excluded only because they already anchor another team (so a near-miss
   * is still reportable instead of vanishing silently).
   */
  const candidatesFor = (team) => {
    const usable = new Set();
    const anchoredElsewhere = new Set();
    for (const player of team.players ?? []) {
      const coachId = playerCoachRef(player);
      if (!coachId || !activeCoachIds.has(coachId)) continue;
      if (anchoredCoachIds.has(coachId)) {
        anchoredElsewhere.add(coachId);
      } else {
        usable.add(coachId);
      }
    }
    return { usable: [...usable], anchoredElsewhere: [...anchoredElsewhere] };
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

    // 1. Explicit replacement always wins — unless the target already anchors another team,
    //    which would silently violate the one-adult-one-anchor invariant.
    const mappedReplacement =
      originalCoachId && Object.prototype.hasOwnProperty.call(replacementMap, originalCoachId)
        ? coerceId(replacementMap[originalCoachId])
        : undefined;
    if (mappedReplacement) {
      const sameSharedReplacement = appliedReplacements.get(originalCoachId) === mappedReplacement;
      if (
        anchoredCoachIds.has(mappedReplacement) &&
        mappedReplacement !== originalCoachId &&
        !sameSharedReplacement
      ) {
        manualReview.push({
          code: 'coach-replacement-target-anchored',
          teamId: team.id,
          message: `replacement coach ${mappedReplacement} for team ${team.id} already anchors another team`,
          candidateCoachIds: [mappedReplacement],
        });
        return result;
      }
      result.coachId = mappedReplacement;
      anchoredCoachIds.delete(originalCoachId);
      anchoredCoachIds.add(mappedReplacement);
      appliedReplacements.set(originalCoachId, mappedReplacement);
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

      const { usable, anchoredElsewhere } = candidatesFor(result);
      if (usable.length === 1 && allowHousehold) {
        result.coachId = usable[0];
        anchoredCoachIds.add(usable[0]);
        coachReplacements.push({
          teamId: team.id,
          fromCoachId: originalCoachId,
          toCoachId: usable[0],
        });
      } else if (usable.length >= 1) {
        manualReview.push({
          code: usable.length > 1 ? 'ambiguous-coach-replacement' : 'coach-replacement-candidate',
          teamId: team.id,
          message:
            usable.length > 1
              ? `team ${team.id} lost coach ${originalCoachId} and has ${usable.length} possible replacements`
              : `team ${team.id} lost coach ${originalCoachId}; ${usable[0]} could replace them (enable allowHouseholdCoachReplacement)`,
          candidateCoachIds: usable,
        });
      } else if (anchoredElsewhere.length > 0) {
        manualReview.push({
          code: 'coach-candidates-anchored-elsewhere',
          teamId: team.id,
          message: `team ${team.id} lost coach ${originalCoachId}; the only candidate(s) already anchor other teams`,
          candidateCoachIds: anchoredElsewhere,
        });
      }
      return result;
    }

    // 3. Late head coach attaching to their child's coachless preserved team.
    if (!originalCoachId) {
      const { usable } = candidatesFor(result);
      if (usable.length === 1 && allowLateAttach) {
        result.coachId = usable[0];
        anchoredCoachIds.add(usable[0]);
        coachReplacements.push({ teamId: team.id, fromCoachId: null, toCoachId: usable[0] });
      } else if (usable.length > 1) {
        manualReview.push({
          code: 'ambiguous-coach-attachment',
          teamId: team.id,
          message: `coachless team ${team.id} has ${usable.length} possible coach attachments`,
          candidateCoachIds: usable,
        });
      }
    }

    return result;
  });

  return { teams: nextTeams, coachDrops, coachReplacements, manualReview };
}
