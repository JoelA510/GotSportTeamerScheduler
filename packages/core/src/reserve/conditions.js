/**
 * Conditional slots: ground that is only usable while other ground is idle.
 *
 * > *"A slot available only if another field is idle (one field was usable for
 * > 11v11 only while its overlapping neighbour was unused). Encode the
 * > condition; do not put it in a note field."*
 *
 * Two halves, and both are required for the condition to mean anything:
 *
 * 1. {@link conditionForSurface} **derives** the condition from the facility
 *    graph. The surfaces a slot depends on are exactly those `surfacesConflict()`
 *    reports as `OCCUPIED_SPATIAL_OVERLAP` — Alder Park's Pitch 2 depends on
 *    Pitch 1 and, through the lineage clause, on its halves 1A and 1B; Pitch 3
 *    depends on Pitch 4, 4A and 4B. No pair is typed in here and none is
 *    inferred from a name.
 * 2. {@link evaluateSlotCondition} **checks** it against real bookings. A
 *    condition that is stored and never checked is the constraint registry's
 *    `declared-only` state wearing a different hat, so a slot whose condition
 *    nobody evaluated reports `SLOT_CONDITION_UNENFORCED` at `compromise`
 *    rather than reading as one that held.
 *
 * There is **no second overlap test in this file**. Whether two surfaces share
 * ground is `facility/occupancy.js`'s `surfacesConflict()`; whether two bookings
 * share a clock is its `bookingsOverlapInTime()`, whose deliberate `null` for an
 * unknown footprint (GAP-14) becomes {@link CONDITION_VERDICT.UNDECIDABLE} here
 * rather than a fabricated all-clear. The corpus's single field reservation is a
 * `Scrimmage`, which has no `game_formats.csv` row, so this path is exercised by
 * real data rather than only by a constructed case.
 *
 * @module reserve/conditions
 */

import { getSurface } from '../facility/facilityGraph.js';
import { FACILITY_REASON } from '../facility/reasonCodes.js';
import { bookingsOverlapInTime, surfacesConflict } from '../facility/occupancy.js';

import {
  CONDITION_VERDICT,
  RESERVE_REASON,
  SLOT_CONDITION_KIND,
  createReserveMeta,
  makeReserveFinding,
} from './reasonCodes.js';
import { SlotConditionSchema } from './schemas.js';

/** Provenance string for a condition this module derived from the graph. */
export const CONDITION_DERIVED_FROM = 'facility/occupancy.js surfacesConflict :: spatial overlap';

/**
 * The condition a slot on this surface carries, or `null` when it carries none.
 *
 * "Carries none" is a real answer and not a missing one: Riverbend's Turf and
 * Summit HS's Stadium are the only 11v11 ground at their venues, so a slot on
 * either is unconditional. Reporting them as conditional-but-always-satisfied
 * would make the two counts the build plan asks to keep separate meaningless.
 *
 * @param {import('../facility/types.js').FacilityGraph} graph
 * @param {string} surfaceId
 * @returns {import('./types.js').SlotCondition|null}
 */
export function conditionForSurface(graph, surfaceId) {
  const surface = getSurface(graph, surfaceId);
  if (!surface) return null;

  const surfaceIds = [];
  for (const otherId of graph.surfaceIds) {
    if (otherId === surfaceId) continue;
    if (graph.surfaces[otherId].venueId !== surface.venueId) continue;
    // Containment — a pitch and its own halves — is not a *condition*, it is the
    // same patch of grass, and `checkKickoffAvailability()` already refuses a
    // booking that collides with it. Only genuinely distinct ground that happens
    // to overlap makes a slot conditional.
    if (
      surfacesConflict(graph, surfaceId, otherId).code !== FACILITY_REASON.OCCUPIED_SPATIAL_OVERLAP
    )
      continue;
    surfaceIds.push(otherId);
  }
  if (surfaceIds.length === 0) return null;

  surfaceIds.sort();
  const names = surfaceIds.map((id) => getSurface(graph, id)?.name ?? id);
  return /** @type {import('./types.js').SlotCondition} */ (
    SlotConditionSchema.parse({
      kind: SLOT_CONDITION_KIND.SURFACE_IDLE,
      surfaceIds,
      derivedFrom: CONDITION_DERIVED_FROM,
      reason: `${surface.name} physically overlaps ${names.join(', ')}, so a game here exists only while that ground is unused`,
    })
  );
}

/**
 * A condition per surface, for every surface named.
 *
 * @param {import('../facility/types.js').FacilityGraph} graph
 * @param {ReadonlyArray<string>} surfaceIds
 * @returns {Record<string, import('./types.js').SlotCondition|null>}
 */
export function conditionsForSurfaces(graph, surfaceIds) {
  /** @type {Record<string, import('./types.js').SlotCondition|null>} */
  const out = {};
  for (const surfaceId of surfaceIds) out[surfaceId] = conditionForSurface(graph, surfaceId);
  return out;
}

/**
 * The window a slot occupies, in the shape `bookingsOverlapInTime()` reads.
 *
 * @param {{ id?: string, date: string, startMinutes: number, endMinutes: number|null }} slot
 * @returns {import('../facility/types.js').FacilityBooking}
 */
function windowOf(slot) {
  return /** @type {import('../facility/types.js').FacilityBooking} */ ({
    id: slot.id ?? '__reserve_window__',
    surfaceId: '__reserve_window__',
    date: slot.date,
    startMinutes: slot.startMinutes,
    endMinutes: slot.endMinutes ?? null,
    format: null,
    label: null,
  });
}

/**
 * Does this slot's condition hold, given what is already standing?
 *
 * `bookings` is required rather than defaulted. An empty array is a legitimate
 * answer — "nothing is booked that day" — and `undefined` is a different one:
 * nobody looked. The two must not collapse, which is what
 * {@link describeSlotCondition} is for.
 *
 * @param {import('../facility/types.js').FacilityGraph} graph
 * @param {{ id: string, date: string, startMinutes: number, endMinutes: number|null, condition: import('./types.js').SlotCondition|null }} slot
 * @param {ReadonlyArray<import('../facility/types.js').FacilityBooking>} bookings
 * @param {{ ignoreBookingIds?: ReadonlyArray<string>, reserved?: boolean }} [options]
 * @returns {import('./types.js').ConditionEvaluation}
 */
export function evaluateSlotCondition(graph, slot, bookings, options = {}) {
  const meta = createReserveMeta();
  /** @type {import('./types.js').ReserveFinding[]} */
  const findings = [];

  if (!slot.condition) {
    return {
      slotId: slot.id,
      verdict: CONDITION_VERDICT.UNCONDITIONAL,
      surfaceIds: [],
      blockingBookingIds: [],
      undecidableBookingIds: [],
      findings,
      meta,
    };
  }

  meta.conditionsDeclared += 1;
  meta.conditionsEvaluated += 1;

  const watched = new Set(slot.condition.surfaceIds);
  const ignored = new Set(options.ignoreBookingIds ?? []);
  const window = windowOf(slot);

  /** @type {string[]} */
  const blockingBookingIds = [];
  /** @type {string[]} */
  const undecidableBookingIds = [];

  for (const booking of bookings) {
    if (ignored.has(booking.id)) continue;
    if (booking.id === slot.id) continue;
    if (booking.date !== slot.date) continue;
    if (!watched.has(booking.surfaceId)) continue;
    meta.conditionBookingsCompared += 1;
    const concurrent = bookingsOverlapInTime(window, booking);
    if (concurrent === null) undecidableBookingIds.push(booking.id);
    else if (concurrent) blockingBookingIds.push(booking.id);
  }

  blockingBookingIds.sort();
  undecidableBookingIds.sort();

  const base = {
    slotId: slot.id,
    date: slot.date,
    startMinutes: slot.startMinutes,
    endMinutes: slot.endMinutes,
    conditionSurfaceIds: [...slot.condition.surfaceIds],
  };

  /** @type {string} */
  let verdict = CONDITION_VERDICT.SATISFIED;
  if (blockingBookingIds.length > 0) {
    verdict = CONDITION_VERDICT.BLOCKED;
    // A *candidate* slot whose condition fails is a fact about the day. A slot
    // the club actually reserved whose condition fails is ground held that
    // cannot be used, and that is a different severity.
    findings.push(
      makeReserveFinding(
        options.reserved
          ? RESERVE_REASON.RESERVED_SLOT_CONDITION_BLOCKED
          : RESERVE_REASON.SLOT_CONDITION_BLOCKED,
        `${slot.id} depends on ${slot.condition.surfaceIds.join(', ')} being idle, and ${blockingBookingIds.length} booking(s) stand there`,
        { ...base, blockingBookingIds }
      )
    );
  } else if (undecidableBookingIds.length > 0) {
    verdict = CONDITION_VERDICT.UNDECIDABLE;
  } else {
    findings.push(
      makeReserveFinding(
        RESERVE_REASON.SLOT_CONDITION_SATISFIED,
        `${slot.id} depends on ${slot.condition.surfaceIds.join(', ')} being idle, and nothing stands there`,
        base
      )
    );
  }

  if (undecidableBookingIds.length > 0) {
    findings.push(
      makeReserveFinding(
        RESERVE_REASON.SLOT_CONDITION_UNDECIDABLE,
        `${undecidableBookingIds.length} booking(s) on the ground ${slot.id} depends on have no known footprint, so this condition cannot be decided`,
        { ...base, undecidableBookingIds }
      )
    );
  }

  return {
    slotId: slot.id,
    verdict,
    surfaceIds: [...slot.condition.surfaceIds],
    blockingBookingIds,
    undecidableBookingIds,
    findings,
    meta,
  };
}

/**
 * The declared-only view: report that a slot carries a condition, and that
 * nothing checked it.
 *
 * This exists so a caller that genuinely has nothing to check against says so
 * out loud. `packages/core/src/constraints/` invented
 * `enforcement: 'declared-only'` for exactly this distinction, and a conditional
 * slot reported as available on the strength of a stored condition would be the
 * same falsely perfect result at a smaller scale.
 *
 * `capacity.js` never calls this, because `ReserveCapacityInputSchema` requires
 * its `bookings` and therefore always has something to evaluate against. It is
 * the answer for a caller who does not.
 *
 * @param {{ id: string, condition: import('./types.js').SlotCondition|null }} slot
 * @returns {import('./types.js').ConditionEvaluation}
 */
export function describeSlotCondition(slot) {
  const meta = createReserveMeta();
  if (!slot.condition) {
    return {
      slotId: slot.id,
      verdict: CONDITION_VERDICT.UNCONDITIONAL,
      surfaceIds: [],
      blockingBookingIds: [],
      undecidableBookingIds: [],
      findings: [],
      meta,
    };
  }
  meta.conditionsDeclared += 1;
  return {
    slotId: slot.id,
    verdict: CONDITION_VERDICT.UNEVALUATED,
    surfaceIds: [...slot.condition.surfaceIds],
    blockingBookingIds: [],
    undecidableBookingIds: [],
    findings: [
      makeReserveFinding(
        RESERVE_REASON.SLOT_CONDITION_UNENFORCED,
        `${slot.id} exists only while ${slot.condition.surfaceIds.join(', ')} are idle, and nothing in this run checked whether they are`,
        { slotId: slot.id, conditionSurfaceIds: [...slot.condition.surfaceIds] }
      ),
    ],
    meta,
  };
}
