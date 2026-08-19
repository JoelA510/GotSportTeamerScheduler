/**
 * Tests for the facility graph (`packages/core/src/facility/`).
 *
 * The corpus is loaded once at module scope and every number is derived from
 * the fixture files - durations from `game_formats.csv`, geometry and the
 * equipment exception from `facility_geometry.json`, occupancy from
 * `combined_schedule.csv`. Nothing derived is hardcoded.
 *
 * Meta-assertion discipline (incident 4 in `fixtures/season-2026/README.md`):
 * every behavioural check also asserts it examined a non-zero number of
 * records. `meta.overlapPairsConsulted > 0` is the single most important
 * assertion in this file - without it, a graph that had lost its overlap pairs
 * would make every "these two may run concurrently" test pass trivially.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

import {
  fieldsOverlap,
  indexFormats,
  loadCombinedSchedule,
  loadFacilityGeometry,
  loadGameFormats,
  parseClockMinutes,
  scheduledOccupancyMinutes,
} from '@squadlogic/core/fixtures/index.js';

import {
  DEFAULT_SIZE_RANK,
  FACILITY_REASON,
  FACILITY_REASON_SEVERITY,
  FACILITY_SEVERITY,
  FACILITY_STATUS,
  FacilityGraphInputSchema,
  bookingsOverlapInTime,
  buildFacilityGraph,
  buildFacilityGraphFromSeason2026,
  cellsOf,
  checkBooking,
  checkEquipment,
  checkFieldEligibility,
  checkLining,
  checkSizeEligibility,
  classifyEquipmentStatus,
  conflictingSurfacesOf,
  descendantsOf,
  findFacilityConflicts,
  findSurfaceByName,
  lineageOf,
  occupancyFootprint,
  season2026SurfaceId,
  season2026VenueId,
  surfacesConflict,
  toSeason2026FacilityGraphInput,
} from '@squadlogic/core/facility/index.js';

/* -------------------------------------------------------------------------- */
/* Corpus, loaded once                                                         */
/* -------------------------------------------------------------------------- */

const geometry = loadFacilityGeometry();
const graph = buildFacilityGraphFromSeason2026(geometry);
const formatsByName = indexFormats(loadGameFormats());
const combinedGames = loadCombinedSchedule({ formatsByName });

const ALDER = 'Alder Park';
const BROOKSIDE = 'Brookside Park';

/** Every field the corpus declares at a venue, by venue name. */
const fieldNamesByVenue = new Map(
  geometry.venues.map((venue) => [venue.name, venue.fields.map((field) => field.name)])
);

/** Shorthand for the opaque surface id of a corpus venue/field pair. */
const sid = (venueName, fieldName) => season2026SurfaceId(venueName, fieldName);

/** Scheduled occupancy for a format, straight out of `game_formats.csv`. */
const durationOf = (format) => scheduledOccupancyMinutes(formatsByName, format);

/**
 * A booking whose footprint comes from the fixture's own timing table.
 *
 * @param {string} id
 * @param {string} venueName
 * @param {string} fieldName
 * @param {string} date
 * @param {string} kickoff - e.g. `10:00 AM`
 * @param {string} format
 */
function bookingAt(id, venueName, fieldName, date, kickoff, format) {
  const startMinutes = parseClockMinutes(kickoff);
  const duration = durationOf(format);
  return {
    id,
    surfaceId: sid(venueName, fieldName),
    date,
    startMinutes,
    endMinutes: duration === null ? null : startMinutes + duration,
    format,
    label: id,
  };
}

/** Turn a parsed corpus schedule row into a facility booking. */
function bookingOf(game) {
  return {
    id: game.id,
    surfaceId: sid(game.venue, game.field),
    date: game.date,
    startMinutes: game.kickoffMinutes,
    endMinutes: game.endMinutes,
    format: game.format,
    label: `${game.homeLabel} v ${game.awayLabel}`,
  };
}

/** Codes present in a result, for compact assertions. */
const codesOf = (result) => result.findings.map((finding) => finding.code);

/** Findings that would actually stop the booking. */
const blockingOf = (result) =>
  result.findings.filter((finding) => finding.severity === FACILITY_SEVERITY.BLOCKING);

/* -------------------------------------------------------------------------- */
/* Guard block - runs before anything behavioural                              */
/* -------------------------------------------------------------------------- */

describe('facility graph :: corpus guard', () => {
  it('is built from the real season-2026 geometry, not an empty shell', () => {
    // Without these, "1A and Pitch 3 may run concurrently" would pass on a
    // graph that had simply forgotten every relation it owns.
    expect(graph.stats.overlapPairCount).toBe(2);
    expect(graph.stats.containmentEdgeCount).toBe(4);
    expect(graph.stats.formatEquipmentCount).toBeGreaterThan(0);

    expect(graph.stats.venueCount).toBe(geometry.venues.length);
    expect(graph.stats.surfaceCount).toBe(geometry.fields.length);
    // Parent pitches are bookable; the rejection for "book Pitch 1 while 1A is
    // busy" has to come from occupancy, not from a blanket not-bookable flag.
    expect(graph.stats.bookableSurfaceCount).toBe(geometry.fields.length);
    expect(graph.stats.equipmentWindowCount).toBe(geometry.equipmentExceptions.length);
    expect(graph.stats.equipmentWindowCount).toBeGreaterThan(0);
  });

  it('models containment as a forest with the fixture-declared cells', () => {
    const pitch1 = sid(ALDER, 'Pitch 1');
    const pitch1a = sid(ALDER, 'Pitch 1A');
    const pitch2 = sid(ALDER, 'Pitch 2');

    expect(cellsOf(graph, pitch1)).toEqual([pitch1a, sid(ALDER, 'Pitch 1B')].sort());
    expect(cellsOf(graph, pitch1a)).toEqual([pitch1a]);
    expect(cellsOf(graph, pitch2)).toEqual([pitch2]);
    expect(lineageOf(graph, pitch1a)).toEqual([pitch1a, pitch1]);
    expect(lineageOf(graph, pitch2)).toEqual([pitch2]);
    expect(descendantsOf(graph, pitch1)).toEqual([pitch1a, sid(ALDER, 'Pitch 1B')].sort());
    expect(descendantsOf(graph, pitch1a)).toEqual([]);
  });

  it('exposes surfaces by their human names without parsing ids', () => {
    const surface = findSurfaceByName(graph, ALDER, 'Pitch 1A');
    expect(surface).not.toBeNull();
    expect(surface.id).toBe(sid(ALDER, 'Pitch 1A'));
    expect(findSurfaceByName(graph, ALDER, 'Pitch 9')).toBeNull();
    expect(findSurfaceByName(graph, 'Nowhere Park', 'Pitch 1A')).toBeNull();
  });

  it('never mints a colon-bearing id', () => {
    // GameSchedulingPage.jsx does String(over.id).split(':') on a drag target.
    // A colon in a facility id would produce a drag that silently does nothing.
    for (const id of graph.surfaceIds) expect(id).not.toContain(':');
    for (const id of graph.venueIds) expect(id).not.toContain(':');
    expect(graph.surfaceIds.length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Acceptance test 1                                                           */
/* -------------------------------------------------------------------------- */

describe('facility graph :: acceptance 1 - overlapping pitches cannot run concurrently', () => {
  it('rejects a 9v9 on Alder Pitch 1A concurrent with an 11v11 on Pitch 2', () => {
    // CONSTRUCTED scenario. The corpus contains no such clash by design - the
    // published season honours the overlap rule everywhere - so the only way to
    // test the rejection is to build the illegal pair ourselves.
    const nineDuration = durationOf('9v9');
    const elevenDuration = durationOf('11v11');
    expect(nineDuration).toBe(65);
    expect(elevenDuration).toBe(90);

    const eleven = bookingAt('eleven', ALDER, 'Pitch 2', '2026-09-12', '10:00 AM', '11v11');
    const nine = bookingAt('nine', ALDER, 'Pitch 1A', '2026-09-12', '10:00 AM', '9v9');
    expect(bookingsOverlapInTime(nine, eleven)).toBe(true);

    const result = checkBooking(graph, nine, { existingBookings: [eleven] });
    expect(result.status).toBe(FACILITY_STATUS.REJECTED);
    expect(codesOf(result)).toContain(FACILITY_REASON.OCCUPIED_SPATIAL_OVERLAP);

    // Meta-assertion: the check really compared this booking against the other
    // one and really consulted the overlap relation while doing it.
    expect(result.meta.bookingPairsCompared).toBe(1);
    expect(result.meta.overlapPairsConsulted).toBeGreaterThan(0);
  });

  it('reports the clash from either side and names the pair in details', () => {
    const eleven = bookingAt('eleven', ALDER, 'Pitch 2', '2026-09-12', '10:00 AM', '11v11');
    const nine = bookingAt('nine', ALDER, 'Pitch 1A', '2026-09-12', '10:00 AM', '9v9');

    const reverse = checkBooking(graph, eleven, { existingBookings: [nine] });
    expect(reverse.status).toBe(FACILITY_STATUS.REJECTED);
    const finding = reverse.findings.find(
      (entry) => entry.code === FACILITY_REASON.OCCUPIED_SPATIAL_OVERLAP
    );
    expect(finding).toBeDefined();
    expect(finding.details.surfaceAId).toBe(sid(ALDER, 'Pitch 2'));
    expect(finding.details.surfaceBId).toBe(sid(ALDER, 'Pitch 1A'));
    expect(finding.details.date).toBe('2026-09-12');
  });

  it('allows the same two bookings once they no longer overlap in time', () => {
    const eleven = bookingAt('eleven', ALDER, 'Pitch 2', '2026-09-12', '8:00 AM', '11v11');
    const nine = bookingAt('nine', ALDER, 'Pitch 1A', '2026-09-12', '10:00 AM', '9v9');
    expect(bookingsOverlapInTime(nine, eleven)).toBe(false);

    const result = checkBooking(graph, nine, { existingBookings: [eleven] });
    expect(blockingOf(result)).toEqual([]);
    expect(result.meta.bookingPairsCompared).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Acceptance test 2                                                           */
/* -------------------------------------------------------------------------- */

describe('facility graph :: acceptance 2 - non-overlapping pitches may run concurrently', () => {
  it('allows a 9v9 on Alder Pitch 1A concurrent with an 11v11 on Pitch 3', () => {
    const eleven = bookingAt('eleven', ALDER, 'Pitch 3', '2026-09-12', '10:00 AM', '11v11');
    const nine = bookingAt('nine', ALDER, 'Pitch 1A', '2026-09-12', '10:00 AM', '9v9');
    expect(bookingsOverlapInTime(nine, eleven)).toBe(true);

    const result = checkBooking(graph, nine, { existingBookings: [eleven] });
    expect(result.status).toBe(FACILITY_STATUS.ALLOWED);
    expect(blockingOf(result)).toEqual([]);

    // THE assertion of this file. A graph whose overlap pairs had gone missing
    // would return "allowed" here for entirely the wrong reason; this proves the
    // relation was consulted and genuinely said no.
    expect(result.meta.overlapPairsConsulted).toBeGreaterThan(0);
    expect(result.meta.bookingPairsCompared).toBe(1);
  });

  it('agrees with the published season: real concurrent Pitch 3 / Pitch 1A games', () => {
    // Data-driven witness rather than a constructed one: 09/12/2026 runs an
    // 11v11 on Pitch 3 at 10:00 alongside a 9v9 on Pitch 1A at 10:25.
    const alderGames = combinedGames.filter(
      (game) => game.venue === ALDER && game.endMinutes !== null
    );
    let witnesses = 0;
    for (let i = 0; i < alderGames.length; i += 1) {
      for (let j = i + 1; j < alderGames.length; j += 1) {
        const a = alderGames[i];
        const b = alderGames[j];
        if (a.date !== b.date) continue;
        const fields = new Set([a.field, b.field]);
        if (!(fields.has('Pitch 3') && fields.has('Pitch 1A'))) continue;
        if (bookingsOverlapInTime(bookingOf(a), bookingOf(b)) !== true) continue;
        witnesses += 1;
        const verdict = surfacesConflict(graph, sid(a.venue, a.field), sid(b.venue, b.field));
        expect(verdict.conflict).toBe(false);
        expect(verdict.meta.overlapPairsConsulted).toBeGreaterThan(0);
      }
    }
    expect(witnesses).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Acceptance test 3                                                           */
/* -------------------------------------------------------------------------- */

describe('facility graph :: acceptance 3 - a parent and its halves are the same ground', () => {
  it('rejects booking Alder Pitch 1 whole while 1A is occupied, and vice versa', () => {
    // CONSTRUCTED. The corpus never books a parent pitch (Alder usage is
    // 1A x 31, 1B x 33, 2 x 5, 3 x 52, 4A x 4, 4B x 4), so nobody should later
    // "fix" the fixture by adding one to make this test data-driven.
    const half = bookingAt('half', ALDER, 'Pitch 1A', '2026-09-12', '10:25 AM', '9v9');
    const whole = bookingAt('whole', ALDER, 'Pitch 1', '2026-09-12', '10:25 AM', '9v9');

    const parentBlocked = checkBooking(graph, whole, { existingBookings: [half] });
    expect(parentBlocked.status).toBe(FACILITY_STATUS.REJECTED);
    expect(codesOf(parentBlocked)).toContain(FACILITY_REASON.OCCUPIED_PARENT_CHILD);
    // Not rejected for being unbookable - Pitch 1 as a full pitch is legal.
    expect(codesOf(parentBlocked)).not.toContain(FACILITY_REASON.SURFACE_NOT_BOOKABLE);
    expect(parentBlocked.meta.bookingPairsCompared).toBe(1);

    const childBlocked = checkBooking(graph, half, { existingBookings: [whole] });
    expect(childBlocked.status).toBe(FACILITY_STATUS.REJECTED);
    expect(codesOf(childBlocked)).toContain(FACILITY_REASON.OCCUPIED_PARENT_CHILD);
    expect(childBlocked.meta.bookingPairsCompared).toBe(1);
  });

  it('allows the two halves of one pitch to run at the same time', () => {
    const a = bookingAt('a', ALDER, 'Pitch 1A', '2026-09-12', '10:25 AM', '9v9');
    const b = bookingAt('b', ALDER, 'Pitch 1B', '2026-09-12', '10:25 AM', '9v9');
    expect(bookingsOverlapInTime(a, b)).toBe(true);

    const result = checkBooking(graph, a, { existingBookings: [b] });
    expect(result.status).toBe(FACILITY_STATUS.ALLOWED);
    expect(blockingOf(result)).toEqual([]);
  });

  it('agrees with every concurrent 1A/1B pair the published season actually ran', () => {
    // This is what pins non-transitivity: 1A and 1B are each contained in
    // Pitch 1, and Pitch 1 overlaps Pitch 2, yet 1A and 1B are independent. A
    // transitive closure would declare all of these published games illegal.
    const alderGames = combinedGames.filter(
      (game) => game.venue === ALDER && game.endMinutes !== null
    );
    let pairsExamined = 0;
    const violations = [];
    for (let i = 0; i < alderGames.length; i += 1) {
      for (let j = i + 1; j < alderGames.length; j += 1) {
        const a = alderGames[i];
        const b = alderGames[j];
        if (a.date !== b.date) continue;
        const fields = new Set([a.field, b.field]);
        if (!(fields.has('Pitch 1A') && fields.has('Pitch 1B'))) continue;
        if (bookingsOverlapInTime(bookingOf(a), bookingOf(b)) !== true) continue;
        pairsExamined += 1;
        const verdict = surfacesConflict(graph, sid(a.venue, a.field), sid(b.venue, b.field));
        if (verdict.conflict) violations.push(`${a.id} (${a.field}) vs ${b.id} (${b.field})`);
      }
    }
    expect(violations).toEqual([]);
    expect(pairsExamined).toBeGreaterThan(20);
  });
});

/* -------------------------------------------------------------------------- */
/* Acceptance test 4 (+ the lining companion)                                  */
/* -------------------------------------------------------------------------- */

describe('facility graph :: acceptance 4 - size eligibility', () => {
  it('rejects an 11v11 on Alder Pitch 1 under both size policies', () => {
    for (const sizePolicy of ['downward-closed', 'declared']) {
      const result = checkSizeEligibility(
        graph,
        { surfaceId: sid(ALDER, 'Pitch 1'), format: '11v11' },
        { sizePolicy }
      );
      expect(result.status, sizePolicy).toBe(FACILITY_STATUS.REJECTED);
      expect(codesOf(result), sizePolicy).toContain(FACILITY_REASON.SIZE_TOO_SMALL);
      expect(result.meta.surfacesConsidered, sizePolicy).toBe(1);
    }
  });

  it('allows an 11v11 on the two pitches the corpus declares 11v11-sized', () => {
    for (const fieldName of ['Pitch 2', 'Pitch 3']) {
      const result = checkSizeEligibility(graph, {
        surfaceId: sid(ALDER, fieldName),
        format: '11v11',
      });
      expect(result.status, fieldName).toBe(FACILITY_STATUS.ALLOWED);
      expect(result.findings, fieldName).toEqual([]);
    }
    // Meta-assertion: exactly those two Alder pitches are 11v11-sized, so the
    // positive control above is not accidentally testing every pitch.
    const elevenSized = geometry.venues
      .find((venue) => venue.name === ALDER)
      .fields.filter((field) => field.sizes.includes('11v11'))
      .map((field) => field.name);
    expect(elevenSized).toEqual(['Pitch 2', 'Pitch 3']);
  });

  it('treats size as downward-closed by default and literal under "declared"', () => {
    const stadium = sid('Summit HS', 'Stadium');
    // Wasteful but legal, and deliberately not a compromise in Phase 1.
    expect(checkSizeEligibility(graph, { surfaceId: stadium, format: '5v5' }).status).toBe(
      FACILITY_STATUS.ALLOWED
    );
    const declared = checkSizeEligibility(
      graph,
      { surfaceId: stadium, format: '5v5' },
      { sizePolicy: 'declared' }
    );
    expect(declared.status).toBe(FACILITY_STATUS.REJECTED);
    expect(codesOf(declared)).toContain(FACILITY_REASON.SIZE_NOT_DECLARED);
  });

  it('places every published 11v11 row on a size-eligible surface', () => {
    let rowsChecked = 0;
    const violations = [];
    for (const game of combinedGames) {
      if (game.format !== '11v11') continue;
      rowsChecked += 1;
      const result = checkSizeEligibility(graph, {
        surfaceId: sid(game.venue, game.field),
        format: '11v11',
      });
      if (result.status !== FACILITY_STATUS.ALLOWED) {
        violations.push(
          `${game.id} on ${game.venue} / ${game.field}: ${codesOf(result).join(',')}`
        );
      }
    }
    expect(violations).toEqual([]);
    expect(rowsChecked).toBe(108);
  });

  it('flags an unrankable format instead of quietly allowing it', () => {
    const result = checkSizeEligibility(graph, {
      surfaceId: sid(ALDER, 'Pitch 2'),
      format: '15v15',
    });
    expect(result.status).toBe(FACILITY_STATUS.REJECTED);
    expect(codesOf(result)).toContain(FACILITY_REASON.SIZE_UNKNOWN_FORMAT);
    expect(DEFAULT_SIZE_RANK['15v15']).toBeUndefined();
    expect(DEFAULT_SIZE_RANK['11v11']).toBeGreaterThan(DEFAULT_SIZE_RANK['9v9']);
  });
});

describe('facility graph :: acceptance 4 companion - lining is separate from size', () => {
  it('calls a 9v9 on the 7v7-lined Brookside Upper 1 a compromise, not an error', () => {
    const surfaceId = sid(BROOKSIDE, 'Upper 1');
    const result = checkFieldEligibility(graph, {
      surfaceId,
      format: '9v9',
      date: '2026-09-12',
    });

    // Explicitly both, so a regression that collapses the three-state result
    // back into a boolean fails here rather than passing quietly.
    expect(result.status).not.toBe(FACILITY_STATUS.ALLOWED);
    expect(result.status).not.toBe(FACILITY_STATUS.REJECTED);
    expect(result.status).toBe(FACILITY_STATUS.COMPROMISED);

    expect(blockingOf(result)).toEqual([]);
    const lining = result.findings.find(
      (finding) => finding.code === FACILITY_REASON.LINING_MISMATCH
    );
    expect(lining).toBeDefined();
    expect(lining.severity).toBe(FACILITY_SEVERITY.COMPROMISE);
    expect(lining.details.linedFor).toEqual(['7v7']);

    // Derived from the fixture: Upper 1 really is 9v9-sized but 7v7-lined.
    const upper1 = geometry.venues
      .find((venue) => venue.name === BROOKSIDE)
      .fields.find((field) => field.name === 'Upper 1');
    expect(upper1.sizes).toContain('9v9');
    expect(upper1.lined).toEqual(['7v7']);
  });

  it('allows a 7v7 on the same pitch', () => {
    const result = checkFieldEligibility(graph, {
      surfaceId: sid(BROOKSIDE, 'Upper 1'),
      format: '7v7',
      date: '2026-09-12',
    });
    expect(result.status).toBe(FACILITY_STATUS.ALLOWED);
    expect(codesOf(result)).not.toContain(FACILITY_REASON.LINING_MISMATCH);
  });

  it('reports an undeclared lining as information, never as a block', () => {
    const bare = buildFacilityGraph({
      venues: [{ id: 'v', name: 'V' }],
      surfaces: [{ id: 'v/s', venueId: 'v', name: 'S', sizes: ['9v9'], lined: [] }],
    });
    const result = checkLining(bare, { surfaceId: 'v/s', format: '9v9' });
    expect(codesOf(result)).toEqual([FACILITY_REASON.LINING_UNDECLARED]);
    expect(result.status).toBe(FACILITY_STATUS.ALLOWED);
  });
});

/* -------------------------------------------------------------------------- */
/* Acceptance test 5                                                           */
/* -------------------------------------------------------------------------- */

describe('facility graph :: acceptance 5 - date-scoped equipment', () => {
  // The corpus's one record is a *confirmed available* entry, kept precisely so
  // this test has something to flip. The fixture file is immutable
  // (computeFixtureChecksums proves it), so the "what if" lives in a second
  // graph built with an override, never in an edit to the JSON.
  const exception = geometry.equipmentExceptions[0];
  const outageDate = exception.date;
  const otherRecDate = '2026-08-29';

  const outageGraph = buildFacilityGraphFromSeason2026(geometry, {
    equipmentOverrides: [
      {
        id: 'test-9v9-goals-out',
        equipment: exception.equipment,
        status: 'unavailable',
        scope: { kind: 'venue', id: season2026VenueId(exception.venue) },
        fromDate: outageDate,
        toDate: outageDate,
        note: 'test override; the fixture file is never edited',
        source: 'facilityGraph.test.js',
      },
    ],
  });

  it('has a non-vacuous scenario to test', () => {
    expect(exception.venue).toBe(ALDER);
    expect(graph.formatEquipment['9v9']).toBeDefined();
    expect(graph.formatEquipment['9v9'].length).toBeGreaterThan(0);
    expect(graph.formatEquipment['9v9']).toContain(exception.equipment);

    // The override replaced the corpus record rather than sitting beside it.
    expect(outageGraph.stats.equipmentWindowCount).toBe(graph.stats.equipmentWindowCount);

    // There really are rec 9v9 games at Alder on the outage date, so the
    // rejection below is about real games.
    const affected = combinedGames.filter(
      (game) => game.venue === ALDER && game.format === '9v9' && game.date === outageDate
    );
    expect(affected.length).toBeGreaterThan(0);
    const laterDate = combinedGames.filter(
      (game) => game.venue === ALDER && game.format === '9v9' && game.date === otherRecDate
    );
    expect(laterDate.length).toBeGreaterThan(0);
  });

  it('rejects a 9v9 at Alder on the outage date and allows it a week later', () => {
    const blocked = checkFieldEligibility(outageGraph, {
      surfaceId: sid(ALDER, 'Pitch 1A'),
      format: '9v9',
      date: outageDate,
    });
    expect(blocked.status).toBe(FACILITY_STATUS.REJECTED);
    expect(codesOf(blocked)).toContain(FACILITY_REASON.EQUIPMENT_UNAVAILABLE);
    expect(blocked.meta.equipmentWindowsConsulted).toBeGreaterThan(0);

    const fine = checkFieldEligibility(outageGraph, {
      surfaceId: sid(ALDER, 'Pitch 1A'),
      format: '9v9',
      date: otherRecDate,
    });
    expect(fine.status).toBe(FACILITY_STATUS.ALLOWED);
    expect(codesOf(fine)).not.toContain(FACILITY_REASON.EQUIPMENT_UNAVAILABLE);
    expect(fine.meta.equipmentWindowsConsulted).toBeGreaterThan(0);
  });

  it('keeps the outage inside its venue', () => {
    // The plan's case: a 7v7 elsewhere is untouched.
    const sevens = checkFieldEligibility(outageGraph, {
      surfaceId: sid(BROOKSIDE, 'Upper 1'),
      format: '7v7',
      date: outageDate,
    });
    expect(sevens.status).toBe(FACILITY_STATUS.ALLOWED);
    expect(codesOf(sevens)).not.toContain(FACILITY_REASON.EQUIPMENT_UNAVAILABLE);

    // Sharper witness for venue scoping: the *same* format at another venue on
    // the *same* date is not blocked either.
    const nines = checkFieldEligibility(outageGraph, {
      surfaceId: sid(BROOKSIDE, 'Upper 1'),
      format: '9v9',
      date: outageDate,
    });
    expect(codesOf(nines)).not.toContain(FACILITY_REASON.EQUIPMENT_UNAVAILABLE);
    expect(blockingOf(nines)).toEqual([]);
    expect(nines.meta.equipmentWindowsConsulted).toBeGreaterThan(0);
  });

  it('keeps the outage scoped to the formats that need the kit', () => {
    const eleven = checkFieldEligibility(outageGraph, {
      surfaceId: sid(ALDER, 'Pitch 3'),
      format: '11v11',
      date: outageDate,
    });
    expect(eleven.status).toBe(FACILITY_STATUS.ALLOWED);
    expect(codesOf(eleven)).toContain(FACILITY_REASON.EQUIPMENT_UNDECLARED);
    expect(graph.formatEquipment['11v11']).toBeUndefined();
  });

  it('carries the confirmed-available record through on the unmodified graph', () => {
    const result = checkEquipment(graph, {
      surfaceId: sid(ALDER, 'Pitch 1A'),
      format: '9v9',
      date: outageDate,
    });
    expect(result.status).toBe(FACILITY_STATUS.ALLOWED);
    const finding = result.findings.find(
      (entry) => entry.code === FACILITY_REASON.EQUIPMENT_AVAILABLE
    );
    expect(finding).toBeDefined();
    // Tri-state, not boolean: the "was in doubt" provenance survives.
    expect(finding.details.windowNote).toBe(exception.status);
    expect(result.meta.equipmentWindowsConsulted).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Equipment resolution details                                                */
/* -------------------------------------------------------------------------- */

describe('facility graph :: equipment resolution', () => {
  const venueId = 'v';
  const surfaceId = 'v/s';
  const childId = 'v/s-half';
  const base = {
    venues: [{ id: venueId, name: 'V' }],
    surfaces: [
      { id: surfaceId, venueId, name: 'S', sizes: ['9v9'], lined: ['9v9'], childIds: [childId] },
      { id: childId, venueId, name: 'S half', sizes: ['9v9'], lined: ['9v9'], parentId: surfaceId },
    ],
    formatEquipment: { '9v9': ['goals'] },
  };

  const window = (overrides) => ({
    id: 'w',
    equipment: 'goals',
    status: 'available',
    scope: { kind: 'venue', id: venueId },
    fromDate: '2026-08-01',
    toDate: '2026-08-31',
    ...overrides,
  });

  it('lets a surface-scoped record beat a venue-scoped one', () => {
    const built = buildFacilityGraph({
      ...base,
      equipmentWindows: [
        window({ id: 'venue-wide', status: 'unavailable' }),
        window({
          id: 'this-pitch',
          status: 'available',
          scope: { kind: 'surface', id: surfaceId },
        }),
      ],
    });
    const result = checkEquipment(built, { surfaceId, format: '9v9', date: '2026-08-15' });
    expect(codesOf(result)).toEqual([FACILITY_REASON.EQUIPMENT_AVAILABLE]);
    expect(result.findings[0].details.windowId).toBe('this-pitch');
  });

  it('applies a surface-scoped record to the halves of that surface', () => {
    const built = buildFacilityGraph({
      ...base,
      equipmentWindows: [
        window({ id: 'parent', status: 'unavailable', scope: { kind: 'surface', id: surfaceId } }),
      ],
    });
    const result = checkEquipment(built, { surfaceId: childId, format: '9v9', date: '2026-08-15' });
    expect(codesOf(result)).toEqual([FACILITY_REASON.EQUIPMENT_UNAVAILABLE]);
  });

  it('lets the narrower date range win inside a tier', () => {
    const built = buildFacilityGraph({
      ...base,
      equipmentWindows: [
        window({ id: 'month', status: 'available' }),
        window({
          id: 'one-day',
          status: 'unavailable',
          fromDate: '2026-08-15',
          toDate: '2026-08-15',
        }),
      ],
    });
    expect(
      codesOf(checkEquipment(built, { surfaceId, format: '9v9', date: '2026-08-15' }))
    ).toEqual([FACILITY_REASON.EQUIPMENT_UNAVAILABLE]);
    expect(
      codesOf(checkEquipment(built, { surfaceId, format: '9v9', date: '2026-08-16' }))
    ).toEqual([FACILITY_REASON.EQUIPMENT_AVAILABLE]);
  });

  it('never silently picks a winner when two equally specific records disagree', () => {
    const built = buildFacilityGraph({
      ...base,
      equipmentWindows: [
        window({ id: 'left', status: 'available' }),
        window({ id: 'right', status: 'unavailable' }),
      ],
    });
    const result = checkEquipment(built, { surfaceId, format: '9v9', date: '2026-08-15' });
    expect(codesOf(result)).toContain(FACILITY_REASON.EQUIPMENT_PRECEDENCE_AMBIGUOUS);
    expect(codesOf(result)).toContain(FACILITY_REASON.EQUIPMENT_UNAVAILABLE);
    expect(result.status).toBe(FACILITY_STATUS.REJECTED);
    const ambiguous = result.findings.find(
      (finding) => finding.code === FACILITY_REASON.EQUIPMENT_PRECEDENCE_AMBIGUOUS
    );
    expect(/** @type {string[]} */ (ambiguous.details.windowIds).sort()).toEqual(['left', 'right']);
    expect(ambiguous.details.appliedStatus).toBe('unavailable');
  });

  it('treats an unknown status as a compromise, never as an all-clear', () => {
    const built = buildFacilityGraph({
      ...base,
      equipmentWindows: [window({ id: 'doubtful', status: 'unknown' })],
    });
    const result = checkEquipment(built, { surfaceId, format: '9v9', date: '2026-08-15' });
    expect(codesOf(result)).toEqual([FACILITY_REASON.EQUIPMENT_STATUS_UNKNOWN]);
    expect(result.status).toBe(FACILITY_STATUS.COMPROMISED);
  });

  it('classifies the corpus status text, and throws on anything it does not know', () => {
    expect(classifyEquipmentStatus(geometry.equipmentExceptions[0].status)).toBe('available');
    expect(classifyEquipmentStatus('unavailable')).toBe('unavailable');
    expect(classifyEquipmentStatus('goals not available all weekend')).toBe('unavailable');
    expect(classifyEquipmentStatus('status in doubt')).toBe('unknown');
    // strict is the default because the corpus is immutable and pinned.
    expect(() => classifyEquipmentStatus('borrowed from the other club')).toThrow(
      /unrecognised equipment status/
    );
    expect(classifyEquipmentStatus('borrowed from the other club', { strict: false })).toBe(
      'unknown'
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Structural properties of the relation                                       */
/* -------------------------------------------------------------------------- */

describe('facility graph :: relation structure', () => {
  it('is symmetric over every ordered pair of Alder surfaces', () => {
    const names = fieldNamesByVenue.get(ALDER);
    let pairsExamined = 0;
    for (const left of names) {
      for (const right of names) {
        if (left === right) continue;
        pairsExamined += 1;
        const forward = surfacesConflict(graph, sid(ALDER, left), sid(ALDER, right));
        const backward = surfacesConflict(graph, sid(ALDER, right), sid(ALDER, left));
        expect(forward.conflict, `${left} / ${right}`).toBe(backward.conflict);
        expect(forward.code, `${left} / ${right}`).toBe(backward.code);
      }
    }
    expect(pairsExamined).toBe(56);
  });

  it('matches the fixture-declared truth table exactly', () => {
    const expected = [
      ['Pitch 1A', 'Pitch 1A', FACILITY_REASON.OCCUPIED_SAME_SURFACE],
      ['Pitch 1', 'Pitch 1A', FACILITY_REASON.OCCUPIED_PARENT_CHILD],
      ['Pitch 1A', 'Pitch 1B', null],
      ['Pitch 1A', 'Pitch 2', FACILITY_REASON.OCCUPIED_SPATIAL_OVERLAP],
      ['Pitch 1A', 'Pitch 3', null],
      ['Pitch 4A', 'Pitch 3', FACILITY_REASON.OCCUPIED_SPATIAL_OVERLAP],
      ['Pitch 2', 'Pitch 3', null],
      ['Pitch 2', 'Pitch 4A', null],
      ['Pitch 1A', 'Pitch 4B', null],
    ];
    for (const [left, right, code] of expected) {
      const verdict = surfacesConflict(graph, sid(ALDER, left), sid(ALDER, right));
      expect(verdict.code, `${left} / ${right}`).toBe(code);
      expect(verdict.conflict, `${left} / ${right}`).toBe(code !== null);
    }
    expect(expected.length).toBe(9);
  });

  it('short-circuits across venues without touching the overlap relation', () => {
    const verdict = surfacesConflict(graph, sid(ALDER, 'Pitch 1A'), sid('Summit HS', 'Stadium'));
    expect(verdict.conflict).toBe(false);
    expect(verdict.code).toBeNull();
    expect(verdict.meta.overlapPairsConsulted).toBe(0);
    expect(verdict.meta.cellPairsCompared).toBe(0);
    expect(verdict.meta.surfacesConsidered).toBe(2);
  });

  it('is not transitive', () => {
    const names = fieldNamesByVenue.get(ALDER);
    let triplesExamined = 0;
    let nonTransitive = 0;
    for (const a of names) {
      for (const b of names) {
        for (const c of names) {
          if (a === b || b === c || a === c) continue;
          triplesExamined += 1;
          const ab = surfacesConflict(graph, sid(ALDER, a), sid(ALDER, b)).conflict;
          const bc = surfacesConflict(graph, sid(ALDER, b), sid(ALDER, c)).conflict;
          if (!ab || !bc) continue;
          if (!surfacesConflict(graph, sid(ALDER, a), sid(ALDER, c)).conflict) nonTransitive += 1;
        }
      }
    }
    expect(triplesExamined).toBeGreaterThan(0);
    expect(nonTransitive).toBeGreaterThan(0);

    // The specific triple that matters: 1A clashes with Pitch 1, Pitch 1
    // clashes with 1B, and 1A does not clash with 1B.
    expect(surfacesConflict(graph, sid(ALDER, 'Pitch 1A'), sid(ALDER, 'Pitch 1')).conflict).toBe(
      true
    );
    expect(surfacesConflict(graph, sid(ALDER, 'Pitch 1'), sid(ALDER, 'Pitch 1B')).conflict).toBe(
      true
    );
    expect(surfacesConflict(graph, sid(ALDER, 'Pitch 1A'), sid(ALDER, 'Pitch 1B')).conflict).toBe(
      false
    );
  });

  it('agrees with the existing fieldsOverlap() oracle everywhere', () => {
    let comparisons = 0;
    const disagreements = [];
    for (const venue of geometry.venues) {
      for (const left of venue.fields) {
        for (const right of venue.fields) {
          comparisons += 1;
          const oracle = fieldsOverlap(venue, left.name, right.name);
          const actual = surfacesConflict(
            graph,
            sid(venue.name, left.name),
            sid(venue.name, right.name)
          ).conflict;
          if (oracle !== actual) {
            disagreements.push(
              `${venue.name}: ${left.name} / ${right.name} ${oracle} vs ${actual}`
            );
          }
        }
      }
    }
    expect(disagreements).toEqual([]);
    expect(comparisons).toBeGreaterThan(100);
  });

  it('reports a footprint containing the parent but not the sibling half', () => {
    const footprint = occupancyFootprint(graph, sid(ALDER, 'Pitch 1A'));
    expect(footprint.blockedSurfaceIds).toContain(sid(ALDER, 'Pitch 1A'));
    expect(footprint.blockedSurfaceIds).toContain(sid(ALDER, 'Pitch 1'));
    expect(footprint.blockedSurfaceIds).toContain(sid(ALDER, 'Pitch 2'));
    expect(footprint.blockedSurfaceIds).not.toContain(sid(ALDER, 'Pitch 1B'));
    expect(footprint.blockedSurfaceIds).not.toContain(sid(ALDER, 'Pitch 3'));
    expect(footprint.cells).toEqual([sid(ALDER, 'Pitch 1A')]);
    expect(footprint.lineage).toEqual([sid(ALDER, 'Pitch 1A'), sid(ALDER, 'Pitch 1')]);
    expect(conflictingSurfacesOf(graph, sid(ALDER, 'Pitch 1A'))).toEqual(
      footprint.blockedSurfaceIds
    );
    expect(footprint.meta.overlapPairsConsulted).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Unknown footprints (GAP-14)                                                 */
/* -------------------------------------------------------------------------- */

describe('facility graph :: unknown footprints', () => {
  it('answers null rather than false when an end time is missing', () => {
    const known = bookingAt('known', ALDER, 'Pitch 2', '2026-08-29', '10:00 AM', '11v11');
    const unknown = {
      ...bookingAt('unknown', ALDER, 'Pitch 2', '2026-08-29', '10:00 AM', '11v11'),
      endMinutes: null,
    };
    expect(bookingsOverlapInTime(known, unknown)).toBeNull();
    expect(bookingsOverlapInTime(unknown, known)).toBeNull();
    // Different dates are still a clean "no" - nothing to be unsure about.
    expect(bookingsOverlapInTime({ ...unknown, date: '2026-09-12' }, known)).toBe(false);
  });

  it('surfaces an undecidable pair instead of waving it through', () => {
    const unknown = {
      ...bookingAt('scrimmage', ALDER, 'Pitch 2', '2026-08-29', '10:00 AM', '11v11'),
      endMinutes: null,
    };
    const candidate = bookingAt('game', ALDER, 'Pitch 1A', '2026-08-29', '10:00 AM', '9v9');
    const result = checkBooking(graph, candidate, { existingBookings: [unknown] });
    expect(codesOf(result)).toContain(FACILITY_REASON.OCCUPANCY_FOOTPRINT_UNKNOWN);
    expect(result.status).not.toBe(FACILITY_STATUS.ALLOWED);
    expect(result.meta.bookingPairsCompared).toBe(1);
  });

  it('accepts a null endMinutes through the booking schema', () => {
    const scrimmages = combinedGames.filter((game) => game.endMinutes === null);
    expect(scrimmages.length).toBe(4);
    for (const game of scrimmages) {
      const result = checkBooking(graph, bookingOf(game));
      expect(
        result.findings.every((finding) => finding.code !== FACILITY_REASON.SURFACE_UNKNOWN)
      ).toBe(true);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Full-corpus replay                                                          */
/* -------------------------------------------------------------------------- */

describe('facility graph :: full-corpus replay', () => {
  it('finds no facility conflict anywhere in the published season', () => {
    // The strongest single regression in this file: it is exactly the check
    // that would have caught incident 3, where fields were modelled as
    // independent strings for several schedule versions.
    const bookings = combinedGames.map(bookingOf);
    expect(bookings.length).toBe(679);

    const result = findFacilityConflicts(graph, bookings);
    expect(result.conflicts).toEqual([]);
    // Every field named in the schedule resolved to a surface in the graph.
    expect(result.unknownSurface).toEqual([]);
    // GAP-14: the four untimed Scrimmage rows, reported rather than dropped.
    expect(result.unknownFootprint.length).toBe(4);
    for (const finding of result.unknownFootprint) {
      expect(finding.code).toBe(FACILITY_REASON.OCCUPANCY_FOOTPRINT_UNKNOWN);
    }
    expect(result.meta.bookingPairsCompared).toBeGreaterThan(0);
    expect(result.meta.overlapPairsConsulted).toBeGreaterThan(0);
    expect(result.meta.surfacesConsidered).toBeGreaterThan(0);
  });

  it('catches an injected clash in the same replay', () => {
    // Negative control for the test above: a replay that cannot fail is a
    // replay that proves nothing.
    const bookings = combinedGames.map(bookingOf);
    const witness = combinedGames.find(
      (game) => game.venue === ALDER && game.field === 'Pitch 1A' && game.endMinutes !== null
    );
    expect(witness).toBeDefined();
    bookings.push({
      ...bookingOf(witness),
      id: 'injected-clash',
      surfaceId: sid(ALDER, 'Pitch 2'),
    });

    const result = findFacilityConflicts(graph, bookings);
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.conflicts.map((finding) => finding.code)).toContain(
      FACILITY_REASON.OCCUPIED_SPATIAL_OVERLAP
    );
  });

  it('reports every conflicting pair, not just the first', () => {
    const date = '2026-09-12';
    const bookings = [
      bookingAt('a', ALDER, 'Pitch 2', date, '10:00 AM', '11v11'),
      bookingAt('b', ALDER, 'Pitch 1A', date, '10:00 AM', '9v9'),
      bookingAt('c', ALDER, 'Pitch 1B', date, '10:00 AM', '9v9'),
    ];
    const result = findFacilityConflicts(graph, bookings);
    // a/b and a/c both clash; b/c does not.
    expect(result.conflicts.length).toBe(2);
    expect(result.meta.bookingPairsCompared).toBe(3);
  });
});

/* -------------------------------------------------------------------------- */
/* Builder rejects malformed graphs                                            */
/* -------------------------------------------------------------------------- */

describe('facility graph :: the builder refuses malformed input', () => {
  const venue = { id: 'v', name: 'V' };
  const surface = (overrides) => ({ id: 'v/a', venueId: 'v', name: 'A', ...overrides });

  it('rejects a duplicate surface id', () => {
    expect(() =>
      buildFacilityGraph({ venues: [venue], surfaces: [surface({}), surface({})] })
    ).toThrow(/duplicate surface id "v\/a"/);
  });

  it('rejects a duplicate venue id', () => {
    expect(() => buildFacilityGraph({ venues: [venue, venue], surfaces: [] })).toThrow(
      /duplicate venue id "v"/
    );
  });

  it('rejects a surface at an unknown venue', () => {
    expect(() =>
      buildFacilityGraph({ venues: [venue], surfaces: [surface({ venueId: 'nope' })] })
    ).toThrow(/unknown venue "nope"/);
  });

  it('rejects an unknown parentId', () => {
    expect(() =>
      buildFacilityGraph({ venues: [venue], surfaces: [surface({ parentId: 'ghost' })] })
    ).toThrow(/unknown parent "ghost"/);
  });

  it('rejects an unknown childId', () => {
    expect(() =>
      buildFacilityGraph({ venues: [venue], surfaces: [surface({ childIds: ['ghost'] })] })
    ).toThrow(/unknown child "ghost"/);
  });

  it('rejects a parent and child that disagree about the edge', () => {
    expect(() =>
      buildFacilityGraph({
        venues: [venue],
        surfaces: [surface({ childIds: ['v/b'] }), { id: 'v/b', venueId: 'v', name: 'B' }],
      })
    ).toThrow(/containment disagreement/);
  });

  it('rejects a containment cycle', () => {
    expect(() =>
      buildFacilityGraph({
        venues: [venue],
        surfaces: [
          { id: 'v/a', venueId: 'v', name: 'A', parentId: 'v/b', childIds: ['v/b'] },
          { id: 'v/b', venueId: 'v', name: 'B', parentId: 'v/a', childIds: ['v/a'] },
        ],
      })
    ).toThrow(/containment cycle/);
  });

  it('rejects containment that crosses a venue', () => {
    expect(() =>
      buildFacilityGraph({
        venues: [venue, { id: 'w', name: 'W' }],
        surfaces: [
          { id: 'v/a', venueId: 'v', name: 'A', childIds: ['w/b'] },
          { id: 'w/b', venueId: 'w', name: 'B', parentId: 'v/a' },
        ],
      })
    ).toThrow(/containment crosses venues/);
  });

  it('rejects an overlap pair naming an unknown surface', () => {
    expect(() =>
      buildFacilityGraph({
        venues: [venue],
        surfaces: [surface({})],
        overlapPairs: [['v/a', 'ghost']],
      })
    ).toThrow(/overlap pair names unknown surface "ghost"/);
  });

  it('rejects an overlap pair spanning two venues', () => {
    expect(() =>
      buildFacilityGraph({
        venues: [venue, { id: 'w', name: 'W' }],
        surfaces: [surface({}), { id: 'w/b', venueId: 'w', name: 'B' }],
        overlapPairs: [['v/a', 'w/b']],
      })
    ).toThrow(/overlap pair spans two venues/);
  });

  it('rejects a surface declared to overlap itself', () => {
    expect(() =>
      buildFacilityGraph({
        venues: [venue],
        surfaces: [surface({})],
        overlapPairs: [['v/a', 'v/a']],
      })
    ).toThrow(/cannot be declared to overlap itself/);
  });

  it('rejects an equipment window scoped to something that does not exist', () => {
    expect(() =>
      buildFacilityGraph({
        venues: [venue],
        surfaces: [surface({})],
        equipmentWindows: [
          {
            id: 'w1',
            equipment: 'goals',
            status: 'available',
            scope: { kind: 'venue', id: 'ghost' },
            fromDate: '2026-08-01',
            toDate: '2026-08-01',
            note: null,
            source: null,
          },
        ],
      })
    ).toThrow(/scopes to unknown venue "ghost"/);
  });

  it('rejects an unrecognised key rather than letting it ride along', () => {
    expect(() =>
      buildFacilityGraph({
        venues: [venue],
        surfaces: [surface({ surfaceType: 'turf' })],
      })
    ).toThrow(/surfaceType/);
  });

  it('canonicalises and de-duplicates overlap pairs', () => {
    const built = buildFacilityGraph({
      venues: [venue],
      surfaces: [surface({}), { id: 'v/b', venueId: 'v', name: 'B' }],
      overlapPairs: [
        ['v/a', 'v/b'],
        ['v/b', 'v/a'],
      ],
    });
    expect(built.stats.overlapPairCount).toBe(1);
    expect(built.overlapPairs).toEqual([['v/a', 'v/b']]);
    expect(surfacesConflict(built, 'v/a', 'v/b').conflict).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Schema and purity                                                           */
/* -------------------------------------------------------------------------- */

describe('facility graph :: schema and purity', () => {
  it('produces adapter output that satisfies the strict input schema', () => {
    // Guards against the facility model becoming the sixth divergent copy of a
    // shared shape (ARCHITECTURE.md 1.1).
    const input = toSeason2026FacilityGraphInput(geometry);
    const parsed = FacilityGraphInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new Error(`adapter output violates FacilityGraphInputSchema: ${parsed.error.message}`);
    }
    expect(parsed.success).toBe(true);
    expect(input.surfaces.length).toBe(geometry.fields.length);
    expect(input.venues.length).toBe(geometry.venues.length);
  });

  it('registers a severity for every reason code', () => {
    const codes = Object.values(FACILITY_REASON);
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) {
      expect(FACILITY_REASON_SEVERITY[code], code).toBeDefined();
      expect(Object.values(FACILITY_SEVERITY)).toContain(FACILITY_REASON_SEVERITY[code]);
    }
    // Overlap severity lives in the table, so Prompt 2.1 can override it there.
    expect(FACILITY_REASON_SEVERITY[FACILITY_REASON.OCCUPIED_SPATIAL_OVERLAP]).toBe(
      FACILITY_SEVERITY.BLOCKING
    );
    expect(FACILITY_REASON_SEVERITY[FACILITY_REASON.LINING_MISMATCH]).toBe(
      FACILITY_SEVERITY.COMPROMISE
    );
  });

  it('imports nothing from node: and nothing from the fixture loaders', () => {
    const facilityDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      'packages',
      'core',
      'src',
      'facility'
    );
    /** @type {string[]} */
    const files = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith('.js')) files.push(full);
      }
    };
    walk(facilityDir);
    expect(files.length).toBeGreaterThan(5);

    const specifiers = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/^\s*(?:import|export)[^\n]*?from\s+'([^']+)'/gm)) {
        specifiers.push({ file, specifier: match[1] });
      }
    }
    expect(specifiers.length).toBeGreaterThan(0);
    for (const { file, specifier } of specifiers) {
      expect(specifier.startsWith('node:'), `${file} imports ${specifier}`).toBe(false);
      expect(specifier.includes('fixtures/'), `${file} imports ${specifier}`).toBe(false);
      expect(specifier.includes('react'), `${file} imports ${specifier}`).toBe(false);
    }
    // The one external dependency is zod, and it is used.
    expect(specifiers.some((entry) => entry.specifier === 'zod')).toBe(true);
  });

  it('does not mutate its input and returns a frozen graph', () => {
    const input = toSeason2026FacilityGraphInput(geometry);
    const before = JSON.stringify(input);
    const deepFreeze = (value) => {
      if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
      Object.freeze(value);
      for (const inner of Object.values(value)) deepFreeze(inner);
      return value;
    };
    deepFreeze(input);

    const built = buildFacilityGraph(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.isFrozen(built)).toBe(true);
    expect(Object.isFrozen(built.surfaces)).toBe(true);
    expect(Object.isFrozen(built.surfaces[sid(ALDER, 'Pitch 1A')].cells)).toBe(true);
    expect(built.stats).toEqual(graph.stats);
  });
});
