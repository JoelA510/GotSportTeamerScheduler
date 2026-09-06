/**
 * **The inventory and equipment sheets into venue attributes.**
 *
 * ## What the plan gets wrong about these two files
 *
 * `PHASE_8_PLAN.md` §8.4 says to parse "`field_inventory.csv` and
 * `field_equipment.csv` into **surface** attributes". Checked against the
 * files, three things are true and none of them fits that description:
 *
 * 1. **Both are keyed on the venue.** `field_inventory.csv` has no field or
 *    surface column at all; its columns are `venue, field_sizes, age_groups,
 *    practice_max_teams, bathroom, notes`. `field_equipment.csv` is
 *    `venue, item, value`.
 * 2. **The payload is prose.** `field_sizes` is written `11v11 (4) 9v9 (8)` and
 *    `9v9 (1) 7v7 (2) upper (+ lower)`; `Ridgeline Club`'s goal count is
 *    `9v9 (2 sets) 7v7 (4 sets)`. There is no grammar here to parse, only a
 *    person's shorthand, and inventing sizes from it would put guessed capacity
 *    into a scheduler.
 * 3. **Two of the fourteen rows are sentinels.** `Foxglove Park` writes `XX` in
 *    three columns and `Alder Park` writes `??`, `??` and
 *    `????Availability UNKNOWN as of 3/26`. Those are a person saying "I do not
 *    know", and reading them as data would be reading a shrug as a number.
 *
 * And a fourth the plan does not mention: **`Willowmead Park` appears twice**,
 * with different `notes`. A venue-keyed subject with a duplicated key needs an
 * answer, and this projector's is to keep both rows on the subject and let the
 * change set report them as a disagreement rather than let the second silently
 * win. A last-wins index is exactly what Phase 8.0's third review round found
 * on the fields-ring side.
 *
 * So: **venue attributes, carried as text, with the sentinels marked doubtful.**
 * Anything a later reader wants to make of `11v11 (4) 9v9 (8)` is available to
 * them, because the cell is right there.
 *
 * @module fieldAdmin/projectors/inventory
 */

import { RECORD_SOURCE, VenueAttributesSchema } from '../schemas.js';
import { INTERPRETATION } from '../reasonCodes.js';
import { projectedRow, resolveGround } from './ground.js';

const INVENTORY_FILE = 'field_inventory.csv';

/**
 * Cells that mean "the person filling this in did not know".
 *
 * Matched on the whole trimmed cell **and** as a prefix, because `Alder Park`
 * writes `????Availability UNKNOWN as of 3/26` - a sentinel with prose stuck to
 * it. Kept as a small explicit list rather than a "three or more question
 * marks" rule, so a new sentinel spelling is added deliberately by someone who
 * has looked at it.
 */
export const INVENTORY_SENTINELS = Object.freeze(['XX', '??', '???', '????']);

/**
 * Is this cell a sentinel rather than a value?
 *
 * @param {string|null} cell
 * @returns {boolean}
 */
export function isInventorySentinel(cell) {
  if (cell === null || cell === undefined) return false;
  const trimmed = String(cell).trim();
  if (trimmed.length === 0) return false;
  return INVENTORY_SENTINELS.some(
    (sentinel) => trimmed === sentinel || trimmed.startsWith(sentinel)
  );
}

/**
 * Project the inventory and equipment sheets into venue attributes.
 *
 * Equipment is joined onto the inventory row for its venue. A venue with
 * equipment and no inventory row still produces a subject: dropping it would
 * lose the fact that the club keeps goals there.
 *
 * @param {ReadonlyArray<Object>} fieldInventory - `practice.fieldInventory` from the loader
 * @param {ReadonlyArray<Object>} fieldEquipment - `practice.fieldEquipment` from the loader
 * @param {import('../../facility/types.js').FacilityGraph} graph
 * @param {import('../../facility/types.js').VenueComplexMap} complexMap
 * @returns {import('../types.js').ProjectedRow[]}
 */
export function projectVenueAttributes(fieldInventory, fieldEquipment, graph, complexMap) {
  /** @type {Map<string, Array<{ item: string, value: string }>>} */
  const equipmentByVenue = new Map();
  /**
   * The first equipment row index per venue.
   *
   * Kept because an equipment-only subject has to cite a real row: stamping
   * `rowIndex: -1` made every such finding read `field_equipment.csv row -1`,
   * so with more than one equipment-only venue an operator could not get back
   * to the source of any of them.
   *
   * @type {Map<string, number>}
   */
  const firstEquipmentRow = new Map();
  for (const row of fieldEquipment) {
    const record = /** @type {Object} */ (row);
    const venue = /** @type {string} */ (record.venue);
    const held = equipmentByVenue.get(venue) ?? [];
    held.push({ item: /** @type {string} */ (record.item), value: String(record.value) });
    equipmentByVenue.set(venue, held);
    if (!firstEquipmentRow.has(venue)) {
      firstEquipmentRow.set(venue, /** @type {number} */ (record.rowIndex));
    }
  }

  /** @type {import('../types.js').ProjectedRow[]} */
  const rows = [];
  const venuesWithInventory = new Set();

  for (const row of fieldInventory) {
    const record = /** @type {Object} */ (row);
    const raw = /** @type {Record<string, unknown>} */ (record.raw ?? {});
    const rowIndex = /** @type {number} */ (record.rowIndex);
    const venue = /** @type {string} */ (record.venue);
    venuesWithInventory.add(venue);

    const ground = resolveGround(graph, complexMap, { venue, field: null, subunit: null });
    if (ground.interpretation === INTERPRETATION.UNRESOLVABLE) {
      rows.push(
        projectedRow({
          sourceFile: INVENTORY_FILE,
          rowIndex,
          subjectKey: venue,
          interpretation: INTERPRETATION.UNRESOLVABLE,
          interpretationReason: ground.reason,
          raw,
          record: null,
        })
      );
      continue;
    }

    const sentinelColumns = ['fieldSizes', 'ageGroups', 'practiceMaxTeams', 'bathroom', 'notes']
      .filter((column) => isInventorySentinel(/** @type {string|null} */ (record[column])))
      .sort();
    const doubtful =
      sentinelColumns.length > 0 || ground.interpretation === INTERPRETATION.DOUBTFUL;

    const attributes = VenueAttributesSchema.parse({
      id: `${INVENTORY_FILE}#${rowIndex}`,
      venueIds: ground.venueIds,
      venueLabel: venue,
      // **Carried as text, deliberately.** See the module docstring: there is
      // no grammar in `11v11 (4) 9v9 (8)`, only shorthand.
      fieldSizesText: record.fieldSizes ?? null,
      ageGroupsText: record.ageGroups ?? null,
      practiceMaxTeamsText: record.practiceMaxTeams ?? null,
      bathroomText: record.bathroom ?? null,
      notesText: record.notes ?? null,
      equipment: equipmentByVenue.get(venue) ?? [],
      source: RECORD_SOURCE.INVENTORY_SHEET,
    });

    rows.push(
      projectedRow({
        sourceFile: INVENTORY_FILE,
        rowIndex,
        subjectKey: venue,
        interpretation: doubtful ? INTERPRETATION.DOUBTFUL : INTERPRETATION.INTERPRETED,
        interpretationReason: doubtful
          ? sentinelColumns.length > 0
            ? `the sheet writes a "do not know" sentinel in ${sentinelColumns.join(', ')}; the cells are carried verbatim and nothing is read as a number`
            : ground.reason
          : null,
        raw,
        record: attributes,
      })
    );
  }

  // Venues the equipment sheet names and the inventory does not. Enumerated
  // from the equipment sheet rather than from the inventory rows above, so a
  // venue the inventory loop skipped is still reported.
  for (const [venue, equipment] of [...equipmentByVenue.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    if (venuesWithInventory.has(venue)) continue;
    const ground = resolveGround(graph, complexMap, { venue, field: null, subunit: null });
    const raw = { venue, item: '(equipment only)', value: String(equipment.length) };
    const equipmentRowIndex = /** @type {number} */ (firstEquipmentRow.get(venue));
    if (ground.interpretation === INTERPRETATION.UNRESOLVABLE) {
      rows.push(
        projectedRow({
          sourceFile: 'field_equipment.csv',
          rowIndex: equipmentRowIndex,
          subjectKey: venue,
          interpretation: INTERPRETATION.UNRESOLVABLE,
          interpretationReason: ground.reason,
          raw,
          record: null,
        })
      );
      continue;
    }
    rows.push(
      projectedRow({
        sourceFile: 'field_equipment.csv',
        rowIndex: equipmentRowIndex,
        subjectKey: venue,
        interpretation: INTERPRETATION.DOUBTFUL,
        interpretationReason:
          'the equipment sheet names this venue and the inventory sheet does not, so its formats, capacity and facilities are unstated',
        raw,
        record: VenueAttributesSchema.parse({
          id: `field_equipment.csv#${venue}`,
          venueIds: ground.venueIds,
          venueLabel: venue,
          fieldSizesText: null,
          ageGroupsText: null,
          practiceMaxTeamsText: null,
          bathroomText: null,
          notesText: null,
          equipment,
          source: RECORD_SOURCE.EQUIPMENT_SHEET,
        }),
      })
    );
  }

  return rows;
}
