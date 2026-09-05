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
 * `venue-unknown` closure and a build-time finding, never a dropped row.
 *
 * @module availability/adapters/season2026Closures
 */

import { season2026SurfaceId } from '../../facility/adapters/season2026Geometry.js';
import { resolvePracticeVenue } from '../../facility/practiceSurfaces.js';
import { CLOSURE_SCOPE, buildClosureSet, isAllDayWindow } from '../closures.js';

/** An ISO date, which is what Excel leaves where a field range was typed. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * What each `fields` cell of `field_constraints.csv` means, declared.
 *
 * `kind` is a {@link CLOSURE_SCOPE} value; `surface` names the surface a
 * `surface`-kind reading closes, as the game corpus spells it, and is
 * resolved through `season2026SurfaceId()` with the row's venue. The source
 * column says where the reading comes from; `4` is Pitch 4 because the game
 * corpus names Alder's pitches `Pitch 1`..`Pitch 4` and the row's venue is
 * Alder Park.
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
  if (ISO_DATE_RE.test(fields)) {
    return {
      kind: CLOSURE_SCOPE.UNREADABLE,
      source: 'field_constraints.csv: the cell is an ISO date; Excel corrupted a field range',
    };
  }
  const reading = Object.prototype.hasOwnProperty.call(
    SEASON_2026_CONSTRAINT_FIELDS_READINGS,
    fields
  )
    ? SEASON_2026_CONSTRAINT_FIELDS_READINGS[fields]
    : null;
  if (!reading) {
    throw new Error(
      `season2026 closures adapter: no declared reading for fields cell ${JSON.stringify(fields)}`
    );
  }
  return reading;
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
      if (venueIds.length !== 1) {
        throw new Error(
          `season2026 closures adapter: row ${row.rowIndex} closes "${row.fields}" at "${row.venue}", which is ${venueIds.length} venues; a surface reading needs exactly one`
        );
      }
      scope = {
        kind: CLOSURE_SCOPE.SURFACE,
        surfaceId: season2026SurfaceId(row.venue, /** @type {string} */ (reading.surface)),
      };
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
