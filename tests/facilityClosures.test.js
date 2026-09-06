/**
 * Tests for closures (`availability/closures.js`, Phase 8.3): the constraint
 * log as availability windows, reconciled with the facility graph.
 *
 * Every date, count and reason is derived from `field_constraints.csv` and
 * the two corpora at test time. The date universe for "on that date and not
 * on others" is the 129 distinct dates of `permit_reservations.csv` — real
 * corpus dates on every weekday — so a rule is shown to fire on exactly the
 * dates it should and on none of the rest, rather than on two hand-picked
 * examples.
 *
 * The acceptance test from PHASE_8_PLAN §8.3 is the second block: a practice
 * booked through the alias "7v7 Field 1" is reported with the closure named,
 * and the eight Maplewood aliases are reported on 2026-10-23 (and, as 8.0
 * found, 2026-09-24) and on no other date.
 */

import { describe, it, expect } from 'vitest';

import {
  indexFormats,
  loadCombinedSchedule,
  loadFacilityGeometry,
  loadFacilityPermits,
  loadGameFormats,
  loadSeason2026,
  loadSeason2026Practice,
  loadSunsets,
  ALL_DAY_CLOSE_MINUTES as LOADER_ALL_DAY_CLOSE_MINUTES,
  SEASON_2026_PRACTICE_FINDING,
} from '@squadlogic/core/fixtures/index.js';

import {
  FACILITY_REASON,
  buildFacilityGraph,
  buildFacilityGraphFromSeason2026,
  buildFieldAliasMap,
  buildSeason2026PracticeFacilityGraph,
  buildSeason2026VenueComplexMap,
  extendFacilityGraphInputWithSeason2026PracticeLayer,
  resolvePracticeSurface,
  season2026PracticeSurfaceId,
  season2026SurfaceId,
  season2026VenueId,
  surfacesConflict,
  surfacesOfAlias,
  toSeason2026AliasRings,
  toSeason2026FacilityGraphInput,
} from '@squadlogic/core/facility/index.js';

import {
  ALL_DAY_CLOSE_MINUTES,
  AVAILABILITY_REASON,
  AVAILABILITY_REASON_SEVERITY,
  AVAILABILITY_SEVERITY,
  AVAILABILITY_STATUS,
  CLOSURE_DECIDED_CODE_BY_SCOPE,
  CLOSURE_SCOPE,
  CLOSURE_UNDECIDABLE_CODE_BY_SCOPE,
  ClosureSetInputSchema,
  ClosureWindowSchema,
  ISO_DATE_PATTERN,
  SEASON_2026_CONSTRAINT_FIELDS_READINGS,
  buildAvailabilityCalendarFromSeason2026,
  buildClosureSet,
  buildSeason2026ClosureSet,
  checkClosures,
  checkKickoffAvailability,
  deriveAvailabilityStatus,
  findClosureBreaches,
  isAllDayWindow,
  readSeason2026ConstraintFields,
  reconcileAdjacencyRule,
  toSeason2026ClosureInput,
  weekdayCodeOf,
} from '@squadlogic/core/availability/index.js';

import { buildFormatTimingTableFromSeason2026 } from '@squadlogic/core/timing/index.js';

import { STANDING_RULES } from '@squadlogic/core/ruleEngine/index.js';

/* -------------------------------------------------------------------------- */
/* Corpus, loaded once                                                         */
/* -------------------------------------------------------------------------- */

const geometry = loadFacilityGeometry();
const season = loadSeason2026();
const practice = loadSeason2026Practice({ season });
const gameGraph = buildFacilityGraphFromSeason2026(geometry);
const graph = buildSeason2026PracticeFacilityGraph(geometry);
const complexes = buildSeason2026VenueComplexMap();
const closures = buildSeason2026ClosureSet(practice.fieldConstraints, graph, complexes);
const aliases = buildFieldAliasMap(
  graph,
  complexes,
  toSeason2026AliasRings(practice.fieldAliases, practice.fieldCodeNames)
);

const sunsets = loadSunsets();
const kickoffTable = buildFormatTimingTableFromSeason2026(loadGameFormats());
const kickoffCalendar = buildAvailabilityCalendarFromSeason2026(
  loadFacilityPermits({ seasonYear: Number(sunsets[0].date.slice(0, 4)) }),
  sunsets
);

const ALDER = 'Alder Park';
const sid = (venue, field) => season2026SurfaceId(venue, field);
const pid = (venue, field, subunit = null) => season2026PracticeSurfaceId(venue, field, subunit);

/** Every distinct corpus date, on every weekday: the universe for "and not on other dates". */
const DATES = [...new Set(practice.permitReservations.map((row) => row.date))].sort();

const booking = (id, surfaceId, date, startMinutes = 16 * 60, endMinutes = 17 * 60) => ({
  id,
  surfaceId,
  date,
  startMinutes,
  endMinutes,
  format: null,
  label: id,
});
const codesOf = (result) => result.findings.map((f) => f.code);
const blockingOf = (result) =>
  result.findings.filter((f) => f.severity === AVAILABILITY_SEVERITY.BLOCKING);
const constraintRow = (id) => practice.fieldConstraints.find((row) => row.id === id);

/* -------------------------------------------------------------------------- */
/* Guard                                                                       */
/* -------------------------------------------------------------------------- */

describe('closures :: corpus guard', () => {
  it('holds every constraint row as one closure, and reads each fields cell from the declared table', () => {
    expect(practice.fieldConstraints).toHaveLength(13);
    expect(closures.stats.closureCount).toBe(13);
    expect(closures.closureIds).toEqual(practice.fieldConstraints.map((row) => row.id));
    expect(closures.stats.byKind).toEqual({
      [CLOSURE_SCOPE.VENUE]: 5,
      [CLOSURE_SCOPE.SURFACE]: 5,
      [CLOSURE_SCOPE.UNREADABLE]: 1,
      [CLOSURE_SCOPE.NOT_GROUND]: 1,
      [CLOSURE_SCOPE.ADJACENCY]: 1,
      [CLOSURE_SCOPE.VENUE_UNKNOWN]: 0,
      [CLOSURE_SCOPE.SURFACE_UNKNOWN]: 0,
    });
    // The set's only finding is its own wiring declaration; nothing about the
    // corpus rows is reported at build time. See the enforcement block below.
    expect(closures.findings.map((f) => f.code)).toEqual([AVAILABILITY_REASON.CLOSURE_SET_UNWIRED]);
    // Every reading in the table is used by some row, and every row's cell is
    // in the table or is the one corrupted date.
    const cells = new Set(practice.fieldConstraints.map((row) => row.fields));
    for (const cell of Object.keys(SEASON_2026_CONSTRAINT_FIELDS_READINGS)) {
      expect(cells.has(cell), cell).toBe(true);
    }
    expect([...cells].filter((cell) => !(cell in SEASON_2026_CONSTRAINT_FIELDS_READINGS))).toEqual([
      '2026-01-07',
    ]);
    expect(readSeason2026ConstraintFields('2026-01-07').kind).toBe(CLOSURE_SCOPE.UNREADABLE);
    expect(() => readSeason2026ConstraintFields('Field 9')).toThrow(/no declared reading/);
  });

  it('reads "all day" exactly as the corpus loader does: one constant, one function', () => {
    expect(ALL_DAY_CLOSE_MINUTES).toBe(LOADER_ALL_DAY_CLOSE_MINUTES);
    expect(ALL_DAY_CLOSE_MINUTES).toBe(23 * 60);
    expect(isAllDayWindow(0, 23 * 60)).toBe(true);
    expect(isAllDayWindow(0, 22 * 60 + 59)).toBe(false);
    expect(isAllDayWindow(1, 23 * 60)).toBe(false);
    expect(closures.stats.allDayCount).toBe(4);
    for (const closure of closures.closures) {
      expect(closure.allDay).toBe(isAllDayWindow(closure.startMinutes, closure.endMinutes));
    }
    // The loader's season-long closures are exactly this set's all-day venue
    // closures: the loader stays the producer of "season-long", and the set agrees.
    const allDayVenue = closures.closures
      .filter((c) => c.allDay && c.scope.kind === CLOSURE_SCOPE.VENUE)
      .map((c) => c.id)
      .sort();
    expect(allDayVenue).toEqual(practice.seasonLongClosures.map((c) => c.id).sort());
    expect(allDayVenue).toHaveLength(3);
    expect(
      allDayVenue
        .map((id) => closures.closures.find((c) => c.id === id).scope.venueIds)
        .flat()
        .map((venueId) => graph.venues[venueId].name)
        .sort()
    ).toEqual(['Cedarbrook Park', 'Fivepines Park', 'Quarrywood Park']);
  });

  it('scopes the Maplewood rows to both halves of the declared complex, by structure', () => {
    const maplewood = closures.closures.filter((c) => c.venueName === 'Maplewood');
    expect(maplewood).toHaveLength(4);
    for (const closure of maplewood) {
      expect(closure.scope.venueIds).toEqual([
        season2026VenueId('Maplewood Back'),
        season2026VenueId('Maplewood Front'),
      ]);
    }
    const alder4 = closures.closures.filter((c) => c.fieldsRaw === '4');
    expect(alder4).toHaveLength(5);
    for (const closure of alder4) {
      expect(closure.scope).toEqual({
        kind: CLOSURE_SCOPE.SURFACE,
        surfaceIds: [sid(ALDER, 'Pitch 4')],
      });
    }
  });

  it('registers a severity for every closure code', () => {
    const codes = Object.values(AVAILABILITY_REASON).filter((code) => code.startsWith('CLOSURE_'));
    expect(codes).toHaveLength(9);
    for (const code of codes) {
      expect(Object.values(AVAILABILITY_SEVERITY)).toContain(AVAILABILITY_REASON_SEVERITY[code]);
    }
    expect(AVAILABILITY_REASON_SEVERITY[AVAILABILITY_REASON.CLOSURE_BLOCKS_BOOKING]).toBe(
      AVAILABILITY_SEVERITY.BLOCKING
    );
    expect(AVAILABILITY_REASON_SEVERITY[AVAILABILITY_REASON.CLOSURE_SCOPE_UNREADABLE]).toBe(
      AVAILABILITY_SEVERITY.COMPROMISE
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Acceptance, from the corpus                                                 */
/* -------------------------------------------------------------------------- */

describe('closures :: acceptance - a practice through "7v7 Field 1" is reported, with the constraint named', () => {
  const ground = surfacesOfAlias(aliases, '7v7 Field 1');
  const offline = constraintRow(
    closures.closures.find((c) => c.venueName === 'Cedarbrook Park').id
  );

  it('resolves the alias to Cedarbrook on the practice ring and finds the season-long closure there', () => {
    expect(ground.surfaces.map((s) => s.surfaceId)).toEqual([sid('Cedarbrook Park', 'Field 1')]);
    expect(ground.unresolvedCandidates).toBe(1);
    expect(offline).toMatchObject({
      reason: 'Offline',
      dateStart: '2026-08-01',
      dateEnd: '2026-11-28',
    });
    const inWindow = DATES.filter((d) => d >= offline.dateStart && d <= offline.dateEnd);
    const outside = DATES.filter((d) => d > offline.dateEnd);
    expect(inWindow.length).toBeGreaterThan(100);
    expect(outside.length).toBeGreaterThan(0);
    for (const date of inWindow) {
      for (const { surfaceId } of ground.surfaces) {
        const result = checkClosures(graph, closures, booking('p', surfaceId, date));
        expect(codesOf(result)).toEqual([AVAILABILITY_REASON.CLOSURE_BLOCKS_BOOKING]);
        const [finding] = result.findings;
        expect(finding.severity).toBe(AVAILABILITY_SEVERITY.BLOCKING);
        expect(finding.message).toContain('Offline 2026-08-01 to 2026-11-28');
        expect(finding.details).toMatchObject({
          closureId: offline.id,
          reason: 'Offline',
          fromDate: '2026-08-01',
          toDate: '2026-11-28',
          allDay: true,
          source: `field_constraints.csv#${offline.rowIndex}`,
        });
        expect(result.meta.closuresConsulted).toBe(13);
      }
    }
    for (const date of outside) {
      expect(
        checkClosures(graph, closures, booking('p', ground.surfaces[0].surfaceId, date)).findings
      ).toEqual([]);
    }
  });

  it('carries the other ring beside it rather than choosing', () => {
    const named = aliases.findings.filter((f) => f.details.displayName === '7v7 Field 1');
    expect(codesOf({ findings: named }).sort()).toEqual([
      FACILITY_REASON.ALIAS_RINGS_DISAGREE,
      FACILITY_REASON.ALIAS_SOURCE_UNCERTAIN,
      FACILITY_REASON.ALIAS_SURFACE_UNKNOWN,
    ]);
  });
});

describe('closures :: acceptance - the Maplewood aliases are reported on the closure dates and on no others', () => {
  const maplewoodAliases = practice.fieldAliases.filter((row) => row.venue === 'Maplewood');
  const maplewoodClosures = practice.fieldConstraints.filter(
    (row) => row.venue === 'Maplewood' && row.allFields
  );

  it('has eight aliases and two all-fields Maplewood rows to test', () => {
    expect(maplewoodAliases).toHaveLength(8);
    expect(maplewoodClosures.map((row) => row.dateStart)).toEqual(['2026-09-24', '2026-10-23']);
    for (const row of maplewoodClosures) {
      expect(row.startMinutes).toBe(16 * 60);
      expect(row.endMinutes).toBe(19 * 60);
    }
  });

  it('blocks a four o’clock practice on every candidate surface on exactly those dates', () => {
    let surfacesTested = 0;
    for (const alias of maplewoodAliases) {
      const ground = surfacesOfAlias(aliases, alias.displayName);
      expect(ground.surfaces.length, alias.displayName).toBeGreaterThan(0);
      for (const { surfaceId } of ground.surfaces) {
        surfacesTested += 1;
        const blockedOn = DATES.filter(
          (date) =>
            blockingOf(checkClosures(graph, closures, booking('p', surfaceId, date))).length > 0
        );
        expect(blockedOn, `${alias.displayName} on ${surfaceId}`).toEqual(
          maplewoodClosures.map((row) => row.dateStart)
        );
        for (const date of blockedOn) {
          const [finding] = blockingOf(
            checkClosures(graph, closures, booking('p', surfaceId, date))
          );
          expect(finding.code).toBe(AVAILABILITY_REASON.CLOSURE_BLOCKS_BOOKING);
          expect(finding.message).toContain(`School Event ${date} to ${date}`);
          expect(finding.details.reason).toBe('School Event');
        }
      }
    }
    // Eight aliases; "Junior Field 1" carries both halves and "7v7 Field 2"
    // resolves on the fields ring only, so nine surfaces in all.
    expect(surfacesTested).toBe(9);
  });

  it('does not block a practice that ends before the window opens, on the closure date itself', () => {
    const surfaceId = sid('Maplewood Back', 'Field 2');
    for (const row of maplewoodClosures) {
      const before = checkClosures(
        graph,
        closures,
        booking('p', surfaceId, row.dateStart, 15 * 60, 16 * 60)
      );
      expect(blockingOf(before)).toEqual([]);
      const after = checkClosures(
        graph,
        closures,
        booking('p', surfaceId, row.dateStart, 19 * 60, 20 * 60)
      );
      expect(blockingOf(after)).toEqual([]);
      const during = checkClosures(
        graph,
        closures,
        booking('p', surfaceId, row.dateStart, 18 * 60, 19 * 60)
      );
      expect(blockingOf(during)).toHaveLength(1);
    }
  });

  it('reports every resolved Maplewood practice the grid holds on the closure dates, and names the ground it cannot place', () => {
    // Expand each weekly grid row onto the corpus dates of its weekday.
    const placed = practice.practiceSlots.map((slot) => ({
      slot,
      res: resolvePracticeSurface(graph, complexes, slot),
    }));
    const resolved = placed.filter(({ res }) => res.status === 'resolved');
    expect(resolved.length).toBeGreaterThan(400);
    const bookings = resolved.flatMap(({ slot, res }) =>
      DATES.filter((date) => weekdayCodeOf(date) === slot.weekday).map((date) =>
        booking(`${slot.id}@${date}`, res.surfaceIds[0], date, slot.startMinutes, slot.endMinutes)
      )
    );
    const replay = findClosureBreaches(graph, closures, bookings);
    expect(replay.meta.bookingsChecked).toBe(bookings.length);
    expect(replay.meta.closuresConsulted).toBe(bookings.length * 13);
    const blocked = replay.findings.filter(
      (f) => f.code === AVAILABILITY_REASON.CLOSURE_BLOCKS_BOOKING
    );

    // The expected count, derived independently: resolved Maplewood rows on
    // each closure's weekday whose time meets 16:00-19:00.
    const meets = (slot, row) =>
      slot.venue === 'Maplewood' &&
      slot.weekday === weekdayCodeOf(row.dateStart) &&
      slot.startMinutes < row.endMinutes &&
      row.startMinutes < slot.endMinutes;
    const expectedByDate = new Map(
      maplewoodClosures.map((row) => [
        row.dateStart,
        resolved.filter(({ slot }) => meets(slot, row)).length,
      ])
    );
    for (const [date, count] of expectedByDate) {
      expect(
        blocked.filter((f) => f.details.date === date),
        date
      ).toHaveLength(count);
    }
    expect(blocked).toHaveLength([...expectedByDate.values()].reduce((a, b) => a + b, 0));
    expect(blocked.length).toBeGreaterThan(0);
    for (const finding of blocked) {
      expect(finding.details.venueId).toBe(season2026VenueId('Maplewood Back'));
    }

    // A finding, not an assumption: 2026-10-23 is a Friday, and the only
    // Maplewood practices the grid holds on a Friday are the four
    // `Maplewood / Front / A` rows — ground no ring-free read can place. So the
    // 10-23 closure meets no *resolved* practice, and those four rows are
    // reported as unknown ground rather than silently passing the closure.
    expect(expectedByDate.get('2026-10-23')).toBe(0);
    expect(expectedByDate.get('2026-09-24')).toBeGreaterThan(0);
    const fridayAtMaplewood = placed.filter(
      ({ slot }) => slot.venue === 'Maplewood' && slot.weekday === 'FRI'
    );
    expect(fridayAtMaplewood).toHaveLength(4);
    for (const { slot, res } of fridayAtMaplewood) {
      expect(`${slot.field}/${slot.subunit}`).toBe('Front/A');
      expect(res.status).toBe('surface-unknown');
      const minted = `${slot.venue}/${slot.field}/${slot.subunit}`;
      const result = checkClosures(
        graph,
        closures,
        booking(slot.id, minted, '2026-10-23', slot.startMinutes, slot.endMinutes)
      );
      expect(codesOf(result)).toEqual([FACILITY_REASON.SURFACE_UNKNOWN]);
    }

    // The Gardening Day row (unreadable) and the parking row (not ground)
    // are reported too, on their own dates, and never as blocks.
    const unreadable = replay.findings.filter(
      (f) => f.code === AVAILABILITY_REASON.CLOSURE_SCOPE_UNREADABLE
    );
    const notGround = replay.findings.filter(
      (f) => f.code === AVAILABILITY_REASON.CLOSURE_NOT_GROUND
    );
    // 07:00-12:00 on a Saturday meets no weekday practice; the parking row does.
    expect(unreadable).toEqual([]);
    expect(new Set(notGround.map((f) => f.details.date))).toEqual(new Set(['2026-10-29']));
    expect(notGround.length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* The other scope kinds                                                       */
/* -------------------------------------------------------------------------- */

describe('closures :: a surface closure covers everything that shares its ground', () => {
  const flagFootball = practice.fieldConstraints.filter((row) => row.fields === '4');
  const dates = flagFootball.map((row) => row.dateStart);

  it('closes Pitch 4, its halves and their sides on the five Saturdays, 11:00-13:00', () => {
    expect(dates).toHaveLength(5);
    for (const date of dates) expect(weekdayCodeOf(date)).toBe('SAT');
    const covered = [
      sid(ALDER, 'Pitch 4'),
      sid(ALDER, 'Pitch 4A'),
      pid(ALDER, 'Pitch 4B', 'Side 1'),
    ];
    for (const surfaceId of covered) {
      const blockedOn = DATES.filter(
        (date) =>
          blockingOf(
            checkClosures(graph, closures, booking('g', surfaceId, date, 11 * 60, 12 * 60))
          ).length > 0
      );
      expect(blockedOn, surfaceId).toEqual(dates);
      const [finding] = blockingOf(
        checkClosures(graph, closures, booking('g', surfaceId, dates[0], 11 * 60, 12 * 60))
      );
      expect(finding.details.reason).toBe('Adaptive Sports Org Flag Football');
      expect(finding.details.fieldsRaw).toBe('4');
    }
    // The closure is an occupation of Pitch 4 by someone else, so it reaches
    // exactly what a club booking of Pitch 4 would clash with: Pitch 3, across
    // the declared {3, 4} overlap pair, and nothing across {1, 2}. The
    // coverage names the facility relation that joined them.
    const pitch3 = blockingOf(
      checkClosures(
        graph,
        closures,
        booking('g', sid(ALDER, 'Pitch 3'), dates[0], 11 * 60, 12 * 60)
      )
    );
    expect(pitch3).toHaveLength(1);
    expect(pitch3[0].details.coverage).toBe(FACILITY_REASON.OCCUPIED_SPATIAL_OVERLAP);
    for (const surfaceId of [
      sid(ALDER, 'Pitch 1'),
      sid(ALDER, 'Pitch 2'),
      pid(ALDER, 'Pitch 2A'),
    ]) {
      expect(
        blockingOf(
          checkClosures(graph, closures, booking('g', surfaceId, dates[0], 11 * 60, 12 * 60))
        ),
        surfaceId
      ).toEqual([]);
    }
    const coverageOf = (surfaceId) =>
      blockingOf(
        checkClosures(graph, closures, booking('g', surfaceId, dates[0], 11 * 60, 12 * 60))
      )[0].details.coverage;
    expect(coverageOf(sid(ALDER, 'Pitch 4'))).toBe(FACILITY_REASON.OCCUPIED_SAME_SURFACE);
    expect(coverageOf(sid(ALDER, 'Pitch 4A'))).toBe(FACILITY_REASON.OCCUPIED_PARENT_CHILD);
    expect(coverageOf(pid(ALDER, 'Pitch 4B', 'Side 1'))).toBe(
      FACILITY_REASON.OCCUPIED_PARENT_CHILD
    );
    // ... and not at one o'clock.
    expect(
      blockingOf(
        checkClosures(
          graph,
          closures,
          booking('g', sid(ALDER, 'Pitch 4A'), dates[0], 13 * 60, 14 * 60)
        )
      )
    ).toEqual([]);
  });

  it('reports the unreadable Gardening Day cell as a compromise on every Maplewood surface in its window', () => {
    const gardening = practice.fieldConstraints.find((row) => row.reason === 'Gardening Day');
    expect(gardening.fields).toBe('2026-01-07');
    for (const surfaceId of [sid('Maplewood Back', 'Field 7'), sid('Maplewood Front', 'Field 1')]) {
      const result = checkClosures(
        graph,
        closures,
        booking('p', surfaceId, gardening.dateStart, 8 * 60, 9 * 60)
      );
      expect(codesOf(result)).toEqual([AVAILABILITY_REASON.CLOSURE_SCOPE_UNREADABLE]);
      expect(result.findings[0].severity).toBe(AVAILABILITY_SEVERITY.COMPROMISE);
      expect(result.findings[0].message).toContain('"2026-01-07"');
      expect(deriveAvailabilityStatus(result.findings)).toBe(AVAILABILITY_STATUS.COMPROMISED);
    }
  });

  it('reports the parking row as information that closes no ground', () => {
    const parking = practice.fieldConstraints.find((row) => row.fields === 'Parking');
    const result = checkClosures(
      graph,
      closures,
      booking('p', sid('Maplewood Back', 'Field 1'), parking.dateStart, 16 * 60, 17 * 60)
    );
    expect(codesOf(result)).toEqual([AVAILABILITY_REASON.CLOSURE_NOT_GROUND]);
    expect(deriveAvailabilityStatus(result.findings)).toBe(AVAILABILITY_STATUS.ALLOWED);
  });
});

describe('closures :: the adjacency rule is the graph’s overlap pairs, held once', () => {
  const spacing = closures.closures.find((c) => c.scope.kind === CLOSURE_SCOPE.ADJACENCY);

  it('is the "Adjacent Fields / Spacing" row, and it names no pairs', () => {
    const row = constraintRow(spacing.id);
    expect(row).toMatchObject({ venue: ALDER, fields: 'Adjacent Fields', reason: 'Spacing' });
    expect(spacing.allDay).toBe(true);
    expect(spacing.fromDate).toBe('2026-08-01');
    expect(spacing.toDate).toBe('2026-11-28');
    // The plan quotes a row reading "Fields 1&2 or 3&4 may not run
    // concurrently". No such text exists in the sheet; the pairs are the
    // geometry file's and nowhere else.
    expect(practice.fieldConstraints.some((r) => /concurrent/i.test(r.reason))).toBe(false);
  });

  it('agrees with the graph: exactly the two declared Alder pairs, over the row’s whole span', () => {
    const reconciled = reconcileAdjacencyRule(graph, spacing);
    expect(reconciled.agrees).toBe(true);
    expect(reconciled.venueIds).toEqual([season2026VenueId(ALDER)]);
    expect(reconciled.overlapPairs).toEqual([
      [sid(ALDER, 'Pitch 1'), sid(ALDER, 'Pitch 2')],
      [sid(ALDER, 'Pitch 3'), sid(ALDER, 'Pitch 4')],
    ]);
    expect(reconciled.pairsByVenue).toEqual({ [season2026VenueId(ALDER)]: 2 });
    // The season the row spans is inside the graph's timeless pairs, so every
    // scheduled date is covered.
    for (const date of season.scheduledDates) {
      expect(date >= spacing.fromDate && date <= spacing.toDate).toBe(true);
    }
  });

  it('would notice a graph that had lost the pairs (positive control)', () => {
    const input = extendFacilityGraphInputWithSeason2026PracticeLayer(
      toSeason2026FacilityGraphInput(geometry)
    );
    const pairless = buildFacilityGraph({ ...input, overlapPairs: [] });
    const reconciled = reconcileAdjacencyRule(pairless, spacing);
    expect(reconciled.agrees).toBe(false);
    expect(reconciled.overlapPairs).toEqual([]);
    expect(() => reconcileAdjacencyRule(graph, closures.closures[0])).toThrow(
      /not an adjacency rule/
    );
  });

  it('defers to occupancy rather than blocking twice: a 2A/1A clash is one facility finding', () => {
    const result = checkClosures(
      graph,
      closures,
      booking('p', pid(ALDER, 'Pitch 2A'), '2026-09-15')
    );
    expect(codesOf(result)).toEqual([AVAILABILITY_REASON.CLOSURE_ADJACENCY_DEFERRED]);
    expect(result.findings[0].severity).toBe(AVAILABILITY_SEVERITY.INFO);
  });
});

/* -------------------------------------------------------------------------- */
/* Unknowns stay unknown                                                       */
/* -------------------------------------------------------------------------- */

describe('closures :: unknowns are reported, never folded into "no closure applies"', () => {
  it('decides a booking with no end by its start when it can, and says undecidable only when it cannot', () => {
    // Kicks off before the 11:00 window with no known end: may or may not run into it.
    const before = checkClosures(
      graph,
      closures,
      booking('g', sid(ALDER, 'Pitch 4'), '2026-09-19', 10 * 60, null)
    );
    expect(codesOf(before)).toContain(AVAILABILITY_REASON.CLOSURE_OVERLAP_UNDECIDABLE);
    expect(codesOf(before)).not.toContain(AVAILABILITY_REASON.CLOSURE_BLOCKS_BOOKING);
    expect(before.meta.closuresApplied).toBe(1); // the adjacency rule, which is all-day
    // Kicks off inside the window: already on closed ground, whatever its end.
    const inside = checkClosures(
      graph,
      closures,
      booking('g', sid(ALDER, 'Pitch 4'), '2026-09-19', 11 * 60 + 30, null)
    );
    expect(codesOf(inside)).toContain(AVAILABILITY_REASON.CLOSURE_BLOCKS_BOOKING);
    expect(codesOf(inside)).not.toContain(AVAILABILITY_REASON.CLOSURE_OVERLAP_UNDECIDABLE);
    // Kicks off after it closes: decided clean without an end.
    const after = checkClosures(
      graph,
      closures,
      booking('g', sid(ALDER, 'Pitch 4'), '2026-09-19', 13 * 60, null)
    );
    expect(codesOf(after)).toEqual([AVAILABILITY_REASON.CLOSURE_ADJACENCY_DEFERRED]);
    const allDay = checkClosures(
      graph,
      closures,
      booking('p', sid('Cedarbrook Park', 'Field 1'), '2026-09-19', 11 * 60, null)
    );
    expect(codesOf(allDay)).toEqual([AVAILABILITY_REASON.CLOSURE_BLOCKS_BOOKING]);
  });

  it('refuses a malformed booking rather than letting it fall outside every window', () => {
    // An unpadded month compares as a string past every closure's toDate; an
    // undefined start meets no timed window and every all-day one. Both are
    // the sibling contract's business: findFacilityConflicts() parses every
    // booking through FacilityBookingSchema, and so does this.
    const surfaceId = sid('Maplewood Back', 'Field 2');
    expect(() =>
      checkClosures(graph, closures, {
        id: 'p',
        surfaceId,
        date: '2026-9-24',
        startMinutes: 16 * 60,
        endMinutes: 17 * 60,
      })
    ).toThrow();
    expect(() =>
      checkClosures(
        graph,
        closures,
        /** @type {any} */ ({ id: 'p', surfaceId, date: '2026-09-24', endMinutes: 1020 })
      )
    ).toThrow();
    expect(() =>
      findClosureBreaches(graph, closures, [
        { id: 'p', surfaceId, date: '2026-9-24', startMinutes: 960, endMinutes: 1020 },
      ])
    ).toThrow();
    // ... and the well-formed twin of the first is the School Event block.
    expect(codesOf(checkClosures(graph, closures, booking('p', surfaceId, '2026-09-24')))).toEqual([
      AVAILABILITY_REASON.CLOSURE_BLOCKS_BOOKING,
    ]);
  });

  it('never lets "undecidable" outrank the decided answer, and lets the table say so', () => {
    // Round 3, finding 4. This used to be one code whose severity the call site
    // capped per scope kind, so `CLOSURE_OVERLAP_UNDECIDABLE` read `info` here
    // and `compromise` below while the frozen table said `compromise` for both
    // — a call site deciding severity, which `availability/reasonCodes.js` says
    // never happens. Two codes now, one per severity, and the table governs.
    //
    // Endless, kicking off before 16:00 on the parking date: a decided "yes"
    // would be CLOSURE_NOT_GROUND (info), so the note code is the one emitted.
    const parking = practice.fieldConstraints.find((row) => row.fields === 'Parking');
    const surfaceId = sid('Maplewood Back', 'Field 2');
    const parked = checkClosures(
      graph,
      closures,
      booking('p', surfaceId, parking.dateStart, 15 * 60, null)
    );
    const undecidable = parked.findings.filter(
      (f) => f.code === AVAILABILITY_REASON.CLOSURE_NOTE_UNDECIDABLE
    );
    expect(undecidable).toHaveLength(1);
    expect(undecidable[0].severity).toBe(AVAILABILITY_SEVERITY.INFO);
    expect(undecidable[0].details).toMatchObject({
      decidedCode: AVAILABILITY_REASON.CLOSURE_NOT_GROUND,
      decidedSeverity: AVAILABILITY_SEVERITY.INFO,
    });
    expect(deriveAvailabilityStatus(parked.findings)).toBe(AVAILABILITY_STATUS.ALLOWED);
    // The same booking on the School Event date: a decided "yes" would block,
    // so the compromise code is emitted.
    const schoolEvent = practice.fieldConstraints.find(
      (row) => row.venue === 'Maplewood' && row.allFields
    );
    const closed = checkClosures(
      graph,
      closures,
      booking('p', surfaceId, schoolEvent.dateStart, 15 * 60, null)
    );
    const stillUndecidable = closed.findings.filter(
      (f) => f.code === AVAILABILITY_REASON.CLOSURE_OVERLAP_UNDECIDABLE
    );
    expect(stillUndecidable).toHaveLength(1);
    expect(stillUndecidable[0].severity).toBe(AVAILABILITY_SEVERITY.COMPROMISE);
    expect(stillUndecidable[0].details.decidedCode).toBe(
      AVAILABILITY_REASON.CLOSURE_BLOCKS_BOOKING
    );
    // Neither code's severity depends on where it came from: every emitted
    // finding carries exactly what the frozen table says for its code.
    for (const finding of [...parked.findings, ...closed.findings]) {
      expect(finding.severity, finding.code).toBe(AVAILABILITY_REASON_SEVERITY[finding.code]);
    }
  });

  it("pairs each scope kind's undecidable code with its decided one, by severity", () => {
    // The two tables are the ones that could drift into a third rule, so the
    // pairing is asserted rather than described: for every scope kind that has
    // a decided answer, the undecidable code's severity equals the decided
    // code's. Derived from the production tables, not from a list typed here.
    const scopeKinds = Object.values(CLOSURE_SCOPE);
    /** The test's own ordering, so the production tables are compared and not re-stated. */
    const RANK = { info: 0, compromise: 1, blocking: 2 };
    const rank = (code) => RANK[AVAILABILITY_REASON_SEVERITY[code]];
    const undecidableCodes = [...new Set(Object.values(CLOSURE_UNDECIDABLE_CODE_BY_SCOPE))];
    expect(undecidableCodes).toHaveLength(2);
    let paired = 0;
    for (const kind of scopeKinds) {
      const decided = CLOSURE_DECIDED_CODE_BY_SCOPE[kind];
      const undecided = CLOSURE_UNDECIDABLE_CODE_BY_SCOPE[kind];
      if (!decided) {
        // Only `venue-unknown` has no decided answer, because it reaches no
        // ground at all; it must have no undecidable code either.
        expect(kind, `${kind} has an undecidable code but no decided one`).toBe(
          CLOSURE_SCOPE.VENUE_UNKNOWN
        );
        expect(undecided).toBeUndefined();
        continue;
      }
      expect(undecided, kind).toBeTruthy();
      // Not knowing never outranks knowing...
      expect(rank(undecided), `${kind}: ${undecided} vs ${decided}`).toBeLessThanOrEqual(
        rank(decided)
      );
      // ... and it is the loudest declared code that still fits under that
      // ceiling, so the split is a pairing rather than a way to make everything
      // quiet.
      for (const other of undecidableCodes) {
        if (rank(other) <= rank(decided)) {
          expect(rank(undecided), `${kind}: ${other} fits and is louder`).toBeGreaterThanOrEqual(
            rank(other)
          );
        }
      }
      paired += 1;
    }
    // Non-vacuous: the pairing covers every scope kind but one, and it is not
    // one severity throughout.
    expect(paired).toBe(scopeKinds.length - 1);
    expect(
      new Set(
        scopeKinds
          .filter((kind) => CLOSURE_UNDECIDABLE_CODE_BY_SCOPE[kind])
          .map((kind) => AVAILABILITY_REASON_SEVERITY[CLOSURE_UNDECIDABLE_CODE_BY_SCOPE[kind]])
      ).size
    ).toBe(2);
  });

  it("reports, at build time, a surface reading the row's venue does not hold, instead of throwing", () => {
    // A future `Orchard Park,4,...` row: the readings table says `4` is
    // Pitch 4, and Orchard has no Pitch 4. Every other name-to-ground path in
    // this PR reports; so does this one.
    const alder4 = practice.fieldConstraints.find((row) => row.fields === '4');
    const orchard = { ...alder4, id: 'orchard-4', venue: 'Orchard Park' };
    const set = buildSeason2026ClosureSet([orchard], graph, complexes);
    expect(set.stats.byKind[CLOSURE_SCOPE.SURFACE_UNKNOWN]).toBe(1);
    expect(set.closures[0].scope).toEqual({
      kind: CLOSURE_SCOPE.SURFACE_UNKNOWN,
      venueIds: [season2026VenueId('Orchard Park')],
      surfaceName: 'Pitch 4',
    });
    expect(set.findings.map((f) => f.code)).toEqual([
      AVAILABILITY_REASON.CLOSURE_SURFACE_UNKNOWN,
      AVAILABILITY_REASON.CLOSURE_SET_UNWIRED,
    ]);
    expect(set.findings[0].details).toMatchObject({ closureId: 'orchard-4', fieldsRaw: '4' });
    // Round 3, finding 2: at query time it falls back to the venue, exactly as
    // its sibling `unreadable` does -- "as a compromise, never as nothing". An
    // Orchard booking in its window used to come back with an empty finding
    // list, which a caller holding only this answer reads as a clear date.
    const result = checkClosures(
      graph,
      set,
      booking('p', sid('Orchard Park', 'Field 1'), alder4.dateStart, 11 * 60, 12 * 60)
    );
    expect(codesOf(result)).toEqual([AVAILABILITY_REASON.CLOSURE_SURFACE_UNKNOWN]);
    expect(result.findings[0].severity).toBe(AVAILABILITY_SEVERITY.COMPROMISE);
    expect(result.findings[0].details).toMatchObject({ closureId: 'orchard-4', coverage: null });
    expect(result.meta.closuresConsulted).toBe(1);
    expect(result.meta.closuresApplied).toBe(1);
    // The fallback is the venue and no wider: a booking at another venue in
    // the same window is untouched, and so is one at Orchard outside the dates.
    expect(
      checkClosures(
        graph,
        set,
        booking('p', sid(ALDER, 'Pitch 2'), alder4.dateStart, 11 * 60, 12 * 60)
      ).findings
    ).toEqual([]);
    expect(
      checkClosures(
        graph,
        set,
        booking('p', sid('Orchard Park', 'Field 1'), '2026-12-31', 660, 720)
      ).findings
    ).toEqual([]);
    // ... and the Alder original still resolves to the pitch by structure.
    const real = buildSeason2026ClosureSet([alder4], graph, complexes);
    expect(real.closures[0].scope).toEqual({
      kind: CLOSURE_SCOPE.SURFACE,
      surfaceIds: [sid(ALDER, 'Pitch 4')],
    });
  });

  it('reads "this cell is a date" through the one pattern the corpus parser reports it under', () => {
    // The loader's corruption finding and the adapter's unreadable verdict must
    // fall on the same cells, by construction: both go through ISO_DATE_PATTERN.
    const corrupted = new Set(
      practice.findings
        .filter(
          (f) => f.code === SEASON_2026_PRACTICE_FINDING.CONSTRAINT_FIELDS_EXCEL_DATE_CORRUPTION
        )
        .map((f) => practice.fieldConstraints[f.rowIndex].id)
    );
    expect(corrupted.size).toBe(1);
    const unreadable = new Set(
      closures.closures.filter((c) => c.scope.kind === CLOSURE_SCOPE.UNREADABLE).map((c) => c.id)
    );
    expect(unreadable).toEqual(corrupted);
    for (const row of practice.fieldConstraints) {
      expect(ISO_DATE_PATTERN.test(row.fields)).toBe(corrupted.has(row.id));
      expect(readSeason2026ConstraintFields(row.fields).kind === CLOSURE_SCOPE.UNREADABLE).toBe(
        corrupted.has(row.id)
      );
    }
    // Positive control: a cell of the corrupted shape is unreadable here and a
    // date to the shared pattern; a field range typed as text is neither.
    expect(readSeason2026ConstraintFields('2026-02-03').kind).toBe(CLOSURE_SCOPE.UNREADABLE);
    expect(ISO_DATE_PATTERN.test('1-7')).toBe(false);
  });

  it('reports a surface the graph does not hold instead of answering nothing', () => {
    const result = checkClosures(graph, closures, booking('p', 'nowhere/field-1', '2026-10-23'));
    expect(codesOf(result)).toEqual([FACILITY_REASON.SURFACE_UNKNOWN]);
    expect(result.findings[0].severity).toBe(AVAILABILITY_SEVERITY.BLOCKING);
    expect(result.meta.closuresConsulted).toBe(0);
  });

  it('reports, at build time, a constraint row whose venue the graph does not hold', () => {
    // The game-only graph has no Cedarbrook, Fivepines or Quarrywood.
    const gameOnly = buildSeason2026ClosureSet(practice.fieldConstraints, gameGraph, complexes);
    expect(gameOnly.stats.byKind[CLOSURE_SCOPE.VENUE_UNKNOWN]).toBe(3);
    expect(gameOnly.findings.map((f) => f.code)).toEqual([
      ...Array(3).fill(AVAILABILITY_REASON.CLOSURE_VENUE_UNKNOWN),
      AVAILABILITY_REASON.CLOSURE_SET_UNWIRED,
    ]);
    expect(
      gameOnly.findings
        .filter((f) => f.code === AVAILABILITY_REASON.CLOSURE_VENUE_UNKNOWN)
        .map((f) => f.details.venueName)
        .sort()
    ).toEqual(['Cedarbrook Park', 'Fivepines Park', 'Quarrywood Park']);
    // A venue-unknown closure reaches no ground -- there is no ground to
    // reach -- but it is not silence either. Round 3, finding 2: the build-time
    // finding is not enough on its own, because a caller holding only the query
    // answer would read an empty list as a clear date.
    const unknown = gameOnly.closures.filter((c) => c.scope.kind === CLOSURE_SCOPE.VENUE_UNKNOWN);
    expect(unknown).toHaveLength(3);
    const inside = unknown[0];
    const answer = checkClosures(
      gameGraph,
      gameOnly,
      booking('p', sid(ALDER, 'Pitch 2'), inside.fromDate, 11 * 60, 12 * 60)
    );
    const uncomparable = answer.findings.filter(
      (f) => f.code === AVAILABILITY_REASON.CLOSURE_VENUE_UNKNOWN
    );
    expect(uncomparable.length).toBeGreaterThan(0);
    expect(uncomparable[0].severity).toBe(AVAILABILITY_SEVERITY.COMPROMISE);
    expect(uncomparable[0].details.closureVenueName).toBe(inside.scope.venueName);
    expect(answer.meta.closuresUncomparable).toBe(uncomparable.length);
    // Bounded by the closure's own dates, so it is not attached to every
    // booking of the season: a date outside every venue-unknown window is clean
    // of the code.
    const outside = checkClosures(
      gameGraph,
      gameOnly,
      booking('p', sid(ALDER, 'Pitch 2'), '2026-12-31', 11 * 60, 12 * 60)
    );
    expect(codesOf(outside)).not.toContain(AVAILABILITY_REASON.CLOSURE_VENUE_UNKNOWN);
    expect(outside.meta.closuresUncomparable).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Enforcement: declared, and the declaration is checked                       */
/* -------------------------------------------------------------------------- */

describe('closures :: nothing enforces this layer, and the set says so', () => {
  /** Every reason code the standing rule set claims, from the definitions. */
  const claimedByRules = new Set(STANDING_RULES.flatMap((rule) => rule.reasonCodes));
  const closureCodes = Object.values(AVAILABILITY_REASON).filter((code) =>
    code.startsWith('CLOSURE_')
  );
  const enforcedCodes = (claimed) => closureCodes.filter((code) => claimed.has(code));
  const declaresUnwired = (set) =>
    set.findings.some((f) => f.code === AVAILABILITY_REASON.CLOSURE_SET_UNWIRED);

  it('is not consulted by the kickoff path, which is the gap being declared', () => {
    // Round 3, finding 1, reproduced: a 17:00 kickoff on Maplewood Back Field 2
    // on 2026-09-24 stands inside the 16:00-19:00 venue-wide School Event
    // closure, and `checkKickoffAvailability()` says nothing about it.
    const closed = practice.fieldConstraints.find(
      (row) => row.venue === 'Maplewood' && row.allFields && row.dateStart === '2026-09-24'
    );
    expect(closed).toBeTruthy();
    const surfaceId = sid('Maplewood Back', 'Field 2');
    const answer = checkKickoffAvailability(graph, kickoffTable, kickoffCalendar, {
      surfaceId,
      date: closed.dateStart,
      kickoffMinutes: 17 * 60,
      format: '5v5',
    });
    expect(answer.findings.map((f) => f.code).filter((c) => c.startsWith('CLOSURE_'))).toEqual([]);
    // ... while the evaluator, asked directly about the same hour, blocks it.
    const direct = checkClosures(
      graph,
      closures,
      booking('same-hour', surfaceId, closed.dateStart, 17 * 60, 18 * 60)
    );
    expect(codesOf(direct)).toContain(AVAILABILITY_REASON.CLOSURE_BLOCKS_BOOKING);
  });

  it('declares the gap on every set it builds, and no rule claims a closure code', () => {
    expect(declaresUnwired(closures)).toBe(true);
    const declaration = closures.findings.find(
      (f) => f.code === AVAILABILITY_REASON.CLOSURE_SET_UNWIRED
    );
    expect(declaration.severity).toBe(AVAILABILITY_SEVERITY.INFO);
    expect(declaration.details.closureCount).toBe(closures.stats.closureCount);
    // Meta-assertion: the standing rule set is real and claims codes, so
    // "claims no closure code" is a fact about closures and not about an empty
    // set of rules.
    expect(STANDING_RULES.length).toBeGreaterThan(5);
    expect(claimedByRules.size).toBeGreaterThan(10);
    expect(closureCodes.length).toBeGreaterThan(5);
    expect(enforcedCodes(claimedByRules)).toEqual([]);
  });

  it('ties the declaration to the rules, so one cannot change without the other', () => {
    // The biconditional. A closure set declares itself unwired **exactly**
    // while no standing rule claims a closure code. Wiring a rule without
    // removing the declaration, or removing the declaration without wiring a
    // rule, each break this.
    expect(declaresUnwired(closures)).toBe(enforcedCodes(claimedByRules).length === 0);

    // Positive control: a rule that claims one. The rule is built here rather
    // than registered, so the assertion is exercised without changing the
    // engine — and the biconditional is shown to reject the state where the
    // code gains an evaluator and the declaration stays.
    const wired = new Set([...claimedByRules, AVAILABILITY_REASON.CLOSURE_BLOCKS_BOOKING]);
    expect(enforcedCodes(wired)).toEqual([AVAILABILITY_REASON.CLOSURE_BLOCKS_BOOKING]);
    expect(declaresUnwired(closures) === (enforcedCodes(wired).length === 0)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Full-corpus replay                                                          */
/* -------------------------------------------------------------------------- */

describe('closures :: full-corpus replay of the published games', () => {
  const formatsByName = indexFormats(loadGameFormats());
  const games = loadCombinedSchedule({ formatsByName });
  const bookings = games.map((game) => ({
    id: game.id,
    surfaceId: sid(game.venue, game.field),
    date: game.date,
    startMinutes: game.kickoffMinutes,
    endMinutes: game.endMinutes,
    format: game.format,
    label: `${game.homeLabel} v ${game.awayLabel}`,
  }));

  it('checks every published game against every closure and reports what it found', () => {
    const replay = findClosureBreaches(graph, closures, bookings);
    expect(replay.meta.bookingsChecked).toBe(games.length);
    expect(replay.meta.bookingsChecked).toBeGreaterThan(600);
    expect(replay.meta.closuresConsulted).toBe(games.length * 13);
    const byCode = {};
    for (const finding of replay.findings) byCode[finding.code] = (byCode[finding.code] ?? 0) + 1;
    // A finding, derived rather than assumed. The season schedules nothing on
    // Alder Pitch 4 in the flag-football windows and nothing at Maplewood on a
    // weekday — but it does schedule games on Pitch 3 at 10:00 and 12:00 on
    // every flag-football Saturday, and Pitch 3 is joined to Pitch 4 by the
    // geometry's own {3, 4} overlap pair. Under the club's own adjacency rule
    // those games could not run while Pitch 4 was occupied. The expected set
    // is derived here independently: every Alder game whose ground conflicts
    // with Pitch 4 and whose time meets a flag-football window.
    const flagRows = practice.fieldConstraints.filter((row) => row.fields === '4');
    const expected = games.filter(
      (game) =>
        game.venue === ALDER &&
        surfacesConflict(graph, sid(ALDER, 'Pitch 4'), sid(game.venue, game.field)).conflict &&
        flagRows.some(
          (row) =>
            row.dateStart === game.date &&
            game.kickoffMinutes < row.endMinutes &&
            row.startMinutes < game.endMinutes
        )
    );
    const blocked = replay.findings.filter(
      (f) => f.code === AVAILABILITY_REASON.CLOSURE_BLOCKS_BOOKING
    );
    expect(blocked.map((f) => f.details.bookingId).sort()).toEqual(
      expected.map((game) => game.id).sort()
    );
    expect(blocked.length).toBe(10);
    for (const finding of blocked) {
      expect(finding.details.surfaceName).toBe('Pitch 3');
      expect(finding.details.coverage).toBe(FACILITY_REASON.OCCUPIED_SPATIAL_OVERLAP);
      expect(finding.details.reason).toBe('Adaptive Sports Org Flag Football');
    }
    expect(new Set(blocked.map((f) => f.details.date))).toEqual(
      new Set(flagRows.map((row) => row.dateStart))
    );
    expect(byCode[AVAILABILITY_REASON.CLOSURE_ADJACENCY_DEFERRED]).toBe(
      games.filter((game) => game.venue === ALDER).length
    );
    expect(byCode[AVAILABILITY_REASON.CLOSURE_ADJACENCY_DEFERRED]).toBeGreaterThan(100);
    expect(replay.findings.filter((f) => f.code === FACILITY_REASON.SURFACE_UNKNOWN)).toEqual([]);
  });

  it('catches an injected breach in the same replay (positive control)', () => {
    const flag = practice.fieldConstraints.find((row) => row.fields === '4');
    const injected = [
      ...bookings,
      booking('injected', sid(ALDER, 'Pitch 4A'), flag.dateStart, 11 * 60, 12 * 60 + 30),
    ];
    const replay = findClosureBreaches(graph, closures, injected);
    const blocked = replay.findings.filter(
      (f) => f.code === AVAILABILITY_REASON.CLOSURE_BLOCKS_BOOKING
    );
    const baseline = findClosureBreaches(graph, closures, bookings).findings.filter(
      (f) => f.code === AVAILABILITY_REASON.CLOSURE_BLOCKS_BOOKING
    );
    expect(blocked).toHaveLength(baseline.length + 1);
    const mine = blocked.filter((f) => f.details.bookingId === 'injected');
    expect(mine).toHaveLength(1);
    expect(mine[0].details.reason).toBe(flag.reason);
    expect(mine[0].details.coverage).toBe(FACILITY_REASON.OCCUPIED_PARENT_CHILD);
  });
});

/* -------------------------------------------------------------------------- */
/* The builder refuses malformed input                                        */
/* -------------------------------------------------------------------------- */

describe('closures :: the builder refuses what it must', () => {
  const window = (overrides = {}) => ({
    id: 'w',
    fromDate: '2026-09-01',
    toDate: '2026-09-30',
    startMinutes: 0,
    endMinutes: 23 * 60,
    allDay: true,
    scope: { kind: CLOSURE_SCOPE.VENUE, venueIds: [season2026VenueId(ALDER)] },
    reason: 'test',
    ...overrides,
  });

  it('rejects a window whose allDay disagrees with its times, or that ends before it starts', () => {
    expect(ClosureWindowSchema.safeParse(window({ allDay: false })).success).toBe(false);
    expect(
      ClosureWindowSchema.safeParse(window({ endMinutes: 22 * 60, allDay: true })).success
    ).toBe(false);
    expect(
      ClosureWindowSchema.safeParse(window({ endMinutes: 22 * 60, allDay: false })).success
    ).toBe(true);
    expect(ClosureWindowSchema.safeParse(window({ toDate: '2026-08-31' })).success).toBe(false);
    expect(ClosureWindowSchema.safeParse(window({ extra: 1 })).success).toBe(false);
    expect(
      ClosureWindowSchema.safeParse(window({ scope: { kind: 'venue', venueIds: [] } })).success
    ).toBe(false);
    expect(
      ClosureSetInputSchema.safeParse(
        toSeason2026ClosureInput(practice.fieldConstraints, graph, complexes)
      ).success
    ).toBe(true);
  });

  it('throws on an unknown venue or surface id, and on a duplicate id', () => {
    expect(() =>
      buildClosureSet(graph, {
        closures: [window({ scope: { kind: 'venue', venueIds: ['nowhere'] } })],
      })
    ).toThrow(/unknown venue "nowhere"/);
    expect(() =>
      buildClosureSet(graph, {
        closures: [window({ scope: { kind: 'surface', surfaceIds: ['nowhere/x'] } })],
      })
    ).toThrow(/unknown surface "nowhere\/x"/);
    expect(() => buildClosureSet(graph, { closures: [window(), window()] })).toThrow(
      /duplicate closure id/
    );
  });

  it('does not mutate its input and returns a frozen set', () => {
    const input = toSeason2026ClosureInput(practice.fieldConstraints, graph, complexes);
    const before = JSON.stringify(input);
    const built = buildClosureSet(graph, input);
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.isFrozen(built)).toBe(true);
    expect(Object.isFrozen(built.closures[0].scope)).toBe(true);
  });
});
