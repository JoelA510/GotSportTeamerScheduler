/**
 * Venue complexes: which separately-named venues are **one site** for somebody
 * who has to get from one to the other.
 *
 * ## Why this exists
 *
 * Prompt 2.1 seeded two coach-travel policies — `coach-travel-between-venues`
 * (60 minutes) and `coach-travel-within-venue` (15 minutes, *"within one venue
 * complex"*). Nothing in the codebase could express *which named venues form
 * one complex*, so `waivers/coachTravel.js` decided with
 * `from.venueId === to.venueId` and the 15-minute rule was structurally
 * unreachable for the case it was written for: every distinct venue name got
 * the 60-minute drive floor, including two halves of one park.
 *
 * ## Why it lives in `facility/` and not on the facility graph
 *
 * `facility/` owns venue identity (`season2026VenueId()`), and every module
 * that talks about venues imports from here, so this is the package that can
 * answer "which venue is this?" without a cycle.
 *
 * It is deliberately **not** a field on `FacilityVenue` and not a relation on
 * the graph. The graph's two relations — containment and overlap — are both
 * strictly *intra*-venue statements about bookable ground, and every check
 * built on them (`occupancy.js`, `eligibility.js`) would be unaffected by a
 * complex: two pitches in different venues never conflict however close they
 * are. A complex answers a different question — *how long does it take a person
 * to get from one to the other* — and putting it on the graph would invite an
 * occupancy check to read it as "these two sites are the same ground", which is
 * exactly the conflation `facilityGraph.js` refuses between containment and
 * overlap. It is also why the travel evaluator can take this small map rather
 * than a whole facility graph it has no other use for.
 *
 * ## A complex is declared, never inferred
 *
 * There is deliberately no rule such as "venues whose names share a first word
 * are one complex". `"Maplewood Back"` and `"Maplewood Front"` are one complex
 * because an operator says they are, not because they share a word — a name
 * heuristic would be a guess wearing a fact's clothes, and it would silently
 * merge any two sites that happened to share one. The same reasoning as
 * `formatEquipment` in `schemas.js`, which refuses to derive `` `${format}
 * goals` ``.
 *
 * The builder **throws** on every structural defect rather than repairing it,
 * exactly as `buildFacilityGraph()` does: a complex naming a venue twice, or
 * two complexes claiming one venue, is a bug in the producer and a quietly
 * repaired one would change which travel floor applies to a real coach.
 *
 * @module facility/venueComplex
 */

import { z } from 'zod';

import { deepFreeze } from './facilityGraph.js';

/** A non-empty opaque identifier. Matches `schemas.js`. */
const IdSchema = z.string().min(1, { message: 'ids must be non-empty strings' });

/**
 * One complex: two or more venues that are one site to walk between.
 *
 * `venueIds` has a minimum of **two** on purpose. A one-venue complex changes
 * no decision this model exists to make — a venue is already the same site as
 * itself — so it can only mislead a reader into thinking something was
 * declared. `source` is required and nullable rather than optional: a complex
 * is a standing operational fact somebody stated, and who stated it is the
 * provenance an operator needs, in the style of `ConstraintRecord.source`.
 *
 * @see {@link import('./types.js').VenueComplex}
 */
export const VenueComplexSchema = z
  .object({
    id: IdSchema,
    name: z.string().min(1),
    venueIds: z.array(IdSchema).min(2, {
      message: 'a venue complex must name at least two venues; a venue is already itself',
    }),
    note: z.string().nullable().default(null),
    source: z.string().nullable().default(null),
  })
  .strict();

/** Plain input accepted by {@link buildVenueComplexMap}. */
export const VenueComplexMapInputSchema = z
  .object({
    complexes: z.array(VenueComplexSchema).default([]),
  })
  .strict();

/**
 * Build an immutable venue-complex map from declared data.
 *
 * Rejected inputs: a duplicate complex id, a complex naming the same venue
 * twice, and a venue claimed by two complexes.
 *
 * @param {{ complexes?: ReadonlyArray<Object> }} input
 * @returns {import('./types.js').VenueComplexMap}
 */
export function buildVenueComplexMap(input) {
  const parsed = VenueComplexMapInputSchema.parse(input);

  /** @type {Record<string, import('./types.js').VenueComplex>} */
  const complexes = {};
  /** @type {Record<string, string>} */
  const complexIdByVenueId = {};

  for (const complex of parsed.complexes) {
    if (complexes[complex.id]) {
      throw new Error(`facility: duplicate venue complex id "${complex.id}"`);
    }
    const venueIds = [...complex.venueIds].sort();
    if (new Set(venueIds).size !== venueIds.length) {
      throw new Error(`facility: venue complex "${complex.id}" names the same venue twice`);
    }
    for (const venueId of venueIds) {
      const owner = complexIdByVenueId[venueId];
      if (owner) {
        throw new Error(
          `facility: venue "${venueId}" is claimed by two complexes - "${owner}" and "${complex.id}"`
        );
      }
      complexIdByVenueId[venueId] = complex.id;
    }
    complexes[complex.id] = {
      id: complex.id,
      name: complex.name,
      venueIds,
      note: complex.note,
      source: complex.source,
    };
  }

  const complexIds = Object.keys(complexes).sort();
  const venueIds = Object.keys(complexIdByVenueId).sort();

  return deepFreeze(
    /** @type {import('./types.js').VenueComplexMap} */ ({
      complexes,
      complexIds,
      complexIdByVenueId,
      venueIds,
      stats: { complexCount: complexIds.length, venueCount: venueIds.length },
    })
  );
}

/**
 * The map a club with no declared complexes has.
 *
 * Named and exported rather than left to a `= {}` default so that "this season
 * declares no complexes" is something a caller *states*, and reads in a diff as
 * a decision rather than as an omission.
 *
 * @type {import('./types.js').VenueComplexMap}
 */
export const EMPTY_VENUE_COMPLEX_MAP = buildVenueComplexMap({ complexes: [] });

/**
 * The complex a venue belongs to, or `null` when it belongs to none.
 *
 * @param {import('./types.js').VenueComplexMap} map
 * @param {string} venueId
 * @returns {string|null}
 */
export function complexIdOf(map, venueId) {
  return map.complexIdByVenueId[venueId] ?? null;
}

/**
 * Look a complex up, or `null`.
 *
 * @param {import('./types.js').VenueComplexMap} map
 * @param {string} complexId
 * @returns {import('./types.js').VenueComplex|null}
 */
export function getVenueComplex(map, complexId) {
  return map.complexes[complexId] ?? null;
}

/**
 * Are these two venues one site?
 *
 * True when they are the same venue — a venue is trivially its own site, which
 * is why an empty map reproduces venue-name equality exactly — or when both
 * belong to the same declared complex.
 *
 * @param {import('./types.js').VenueComplexMap} map
 * @param {string} venueIdA
 * @param {string} venueIdB
 * @returns {boolean}
 */
export function sameVenueComplex(map, venueIdA, venueIdB) {
  if (venueIdA === venueIdB) return true;
  const a = complexIdOf(map, venueIdA);
  return a !== null && a === complexIdOf(map, venueIdB);
}
