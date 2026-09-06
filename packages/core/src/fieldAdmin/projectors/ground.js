/**
 * The one place a projector turns a sheet's spelling of ground into graph ids.
 *
 * Every projector in this directory needs the same thing and must answer it the
 * same way, so the resolution lives here rather than five times over.
 * Underneath it is `facility/practiceSurfaces.js` `resolvePracticeSurface()` -
 * structure only, no decoder ring consulted, because resolving a practice sheet
 * *through* a ring would silently settle a disagreement the corpus keeps on
 * purpose.
 *
 * The return carries an {@link INTERPRETATION} value rather than throwing,
 * because "the graph does not hold this ground" is an **answer** an operator
 * needs to see beside the raw cell, not an exception that loses the row.
 * `docs/BUILD_PLAN_STATUS.md` §4 records folding unknown into zero as having
 * happened four times.
 *
 * @module fieldAdmin/projectors/ground
 */

import {
  PRACTICE_SURFACE_RESOLUTION,
  resolvePracticeSurface,
} from '../../facility/practiceSurfaces.js';
import { INTERPRETATION } from '../reasonCodes.js';

/**
 * Every resolution status, read back out of the enum so a status added without
 * an arm below fails rather than ageing a list written by hand.
 */
const RESOLUTION_VALUES = Object.freeze(Object.values(PRACTICE_SURFACE_RESOLUTION));

/**
 * Resolve a `(venue, field, subunit)` triple and say how confident to be.
 *
 * The mapping from resolution status to interpretation, stated once:
 *
 * ```text
 * resolved        interpreted    exactly one surface fits
 * ambiguous       doubtful       more than one fits; all are carried
 * venue-only      interpreted    no field was named, and the answer is the venue
 * venue-unknown   unresolvable   no ground is reachable at all
 * surface-unknown unresolvable   the venue is known and carries no such surface
 * subunit-unknown unresolvable   the field is known and carries no such sub-unit
 * ```
 *
 * `ambiguous` is **doubtful rather than resolvable** on purpose. `Maplewood /
 * Field 1` fits two surfaces because the declared complex holds `Maplewood
 * Back` and `Maplewood Front` and both have a `Field 1`; applying a blackout to
 * both would close ground no sheet closed, and applying it to neither would
 * lose the row. Carrying both and refusing to apply is the only answer that
 * loses nothing.
 *
 * @param {import('../../facility/types.js').FacilityGraph} graph
 * @param {import('../../facility/types.js').VenueComplexMap} complexMap
 * @param {{ venue: string, field?: string|null, subunit?: string|null }} query
 * @returns {{ venueIds: string[], surfaceIds: string[], status: string, interpretation: string, reason: string|null }}
 */
export function resolveGround(graph, complexMap, query) {
  const resolved = resolvePracticeSurface(graph, complexMap, query);
  const base = {
    venueIds: resolved.venueIds,
    surfaceIds: resolved.surfaceIds,
    status: resolved.status,
  };

  switch (resolved.status) {
    case PRACTICE_SURFACE_RESOLUTION.RESOLVED:
      return { ...base, interpretation: INTERPRETATION.INTERPRETED, reason: null };
    case PRACTICE_SURFACE_RESOLUTION.VENUE_ONLY:
      return { ...base, interpretation: INTERPRETATION.INTERPRETED, reason: null };
    case PRACTICE_SURFACE_RESOLUTION.AMBIGUOUS:
      return {
        ...base,
        interpretation: INTERPRETATION.DOUBTFUL,
        reason: `"${query.venue} / ${query.field ?? ''}" fits ${resolved.surfaceIds.length} surfaces (${resolved.surfaceIds.join(', ')}); every one is carried and none is chosen`,
      };
    case PRACTICE_SURFACE_RESOLUTION.VENUE_UNKNOWN:
      return {
        ...base,
        interpretation: INTERPRETATION.UNRESOLVABLE,
        reason: `the graph holds no venue or complex named "${query.venue}"`,
      };
    case PRACTICE_SURFACE_RESOLUTION.SURFACE_UNKNOWN:
      return {
        ...base,
        interpretation: INTERPRETATION.UNRESOLVABLE,
        reason: `"${query.venue}" holds no surface named "${query.field}"`,
      };
    case PRACTICE_SURFACE_RESOLUTION.SUBUNIT_UNKNOWN:
      return {
        ...base,
        interpretation: INTERPRETATION.UNRESOLVABLE,
        reason: `"${query.venue} / ${query.field}" holds no sub-unit named "${query.subunit}"`,
      };
    default:
      // Named rather than dropped, for the reason `aliases.js` and `closures.js`
      // both throw here: a status with no arm would be a row carried with no
      // word said about how it resolved.
      throw new Error(
        `fieldAdmin ground: resolution status "${resolved.status}" has no arm; add one beside its neighbours in PRACTICE_SURFACE_RESOLUTION (${RESOLUTION_VALUES.join(', ')})`
      );
  }
}

/**
 * Build a projected row.
 *
 * A single constructor so `raw` cannot be forgotten on one path and present on
 * four. `PHASE_8_PLAN.md` §8.4 calls the raw-beside-the-interpretation property
 * "the single most important property for troubleshooting a bad import later",
 * and a field that is optional at the constructor is a field that goes missing.
 *
 * @param {Object} input
 * @param {string} input.sourceFile
 * @param {number} input.rowIndex
 * @param {string} input.subjectKey
 * @param {string} input.interpretation
 * @param {string|null} input.interpretationReason
 * @param {Record<string, unknown>} input.raw
 * @param {Record<string, unknown>|null} input.record
 * @returns {import('../types.js').ProjectedRow}
 */
export function projectedRow(input) {
  if (input.raw === null || input.raw === undefined) {
    throw new Error(
      `fieldAdmin: ${input.sourceFile} row ${input.rowIndex} was projected without its raw cells; the raw is the point`
    );
  }
  if (input.interpretation === INTERPRETATION.UNRESOLVABLE && input.record !== null) {
    throw new Error(
      `fieldAdmin: ${input.sourceFile} row ${input.rowIndex} is unresolvable and carries a record; one of the two is wrong`
    );
  }
  if (input.interpretation !== INTERPRETATION.UNRESOLVABLE && input.record === null) {
    throw new Error(
      `fieldAdmin: ${input.sourceFile} row ${input.rowIndex} is ${input.interpretation} and carries no record; one of the two is wrong`
    );
  }
  return {
    sourceFile: input.sourceFile,
    rowIndex: input.rowIndex,
    subjectKey: input.subjectKey,
    interpretation: input.interpretation,
    interpretationReason: input.interpretationReason,
    raw: input.raw,
    record: input.record,
  };
}
