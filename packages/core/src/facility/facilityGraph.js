/**
 * The facility graph: venues, surfaces, and the two relations that describe
 * physical reality.
 *
 * **Containment** is directed (parent -> child) and forms a forest. Alder Pitch
 * 1 is *either* one full pitch *or* the two 9v9 halves 1A/1B, never both at
 * once, so a parent is mutually exclusive in time with every descendant.
 *
 * **Overlap** is undirected and declared as pairs. It is a statement about two
 * *distinct* patches of ground intersecting - Alder {1,2} and {3,4} may never
 * run concurrently, while {1,3}, {2,4}, {2,3} and {1,4} are fine.
 *
 * The two are never conflated, and neither is transitively closed. 1A is inside
 * Pitch 1 and 1B is inside Pitch 1, yet the corpus runs 1A and 1B concurrently
 * on essentially every rec Saturday; a transitive closure would declare dozens
 * of published games illegal. Physically, overlap is intersection of ground
 * regions, and intersection is not transitive.
 *
 * The graph holds **no booking state**. Callers pass their own bookings to
 * every check.
 *
 * @module facility/facilityGraph
 */

import { FacilityGraphInputSchema } from './schemas.js';

/**
 * A zeroed counter block. Every result in this module carries one so a test can
 * prove the check was not vacuous (incident 4).
 *
 * Plumbing, not API: deliberately not re-exported from the barrel.
 *
 * @returns {import('./types.js').FacilityMeta}
 */
export function createMeta() {
  return {
    surfacesConsidered: 0,
    cellPairsCompared: 0,
    overlapPairsConsulted: 0,
    equipmentWindowsConsulted: 0,
    bookingPairsCompared: 0,
    // Lifecycle counters.
    //
    // **`datedNodeCount` starts at `null`, not 0.** TEN call sites build a meta
    // -- eligibility x5, occupancy x4, lifecycle x1 -- and only the lifecycle
    // one ever counts; a literal 0 on the other nine reads as "I counted and
    // found none" when nothing counted at all.
    //
    // (I said nine. That is the third enumeration in this PR miscounted by one,
    // after "four writers of fields.active" which was five, and "11 view
    // columns" which was 12. The counts are now taken from the code --
    // `grep -c 'createMeta()'` returns 11, one of which is this definition --
    // rather than from reading down a list, which is how all three went wrong.)
    // That is the exact shape the ruling to publish the count was written
    // against, so `null` means *not counted* and a number means somebody did.
    // `checkFacilityLifecycle()` still publishes 0 when the graph really has
    // none, which is what the ruling asked for.
    datedNodeCount: null,
    lifecycleNodesJudged: 0,
  };
}

/**
 * Add `source`'s counters into `target` in place.
 *
 * @param {import('./types.js').FacilityMeta} target
 * @param {import('./types.js').FacilityMeta} source
 * @returns {import('./types.js').FacilityMeta} `target`
 */
export function mergeMeta(target, source) {
  target.surfacesConsidered += source.surfacesConsidered;
  target.cellPairsCompared += source.cellPairsCompared;
  target.overlapPairsConsulted += source.overlapPairsConsulted;
  target.equipmentWindowsConsulted += source.equipmentWindowsConsulted;
  target.bookingPairsCompared += source.bookingPairsCompared;
  // **Not summed.** `datedNodeCount` is a property of the graph, not of the
  // work done, so adding two sub-checks' copies would report twice the estate.
  // A `null` on either side means that side did not count, and a real count
  // from the other side wins; two nulls stay null.
  if (source.datedNodeCount !== null) {
    target.datedNodeCount =
      target.datedNodeCount === null
        ? source.datedNodeCount
        : Math.max(target.datedNodeCount, source.datedNodeCount);
  }
  target.lifecycleNodesJudged += source.lifecycleNodesJudged;
  return target;
}

/**
 * Recursively freeze a value. The graph is immutable so that no consumer can
 * turn it into hidden shared state.
 *
 * Exported for `venueComplex.js`, which is immutable for the same reason and
 * must not carry a second copy. Plumbing, not API: deliberately not re-exported
 * from the barrel, exactly like {@link createMeta}.
 *
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const inner of Object.values(value)) deepFreeze(inner);
  return value;
}

/**
 * Canonical ordering for an unordered pair of ids.
 *
 * @param {string} a
 * @param {string} b
 * @returns {[string, string]}
 */
function canonicalPair(a, b) {
  return a <= b ? [a, b] : [b, a];
}

/**
 * An effective window that ends before it starts is a structural defect.
 *
 * **Throws rather than repairing**, exactly as every other defect in this
 * builder does: a node whose window is inverted is live on no date at all, and
 * a graph that quietly answers "this ground does not exist" for every query is
 * the shape incident 3 was.
 *
 * Dates are compared as strings, which is correct for `YYYY-MM-DD` and is why
 * the schema pins that format. No `Date` is constructed anywhere in this
 * package.
 *
 * @param {string} kind - `venue` or `surface`, for the message
 * @param {string} id
 * @param {string|null} from
 * @param {string|null} to
 * @returns {void}
 */
function assertOrderedWindow(kind, id, from, to) {
  if (from !== null && to !== null && to < from) {
    throw new Error(
      `facility: ${kind} "${id}" is effective from ${from} to ${to}, which ends before it starts`
    );
  }
}

/**
 * Build an immutable facility graph from plain data.
 *
 * The builder **throws** on every structural defect rather than repairing it.
 * A malformed graph that quietly answers "no conflict" is the failure mode this
 * whole module exists to prevent (incident 3: fields modelled as independent
 * strings for several schedule versions).
 *
 * Rejected inputs: duplicate surface id, unknown `venueId`, unknown `parentId`
 * or `childIds` entry, a parent/child edge the two ends disagree about, a
 * containment cycle, containment spanning two venues, an overlap pair naming an
 * unknown surface, an overlap pair spanning two venues, a surface declared to
 * overlap itself, and an equipment window scoped to something that does not
 * exist.
 *
 * @param {import('./types.js').FacilityGraphInput} input
 * @returns {import('./types.js').FacilityGraph}
 */
export function buildFacilityGraph(input) {
  const parsed = FacilityGraphInputSchema.parse(input);

  /** @type {Record<string, import('./types.js').FacilityVenue>} */
  const venues = {};
  for (const venue of parsed.venues) {
    if (venues[venue.id]) throw new Error(`facility: duplicate venue id "${venue.id}"`);
    venues[venue.id] = {
      id: venue.id,
      name: venue.name,
      lit: venue.lit,
      notes: venue.notes,
      // Orchard Park's "20-min turnover is HARD here" and Alder's overlap prose
      // ride along untouched. Acting on them belongs to Phase 2.
      overlapNote: venue.overlapNote,
      effectiveFrom: venue.effectiveFrom,
      effectiveTo: venue.effectiveTo,
    };
    assertOrderedWindow('venue', venue.id, venue.effectiveFrom, venue.effectiveTo);
  }

  /** @type {Record<string, import('./types.js').FacilitySurface>} */
  const surfaces = {};
  for (const surface of parsed.surfaces) {
    if (surfaces[surface.id]) throw new Error(`facility: duplicate surface id "${surface.id}"`);
    if (!venues[surface.venueId]) {
      throw new Error(`facility: surface "${surface.id}" names unknown venue "${surface.venueId}"`);
    }
    surfaces[surface.id] = {
      id: surface.id,
      venueId: surface.venueId,
      name: surface.name,
      sizes: [...surface.sizes],
      lined: [...surface.lined],
      parentId: surface.parentId,
      childIds: [...surface.childIds],
      bookable: surface.bookable,
      note: surface.note,
      cells: [],
      lineage: [],
      depth: 0,
      effectiveFrom: surface.effectiveFrom,
      effectiveTo: surface.effectiveTo,
    };
    assertOrderedWindow('surface', surface.id, surface.effectiveFrom, surface.effectiveTo);
  }

  const surfaceIds = Object.keys(surfaces);

  /* -- containment integrity ---------------------------------------------- */
  let containmentEdgeCount = 0;
  for (const surface of Object.values(surfaces)) {
    if (surface.parentId !== null) {
      const parent = surfaces[surface.parentId];
      if (!parent) {
        throw new Error(
          `facility: surface "${surface.id}" names unknown parent "${surface.parentId}"`
        );
      }
      if (parent.venueId !== surface.venueId) {
        throw new Error(
          `facility: containment crosses venues - "${surface.id}" (${surface.venueId}) is a child of "${parent.id}" (${parent.venueId})`
        );
      }
      if (!parent.childIds.includes(surface.id)) {
        throw new Error(
          `facility: containment disagreement - "${surface.id}" claims parent "${parent.id}", which does not list it as a child`
        );
      }
    }
    for (const childId of surface.childIds) {
      const child = surfaces[childId];
      if (!child) {
        throw new Error(`facility: surface "${surface.id}" names unknown child "${childId}"`);
      }
      if (child.parentId !== surface.id) {
        throw new Error(
          `facility: containment disagreement - "${surface.id}" lists child "${childId}", which claims parent "${child.parentId}"`
        );
      }
      containmentEdgeCount += 1;
    }
  }

  /* -- lineage (self + ancestors), with cycle detection -------------------- */
  for (const surface of Object.values(surfaces)) {
    /** @type {string[]} */
    const lineage = [];
    const seen = new Set();
    /** @type {import('./types.js').FacilitySurface|undefined} */
    let cursor = surface;
    while (cursor) {
      if (seen.has(cursor.id)) {
        throw new Error(
          `facility: containment cycle through "${cursor.id}" (from "${surface.id}")`
        );
      }
      seen.add(cursor.id);
      lineage.push(cursor.id);
      cursor = cursor.parentId === null ? undefined : surfaces[cursor.parentId];
    }
    surface.lineage = lineage;
    surface.depth = lineage.length - 1;
  }

  /* -- cells (atomic leaves) ---------------------------------------------- */
  // Walking down terminates because the lineage pass above already proved the
  // containment relation is acyclic.
  for (const surface of Object.values(surfaces)) {
    /** @type {string[]} */
    const cells = [];
    /** @type {string[]} */
    const stack = [surface.id];
    while (stack.length > 0) {
      const current = surfaces[/** @type {string} */ (stack.pop())];
      if (current.childIds.length === 0) cells.push(current.id);
      else stack.push(...current.childIds);
    }
    surface.cells = cells.sort();
  }

  /* -- overlap ------------------------------------------------------------ */
  /** @type {Map<string, [string, string]>} */
  const overlapByKey = new Map();
  for (const [rawA, rawB] of parsed.overlapPairs) {
    const a = surfaces[rawA];
    const b = surfaces[rawB];
    if (!a) throw new Error(`facility: overlap pair names unknown surface "${rawA}"`);
    if (!b) throw new Error(`facility: overlap pair names unknown surface "${rawB}"`);
    if (rawA === rawB) {
      throw new Error(`facility: surface "${rawA}" cannot be declared to overlap itself`);
    }
    if (a.venueId !== b.venueId) {
      throw new Error(
        `facility: overlap pair spans two venues - "${rawA}" (${a.venueId}) and "${rawB}" (${b.venueId})`
      );
    }
    const pair = canonicalPair(rawA, rawB);
    overlapByKey.set(`${pair[0]}\u0000${pair[1]}`, pair);
  }
  const overlapPairs = [...overlapByKey.values()].sort((left, right) =>
    left[0] === right[0] ? left[1].localeCompare(right[1]) : left[0].localeCompare(right[0])
  );

  /** @type {Record<string, string[]>} */
  const overlapBySurface = {};
  for (const id of surfaceIds) overlapBySurface[id] = [];
  for (const [a, b] of overlapPairs) {
    overlapBySurface[a].push(b);
    overlapBySurface[b].push(a);
  }
  for (const id of surfaceIds) overlapBySurface[id].sort();

  /** @type {Record<string, string[]>} */
  const formatEquipment = {};
  for (const [format, items] of Object.entries(parsed.formatEquipment)) {
    formatEquipment[format] = [...items];
  }

  const equipmentWindows = parsed.equipmentWindows.map((window) => ({
    ...window,
    scope: { ...window.scope },
  }));
  for (const window of equipmentWindows) {
    const target =
      window.scope.kind === 'venue' ? venues[window.scope.id] : surfaces[window.scope.id];
    if (!target) {
      throw new Error(
        `facility: equipment window "${window.id}" scopes to unknown ${window.scope.kind} "${window.scope.id}"`
      );
    }
  }

  const graph = {
    venues,
    venueIds: Object.keys(venues).sort(),
    surfaces,
    surfaceIds: [...surfaceIds].sort(),
    overlapPairs,
    overlapBySurface,
    equipmentWindows,
    formatEquipment,
    sizeRank: parsed.sizeRank ? { ...parsed.sizeRank } : null,
    sizePolicy: parsed.sizePolicy ?? 'downward-closed',
    stats: {
      venueCount: Object.keys(venues).length,
      surfaceCount: surfaceIds.length,
      bookableSurfaceCount: surfaceIds.filter((id) => surfaces[id].bookable).length,
      containmentEdgeCount,
      overlapPairCount: overlapPairs.length,
      equipmentWindowCount: equipmentWindows.length,
      formatEquipmentCount: Object.keys(formatEquipment).length,
      /**
       * **How many nodes carry an effective window at all.**
       *
       * Published even when it is zero, which is the whole point: a lifecycle
       * report reading `datedNodeCount: 0` says the universe was empty, where
       * a silent absence would read as "checked and clean". On today's corpus
       * it *is* zero -- nothing in `season-2026` is dated -- so
       * `FACILITY_LIFECYCLE_UNJUDGED` cannot fire on real data and the only
       * exercise is a constructed graph. Saying so here is what stops the
       * finding's silence being mistaken for evidence.
       */
      datedNodeCount:
        Object.keys(venues).filter(
          (id) => venues[id].effectiveFrom !== null || venues[id].effectiveTo !== null
        ).length +
        surfaceIds.filter(
          (id) => surfaces[id].effectiveFrom !== null || surfaces[id].effectiveTo !== null
        ).length,
    },
  };

  return deepFreeze(/** @type {import('./types.js').FacilityGraph} */ (graph));
}

/**
 * Look a surface up, or `null`.
 *
 * @param {import('./types.js').FacilityGraph} graph
 * @param {string} surfaceId
 * @returns {import('./types.js').FacilitySurface|null}
 */
export function getSurface(graph, surfaceId) {
  return graph.surfaces[surfaceId] ?? null;
}

/**
 * Look a surface up, or throw. Use where a missing surface is a programming
 * error rather than user input.
 *
 * @param {import('./types.js').FacilityGraph} graph
 * @param {string} surfaceId
 * @returns {import('./types.js').FacilitySurface}
 */
export function requireSurface(graph, surfaceId) {
  const surface = graph.surfaces[surfaceId];
  if (!surface) throw new Error(`facility: unknown surface "${surfaceId}"`);
  return surface;
}

/**
 * Find a surface by its human names. Ids are opaque, so this is the supported
 * way to get from "Alder Park" + "Pitch 1A" to a surface without parsing an id.
 *
 * @param {import('./types.js').FacilityGraph} graph
 * @param {string} venueName
 * @param {string} surfaceName
 * @returns {import('./types.js').FacilitySurface|null}
 */
export function findSurfaceByName(graph, venueName, surfaceName) {
  const venueId = graph.venueIds.find((id) => graph.venues[id].name === venueName);
  if (!venueId) return null;
  const found = graph.surfaceIds.find(
    (id) => graph.surfaces[id].venueId === venueId && graph.surfaces[id].name === surfaceName
  );
  return found ? graph.surfaces[found] : null;
}

/**
 * The atomic leaves under a surface: itself when it is a leaf, otherwise the
 * union of its children's cells.
 *
 * @param {import('./types.js').FacilityGraph} graph
 * @param {string} surfaceId
 * @returns {string[]}
 */
export function cellsOf(graph, surfaceId) {
  return requireSurface(graph, surfaceId).cells;
}

/**
 * The surface itself plus every ancestor, nearest first.
 *
 * @param {import('./types.js').FacilityGraph} graph
 * @param {string} surfaceId
 * @returns {string[]}
 */
export function lineageOf(graph, surfaceId) {
  return requireSurface(graph, surfaceId).lineage;
}

/**
 * Every surface strictly below this one (children, grandchildren, ...), sorted.
 *
 * @param {import('./types.js').FacilityGraph} graph
 * @param {string} surfaceId
 * @returns {string[]}
 */
export function descendantsOf(graph, surfaceId) {
  const root = requireSurface(graph, surfaceId);
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const stack = [...root.childIds];
  while (stack.length > 0) {
    const current = requireSurface(graph, /** @type {string} */ (stack.pop()));
    out.push(current.id);
    stack.push(...current.childIds);
  }
  return out.sort();
}
