/**
 * Pre-generation teaming pipeline.
 *
 * Composes the transforms that run on generator players BEFORE
 * `generateTeams`:
 *   1. canonicalize buddy fields (buddyId / buddy_id / mutual_buddy_code → buddyId);
 *   2. link imported coaches to their player-children (so the generator anchors
 *      a team per coaching family — separate coach exports now drive teaming);
 *   3. flag coach-children so play-up "route A" (a coaching parent) is honored;
 *   4. apply play-up / play-down eligibility.
 *
 * Pure module — no React / Supabase imports.
 */

import { linkCoachesToPlayers } from './coachLinking.js';
import { applyPlayUpEligibility } from './playUp.js';
import { normalizeBuddyLinks } from './buddyLinking.js';

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
 * @returns {{ players: Array<Object>, diagnostics: { buddyLinking: Array<Object>, coachLinking: Object, playUp: Object } }}
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

  const buddies = normalizeBuddyLinks(players);

  const linked = linkCoachesToPlayers({ players: buddies.players, coaches });

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
    diagnostics: {
      buddyLinking: buddies.diagnostics,
      coachLinking: linked.diagnostics,
      playUp: playUp.diagnostics,
    },
  };
}
