/**
 * **The weekly availability sheet into recurring windows.**
 *
 * `field_weekly_availability.csv` states, per venue and weekday, when ground is
 * usable: 42 rows across 8 venues.
 *
 * ## The Excel corruption, measured rather than quoted
 *
 * `PHASE_8_PLAN.md` §8.4 says "a working sheet's own availability cells were
 * corrupted by Excel into dates", and the corpus README quotes one example.
 * The measured figure is **15 rows across three venues**: Orchard Park Monday
 * to Friday (`raw_value = 2026-04-07`, where the author typed `4-7`), and
 * Maplewood and Larkfield Green Monday to Friday (`2026-03-08`, for `3-8`).
 *
 * All 15 carry `interpretation = excel-date-corruption` from the 8.0 parser,
 * with `raw_value` retained beside `interpreted_window`. This projector carries
 * **both** through: the window is used, the row is marked `doubtful`, and the
 * raw cell travels with it. An operator sees `2026-04-07` beside `16:00-19:00`
 * and can overrule the reading - which is the entire reason the corpus keeps
 * the raw.
 *
 * A related figure worth recording because it is the shape of a vacuous check:
 * the 8.0 prompt names `interpretation = "unparsed"` as a class to report, and
 * **zero rows carry it**. The four values the file actually writes are
 * `excel-date-corruption` (15), `competitive-programme` (7), `unavailable` (7)
 * and empty (13). A class with no members that nothing announces is
 * indistinguishable from a class nobody checked, so {@link WEEKLY_INTERPRETATIONS}
 * declares all four and `tests/fieldAdminSeason2026Import.test.js` holds the
 * declaration to the data in both directions.
 *
 * @module fieldAdmin/projectors/weeklyAvailability
 */

import { RECORD_SOURCE, RecurringWindowSchema } from '../schemas.js';
import { INTERPRETATION } from '../reasonCodes.js';
import { projectedRow, resolveGround } from './ground.js';

const SOURCE_FILE = 'field_weekly_availability.csv';

/**
 * Every `interpretation` the sheet writes, and how to read each.
 *
 * Declared rather than inferred from the data, and enforced in **both**
 * directions by the test: a value here that matches no row fails, and a row
 * whose value is not here fails. That is what stops a class going quietly
 * empty, and what would have caught `unparsed` being named by a plan and
 * carried by nothing.
 *
 * A `Map`, because these keys come from a CSV cell.
 */
export const WEEKLY_INTERPRETATIONS = new Map([
  [
    '',
    {
      available: true,
      interpretation: INTERPRETATION.INTERPRETED,
      reason: null,
      expectsWindow: true,
    },
  ],
  [
    'excel-date-corruption',
    {
      available: true,
      interpretation: INTERPRETATION.DOUBTFUL,
      reason:
        'Excel turned a field or hour range into a date; the interpreted window is a reading of the raw cell, which is kept beside it so it can be overruled',
      expectsWindow: true,
    },
  ],
  [
    'unavailable',
    {
      available: false,
      interpretation: INTERPRETATION.INTERPRETED,
      reason: null,
      expectsWindow: false,
    },
  ],
  [
    'competitive-programme',
    {
      available: false,
      interpretation: INTERPRETATION.DOUBTFUL,
      reason:
        'the cell reads "comp", meaning the competitive programme holds the ground; the sheet states no hours, so no window is claimed',
      expectsWindow: false,
    },
  ],
]);

/** Every declared interpretation value, sorted, for a message and a test. */
export const WEEKLY_INTERPRETATION_VALUES = Object.freeze(
  [...WEEKLY_INTERPRETATIONS.keys()].sort()
);

/** `weekdayCodeOfDayName()` gives these; ISO numbers Monday 1 .. Sunday 7. */
const ISO_WEEKDAY_BY_CODE = new Map([
  ['MON', 1],
  ['TUE', 2],
  ['WED', 3],
  ['THU', 4],
  ['FRI', 5],
  ['SAT', 6],
  ['SUN', 7],
]);

/**
 * Project the weekly availability sheet into recurring windows.
 *
 * @param {ReadonlyArray<Object>} weeklyAvailability - `practice.weeklyAvailability` from the loader
 * @param {import('../../facility/types.js').FacilityGraph} graph
 * @param {import('../../facility/types.js').VenueComplexMap} complexMap
 * @returns {import('../types.js').ProjectedRow[]}
 */
export function projectWeeklyAvailability(weeklyAvailability, graph, complexMap) {
  return weeklyAvailability.map((row) => {
    const record = /** @type {Object} */ (row);
    const raw = /** @type {Record<string, unknown>} */ (record.raw ?? {});
    const rowIndex = /** @type {number} */ (record.rowIndex);
    const venue = /** @type {string} */ (record.venue);
    const subjectKey = `${venue} ${record.day}`;

    const reading = WEEKLY_INTERPRETATIONS.get(record.interpretation ?? '');
    if (!reading) {
      throw new Error(
        `fieldAdmin weekly availability: row ${rowIndex} carries interpretation ${JSON.stringify(record.interpretation)}, which is not declared; add it beside its neighbours in WEEKLY_INTERPRETATIONS (${WEEKLY_INTERPRETATION_VALUES.map((value) => JSON.stringify(value)).join(', ')})`
      );
    }

    const isoWeekday = ISO_WEEKDAY_BY_CODE.get(/** @type {string} */ (record.weekday));
    if (isoWeekday === undefined) {
      // Unplaceable in time rather than in space, and surfaced with its reason
      // rather than dropped.
      return projectedRow({
        sourceFile: SOURCE_FILE,
        rowIndex,
        subjectKey,
        interpretation: INTERPRETATION.UNRESOLVABLE,
        interpretationReason: `the day cell reads ${JSON.stringify(record.day)}, which names no weekday`,
        raw,
        record: null,
      });
    }

    const ground = resolveGround(graph, complexMap, { venue, field: null, subunit: null });
    if (ground.interpretation === INTERPRETATION.UNRESOLVABLE) {
      return projectedRow({
        sourceFile: SOURCE_FILE,
        rowIndex,
        subjectKey,
        interpretation: INTERPRETATION.UNRESOLVABLE,
        interpretationReason: ground.reason,
        raw,
        record: null,
      });
    }

    // A window the reading does not expect, or a missing one it does, is the
    // sheet disagreeing with itself. Reported rather than patched over: the
    // parser gives `startMinutes`/`endMinutes` from `interpreted_window`, and
    // an `unavailable` row carrying hours would mean one of the two cells is
    // wrong and a human has to say which.
    const hasWindow = record.startMinutes !== null && record.endMinutes !== null;
    if (hasWindow !== reading.expectsWindow) {
      return projectedRow({
        sourceFile: SOURCE_FILE,
        rowIndex,
        subjectKey,
        interpretation: INTERPRETATION.UNRESOLVABLE,
        interpretationReason: `the row reads ${JSON.stringify(record.interpretation ?? '')}, which ${reading.expectsWindow ? 'states hours' : 'states no hours'}, but the interpreted window ${hasWindow ? 'carries them' : 'is empty'}; the two cells disagree`,
        raw,
        record: null,
      });
    }

    const doubtful =
      reading.interpretation === INTERPRETATION.DOUBTFUL ||
      ground.interpretation === INTERPRETATION.DOUBTFUL;

    const window = RecurringWindowSchema.parse({
      id: `${SOURCE_FILE}#${rowIndex}`,
      venueIds: ground.venueIds,
      isoWeekday,
      startMinutes: reading.expectsWindow ? record.startMinutes : null,
      endMinutes: reading.expectsWindow ? record.endMinutes : null,
      available: reading.available,
      source: RECORD_SOURCE.WEEKLY_AVAILABILITY_SHEET,
    });

    return projectedRow({
      sourceFile: SOURCE_FILE,
      rowIndex,
      subjectKey,
      interpretation: doubtful ? INTERPRETATION.DOUBTFUL : INTERPRETATION.INTERPRETED,
      interpretationReason: doubtful ? (reading.reason ?? ground.reason) : null,
      raw,
      record: window,
    });
  });
}
