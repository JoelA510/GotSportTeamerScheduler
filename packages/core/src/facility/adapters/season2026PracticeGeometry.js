/**
 * The practice layer of the season-2026 facility graph, **declared**, and
 * composed over the game layer rather than edited into it.
 *
 * `facility_geometry.json` stops at the game halves: Alder `Pitch 1A`/`1B`,
 * `4A`/`4B`, and the whole of `Pitch 2` and `Pitch 3`. The practice corpus
 * (`fixtures/season-2026/practice/`) books ground one level below that, and
 * not only at Alder: `2A`/`2B`, `3A`/`3B`, a `Side 1` inside each of the four
 * 9v9 halves, an `A`/`B` split of Maplewood Field 1-4 and Orchard Park Field
 * 1-4, a Brookside `Lower` the game layer does not carry at all, and ten
 * venues that host no game. It also names ground through two decoder rings.
 *
 * Every node below cites the corpus rows that evidence it, as
 * `{ file, where }` pairs a test loads and matches; a declared node whose
 * citation matches nothing fails loudly. The layer is the same footing as
 * {@link SEASON_2026_VENUE_COMPLEXES}: a transcription with provenance, not a
 * loader — this module reads nothing from disk and imports nothing from
 * `fixtures/`.
 *
 * What it does **not** do, on purpose:
 *
 * - It declares **no new overlap pair**. `Pitch 2A` inherits {Pitch 1, Pitch 2}
 *   through its lineage; the bipartite overlap clause in `occupancy.js` was
 *   built for exactly this.
 * - It declares no ground the corpus only *implies*. `Maplewood Front` has no
 *   `A` half here: the four grid rows on `Maplewood / Front / A` name a venue
 *   half as a field, and resolving that would take a ring, which
 *   `aliases.js` refuses to consult for ground. Those rows are reported as
 *   unresolved ground, never dropped. Larkfield Green has no `Field 2`: the
 *   fields sheet's `Field 2?` carries the source's own doubt and the inventory
 *   says `7v7 (1)`.
 * - It states no lighting. `field_inventory.csv` has no lighting column, so
 *   every practice-only venue carries `lit: null` — undeclared — and
 *   `availability/` reports `LIGHTING_UNDECLARED` for it rather than reading
 *   an absence as "unlit" (GAP-05).
 *
 * @module facility/adapters/season2026PracticeGeometry
 */

import { buildFacilityGraph, deepFreeze } from '../facilityGraph.js';
import { practiceSurfaceName } from '../practiceSurfaces.js';
import {
  season2026SurfaceId,
  season2026VenueId,
  toSeason2026FacilityGraphInput,
} from './season2026Geometry.js';

/**
 * A corpus citation: a file under `fixtures/season-2026/practice/` (or the
 * game corpus's `facility_geometry.json`) and the raw cells a row must carry,
 * all of them, for the citation to hold.
 *
 * @typedef {Object} PracticeLayerSource
 * @property {string} file
 * @property {Record<string, string>} where - raw column name -> exact cell value
 */

/**
 * One declared practice-layer venue.
 *
 * @typedef {Object} PracticeLayerVenue
 * @property {string} name - the corpus spelling
 * @property {boolean|null} lit - `null` unless a cited source states it; none does this season
 * @property {string|null} notes
 * @property {PracticeLayerSource[]} sources
 */

/**
 * One declared practice-layer surface.
 *
 * `field` names an existing surface at `venue` when `subunit` is set (the
 * node is that surface's child, named `${field} ${subunit}`); otherwise the
 * node is a new surface named `field`, a root unless `parent` names one.
 *
 * @typedef {Object} PracticeLayerSurface
 * @property {string} venue - the graph venue's corpus name
 * @property {string} field
 * @property {string|null} subunit
 * @property {string|null} parent - a game-layer surface name, for the Alder halves
 * @property {PracticeLayerSource[]} sources
 */

/** @param {string} file @param {Record<string, string>} where @returns {PracticeLayerSource} */
const cite = (file, where) => ({ file, where });

/** A grid row citation. */
const grid = (venue, field, subunit = null) =>
  cite('practice_grid.csv', subunit ? { venue, field, subunit } : { venue, field });

/** A practice-sheet decoder-ring citation. */
const alias = (venue, field, subunit = null) =>
  cite('practice_field_aliases.csv', subunit ? { venue, field, subunit } : { venue, field });

/** A fields-workbook decoder-ring citation. */
const codeName = (venue, remainder) => cite('field_code_names.csv', { venue, remainder });

/** A permit facility citation. */
const permit = (venue, facility) => cite('permit_reservations.csv', { venue, facility });

/** A venue inventory citation. */
const inventory = (venue) => cite('field_inventory.csv', { venue });

/**
 * @param {string} venue
 * @param {string} field
 * @param {string|null} subunit
 * @param {PracticeLayerSource[]} sources
 * @param {string|null} [parent]
 * @returns {PracticeLayerSurface}
 */
const surface = (venue, field, subunit, sources, parent = null) => ({
  venue,
  field,
  subunit,
  parent,
  sources,
});

const ALDER = 'Alder Park';
const MAPLEWOOD_BACK = 'Maplewood Back';
const ORCHARD = 'Orchard Park';
const BROOKSIDE = 'Brookside Park';

/**
 * The practice layer, declared.
 *
 * @type {Readonly<{ venues: ReadonlyArray<PracticeLayerVenue>, surfaces: ReadonlyArray<PracticeLayerSurface> }>}
 */
export const SEASON_2026_PRACTICE_LAYER = deepFreeze({
  venues: [
    { name: 'Cedarbrook Park', lit: null, notes: null, sources: [inventory('Cedarbrook Park')] },
    {
      name: 'Fivepines Park',
      lit: null,
      notes: null,
      sources: [codeName('Fivepines Park', 'Upper')],
    },
    { name: 'Quarrywood Park', lit: null, notes: null, sources: [inventory('Quarrywood Park')] },
    { name: 'Larkfield Green', lit: null, notes: null, sources: [inventory('Larkfield Green')] },
    { name: 'Foxglove Park', lit: null, notes: null, sources: [inventory('Foxglove Park')] },
    { name: 'Ridgeline Club', lit: null, notes: null, sources: [inventory('Ridgeline Club')] },
    { name: 'Beacon Field', lit: null, notes: null, sources: [inventory('Beacon Field')] },
    { name: 'Willowmead Park', lit: null, notes: null, sources: [inventory('Willowmead Park')] },
    { name: 'Hawthorn MS', lit: null, notes: null, sources: [inventory('Hawthorn MS')] },
    // Not inventoried. The practice ring is the only file that spells it this
    // way; the fields ring writes `Rookerie Park`, and both spellings are kept
    // (README: "kept as two spellings"). The second is reported by
    // `aliases.js` as a venue the graph does not know, never bridged.
    {
      name: 'Rookery Park',
      lit: null,
      notes: null,
      sources: [alias('Rookery Park', 'Turf Field 2')],
    },
  ],
  surfaces: [
    /* -- Alder Park: the halves of the two 11v11 pitches -------------------- */
    surface(
      ALDER,
      'Pitch 2A',
      null,
      [permit(ALDER, 'Field - Soccer 2A/2B (Field)'), grid(ALDER, 'Pitch 2A')],
      'Pitch 2'
    ),
    surface(
      ALDER,
      'Pitch 2B',
      null,
      [permit(ALDER, 'Field - Soccer 2A/2B (Field)'), grid(ALDER, 'Pitch 2B')],
      'Pitch 2'
    ),
    surface(
      ALDER,
      'Pitch 3A',
      null,
      [permit(ALDER, 'Field - Soccer 3A/3B (Field)'), grid(ALDER, 'Pitch 3A')],
      'Pitch 3'
    ),
    surface(
      ALDER,
      'Pitch 3B',
      null,
      [permit(ALDER, 'Field - Soccer 3A/3B (Field)'), grid(ALDER, 'Pitch 3B')],
      'Pitch 3'
    ),
    /* -- Alder Park: "Side 1" inside each 9v9 half --------------------------- */
    surface(ALDER, 'Pitch 1A', 'Side 1', [grid(ALDER, 'Pitch 1A', 'Side 1')]),
    surface(ALDER, 'Pitch 1B', 'Side 1', [grid(ALDER, 'Pitch 1B', 'Side 1')]),
    surface(ALDER, 'Pitch 4A', 'Side 1', [grid(ALDER, 'Pitch 4A', 'Side 1')]),
    surface(ALDER, 'Pitch 4B', 'Side 1', [grid(ALDER, 'Pitch 4B', 'Side 1')]),
    /* -- Maplewood Back Field 1-4, halved. The grid spells the venue
     *    `Maplewood`; the graph venue is the game corpus's `Maplewood Back`,
     *    reached through the declared complex, and the sub-unit is what makes
     *    the row resolve uniquely (see practiceSurfaces.js). -------------- */
    surface(MAPLEWOOD_BACK, 'Field 1', 'A', [grid('Maplewood', 'Field 1', 'A')]),
    surface(MAPLEWOOD_BACK, 'Field 1', 'B', [grid('Maplewood', 'Field 1', 'B')]),
    surface(MAPLEWOOD_BACK, 'Field 2', 'A', [grid('Maplewood', 'Field 2', 'A')]),
    surface(MAPLEWOOD_BACK, 'Field 2', 'B', [grid('Maplewood', 'Field 2', 'B')]),
    surface(MAPLEWOOD_BACK, 'Field 3', 'A', [grid('Maplewood', 'Field 3', 'A')]),
    surface(MAPLEWOOD_BACK, 'Field 3', 'B', [grid('Maplewood', 'Field 3', 'B')]),
    surface(MAPLEWOOD_BACK, 'Field 4', 'A', [grid('Maplewood', 'Field 4', 'A')]),
    surface(MAPLEWOOD_BACK, 'Field 4', 'B', [grid('Maplewood', 'Field 4', 'B')]),
    /* -- Orchard Park Field 1-4, halved ------------------------------------- */
    surface(ORCHARD, 'Field 1', 'A', [grid(ORCHARD, 'Field 1', 'A')]),
    surface(ORCHARD, 'Field 1', 'B', [grid(ORCHARD, 'Field 1', 'B')]),
    surface(ORCHARD, 'Field 2', 'A', [grid(ORCHARD, 'Field 2', 'A')]),
    surface(ORCHARD, 'Field 2', 'B', [grid(ORCHARD, 'Field 2', 'B')]),
    surface(ORCHARD, 'Field 3', 'A', [grid(ORCHARD, 'Field 3', 'A')]),
    surface(ORCHARD, 'Field 3', 'B', [grid(ORCHARD, 'Field 3', 'B')]),
    surface(ORCHARD, 'Field 4', 'A', [grid(ORCHARD, 'Field 4', 'A')]),
    surface(ORCHARD, 'Field 4', 'B', [grid(ORCHARD, 'Field 4', 'B')]),
    /* -- Brookside Park: the lower field the game layer never uses --------- */
    surface(BROOKSIDE, 'Lower', null, [
      grid(BROOKSIDE, 'Lower', 'A'),
      cite('field_inventory.csv', {
        venue: BROOKSIDE,
        field_sizes: '11v11 (lower) 9v9 (2-uppper)',
      }),
    ]),
    surface(BROOKSIDE, 'Lower', 'A', [grid(BROOKSIDE, 'Lower', 'A')]),
    surface(BROOKSIDE, 'Lower', 'B', [grid(BROOKSIDE, 'Lower', 'B')]),
    /* -- venues that host no game ------------------------------------------- */
    surface('Larkfield Green', 'Field 1', null, [
      alias('Larkfield Green', 'Field 1'),
      codeName('Larkfield Green', 'Field 1'),
    ]),
    surface('Larkfield Green', 'Field 1', 'A', [grid('Larkfield Green', 'Field 1', 'A')]),
    surface('Cedarbrook Park', 'Field 1', null, [alias('Cedarbrook Park', 'Field 1')]),
    surface('Rookery Park', 'Turf Field 2', null, [alias('Rookery Park', 'Turf Field 2')]),
    surface('Rookery Park', 'Turf Field 2', 'A', [alias('Rookery Park', 'Turf Field 2', 'A')]),
    surface('Rookery Park', 'Turf Field 2', 'B', [alias('Rookery Park', 'Turf Field 2', 'B')]),
    surface('Fivepines Park', 'Upper', null, [codeName('Fivepines Park', 'Upper')]),
    surface('Fivepines Park', 'Lower', null, [codeName('Fivepines Park', 'Lower')]),
    surface('Willowmead Park', 'Turf', null, [codeName('Willowmead Park', 'Turf')]),
    surface('Hawthorn MS', 'Field 1', null, [codeName('Hawthorn MS', 'Field 1')]),
  ],
});

/**
 * Stable surface id for a practice-layer node. Opaque by contract, exactly
 * like {@link season2026SurfaceId}, which it is built on.
 *
 * @param {string} venueName
 * @param {string} field
 * @param {string|null} subunit
 * @returns {string}
 */
export function season2026PracticeSurfaceId(venueName, field, subunit) {
  return season2026SurfaceId(venueName, practiceSurfaceName(field, subunit));
}

/**
 * Compose the practice layer over a game-layer graph input.
 *
 * Returns a new input; the argument is not mutated. Throws, rather than
 * repairs, when the layer names a venue the input already has, a parent the
 * input does not have, or a surface id that already exists — a layer that
 * silently re-declared game ground would be a second copy of the model.
 *
 * @param {import('../types.js').FacilityGraphInput} input - `toSeason2026FacilityGraphInput()` output
 * @param {{ venues: ReadonlyArray<PracticeLayerVenue>, surfaces: ReadonlyArray<PracticeLayerSurface> }} [layer]
 * @returns {import('../types.js').FacilityGraphInput}
 */
export function extendFacilityGraphInputWithSeason2026PracticeLayer(
  input,
  layer = SEASON_2026_PRACTICE_LAYER
) {
  const venues = input.venues.map((venue) => ({ ...venue }));
  const surfaces = input.surfaces.map((entry) => ({
    ...entry,
    childIds: [...(entry.childIds ?? [])],
  }));
  const venueIds = new Set(venues.map((venue) => venue.id));
  /** @type {Map<string, Object>} */
  const surfaceById = new Map(surfaces.map((entry) => [entry.id, entry]));

  for (const venue of layer.venues) {
    const id = season2026VenueId(venue.name);
    if (venueIds.has(id)) {
      throw new Error(
        `season2026 practice layer: venue "${venue.name}" is already in the game layer as "${id}"`
      );
    }
    venueIds.add(id);
    venues.push({ id, name: venue.name, lit: venue.lit, notes: venue.notes, overlapNote: null });
  }

  // **Two passes, so declaration order carries no meaning.** A single pass
  // resolved each node's parent through `surfaceById` as it went, so a child
  // written above its parent threw `names parent "...", which no layer
  // declares` about a parent declared on the next line -- a message that sends
  // the reader looking for a missing node rather than at the order. Every node
  // is created first; parents are linked afterwards, when the whole layer is
  // visible. Nothing else about the layer becomes order-dependent: `surfaces`
  // and every `childIds` list are still built in declaration order.
  /** @type {Array<{ node: Object, entry: Object }>} */
  const declared = [];

  for (const node of layer.surfaces) {
    const venueId = season2026VenueId(node.venue);
    if (!venueIds.has(venueId)) {
      throw new Error(
        `season2026 practice layer: "${node.venue}" / "${node.field}" names a venue neither layer declares`
      );
    }
    if (node.subunit !== null && node.parent !== null) {
      throw new Error(
        `season2026 practice layer: "${node.venue}" / "${node.field}" / "${node.subunit}" names parent "${node.parent}"; a sub-unit's parent is its field`
      );
    }
    const id = season2026PracticeSurfaceId(node.venue, node.field, node.subunit);
    if (surfaceById.has(id)) {
      throw new Error(`season2026 practice layer: surface "${id}" is declared twice`);
    }
    const entry = {
      id,
      venueId,
      name: practiceSurfaceName(node.field, node.subunit),
      // The practice sheets state no format for their ground: undeclared, not
      // inherited. A half of an 11v11 pitch is not an 11v11 pitch.
      sizes: [],
      lined: [],
      parentId: null,
      childIds: [],
      bookable: true,
      note: null,
    };
    surfaces.push(entry);
    surfaceById.set(id, entry);
    declared.push({ node, entry });
  }

  for (const { node, entry } of declared) {
    const parentName = node.subunit === null ? node.parent : node.field;
    if (parentName === null) continue;
    const parentId = season2026SurfaceId(node.venue, parentName);
    const parent = surfaceById.get(parentId);
    if (!parent) {
      throw new Error(
        `season2026 practice layer: "${node.venue}" / "${practiceSurfaceName(node.field, node.subunit)}" names parent "${parentName}", which no layer declares`
      );
    }
    entry.parentId = parentId;
    parent.childIds.push(entry.id);
  }

  return /** @type {import('../types.js').FacilityGraphInput} */ ({
    ...input,
    venues,
    surfaces,
    overlapPairs: [...(input.overlapPairs ?? [])],
  });
}

/**
 * Build the season-2026 facility graph with the practice layer on it.
 *
 * @param {{ venues: Array<Object>, fields?: Array<Object>, equipmentExceptions?: Array<Object> }} geometry
 * @param {{ strict?: boolean, equipmentOverrides?: Array<Object>, formatEquipment?: Record<string, ReadonlyArray<string>>, sizePolicy?: string, sizeRank?: Record<string, number>, layer?: { venues: ReadonlyArray<PracticeLayerVenue>, surfaces: ReadonlyArray<PracticeLayerSurface> } }} [options]
 * @returns {import('../types.js').FacilityGraph}
 */
export function buildSeason2026PracticeFacilityGraph(geometry, options = {}) {
  const { layer, ...rest } = options;
  return buildFacilityGraph(
    extendFacilityGraphInputWithSeason2026PracticeLayer(
      toSeason2026FacilityGraphInput(geometry, rest),
      layer ?? SEASON_2026_PRACTICE_LAYER
    )
  );
}

/**
 * The names the two decoder rings go by in the alias layer. Named for the
 * workbook each came from, exactly as the corpus README does.
 */
export const SEASON_2026_ALIAS_RINGS = Object.freeze({
  PRACTICE_SHEET: 'practice-sheet',
  FIELDS_SHEET: 'fields-sheet',
});

/**
 * Translate the corpus loader's two decoder rings into `buildFieldAliasMap()`
 * input. Takes the already-parsed records (`practice.fieldAliases`,
 * `practice.fieldCodeNames`) and reads nothing from disk.
 *
 * The fields sheet writes one `remainder` cell (`Turf 2A`, `Field 1`, `Upper`,
 * or nothing) rather than a field and a sub-unit; it is passed as the field
 * name **as written**. Splitting `Turf 2A` into `Turf 2` + `A` would be a
 * grammar the sheet does not state, and `Rookerie Park` does not resolve
 * anyway: it is the spelling variant the README keeps on purpose.
 *
 * **A blank cell is `null` on both rings.** `parseFieldCodeNames()` writes
 * `trim(cell)` for `venue` and `actual_label`, so an empty cell arrives here as
 * `''`, while `parsePracticeFieldAliases()` writes `orNull(cell)`. Passed
 * through as `''` the row throws out of `buildFieldAliasMap()`
 * (`AliasRingEntrySchema` is non-empty-or-null) — the ring with the *stricter*
 * parser would be the one that cannot be read — where the same blank on the
 * practice ring resolves `blank` and is reported as `ALIAS_BLANK`. The sibling's
 * contract is adopted rather than a third one invented.
 *
 * @param {ReadonlyArray<{ displayName: string, actualLabel: string|null, venue: string|null, field: string|null, subunit: string|null, rowIndex: number }>} fieldAliases
 * @param {ReadonlyArray<{ codeName: string, actualLabel: string, venue: string, remainder: string|null, uncertain: boolean, rowIndex: number }>} fieldCodeNames
 * @returns {{ rings: Array<{ ring: string, entries: Array<Object> }> }}
 */
/**
 * An empty cell is an absence, not the empty label. See
 * {@link toSeason2026AliasRings}.
 *
 * @param {string|null|undefined} value
 * @returns {string|null}
 */
function blankAsNull(value) {
  return value === null || value === undefined || value === '' ? null : value;
}

export function toSeason2026AliasRings(fieldAliases, fieldCodeNames) {
  return {
    rings: [
      {
        ring: SEASON_2026_ALIAS_RINGS.PRACTICE_SHEET,
        entries: fieldAliases.map((row) => ({
          displayName: row.displayName,
          label: row.actualLabel,
          venue: row.venue,
          field: row.field,
          subunit: row.subunit,
          uncertain: false,
          source: `practice_field_aliases.csv#${row.rowIndex}`,
        })),
      },
      {
        ring: SEASON_2026_ALIAS_RINGS.FIELDS_SHEET,
        entries: fieldCodeNames.map((row) => ({
          displayName: row.codeName,
          label: blankAsNull(row.actualLabel),
          venue: blankAsNull(row.venue),
          field: row.remainder,
          subunit: null,
          uncertain: row.uncertain,
          source: `field_code_names.csv#${row.rowIndex}`,
        })),
      },
    ],
  };
}
