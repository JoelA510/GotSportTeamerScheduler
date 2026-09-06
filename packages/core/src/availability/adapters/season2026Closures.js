/**
 * Adapter from the season-2026 practice corpus's `field_constraints.csv`
 * records to closure windows.
 *
 * **Direction of the arrow: fixtures -> availability.** Takes the records
 * `parseFieldConstraints()` already produced and reads nothing from disk.
 *
 * The one interpretation this module makes is of the `fields` cell, and it
 * makes it from a **declared table**, {@link SEASON_2026_CONSTRAINT_FIELDS_READINGS},
 * keyed on the cell as written. A cell the table does not know throws: the
 * corpus is a fixture with thirteen rows, and a fourteenth vocabulary is
 * something an operator should see, not something a default should absorb.
 * The Excel-corrupted `2026-01-07` is deliberately **not** read as `1-7`:
 * the loader reports the corruption (`CONSTRAINT_FIELDS_EXCEL_DATE_CORRUPTION`)
 * and this adapter carries the row as `unreadable`, which the closure check
 * reports against every booking in its window rather than guessing which
 * seven fields the author meant.
 *
 * The venue is resolved by graph structure, through `resolvePracticeVenue()`:
 * `Maplewood` reaches the declared complex, so a Maplewood closure shuts both
 * `Maplewood Back` and `Maplewood Front`. A venue nothing holds becomes a
 * `venue-unknown` closure and a build-time finding, and `checkClosures()`
 * reports it again against every booking whose date and hours fall inside it —
 * never a dropped row and never a silent one.
 *
 * @module availability/adapters/season2026Closures
 */

import {
  PRACTICE_SURFACE_RESOLUTION,
  resolvePracticeSurface,
  resolvePracticeVenue,
} from '../../facility/practiceSurfaces.js';
import { CLOSURE_SCOPE, buildClosureSet, isAllDayWindow } from '../closures.js';
import { ISO_DATE_PATTERN } from '../schemas.js';

/**
 * What each `fields` cell of `field_constraints.csv` means, declared.
 *
 * `kind` is a {@link CLOSURE_SCOPE} value; `surface` names the surface a
 * `surface`-kind reading closes, as the game corpus spells it, and is
 * resolved at the row's venue by graph structure (`resolvePracticeSurface()`),
 * exactly as every other name-to-ground path in this package: a venue that
 * has no such surface yields a `surface-unknown` closure and a build-time
 * finding, never a thrown id, and the closure then applies to that venue as a
 * compromise rather than to nothing. The source column says where the reading comes
 * from; `4` is Pitch 4 because the game corpus names Alder's pitches
 * `Pitch 1`..`Pitch 4` and the row's venue is Alder Park.
 *
 * @type {Readonly<Record<string, Readonly<{ kind: string, surface?: string, source: string }>>>}
 */
export const SEASON_2026_CONSTRAINT_FIELDS_READINGS = Object.freeze({
  All: Object.freeze({
    kind: CLOSURE_SCOPE.VENUE,
    source: 'field_constraints.csv: "All" closes every field of the venue',
  }),
  4: Object.freeze({
    kind: CLOSURE_SCOPE.SURFACE,
    surface: 'Pitch 4',
    source:
      'field_constraints.csv Alder Park rows; facility_geometry.json names the pitch "Pitch 4"',
  }),
  Parking: Object.freeze({
    kind: CLOSURE_SCOPE.NOT_GROUND,
    source: 'field_constraints.csv: the car park is not a playing surface',
  }),
  'Adjacent Fields': Object.freeze({
    kind: CLOSURE_SCOPE.ADJACENCY,
    source:
      'field_constraints.csv "Spacing" row; the pairs live in facility_geometry.json overlap_pairs and nowhere else',
  }),
});

/**
 * Read one `fields` cell.
 *
 * @param {string} fields - the cell as written
 * @returns {{ kind: string, surface?: string, source: string }}
 */
export function readSeason2026ConstraintFields(fields) {
  const reading = readSeason2026ConstraintFieldsOrNull(fields);
  if (reading === null) {
    throw new Error(
      `season2026 closures adapter: no declared reading for fields cell ${JSON.stringify(fields)}`
    );
  }
  return reading;
}

/**
 * The same reading, answering `null` where {@link readSeason2026ConstraintFields}
 * throws.
 *
 * **One producer, two callers that fail differently, because they are not in
 * the same position.** The closure layer is handed a curated list and a cell it
 * cannot read there is a producer bug, so it keeps the throw. The field-admin
 * projector is handed the corpus, where an undeclared cell is *data*: the third
 * member of a family whose first two members already knew this. `permits.js`
 * carries an undeclared `venue | facility` pair as an unresolvable row and
 * `weeklyAvailability.js` does the same for an undeclared interpretation --
 * this one went on throwing, and one unrecognised `fields` cell lost **all
 * five** change sets, measured.
 *
 * It is not the *sibling* of either of those, which is why a sweep looking for
 * twins walked past it: it is a third site doing the same job, in a different
 * package, reached through two calls. The question that finds it is "what is
 * the complete set of places that read a source cell through a declared
 * table", not "what is this one's twin".
 *
 * @param {string} fields - the cell as written
 * @returns {{ kind: string, surface?: string, source: string }|null}
 */
export function readSeason2026ConstraintFieldsOrNull(fields) {
  // The same pattern the corpus parser reports the cell under
  // (CONSTRAINT_FIELDS_EXCEL_DATE_CORRUPTION), so the two verdicts fall on
  // the same cell by construction.
  if (ISO_DATE_PATTERN.test(fields)) {
    return {
      kind: CLOSURE_SCOPE.UNREADABLE,
      source: 'field_constraints.csv: the cell is an ISO date; Excel corrupted a field range',
    };
  }
  return Object.prototype.hasOwnProperty.call(SEASON_2026_CONSTRAINT_FIELDS_READINGS, fields)
    ? SEASON_2026_CONSTRAINT_FIELDS_READINGS[fields]
    : null;
}

/**
 * Translate parsed constraint records into `buildClosureSet()` input.
 *
 * @param {ReadonlyArray<{ id: string, rowIndex: number, dateStart: string, dateEnd: string, startMinutes: number, endMinutes: number, venue: string, fields: string, reason: string, sourceKind: string|null }>} fieldConstraints
 *   - `practice.fieldConstraints` from the corpus loader
 * @param {import('../../facility/types.js').FacilityGraph} graph
 * @param {import('../../facility/types.js').VenueComplexMap} complexMap
 * @returns {{ closures: Array<Object>, source: string }}
 */
export function toSeason2026ClosureInput(fieldConstraints, graph, complexMap) {
  const closures = fieldConstraints.map((row) => {
    const reading = readSeason2026ConstraintFields(row.fields);
    const { venueIds } = resolvePracticeVenue(graph, complexMap, row.venue);
    /** @type {Object} */
    let scope;
    if (venueIds.length === 0) {
      scope = { kind: CLOSURE_SCOPE.VENUE_UNKNOWN, venueName: row.venue };
    } else if (reading.kind === CLOSURE_SCOPE.SURFACE) {
      const surfaceName = /** @type {string} */ (reading.surface);
      const resolved = resolvePracticeSurface(graph, complexMap, {
        venue: row.venue,
        field: surfaceName,
      });
      scope =
        resolved.status === PRACTICE_SURFACE_RESOLUTION.RESOLVED ||
        resolved.status === PRACTICE_SURFACE_RESOLUTION.AMBIGUOUS
          ? { kind: CLOSURE_SCOPE.SURFACE, surfaceIds: resolved.surfaceIds }
          : { kind: CLOSURE_SCOPE.SURFACE_UNKNOWN, venueIds, surfaceName };
    } else {
      scope = { kind: reading.kind, venueIds };
    }
    return {
      id: row.id,
      fromDate: row.dateStart,
      toDate: row.dateEnd,
      startMinutes: row.startMinutes,
      endMinutes: row.endMinutes,
      allDay: isAllDayWindow(row.startMinutes, row.endMinutes),
      scope,
      reason: row.reason,
      fieldsRaw: row.fields,
      venueName: row.venue,
      source: `field_constraints.csv#${row.rowIndex}${row.sourceKind ? ` (${row.sourceKind})` : ''}`,
    };
  });
  return { closures, source: 'fixtures/season-2026/practice/field_constraints.csv' };
}

/**
 * Build the season-2026 closure set.
 *
 * @param {ReadonlyArray<Object>} fieldConstraints
 * @param {import('../../facility/types.js').FacilityGraph} graph
 * @param {import('../../facility/types.js').VenueComplexMap} complexMap
 * @returns {import('../types.js').ClosureSet}
 */
export function buildSeason2026ClosureSet(fieldConstraints, graph, complexMap) {
  return buildClosureSet(graph, toSeason2026ClosureInput(fieldConstraints, graph, complexMap));
}
