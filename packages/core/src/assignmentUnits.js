/**
 * Explicit, typed assignment units for team generation (project-hardening PR 03). Replaces the
 * implicit "a unit is just an array of players" model with a structured object, WITHOUT changing
 * fresh-generation behavior. Buddy grouping, coach/assistant classification, the conflicting-coach
 * guard, and per-unit skill totals all live here now. Later PRs use the richer fields
 * (`targetTeamId`, `locked`, constraints) for snapshot-aware placement; fresh generation only emits
 * 'general' | 'mutual-buddy' | 'coach' | 'assistant' units.
 *
 * See docs/architecture/incremental-teaming-hardening.md.
 *
 * @typedef {'general' | 'mutual-buddy' | 'coach' | 'assistant' | 'targeted-buddy' | 'locked'} AssignmentUnitType
 *
 * @typedef {Object} AssignmentUnit
 * @property {string} id
 * @property {AssignmentUnitType} type
 * @property {any[]} players
 * @property {string | null} targetTeamId
 * @property {string | null} coachId
 * @property {string[]} assistantCoachIds
 * @property {boolean} locked
 * @property {string[]} hardConstraints
 * @property {string[]} softConstraints
 * @property {number} skillTotal
 * @property {Array<{ code: string, message: string }>} diagnostics
 *
 * @typedef {Object} BuddyDiagnostics
 * @property {Array<{ playerIds: string[] }>} mutualPairs
 * @property {Array<{ playerId: string, requestedBuddyId: string, reason: string }>} unmatchedRequests
 */

/**
 * Read a player's numeric skill rating, defaulting to 0 for missing/non-finite values.
 * @param {any} player
 * @returns {number}
 */
export function getSkillRating(player) {
  return typeof player.skillRating === 'number' && Number.isFinite(player.skillRating)
    ? player.skillRating
    : 0;
}

/**
 * Sum the skill ratings of a unit's players.
 * @param {any[]} players
 * @returns {number}
 */
export function calculateUnitSkill(players) {
  return players.reduce((total, player) => total + getSkillRating(player), 0);
}

/**
 * Build a typed assignment unit, filling defaults. `id` defaults to the joined player ids.
 * @param {Partial<AssignmentUnit> & { players: any[] }} init
 * @returns {AssignmentUnit}
 */
export function createAssignmentUnit(init) {
  const players = init.players ?? [];
  return {
    id: init.id ?? players.map((player) => player.id).join('+'),
    type: init.type ?? 'general',
    players,
    targetTeamId: init.targetTeamId ?? null,
    coachId: init.coachId ?? null,
    assistantCoachIds: init.assistantCoachIds ?? [],
    locked: init.locked ?? false,
    hardConstraints: init.hardConstraints ?? [],
    softConstraints: init.softConstraints ?? [],
    skillTotal: init.skillTotal ?? 0,
    diagnostics: init.diagnostics ?? [],
  };
}

/**
 * Classify a raw player group (a single player, or a confirmed mutual buddy pair) into a typed
 * unit. Mirrors the legacy coach/general split exactly: a group with any `coachId`/`assistantCoachId`
 * becomes a coach unit (or an assistant unit when only assistants are present), throwing when two
 * distinct head coaches collide; otherwise a 2-player group is a mutual-buddy unit and a single
 * player is a general unit.
 * @param {any[]} players
 * @returns {AssignmentUnit}
 */
function classifyUnit(players) {
  const coachPlayers = players.filter((player) => player.coachId || player.assistantCoachId);
  if (coachPlayers.length > 0) {
    const coachIds = new Set(coachPlayers.map((player) => player.coachId).filter(Boolean));
    const assistantCoachIds = new Set(
      coachPlayers.map((player) => player.assistantCoachId).filter(Boolean)
    );
    if (coachIds.size > 1) {
      throw new Error(
        `Conflicting coach assignments for players in unit: ${players.map((player) => player.id).join(', ')}`
      );
    }
    const coachId = coachIds.size > 0 ? [...coachIds][0] : null;
    return createAssignmentUnit({
      type: coachId ? 'coach' : 'assistant',
      players,
      coachId,
      assistantCoachIds: [...assistantCoachIds],
      skillTotal: calculateUnitSkill(players),
    });
  }
  return createAssignmentUnit({
    type: players.length > 1 ? 'mutual-buddy' : 'general',
    players,
    skillTotal: calculateUnitSkill(players),
  });
}

/**
 * Group division players into typed assignment units, honoring mutual buddy requests and recording
 * buddy diagnostics. Preserves the legacy unit ordering and pairing semantics exactly: a confirmed
 * reciprocal pair becomes one unit (initiating player first), and self / non-reciprocal / missing
 * buddy requests are diagnosed while the player falls back to a solo unit.
 * @param {any[]} players
 * @returns {{ units: AssignmentUnit[], buddyDiagnostics: BuddyDiagnostics }}
 */
export function buildAssignmentUnits(players) {
  /** @type {AssignmentUnit[]} */
  const units = [];
  const visited = new Set();
  const playersById = new Map(players.map((player) => [player.id, player]));
  /** @type {BuddyDiagnostics} */
  const buddyDiagnostics = { mutualPairs: [], unmatchedRequests: [] };
  const recordedUnmatched = new Set();
  const addUnmatchedRequest = (playerId, requestedBuddyId, reason) => {
    const key =
      reason === 'self-reference' ? `${playerId}::self` : `${playerId}::${requestedBuddyId}`;
    if (!recordedUnmatched.has(key)) {
      buddyDiagnostics.unmatchedRequests.push({ playerId, requestedBuddyId, reason });
      recordedUnmatched.add(key);
    }
  };

  for (const player of players) {
    if (visited.has(player.id)) {
      continue;
    }

    const buddyId = player.buddyId;
    if (buddyId) {
      if (buddyId === player.id) {
        addUnmatchedRequest(player.id, buddyId, 'self-reference');
      } else if (playersById.has(buddyId)) {
        const buddy = playersById.get(buddyId);
        if (buddy.buddyId === player.id && !visited.has(buddy.id)) {
          units.push(classifyUnit([player, buddy]));
          visited.add(player.id);
          visited.add(buddy.id);
          const pair = [player.id, buddy.id].sort();
          buddyDiagnostics.mutualPairs.push({ playerIds: pair });
          continue;
        }
        addUnmatchedRequest(player.id, buddyId, 'not-reciprocated');
      } else {
        addUnmatchedRequest(player.id, buddyId, 'missing-player');
      }
    }

    units.push(classifyUnit([player]));
    visited.add(player.id);
  }

  return { units, buddyDiagnostics };
}
