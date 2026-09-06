/**
 * **The constraint log into blackout windows.**
 *
 * `field_constraints.csv` is the club's second source of ground truth about
 * when a site is usable: 13 rows of blackouts, closures, a parking notice and
 * one adjacency rule, each with date bounds, time bounds, a venue, a `fields`
 * cell and a reason.
 *
 * ## This does not re-read the sheet
 *
 * Phase 8.3 already built `availability/closures.js` and its season-2026
 * adapter, which read the `fields` cell into **seven** scope kinds and resolve
 * each against the facility graph. Re-reading the cell here would be a second
 * producer of the same verdict, and the two would drift on exactly the row that
 * matters. So this projector calls `buildSeason2026ClosureSet()` and maps its
 * closures into the domain model.
 *
 * ## The Excel-corrupted row, which is the one to watch
 *
 * The Gardening Day row's `fields` cell reads `2026-01-07`. The author typed
 * `1-7`, meaning fields 1 through 7, and Excel made it a date.
 * `PHASE_8_PLAN.md` §8.4 mentions Excel corruption only in
 * `field_weekly_availability.csv`; **this is a sixteenth instance, in the file
 * 8.4 turns into blackouts**, and it is the one with teeth because a blackout
 * that closes the wrong ground closes it for real.
 *
 * `closures.js` already reads that cell as `CLOSURE_SCOPE.UNREADABLE` and
 * applies the closure **venue-wide as a compromise** - never as nothing. This
 * projector carries that reading through as `doubtful` with the raw cell
 * attached, so an operator sees `2026-01-07` beside "read as the whole venue"
 * and can overrule it.
 *
 * ## Scopes that are not ground
 *
 * `Parking` is not a playing surface and `Adjacent Fields` is a rule the graph
 * already carries as overlap pairs. Neither becomes a blackout: encoding the
 * adjacency here would evaluate it twice, and closing a car park would close
 * nothing. Both are reported `unresolvable` with that reason, so the rows stay
 * visible rather than being filtered out of the count.
 *
 * @module fieldAdmin/projectors/constraints
 */

import { CLOSURE_SCOPE, buildClosureSet } from '../../availability/closures.js';
import { toSeason2026ClosureInput } from '../../availability/adapters/season2026Closures.js';
import {
  BLACKOUT_REASON,
  BLACKOUT_SCOPE,
  BlackoutWindowSchema,
  RECORD_SOURCE,
} from '../schemas.js';
import { INTERPRETATION } from '../reasonCodes.js';
import { projectedRow } from './ground.js';

const SOURCE_FILE = 'field_constraints.csv';

/**
 * Every closure scope, read back out of the enum so a kind added without an arm
 * below fails rather than being dropped by a `default:`.
 */
const CLOSURE_SCOPE_VALUES = Object.freeze(Object.values(CLOSURE_SCOPE));

/**
 * The sheet's `reason` prose to a {@link BLACKOUT_REASON} value.
 *
 * **An explicit table, with no fallback rule.** A derivation such as "contains
 * the word closure" would silently mislabel a reason nobody anticipated, and a
 * mislabelled blackout is one an operator cannot find later. A reason not
 * listed here becomes `OTHER`, which is an answer rather than a guess, and the
 * sheet's own words are kept verbatim in the raw regardless.
 *
 * A `Map` rather than an object literal: these keys are CSV cells, and
 * `constructor` must not resolve to a reason.
 */
export const CONSTRAINT_REASON_READINGS = new Map([
  ['Offline', BLACKOUT_REASON.CLOSURE],
  ['School Event', BLACKOUT_REASON.SCHOOL_EVENT],
  ['Gardening Day', BLACKOUT_REASON.MAINTENANCE],
  ['Reseeding, Indefinite Closure', BLACKOUT_REASON.RESEEDING],
  ['Adaptive Sports Org Flag Football', BLACKOUT_REASON.THIRD_PARTY_BOOKING],
  ['Spacing', BLACKOUT_REASON.ADJACENCY],
]);

/**
 * Read one `reason` cell.
 *
 * @param {string} reason - as the sheet writes it
 * @returns {string} a {@link BLACKOUT_REASON} value
 */
export function readConstraintReason(reason) {
  return CONSTRAINT_REASON_READINGS.get(reason) ?? BLACKOUT_REASON.OTHER;
}

/**
 * How one closure scope becomes a blackout, or why it does not.
 *
 * Returned rather than branched inline so the whole mapping is readable in one
 * place and every kind is visibly accounted for.
 *
 * @param {Object} closure - a `ClosureWindow` from `buildClosureSet()`
 * @returns {{ scope: string|null, venueIds: string[], surfaceIds: string[], interpretation: string, reason: string|null }}
 */
export function readClosureScope(closure) {
  const kind = closure.scope.kind;
  switch (kind) {
    case CLOSURE_SCOPE.VENUE:
      return {
        scope: BLACKOUT_SCOPE.VENUE,
        venueIds: [...closure.scope.venueIds],
        surfaceIds: [],
        interpretation: INTERPRETATION.INTERPRETED,
        reason: null,
      };
    case CLOSURE_SCOPE.SURFACE:
      return {
        scope: BLACKOUT_SCOPE.SURFACE,
        venueIds: [],
        surfaceIds: [...closure.scope.surfaceIds],
        interpretation: INTERPRETATION.INTERPRETED,
        reason: null,
      };
    case CLOSURE_SCOPE.UNREADABLE:
      // The Gardening Day row. Venue-wide as a compromise, exactly as
      // `closures.js` decides it - never as nothing, and never guessed back
      // into `1-7`.
      return {
        scope: BLACKOUT_SCOPE.VENUE,
        venueIds: [...closure.scope.venueIds],
        surfaceIds: [],
        interpretation: INTERPRETATION.DOUBTFUL,
        reason: `the fields cell reads ${JSON.stringify(closure.fieldsRaw)}, which Excel made of a field range; the closure is read as the whole venue as a compromise and the raw cell is kept so it can be overruled`,
      };
    case CLOSURE_SCOPE.SURFACE_UNKNOWN:
      return {
        scope: BLACKOUT_SCOPE.VENUE,
        venueIds: [...closure.scope.venueIds],
        surfaceIds: [],
        interpretation: INTERPRETATION.DOUBTFUL,
        reason: `the row names surface ${JSON.stringify(closure.scope.surfaceName)} at ${closure.venueName}, which the graph does not hold there; the closure is read as the whole venue as a compromise`,
      };
    case CLOSURE_SCOPE.NOT_GROUND:
      return {
        scope: null,
        venueIds: [],
        surfaceIds: [],
        interpretation: INTERPRETATION.UNRESOLVABLE,
        reason: `the fields cell reads ${JSON.stringify(closure.fieldsRaw)}, which is not a playing surface; the row is information and closes no ground`,
      };
    case CLOSURE_SCOPE.ADJACENCY:
      return {
        scope: null,
        venueIds: [],
        surfaceIds: [],
        interpretation: INTERPRETATION.UNRESOLVABLE,
        reason:
          'the row is the adjacency rule, which the facility graph already carries as overlap pairs; encoding it as a blackout would evaluate one rule twice',
      };
    case CLOSURE_SCOPE.VENUE_UNKNOWN:
      return {
        scope: null,
        venueIds: [],
        surfaceIds: [],
        interpretation: INTERPRETATION.UNRESOLVABLE,
        reason: `the row names venue ${JSON.stringify(closure.scope.venueName)}, which the graph does not hold, so there is no ground to close`,
      };
    default:
      throw new Error(
        `fieldAdmin constraints: closure scope "${kind}" has no arm; add one beside its neighbours in CLOSURE_SCOPE (${CLOSURE_SCOPE_VALUES.join(', ')})`
      );
  }
}

/**
 * Project the constraint log into blackout windows.
 *
 * @param {ReadonlyArray<Object>} fieldConstraints - `practice.fieldConstraints` from the loader
 * @param {import('../../facility/types.js').FacilityGraph} graph
 * @param {import('../../facility/types.js').VenueComplexMap} complexMap
 * @returns {{ rows: import('../types.js').ProjectedRow[], closureSet: Object }}
 */
export function projectFieldConstraints(fieldConstraints, graph, complexMap) {
  const closureSet = buildClosureSet(
    graph,
    toSeason2026ClosureInput(fieldConstraints, graph, complexMap)
  );

  // Enumerated from the **parsed constraint rows**, not from the closures the
  // adapter produced. Deriving the universe from the adapter's output would let
  // a row the adapter silently dropped go unnoticed - which is the "never
  // derive a check's subject set from the data a break would corrupt" rule
  // applied to a producer rather than to a test.
  if (closureSet.closures.length !== fieldConstraints.length) {
    throw new Error(
      `fieldAdmin constraints: the closure adapter returned ${closureSet.closures.length} closure(s) for ${fieldConstraints.length} constraint row(s); every row must reach a closure, even an unresolvable one`
    );
  }

  const rows = fieldConstraints.map((constraint, index) => {
    const closure = closureSet.closures[index];
    const scope = readClosureScope(closure);
    const raw = /** @type {Record<string, unknown>} */ (
      /** @type {Object} */ (constraint).raw ?? {}
    );
    const rowIndex = /** @type {number} */ (/** @type {Object} */ (constraint).rowIndex);
    const subjectKey = `${closure.venueName ?? 'unknown'} ${closure.fromDate} ${closure.toDate} ${closure.fieldsRaw ?? ''}`;

    if (scope.interpretation === INTERPRETATION.UNRESOLVABLE) {
      return projectedRow({
        sourceFile: SOURCE_FILE,
        rowIndex,
        subjectKey,
        interpretation: INTERPRETATION.UNRESOLVABLE,
        interpretationReason: scope.reason,
        raw,
        record: null,
      });
    }

    const record = BlackoutWindowSchema.parse({
      id: `${SOURCE_FILE}#${rowIndex}`,
      scope: scope.scope,
      venueIds: scope.venueIds,
      surfaceIds: scope.surfaceIds,
      fromDate: closure.fromDate,
      toDate: closure.toDate,
      // An all-day closure carries no times: `closures.js` is the single
      // producer of "this window is the whole day", and reading its `allDay`
      // rather than re-deriving it from the minutes keeps one answer.
      startMinutes: closure.allDay ? null : closure.startMinutes,
      endMinutes: closure.allDay ? null : closure.endMinutes,
      reason: readConstraintReason(closure.reason),
      // **No note.** The sheet's prose reason is carried in `raw` and mapped to
      // an enum; copying it into a free-text field would make the corpus's own
      // words a permanent PII surface for no gain.
      note: null,
      source: RECORD_SOURCE.CONSTRAINT_SHEET,
    });

    return projectedRow({
      sourceFile: SOURCE_FILE,
      rowIndex,
      subjectKey,
      interpretation: scope.interpretation,
      interpretationReason: scope.reason,
      raw,
      record,
    });
  });

  return { rows, closureSet };
}
