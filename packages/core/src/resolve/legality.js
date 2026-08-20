/**
 * "May this game stand here?" — asked entirely through Phase 1.3 and Phase 2.1.
 *
 * Nothing in this file decides anything. `checkKickoffAvailability()` answers
 * occupancy, permit, lighting, daylight, size, lining and equipment, and hands
 * back its four constraints ordered by tightness; the constraint registry
 * re-severities what came back, so hardness stays data (GAP-12). A second copy
 * of any of that here would be free to disagree with the first.
 *
 * **The bound of this module's remit, stated plainly.** Legality here means
 * *facility legality*. Turnover floors, round-robin completeness, home/away
 * balance and coach travel are the standing rule engine's, and `resolve/`
 * reports them through its `verify` stage rather than repairing them: repairing
 * a soft constraint means trading it against others, which needs the weighted
 * objective Prompt 4.2 owns. A change that leaves a schedule facility-legal and
 * turnover-short is reported as exactly that.
 *
 * @module resolve/legality
 */

import { applyRegistrySeverity, effectiveSeverityTable } from '../constraints/severity.js';
import { CONSTRAINT_SEVERITY, CONSTRAINT_STATUS } from '../constraints/reasonCodes.js';
import { checkKickoffAvailability } from '../availability/kickoff.js';
import { getSurface } from '../facility/facilityGraph.js';

/** The id `checkKickoffAvailability()` gives the candidate it invents. */
const PROBE_BOOKING_ID = '__availability_probe__';

/**
 * The bookings standing on a date, as the facility model wants them.
 *
 * @param {import('./types.js').ResolveState} state
 * @param {string} date
 * @param {string} exceptGameId
 * @returns {Array<import('../facility/types.js').FacilityBooking>}
 */
export function bookingsOn(state, date, exceptGameId) {
  /** @type {Array<import('../facility/types.js').FacilityBooking>} */
  const bookings = [];
  for (const gameId of state.gameIds) {
    if (gameId === exceptGameId) continue;
    const game = state.games[gameId];
    if (!game || game.date !== date) continue;
    bookings.push({
      id: game.id,
      surfaceId: game.surfaceId,
      date: game.date,
      startMinutes: game.startMinutes,
      endMinutes: game.endMinutes,
      format: game.format,
      label: `${game.homeLabel} v ${game.awayLabel}`,
    });
  }
  return bookings;
}

/**
 * Is this game legal on this slot, given everything else currently placed?
 *
 * @param {{ graph: import('../facility/types.js').FacilityGraph, table: import('../timing/types.js').FormatTimingTable, calendar: import('../availability/types.js').AvailabilityCalendar, registry: import('../constraints/types.js').ConstraintRegistry }} engines
 * @param {import('./types.js').ResolveState} state
 * @param {string} gameId
 * @param {import('./types.js').Slot} slot
 * @returns {{ legal: boolean, status: string, findings: Array<Object>, blockingCodes: string[], blockingCodeCounts: Record<string, number>, counterpartGameIds: string[], availability: Object }}
 */
export function checkPlacement(engines, state, gameId, slot) {
  const game = state.baseline[gameId];
  if (!game) throw new Error(`resolve: no baseline game "${gameId}"`);
  const surface = getSurface(engines.graph, slot.surfaceId);

  const availability = checkKickoffAvailability(
    engines.graph,
    engines.table,
    engines.calendar,
    {
      surfaceId: slot.surfaceId,
      date: slot.date,
      kickoffMinutes: slot.startMinutes,
      format: game.format,
      ignoreBookingIds: [gameId],
    },
    { existingBookings: bookingsOn(state, slot.date, gameId) }
  );

  const severity = effectiveSeverityTable(engines.registry, {
    date: slot.date,
    venueId: surface?.venueId ?? game.venueId,
    surfaceId: slot.surfaceId,
    surfaceLineage: surface ? [...surface.lineage] : [slot.surfaceId],
    ...(game.divisionLabel ? { divisionLabel: game.divisionLabel } : {}),
  });
  const applied = applyRegistrySeverity(availability.findings, severity);

  const blocking = applied.findings.filter(
    (finding) => finding.severity === CONSTRAINT_SEVERITY.BLOCKING
  );
  /** @type {Set<string>} */
  const counterparts = new Set();
  for (const finding of blocking) {
    const details = /** @type {Record<string, unknown>} */ (finding.details ?? {});
    for (const key of ['bookingAId', 'bookingBId', 'otherBookingId']) {
      const value = details[key];
      if (typeof value !== 'string') continue;
      if (value === PROBE_BOOKING_ID || value === gameId) continue;
      counterparts.add(value);
    }
  }

  // **How many, not just whether.** `blockingCodes` is the de-duplicated set and
  // is what the error message and the registry lookup want; it is not enough to
  // decide whether a candidate slot is worse than the one the schedule arrived
  // with. A game already overlapping one neighbour and offered a slot where it
  // would overlap two carries the same *set* in both places, and a comparison
  // on presence alone reads that as no change. `verify` already compares the
  // rule engine's violations per code by count, and this is the same contract
  // one layer down.
  /** @type {Record<string, number>} */
  const blockingCodeCounts = {};
  for (const finding of blocking) {
    blockingCodeCounts[finding.code] = (blockingCodeCounts[finding.code] ?? 0) + 1;
  }

  return {
    legal: applied.status !== CONSTRAINT_STATUS.REJECTED,
    status: applied.status,
    findings: applied.findings,
    blockingCodes: [...new Set(blocking.map((finding) => finding.code))].sort(),
    blockingCodeCounts,
    counterpartGameIds: [...counterparts].sort(),
    availability,
  };
}
