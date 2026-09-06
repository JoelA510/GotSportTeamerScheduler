/**
 * **Both decoder rings into the alias layer, with the disagreements intact.**
 *
 * The club keeps two rings and they disagree on **12 of the 20 codes they
 * share**: `practice_field_aliases.csv` from the practice workbook and
 * `field_code_names.csv` from the fields workbook. Neither is marked
 * authoritative anywhere in the source, so nothing here prefers one.
 *
 * **The scope of that 12 matters, and only the adapter used to state it.** The
 * 12 is a count over `actual_label` - what each ring *calls* the ground.
 * Including the venue cell gives **13**, because `11v11 Field 1` has both rings
 * writing `Willowmead Park Turf` while the practice ring leaves the venue
 * blank; that thirteenth is reported on the interpretation axis, where a row
 * that names no venue belongs.
 *
 * Labels are the right scope because `compareDecoderRings()` in the corpus
 * loader is the single producer of "decoder-ring disagreement", and it compares
 * labels. A second scope here would be a second producer of one derived status,
 * which is the defect Phase 8.0's first review round already found once.
 *
 * ## The 12, and why every one of them is `differing`
 *
 * The composition is **11 label conflicts plus 1 blank-vs-label**, and the blank
 * one is `11v11 Field 2`: the practice ring lists the code with an empty
 * `actual_label`, the fields ring says `Hawthorn MS Field 1`.
 *
 * The supervisor proposed reporting that twelfth as `added` rather than
 * `differing`, on the reading that "one ring saying nothing" is an absence and
 * `publication/parity.js` has `added`/`removed` for exactly that. **The evidence
 * refused it**, and the reasoning is recorded here because it is the kind of
 * question that gets re-litigated:
 *
 * 1. **`added` would be a false statement about presence.** Keyed on the code,
 *    *both* rings carry a row for `11v11 Field 2` - `practice_field_aliases.csv`
 *    writes `11v11 Field 2,,,,`. What is blank is the `actual_label` **cell**,
 *    not the row. `added` in parity means "no row on that side under this key".
 * 2. **`added` is already occupied by a different fact.** Seven codes are on the
 *    fields ring and absent from the practice ring: `11v11 Field 3`,
 *    `7v7 Field 4`, `7v7 Field 5`, `9v9 Field 3`, `9v9 Field 4`, `9v9 Field 5`
 *    and `9v9 Field 6`. Those are the genuine additions. Putting the blank in
 *    beside them merges "the practice sheet does not list this code" with "the
 *    practice sheet lists this code and names no ground", which the club would
 *    act on differently.
 * 3. **Parity's literal handling would be worse than either.** An absent cell
 *    goes to `absentFields` and is counted as neither agreement nor difference,
 *    so `11v11 Field 2` would land in `matched` - reporting that the two rings
 *    *agree*. That is the strongest argument for adopting parity's shape rather
 *    than calling its function.
 * 4. **Two producers already answer this and agree.**
 *    `season2026PracticeParsers.js`'s `DECODER_DISAGREEMENT_KIND` and
 *    `facility/aliases.js`'s `ALIAS_LABEL_AGREEMENT` both call it a
 *    disagreement with a distinct kind. A third answer here would be the
 *    second-producer defect Phase 8.0's first review round already found once.
 *
 * So: all 12 report as `differing`, none is applied, and each carries the
 * **kind** - reusing `ALIAS_LABEL_AGREEMENT`'s words verbatim - so the count of
 * 12 can never hide the composition of 11 + 1.
 *
 * @module fieldAdmin/projectors/rings
 */

import { ALIAS_LABEL_AGREEMENT } from '../../facility/aliases.js';
import { AliasRecordSchema, RECORD_SOURCE } from '../schemas.js';
import { INTERPRETATION } from '../reasonCodes.js';
import { projectedRow, resolveGround } from './ground.js';

/**
 * One reading of an empty cell, shared by both ring accessors.
 *
 * **An empty string is an absence**, and the two accessors used to disagree
 * about that: the fields ring wrote `|| null` and the practice ring did not, so
 * an `actual_label` of `''` reached `z.string().min(1).nullable()` and threw,
 * taking all five change sets down. The same reading now lives in one place, so
 * the two cannot drift again - and it agrees with `nullableText` in
 * `schemas.js` and with 8.3's `59db087`, which settled the same question for
 * the fields ring.
 *
 * @param {unknown} cell
 * @returns {string|null}
 */
const blank = (cell) =>
  cell === '' || cell === undefined ? null : /** @type {string|null} */ (cell);

/** Which file each ring comes from, for provenance on every row. */
export const RING_SOURCE_FILE = Object.freeze({
  [RECORD_SOURCE.PRACTICE_RING]: 'practice_field_aliases.csv',
  [RECORD_SOURCE.FIELDS_RING]: 'field_code_names.csv',
});

/**
 * Project one ring's rows into alias records.
 *
 * Both rings go through this one function with different accessors, rather than
 * one function per ring: the two sheets spell their columns differently, and
 * two code paths is how one of them quietly stops reporting a blank.
 *
 * @param {Object} input
 * @param {string} input.source - a `RECORD_SOURCE` ring value
 * @param {ReadonlyArray<Object>} input.rows - parsed ring records from the 8.0 loader
 * @param {(row: Object) => { displayName: string, label: string|null, venue: string|null, field: string|null, subunit: string|null, uncertain: boolean }} input.read
 * @param {import('../../facility/types.js').FacilityGraph} input.graph
 * @param {import('../../facility/types.js').VenueComplexMap} input.complexMap
 * @returns {import('../types.js').ProjectedRow[]}
 */
export function projectRing({ source, rows, read, graph, complexMap }) {
  const sourceFile = RING_SOURCE_FILE[source];
  if (!sourceFile) {
    throw new Error(
      `fieldAdmin rings: "${source}" is not a ring source; expected one of ${Object.keys(RING_SOURCE_FILE).join(', ')}`
    );
  }

  return rows.map((row) => {
    const cells = read(row);
    const raw = /** @type {Record<string, unknown>} */ (
      /** @type {Object} */ (row).raw ?? { ...cells }
    );
    const rowIndex = /** @type {number} */ (/** @type {Object} */ (row).rowIndex);

    // **A ring row is never `unresolvable`, and that is a deliberate contract
    // rather than an oversight.**
    //
    // The subject here is the *published name*, and the record is *what this
    // ring says about it*. A ring that lists a code and names no ground has
    // still made a statement, and so has a ring that names ground the graph
    // does not hold. Refusing to build a record for either would drop the row
    // out of the comparison - and the two rows it would drop are exactly the
    // ones the corpus exists to surface: `11v11 Field 2`, which the practice
    // ring lists with every cell after the code blank, and `7v7 Field 1`, whose
    // fields-ring branch points at a `Larkfield Green Field 2` that the graph
    // does not hold and the inventory contradicts. Losing either would take a
    // disagreement with it and quietly reconcile the rings.
    //
    // `facility/aliases.js` reached the same contract first: it keeps a
    // candidate with an empty ground set and a `blank` resolution rather than
    // discarding it. This adopts that contract rather than inventing a third.
    // Unresolved ground is recorded *in* the record (empty id arrays) and in
    // the interpretation reason, never by deleting the record.
    const ground =
      cells.venue === null
        ? {
            venueIds: [],
            surfaceIds: [],
            interpretation: INTERPRETATION.DOUBTFUL,
            reason:
              cells.label === null
                ? 'the ring lists the code with no label and no venue, so it names no ground at all'
                : `the ring says ${JSON.stringify(cells.label)} but names no venue, so no venue join can reach it`,
          }
        : resolveGround(graph, complexMap, {
            venue: cells.venue,
            field: cells.field,
            subunit: cells.subunit,
          });

    // The source's own doubt outranks a clean structural resolution: the fields
    // ring writes `Larkfield Green Field 2?` and the `?` is the club saying it
    // does not know. A row nobody is sure of is never silently applicable.
    const doubtful = cells.uncertain || ground.interpretation !== INTERPRETATION.INTERPRETED;
    const reason = cells.uncertain
      ? `the ${source} marks ${JSON.stringify(cells.label)} as uncertain with the source's own "?"${ground.reason ? `; ${ground.reason}` : ''}`
      : ground.reason;

    const record = AliasRecordSchema.parse({
      id: `${sourceFile}#${cells.displayName}`,
      displayName: cells.displayName,
      label: cells.label,
      venueIds: ground.venueIds,
      surfaceIds: ground.surfaceIds,
      uncertain: cells.uncertain,
      source,
    });

    return projectedRow({
      sourceFile,
      rowIndex,
      subjectKey: cells.displayName,
      interpretation: doubtful ? INTERPRETATION.DOUBTFUL : INTERPRETATION.INTERPRETED,
      interpretationReason: doubtful ? reason : null,
      raw,
      record,
    });
  });
}

/**
 * Project the practice workbook's ring.
 *
 * @param {ReadonlyArray<Object>} rows - `practice.fieldAliases` from the loader
 * @param {import('../../facility/types.js').FacilityGraph} graph
 * @param {import('../../facility/types.js').VenueComplexMap} complexMap
 * @returns {import('../types.js').ProjectedRow[]}
 */
export function projectPracticeRing(rows, graph, complexMap) {
  return projectRing({
    source: RECORD_SOURCE.PRACTICE_RING,
    rows,
    graph,
    complexMap,
    read: (row) => ({
      displayName: /** @type {string} */ (/** @type {Object} */ (row).displayName),
      // `blank()` on every nullable cell, exactly as the fields-ring accessor
      // does. This one used to read `actualLabel` raw while its sibling wrote
      // `|| null`, which is the sibling-contract divergence `CLAUDE.md` names -
      // and here it was a crash path, not a wrong answer.
      label: blank(/** @type {Object} */ (row).actualLabel),
      venue: blank(/** @type {Object} */ (row).venue),
      field: blank(/** @type {Object} */ (row).field),
      subunit: blank(/** @type {Object} */ (row).subunit),
      // The practice sheet has no doubt column at all; it writes no `?`.
      uncertain: false,
    }),
  });
}

/**
 * Project the fields workbook's ring.
 *
 * `remainder` is this sheet's field cell - the label with the venue taken off
 * the front - which is why it is read as `field` here. It is **not** blanked
 * when the label is blank, which `facility/aliases.js` records as having once
 * produced a message calling a present field absent.
 *
 * @param {ReadonlyArray<Object>} rows - `practice.fieldCodeNames` from the loader
 * @param {import('../../facility/types.js').FacilityGraph} graph
 * @param {import('../../facility/types.js').VenueComplexMap} complexMap
 * @returns {import('../types.js').ProjectedRow[]}
 */
export function projectFieldsRing(rows, graph, complexMap) {
  return projectRing({
    source: RECORD_SOURCE.FIELDS_RING,
    rows,
    graph,
    complexMap,
    read: (row) => ({
      displayName: /** @type {string} */ (/** @type {Object} */ (row).codeName),
      label: blank(/** @type {Object} */ (row).actualLabel),
      venue: blank(/** @type {Object} */ (row).venue),
      field: blank(/** @type {Object} */ (row).remainder),
      subunit: null,
      uncertain: Boolean(/** @type {Object} */ (row).uncertain),
    }),
  });
}

/**
 * The label-agreement kind for one published name across the rows that named it.
 *
 * **Reuses `ALIAS_LABEL_AGREEMENT` verbatim.** The rule matches
 * `facility/aliases.js` exactly, including the part that looks arbitrary and is
 * not: the kind is decided from the **first** ring's label alone - the driver -
 * because that is the ring `compareDecoderRings()` iterates while looking the
 * code up in the other. Deciding from "either side is blank" is a different
 * rule, and the two disagree precisely when the *second* ring is the blank one,
 * which the loader calls a label conflict.
 *
 * @param {ReadonlyArray<import('../types.js').ProjectedRow>} rows - in ring order
 * @returns {string} an `ALIAS_LABEL_AGREEMENT` value
 */
export function labelAgreementOf(rows) {
  const withRecords = rows.filter((row) => row.record !== null);
  if (withRecords.length < 2) return ALIAS_LABEL_AGREEMENT.SINGLE_RING;
  const labels = withRecords.map(
    (row) => /** @type {string|null} */ (/** @type {Record<string, unknown>} */ (row.record).label)
  );
  const driverLabel = labels[0];
  // Two silences are not an agreement about ground, and the loader does not
  // report them as one either.
  if (new Set(labels).size === 1 && driverLabel !== null) return ALIAS_LABEL_AGREEMENT.AGREE;
  return driverLabel === null
    ? ALIAS_LABEL_AGREEMENT.BLANK_VS_LABEL
    : ALIAS_LABEL_AGREEMENT.LABEL_CONFLICT;
}
