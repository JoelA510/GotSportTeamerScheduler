/**
 * Closures: the constraint log as availability windows.
 *
 * `field_constraints.csv` is the club's second source of ground truth about
 * when a site is usable — blackouts, closures, a parking notice and one
 * adjacency rule, each with date bounds, time bounds, a venue, a `fields`
 * cell and a reason. Nothing reconciled it with the facility graph before
 * Phase 8.3; this module holds it as **closure windows** scoped to graph ids
 * and answers "does this booking stand inside one?".
 *
 * Six scope kinds, because the `fields` cell says six different things:
 *
 * ```text
 * venue          `All`             every surface of the venue (or complex)
 * surface        `4`               that surface and everything sharing its cells
 * unreadable     `2026-01-07`      Excel ate the cell; applies to the venue as a
 *                                  compromise, never as nothing
 * not-ground     `Parking`         not a surface; information only
 * adjacency      `Adjacent Fields` a rule the graph's overlap pairs already
 *                                  carry; reconciled, not evaluated twice
 * venue-unknown                    the row names a venue the graph does not hold;
 *                                  reported at build time, applies to nothing
 * ```
 *
 * **One reading of "all day".** A row that opens at `00:00` and closes at or
 * after {@link ALL_DAY_CLOSE_MINUTES} closes the whole day: `23:00` is the
 * latest close the sheet writes, and it never writes `24:00`. The corpus
 * loader's `crossCorpusFindings()` uses the same {@link isAllDayWindow} to
 * decide which closures are season-long, so a practice at 23:30 cannot slip
 * between two interpretations of one cell.
 *
 * Holds no bookings; every query takes the caller's own.
 *
 * @module availability/closures
 */

import { z } from 'zod';

import { getSurface } from '../facility/facilityGraph.js';
import { FACILITY_REASON, makeFinding } from '../facility/reasonCodes.js';
import { AVAILABILITY_REASON, makeAvailabilityFinding } from './reasonCodes.js';

/**
 * A closure row is all-day when it opens at 00:00 and closes at or after this
 * — `23:00`, the latest close the constraint sheet writes. Anything narrower
 * is a daily window.
 */
export const ALL_DAY_CLOSE_MINUTES = 23 * 60;

/**
 * The one producer of "this window is the whole day".
 *
 * @param {number} startMinutes
 * @param {number} endMinutes
 * @returns {boolean}
 */
export function isAllDayWindow(startMinutes, endMinutes) {
  return startMinutes === 0 && endMinutes >= ALL_DAY_CLOSE_MINUTES;
}

/** Inclusive ISO calendar date, `YYYY-MM-DD`. No `Date` construction anywhere. */
const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'expected an ISO YYYY-MM-DD date' });

/** A non-empty opaque identifier. */
const IdSchema = z.string().min(1, { message: 'ids must be non-empty strings' });

/** Minutes past local midnight. */
const MinutesSchema = z.number().int().min(0);

/**
 * How a closure names its ground.
 *
 * @readonly
 * @enum {string}
 */
export const CLOSURE_SCOPE = Object.freeze({
  VENUE: 'venue',
  SURFACE: 'surface',
  UNREADABLE: 'unreadable',
  NOT_GROUND: 'not-ground',
  ADJACENCY: 'adjacency',
  VENUE_UNKNOWN: 'venue-unknown',
});

/** @see {@link CLOSURE_SCOPE} */
export const ClosureScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal(CLOSURE_SCOPE.VENUE), venueIds: z.array(IdSchema).min(1) }).strict(),
  z.object({ kind: z.literal(CLOSURE_SCOPE.SURFACE), surfaceId: IdSchema }).strict(),
  z
    .object({ kind: z.literal(CLOSURE_SCOPE.UNREADABLE), venueIds: z.array(IdSchema).min(1) })
    .strict(),
  z
    .object({ kind: z.literal(CLOSURE_SCOPE.NOT_GROUND), venueIds: z.array(IdSchema).min(1) })
    .strict(),
  z
    .object({ kind: z.literal(CLOSURE_SCOPE.ADJACENCY), venueIds: z.array(IdSchema).min(1) })
    .strict(),
  z.object({ kind: z.literal(CLOSURE_SCOPE.VENUE_UNKNOWN), venueName: z.string().min(1) }).strict(),
]);

/** @see {@link import('./types.js').ClosureWindow} */
export const ClosureWindowSchema = z
  .object({
    id: IdSchema,
    fromDate: IsoDateSchema,
    toDate: IsoDateSchema,
    startMinutes: MinutesSchema,
    endMinutes: MinutesSchema,
    /** Must agree with {@link isAllDayWindow}; the builder refuses otherwise. */
    allDay: z.boolean(),
    scope: ClosureScopeSchema,
    reason: z.string().min(1),
    /** The `fields` cell as written, for audit. */
    fieldsRaw: z.string().nullable().default(null),
    /** The venue as the sheet spells it, for audit. */
    venueName: z.string().nullable().default(null),
    source: z.string().nullable().default(null),
  })
  .strict()
  .refine((window) => window.fromDate <= window.toDate, {
    message: 'a closure must not end before it starts',
    path: ['toDate'],
  })
  .refine((window) => window.startMinutes <= window.endMinutes, {
    message: 'a closure must not close before it opens',
    path: ['endMinutes'],
  })
  .refine((window) => window.allDay === isAllDayWindow(window.startMinutes, window.endMinutes), {
    message: 'allDay must be what isAllDayWindow() says of the times; there is one reading',
    path: ['allDay'],
  });

/** Input for {@link buildClosureSet}. */
export const ClosureSetInputSchema = z
  .object({
    closures: z.array(ClosureWindowSchema),
    source: z.string().nullable().default(null),
  })
  .strict();

/**
 * @typedef {Object} ClosureMeta
 * @property {number} closuresConsulted
 * @property {number} closuresApplied - closures whose date, ground and time all matched
 * @property {number} bookingsChecked
 */

/** @returns {ClosureMeta} */
function createClosureMeta() {
  return { closuresConsulted: 0, closuresApplied: 0, bookingsChecked: 0 };
}

/**
 * Recursively freeze a value.
 *
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const inner of Object.values(value)) deepFreeze(inner);
  return value;
}

/**
 * Build an immutable closure set, checking every scope against the graph.
 *
 * A venue or surface id the graph does not hold is a producer bug and throws.
 * A `venue-unknown` scope is different: it is the adapter *saying* the sheet
 * named a venue nothing knows, and it is carried as a finding so the row is
 * visible rather than dropped.
 *
 * @param {import('../facility/types.js').FacilityGraph} graph
 * @param {{ closures: Array<Object>, source?: string|null }} input
 * @returns {import('./types.js').ClosureSet}
 */
export function buildClosureSet(graph, input) {
  const parsed = ClosureSetInputSchema.parse(input);
  /** @type {import('./types.js').AvailabilityFinding[]} */
  const findings = [];
  const seenIds = new Set();
  /** @type {Record<string, number>} */
  const byKind = {};
  for (const kind of Object.values(CLOSURE_SCOPE)) byKind[kind] = 0;

  for (const closure of parsed.closures) {
    if (seenIds.has(closure.id)) throw new Error(`closures: duplicate closure id "${closure.id}"`);
    seenIds.add(closure.id);
    byKind[closure.scope.kind] += 1;
    const scope = closure.scope;
    if ('venueIds' in scope) {
      for (const venueId of scope.venueIds) {
        if (!graph.venues[venueId]) {
          throw new Error(`closures: closure "${closure.id}" scopes to unknown venue "${venueId}"`);
        }
      }
    }
    if (scope.kind === CLOSURE_SCOPE.SURFACE && !graph.surfaces[scope.surfaceId]) {
      throw new Error(
        `closures: closure "${closure.id}" scopes to unknown surface "${scope.surfaceId}"`
      );
    }
    if (scope.kind === CLOSURE_SCOPE.VENUE_UNKNOWN) {
      findings.push(
        makeAvailabilityFinding(
          AVAILABILITY_REASON.CLOSURE_VENUE_UNKNOWN,
          `closure "${closure.id}" (${closure.reason}, ${closure.fromDate} to ${closure.toDate}) names "${scope.venueName}", a venue the graph does not hold; it applies to nothing and is reported instead`,
          {
            closureId: closure.id,
            venueName: scope.venueName,
            reason: closure.reason,
            fromDate: closure.fromDate,
            toDate: closure.toDate,
          }
        )
      );
    }
  }

  const closures = /** @type {import('./types.js').ClosureWindow[]} */ (parsed.closures);
  return deepFreeze({
    closures,
    closureIds: closures.map((closure) => closure.id),
    source: parsed.source,
    findings,
    stats: {
      closureCount: closures.length,
      allDayCount: closures.filter((closure) => closure.allDay).length,
      byKind,
    },
  });
}

/**
 * Does a closure's ground include a surface?
 *
 * A venue-kind scope covers every surface of the venue. A surface-kind scope
 * covers the surface, its descendants and its ancestors — anything that shares
 * a cell with it: a closure on Pitch 4 closes 4A and `4A Side 1`, and a
 * booking of Pitch 4 whole cannot stand while 4A is closed.
 *
 * @param {import('../facility/types.js').FacilityGraph} graph
 * @param {import('./types.js').ClosureWindow} closure
 * @param {import('../facility/types.js').FacilitySurface} surface
 * @returns {boolean}
 */
function closureCoversSurface(graph, closure, surface) {
  const scope = closure.scope;
  if (scope.kind === CLOSURE_SCOPE.VENUE_UNKNOWN) return false;
  if (scope.kind === CLOSURE_SCOPE.SURFACE) {
    const closed = graph.surfaces[scope.surfaceId];
    const cells = new Set(closed.cells);
    return surface.cells.some((cell) => cells.has(cell));
  }
  return scope.venueIds.includes(surface.venueId);
}

/**
 * Does a closure's time window meet a booking's?
 *
 * `null` when the booking has no known end and the closure is not all-day:
 * the question cannot be answered, and the caller reports that rather than
 * answering it (the `bookingsOverlapInTime()` contract).
 *
 * @param {import('./types.js').ClosureWindow} closure
 * @param {import('../facility/types.js').FacilityBooking} booking
 * @returns {boolean|null}
 */
function closureMeetsBooking(closure, booking) {
  if (closure.allDay) return true;
  if (booking.endMinutes === null || booking.endMinutes === undefined) return null;
  return booking.startMinutes < closure.endMinutes && closure.startMinutes < booking.endMinutes;
}

/**
 * Every closure a booking stands inside, as findings.
 *
 * @param {import('../facility/types.js').FacilityGraph} graph
 * @param {import('./types.js').ClosureSet} closureSet
 * @param {import('../facility/types.js').FacilityBooking} booking
 * @returns {{ findings: import('./types.js').AvailabilityFinding[], meta: ClosureMeta }}
 */
export function checkClosures(graph, closureSet, booking) {
  const meta = createClosureMeta();
  /** @type {import('./types.js').AvailabilityFinding[]} */
  const findings = [];
  meta.bookingsChecked = 1;

  const surface = getSurface(graph, booking.surfaceId);
  if (!surface) {
    // Unknown ground is reported, never waved through as "no closure applies".
    findings.push(
      /** @type {import('./types.js').AvailabilityFinding} */ (
        makeFinding(
          FACILITY_REASON.SURFACE_UNKNOWN,
          `closures were asked about surface "${booking.surfaceId}", which is not in the graph`,
          { bookingId: booking.id, surfaceId: booking.surfaceId, date: booking.date }
        )
      )
    );
    return { findings, meta };
  }

  for (const closure of closureSet.closures) {
    meta.closuresConsulted += 1;
    if (booking.date < closure.fromDate || booking.date > closure.toDate) continue;
    if (!closureCoversSurface(graph, closure, surface)) continue;
    const meets = closureMeetsBooking(closure, booking);
    const details = {
      bookingId: booking.id,
      surfaceId: booking.surfaceId,
      surfaceName: surface.name,
      venueId: surface.venueId,
      date: booking.date,
      startMinutes: booking.startMinutes,
      endMinutes: booking.endMinutes ?? null,
      closureId: closure.id,
      scopeKind: closure.scope.kind,
      reason: closure.reason,
      fieldsRaw: closure.fieldsRaw,
      fromDate: closure.fromDate,
      toDate: closure.toDate,
      closureStartMinutes: closure.startMinutes,
      closureEndMinutes: closure.endMinutes,
      allDay: closure.allDay,
      source: closure.source,
    };
    const where = `${closure.reason} ${closure.fromDate} to ${closure.toDate}${closure.allDay ? '' : `, ${closure.startMinutes}-${closure.endMinutes} minutes past midnight`}`;
    if (meets === null) {
      findings.push(
        makeAvailabilityFinding(
          AVAILABILITY_REASON.CLOSURE_OVERLAP_UNDECIDABLE,
          `${booking.label ?? booking.id} on ${surface.name} (${booking.date}) has no known end, so whether it meets the closure "${where}" cannot be decided`,
          details
        )
      );
      continue;
    }
    if (!meets) continue;
    meta.closuresApplied += 1;
    switch (closure.scope.kind) {
      case CLOSURE_SCOPE.VENUE:
      case CLOSURE_SCOPE.SURFACE:
        findings.push(
          makeAvailabilityFinding(
            AVAILABILITY_REASON.CLOSURE_BLOCKS_BOOKING,
            `${booking.label ?? booking.id} on ${surface.name} (${booking.date}) stands inside the closure "${where}"`,
            details
          )
        );
        break;
      case CLOSURE_SCOPE.UNREADABLE:
        findings.push(
          makeAvailabilityFinding(
            AVAILABILITY_REASON.CLOSURE_SCOPE_UNREADABLE,
            `${booking.label ?? booking.id} on ${surface.name} (${booking.date}) falls in the closure "${where}", whose fields cell "${closure.fieldsRaw}" cannot be read; it may or may not close this ground`,
            details
          )
        );
        break;
      case CLOSURE_SCOPE.NOT_GROUND:
        findings.push(
          makeAvailabilityFinding(
            AVAILABILITY_REASON.CLOSURE_NOT_GROUND,
            `${booking.label ?? booking.id} on ${surface.name} (${booking.date}) falls in "${where}", which closes "${closure.fieldsRaw}" and no playing surface`,
            details
          )
        );
        break;
      case CLOSURE_SCOPE.ADJACENCY:
        findings.push(
          makeAvailabilityFinding(
            AVAILABILITY_REASON.CLOSURE_ADJACENCY_DEFERRED,
            `${booking.label ?? booking.id} on ${surface.name} (${booking.date}) is under the adjacency rule "${where}", which the facility graph's overlap pairs enforce`,
            details
          )
        );
        break;
      default:
        break;
    }
  }
  return { findings, meta };
}

/**
 * Scan a whole schedule against the closure set.
 *
 * @param {import('../facility/types.js').FacilityGraph} graph
 * @param {import('./types.js').ClosureSet} closureSet
 * @param {ReadonlyArray<import('../facility/types.js').FacilityBooking>} bookings
 * @returns {{ findings: import('./types.js').AvailabilityFinding[], meta: ClosureMeta }}
 */
export function findClosureBreaches(graph, closureSet, bookings) {
  const meta = createClosureMeta();
  /** @type {import('./types.js').AvailabilityFinding[]} */
  const findings = [];
  for (const booking of bookings) {
    const result = checkClosures(graph, closureSet, booking);
    findings.push(...result.findings);
    meta.bookingsChecked += result.meta.bookingsChecked;
    meta.closuresConsulted += result.meta.closuresConsulted;
    meta.closuresApplied += result.meta.closuresApplied;
  }
  return { findings, meta };
}

/**
 * Does the graph already carry what an adjacency closure states?
 *
 * The sheet's row says only "Adjacent Fields / Spacing" at a venue over a
 * date range; it names no pairs. The graph is the single producer of the
 * pairs, so the reconciliation is: every venue the row names carries at least
 * one declared overlap pair. Encoding pairs from the row would be a second
 * copy free to disagree with the first.
 *
 * @param {import('../facility/types.js').FacilityGraph} graph
 * @param {import('./types.js').ClosureWindow} closure - an adjacency-kind closure
 * @returns {{ agrees: boolean, venueIds: string[], overlapPairs: Array<[string, string]>, pairsByVenue: Record<string, number> }}
 */
export function reconcileAdjacencyRule(graph, closure) {
  if (closure.scope.kind !== CLOSURE_SCOPE.ADJACENCY) {
    throw new Error(
      `closures: "${closure.id}" is a ${closure.scope.kind} closure, not an adjacency rule`
    );
  }
  const venueIds = [...closure.scope.venueIds].sort();
  const venueSet = new Set(venueIds);
  const overlapPairs = graph.overlapPairs.filter(([a]) => venueSet.has(graph.surfaces[a].venueId));
  /** @type {Record<string, number>} */
  const pairsByVenue = {};
  for (const venueId of venueIds) pairsByVenue[venueId] = 0;
  for (const [a] of overlapPairs) pairsByVenue[graph.surfaces[a].venueId] += 1;
  return {
    agrees: venueIds.every((venueId) => pairsByVenue[venueId] > 0),
    venueIds,
    overlapPairs,
    pairsByVenue,
  };
}
