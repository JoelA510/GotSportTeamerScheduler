/**
 * Occupancy: which surfaces a booking actually consumes, whether two bookings
 * can coexist, and a batch scan over a whole schedule.
 *
 * The conflict relation is
 *
 * ```text
 * cells(S)   = S has no children ? {S} : union of cells(child)
 * lineage(S) = {S} union lineage(parent(S))
 *
 * conflict(A,B) <=> venue(A) === venue(B)
 *                   AND ( cells(A) intersects cells(B)
 *                         OR there is a declared pair {P,Q} with
 *                              (P in lineage(A) AND Q in lineage(B))
 *                           OR (Q in lineage(A) AND P in lineage(B)) )
 * ```
 *
 * The overlap clause is **bipartite** - one endpoint from each side. That is
 * precisely why the obvious "flatten each booking into an occupied set and
 * intersect" design is wrong and must not be reintroduced: the occupied set of
 * 1A and the occupied set of 1B would both contain Pitch 1, so the two halves
 * would collide with each other. They do not; the corpus runs them
 * concurrently on essentially every rec Saturday.
 *
 * @module facility/occupancy
 */

import { createMeta, getSurface, mergeMeta, requireSurface } from './facilityGraph.js';
import { FACILITY_REASON, makeFinding } from './reasonCodes.js';
import { FacilityBookingSchema } from './schemas.js';

/**
 * Everything a booking on this surface consumes.
 *
 * `blockedSurfaceIds` is derived from the conflict relation, not from a
 * flattened set, so it correctly contains Pitch 1 for a booking on 1A while
 * still excluding 1B.
 *
 * @param {import('./types.js').FacilityGraph} graph
 * @param {string} surfaceId
 * @returns {{ surfaceId: string, venueId: string, cells: string[], lineage: string[], blockedSurfaceIds: string[], meta: import('./types.js').FacilityMeta }}
 */
export function occupancyFootprint(graph, surfaceId) {
  const surface = requireSurface(graph, surfaceId);
  const meta = createMeta();
  const blockedSurfaceIds = [];
  for (const otherId of graph.surfaceIds) {
    if (graph.surfaces[otherId].venueId !== surface.venueId) continue;
    const verdict = surfacesConflict(graph, surfaceId, otherId);
    mergeMeta(meta, verdict.meta);
    if (verdict.conflict) blockedSurfaceIds.push(otherId);
  }
  return {
    surfaceId,
    venueId: surface.venueId,
    cells: [...surface.cells],
    lineage: [...surface.lineage],
    blockedSurfaceIds,
    meta,
  };
}

/**
 * Can these two surfaces host concurrent games?
 *
 * Returns the reason code as well as the boolean, because "1A clashes with
 * Pitch 2" and "1A clashes with Pitch 1" are different facts an operator needs
 * told apart.
 *
 * @param {import('./types.js').FacilityGraph} graph
 * @param {string} surfaceAId
 * @param {string} surfaceBId
 * @returns {{ conflict: boolean, code: string|null, meta: import('./types.js').FacilityMeta }}
 */
export function surfacesConflict(graph, surfaceAId, surfaceBId) {
  const a = requireSurface(graph, surfaceAId);
  const b = requireSurface(graph, surfaceBId);
  const meta = createMeta();
  meta.surfacesConsidered = surfaceAId === surfaceBId ? 1 : 2;

  // Different sites never share ground. Short-circuit before any set work.
  if (a.venueId !== b.venueId) return { conflict: false, code: null, meta };

  if (surfaceAId === surfaceBId) {
    meta.cellPairsCompared = a.cells.length;
    return { conflict: true, code: FACILITY_REASON.OCCUPIED_SAME_SURFACE, meta };
  }

  const cellsB = new Set(b.cells);
  meta.cellPairsCompared = a.cells.length * b.cells.length;
  if (a.cells.some((cell) => cellsB.has(cell))) {
    // In a containment forest a shared cell means one surface contains the
    // other: a full pitch and one of its own halves.
    return { conflict: true, code: FACILITY_REASON.OCCUPIED_PARENT_CHILD, meta };
  }

  const lineageA = new Set(a.lineage);
  const lineageB = new Set(b.lineage);
  let matched = false;
  for (const [p, q] of graph.overlapPairs) {
    if (graph.surfaces[p].venueId !== a.venueId) continue;
    meta.overlapPairsConsulted += 1;
    if ((lineageA.has(p) && lineageB.has(q)) || (lineageA.has(q) && lineageB.has(p))) {
      matched = true;
    }
  }
  return matched
    ? { conflict: true, code: FACILITY_REASON.OCCUPIED_SPATIAL_OVERLAP, meta }
    : { conflict: false, code: null, meta };
}

/**
 * Every surface that cannot host a concurrent game with this one, itself
 * included.
 *
 * @param {import('./types.js').FacilityGraph} graph
 * @param {string} surfaceId
 * @returns {string[]}
 */
export function conflictingSurfacesOf(graph, surfaceId) {
  return occupancyFootprint(graph, surfaceId).blockedSurfaceIds;
}

/**
 * Do two bookings overlap in time?
 *
 * Returns **`null`**, not `false`, when either footprint is unknown. The
 * corpus's four `Scrimmage` rows have no `game_formats.csv` entry (GAP-14), and
 * answering `false` for them would be a fabricated all-clear. Callers must turn
 * a `null` into `OCCUPANCY_FOOTPRINT_UNKNOWN`.
 *
 * @param {import('./types.js').FacilityBooking} a
 * @param {import('./types.js').FacilityBooking} b
 * @returns {boolean|null}
 */
export function bookingsOverlapInTime(a, b) {
  if (a.date !== b.date) return false;
  if (a.endMinutes === null || a.endMinutes === undefined) return null;
  if (b.endMinutes === null || b.endMinutes === undefined) return null;
  return a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes;
}

/**
 * Normalise a booking through the schema.
 *
 * @param {import('./types.js').FacilityBooking} booking
 * @returns {import('./types.js').FacilityBooking}
 */
function parseBooking(booking) {
  return /** @type {import('./types.js').FacilityBooking} */ (FacilityBookingSchema.parse(booking));
}

/**
 * One finding describing a clash between two bookings.
 *
 * @param {import('./types.js').FacilityGraph} graph
 * @param {string} code
 * @param {import('./types.js').FacilityBooking} a
 * @param {import('./types.js').FacilityBooking} b
 * @returns {import('./types.js').FacilityFinding}
 */
function pairFinding(graph, code, a, b) {
  const surfaceA = getSurface(graph, a.surfaceId);
  const surfaceB = getSurface(graph, b.surfaceId);
  return makeFinding(
    code,
    `${a.label ?? a.id} on ${surfaceA?.name ?? a.surfaceId} clashes with ${b.label ?? b.id} on ${surfaceB?.name ?? b.surfaceId} on ${a.date}`,
    {
      bookingAId: a.id,
      bookingBId: b.id,
      surfaceAId: a.surfaceId,
      surfaceBId: b.surfaceId,
      surfaceAName: surfaceA?.name ?? null,
      surfaceBName: surfaceB?.name ?? null,
      venueId: surfaceA?.venueId ?? null,
      date: a.date,
      startAMinutes: a.startMinutes,
      endAMinutes: a.endMinutes,
      startBMinutes: b.startMinutes,
      endBMinutes: b.endMinutes,
    }
  );
}

/**
 * Scan a whole schedule for facility clashes.
 *
 * Reports **every** conflicting pair. It deliberately does not `break` after
 * the first hit the way `detectConflicts()` in `gameMetrics.js` does, because
 * a count produced by breaking is a lower bound wearing a number's clothes.
 *
 * Bookings are bucketed by venue and date first, which is both the fast path
 * and the honest one: conflicts cannot cross a venue or a date.
 *
 * @param {import('./types.js').FacilityGraph} graph
 * @param {ReadonlyArray<import('./types.js').FacilityBooking>} bookings
 * @returns {{ conflicts: import('./types.js').FacilityFinding[], unknownFootprint: import('./types.js').FacilityFinding[], unknownSurface: import('./types.js').FacilityFinding[], meta: import('./types.js').FacilityMeta }}
 */
export function findFacilityConflicts(graph, bookings) {
  const meta = createMeta();
  /** @type {import('./types.js').FacilityFinding[]} */
  const conflicts = [];
  /** @type {import('./types.js').FacilityFinding[]} */
  const unknownFootprint = [];
  /** @type {import('./types.js').FacilityFinding[]} */
  const unknownSurface = [];

  /** @type {Map<string, import('./types.js').FacilityBooking[]>} */
  const buckets = new Map();
  const seenSurfaces = new Set();

  for (const raw of bookings) {
    const booking = parseBooking(raw);
    const surface = getSurface(graph, booking.surfaceId);
    if (!surface) {
      unknownSurface.push(
        makeFinding(
          FACILITY_REASON.SURFACE_UNKNOWN,
          `booking ${booking.id} names surface "${booking.surfaceId}", which is not in the graph`,
          { bookingId: booking.id, surfaceId: booking.surfaceId, date: booking.date }
        )
      );
      continue;
    }
    seenSurfaces.add(surface.id);
    if (booking.endMinutes === null) {
      unknownFootprint.push(
        makeFinding(
          FACILITY_REASON.OCCUPANCY_FOOTPRINT_UNKNOWN,
          `booking ${booking.label ?? booking.id} on ${surface.name} (${booking.date}) has no known end time, so concurrency cannot be decided`,
          {
            bookingId: booking.id,
            surfaceId: booking.surfaceId,
            surfaceName: surface.name,
            venueId: surface.venueId,
            date: booking.date,
            startMinutes: booking.startMinutes,
            format: booking.format ?? null,
          }
        )
      );
    }
    const key = `${surface.venueId}\u0000${booking.date}`;
    if (!buckets.has(key)) buckets.set(key, []);
    /** @type {import('./types.js').FacilityBooking[]} */ (buckets.get(key)).push(booking);
  }
  meta.surfacesConsidered = seenSurfaces.size;

  for (const bucket of buckets.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const a = bucket[i];
        const b = bucket[j];
        meta.bookingPairsCompared += 1;
        const concurrent = bookingsOverlapInTime(a, b);
        // `null` means an unknown footprint; that booking is already reported
        // in `unknownFootprint`, and inventing a verdict here would hide it.
        if (concurrent !== true) continue;
        const verdict = surfacesConflict(graph, a.surfaceId, b.surfaceId);
        meta.cellPairsCompared += verdict.meta.cellPairsCompared;
        meta.overlapPairsConsulted += verdict.meta.overlapPairsConsulted;
        if (verdict.conflict) {
          conflicts.push(pairFinding(graph, /** @type {string} */ (verdict.code), a, b));
        }
      }
    }
  }

  return { conflicts, unknownFootprint, unknownSurface, meta };
}

/**
 * Occupancy findings for one candidate booking against a set of existing ones.
 *
 * @param {import('./types.js').FacilityGraph} graph
 * @param {import('./types.js').FacilityBooking} candidate - already schema-parsed
 * @param {ReadonlyArray<import('./types.js').FacilityBooking>} existingBookings
 * @returns {{ findings: import('./types.js').FacilityFinding[], meta: import('./types.js').FacilityMeta }}
 */
export function checkOccupancy(graph, candidate, existingBookings) {
  const meta = createMeta();
  /** @type {import('./types.js').FacilityFinding[]} */
  const findings = [];
  const surface = requireSurface(graph, candidate.surfaceId);
  meta.surfacesConsidered = 1;

  for (const raw of existingBookings) {
    const existing = parseBooking(raw);
    if (existing.id === candidate.id) continue;
    const other = getSurface(graph, existing.surfaceId);
    if (!other || other.venueId !== surface.venueId) continue;
    if (existing.date !== candidate.date) continue;

    meta.bookingPairsCompared += 1;
    const concurrent = bookingsOverlapInTime(candidate, existing);
    const verdict = surfacesConflict(graph, candidate.surfaceId, existing.surfaceId);
    meta.cellPairsCompared += verdict.meta.cellPairsCompared;
    meta.overlapPairsConsulted += verdict.meta.overlapPairsConsulted;
    if (!verdict.conflict) continue;

    if (concurrent === null) {
      // The two would share ground, and one of them has no known end. Reported
      // rather than waved through: never a false all-clear.
      findings.push(
        makeFinding(
          FACILITY_REASON.OCCUPANCY_FOOTPRINT_UNKNOWN,
          `cannot decide concurrency with ${existing.label ?? existing.id} on ${other.name} (${existing.date}): its footprint is unknown`,
          {
            bookingId: candidate.id,
            otherBookingId: existing.id,
            surfaceId: candidate.surfaceId,
            otherSurfaceId: existing.surfaceId,
            date: candidate.date,
          }
        )
      );
      continue;
    }
    if (concurrent) {
      findings.push(pairFinding(graph, /** @type {string} */ (verdict.code), candidate, existing));
    }
  }

  return { findings, meta };
}
