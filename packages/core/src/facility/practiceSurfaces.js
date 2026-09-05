/**
 * From the names a practice sheet writes to the ground the graph holds.
 *
 * A practice row, an alias row and a constraint row all name ground the same
 * way: a venue spelling, a field label, and sometimes a sub-unit. This module
 * turns that triple into surface ids **by graph structure alone**:
 *
 * ```text
 * venue     exact venue name, else exact venue-complex name (every venue in it)
 * field     every surface with that name under those venues
 * subunit   every child of those surfaces named `${field} ${subunit}`
 * ```
 *
 * When more than one surface survives, the answer carries all of them and
 * says `ambiguous`. `Maplewood / Field 1` is the case: the practice sheets
 * spell the venue `Maplewood`, the declared complex holds `Maplewood Back`
 * and `Maplewood Front`, and both have a `Field 1`. Nothing here consults a
 * decoder ring to break that tie — the fields sheet says `Maplewood Back`,
 * and reading the practice sheet through it would resolve a disagreement the
 * corpus keeps on purpose (PHASE_8_PLAN §8.0: "assert the disagreement rather
 * than resolving it"). The sub-unit does break it, structurally: only
 * `Maplewood Back / Field 1` has a child `Field 1 A`.
 *
 * `venue-unknown` and `surface-unknown` are answers, not absences: a caller
 * that turned either into "no clash" would be folding unknown into zero,
 * which `docs/BUILD_PLAN_STATUS.md` §4 records as having happened four times.
 *
 * @module facility/practiceSurfaces
 */

/**
 * The display name of a sub-unit: the sub-unit written after the field it
 * sits in, so `Field 1 A` and `Field 2 A` stay distinct within a venue
 * (`FacilitySurface.name` is documented as unique within it). One rule,
 * shared by the layer that declares the names and the resolver that reads
 * them, so the two cannot drift apart.
 *
 * @param {string} field
 * @param {string|null} subunit
 * @returns {string}
 */
export function practiceSurfaceName(field, subunit) {
  return subunit === null ? field : `${field} ${subunit}`;
}

/**
 * How a name triple resolved. Lowercase on purpose: these are states of an
 * answer, not finding codes, and the finding a caller raises on each is its
 * own to choose.
 *
 * @readonly
 * @enum {string}
 */
export const PRACTICE_SURFACE_RESOLUTION = Object.freeze({
  /** Exactly one surface. */
  RESOLVED: 'resolved',
  /** More than one surface fits the name; all are carried. */
  AMBIGUOUS: 'ambiguous',
  /** No venue or complex of that name. */
  VENUE_UNKNOWN: 'venue-unknown',
  /** The venue is known and no surface under it carries the field name. */
  SURFACE_UNKNOWN: 'surface-unknown',
  /** The field is known and none of its children carries the sub-unit name. */
  SUBUNIT_UNKNOWN: 'subunit-unknown',
  /** No field was named at all: the answer is the venue(s), and no surface. */
  VENUE_ONLY: 'venue-only',
});

/**
 * @typedef {Object} PracticeSurfaceResolution
 * @property {string} venue - as asked
 * @property {string|null} field - as asked
 * @property {string|null} subunit - as asked
 * @property {'venue'|'complex'|null} venueSource - how the venue name resolved
 * @property {string[]} venueIds - sorted; empty when the venue is unknown
 * @property {string[]} surfaceIds - sorted; every surface that fits, or none
 * @property {string} status - a {@link PRACTICE_SURFACE_RESOLUTION} value
 */

/**
 * Which venue ids a practice-corpus venue spelling names.
 *
 * @param {import('./types.js').FacilityGraph} graph
 * @param {import('./types.js').VenueComplexMap} complexMap
 * @param {string} venueName
 * @returns {{ venueIds: string[], venueSource: 'venue'|'complex'|null }}
 */
export function resolvePracticeVenue(graph, complexMap, venueName) {
  const direct = graph.venueIds.filter((id) => graph.venues[id].name === venueName);
  if (direct.length > 0) return { venueIds: [...direct].sort(), venueSource: 'venue' };
  const complexId = complexMap.complexIds.find((id) => complexMap.complexes[id].name === venueName);
  if (complexId) {
    return {
      venueIds: [...complexMap.complexes[complexId].venueIds].sort(),
      venueSource: 'complex',
    };
  }
  return { venueIds: [], venueSource: null };
}

/**
 * Resolve a `(venue, field, subunit)` triple to surface ids by structure.
 *
 * @param {import('./types.js').FacilityGraph} graph
 * @param {import('./types.js').VenueComplexMap} complexMap
 * @param {{ venue: string, field?: string|null, subunit?: string|null }} query
 * @returns {PracticeSurfaceResolution}
 */
export function resolvePracticeSurface(graph, complexMap, query) {
  const field = query.field ?? null;
  const subunit = query.subunit ?? null;
  const { venueIds, venueSource } = resolvePracticeVenue(graph, complexMap, query.venue);
  const base = { venue: query.venue, field, subunit, venueSource, venueIds };

  if (venueIds.length === 0) {
    return { ...base, surfaceIds: [], status: PRACTICE_SURFACE_RESOLUTION.VENUE_UNKNOWN };
  }
  if (field === null) {
    return { ...base, surfaceIds: [], status: PRACTICE_SURFACE_RESOLUTION.VENUE_ONLY };
  }

  const venueSet = new Set(venueIds);
  const fieldIds = graph.surfaceIds.filter(
    (id) => venueSet.has(graph.surfaces[id].venueId) && graph.surfaces[id].name === field
  );
  if (fieldIds.length === 0) {
    return { ...base, surfaceIds: [], status: PRACTICE_SURFACE_RESOLUTION.SURFACE_UNKNOWN };
  }

  let surfaceIds = fieldIds;
  if (subunit !== null) {
    const childName = practiceSurfaceName(field, subunit);
    surfaceIds = fieldIds.flatMap((id) =>
      graph.surfaces[id].childIds.filter((childId) => graph.surfaces[childId].name === childName)
    );
    if (surfaceIds.length === 0) {
      return { ...base, surfaceIds: [], status: PRACTICE_SURFACE_RESOLUTION.SUBUNIT_UNKNOWN };
    }
  }
  surfaceIds = [...surfaceIds].sort();
  return {
    ...base,
    surfaceIds,
    status:
      surfaceIds.length === 1
        ? PRACTICE_SURFACE_RESOLUTION.RESOLVED
        : PRACTICE_SURFACE_RESOLUTION.AMBIGUOUS,
  };
}
