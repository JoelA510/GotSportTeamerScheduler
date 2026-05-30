/**
 * Pre-generation teaming pipeline.
 *
 * Composes the transforms that run on generator players BEFORE
 * `generateTeams`:
 *   1. link imported coaches to their player-children (so the generator anchors
 *      a team per coaching family — separate coach exports now drive teaming);
 *   2. flag coach-children so play-up "route A" (a coaching parent) is honored;
 *   3. apply play-up / play-down eligibility.
 *
 * Pure module — no React / Supabase imports.
 */

import { linkCoachesToPlayers } from './coachLinking.js';
import { applyPlayUpEligibility } from './playUp.js';

function collectCoachChildIds(coaches) {
  const ids = new Set();
  for (const coach of coaches ?? []) {
    if (Array.isArray(coach?.children)) {
      for (const child of coach.children) {
        if (child?.player_id) ids.add(String(child.player_id));
      }
    }
    const single = coach?.player_id ?? coach?.playerId;
    if (single) ids.add(String(single));
  }
  return ids;
}

/**
 * @param {Object} params
 * @param {Array<Object>} params.players - generator players (id, division, ...)
 * @param {Array<Object>} [params.coaches] - imported coaches with child links
 * @param {Array<Object>|Object} [params.divisions]
 * @param {number} params.seasonYear
 * @param {string} [params.cutoffMode]
 * @param {boolean} [params.remapBlocked=false] - single-division flows keep this
 *   false (annotate only); multi-division flows can remap illegal placements.
 * @returns {{ players: Array<Object>, diagnostics: { coachLinking: Object, playUp: Object } }}
 */
export function prepareTeamingInput({
  players,
  coaches = [],
  divisions = [],
  seasonYear,
  cutoffMode,
  remapBlocked = false,
}) {
  if (!Array.isArray(players)) throw new TypeError('players must be an array');

  const linked = linkCoachesToPlayers({ players, coaches });

  // A coach's child is coached by their parent — mark them so a play-up gains
  // the "coaching parent" sanction route.
  const coachChildIds = collectCoachChildIds(coaches);
  const flagged = linked.players.map((player) =>
    coachChildIds.has(String(player.id)) ? { ...player, isCoachChild: true } : player
  );

  const playUp = applyPlayUpEligibility({
    players: flagged,
    divisions,
    seasonYear,
    cutoffMode,
    remapBlocked,
  });

  return {
    players: playUp.players,
    diagnostics: { coachLinking: linked.diagnostics, playUp: playUp.diagnostics },
  };
}
