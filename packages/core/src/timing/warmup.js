/**
 * Warm-up as schedulable field occupancy (GAP-27, incident 8).
 *
 * The point of this file is what it *does not* contain: there is no overlap
 * test in it. A warm-up is turned into a real
 * {@link import('../facility/types.js').FacilityBooking} and handed to the
 * Phase 1.1 machinery — `checkBooking()`, `checkOccupancy()`,
 * `findFacilityConflicts()` — so a warm-up standing on ground that overlaps a
 * live game is caught by exactly the same code, and the same containment and
 * overlap relations, that catch two games. A second, parallel implementation
 * would be free to disagree with the first, and the disagreement would be
 * invisible.
 *
 * What this file *adds* is the vocabulary. Facility findings come back saying
 * "these two bookings clash"; a warm-up collision is remapped onto
 * `WARMUP_OCCUPIED_*` so the explanation says which of the two is the warm-up.
 * Telling an operator "the game clashes" when the clash is a warm-up sends them
 * to move the wrong thing.
 *
 * Bookings produced here are **occupancy and warm-up only**. Turnover is a
 * preference with a floor (GAP-11) and is reported in `windows.schedulable`,
 * not booked: treating a preference as occupied ground would reject legal
 * back-to-back play.
 *
 * @module timing/warmup
 */

import { checkBooking } from '../facility/eligibility.js';
import { getSurface } from '../facility/facilityGraph.js';
import { findFacilityConflicts, surfacesConflict } from '../facility/occupancy.js';
import {
  absorbFacilityMeta,
  createTimingMeta,
  formatTimingOrUnknown,
  mergeTimingMeta,
  warmupMinutesFor,
} from './formatTiming.js';
import {
  TIMING_REASON,
  TIMING_SEVERITY,
  WARMUP_CODE_BY_FACILITY_CODE,
  deriveTimingStatus,
  makeTimingFinding,
} from './reasonCodes.js';
import {
  EarliestKickoffQuerySchema,
  TimingFixtureSchema,
  WarmupWindowQuerySchema,
} from './schemas.js';
import { computeGameWindows } from './windows.js';

/**
 * Suffix that turns a fixture id into its warm-up booking id.
 *
 * Callers must not parse it back out — use the `bookingIndex` that
 * {@link buildTimingBookings} returns. It is documented only so a stored
 * booking id is recognisable to a human reading a log.
 */
export const WARMUP_BOOKING_SUFFIX = '@warmup';

/**
 * What the two booking builders accept.
 *
 * Looser than {@link import('./types.js').TimingFixture} on purpose: they are
 * called both with raw fixtures and with the output of
 * `TimingFixtureSchema.parse()`, and the two differ only in which keys the
 * schema has already defaulted.
 *
 * @typedef {Object} TimingFixtureLike
 * @property {string} id
 * @property {string} surfaceId
 * @property {string} date
 * @property {number} kickoffMinutes
 * @property {string|null} [format]
 * @property {string|null} [label]
 * @property {number|null} [warmupMinutes]
 */

/**
 * The warm-up booking id for a fixture.
 *
 * @param {string} fixtureId
 * @returns {string}
 */
export function warmupBookingId(fixtureId) {
  return `${fixtureId}${WARMUP_BOOKING_SUFFIX}`;
}

/**
 * The occupancy booking for a fixture: kickoff to the **worst-case** final
 * whistle.
 *
 * `endMinutes` is `null` when the format has no timing row, which is what makes
 * the facility layer report `OCCUPANCY_FOOTPRINT_UNKNOWN` for the corpus's four
 * `Scrimmage` rows instead of a fabricated all-clear (GAP-14).
 *
 * @param {import('./types.js').FormatTimingTable} table
 * @param {TimingFixtureLike} fixture - raw or already schema-parsed
 * @returns {import('../facility/types.js').FacilityBooking}
 */
export function gameBookingFor(table, fixture) {
  const timing = formatTimingOrUnknown(table, fixture.format);
  const endMinutes =
    timing.occupancyMinutes === null
      ? null
      : fixture.kickoffMinutes + timing.occupancyMinutes.scheduled;
  return {
    id: fixture.id,
    surfaceId: fixture.surfaceId,
    date: fixture.date,
    startMinutes: fixture.kickoffMinutes,
    endMinutes,
    format: fixture.format,
    label: fixture.label ?? fixture.id,
  };
}

/**
 * The warm-up booking for a fixture, or `null` when no warm-up length is
 * stated.
 *
 * The booking carries `format: null` on purpose. A warm-up needs *ground*, not
 * line markings, goals or a regulation-size pitch, and passing the game's
 * format would make `checkFieldEligibility()` demand all three of a kickabout.
 *
 * @param {import('./types.js').FormatTimingTable} table
 * @param {TimingFixtureLike} fixture - raw or already schema-parsed
 * @returns {{ booking: import('../facility/types.js').FacilityBooking|null, warmupMinutes: number|null, findings: import('./types.js').TimingFinding[] }}
 */
export function warmupBookingFor(table, fixture) {
  const warmupMinutes = warmupMinutesFor(table, fixture.format, fixture.warmupMinutes ?? null);
  if (warmupMinutes === null) {
    return {
      booking: null,
      warmupMinutes: null,
      findings: [
        makeTimingFinding(
          TIMING_REASON.WARMUP_DURATION_UNSPECIFIED,
          `fixture ${fixture.label ?? fixture.id} states no warm-up length, so no warm-up occupancy is claimed`,
          { fixtureId: fixture.id, format: fixture.format, surfaceId: fixture.surfaceId }
        ),
      ],
    };
  }
  return {
    warmupMinutes,
    findings: [],
    booking: {
      id: warmupBookingId(fixture.id),
      surfaceId: fixture.surfaceId,
      date: fixture.date,
      startMinutes: fixture.kickoffMinutes - warmupMinutes,
      endMinutes: fixture.kickoffMinutes,
      format: null,
      label: `warm-up: ${fixture.label ?? fixture.id}`,
    },
  };
}

/**
 * Turn fixtures into the bookings that actually claim ground.
 *
 * The returned `bookingIndex` is the supported way to ask what a booking is;
 * ids are opaque and must not be parsed.
 *
 * @param {import('./types.js').FormatTimingTable} table
 * @param {ReadonlyArray<TimingFixtureLike>} fixtures
 * @returns {{ bookings: import('../facility/types.js').FacilityBooking[], bookingIndex: Record<string, { kind: 'game'|'warmup', fixtureId: string, format: string|null, surfaceId: string }>, findings: import('./types.js').TimingFinding[], meta: import('./types.js').TimingMeta }}
 */
export function buildTimingBookings(table, fixtures) {
  const meta = createTimingMeta();
  /** @type {import('../facility/types.js').FacilityBooking[]} */
  const bookings = [];
  /** @type {Record<string, { kind: 'game'|'warmup', fixtureId: string, format: string|null, surfaceId: string }>} */
  const bookingIndex = {};
  /** @type {import('./types.js').TimingFinding[]} */
  const findings = [];

  for (const raw of fixtures) {
    const fixture = /** @type {import('./types.js').TimingFixture} */ (
      TimingFixtureSchema.parse(raw)
    );
    meta.formatsConsidered += 1;

    const game = gameBookingFor(table, fixture);
    bookings.push(game);
    bookingIndex[game.id] = {
      kind: 'game',
      fixtureId: fixture.id,
      format: fixture.format,
      surfaceId: fixture.surfaceId,
    };

    const warmup = warmupBookingFor(table, fixture);
    findings.push(...warmup.findings);
    if (warmup.booking) {
      meta.warmupBookingsBuilt += 1;
      bookings.push(warmup.booking);
      bookingIndex[warmup.booking.id] = {
        kind: 'warmup',
        fixtureId: fixture.id,
        format: fixture.format,
        surfaceId: fixture.surfaceId,
      };
    }
  }

  return { bookings, bookingIndex, findings, meta };
}

/**
 * Rewrite a facility finding about a warm-up booking into the warm-up
 * vocabulary, keeping the original code in `details.facilityCode` so nothing is
 * lost.
 *
 * @param {import('../facility/types.js').FacilityFinding} finding
 * @param {string} note - what to say about which side is the warm-up
 * @returns {import('./types.js').TimingFinding}
 */
function asWarmupFinding(finding, note) {
  const code = WARMUP_CODE_BY_FACILITY_CODE[finding.code];
  if (!code) return finding;
  return makeTimingFinding(code, `${note}: ${finding.message}`, {
    ...finding.details,
    facilityCode: finding.code,
  });
}

/**
 * The whole timing question for one fixture: are the windows well-defined, does
 * the game fit its ground, and **does the warm-up fit too**?
 *
 * Both bookings go through `checkBooking()`. Findings from the warm-up pass are
 * remapped so the two are told apart in the result.
 *
 * @param {import('../facility/types.js').FacilityGraph} graph
 * @param {import('./types.js').FormatTimingTable} table
 * @param {TimingFixtureLike} rawFixture
 * @param {{ existingBookings?: ReadonlyArray<import('../facility/types.js').FacilityBooking>, sizePolicy?: string, sizeRank?: Record<string, number>, dayStartMinutes?: number }} [options]
 * @returns {import('./types.js').TimingCheckResult & { windows: import('./types.js').GameTimingWindows, gameBooking: import('../facility/types.js').FacilityBooking, warmupBooking: import('../facility/types.js').FacilityBooking|null }}
 */
export function checkFixtureTiming(graph, table, rawFixture, options = {}) {
  const fixture = /** @type {import('./types.js').TimingFixture} */ (
    TimingFixtureSchema.parse(rawFixture)
  );
  const existingBookings = options.existingBookings ?? [];
  const meta = createTimingMeta();
  /** @type {import('./types.js').TimingFinding[]} */
  const findings = [];

  const windows = computeGameWindows(table, {
    format: fixture.format,
    kickoffMinutes: fixture.kickoffMinutes,
    date: fixture.date,
    warmupMinutes: fixture.warmupMinutes ?? null,
    dayStartMinutes: options.dayStartMinutes ?? 0,
  });
  findings.push(...windows.findings);
  mergeTimingMeta(meta, windows.meta);

  const gameBooking = gameBookingFor(table, fixture);
  const gameResult = checkBooking(graph, gameBooking, {
    existingBookings,
    sizePolicy: options.sizePolicy,
    sizeRank: options.sizeRank,
  });
  findings.push(...gameResult.findings);
  absorbFacilityMeta(meta, gameResult.meta);

  const warmup = warmupBookingFor(table, fixture);
  /** @type {import('../facility/types.js').FacilityBooking|null} */
  let warmupBooking = null;
  if (warmup.booking) {
    warmupBooking = warmup.booking;
    meta.warmupBookingsBuilt += 1;
    const warmupResult = checkBooking(graph, warmup.booking, {
      existingBookings,
      sizePolicy: options.sizePolicy,
      sizeRank: options.sizeRank,
    });
    for (const finding of warmupResult.findings) {
      findings.push(asWarmupFinding(finding, 'warm-up occupancy'));
    }
    absorbFacilityMeta(meta, warmupResult.meta);
  }
  // `computeGameWindows` already reported an unstated warm-up length; repeating
  // it here would double-count the same fact in one list.

  return {
    status: deriveTimingStatus(findings),
    findings,
    meta,
    windows,
    gameBooking,
    warmupBooking,
  };
}

/**
 * Scan a whole schedule, with warm-ups included, through the Phase 1.1 batch
 * conflict scanner.
 *
 * One call to `findFacilityConflicts()` over game *and* warm-up bookings; the
 * results are then classified by which side of each pair was a warm-up. That
 * classification is the only thing this function adds — the conflict detection
 * itself is entirely the facility module's.
 *
 * @param {import('../facility/types.js').FacilityGraph} graph
 * @param {import('./types.js').FormatTimingTable} table
 * @param {ReadonlyArray<TimingFixtureLike>} fixtures
 * @returns {{ conflicts: import('./types.js').TimingFinding[], gameConflicts: import('./types.js').TimingFinding[], warmupConflicts: import('./types.js').TimingFinding[], unknownFootprint: import('../facility/types.js').FacilityFinding[], unknownSurface: import('../facility/types.js').FacilityFinding[], bookings: import('../facility/types.js').FacilityBooking[], bookingIndex: Record<string, { kind: 'game'|'warmup', fixtureId: string, format: string|null, surfaceId: string }>, findings: import('./types.js').TimingFinding[], meta: import('./types.js').TimingMeta, stats: { fixtureCount: number, gameBookingCount: number, warmupBookingCount: number } }}
 */
export function findTimingConflicts(graph, table, fixtures) {
  const built = buildTimingBookings(table, fixtures);
  const meta = createTimingMeta();
  mergeTimingMeta(meta, built.meta);

  const scan = findFacilityConflicts(graph, built.bookings);
  absorbFacilityMeta(meta, scan.meta);

  /** @type {import('./types.js').TimingFinding[]} */
  const gameConflicts = [];
  /** @type {import('./types.js').TimingFinding[]} */
  const warmupConflicts = [];

  for (const finding of scan.conflicts) {
    const aId = /** @type {string} */ (finding.details.bookingAId);
    const bId = /** @type {string} */ (finding.details.bookingBId);
    const a = built.bookingIndex[aId];
    const b = built.bookingIndex[bId];
    const aWarm = a?.kind === 'warmup';
    const bWarm = b?.kind === 'warmup';
    if (!aWarm && !bWarm) {
      gameConflicts.push(finding);
      continue;
    }
    const note =
      aWarm && bWarm
        ? 'two warm-ups on the same ground'
        : 'a warm-up stands on ground a game is using';
    warmupConflicts.push(asWarmupFinding(finding, note));
  }

  return {
    conflicts: [...gameConflicts, ...warmupConflicts],
    gameConflicts,
    warmupConflicts,
    unknownFootprint: scan.unknownFootprint,
    unknownSurface: scan.unknownSurface,
    bookings: built.bookings,
    bookingIndex: built.bookingIndex,
    findings: built.findings,
    meta,
    stats: {
      fixtureCount: fixtures.length,
      gameBookingCount: Object.values(built.bookingIndex).filter((e) => e.kind === 'game').length,
      warmupBookingCount: Object.values(built.bookingIndex).filter((e) => e.kind === 'warmup')
        .length,
    },
  };
}

/**
 * Existing bookings that stand on ground conflicting with a surface, on a date.
 *
 * @param {import('../facility/types.js').FacilityGraph} graph
 * @param {string} surfaceId
 * @param {string} date
 * @param {ReadonlyArray<import('../facility/types.js').FacilityBooking>} existingBookings
 * @param {ReadonlyArray<string>} ignoreBookingIds
 * @param {import('./types.js').TimingMeta} meta
 * @returns {import('../facility/types.js').FacilityBooking[]}
 */
function conflictingBookingsOn(graph, surfaceId, date, existingBookings, ignoreBookingIds, meta) {
  const ignored = new Set(ignoreBookingIds);
  const surfacesSeen = new Set([surfaceId]);
  /** @type {import('../facility/types.js').FacilityBooking[]} */
  const out = [];
  for (const booking of existingBookings) {
    if (ignored.has(booking.id)) continue;
    if (booking.date !== date) continue;
    if (!getSurface(graph, booking.surfaceId)) continue;
    meta.bookingPairsCompared += 1;
    surfacesSeen.add(booking.surfaceId);
    const verdict = surfacesConflict(graph, surfaceId, booking.surfaceId);
    meta.cellPairsCompared += verdict.meta.cellPairsCompared;
    meta.overlapPairsConsulted += verdict.meta.overlapPairsConsulted;
    if (verdict.conflict) out.push(booking);
  }
  meta.surfacesConsidered += surfacesSeen.size;
  return out;
}

/**
 * How much on-pitch warm-up a given kickoff actually gets.
 *
 * The answer is bounded by everything standing on *conflicting* ground, not
 * just the pitch itself — which is the whole of incident 8. On the corpus's
 * busiest date the 10:00 AM 11v11 on Alder Pitch 2 gets 25 minutes, and the
 * thing that says so is a 9v9 on Pitch 1A finishing at 9:35.
 *
 * @param {import('../facility/types.js').FacilityGraph} graph
 * @param {import('./types.js').FormatTimingTable} table
 * @param {Object} rawQuery - see `WarmupWindowQuerySchema`
 * @param {{ existingBookings?: ReadonlyArray<import('../facility/types.js').FacilityBooking> }} [options]
 * @returns {import('./types.js').TimingCheckResult & { availableFromMinutes: number, availableMinutes: number, requestedMinutes: number|null, bounded: boolean, boundBy: { bookingId: string, surfaceId: string, surfaceName: string|null, endMinutes: number, sameSurface: boolean }|null, boundByBookingIds: string[] }}
 */
export function warmupWindowAvailability(graph, table, rawQuery, options = {}) {
  const query = WarmupWindowQuerySchema.parse(rawQuery);
  const meta = createTimingMeta();
  /** @type {import('./types.js').TimingFinding[]} */
  const findings = [];

  const requestedMinutes = warmupMinutesFor(table, query.format, query.warmupMinutes);
  if (requestedMinutes === null) {
    findings.push(
      makeTimingFinding(
        TIMING_REASON.WARMUP_DURATION_UNSPECIFIED,
        `no warm-up length is stated for ${query.format ?? '(no format)'}; the window is reported but nothing is judged against it`,
        { surfaceId: query.surfaceId, date: query.date, kickoffMinutes: query.kickoffMinutes }
      )
    );
  }

  const candidates = conflictingBookingsOn(
    graph,
    query.surfaceId,
    query.date,
    options.existingBookings ?? [],
    query.ignoreBookingIds,
    meta
  );

  let boundEnd = null;
  /** @type {import('../facility/types.js').FacilityBooking[]} */
  let binding = [];
  for (const booking of candidates) {
    if (booking.startMinutes >= query.kickoffMinutes) continue;
    if (booking.endMinutes === null) {
      findings.push(
        makeTimingFinding(
          TIMING_REASON.WARMUP_FOOTPRINT_UNKNOWN,
          `${booking.label ?? booking.id} stands on conflicting ground with no known end, so the warm-up window before minute ${query.kickoffMinutes} cannot be trusted`,
          {
            bookingId: booking.id,
            surfaceId: booking.surfaceId,
            date: booking.date,
            startMinutes: booking.startMinutes,
          }
        )
      );
      continue;
    }
    // Clip at kickoff: a booking that straddles the kickoff leaves no warm-up
    // window at all, and is separately a game collision.
    const clipped = Math.min(booking.endMinutes, query.kickoffMinutes);
    if (boundEnd === null || clipped > boundEnd) {
      boundEnd = clipped;
      binding = [booking];
    } else if (clipped === boundEnd) {
      binding.push(booking);
    }
  }

  const bounded = boundEnd !== null;
  // The day start bounds both branches. A booking that clears before the site
  // opens does not open it, and counting from that booking would report warm-up
  // minutes nobody may stand on the pitch for - which is a `WARMUP_WINDOW_SHORT`
  // that never fires.
  const dayStartMinutes = Math.min(query.dayStartMinutes, query.kickoffMinutes);
  const availableFromMinutes = bounded
    ? Math.max(/** @type {number} */ (boundEnd), dayStartMinutes)
    : dayStartMinutes;
  const availableMinutes = query.kickoffMinutes - availableFromMinutes;

  binding.sort((a, b) => a.id.localeCompare(b.id));
  const boundByBookingIds = binding.map((booking) => booking.id);
  const first = binding[0] ?? null;
  const boundBy = first
    ? {
        bookingId: first.id,
        surfaceId: first.surfaceId,
        surfaceName: getSurface(graph, first.surfaceId)?.name ?? null,
        endMinutes: /** @type {number} */ (first.endMinutes),
        sameSurface: first.surfaceId === query.surfaceId,
      }
    : null;

  if (!bounded) {
    findings.push(
      makeTimingFinding(
        TIMING_REASON.WARMUP_WINDOW_UNBOUNDED,
        `nothing already booked on conflicting ground bounds the warm-up before minute ${query.kickoffMinutes}`,
        { surfaceId: query.surfaceId, date: query.date, kickoffMinutes: query.kickoffMinutes }
      )
    );
  }

  if (requestedMinutes !== null && availableMinutes < requestedMinutes) {
    findings.push(
      makeTimingFinding(
        TIMING_REASON.WARMUP_WINDOW_SHORT,
        `only ${availableMinutes} min of on-pitch warm-up is available before minute ${query.kickoffMinutes}, against the ${requestedMinutes} min asked for`,
        {
          surfaceId: query.surfaceId,
          date: query.date,
          kickoffMinutes: query.kickoffMinutes,
          availableMinutes,
          requestedMinutes,
          availableFromMinutes,
          boundByBookingId: boundBy?.bookingId ?? null,
          boundBySurfaceId: boundBy?.surfaceId ?? null,
          boundBySameSurface: boundBy?.sameSurface ?? null,
        }
      )
    );
  }

  return {
    status: deriveTimingStatus(findings),
    findings,
    meta,
    availableFromMinutes,
    availableMinutes,
    requestedMinutes,
    bounded,
    boundBy,
    boundByBookingIds,
  };
}

/**
 * The inverse question: **what kickoff yields a full warm-up?**
 *
 * Returns the earliest kickoff at or after `notBeforeMinutes` for which both
 * the warm-up window and the game's own occupancy are free of blocking facility
 * findings. On the corpus's busiest date, asked of Alder Pitch 2 with a
 * 30-minute warm-up after the midday block, the answer is 3:25 PM — set by a
 * 9v9 finishing at 2:55 on the *overlapping* Pitch 1A, not by anything on Pitch
 * 2 itself.
 *
 * The search is exact rather than a scan: the earliest feasible warm-up start
 * is always either the earliest allowed minute or the end of some conflicting
 * booking, because the set of blocked minutes is a union of half-open intervals
 * and its complement's left endpoints are exactly those values.
 *
 * @param {import('../facility/types.js').FacilityGraph} graph
 * @param {import('./types.js').FormatTimingTable} table
 * @param {Object} rawQuery - see `EarliestKickoffQuerySchema`
 * @param {{ existingBookings?: ReadonlyArray<import('../facility/types.js').FacilityBooking>, sizePolicy?: string, sizeRank?: Record<string, number> }} [options]
 * @returns {import('./types.js').TimingCheckResult & { kickoffMinutes: number|null, warmupStartMinutes: number|null, warmupMinutes: number|null, occupancyEndMinutes: number|null, boundBy: { bookingIds: string[], surfaceIds: string[], endMinutes: number, sameSurfaceOnly: boolean }|null, candidatesTested: number }}
 */
export function earliestKickoffWithWarmup(graph, table, rawQuery, options = {}) {
  const query = EarliestKickoffQuerySchema.parse(rawQuery);
  // Ignored bookings are dropped once, here, so the `checkBooking()` probes
  // below see the same world the candidate generation does - the contract
  // `availability/kickoff.js` keeps. A probe that still sees the booking the
  // caller asked to ignore makes "move this game, ignoring where it currently
  // sits" unanswerable: the fixture blocks its own relocation.
  const ignored = new Set(query.ignoreBookingIds);
  const existingBookings = (options.existingBookings ?? []).filter(
    (booking) => !ignored.has(booking.id)
  );
  const meta = createTimingMeta();
  /** @type {import('./types.js').TimingFinding[]} */
  const findings = [];

  const timing = formatTimingOrUnknown(table, query.format);
  meta.formatsConsidered = 1;
  const warmupMinutes = warmupMinutesFor(table, query.format, query.warmupMinutes);

  /** @type {import('./types.js').TimingCheckResult & Record<string, unknown>} */
  const noAnswer = {
    status: '',
    findings,
    meta,
    kickoffMinutes: null,
    warmupStartMinutes: null,
    warmupMinutes,
    occupancyEndMinutes: null,
    boundBy: null,
    candidatesTested: 0,
  };

  if (timing.footprint === 'unknown' || timing.occupancyMinutes === null) {
    findings.push(...timing.findings);
    return /** @type {any} */ ({ ...noAnswer, status: deriveTimingStatus(findings) });
  }
  if (warmupMinutes === null) {
    findings.push(
      makeTimingFinding(
        TIMING_REASON.WARMUP_DURATION_UNSPECIFIED,
        `cannot answer "what kickoff yields a full warm-up?" without a stated warm-up length`,
        { surfaceId: query.surfaceId, date: query.date, format: query.format }
      )
    );
    return /** @type {any} */ ({ ...noAnswer, status: deriveTimingStatus(findings) });
  }

  const conflicting = conflictingBookingsOn(
    graph,
    query.surfaceId,
    query.date,
    existingBookings,
    query.ignoreBookingIds,
    meta
  );

  /** @type {Map<number, import('../facility/types.js').FacilityBooking[]>} */
  const endsAt = new Map();
  for (const booking of conflicting) {
    if (booking.endMinutes === null) {
      findings.push(
        makeTimingFinding(
          TIMING_REASON.WARMUP_FOOTPRINT_UNKNOWN,
          `${booking.label ?? booking.id} stands on conflicting ground with no known end, so the earliest legal kickoff cannot be trusted`,
          { bookingId: booking.id, surfaceId: booking.surfaceId, date: booking.date }
        )
      );
      continue;
    }
    if (booking.endMinutes < query.notBeforeMinutes) continue;
    const bucket = endsAt.get(booking.endMinutes) ?? [];
    bucket.push(booking);
    endsAt.set(booking.endMinutes, bucket);
  }

  const candidateStarts = [query.notBeforeMinutes, ...endsAt.keys()].sort((a, b) => a - b);
  const seen = new Set();

  for (const warmupStartMinutes of candidateStarts) {
    if (seen.has(warmupStartMinutes)) continue;
    seen.add(warmupStartMinutes);
    const kickoffMinutes = warmupStartMinutes + warmupMinutes;
    if (kickoffMinutes > query.notAfterMinutes) break;
    meta.candidateKickoffsTested += 1;

    const fixture = {
      id: '__timing_probe__',
      surfaceId: query.surfaceId,
      date: query.date,
      kickoffMinutes,
      format: query.format,
      label: 'candidate kickoff',
      warmupMinutes,
    };
    const gameBooking = gameBookingFor(table, fixture);
    const warmupBooking = /** @type {import('../facility/types.js').FacilityBooking} */ (
      warmupBookingFor(table, fixture).booking
    );
    meta.warmupBookingsBuilt += 1;

    const probeOptions = {
      existingBookings,
      sizePolicy: options.sizePolicy,
      sizeRank: options.sizeRank,
    };
    const gameResult = checkBooking(graph, gameBooking, probeOptions);
    absorbFacilityMeta(meta, gameResult.meta);
    const warmupResult = checkBooking(graph, warmupBooking, probeOptions);
    absorbFacilityMeta(meta, warmupResult.meta);

    const blocked = [...gameResult.findings, ...warmupResult.findings].some(
      (finding) => finding.severity === TIMING_SEVERITY.BLOCKING
    );
    if (blocked) continue;

    const bindingBookings = endsAt.get(warmupStartMinutes) ?? [];
    if (bindingBookings.length === 0) {
      findings.push(
        makeTimingFinding(
          TIMING_REASON.KICKOFF_UNBOUNDED,
          `the earliest allowed warm-up start (minute ${warmupStartMinutes}) was already free; nothing bounded it`,
          { surfaceId: query.surfaceId, date: query.date, notBeforeMinutes: query.notBeforeMinutes }
        )
      );
    } else {
      const surfaceIds = [...new Set(bindingBookings.map((b) => b.surfaceId))].sort();
      const sameSurfaceOnly = surfaceIds.every((id) => id === query.surfaceId);
      findings.push(
        makeTimingFinding(
          sameSurfaceOnly
            ? TIMING_REASON.KICKOFF_BOUND_BY_SAME_SURFACE
            : TIMING_REASON.KICKOFF_BOUND_BY_OTHER_SURFACE,
          `the earliest kickoff with a ${warmupMinutes}-minute warm-up is minute ${kickoffMinutes}, bounded by ${bindingBookings
            .map((b) => b.label ?? b.id)
            .join(', ')} ending at minute ${warmupStartMinutes}`,
          {
            surfaceId: query.surfaceId,
            date: query.date,
            kickoffMinutes,
            warmupStartMinutes,
            boundByBookingIds: bindingBookings.map((b) => b.id).sort(),
            boundBySurfaceIds: surfaceIds,
          }
        )
      );
    }

    return /** @type {any} */ ({
      status: deriveTimingStatus(findings),
      findings,
      meta,
      kickoffMinutes,
      warmupStartMinutes,
      warmupMinutes,
      occupancyEndMinutes: /** @type {number} */ (gameBooking.endMinutes),
      boundBy:
        bindingBookings.length === 0
          ? null
          : {
              bookingIds: bindingBookings.map((b) => b.id).sort(),
              surfaceIds: [...new Set(bindingBookings.map((b) => b.surfaceId))].sort(),
              endMinutes: warmupStartMinutes,
              sameSurfaceOnly: bindingBookings.every((b) => b.surfaceId === query.surfaceId),
            },
    });
  }

  findings.push(
    makeTimingFinding(
      TIMING_REASON.KICKOFF_SEARCH_EXHAUSTED,
      `no kickoff between minute ${query.notBeforeMinutes + warmupMinutes} and ${query.notAfterMinutes} on ${query.date} yields a ${warmupMinutes}-minute warm-up on this ground`,
      {
        surfaceId: query.surfaceId,
        date: query.date,
        format: query.format,
        warmupMinutes,
        notBeforeMinutes: query.notBeforeMinutes,
        notAfterMinutes: query.notAfterMinutes,
        candidatesTested: meta.candidateKickoffsTested,
      }
    )
  );
  return /** @type {any} */ ({
    ...noAnswer,
    status: deriveTimingStatus(findings),
    candidatesTested: meta.candidateKickoffsTested,
  });
}
