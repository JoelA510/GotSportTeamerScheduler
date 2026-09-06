/**
 * **The permits and their reservations into availability windows.**
 *
 * 767 reserved windows across four permits, 2026-08-10 to 2026-12-20 - the
 * first per-date, per-field permit data in the repo.
 *
 * ## The third naming vocabulary, which the plan does not mention
 *
 * `PHASE_8_PLAN.md` §8.4 treats the permits as one more source to parse. They
 * are also a **third way of naming ground**, unrelated to either decoder ring
 * and to the practice grid. The `facility` column holds eight distinct labels:
 *
 * ```text
 * Field - Soccer 1A/1B (Field)      Field - Football (B) (Field)
 * Field - Soccer 2A/2B (Field)      Field - Football Stadium (Field)
 * Field - Soccer 3A/3B (Field)      Field - Practice 2 (A) (Field)
 * Field - Soccer 4A/4B (Field)      Lower Field - Practice 3 (Field)
 * ```
 *
 * Two properties neither ring has. First, the `Field - ` prefix and the
 * ` (Field)` suffix are the permit system's furniture, not the club's names.
 * Second - and this is the one that bites - **`Field - Soccer 1A/1B` names two
 * surfaces in a single cell**. A reading that resolved it to one surface would
 * silently halve the reserved ground, and one that resolved it to the parent
 * pitch would reserve ground the permit does not grant.
 *
 * So each label is read into a **set** of surface names, resolved
 * independently, and `facilityLabel` keeps the permit's own spelling verbatim
 * on every record. A permit is a legal document; the label on it is the club's
 * evidence and is never normalised away.
 *
 * ## What resolves, measured
 *
 * Of the 767 reservations, **544 reach ground and 223 do not**: the 505 Alder
 * soccer rows and the 39 Summit HS stadium rows resolve; the 72 Brookside
 * `Field - Football (B)` rows and the 151 Maplewood `Practice 2 (A)` /
 * `Lower Field - Practice 3` rows name ground in the permit system's own
 * numbering that no source ties to the club's. Those 223 are reported
 * `unresolvable` with the label quoted - **never guessed into the nearest
 * plausible surface**, because for a reserved window a resemblance would invent
 * a grant the permit does not make.
 *
 * @module fieldAdmin/projectors/permits
 */

import { PermitWindowSchema, RECORD_SOURCE } from '../schemas.js';
import { INTERPRETATION } from '../reasonCodes.js';
import { projectedRow, resolveGround } from './ground.js';

const SOURCE_FILE = 'permit_reservations.csv';

/**
 * How each permit facility label names ground, declared row by row.
 *
 * **Keyed on `venue | facility`, not on the label alone.** A permit system's
 * label is only meaningful inside the site that issued it: `Field - Football
 * (B)` at Brookside Park and a `Field - Football (B)` at some future venue
 * would name different ground, and a label-only key would silently resolve the
 * second through the first's reading. Keying on the pair makes a new pair fail
 * loudly instead.
 *
 * **A declaration, not a parser.** A rule such as "strip `Field - `, split on
 * `/`" appears to work on the four Alder rows and then invents ground for
 * `Field - Football Stadium`. Each pair was read by hand against the graph.
 *
 * `surfaces` names the graph's surfaces at that venue, by their own names. The
 * Alder halves are `Pitch 1A` and `Pitch 1B` - **not** `Pitch 1` with a
 * sub-unit `A`, which is how the practice sheets spell the same ground and how
 * the Maplewood and Orchard splits really are shaped. Getting that wrong
 * resolves nothing at all, which is what the first draft of this table did.
 *
 * An empty `surfaces` means the pair names ground the graph does not hold. That
 * is an answer, and the row is reported unresolvable with the label quoted -
 * never guessed into the nearest plausible surface, which for a reserved window
 * would invent a grant the permit does not make.
 */
export const PERMIT_FACILITY_READINGS = new Map([
  [
    'Alder Park | Field - Soccer 1A/1B (Field)',
    { surfaces: ['Pitch 1A', 'Pitch 1B'], note: 'the permit reserves both halves in one cell' },
  ],
  [
    'Alder Park | Field - Soccer 2A/2B (Field)',
    { surfaces: ['Pitch 2A', 'Pitch 2B'], note: 'the permit reserves both halves in one cell' },
  ],
  [
    'Alder Park | Field - Soccer 3A/3B (Field)',
    { surfaces: ['Pitch 3A', 'Pitch 3B'], note: 'the permit reserves both halves in one cell' },
  ],
  [
    'Alder Park | Field - Soccer 4A/4B (Field)',
    { surfaces: ['Pitch 4A', 'Pitch 4B'], note: 'the permit reserves both halves in one cell' },
  ],
  [
    'Summit HS | Field - Football Stadium (Field)',
    {
      surfaces: ['Stadium'],
      note: 'Summit HS holds exactly one surface in the graph and the permit is issued for soccer practice and games there, so the label names it rather than resolving by resemblance',
    },
  ],
  [
    'Brookside Park | Field - Football (B) (Field)',
    {
      surfaces: [],
      note: 'the permit names a football field with a "(B)" qualifier; Brookside holds Lower, Lower A, Lower B, Upper 1 and Upper 2, and no source says which of them the permit means. Reading "(B)" as "Lower B" would be a resemblance, not a fact',
    },
  ],
  [
    'Maplewood | Field - Practice 2 (A) (Field)',
    {
      surfaces: [],
      note: 'the permit numbers its own practice fields; nothing states that the permit\'s "Practice 2" is the club\'s "Field 2", and Maplewood is a complex of two venues, so the label reaches no ground the graph holds',
    },
  ],
  [
    'Maplewood | Lower Field - Practice 3 (Field)',
    {
      surfaces: [],
      note: 'Maplewood holds no surface called Lower, and the permit\'s "Practice 3" numbering is its own; the label reaches no ground the graph holds',
    },
  ],
]);

/** Every declared `venue | facility` pair, sorted, for a message and a test. */
export const PERMIT_FACILITY_LABELS = Object.freeze([...PERMIT_FACILITY_READINGS.keys()].sort());

/**
 * The key one reservation row looks up.
 *
 * @param {string} venue
 * @param {string} facility
 * @returns {string}
 */
export function permitFacilityKey(venue, facility) {
  return `${venue} | ${facility}`;
}

/**
 * Read one `(venue, facility)` pair.
 *
 * @param {string} venue - as the permit writes it
 * @param {string} facility - as the permit writes it
 * @returns {{ surfaces: string[], note: string }}
 */
export function readPermitFacility(venue, facility) {
  const key = permitFacilityKey(venue, facility);
  const reading = PERMIT_FACILITY_READINGS.get(key);
  if (!reading) {
    throw new Error(
      `fieldAdmin permits: no declared reading for ${JSON.stringify(key)}; add one beside its neighbours in PERMIT_FACILITY_READINGS (${PERMIT_FACILITY_LABELS.length} declared)`
    );
  }
  return { surfaces: [...reading.surfaces], note: reading.note };
}

/**
 * Split a `services` cell into its named services.
 *
 * `Field Lights` on a Summit HS reservation is the per-reservation lighting
 * evidence the corpus README calls out against GAP-05, so the services are kept
 * as data rather than collapsed into a boolean.
 *
 * @param {string|null} services
 * @returns {string[]}
 */
export function readPermitServices(services) {
  if (services === null || services === undefined) return [];
  return String(services)
    .split(',')
    .map((service) => service.trim())
    .filter((service) => service.length > 0);
}

/**
 * Project permit reservations into permit windows.
 *
 * @param {ReadonlyArray<Object>} reservations - `practice.permitReservations` from the loader
 * @param {import('../../facility/types.js').FacilityGraph} graph
 * @param {import('../../facility/types.js').VenueComplexMap} complexMap
 * @returns {import('../types.js').ProjectedRow[]}
 */
export function projectPermitReservations(reservations, graph, complexMap) {
  return reservations.map((row) => {
    const record = /** @type {Object} */ (row);
    const raw = /** @type {Record<string, unknown>} */ (record.raw ?? {});
    const rowIndex = /** @type {number} */ (record.rowIndex);
    const facility = /** @type {string} */ (record.facility);
    const venue = /** @type {string} */ (record.venue);
    const subjectKey = `${record.permitId} ${record.date} ${facility}`;

    const reading = readPermitFacility(venue, facility);

    if (reading.surfaces.length === 0) {
      return projectedRow({
        sourceFile: SOURCE_FILE,
        rowIndex,
        subjectKey,
        interpretation: INTERPRETATION.UNRESOLVABLE,
        interpretationReason: `${reading.note}; the permit's own label ${JSON.stringify(facility)} is kept so the grant stays legible`,
        raw,
        record: null,
      });
    }

    // **Every surface the one cell names, resolved separately.** Resolving
    // `Field - Soccer 1A/1B` as a single name would either halve the reserved
    // ground or reserve the parent pitch the permit did not grant.
    const resolutions = reading.surfaces.map((surface) =>
      resolveGround(graph, complexMap, { venue, field: surface, subunit: null })
    );

    const unresolved = resolutions.filter(
      (resolution) => resolution.interpretation === INTERPRETATION.UNRESOLVABLE
    );
    if (unresolved.length > 0) {
      return projectedRow({
        sourceFile: SOURCE_FILE,
        rowIndex,
        subjectKey,
        interpretation: INTERPRETATION.UNRESOLVABLE,
        interpretationReason: `${unresolved.length} of ${resolutions.length} part(s) of ${JSON.stringify(facility)} reach no ground: ${unresolved.map((resolution) => resolution.reason).join('; ')}`,
        raw,
        record: null,
      });
    }

    const surfaceIds = [
      ...new Set(resolutions.flatMap((resolution) => resolution.surfaceIds)),
    ].sort();
    const venueIds = [...new Set(resolutions.flatMap((resolution) => resolution.venueIds))].sort();
    const doubtful = resolutions.some(
      (resolution) => resolution.interpretation === INTERPRETATION.DOUBTFUL
    );

    const window = PermitWindowSchema.parse({
      id: `${SOURCE_FILE}#${rowIndex}`,
      permitId: record.permitId,
      venueIds,
      surfaceIds,
      facilityLabel: facility,
      date: record.date,
      startMinutes: record.startMinutes,
      endMinutes: record.endMinutes,
      services: readPermitServices(record.services),
      source: RECORD_SOURCE.PERMIT,
    });

    return projectedRow({
      sourceFile: SOURCE_FILE,
      rowIndex,
      subjectKey,
      interpretation: doubtful ? INTERPRETATION.DOUBTFUL : INTERPRETATION.INTERPRETED,
      interpretationReason: doubtful
        ? (resolutions.find((resolution) => resolution.reason !== null)?.reason ?? null)
        : null,
      raw,
      record: window,
    });
  });
}
