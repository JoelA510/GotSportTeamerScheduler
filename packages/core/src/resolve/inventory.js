/**
 * The slot inventory: every date, surface and kickoff the baseline schedule
 * actually used, and nothing else.
 *
 * This file is the **anti-third-solver guarantee** in data form. `resolve/` has
 * no round-robin generator and no slot generator; the only places it can offer
 * a game are places the schedule in front of it already used. A run over the
 * season-2026 corpus can put a 9v9 game on Pitch 4B at 13:50 because the corpus
 * did; it cannot put one there at 13:55, because nothing ever kicked off at
 * 13:55 anywhere at that venue that day.
 *
 * The one admitted exception is a change request, which brings its own slot —
 * an externally-published fixture arrives at the time the other league
 * published, and the club does not get to invent one for it. That exception is
 * per game, recorded on the state as `admittedSlotsByGameId`, and stamped
 * `RESOLVE_CHANGE_SLOT_OUTSIDE_INVENTORY` so it is visible.
 *
 * @module resolve/inventory
 */

import { changeCountsFor, scoreObjective } from './objective.js';

/**
 * What the objective says one candidate's distance from the anchor costs.
 *
 * Delegates to {@link scoreObjective} rather than adding a comparator of its
 * own: the ordering a game is offered its slots in **is** the objective, and a
 * second opinion here would be the fourth fitness function the whole of
 * `objective.js` exists to prevent.
 *
 * @param {import('./types.js').Slot} anchor
 * @param {import('./types.js').Slot} candidate
 * @param {Readonly<Record<string, number>>} weights
 * @returns {number}
 */
function changeCostOf(anchor, candidate, weights) {
  return scoreObjective(changeCountsFor(anchor, candidate), weights).changeCost;
}

/**
 * Build the inventory from the baseline games.
 *
 * `surfaceVenues` adds surfaces the baseline never used to the *venue lookup*
 * only — never to `surfacesByDateVenueFormat`, which is what the placer offers.
 * "Which venue does Pitch 2 belong to" is a fact about the facility graph and
 * not about how the schedule happened to use it, and a change request that
 * names a surface no baseline row stood on would otherwise leave the game
 * wearing its old venue id while standing on another venue's ground.
 *
 * @param {ReadonlyArray<import('./types.js').PlacedGame>} games
 * @param {{ surfaceVenues?: Record<string, string> }} [options]
 * @returns {import('./types.js').SlotInventory}
 */
export function buildSlotInventory(games, options = {}) {
  if (!Array.isArray(games) || games.length === 0) {
    throw new Error(
      'resolve: a slot inventory built from zero games would offer nothing to anybody, and every placement in the run would be refused for a reason that has nothing to do with the schedule (incident 4)'
    );
  }

  /** @type {Set<string>} */
  const dates = new Set();
  /** @type {Record<string, string>} */
  const venueBySurfaceId = {};
  /** @type {Record<string, Set<number>>} */
  const kickoffs = {};
  /** @type {Record<string, Set<string>>} */
  const surfaces = {};
  /** @type {Set<string>} */
  const slots = new Set();

  for (const game of games) {
    dates.add(game.date);
    venueBySurfaceId[game.surfaceId] = game.venueId;

    const venueKey = `${game.date}|${game.venueId}`;
    if (!kickoffs[venueKey]) kickoffs[venueKey] = new Set();
    kickoffs[venueKey].add(game.startMinutes);

    const formatKey = `${game.date}|${game.venueId}|${game.format ?? ''}`;
    if (!surfaces[formatKey]) surfaces[formatKey] = new Set();
    surfaces[formatKey].add(game.surfaceId);

    slots.add(`${game.date}|${game.surfaceId}|${game.startMinutes}`);
  }

  /** @type {Record<string, number[]>} */
  const kickoffsByDateVenue = {};
  for (const [key, values] of Object.entries(kickoffs)) {
    kickoffsByDateVenue[key] = [...values].sort((a, b) => a - b);
  }
  /** @type {Record<string, string[]>} */
  const surfacesByDateVenueFormat = {};
  for (const [key, values] of Object.entries(surfaces)) {
    surfacesByDateVenueFormat[key] = [...values].sort();
  }

  for (const [surfaceId, venueId] of Object.entries(options.surfaceVenues ?? {})) {
    if (venueBySurfaceId[surfaceId] === undefined) venueBySurfaceId[surfaceId] = venueId;
  }

  // **Frozen all the way down, not just at the top.** A shallow
  // `Object.freeze()` here leaves `kickoffsByDateVenue['<date>|<venue>']` a
  // mutable array, and `createResolveState()`'s deep freeze cannot repair that:
  // it stops at any object that is already frozen, so a shallow-frozen
  // inventory is skipped whole. One `push()` of a kickoff nobody ever played
  // would then flip `isSlotAdmissible()` from false to true and let `applyMove`
  // place a game on an invented slot — through the writer, so the move is
  // ledgered and `freeze-audit` sees nothing wrong with it. The anti-slot-
  // inventor guarantee is one of the three things that stop this package
  // becoming a third scheduler, and a guarantee that a single `push` can revoke
  // is not one.
  for (const values of Object.values(kickoffsByDateVenue)) Object.freeze(values);
  for (const values of Object.values(surfacesByDateVenueFormat)) Object.freeze(values);

  return Object.freeze({
    dates: Object.freeze([...dates].sort()),
    venueBySurfaceId: Object.freeze(venueBySurfaceId),
    kickoffsByDateVenue: Object.freeze(kickoffsByDateVenue),
    surfacesByDateVenueFormat: Object.freeze(surfacesByDateVenueFormat),
    slotCount: slots.size,
  });
}

/**
 * The slots this game could be offered, **ordered by the objective's change
 * terms**, cheapest first.
 *
 * Until Prompt 4.2 this function carried two hand-written orderings:
 * `'baseline-first'` (nearest to the anchor) for a change request, and
 * `'earliest-first'` for a global re-solve. They were the minimal-diff policy
 * and its absence, expressed as two sort comparators. Both are now the same
 * comparator reading the same weight table: `changeCostOf()` below asks
 * `resolve/objective.js` what a candidate's distance from the anchor costs, and
 * a run that wants the old earliest-first behaviour gets it by setting the three
 * change weights to zero — which is what `reoptimiseWholeSeason()` offers by
 * name, and what stamps `RESOLVE_OBJECTIVE_CHANGE_TERM_DISABLED` on the run.
 *
 * Under the default weights the anchor slot itself always sorts first, which is
 * the hold rule expressed as an ordering, and the next-nearest kickoff follows —
 * what put incident 3's displaced 12:30 fixture at 12:00 rather than somewhere
 * merely legal.
 *
 * **Ties are broken by earliest kickoff, then surface id, and by nothing else.**
 * Not by proximity: proximity is a weighted term, and a tie-break that quietly
 * reinstated it would make the zero-weight run impossible to express — every
 * game would stay where it was however the objective was configured, and the
 * positive control that measures what freeze prevents would measure nothing.
 *
 * The quality half of the objective is not consulted here. It needs
 * `checkPlacement()` — engines this module does not hold — so it is applied by
 * `chooseSlot()` in `stages.js`, which walks this ordering and scores each
 * candidate through the same one function.
 *
 * @param {import('./types.js').ResolveState} state
 * @param {string} gameId
 * @param {import('./types.js').Slot} anchor
 * @param {Readonly<Record<string, number>>} weights - see `resolve/objective.js`
 * @returns {import('./types.js').Slot[]}
 */
export function candidateSlotsFor(state, gameId, anchor, weights) {
  const game = state.baseline[gameId];
  if (!game) throw new Error(`resolve: no baseline game "${gameId}"`);
  const inventory = state.inventory;
  const venueId = inventory.venueBySurfaceId[anchor.surfaceId] ?? game.venueId;

  const formatKey = `${anchor.date}|${venueId}|${game.format ?? ''}`;
  let surfaceIds = inventory.surfacesByDateVenueFormat[formatKey] ?? [];
  if (surfaceIds.length === 0) {
    // No row of this format stood at this venue on this date. Fall back to the
    // surfaces the venue used that day at all — still the baseline's own
    // ground, never a surface invented for the occasion.
    surfaceIds = [
      ...new Set(
        Object.entries(inventory.surfacesByDateVenueFormat)
          .filter(([key]) => key.startsWith(`${anchor.date}|${venueId}|`))
          .flatMap(([, ids]) => ids)
      ),
    ].sort();
  }
  const kickoffMinutes = inventory.kickoffsByDateVenue[`${anchor.date}|${venueId}`] ?? [];

  /** @type {import('./types.js').Slot[]} */
  const candidates = [];
  /** @type {Set<string>} */
  const seen = new Set();
  // The slots a change request brought with it are candidates for the game it
  // named, and for no other. `isSlotAdmissible()` already admits them at the
  // writer; a placer that could not offer them would be able to accept a slot
  // it could never propose, and a game lifted back out of its requested slot
  // could never be returned to it.
  for (const key of state.admittedSlotsByGameId[gameId] ?? []) {
    const [date, surfaceId, startMinutes] = key.split('|');
    if (date !== anchor.date) continue;
    seen.add(key);
    candidates.push({ date, surfaceId, startMinutes: Number(startMinutes) });
  }
  for (const startMinutes of kickoffMinutes) {
    for (const surfaceId of surfaceIds) {
      const key = `${anchor.date}|${surfaceId}|${startMinutes}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ date: anchor.date, surfaceId, startMinutes });
    }
  }

  // **Decorate, sort, undecorate.** Scoring inside the comparator asked the
  // objective twice per comparison and allocated a fresh six-term breakdown for
  // each call: for the ~400 candidates a busy date offers, roughly 6,800 calls
  // and 48,000 objects thrown away per placement. The cost of a candidate does
  // not depend on what it is being compared against, so it is computed once per
  // candidate. `tests/minimalDiff.test.js` asserts the ordering is byte-for-byte
  // the one the comparator produced rather than assuming it.
  const scored = candidates.map((slot) => ({ slot, cost: changeCostOf(anchor, slot, weights) }));
  scored.sort((a, b) => {
    if (a.cost !== b.cost) return a.cost - b.cost;
    // Deterministic and reference-blind, so two runs over the same data produce
    // the same answer and a run with the change terms switched off is genuinely
    // free to move things.
    if (a.slot.startMinutes !== b.slot.startMinutes) {
      return a.slot.startMinutes - b.slot.startMinutes;
    }
    return a.slot.surfaceId.localeCompare(b.slot.surfaceId);
  });
  return scored.map((entry) => entry.slot);
}
