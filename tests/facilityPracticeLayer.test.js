/**
 * Tests for the practice layer of the facility graph (Phase 8.3):
 * `facility/adapters/season2026PracticeGeometry.js`, `facility/practiceSurfaces.js`.
 *
 * Every figure is derived from the corpus at test time. The subject sets are
 * enumerated from the side a break would leave intact — the declared layer,
 * the game geometry, the permits — and the practice grid is the thing being
 * checked, never the thing the check is derived from.
 *
 * Meta-assertion discipline as in `tests/facilityGraph.test.js`: each
 * behavioural check also proves it examined a non-zero number of records, and
 * each guard has a positive control that makes it fail.
 */

import { describe, it, expect } from 'vitest';

import {
  loadFacilityGeometry,
  loadFacilityPermits,
  loadGameFormats,
  loadPracticeFile,
  loadSeason2026,
  loadSeason2026Practice,
  loadSunsets,
  UNRESOLVED_VENUE_TOKEN,
} from '@squadlogic/core/fixtures/index.js';

import {
  AVAILABILITY_CONSTRAINT,
  AVAILABILITY_REASON,
  AVAILABILITY_SEVERITY,
  AVAILABILITY_STATUS,
  buildAvailabilityCalendarFromSeason2026,
  checkKickoffAvailability,
  resolveLighting,
} from '@squadlogic/core/availability/index.js';

import { buildFormatTimingTableFromSeason2026 } from '@squadlogic/core/timing/index.js';

import { replacementSurfacesFor } from '@squadlogic/core/scenario/index.js';

import { buildSeason2026ConstraintRegistry } from '@squadlogic/core/constraints/index.js';

import { RULE_ID, runRuleEngine, toSeason2026Schedule } from '@squadlogic/core/ruleEngine/index.js';

import {
  FACILITY_REASON,
  PRACTICE_SURFACE_RESOLUTION,
  SEASON_2026_PRACTICE_LAYER,
  buildFacilityGraph,
  buildFacilityGraphFromSeason2026,
  buildSeason2026PracticeFacilityGraph,
  buildSeason2026VenueComplexMap,
  cellsOf,
  extendFacilityGraphInputWithSeason2026PracticeLayer,
  findFacilityConflicts,
  lineageOf,
  practiceSurfaceName,
  resolvePracticeSurface,
  resolvePracticeVenue,
  season2026PracticeSurfaceId,
  season2026SurfaceId,
  season2026VenueId,
  surfacesConflict,
  toSeason2026FacilityGraphInput,
} from '@squadlogic/core/facility/index.js';

/* -------------------------------------------------------------------------- */
/* Corpus, loaded once                                                         */
/* -------------------------------------------------------------------------- */

const geometry = loadFacilityGeometry();
const season = loadSeason2026();
const practice = loadSeason2026Practice({ season });
const gameGraph = buildFacilityGraphFromSeason2026(geometry);
const graph = buildSeason2026PracticeFacilityGraph(geometry);
const complexes = buildSeason2026VenueComplexMap();

const ALDER = 'Alder Park';
const R = PRACTICE_SURFACE_RESOLUTION;

/** Opaque id of a game-layer surface. */
const sid = (venue, field) => season2026SurfaceId(venue, field);
/** Opaque id of a practice-layer node. */
const pid = (venue, field, subunit = null) => season2026PracticeSurfaceId(venue, field, subunit);

/** Ids the practice layer adds, derived from the declaration, not typed in. */
const layerSurfaceIds = SEASON_2026_PRACTICE_LAYER.surfaces.map((node) =>
  pid(node.venue, node.field, node.subunit)
);
const layerVenueIds = SEASON_2026_PRACTICE_LAYER.venues.map((venue) =>
  season2026VenueId(venue.name)
);

/** Resolve a grid row to ground, by structure. */
const resolveSlot = (slot) =>
  resolvePracticeSurface(graph, complexes, {
    venue: slot.venue,
    field: slot.field,
    subunit: slot.subunit,
  });

/**
 * A practice booking on a surface id at a weekly slot's time on a date.
 *
 * @param {string} id
 * @param {string} surfaceId
 * @param {string} date
 * @param {number} startMinutes
 * @param {number} endMinutes
 */
const booking = (id, surfaceId, date, startMinutes, endMinutes) => ({
  id,
  surfaceId,
  date,
  startMinutes,
  endMinutes,
  format: null,
  label: id,
});

/* -------------------------------------------------------------------------- */
/* Guard block                                                                 */
/* -------------------------------------------------------------------------- */

describe('practice layer :: corpus guard', () => {
  it('composes over the game graph without changing it', () => {
    // The game layer is untouched: same counts a game-only build reports.
    expect(gameGraph.stats.overlapPairCount).toBe(2);
    expect(gameGraph.stats.containmentEdgeCount).toBe(4);
    expect(gameGraph.stats.surfaceCount).toBe(geometry.fields.length);
    expect(gameGraph.stats.venueCount).toBe(geometry.venues.length);

    // The practice graph is strictly the game graph plus the declared layer.
    expect(graph.stats.overlapPairCount).toBe(2);
    expect(graph.overlapPairs).toEqual(gameGraph.overlapPairs);
    expect(graph.stats.venueCount).toBe(geometry.venues.length + layerVenueIds.length);
    expect(graph.stats.surfaceCount).toBe(geometry.fields.length + layerSurfaceIds.length);
    expect(graph.stats.containmentEdgeCount).toBe(
      4 + SEASON_2026_PRACTICE_LAYER.surfaces.filter((n) => n.subunit !== null || n.parent).length
    );
    expect(layerSurfaceIds.length).toBeGreaterThan(20);
    expect(layerVenueIds.length).toBe(10);
    for (const id of gameGraph.surfaceIds) expect(graph.surfaces[id]).toBeDefined();
    for (const id of layerSurfaceIds) expect(graph.surfaces[id]).toBeDefined();
  });

  it('keeps every game-layer relation exactly as the game graph answers it', () => {
    // Enumerated from the game graph, so a practice node cannot mask a change.
    let compared = 0;
    for (const a of gameGraph.surfaceIds) {
      for (const b of gameGraph.surfaceIds) {
        const before = surfacesConflict(gameGraph, a, b);
        const after = surfacesConflict(graph, a, b);
        expect(after.conflict, `${a} vs ${b}`).toBe(before.conflict);
        expect(after.code, `${a} vs ${b}`).toBe(before.code);
        compared += 1;
      }
    }
    expect(compared).toBe(gameGraph.surfaceIds.length ** 2);
  });

  it('never mints a colon-bearing id and names every node uniquely within its venue', () => {
    const seen = new Set();
    for (const id of graph.surfaceIds) {
      expect(id).not.toContain(':');
      const key = `${graph.surfaces[id].venueId}\u0000${graph.surfaces[id].name}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
    expect(seen.size).toBe(graph.surfaceIds.length);
  });

  it('declares no lighting for the venues no source states it for', () => {
    for (const id of layerVenueIds) expect(graph.venues[id].lit).toBeNull();
    // ... and leaves the game corpus's stated flags alone.
    for (const venue of geometry.venues) {
      expect(typeof venue.lit).toBe('boolean');
      expect(graph.venues[season2026VenueId(venue.name)].lit).toBe(venue.lit);
    }
    expect(geometry.venues.some((venue) => venue.lit === true)).toBe(true);
    // An omitted flag is undeclared everywhere, not only in the practice layer.
    const silent = buildFacilityGraph({
      venues: [{ id: 'v', name: 'V' }],
      surfaces: [{ id: 'v/f', venueId: 'v', name: 'F' }],
    });
    expect(silent.venues.v.lit).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Every declared node cites a row that exists                                 */
/* -------------------------------------------------------------------------- */

describe('practice layer :: every declared node cites a corpus row that exists', () => {
  /** Raw rows of every cited file, loaded through the corpus loader. */
  const rawRowsByFile = new Map();
  const rawRowsOf = (file) => {
    if (!rawRowsByFile.has(file)) {
      rawRowsByFile.set(
        file,
        loadPracticeFile(file, { seasonYear: season.seasonYear }).records.map((r) => r.raw)
      );
    }
    return rawRowsByFile.get(file);
  };
  const rowMatches = (row, where) =>
    Object.entries(where).every(([column, value]) => row[column] === value);
  const citationHolds = (source) =>
    rawRowsOf(source.file).some((row) => rowMatches(row, source.where));

  it('holds for every venue and every surface', () => {
    const nodes = [...SEASON_2026_PRACTICE_LAYER.venues, ...SEASON_2026_PRACTICE_LAYER.surfaces];
    let citations = 0;
    for (const node of nodes) {
      expect(node.sources.length, JSON.stringify(node)).toBeGreaterThan(0);
      for (const source of node.sources) {
        citations += 1;
        expect(citationHolds(source), `${JSON.stringify(source)} matches no row`).toBe(true);
        // Every cited column is a real column of that file.
        const [first] = rawRowsOf(source.file);
        for (const column of Object.keys(source.where)) expect(first).toHaveProperty(column);
      }
    }
    expect(citations).toBeGreaterThanOrEqual(nodes.length);
    expect(new Set(nodes.flatMap((n) => n.sources.map((s) => s.file))).size).toBeGreaterThan(3);
  });

  it('fails on a citation that names a row the corpus does not have (positive control)', () => {
    expect(
      citationHolds({ file: 'practice_grid.csv', where: { venue: ALDER, field: 'Pitch 9A' } })
    ).toBe(false);
    expect(
      citationHolds({
        file: 'practice_grid.csv',
        where: { venue: 'Maplewood', field: 'Field 1', subunit: 'C' },
      })
    ).toBe(false);
    // ... and holds for a row it does have, so the matcher is not vacuous.
    expect(
      citationHolds({ file: 'practice_grid.csv', where: { venue: ALDER, field: 'Pitch 2A' } })
    ).toBe(true);
  });

  it('declares only venues that host no game and only ground the game layer lacks', () => {
    const gameVenueNames = new Set(geometry.venues.map((venue) => venue.name));
    for (const venue of SEASON_2026_PRACTICE_LAYER.venues) {
      expect(gameVenueNames.has(venue.name), venue.name).toBe(false);
    }
    for (const id of layerSurfaceIds) expect(gameGraph.surfaces[id]).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Acceptance: the property the tree must preserve                            */
/* -------------------------------------------------------------------------- */

describe('practice layer :: 2A and 2B do not conflict, and a game on Pitch 2 excludes both', () => {
  const pitch2 = sid(ALDER, 'Pitch 2');
  const pitch2a = pid(ALDER, 'Pitch 2A');
  const pitch2b = pid(ALDER, 'Pitch 2B');
  const pitch1 = sid(ALDER, 'Pitch 1');
  const pitch1a = sid(ALDER, 'Pitch 1A');
  const side1 = pid(ALDER, 'Pitch 1A', 'Side 1');

  it('models the halves as children of the whole pitch, three levels deep at Alder', () => {
    expect(lineageOf(graph, pitch2a)).toEqual([pitch2a, pitch2]);
    expect(cellsOf(graph, pitch2)).toEqual([pitch2a, pitch2b].sort());
    expect(lineageOf(graph, side1)).toEqual([side1, pitch1a, pitch1]);
    expect(graph.surfaces[side1].depth).toBe(2);
    expect(cellsOf(graph, pitch1)).toEqual([side1, pid(ALDER, 'Pitch 1B', 'Side 1')].sort());
    // Pitch 2 was a leaf in the game layer and is a parent here.
    expect(cellsOf(gameGraph, pitch2)).toEqual([pitch2]);
  });

  it('lets two practices run on 2A and 2B at once', () => {
    const verdict = surfacesConflict(graph, pitch2a, pitch2b);
    expect(verdict.conflict).toBe(false);
    expect(verdict.meta.overlapPairsConsulted).toBe(2);
    const scan = findFacilityConflicts(graph, [
      booking('a', pitch2a, '2026-09-15', 16 * 60, 17 * 60),
      booking('b', pitch2b, '2026-09-15', 16 * 60, 17 * 60),
    ]);
    expect(scan.conflicts).toEqual([]);
    expect(scan.meta.bookingPairsCompared).toBe(1);
  });

  it('rejects a game on Pitch 2 concurrent with a practice on either half', () => {
    for (const half of [pitch2a, pitch2b]) {
      const verdict = surfacesConflict(graph, pitch2, half);
      expect(verdict.conflict).toBe(true);
      expect(verdict.code).toBe(FACILITY_REASON.OCCUPIED_PARENT_CHILD);
    }
    const scan = findFacilityConflicts(graph, [
      booking('game', pitch2, '2026-09-19', 10 * 60, 11 * 60 + 30),
      booking('a', pitch2a, '2026-09-19', 10 * 60, 11 * 60),
      booking('b', pitch2b, '2026-09-19', 11 * 60, 12 * 60),
    ]);
    expect(scan.conflicts.map((f) => f.details.bookingBId).sort()).toEqual(['a', 'b']);
    expect(scan.meta.bookingPairsCompared).toBe(3);
  });

  it('carries the declared overlap down through the new levels without a new pair', () => {
    // Side 1 inside 1A overlaps 2B through {Pitch 1, Pitch 2}: bipartite, via lineage.
    const verdict = surfacesConflict(graph, side1, pitch2b);
    expect(verdict.conflict).toBe(true);
    expect(verdict.code).toBe(FACILITY_REASON.OCCUPIED_SPATIAL_OVERLAP);
    expect(verdict.meta.overlapPairsConsulted).toBeGreaterThan(0);
    // ... and 1A / Side 1 against 3A is fine, exactly as 1 against 3 is.
    expect(surfacesConflict(graph, side1, pid(ALDER, 'Pitch 3A')).conflict).toBe(false);
    expect(graph.stats.overlapPairCount).toBe(gameGraph.stats.overlapPairCount);
  });

  it('would notice the tree being flattened (positive control)', () => {
    // A flat layer: 2A and 2B as roots. The property fails on both halves.
    const flat = buildFacilityGraph(
      extendFacilityGraphInputWithSeason2026PracticeLayer(
        toSeason2026FacilityGraphInput(geometry),
        {
          venues: [],
          surfaces: [
            { venue: ALDER, field: 'Pitch 2A', subunit: null, parent: null, sources: [] },
            { venue: ALDER, field: 'Pitch 2B', subunit: null, parent: null, sources: [] },
          ],
        }
      )
    );
    expect(surfacesConflict(flat, pitch2, pitch2a).conflict).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Resolution by structure                                                    */
/* -------------------------------------------------------------------------- */

describe('practice layer :: names resolve to ground by graph structure alone', () => {
  it('resolves the practice spelling "Maplewood" to the declared complex, not a third name', () => {
    expect(resolvePracticeVenue(graph, complexes, 'Maplewood')).toEqual({
      venueIds: [season2026VenueId('Maplewood Back'), season2026VenueId('Maplewood Front')],
      venueSource: 'complex',
    });
    expect(resolvePracticeVenue(graph, complexes, 'Maplewood Back').venueSource).toBe('venue');
    expect(resolvePracticeVenue(graph, complexes, 'Rookerie Park')).toEqual({
      venueIds: [],
      venueSource: null,
    });
    expect(graph.venueIds.some((id) => graph.venues[id].name === 'Maplewood')).toBe(false);
  });

  it('carries every candidate when a field name exists on both halves of the complex', () => {
    const field1 = resolvePracticeSurface(graph, complexes, {
      venue: 'Maplewood',
      field: 'Field 1',
    });
    expect(field1.status).toBe(R.AMBIGUOUS);
    expect(field1.surfaceIds).toEqual([
      sid('Maplewood Back', 'Field 1'),
      sid('Maplewood Front', 'Field 1'),
    ]);
    // Field 2 exists on the back only, so it resolves; the sub-unit resolves Field 1.
    expect(
      resolvePracticeSurface(graph, complexes, { venue: 'Maplewood', field: 'Field 2' })
    ).toMatchObject({
      status: R.RESOLVED,
      surfaceIds: [sid('Maplewood Back', 'Field 2')],
    });
    expect(
      resolvePracticeSurface(graph, complexes, {
        venue: 'Maplewood',
        field: 'Field 1',
        subunit: 'A',
      })
    ).toMatchObject({ status: R.RESOLVED, surfaceIds: [pid('Maplewood Back', 'Field 1', 'A')] });
  });

  it('answers each kind of unknown by name rather than with an empty success', () => {
    expect(
      resolvePracticeSurface(graph, complexes, { venue: 'Nowhere Park', field: 'Field 1' }).status
    ).toBe(R.VENUE_UNKNOWN);
    expect(
      resolvePracticeSurface(graph, complexes, { venue: 'Larkfield Green', field: 'Field 2?' })
        .status
    ).toBe(R.SURFACE_UNKNOWN);
    expect(
      resolvePracticeSurface(graph, complexes, {
        venue: ALDER,
        field: 'Pitch 2A',
        subunit: 'Side 1',
      }).status
    ).toBe(R.SUBUNIT_UNKNOWN);
    expect(resolvePracticeSurface(graph, complexes, { venue: ALDER }).status).toBe(R.VENUE_ONLY);
    // The venue-half named as a field: no ring is consulted, so it is unknown ground.
    expect(
      resolvePracticeSurface(graph, complexes, { venue: 'Maplewood', field: 'Front', subunit: 'A' })
        .status
    ).toBe(R.SURFACE_UNKNOWN);
    expect(practiceSurfaceName('Field 1', 'A')).toBe('Field 1 A');
    expect(practiceSurfaceName('Field 1', null)).toBe('Field 1');
  });
});

/* -------------------------------------------------------------------------- */
/* The grid against the layer, both directions                                */
/* -------------------------------------------------------------------------- */

describe('practice layer :: the practice grid lands on declared ground', () => {
  const slots = practice.practiceSlots;
  const resolutions = slots.map((slot) => ({ slot, resolution: resolveSlot(slot) }));

  it('resolves every venue-resolved grid row uniquely, except the rows that name a venue half as a field', () => {
    expect(slots.length).toBe(457);
    const byStatus = new Map();
    for (const { slot, resolution } of resolutions) {
      const key = `${resolution.status}\u0000${slot.venue}\u0000${slot.field}\u0000${slot.subunit ?? ''}`;
      byStatus.set(key, (byStatus.get(key) ?? 0) + 1);
    }
    const unresolvedVenue = resolutions.filter((r) => r.slot.venue === UNRESOLVED_VENUE_TOKEN);
    expect(unresolvedVenue).toHaveLength(28);
    for (const { resolution } of unresolvedVenue) expect(resolution.status).toBe(R.VENUE_UNKNOWN);

    const resolved = resolutions.filter((r) => r.resolution.status === R.RESOLVED);
    const other = resolutions.filter(
      (r) => r.resolution.status !== R.RESOLVED && r.slot.venue !== UNRESOLVED_VENUE_TOKEN
    );
    // The only rows a structural read cannot place: `Maplewood / Front / A`.
    expect(other.map((r) => `${r.slot.venue}/${r.slot.field}/${r.slot.subunit}`)).toEqual(
      Array(4).fill('Maplewood/Front/A')
    );
    for (const { resolution } of other) expect(resolution.status).toBe(R.SURFACE_UNKNOWN);
    expect(resolved.length).toBe(457 - 28 - 4);
    expect(resolutions.some((r) => r.resolution.status === R.AMBIGUOUS)).toBe(false);
  });

  it('places every resolved row on a leaf, never on a parent that a sub-unit sits inside', () => {
    let examined = 0;
    for (const { resolution } of resolutions) {
      if (resolution.status !== R.RESOLVED) continue;
      examined += 1;
      const [id] = resolution.surfaceIds;
      expect(graph.surfaces[id].childIds, id).toEqual([]);
    }
    expect(examined).toBeGreaterThan(400);
  });

  it('uses every declared node somewhere: a grid row or a ring row resolves to it', () => {
    const usedByGrid = new Set(
      resolutions
        .filter((r) => r.resolution.status === R.RESOLVED)
        .flatMap((r) => r.resolution.surfaceIds)
    );
    const ringGround = new Set(
      practice.fieldAliases
        .filter((alias) => alias.venue !== null && alias.field !== null)
        .map((alias) => resolvePracticeSurface(graph, complexes, alias))
        .filter((res) => res.status === R.RESOLVED)
        .flatMap((res) => res.surfaceIds)
    );
    const codeNameGround = new Set(
      practice.fieldCodeNames
        .map((row) =>
          resolvePracticeSurface(graph, complexes, { venue: row.venue, field: row.remainder })
        )
        .filter((res) => res.status === R.RESOLVED)
        .flatMap((res) => res.surfaceIds)
    );
    const usedDirectly = (id) => usedByGrid.has(id) || ringGround.has(id) || codeNameGround.has(id);
    const usedThroughChildren = [];
    for (const node of SEASON_2026_PRACTICE_LAYER.surfaces) {
      const id = pid(node.venue, node.field, node.subunit);
      if (usedDirectly(id)) continue;
      // A parent whose children are used is used through them.
      const children = graph.surfaces[id].childIds;
      expect(
        children.length,
        `${id} is declared and nothing in the corpus uses it`
      ).toBeGreaterThan(0);
      expect(children.some(usedDirectly), `${id}: no child is used either`).toBe(true);
      usedThroughChildren.push(id);
    }
    expect(usedByGrid.size).toBeGreaterThan(20);
    expect(ringGround.size).toBeGreaterThan(0);
    expect(codeNameGround.size).toBeGreaterThan(0);
    // Brookside's Lower is booked only by halves; Rookery's turf only through
    // the practice ring's 2A/2B. Both are named so a third cannot slip in.
    expect(usedThroughChildren).toEqual([
      pid('Brookside Park', 'Lower'),
      pid('Rookery Park', 'Turf Field 2'),
    ]);
  });

  it('reports a practice on unresolved ground instead of dropping it', () => {
    const front = slots.find((slot) => slot.venue === 'Maplewood' && slot.field === 'Front');
    expect(front).toBeDefined();
    expect(resolveSlot(front).surfaceIds).toEqual([]);
    // What a name-keyed producer would mint for it is not a surface the graph holds.
    const minted = `${front.venue}/${front.field}/${front.subunit}`;
    const scan = findFacilityConflicts(graph, [
      booking(front.id, minted, '2026-09-15', front.startMinutes, front.endMinutes),
    ]);
    expect(scan.unknownSurface).toHaveLength(1);
    expect(scan.unknownSurface[0].code).toBe(FACILITY_REASON.SURFACE_UNKNOWN);
  });
});

/* -------------------------------------------------------------------------- */
/* The extension refuses malformed layers                                     */
/* -------------------------------------------------------------------------- */

describe('practice layer :: the extension refuses a layer that re-declares or dangles', () => {
  const base = () => toSeason2026FacilityGraphInput(geometry);
  const node = (overrides) => ({
    venue: ALDER,
    field: 'Pitch 2A',
    subunit: null,
    parent: 'Pitch 2',
    sources: [],
    ...overrides,
  });

  it('rejects a venue the game layer already has', () => {
    expect(() =>
      extendFacilityGraphInputWithSeason2026PracticeLayer(base(), {
        venues: [{ name: ALDER, lit: null, notes: null, sources: [] }],
        surfaces: [],
      })
    ).toThrow(/already in the game layer/);
  });

  it('rejects a surface at a venue neither layer declares', () => {
    expect(() =>
      extendFacilityGraphInputWithSeason2026PracticeLayer(base(), {
        venues: [],
        surfaces: [node({ venue: 'Nowhere Park', parent: null })],
      })
    ).toThrow(/names a venue neither layer declares/);
  });

  it('rejects a sub-unit that also names a parent: its parent is its field', () => {
    expect(() =>
      extendFacilityGraphInputWithSeason2026PracticeLayer(base(), {
        venues: [],
        surfaces: [node({ subunit: 'Side 1', parent: 'Pitch 9' })],
      })
    ).toThrow(/a sub-unit's parent is its field/);
    expect(() =>
      extendFacilityGraphInputWithSeason2026PracticeLayer(base(), {
        venues: [],
        surfaces: [node({ subunit: 'Side 1', parent: 'Pitch 2' })],
      })
    ).toThrow(/a sub-unit's parent is its field/);
  });

  it('rejects a parent no layer declares, and a sub-unit of an unknown field', () => {
    expect(() =>
      extendFacilityGraphInputWithSeason2026PracticeLayer(base(), {
        venues: [],
        surfaces: [node({ parent: 'Pitch 9' })],
      })
    ).toThrow(/names parent "Pitch 9"/);
    expect(() =>
      extendFacilityGraphInputWithSeason2026PracticeLayer(base(), {
        venues: [],
        surfaces: [node({ field: 'Pitch 9', subunit: 'Side 1', parent: null })],
      })
    ).toThrow(/names parent "Pitch 9"/);
  });

  it('rejects a surface declared twice, and one the game layer already holds', () => {
    expect(() =>
      extendFacilityGraphInputWithSeason2026PracticeLayer(base(), {
        venues: [],
        surfaces: [node(), node()],
      })
    ).toThrow(/declared twice/);
    expect(() =>
      extendFacilityGraphInputWithSeason2026PracticeLayer(base(), {
        venues: [],
        surfaces: [node({ field: 'Pitch 1A', parent: 'Pitch 1' })],
      })
    ).toThrow(/declared twice/);
  });

  it('does not mutate the game-layer input it composes over', () => {
    const input = base();
    const before = JSON.stringify(input);
    extendFacilityGraphInputWithSeason2026PracticeLayer(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.isFrozen(SEASON_2026_PRACTICE_LAYER)).toBe(true);
    expect(Object.isFrozen(SEASON_2026_PRACTICE_LAYER.surfaces[0].sources)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Lighting that nothing states                                               */
/* -------------------------------------------------------------------------- */

describe('practice layer :: lighting nobody has stated is reported, not read as unlit', () => {
  const table = buildFormatTimingTableFromSeason2026(loadGameFormats());
  const sunsets = loadSunsets();
  const calendar = buildAvailabilityCalendarFromSeason2026(
    loadFacilityPermits({ seasonYear: Number(sunsets[0].date.slice(0, 4)) }),
    sunsets
  );
  const cedarbrook = sid('Cedarbrook Park', 'Field 1');
  const query = (surfaceId) => ({
    surfaceId,
    date: sunsets[0].date,
    kickoffMinutes: 16 * 60,
    format: '7v7',
  });

  it('resolves a practice-only venue to null lighting from the venue, and says so', () => {
    const resolved = resolveLighting(graph, calendar, cedarbrook);
    expect(resolved).toMatchObject({ lit: null, source: 'venue', lightsOffMinutes: null });
    const result = checkKickoffAvailability(graph, table, calendar, query(cedarbrook));
    const codes = result.findings.map((f) => f.code);
    expect(codes).toContain(AVAILABILITY_REASON.LIGHTING_FROM_VENUE);
    expect(codes).toContain(AVAILABILITY_REASON.LIGHTING_UNDECLARED);
    expect(codes).not.toContain(AVAILABILITY_REASON.SUNSET_NOT_BINDING_WHEN_LIT);
    expect(result.lit).toBeNull();
    expect(result.status).not.toBe(AVAILABILITY_STATUS.ALLOWED);
    expect(
      result.findings.find((f) => f.code === AVAILABILITY_REASON.LIGHTING_UNDECLARED).severity
    ).toBe(AVAILABILITY_SEVERITY.COMPROMISE);
    // The sunset rule still carries the ground, conservatively.
    const sunset = result.constraints.find((c) => c.kind === AVAILABILITY_CONSTRAINT.SUNSET);
    expect(sunset.applicable).toBe(true);
    expect(result.meta.lightingRecordsConsulted).toBeGreaterThan(0);
  });

  it('stops reporting the gap the moment a venue states its lighting (positive control)', () => {
    for (const lit of [false, true]) {
      const stated = buildSeason2026PracticeFacilityGraph(geometry, {
        layer: {
          venues: SEASON_2026_PRACTICE_LAYER.venues.map((venue) =>
            venue.name === 'Cedarbrook Park' ? { ...venue, lit } : venue
          ),
          surfaces: SEASON_2026_PRACTICE_LAYER.surfaces,
        },
      });
      const result = checkKickoffAvailability(stated, table, calendar, query(cedarbrook));
      const codes = result.findings.map((f) => f.code);
      expect(codes).not.toContain(AVAILABILITY_REASON.LIGHTING_UNDECLARED);
      expect(result.lit).toBe(lit);
      expect(codes.includes(AVAILABILITY_REASON.SUNSET_NOT_BINDING_WHEN_LIT)).toBe(lit);
    }
    // ... and a game-corpus venue, whose flag is stated, never raises it.
    const alder = checkKickoffAvailability(graph, table, calendar, query(sid(ALDER, 'Pitch 2')));
    expect(alder.findings.map((f) => f.code)).not.toContain(
      AVAILABILITY_REASON.LIGHTING_UNDECLARED
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The composed graph, seen by the modules that consume graphs                 */
/* -------------------------------------------------------------------------- */

describe('practice layer :: making Pitch 2 and Pitch 3 parents takes nothing from relocation', () => {
  const formats = ['11v11', '9v9', '7v7', '5v5', '4v4'];

  it('offers the same replacement ground on the composed graph as on the game graph', () => {
    let compared = 0;
    for (const format of formats) {
      const before = replacementSurfacesFor(gameGraph, { format, maxGradesAbove: 1 });
      const after = replacementSurfacesFor(graph, { format, maxGradesAbove: 1 });
      expect(after, format).toEqual(before);
      compared += before.length;
    }
    expect(compared).toBeGreaterThan(20);
    // The two 11v11 pitches that became parents are still offered whole.
    const eleven = replacementSurfacesFor(graph, { format: '11v11', maxGradesAbove: 1 });
    expect(eleven).toContain(sid(ALDER, 'Pitch 2'));
    expect(eleven).toContain(sid(ALDER, 'Pitch 3'));
    // ... and their halves, which state no size, are not.
    expect(eleven).not.toContain(pid(ALDER, 'Pitch 2A'));
    expect(graph.surfaces[pid(ALDER, 'Pitch 2A')].sizes).toEqual([]);
  });

  it('still drops a parent that states no size of its own (positive control)', () => {
    // Strip Pitch 2's sizes: a parent with children and nothing to rank.
    const input = extendFacilityGraphInputWithSeason2026PracticeLayer(
      toSeason2026FacilityGraphInput(geometry)
    );
    const pitch2 = sid(ALDER, 'Pitch 2');
    const sizeless = buildFacilityGraph({
      ...input,
      surfaces: input.surfaces.map((s) => (s.id === pitch2 ? { ...s, sizes: [], lined: [] } : s)),
    });
    expect(sizeless.surfaces[pitch2].childIds.length).toBeGreaterThan(0);
    expect(replacementSurfacesFor(sizeless, { format: '11v11', maxGradesAbove: 1 })).not.toContain(
      pitch2
    );
    expect(replacementSurfacesFor(graph, { format: '11v11', maxGradesAbove: 1 })).toContain(pitch2);
  });
});

describe('practice layer :: the sunset rule claims LIGHTING_UNDECLARED, so the engine keeps it', () => {
  const table = buildFormatTimingTableFromSeason2026(loadGameFormats());
  const sunsets = loadSunsets();
  const calendar = buildAvailabilityCalendarFromSeason2026(
    loadFacilityPermits({ seasonYear: Number(sunsets[0].date.slice(0, 4)) }),
    sunsets
  );
  const registry = buildSeason2026ConstraintRegistry();
  const base = toSeason2026Schedule(season);
  const cedarbrook = sid('Cedarbrook Park', 'Field 1');
  // One published game moved onto ground nobody has declared lit or unlit.
  const moved = base.games[0];
  const schedule = {
    ...base,
    name: 'season-2026 with one game on undeclared-lighting ground',
    games: base.games.map((game) => (game === moved ? { ...game, surfaceId: cedarbrook } : game)),
    surfaceUniverse: [...new Set([...base.surfaceUniverse, cedarbrook])].sort(),
    venueUniverse: [
      ...new Set([...base.venueUniverse, season2026VenueId('Cedarbrook Park')]),
    ].sort(),
  };
  const resources = { graph, timingTable: table, calendar, venueComplexes: complexes };
  const run = runRuleEngine(schedule, { registry, resources });
  const sunset = run.byRuleId[RULE_ID.SUNSET_MARGIN];

  it('reports the undeclared lighting on the moved game in the rule-engine report', () => {
    expect(sunset.ran).toBe(true);
    expect(sunset.exercise.counters.lightingUndeclaredGamesExamined).toBe(1);
    expect(
      sunset.exercise.counters.unlitGamesExamined + sunset.exercise.counters.litGamesExamined
    ).toBe(schedule.games.length - 1);
    const mine = sunset.subjects.filter((subject) =>
      subject.findings.some((f) => f.code === AVAILABILITY_REASON.LIGHTING_UNDECLARED)
    );
    expect(mine).toHaveLength(1);
    expect(JSON.stringify(mine[0].context ?? mine[0])).toContain(moved.id);
  });

  it('would lose the finding without the claim: unclaimed codes from the same check are gone', () => {
    // checkKickoffAvailability() emits LIGHTING_FROM_VENUE for every game;
    // the rule does not claim it, so the engine discards it. The claim is
    // what keeps LIGHTING_UNDECLARED, and the test above would fail if the
    // claim were removed from SUNSET_CODES.
    const kept = new Set(sunset.subjects.flatMap((s) => s.findings.map((f) => f.code)));
    expect(kept.has(AVAILABILITY_REASON.LIGHTING_UNDECLARED)).toBe(true);
    expect(kept.has(AVAILABILITY_REASON.LIGHTING_FROM_VENUE)).toBe(false);
    // ... and on the unmodified schedule, over the game graph, it never fires.
    const clean = runRuleEngine(base, {
      registry,
      resources: { ...resources, graph: gameGraph },
    }).byRuleId[RULE_ID.SUNSET_MARGIN];
    expect(clean.exercise.counters.lightingUndeclaredGamesExamined).toBe(0);
    expect(
      clean.subjects.some((s) =>
        s.findings.some((f) => f.code === AVAILABILITY_REASON.LIGHTING_UNDECLARED)
      )
    ).toBe(false);
  });
});
