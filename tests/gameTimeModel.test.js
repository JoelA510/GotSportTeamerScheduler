/**
 * Tests for the game-time model (`packages/core/src/timing/`).
 *
 * The corpus is loaded once at module scope and every number is derived from
 * the fixture files - timings from `game_formats.csv`, geometry from
 * `facility_geometry.json`, kickoffs from `combined_schedule.csv`. The two
 * clock times the acceptance criteria name (2:55 PM and 3:25 PM) are *computed*
 * from the published schedule rather than typed in, so a change to the corpus
 * moves the expectation instead of silently invalidating it.
 *
 * Meta-assertion discipline (incident 4 in `fixtures/season-2026/README.md`):
 * every behavioural check also asserts it examined a non-zero number of
 * records. `meta.overlapPairsConsulted > 0` matters most here for exactly the
 * reason it does in `facilityGraph.test.js` - the entire point of this module is
 * that a warm-up on Pitch 2 collides with a game on Pitch 1A, and a graph that
 * had lost its overlap pairs would make that pass for the wrong reason.
 *
 * The two incidents under test:
 *   7. the halftime ambiguity - occupancy vs play time, worst-case ranges.
 *   8. warm-up is occupancy - a warm-up on overlapping ground is a real clash.
 */

import { describe, it, expect } from 'vitest';

import {
  formatClockMinutes,
  indexFormats,
  loadCombinedSchedule,
  loadFacilityGeometry,
  loadGameFormats,
} from '@squadlogic/core/fixtures/index.js';

import {
  FACILITY_REASON,
  buildFacilityGraphFromSeason2026,
  findFacilityConflicts,
  season2026SurfaceId,
} from '@squadlogic/core/facility/index.js';

import {
  SEASON_2026_INCIDENT_8_WARMUP_MINUTES,
  SEASON_2026_WARMUP_POLICY,
  TIMING_REASON,
  TIMING_REASON_SEVERITY,
  TIMING_SEVERITY,
  TIMING_STATUS,
  TimingFixtureSchema,
  WARMUP_BOOKING_SUFFIX,
  WARMUP_CODE_BY_FACILITY_CODE,
  buildFormatTimingTable,
  buildFormatTimingTableFromSeason2026,
  buildTimingBookings,
  checkFixtureTiming,
  computeGameWindows,
  deriveTimingStatus,
  earliestKickoffWithWarmup,
  findTimingConflicts,
  formatTimingOrUnknown,
  gameBookingFor,
  getFormatTiming,
  hasKnownFootprint,
  makeTimingFinding,
  occupancyEndMinutes,
  requireFormatTiming,
  timingSeverityOf,
  toFormatTimingInput,
  warmupBookingFor,
  warmupBookingId,
  warmupMinutesFor,
  warmupWindowAvailability,
} from '@squadlogic/core/timing/index.js';

/* -------------------------------------------------------------------------- */
/* Corpus, loaded once                                                         */
/* -------------------------------------------------------------------------- */

const geometry = loadFacilityGeometry();
const graph = buildFacilityGraphFromSeason2026(geometry);
const rawFormats = loadGameFormats();
const formatsByName = indexFormats(rawFormats);
const combinedGames = loadCombinedSchedule({ formatsByName });

const ALDER = 'Alder Park';
/** The warm-up length incident 8 is stated in terms of. */
const WARMUP = SEASON_2026_INCIDENT_8_WARMUP_MINUTES;

/** The table under test, with incident 8's warm-up policy stated explicitly. */
const table = buildFormatTimingTableFromSeason2026(rawFormats, {
  warmupPolicy: { '11v11': WARMUP },
});

/** The same table with no warm-up policy at all - the corpus's own default. */
const tableWithoutWarmup = buildFormatTimingTableFromSeason2026(rawFormats);

/** Shorthand for the opaque surface id of a corpus venue/field pair. */
const sid = (venueName, fieldName) => season2026SurfaceId(venueName, fieldName);

/** Turn a parsed corpus schedule row into a facility booking. */
const bookingOf = (game) => ({
  id: game.id,
  surfaceId: sid(game.venue, game.field),
  date: game.date,
  startMinutes: game.kickoffMinutes,
  endMinutes: game.endMinutes,
  format: game.format,
  label: `${game.homeLabel} v ${game.awayLabel}`,
});

/** Turn a parsed corpus schedule row into a timing fixture. */
const fixtureOf = (game, warmupMinutes = null) => ({
  id: game.id,
  surfaceId: sid(game.venue, game.field),
  date: game.date,
  kickoffMinutes: game.kickoffMinutes,
  format: game.format,
  label: `${game.homeLabel} v ${game.awayLabel}`,
  warmupMinutes,
});

const codesOf = (result) => result.findings.map((finding) => finding.code);
const blockingOf = (result) =>
  result.findings.filter((finding) => finding.severity === TIMING_SEVERITY.BLOCKING);

/**
 * The one date the incident-8 geometry actually occurs on: an 11v11 booked on
 * Alder Pitch 2 while 9v9 games run on the halves of the pitch it overlaps.
 * Derived, not typed in - and asserted to be unique, so nobody can quietly add
 * a second one and leave the test pointing at the wrong day.
 */
const incident8Dates = [
  ...new Set(
    combinedGames
      .filter((game) => game.venue === ALDER && game.field === 'Pitch 2' && game.format === '11v11')
      .map((game) => game.date)
  ),
].filter((date) =>
  combinedGames.some(
    (game) =>
      game.venue === ALDER &&
      game.date === date &&
      game.format === '9v9' &&
      (game.field === 'Pitch 1A' || game.field === 'Pitch 1B')
  )
);
const BUSY_DATE = incident8Dates[0];

/** Every Alder Park booking on that date, straight from the published schedule. */
const busyDayGames = combinedGames.filter(
  (game) => game.venue === ALDER && game.date === BUSY_DATE
);
const busyDayBookings = busyDayGames.map(bookingOf);

/** The last 9v9 to finish on Alder Pitch 1A that day: the 2:55 PM in incident 8. */
const afternoonNine = busyDayGames
  .filter((game) => game.field === 'Pitch 1A' && game.format === '9v9')
  .sort((a, b) => b.endMinutes - a.endMinutes)[0];

/** The morning 11v11 on Pitch 2: the 10:00 AM whose warm-up window is 25 minutes. */
const morningEleven = busyDayGames
  .filter((game) => game.field === 'Pitch 2' && game.format === '11v11')
  .sort((a, b) => a.kickoffMinutes - b.kickoffMinutes)[0];

/** The 9v9 that finishes at 9:35 AM and bounds that warm-up window. */
const morningNine = busyDayGames
  .filter(
    (game) =>
      game.format === '9v9' &&
      (game.field === 'Pitch 1A' || game.field === 'Pitch 1B') &&
      game.endMinutes <= morningEleven.kickoffMinutes
  )
  .sort((a, b) => b.endMinutes - a.endMinutes)[0];

/** The last already-booked Pitch 2 slot to clear, used as the search floor. */
const lastPitch2End = Math.max(
  ...busyDayGames.filter((game) => game.field === 'Pitch 2').map((game) => game.endMinutes)
);

/* -------------------------------------------------------------------------- */
/* Guard block - runs before anything behavioural                              */
/* -------------------------------------------------------------------------- */

describe('game time model :: corpus guard', () => {
  it('is built from the real game_formats.csv, not an empty shell', () => {
    // Without these, "margins use the worst case" would pass on a table that
    // contained no ranges at all.
    expect(table.stats.formatCount).toBe(rawFormats.length);
    expect(table.stats.formatCount).toBeGreaterThan(0);
    expect(table.stats.rangedOccupancyCount).toBe(1);
    expect(table.stats.rangedHalftimeCount).toBe(1);
    expect(table.stats.derivableBallInPlayCount).toBe(5);
    expect(table.stats.reconciledCount).toBe(5);
    expect(table.meta.formatsConsidered).toBe(rawFormats.length);
    expect(table.meta.reconciliationsPerformed).toBe(rawFormats.length);
    expect(table.meta.rangesCarried).toBeGreaterThan(0);
    expect(table.status).toBe(TIMING_STATUS.ALLOWED);
  });

  it('pins the incident-8 scenario to a single derived date and its real bookings', () => {
    expect(incident8Dates).toHaveLength(1);
    expect(BUSY_DATE).toBeTruthy();
    expect(busyDayBookings.length).toBeGreaterThan(0);
    expect(afternoonNine).toBeDefined();
    expect(morningEleven).toBeDefined();
    expect(morningNine).toBeDefined();

    // The two clock times the acceptance criteria name, derived rather than typed.
    expect(formatClockMinutes(afternoonNine.endMinutes)).toBe('14:55');
    expect(formatClockMinutes(morningNine.endMinutes)).toBe('09:35');
    expect(formatClockMinutes(morningEleven.kickoffMinutes)).toBe('10:00');

    // And the geometry that makes them a collision at all.
    const scan = findFacilityConflicts(graph, busyDayBookings);
    expect(scan.unknownSurface).toEqual([]);
    expect(scan.meta.overlapPairsConsulted).toBeGreaterThan(0);
  });

  it('never mints a booking id that collides with a real fixture id', () => {
    const fixtureIds = new Set(combinedGames.map((game) => game.id));
    for (const game of combinedGames) {
      expect(fixtureIds.has(warmupBookingId(game.id))).toBe(false);
    }
    expect(warmupBookingId('x')).toBe(`x${WARMUP_BOOKING_SUFFIX}`);
    expect(fixtureIds.size).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Acceptance test 1                                                           */
/* -------------------------------------------------------------------------- */

describe('game time model :: acceptance 1 - a warm-up on overlapping ground is rejected', () => {
  it('rejects a warm-up on Alder Pitch 2 that runs while a 9v9 holds Pitch 1A', () => {
    // Derived scenario: kick off on Pitch 2 exactly when the 9v9 on the
    // overlapping Pitch 1A finishes, so the 30-minute warm-up sits entirely
    // inside the 9v9's occupancy.
    const kickoffMinutes = afternoonNine.endMinutes;
    const warmupStart = kickoffMinutes - WARMUP;
    expect(formatClockMinutes(kickoffMinutes)).toBe('14:55');
    expect(formatClockMinutes(warmupStart)).toBe('14:25');

    const fixture = {
      id: 'candidate-eleven',
      surfaceId: sid(ALDER, 'Pitch 2'),
      date: BUSY_DATE,
      kickoffMinutes,
      format: '11v11',
      label: 'candidate 11v11',
      warmupMinutes: WARMUP,
    };

    const result = checkFixtureTiming(graph, table, fixture, {
      existingBookings: busyDayBookings,
    });

    expect(result.status).toBe(TIMING_STATUS.REJECTED);
    expect(codesOf(result)).toContain(TIMING_REASON.WARMUP_OCCUPIED_SPATIAL_OVERLAP);

    // The game itself is legal - only the warm-up is not. If this ever starts
    // failing, the model has begun blaming the wrong span.
    expect(codesOf(result)).not.toContain(FACILITY_REASON.OCCUPIED_SPATIAL_OVERLAP);

    // Meta-assertions: real pairs compared, and the overlap relation consulted.
    expect(result.meta.bookingPairsCompared).toBeGreaterThan(0);
    expect(result.meta.overlapPairsConsulted).toBeGreaterThan(0);
    expect(result.meta.warmupBookingsBuilt).toBe(1);
    expect(result.warmupBooking.startMinutes).toBe(warmupStart);
    expect(result.warmupBooking.endMinutes).toBe(kickoffMinutes);
  });

  it('names the 9v9 on Pitch 1A as the other side, and keeps the facility code', () => {
    const kickoffMinutes = afternoonNine.endMinutes;
    const result = checkFixtureTiming(
      graph,
      table,
      {
        id: 'candidate-eleven',
        surfaceId: sid(ALDER, 'Pitch 2'),
        date: BUSY_DATE,
        kickoffMinutes,
        format: '11v11',
        warmupMinutes: WARMUP,
      },
      { existingBookings: busyDayBookings }
    );

    const finding = result.findings.find(
      (entry) => entry.code === TIMING_REASON.WARMUP_OCCUPIED_SPATIAL_OVERLAP
    );
    expect(finding).toBeDefined();
    // Nothing is lost in the remap: the underlying facility verdict rides along.
    expect(finding.details.facilityCode).toBe(FACILITY_REASON.OCCUPIED_SPATIAL_OVERLAP);
    expect(finding.message).toContain('warm-up');
    expect([finding.details.surfaceAId, finding.details.surfaceBId]).toContain(
      sid(ALDER, 'Pitch 1A')
    );
    expect(finding.details.date).toBe(BUSY_DATE);
  });

  it('allows the identical kickoff once the warm-up requirement is dropped', () => {
    // This is the failure mode incident 8 describes, reproduced deliberately:
    // with warm-up unmodelled the very same kickoff looks perfectly legal.
    const kickoffMinutes = afternoonNine.endMinutes;
    const fixture = {
      id: 'candidate-eleven',
      surfaceId: sid(ALDER, 'Pitch 2'),
      date: BUSY_DATE,
      kickoffMinutes,
      format: '11v11',
    };

    const result = checkFixtureTiming(graph, tableWithoutWarmup, fixture, {
      existingBookings: busyDayBookings,
    });

    expect(blockingOf(result)).toEqual([]);
    expect(result.warmupBooking).toBeNull();
    // ...and the reason it looks legal is stated out loud rather than assumed.
    expect(codesOf(result)).toContain(TIMING_REASON.WARMUP_DURATION_UNSPECIFIED);
    expect(result.status).toBe(TIMING_STATUS.COMPROMISED);
    expect(result.meta.bookingPairsCompared).toBeGreaterThan(0);
  });

  it('allows the identical warm-up once it no longer overlaps the 9v9', () => {
    // The temporal control. Every Alder surface is busy that afternoon, so the
    // only way to isolate "concurrency caused this" is to move the kickoff by
    // exactly the warm-up length: the warm-up then starts as the 9v9 ends.
    const kickoffMinutes = afternoonNine.endMinutes + WARMUP;
    const result = checkFixtureTiming(
      graph,
      table,
      {
        id: 'candidate-eleven',
        surfaceId: sid(ALDER, 'Pitch 2'),
        date: BUSY_DATE,
        kickoffMinutes,
        format: '11v11',
        warmupMinutes: WARMUP,
      },
      { existingBookings: busyDayBookings }
    );

    expect(blockingOf(result)).toEqual([]);
    expect(result.warmupBooking.startMinutes).toBe(afternoonNine.endMinutes);
    expect(result.meta.overlapPairsConsulted).toBeGreaterThan(0);
  });

  it('blames the ground the warm-up actually stands on', () => {
    // The spatial control. Alder Pitch 3 overlaps Pitch 4, not Pitch 1, so the
    // same warm-up is still rejected there - but for a different neighbour. If
    // the geometry were not doing real work, both would name the same pitch.
    const kickoffMinutes = afternoonNine.endMinutes;
    const result = checkFixtureTiming(
      graph,
      table,
      {
        id: 'candidate-eleven',
        surfaceId: sid(ALDER, 'Pitch 3'),
        date: BUSY_DATE,
        kickoffMinutes,
        format: '11v11',
        warmupMinutes: WARMUP,
      },
      { existingBookings: busyDayBookings }
    );

    expect(result.status).toBe(TIMING_STATUS.REJECTED);
    const named = new Set(
      result.findings
        .filter((finding) => finding.code === TIMING_REASON.WARMUP_OCCUPIED_SPATIAL_OVERLAP)
        .flatMap((finding) => [finding.details.surfaceAId, finding.details.surfaceBId])
    );
    expect(named).toContain(sid(ALDER, 'Pitch 4A'));
    expect(named).toContain(sid(ALDER, 'Pitch 4B'));
    expect(named).not.toContain(sid(ALDER, 'Pitch 1A'));
    expect(result.meta.overlapPairsConsulted).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Acceptance test 2a - the reported window                                    */
/* -------------------------------------------------------------------------- */

describe('game time model :: acceptance 2a - the on-pitch warm-up window is 25 minutes', () => {
  it('reports 25 minutes for the 10:00 AM 11v11, bounded by the 9:35 AM 9v9', () => {
    const result = warmupWindowAvailability(
      graph,
      table,
      {
        surfaceId: sid(ALDER, 'Pitch 2'),
        date: BUSY_DATE,
        kickoffMinutes: morningEleven.kickoffMinutes,
        format: '11v11',
        warmupMinutes: WARMUP,
        ignoreBookingIds: [morningEleven.id],
      },
      { existingBookings: busyDayBookings }
    );

    // The number the acceptance criterion names, and the arithmetic behind it.
    expect(result.availableMinutes).toBe(25);
    expect(result.availableMinutes).toBe(morningEleven.kickoffMinutes - morningNine.endMinutes);
    expect(result.availableFromMinutes).toBe(morningNine.endMinutes);
    expect(formatClockMinutes(result.availableFromMinutes)).toBe('09:35');

    // 25 < 30, so this is a squeeze rather than a clash: compromised, not rejected.
    expect(result.status).toBe(TIMING_STATUS.COMPROMISED);
    expect(codesOf(result)).toContain(TIMING_REASON.WARMUP_WINDOW_SHORT);
    expect(blockingOf(result)).toEqual([]);

    // And the bound comes from *other* ground - the whole point of incident 8.
    expect(result.boundBy.sameSurface).toBe(false);
    expect(result.bounded).toBe(true);
    expect(result.meta.overlapPairsConsulted).toBeGreaterThan(0);
    expect(result.meta.bookingPairsCompared).toBeGreaterThan(0);
    expect(result.meta.surfacesConsidered).toBeGreaterThan(1);
  });

  it('names every booking tied at the bound, not just the first one found', () => {
    const result = warmupWindowAvailability(
      graph,
      table,
      {
        surfaceId: sid(ALDER, 'Pitch 2'),
        date: BUSY_DATE,
        kickoffMinutes: morningEleven.kickoffMinutes,
        format: '11v11',
        warmupMinutes: WARMUP,
        ignoreBookingIds: [morningEleven.id],
      },
      { existingBookings: busyDayBookings }
    );

    // Pitch 1A and 1B both finish at 9:35 and both overlap Pitch 2.
    expect(result.boundByBookingIds.length).toBeGreaterThan(1);
    const surfaces = new Set(
      result.boundByBookingIds.map(
        (id) => busyDayBookings.find((booking) => booking.id === id).surfaceId
      )
    );
    expect(surfaces).toEqual(new Set([sid(ALDER, 'Pitch 1A'), sid(ALDER, 'Pitch 1B')]));
  });

  it('reports the window without judging it when no warm-up length is stated', () => {
    const result = warmupWindowAvailability(
      graph,
      tableWithoutWarmup,
      {
        surfaceId: sid(ALDER, 'Pitch 2'),
        date: BUSY_DATE,
        kickoffMinutes: morningEleven.kickoffMinutes,
        format: '11v11',
        ignoreBookingIds: [morningEleven.id],
      },
      { existingBookings: busyDayBookings }
    );

    expect(result.availableMinutes).toBe(25);
    expect(result.requestedMinutes).toBeNull();
    expect(codesOf(result)).toContain(TIMING_REASON.WARMUP_DURATION_UNSPECIFIED);
    expect(codesOf(result)).not.toContain(TIMING_REASON.WARMUP_WINDOW_SHORT);
  });

  it('never counts warm-up minutes from before the day starts', () => {
    // The 9v9 clears at 9:35 but the site does not open until five minutes
    // after it: the window is what the *later* of the two allows. Counting from
    // the booking alone reports minutes nobody may stand on the pitch for, and
    // a window reported too long is a WARMUP_WINDOW_SHORT that never fires.
    const dayStartMinutes = morningNine.endMinutes + 5;
    const requestedMinutes = morningEleven.kickoffMinutes - morningNine.endMinutes;
    const result = warmupWindowAvailability(
      graph,
      table,
      {
        surfaceId: sid(ALDER, 'Pitch 2'),
        date: BUSY_DATE,
        kickoffMinutes: morningEleven.kickoffMinutes,
        format: '11v11',
        warmupMinutes: requestedMinutes,
        dayStartMinutes,
        ignoreBookingIds: [morningEleven.id],
      },
      { existingBookings: busyDayBookings }
    );

    expect(result.availableFromMinutes).toBe(dayStartMinutes);
    expect(result.availableMinutes).toBe(morningEleven.kickoffMinutes - dayStartMinutes);
    expect(result.availableMinutes).toBeLessThan(requestedMinutes);
    expect(codesOf(result)).toContain(TIMING_REASON.WARMUP_WINDOW_SHORT);
    expect(result.status).toBe(TIMING_STATUS.COMPROMISED);

    // Meta-assertions: a booking really did bound this window, so the clamp is
    // being tested on the bounded branch rather than on an empty day.
    expect(result.bounded).toBe(true);
    expect(result.boundByBookingIds.length).toBeGreaterThan(0);
    expect(result.boundBy.endMinutes).toBeLessThan(dayStartMinutes);
    expect(result.meta.bookingPairsCompared).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Acceptance test 2b - the inverse query                                      */
/* -------------------------------------------------------------------------- */

describe('game time model :: acceptance 2b - what kickoff yields a full 30-minute warm-up', () => {
  it('answers 3:25 PM, bounded by the 9v9 finishing at 2:55 PM on the overlapping field', () => {
    const result = earliestKickoffWithWarmup(
      graph,
      table,
      {
        surfaceId: sid(ALDER, 'Pitch 2'),
        date: BUSY_DATE,
        format: '11v11',
        warmupMinutes: WARMUP,
        // Search from the moment the day's last booked Pitch 2 slot clears -
        // derived from the published schedule, not chosen.
        notBeforeMinutes: lastPitch2End,
      },
      { existingBookings: busyDayBookings }
    );

    expect(result.kickoffMinutes).toBe(afternoonNine.endMinutes + WARMUP);
    expect(formatClockMinutes(result.kickoffMinutes)).toBe('15:25');
    expect(result.warmupStartMinutes).toBe(afternoonNine.endMinutes);
    expect(formatClockMinutes(result.warmupStartMinutes)).toBe('14:55');
    expect(result.warmupMinutes).toBe(WARMUP);
    expect(result.occupancyEndMinutes).toBe(
      result.kickoffMinutes + requireFormatTiming(table, '11v11').occupancyMinutes.scheduled
    );

    // Incident 8's actual lesson, as a machine-readable code.
    expect(codesOf(result)).toContain(TIMING_REASON.KICKOFF_BOUND_BY_OTHER_SURFACE);
    expect(result.boundBy.sameSurfaceOnly).toBe(false);
    expect(result.boundBy.surfaceIds).not.toContain(sid(ALDER, 'Pitch 2'));
    expect(result.boundBy.endMinutes).toBe(afternoonNine.endMinutes);

    // Meta-assertions: candidates really were tried, and rejected ones existed.
    expect(result.meta.candidateKickoffsTested).toBeGreaterThan(1);
    expect(result.meta.overlapPairsConsulted).toBeGreaterThan(0);
    expect(result.meta.warmupBookingsBuilt).toBeGreaterThan(1);
  });

  it('proves the earlier candidate it skipped really was illegal', () => {
    // The search floor itself would give a kickoff 30 minutes later; that one
    // collides with the afternoon 9v9. If it did not, "3:25 PM" would be an
    // answer to a question with no constraint in it.
    const skipped = lastPitch2End + WARMUP;
    expect(skipped).toBeLessThan(afternoonNine.endMinutes + WARMUP);

    const result = checkFixtureTiming(
      graph,
      table,
      {
        id: 'skipped-candidate',
        surfaceId: sid(ALDER, 'Pitch 2'),
        date: BUSY_DATE,
        kickoffMinutes: skipped,
        format: '11v11',
        warmupMinutes: WARMUP,
      },
      { existingBookings: busyDayBookings }
    );
    expect(result.status).toBe(TIMING_STATUS.REJECTED);
    expect(codesOf(result)).toContain(TIMING_REASON.WARMUP_OCCUPIED_SPATIAL_OVERLAP);
  });

  it('confirms the answer it returned is actually clean', () => {
    const answer = earliestKickoffWithWarmup(
      graph,
      table,
      {
        surfaceId: sid(ALDER, 'Pitch 2'),
        date: BUSY_DATE,
        format: '11v11',
        warmupMinutes: WARMUP,
        notBeforeMinutes: lastPitch2End,
      },
      { existingBookings: busyDayBookings }
    );

    const verified = checkFixtureTiming(
      graph,
      table,
      {
        id: 'verified-candidate',
        surfaceId: sid(ALDER, 'Pitch 2'),
        date: BUSY_DATE,
        kickoffMinutes: answer.kickoffMinutes,
        format: '11v11',
        warmupMinutes: WARMUP,
      },
      { existingBookings: busyDayBookings }
    );
    expect(blockingOf(verified)).toEqual([]);
  });

  it('refuses to answer at all when no warm-up length is stated', () => {
    const result = earliestKickoffWithWarmup(
      graph,
      tableWithoutWarmup,
      {
        surfaceId: sid(ALDER, 'Pitch 2'),
        date: BUSY_DATE,
        format: '11v11',
        notBeforeMinutes: lastPitch2End,
      },
      { existingBookings: busyDayBookings }
    );
    expect(result.kickoffMinutes).toBeNull();
    expect(codesOf(result)).toContain(TIMING_REASON.WARMUP_DURATION_UNSPECIFIED);
  });

  it('reports an exhausted search rather than inventing a kickoff', () => {
    const result = earliestKickoffWithWarmup(
      graph,
      table,
      {
        surfaceId: sid(ALDER, 'Pitch 2'),
        date: BUSY_DATE,
        format: '11v11',
        warmupMinutes: WARMUP,
        notBeforeMinutes: lastPitch2End,
        // A horizon that closes before any legal kickoff exists.
        notAfterMinutes: afternoonNine.endMinutes,
      },
      { existingBookings: busyDayBookings }
    );
    expect(result.kickoffMinutes).toBeNull();
    expect(result.status).toBe(TIMING_STATUS.REJECTED);
    expect(codesOf(result)).toContain(TIMING_REASON.KICKOFF_SEARCH_EXHAUSTED);
  });

  it('ignores the booking it was told to ignore, in the probes as well as the candidates', () => {
    // "Move this game, ignoring where it currently sits" is the re-solve query
    // Phase 4 is built on. Ignoring a booking must give the same answer as
    // never having had it - otherwise a fixture blocks its own relocation.
    const query = {
      surfaceId: sid(ALDER, 'Pitch 2'),
      date: BUSY_DATE,
      format: '11v11',
      warmupMinutes: WARMUP,
      // From the moment the morning 9v9s clear, so the ground the ignored
      // fixture is standing on is exactly the ground under test.
      notBeforeMinutes: morningNine.endMinutes,
      notAfterMinutes: afternoonNine.kickoffMinutes,
    };
    const ignoring = earliestKickoffWithWarmup(
      graph,
      table,
      { ...query, ignoreBookingIds: [morningEleven.id] },
      { existingBookings: busyDayBookings }
    );
    const without = earliestKickoffWithWarmup(graph, table, query, {
      existingBookings: busyDayBookings.filter((booking) => booking.id !== morningEleven.id),
    });

    expect(ignoring.kickoffMinutes).toBe(without.kickoffMinutes);
    expect(ignoring.kickoffMinutes).toBe(morningNine.endMinutes + WARMUP);
    expect(ignoring.warmupStartMinutes).toBe(morningNine.endMinutes);
    expect(codesOf(ignoring)).not.toContain(TIMING_REASON.KICKOFF_SEARCH_EXHAUSTED);
    expect(blockingOf(ignoring)).toEqual([]);

    // Meta-assertion: the ignored booking really was in the way. Without the
    // ignore list the same question has no answer at all inside this horizon,
    // so the test cannot be passing because the fixture was harmless.
    const control = earliestKickoffWithWarmup(graph, table, query, {
      existingBookings: busyDayBookings,
    });
    expect(control.kickoffMinutes).toBeNull();
    expect(codesOf(control)).toContain(TIMING_REASON.KICKOFF_SEARCH_EXHAUSTED);
    expect(ignoring.meta.candidateKickoffsTested).toBeGreaterThan(0);
    expect(ignoring.meta.overlapPairsConsulted).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Incident 7 - occupancy vs play time                                         */
/* -------------------------------------------------------------------------- */

describe('game time model :: occupancy is not play time (GAP-09, incident 7)', () => {
  it('models 11v11 as 2x40 of ball-in-play inside 85-90 of occupancy', () => {
    const eleven = requireFormatTiming(table, '11v11');
    expect(eleven.halves).toBe(2);
    expect(eleven.halfMinutes).toBe(40);
    expect(eleven.ballInPlayMinutes).toBe(80);
    expect(eleven.halftimeMinutes).toEqual({ min: 5, max: 10 });
    expect(eleven.occupancyMinutes.min).toBe(85);
    expect(eleven.occupancyMinutes.max).toBe(90);
    // The flat-90 model incident 7 nearly shipped would have made these equal.
    expect(eleven.ballInPlayMinutes).not.toBe(eleven.occupancyMinutes.scheduled);
  });

  it('reconciles halves x half + halftime against the declared occupancy, every format', () => {
    let reconciled = 0;
    for (const name of table.formatNames) {
      const timing = table.formats[name];
      if (timing.derivedOccupancyMinutes === null) continue;
      reconciled += 1;
      expect(timing.derivedOccupancyMinutes.min).toBe(timing.occupancyMinutes.min);
      expect(timing.derivedOccupancyMinutes.max).toBe(timing.occupancyMinutes.max);
      expect(
        timing.findings.some(
          (finding) => finding.code === TIMING_REASON.OCCUPANCY_DERIVATION_AGREES
        )
      ).toBe(true);
    }
    // Meta-assertion: a table whose derivations had all gone null would pass the
    // loop above without comparing anything.
    expect(reconciled).toBe(5);
  });

  it('carries the corpus values the build plan names, format by format', () => {
    // 4v4 2x15+5=35, 5v5 2x20+5=45, 7v7 2x25+5=55, 9v9 2x30+5=65.
    const expected = {
      '4v4': { halves: 2, half: 15, halftime: 5, occupancy: 35 },
      '5v5': { halves: 2, half: 20, halftime: 5, occupancy: 45 },
      '7v7': { halves: 2, half: 25, halftime: 5, occupancy: 55 },
      '9v9': { halves: 2, half: 30, halftime: 5, occupancy: 65 },
    };
    for (const [format, want] of Object.entries(expected)) {
      const timing = requireFormatTiming(table, format);
      expect(timing.halves).toBe(want.halves);
      expect(timing.halfMinutes).toBe(want.half);
      expect(timing.halftimeMinutes).toEqual({ min: want.halftime, max: want.halftime });
      expect(timing.ballInPlayMinutes).toBe(want.halves * want.half);
      expect(timing.occupancyMinutes.scheduled).toBe(want.occupancy);
    }
  });

  it('fires OCCUPANCY_DERIVATION_DISAGREES when the two stop agreeing', () => {
    // The mutation incident 7 is about: 9v9 restated as 2x35 while its declared
    // occupancy stays 65. A table that cannot notice this is a table that would
    // have let the published margins go tight in silence.
    const mutated = toFormatTimingInput(rawFormats);
    const nine = mutated.formats.find((entry) => entry.format === '9v9');
    nine.halfMinutes = 35;

    const broken = buildFormatTimingTable(mutated);
    expect(broken.status).toBe(TIMING_STATUS.REJECTED);
    expect(broken.formats['9v9'].findings.map((finding) => finding.code)).toContain(
      TIMING_REASON.OCCUPANCY_DERIVATION_DISAGREES
    );
    // Every other format is untouched, so this is a targeted failure not a
    // blanket one.
    expect(broken.formats['11v11'].findings.map((finding) => finding.code)).toContain(
      TIMING_REASON.OCCUPANCY_DERIVATION_AGREES
    );
  });

  it('decomposes a kickoff into first half, halftime and second half', () => {
    const windows = computeGameWindows(table, {
      format: '11v11',
      kickoffMinutes: morningEleven.kickoffMinutes,
      date: BUSY_DATE,
      warmupMinutes: WARMUP,
    });
    const k = morningEleven.kickoffMinutes;
    expect(windows.firstHalf).toEqual({ startMinutes: k, endMinutes: k + 40, minutes: 40 });
    expect(windows.halftime.startMinutes).toBe(k + 40);
    expect(windows.halftime.earliestEndMinutes).toBe(k + 45);
    expect(windows.halftime.latestEndMinutes).toBe(k + 50);
    expect(windows.secondHalf.earliestEndMinutes).toBe(k + 85);
    expect(windows.secondHalf.latestEndMinutes).toBe(k + 90);
    expect(windows.meta.windowsComputed).toBe(1);
  });

  it('leaves Minis without a derived play time rather than inventing halves', () => {
    const minis = requireFormatTiming(table, 'Minis');
    expect(minis.halves).toBeNull();
    expect(minis.halfMinutes).toBeNull();
    expect(minis.ballInPlayMinutes).toBeNull();
    expect(minis.derivedOccupancyMinutes).toBeNull();
    expect(minis.occupancyMinutes.scheduled).toBe(30);
    expect(minis.findings.map((finding) => finding.code)).toContain(
      TIMING_REASON.PLAY_TIME_UNDERIVABLE
    );
    expect(minis.findings.map((finding) => finding.code)).toContain(
      TIMING_REASON.HALFTIME_UNDECLARED
    );
  });
});

/* -------------------------------------------------------------------------- */
/* GAP-10 - halftime as a range, margins against the worst case                */
/* -------------------------------------------------------------------------- */

describe('game time model :: halftime is a range and margins use the worst case (GAP-10)', () => {
  it('keeps both ends of the 11v11 occupancy and schedules against the worst', () => {
    const eleven = requireFormatTiming(table, '11v11');
    expect(eleven.halftimeIsRange).toBe(true);
    expect(eleven.occupancyMinutes.scheduled).toBe(90);
    expect(eleven.occupancyMinutes.scheduled).toBe(eleven.occupancyMinutes.max);
    // The corpus's own instruction, preserved verbatim.
    expect(eleven.occupancyMinutes.note).toContain('schedule as 90');
  });

  it('reports the best case alongside the worst, never instead of it', () => {
    const k = morningEleven.kickoffMinutes;
    const windows = computeGameWindows(table, {
      format: '11v11',
      kickoffMinutes: k,
      date: BUSY_DATE,
      warmupMinutes: WARMUP,
    });
    expect(windows.occupancy.endMinutes).toBe(k + 90);
    expect(windows.occupancy.bestCaseEndMinutes).toBe(k + 85);
    expect(windows.occupancy.bestCaseEndMinutes).toBeLessThan(windows.occupancy.endMinutes);
    expect(windows.meta.rangesCarried).toBeGreaterThan(0);
    // The reason the two numbers differ is stated, not left to be inferred.
    expect(windows.findings.map((finding) => finding.code)).toContain(
      TIMING_REASON.HALFTIME_IS_RANGE
    );
  });

  it('books the worst case, so a five-minute halftime never buys a booking through', () => {
    const booking = gameBookingFor(table, {
      id: 'worst-case',
      surfaceId: sid(ALDER, 'Pitch 2'),
      date: BUSY_DATE,
      kickoffMinutes: morningEleven.kickoffMinutes,
      format: '11v11',
      label: null,
      warmupMinutes: null,
    });
    expect(booking.endMinutes).toBe(morningEleven.kickoffMinutes + 90);

    const ends = occupancyEndMinutes(table, '11v11', morningEleven.kickoffMinutes);
    expect(ends.endMinutes).toBe(booking.endMinutes);
    expect(ends.bestCaseEndMinutes).toBe(morningEleven.kickoffMinutes + 85);
  });

  it('collapses to a point range for every fixed-halftime format', () => {
    const ranged = table.formatNames.filter((name) => table.formats[name].halftimeIsRange);
    expect(ranged).toEqual(['11v11']);
    for (const name of table.formatNames) {
      const timing = table.formats[name];
      if (timing.halftimeMinutes === null) continue;
      if (name === '11v11') continue;
      expect(timing.halftimeMinutes.min).toBe(timing.halftimeMinutes.max);
      expect(timing.occupancyMinutes.min).toBe(timing.occupancyMinutes.max);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* GAP-11 - block, turnover, and the warm-up that is not in either             */
/* -------------------------------------------------------------------------- */

describe('game time model :: block and turnover, and what the block leaves out (GAP-11)', () => {
  it('carries the declared block and both turnover values for every format', () => {
    const expected = {
      Minis: { block: 50, preferred: 20, floor: 20 },
      '4v4': { block: 55, preferred: 20, floor: 10 },
      '5v5': { block: 65, preferred: 20, floor: 10 },
      '7v7': { block: 75, preferred: 20, floor: 10 },
      '9v9': { block: 85, preferred: 20, floor: 10 },
      '11v11': { block: 120, preferred: 30, floor: 20 },
    };
    for (const [format, want] of Object.entries(expected)) {
      const timing = requireFormatTiming(table, format);
      expect(timing.blockMinutes).toBe(want.block);
      expect(timing.turnoverPreferredMinutes).toBe(want.preferred);
      expect(timing.turnoverMinMinutes).toBe(want.floor);
    }
  });

  it('records that no format leaves room for warm-up inside its block', () => {
    // This is the structural reason incident 8 was invisible: the number
    // everybody treated as "the schedulable footprint" never held the warm-up.
    let checked = 0;
    for (const name of table.formatNames) {
      const timing = table.formats[name];
      checked += 1;
      expect(timing.warmupInsideBlock).toBe(false);
      expect(timing.blockSlackMinutes).toBe(timing.turnoverPreferredMinutes);
      expect(timing.findings.map((finding) => finding.code)).toContain(
        TIMING_REASON.BLOCK_EXCLUDES_WARMUP
      );
    }
    expect(checked).toBe(rawFormats.length);
  });

  it('reads the corpus note that 11v11 turnover is already inside the block', () => {
    const eleven = requireFormatTiming(table, '11v11');
    expect(eleven.turnoverInsideBlock).toBe(true);
    expect(eleven.findings.map((finding) => finding.code)).toContain(
      TIMING_REASON.TURNOVER_INSIDE_BLOCK
    );
    // And that no other format claims it.
    for (const name of table.formatNames) {
      if (name === '11v11') continue;
      expect(table.formats[name].turnoverInsideBlock).toBe(false);
    }
  });

  it('keeps the declared block and the schedulable footprint as different spans', () => {
    const k = morningEleven.kickoffMinutes;
    const windows = computeGameWindows(table, {
      format: '11v11',
      kickoffMinutes: k,
      date: BUSY_DATE,
      warmupMinutes: WARMUP,
    });
    // Declared block: kickoff-relative, 120 minutes.
    expect(windows.block).toEqual({ startMinutes: k, endMinutes: k + 120, minutes: 120 });
    // Schedulable footprint: warm-up start through end of turnover, 150 minutes.
    expect(windows.schedulable.startMinutes).toBe(k - WARMUP);
    expect(windows.schedulable.endMinutes).toBe(k + 90 + 30);
    expect(windows.schedulable.minutes).toBe(WARMUP + 90 + 30);
    expect(windows.schedulable.minutes).toBeGreaterThan(windows.block.minutes);
  });

  it('measures the block against the warm-up it was given, not against turnover alone', () => {
    // A block with room to spare beyond its turnover still excludes a warm-up
    // longer than what is left over. Comparing the slack with the turnover
    // alone cannot establish that the block holds a warm-up, because it never
    // looks at how long the warm-up is.
    const leftoverMinutes = WARMUP - 10;
    const mutated = toFormatTimingInput(rawFormats, { warmupPolicy: { '9v9': WARMUP } });
    const nine = mutated.formats.find((entry) => entry.format === '9v9');
    nine.blockMinutes =
      nine.occupancyMinutes.scheduled + nine.turnoverPreferredMinutes + leftoverMinutes;
    const timing = requireFormatTiming(buildFormatTimingTable(mutated), '9v9');

    // The slack really does clear the turnover - the condition that used to be
    // the whole test - and still leaves too little for the warm-up.
    expect(timing.blockSlackMinutes).toBeGreaterThan(timing.turnoverPreferredMinutes);
    expect(timing.warmupMinutes).toBe(WARMUP);
    expect(timing.blockSlackMinutes - timing.turnoverPreferredMinutes).toBe(leftoverMinutes);
    expect(leftoverMinutes).toBeLessThan(WARMUP);
    expect(timing.warmupInsideBlock).toBe(false);
    expect(timing.findings.map((finding) => finding.code)).toContain(
      TIMING_REASON.BLOCK_EXCLUDES_WARMUP
    );

    // And a block genuinely wide enough to hold the warm-up says so, so the
    // check is not simply always false.
    const roomy = toFormatTimingInput(rawFormats, { warmupPolicy: { '9v9': WARMUP } });
    const roomyNine = roomy.formats.find((entry) => entry.format === '9v9');
    roomyNine.blockMinutes =
      roomyNine.occupancyMinutes.scheduled + roomyNine.turnoverPreferredMinutes + WARMUP;
    const held = requireFormatTiming(buildFormatTimingTable(roomy), '9v9');
    expect(held.warmupInsideBlock).toBe(true);
    expect(held.findings.map((finding) => finding.code)).not.toContain(
      TIMING_REASON.BLOCK_EXCLUDES_WARMUP
    );
  });

  it('flags a block that could not hold its own occupancy', () => {
    const mutated = toFormatTimingInput(rawFormats);
    const nine = mutated.formats.find((entry) => entry.format === '9v9');
    nine.blockMinutes = 60; // shorter than its own 65-minute occupancy
    const broken = buildFormatTimingTable(mutated);
    expect(broken.formats['9v9'].findings.map((finding) => finding.code)).toContain(
      TIMING_REASON.BLOCK_SHORTER_THAN_OCCUPANCY
    );
    expect(broken.status).toBe(TIMING_STATUS.REJECTED);
  });
});

/* -------------------------------------------------------------------------- */
/* GAP-14 - a format with no timing definition stays unknown                   */
/* -------------------------------------------------------------------------- */

describe('game time model :: Scrimmage keeps an explicit unknown footprint (GAP-14)', () => {
  const scrimmages = combinedGames.filter((game) => game.format === 'Scrimmage');

  it('finds the corpus rows this is about', () => {
    expect(scrimmages.length).toBeGreaterThan(0);
    expect(rawFormats.some((format) => format.format === 'Scrimmage')).toBe(false);
  });

  it('has no timing row and never invents one', () => {
    expect(getFormatTiming(table, 'Scrimmage')).toBeNull();
    expect(hasKnownFootprint(table, 'Scrimmage')).toBe(false);
    expect(() => requireFormatTiming(table, 'Scrimmage')).toThrow(/unknown format/);

    const unknown = formatTimingOrUnknown(table, 'Scrimmage');
    expect(unknown.footprint).toBe('unknown');
    expect(unknown.occupancyMinutes).toBeNull();
    expect(unknown.blockMinutes).toBeNull();
    expect(unknown.ballInPlayMinutes).toBeNull();
    expect(unknown.findings.map((finding) => finding.code)).toEqual([
      TIMING_REASON.FORMAT_TIMING_UNDEFINED,
    ]);
  });

  it('produces a booking with a null end, exactly as the fixture loader does', () => {
    for (const game of scrimmages) {
      const booking = gameBookingFor(table, TimingFixtureSchema.parse(fixtureOf(game)));
      expect(booking.endMinutes).toBeNull();
      // The two independent paths agree that the footprint is unknown.
      expect(game.endMinutes).toBeNull();
    }
    expect(scrimmages.length).toBeGreaterThan(0);
  });

  it('reports an unknown footprint rather than a clean pass on the whole corpus', () => {
    const scan = findTimingConflicts(
      graph,
      table,
      combinedGames.map((game) => fixtureOf(game))
    );
    expect(scan.unknownFootprint.length).toBe(scrimmages.length);
    for (const finding of scan.unknownFootprint) {
      expect(finding.code).toBe(FACILITY_REASON.OCCUPANCY_FOOTPRINT_UNKNOWN);
    }
  });

  it('yields null windows and a compromised status, not a plausible number', () => {
    const windows = computeGameWindows(table, {
      format: 'Scrimmage',
      kickoffMinutes: 17 * 60,
      date: BUSY_DATE,
      warmupMinutes: WARMUP,
    });
    expect(windows.footprint).toBe('unknown');
    expect(windows.occupancy).toBeNull();
    expect(windows.block).toBeNull();
    expect(windows.schedulable).toBeNull();
    // The warm-up is still known - it does not depend on the game's length.
    expect(windows.warmup.minutes).toBe(WARMUP);
    expect(windows.status).toBe(TIMING_STATUS.COMPROMISED);
    expect(windows.findings.map((finding) => finding.code)).toContain(
      TIMING_REASON.FORMAT_TIMING_UNDEFINED
    );
  });
});

/* -------------------------------------------------------------------------- */
/* GAP-27 - warm-up occupancy flows through the Phase 1.1 machinery            */
/* -------------------------------------------------------------------------- */

describe('game time model :: warm-up occupancy runs through the facility graph (GAP-27)', () => {
  it('builds one game booking and one warm-up booking per fixture', () => {
    const fixtures = busyDayGames.map((game) => fixtureOf(game, WARMUP));
    const built = buildTimingBookings(table, fixtures);

    expect(built.bookings.length).toBe(fixtures.length * 2);
    expect(built.meta.warmupBookingsBuilt).toBe(fixtures.length);
    const kinds = Object.values(built.bookingIndex).map((entry) => entry.kind);
    expect(kinds.filter((kind) => kind === 'game').length).toBe(fixtures.length);
    expect(kinds.filter((kind) => kind === 'warmup').length).toBe(fixtures.length);

    for (const fixture of fixtures) {
      const warmup = built.bookings.find((booking) => booking.id === warmupBookingId(fixture.id));
      expect(warmup.startMinutes).toBe(fixture.kickoffMinutes - WARMUP);
      expect(warmup.endMinutes).toBe(fixture.kickoffMinutes);
      // Ground, not a regulation pitch: the warm-up carries no format, so it is
      // never asked to satisfy size, lining or equipment.
      expect(warmup.format).toBeNull();
    }
  });

  it('finds warm-up clashes the published season hides, and no game clashes', () => {
    const scan = findTimingConflicts(
      graph,
      table,
      busyDayGames.map((game) => fixtureOf(game, WARMUP))
    );

    // The published games are legal - that is a known-good corpus invariant.
    expect(scan.gameConflicts).toEqual([]);
    // The warm-ups are not, and this is incident 8 as a number.
    expect(scan.warmupConflicts.length).toBeGreaterThan(0);
    for (const finding of scan.warmupConflicts) {
      expect(finding.code.startsWith('WARMUP_')).toBe(true);
      expect(finding.message).toContain('warm-up');
    }
    expect(scan.stats.warmupBookingCount).toBe(busyDayGames.length);
    expect(scan.meta.bookingPairsCompared).toBeGreaterThan(0);
    expect(scan.meta.overlapPairsConsulted).toBeGreaterThan(0);
  });

  it('finds nothing at all once warm-ups are not modelled - the source-project view', () => {
    const scan = findTimingConflicts(
      graph,
      tableWithoutWarmup,
      busyDayGames.map((game) => fixtureOf(game))
    );
    expect(scan.stats.warmupBookingCount).toBe(0);
    expect(scan.warmupConflicts).toEqual([]);
    expect(scan.gameConflicts).toEqual([]);
    // The silence is explained rather than presented as a pass.
    expect(scan.findings.map((finding) => finding.code)).toContain(
      TIMING_REASON.WARMUP_DURATION_UNSPECIFIED
    );
  });

  it('agrees with the published season across the whole corpus on games alone', () => {
    // Cross-check of the two independent paths: bookings derived from the
    // timing table must reproduce the corpus invariant "no two concurrent games
    // on an overlapping pair".
    const scan = findTimingConflicts(
      graph,
      table,
      combinedGames.map((game) => fixtureOf(game))
    );
    expect(scan.unknownSurface).toEqual([]);
    expect(scan.gameConflicts).toEqual([]);
    expect(scan.stats.fixtureCount).toBe(combinedGames.length);
    expect(scan.meta.bookingPairsCompared).toBeGreaterThan(0);
  });

  it('derives the same occupancy end as the fixture loader, row for row', () => {
    let compared = 0;
    for (const game of combinedGames) {
      const booking = gameBookingFor(table, TimingFixtureSchema.parse(fixtureOf(game)));
      expect(booking.endMinutes).toBe(game.endMinutes);
      compared += 1;
    }
    // Meta-assertion: an empty corpus would make the loop above vacuous.
    expect(compared).toBe(combinedGames.length);
    expect(compared).toBeGreaterThan(0);
  });

  it('does not reimplement overlap detection - the warm-up booking is a facility booking', () => {
    // Feeding a warm-up booking straight to the Phase 1.1 scanner must produce
    // the same clash the timing layer reports. If these two ever diverge, the
    // timing module has grown its own copy of the overlap rule.
    const kickoffMinutes = afternoonNine.endMinutes;
    const fixture = TimingFixtureSchema.parse({
      id: 'candidate-eleven',
      surfaceId: sid(ALDER, 'Pitch 2'),
      date: BUSY_DATE,
      kickoffMinutes,
      format: '11v11',
      warmupMinutes: WARMUP,
    });
    const warmup = warmupBookingFor(table, fixture).booking;

    const facilityScan = findFacilityConflicts(graph, [...busyDayBookings, warmup]);
    const direct = facilityScan.conflicts.filter(
      (finding) =>
        finding.details.bookingAId === warmup.id || finding.details.bookingBId === warmup.id
    );
    expect(direct.length).toBeGreaterThan(0);
    for (const finding of direct) {
      expect(finding.code).toBe(FACILITY_REASON.OCCUPIED_SPATIAL_OVERLAP);
    }

    const viaTiming = checkFixtureTiming(graph, table, fixture, {
      existingBookings: busyDayBookings,
    });
    expect(
      viaTiming.findings.filter(
        (finding) => finding.code === TIMING_REASON.WARMUP_OCCUPIED_SPATIAL_OVERLAP
      ).length
    ).toBe(direct.length);
  });
});

/* -------------------------------------------------------------------------- */
/* Reason codes, statuses and schema strictness                                */
/* -------------------------------------------------------------------------- */

describe('game time model :: reason codes and statuses', () => {
  it('registers a severity for every reason code, and nothing else', () => {
    const codes = Object.values(TIMING_REASON);
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) {
      expect(Object.values(TIMING_SEVERITY)).toContain(timingSeverityOf(code));
    }
    expect(Object.keys(TIMING_REASON_SEVERITY).sort()).toEqual([...codes].sort());
    expect(() => timingSeverityOf('NOT_A_CODE')).toThrow(/no registered severity/);
  });

  it('shares its severity and status vocabulary with the facility module', () => {
    // A warm-up finding and a facility finding land in the same list; if
    // "blocking" ever meant two different things, one of them would stop
    // counting.
    expect(TIMING_SEVERITY.BLOCKING).toBe('blocking');
    expect(TIMING_STATUS.REJECTED).toBe('rejected');
    expect(
      deriveTimingStatus([
        makeTimingFinding(TIMING_REASON.HALFTIME_IS_RANGE, 'info only'),
        {
          code: FACILITY_REASON.OCCUPIED_SPATIAL_OVERLAP,
          severity: 'blocking',
          message: '',
          details: {},
        },
      ])
    ).toBe(TIMING_STATUS.REJECTED);
  });

  it('derives status mechanically rather than letting a call site write one', () => {
    expect(deriveTimingStatus([])).toBe(TIMING_STATUS.ALLOWED);
    expect(deriveTimingStatus([makeTimingFinding(TIMING_REASON.HALFTIME_IS_RANGE, 'x')])).toBe(
      TIMING_STATUS.ALLOWED
    );
    expect(deriveTimingStatus([makeTimingFinding(TIMING_REASON.WARMUP_WINDOW_SHORT, 'x')])).toBe(
      TIMING_STATUS.COMPROMISED
    );
    expect(
      deriveTimingStatus([
        makeTimingFinding(TIMING_REASON.WARMUP_WINDOW_SHORT, 'x'),
        makeTimingFinding(TIMING_REASON.WARMUP_OCCUPIED_PARENT_CHILD, 'y'),
      ])
    ).toBe(TIMING_STATUS.REJECTED);
  });

  it('maps every facility occupancy code onto a warm-up counterpart', () => {
    const occupancyCodes = [
      FACILITY_REASON.OCCUPIED_SAME_SURFACE,
      FACILITY_REASON.OCCUPIED_PARENT_CHILD,
      FACILITY_REASON.OCCUPIED_SPATIAL_OVERLAP,
      FACILITY_REASON.OCCUPANCY_FOOTPRINT_UNKNOWN,
    ];
    // A facility occupancy code with no warm-up counterpart would silently fall
    // through the remap and be reported as though a *game* had clashed.
    expect(Object.keys(WARMUP_CODE_BY_FACILITY_CODE).sort()).toEqual([...occupancyCodes].sort());
    for (const code of occupancyCodes) {
      const timingCode = WARMUP_CODE_BY_FACILITY_CODE[code];
      expect(Object.values(TIMING_REASON)).toContain(timingCode);
      // Registered, so it can never be waved through as an unscored code.
      expect(Object.values(TIMING_SEVERITY)).toContain(timingSeverityOf(timingCode));
    }
  });
});

describe('game time model :: input validation and immutability', () => {
  it('rejects an unexpected key rather than carrying it as a passenger', () => {
    expect(() =>
      TimingFixtureSchema.parse({
        id: 'x',
        surfaceId: sid(ALDER, 'Pitch 2'),
        date: BUSY_DATE,
        kickoffMinutes: 600,
        format: '11v11',
        durationMinutes: 90,
      })
    ).toThrow();
  });

  it('rejects a scheduled value that falls outside its own range', () => {
    const input = toFormatTimingInput(rawFormats);
    const eleven = input.formats.find((entry) => entry.format === '11v11');
    eleven.occupancyMinutes = { min: 85, max: 90, scheduled: 120, note: null };
    expect(() => buildFormatTimingTable(input)).toThrow();
  });

  it('rejects a non-ISO date and a negative kickoff', () => {
    const base = {
      id: 'x',
      surfaceId: sid(ALDER, 'Pitch 2'),
      date: BUSY_DATE,
      kickoffMinutes: 600,
      format: '11v11',
    };
    expect(() => TimingFixtureSchema.parse({ ...base, date: '08/22/2026' })).toThrow();
    expect(() => TimingFixtureSchema.parse({ ...base, kickoffMinutes: -1 })).toThrow();
  });

  it('hands out a frozen table nobody can mutate into shared state', () => {
    expect(Object.isFrozen(table)).toBe(true);
    expect(Object.isFrozen(table.formats)).toBe(true);
    expect(Object.isFrozen(table.formats['11v11'])).toBe(true);
    expect(Object.isFrozen(table.formats['11v11'].occupancyMinutes)).toBe(true);
    expect(() => {
      table.formats['11v11'].occupancyMinutes.scheduled = 85;
    }).toThrow();
  });

  it('keeps the corpus default warm-up policy empty', () => {
    // If this ever stops being empty, a 30-minute warm-up has been smuggled in
    // as though game_formats.csv contained one.
    expect(SEASON_2026_WARMUP_POLICY).toEqual({});
    expect(tableWithoutWarmup.stats.warmupPolicyCount).toBe(0);
    expect(warmupMinutesFor(tableWithoutWarmup, '11v11')).toBeNull();
    expect(warmupMinutesFor(table, '11v11')).toBe(WARMUP);
    expect(warmupMinutesFor(table, '11v11', 45)).toBe(45);
  });

  it('throws on a kickoff that is not a non-negative integer', () => {
    expect(() => computeGameWindows(table, { format: '11v11', kickoffMinutes: -5 })).toThrow(
      /non-negative integer/
    );
  });
});
