/**
 * Placeholders, reservations and capacity — Prompt 5.1.
 *
 * > *"Add first-class support for scheduled things that aren't fully known yet.
 * > Three distinct kinds appeared in the source project and all were handled
 * > with ad-hoc string hacks."*
 *
 * Three acceptance tests, and every figure in them is computed at test time from
 * `fixtures/season-2026/`:
 *
 * 1. **Assigning teams to an unnamed slot leaves its time and field unchanged.**
 *    Asserted on the *rendered footprint string*, byte for byte, before and
 *    after — not on "still legal" — with a positive control proving the check
 *    can fail.
 * 2. **An unplaced fixture appears in totals and exports with its reason.** Run
 *    twice, once from a `placement/` harness run and once from a real
 *    `resolve/applyChangeRequest()` that strands a game on the corpus's own
 *    permit blackout, with a positive control proving the accounting catches a
 *    dropped fixture.
 * 3. **The capacity report reproduces the ReserveCapacity figures**: 14-18 slots
 *    per week against a 10-game cap, conditional slots counted separately from
 *    unconditional ones, and sunset identified as what trims the two November
 *    dates to the bare minimum.
 *
 * Where a scenario had to be built rather than found, the test says so in the
 * word "constructed" and says what the corpus supplied.
 */

import { describe, it, expect } from 'vitest';

import { buildAvailabilityCalendarFromSeason2026 } from '@squadlogic/core/availability/index.js';
import {
  SEASON_2026_CONSTRAINT_ID,
  buildSeason2026ConstraintRegistry,
} from '@squadlogic/core/constraints/index.js';
import {
  FACILITY_REASON,
  buildFacilityGraphFromSeason2026,
  buildSeason2026VenueComplexMap,
  findFacilityConflicts,
  season2026SurfaceId,
  surfacesConflict,
} from '@squadlogic/core/facility/index.js';
import {
  loadExternalFixtures,
  loadFacilityGeometry,
  loadFacilityPermits,
  loadGameFormats,
  loadSeason2026,
  loadSunsets,
} from '@squadlogic/core/fixtures/index.js';
import {
  replaceGamesUnderRegistry,
  toSeason2026PlacementInput,
} from '@squadlogic/core/placement/index.js';
import {
  applyChangeRequest,
  reoptimiseWholeSeason,
  season2026ExternalFixtureChanges,
} from '@squadlogic/core/resolve/index.js';
import { toSeason2026Schedule } from '@squadlogic/core/ruleEngine/index.js';
import { buildFormatTimingTableFromSeason2026 } from '@squadlogic/core/timing/index.js';

import { SCHEDULE_EXPORT_HEADERS } from '@squadlogic/core/outputGeneration.js';

import {
  CONDITION_VERDICT,
  FIXTURE_SIDE,
  PUBLICATION_TBD,
  RESERVE_KIND,
  RESERVE_REASON,
  RESERVE_REASON_SEVERITY,
  RESERVE_SEVERITY,
  RESERVE_STATUS,
  SEASON_2026_EARLIEST_KICKOFF_MINUTES,
  SEASON_2026_LEAGUE_CAP_PER_DATE,
  SEASON_2026_RESERVE_FORMAT,
  SLOT_FOOTPRINT_FIELDS,
  accountForFixtures,
  applySlotBindings,
  buildReserveCapacityReport,
  checkSlotsUnmoved,
  conditionForSurface,
  createReserveMeta,
  describeSlotCondition,
  deriveReserveStatus,
  evaluateSlotCondition,
  makeReserveFinding,
  makeReservedSlot,
  makeUnplacedFixture,
  mergeReserveMeta,
  publicationRowsFor,
  reserveSeverityOf,
  reservedSlotFootprint,
  season2026CapacityRequirement,
  season2026FixtureSides,
  season2026ReserveBookings,
  season2026ReserveCapacityInput,
  season2026ReservedSlots,
  season2026SelectTeamIds,
  slotIsSettled,
  slotsToBookings,
  summariseSlots,
  unplacedFromPlacementRun,
  unplacedFromResolveRun,
} from '@squadlogic/core/reserve/index.js';

/* -------------------------------------------------------------------------- */
/* Corpus and engines, loaded once                                             */
/* -------------------------------------------------------------------------- */

const season = loadSeason2026();
const graph = buildFacilityGraphFromSeason2026(loadFacilityGeometry());
const table = buildFormatTimingTableFromSeason2026(loadGameFormats());
const sunsets = loadSunsets();
/** Derived from the corpus rather than typed in, so a re-dated fixture moves it. */
const SEASON_YEAR = Number(sunsets[0].date.slice(0, 4));
const calendar = buildAvailabilityCalendarFromSeason2026(
  loadFacilityPermits({ seasonYear: SEASON_YEAR }),
  sunsets
);
const registry = buildSeason2026ConstraintRegistry();
const resources = {
  graph,
  timingTable: table,
  calendar,
  venueComplexes: buildSeason2026VenueComplexMap(),
};
const engines = { graph, table, calendar, registry, resources };

const schedule = toSeason2026Schedule(season);
const teamUniverse = season.teams.map((team) => String(team.id));

const slots = season2026ReservedSlots(season.combinedGames, { graph, teamUniverse });
const capacityInput = season2026ReserveCapacityInput(season, { graph, table });
const report = buildReserveCapacityReport({ graph, table, calendar, registry }, capacityInput);

const selectTeamIds = season2026SelectTeamIds(season.teams);
const unnamed = slots.filter((slot) => slot.kind === RESERVE_KIND.UNNAMED_FIXTURE);
const reservations = slots.filter((slot) => slot.kind === RESERVE_KIND.RESERVATION);

/** Every date the corpus reserved league slots on, from the rows themselves. */
const reservedDates = [...new Set(unnamed.map((slot) => slot.date))].sort();

/**
 * Every reason code this suite actually saw emitted.
 *
 * The last test in the file asserts it covers `RESERVE_REASON` completely. A
 * code the module can declare but never produce is a code nothing proves the
 * meaning of, and the registry's `declared-only` distinction exists because that
 * gap is where hollow guarantees live.
 *
 * @type {Set<string>}
 */
const OBSERVED = new Set();

/**
 * @template {{ code: string }} T
 * @param {ReadonlyArray<T>} findings
 * @returns {ReadonlyArray<T>}
 */
function observe(findings) {
  for (const finding of findings) OBSERVED.add(finding.code);
  return findings;
}

/* -------------------------------------------------------------------------- */
/* The corpus supplies all three kinds                                         */
/* -------------------------------------------------------------------------- */

describe('reserve :: what the corpus actually contains', () => {
  it('finds the 100 unnamed league fixtures and the single field reservation', () => {
    const summary = summariseSlots(slots);
    expect(summary.total).toBe(101);
    expect(summary.byKind[RESERVE_KIND.UNNAMED_FIXTURE]).toBe(100);
    expect(summary.byKind[RESERVE_KIND.RESERVATION]).toBe(1);

    // Ten dates, ten slots each: the shape the external cap produces.
    expect(reservedDates).toHaveLength(10);
    for (const date of reservedDates) {
      expect(summary.byDate[date]).toBeGreaterThanOrEqual(SEASON_2026_LEAGUE_CAP_PER_DATE);
    }

    // Not one of them names a team yet. `assigned` in the capacity report is
    // therefore zero everywhere, which is what makes acceptance test 1 mean
    // something.
    expect(summary.settled).toBe(0);
    expect(summary.awaitingTeams).toBe(101);

    // The one reservation is not a game: it is held ground with a purpose.
    expect(reservations).toHaveLength(1);
    expect(reservations[0].purpose).toBe('Scrimmage');
    expect(reservations[0].label).toMatch(/TBD/);
    // And GAP-14 survives it: `Scrimmage` has no `game_formats.csv` row, so its
    // footprint is genuinely unknown rather than invented.
    expect(reservations[0].endMinutes).toBeNull();
  });

  it('tells apart the four things the corpus spells with one dash', () => {
    // The `Away` column carries `-` for a Minis session, a reserved league slot
    // and the field reservation alike, and a real visiting club everywhere else.
    // The loader's row kind is what disambiguates it; nothing here parses `-`.
    const byKind = new Map();
    for (const row of season.combinedGames) {
      const sides = season2026FixtureSides(row, { teamUniverse });
      const key = `${row.kind}|${sides.homeSide}|${sides.awaySide}`;
      byKind.set(key, (byKind.get(key) ?? 0) + 1);
    }

    const total = [...byKind.values()].reduce((sum, n) => sum + n, 0);
    // Meta-assertion: the classification is total. Every one of the corpus's
    // rows got a pair of side kinds, so a row kind added later cannot slip
    // through unclassified.
    expect(total).toBe(season.combinedGames.length);
    expect(total).toBe(679);

    const countOf = (predicate) =>
      [...byKind.entries()]
        .filter(([key]) => predicate(key.split('|')))
        .reduce((sum, [, n]) => sum + n, 0);

    // GAP-15: a Minis session's opponent does not exist, and the session itself
    // is not a rostered team.
    expect(countOf(([kind]) => kind === 'minis_session')).toBe(36);
    expect(
      countOf(
        ([kind, home, away]) =>
          kind === 'minis_session' && home === FIXTURE_SIDE.SESSION && away === FIXTURE_SIDE.NONE
      )
    ).toBe(36);

    // GAP-16 / GAP-17: a reserved slot's opponent is not yet known.
    expect(
      countOf(
        ([kind, home, away]) =>
          kind === 'league_placeholder' && home === FIXTURE_SIDE.TBD && away === FIXTURE_SIDE.TBD
      )
    ).toBe(100);
    expect(
      countOf(
        ([kind, home, away]) =>
          kind === 'reservation' && home === FIXTURE_SIDE.TBD && away === FIXTURE_SIDE.TBD
      )
    ).toBe(1);

    // GAP-18: a visiting club is a named opponent with no identity in this
    // system — five of the eight seeding fixtures.
    expect(
      countOf(([kind, , away]) => kind === 'external_fixture' && away === FIXTURE_SIDE.EXTERNAL)
    ).toBe(5);
    expect(
      countOf(([kind, , away]) => kind === 'external_fixture' && away === FIXTURE_SIDE.TEAM)
    ).toBe(3);

    // The distinction is real and not cosmetic: `none` and `tbd` are both
    // spelled `-` in the source file and land in different buckets here.
    const dashRows = season.combinedGames.filter((row) => row.awayLabel === '-');
    expect(dashRows.length).toBe(36 + 100 + 1);
    const dashSides = new Set(
      dashRows.map((row) => season2026FixtureSides(row, { teamUniverse }).awaySide)
    );
    expect([...dashSides].sort()).toEqual([FIXTURE_SIDE.NONE, FIXTURE_SIDE.TBD]);
  });

  it('carries a reserved slot as a booking, so held ground still blocks a field', () => {
    // GAP-17's point: the reservation is not a game and it still occupies Alder
    // Park Pitch 2, which overlaps Pitch 1.
    const pitch2 = season2026SurfaceId('Alder Park', 'Pitch 2');
    expect(reservations[0].surfaceId).toBe(pitch2);
    expect(
      surfacesConflict(graph, pitch2, season2026SurfaceId('Alder Park', 'Pitch 1A')).code
    ).toBe(FACILITY_REASON.OCCUPIED_SPATIAL_OVERLAP);
  });
});

/* -------------------------------------------------------------------------- */
/* Acceptance 1 — binding teams never moves a slot                             */
/* -------------------------------------------------------------------------- */

describe('acceptance 1 :: assigning teams to an unnamed slot leaves its time and field unchanged', () => {
  /**
   * Bindings for every one of the 100 unnamed fixtures, built by dealing the
   * Select teams round-robin across each date's slots. Constructed — the corpus
   * records the season *before* the league published its picks, which is the
   * whole reason these rows exist — but the slots, the dates and the team codes
   * are all the corpus's own.
   */
  const bindings = [];
  for (const date of reservedDates) {
    const onDate = unnamed
      .filter((slot) => slot.date === date)
      .sort((a, b) => a.id.localeCompare(b.id));
    onDate.forEach((slot, index) => {
      bindings.push({
        slotId: slot.id,
        homeTeamId: selectTeamIds[(index * 2) % selectTeamIds.length],
        awayTeamId: selectTeamIds[(index * 2 + 1) % selectTeamIds.length],
      });
    });
  }

  const result = applySlotBindings(unnamed, bindings, { teamUniverse });

  it('binds all 100 slots and refuses none', () => {
    expect(bindings).toHaveLength(100);
    expect(result.meta.bindingsApplied).toBe(100);
    expect(result.meta.bindingsRefused).toBe(0);
    expect(result.boundSlotIds).toHaveLength(100);
    expect(result.slots.every((slot) => slotIsSettled(slot))).toBe(true);
    expect(result.status).not.toBe(RESERVE_STATUS.REJECTED);
  });

  it('leaves every footprint byte-identical, not merely still legal', () => {
    const before = new Map(unnamed.map((slot) => [slot.id, reservedSlotFootprint(slot)]));
    const after = new Map(result.slots.map((slot) => [slot.id, reservedSlotFootprint(slot)]));

    // Byte-for-byte on the rendered footprint. "Still legal somewhere else" is
    // exactly the outcome this assertion has to exclude: the club published this
    // field and this kickoff before knowing who would play in it.
    expect(after.size).toBe(before.size);
    expect(after.size).toBe(100);
    for (const [slotId, footprint] of before) {
      expect(after.get(slotId)).toBe(footprint);
    }

    // …and the module said so itself, on the production path.
    const unmoved = observe(result.findings).filter(
      (finding) => finding.code === RESERVE_REASON.RESERVED_SLOT_UNMOVED
    );
    expect(unmoved).toHaveLength(1);
    expect(unmoved[0].details.pairsCompared).toBe(100);
    expect(unmoved[0].details.moved).toBe(0);
    expect(result.meta.slotsMoved).toBe(0);
    expect(result.meta.slotPairsCompared).toBe(100);
    expect(
      result.findings.some((finding) => finding.code === RESERVE_REASON.RESERVED_SLOT_MOVED)
    ).toBe(false);
  });

  it('changes exactly the occupant fields and nothing else', () => {
    const byId = new Map(result.slots.map((slot) => [slot.id, slot]));
    const changed = new Set();
    for (const slot of unnamed) {
      const bound = /** @type {Object} */ (byId.get(slot.id));
      for (const key of Object.keys(slot)) {
        if (JSON.stringify(slot[key]) !== JSON.stringify(bound[key])) changed.add(key);
      }
    }
    // `awayLabel` was already null — the corpus's away cell is the `-` token,
    // which is not display text — so naming the away team leaves it null. The
    // home label was `Select Game 7` and is cleared, because a named side
    // carries an identity rather than display text; the published name of the
    // slot lives on `label`, which this assertion shows did not change either.
    expect([...changed].sort()).toEqual([
      'awaySide',
      'awayTeamId',
      'homeLabel',
      'homeSide',
      'homeTeamId',
    ]);
    // None of the footprint fields is in that list, which is the same claim
    // stated against the exported contract rather than against a literal.
    for (const field of SLOT_FOOTPRINT_FIELDS) expect(changed.has(field)).toBe(false);
  });

  it('detects a slot that DID move — the positive control', () => {
    // The check above is only worth reading if it can fail. Construct the
    // failure: one slot nudged 30 minutes later, one moved to another field, one
    // dropped outright.
    const nudged = result.slots.map((slot, index) => {
      if (index === 0) return makeReservedSlot({ ...slot, startMinutes: slot.startMinutes + 30 });
      if (index === 1) {
        return makeReservedSlot({ ...slot, surfaceId: season2026SurfaceId('Riverbend', 'Turf') });
      }
      return slot;
    });
    const control = checkSlotsUnmoved(unnamed, nudged.slice(2));

    const moved = observe(control.findings).filter(
      (finding) => finding.code === RESERVE_REASON.RESERVED_SLOT_MOVED
    );
    const dropped = control.findings.filter(
      (finding) => finding.code === RESERVE_REASON.RESERVED_SLOT_DROPPED
    );
    expect(moved).toHaveLength(0); // the two moved slots were the two removed
    expect(dropped).toHaveLength(2);
    expect(control.status).toBe(RESERVE_STATUS.REJECTED);

    // …and again with the moved slots left in place, so the movement itself is
    // what fires rather than their absence.
    const inPlace = checkSlotsUnmoved(unnamed, nudged);
    const movedInPlace = observe(inPlace.findings).filter(
      (finding) => finding.code === RESERVE_REASON.RESERVED_SLOT_MOVED
    );
    expect(movedInPlace).toHaveLength(2);
    expect(movedInPlace[0].details.changedFields).toContain('startMinutes');
    expect(movedInPlace[1].details.changedFields).toContain('surfaceId');
    expect(inPlace.meta.slotsMoved).toBe(2);
    expect(inPlace.status).toBe(RESERVE_STATUS.REJECTED);
  });

  it('refuses a comparison that examined nothing', () => {
    const vacuous = checkSlotsUnmoved([], []);
    expect(vacuous.meta.slotPairsCompared).toBe(0);
    expect(observe(vacuous.findings).map((finding) => finding.code)).toContain(
      RESERVE_REASON.RESERVED_SLOT_COMPARISON_VACUOUS
    );
    expect(vacuous.status).toBe(RESERVE_STATUS.REJECTED);
  });

  it('refuses a team that is not on the roster, a side that cannot be filled, and a double booking', () => {
    const slot = unnamed[0];
    const sameDate = unnamed.filter((entry) => entry.date === slot.date);
    const phantom = applySlotBindings(unnamed, [{ slotId: slot.id, homeTeamId: slot.label }], {
      teamUniverse,
    });
    // Incident 4's second half: `Select Game 7` is a placeholder label, never a
    // team code, and the label is the slot's own.
    expect(observe(phantom.findings).map((finding) => finding.code)).toContain(
      RESERVE_REASON.RESERVED_SLOT_TEAM_UNKNOWN
    );
    expect(phantom.meta.bindingsApplied).toBe(0);

    // A Minis session's absent opponent is not a side that is waiting to be
    // filled — GAP-15's distinction, enforced.
    const minisRow = /** @type {Object} */ (
      season.combinedGames.find((row) => row.kind === 'minis_session')
    );
    const minisSides = season2026FixtureSides(minisRow, { teamUniverse });
    const minisSlot = makeReservedSlot({
      id: String(minisRow.id),
      kind: RESERVE_KIND.UNNAMED_FIXTURE,
      label: String(minisRow.homeLabel),
      date: String(minisRow.date),
      venueId: 'orchard-park',
      surfaceId: season2026SurfaceId(minisRow.venue, minisRow.field),
      startMinutes: Number(minisRow.kickoffMinutes),
      endMinutes: Number(minisRow.endMinutes),
      format: String(minisRow.format),
      homeSide: minisSides.homeSide,
      awaySide: minisSides.awaySide,
      homeLabel: String(minisRow.homeLabel),
    });
    const notBindable = applySlotBindings(
      [minisSlot],
      [{ slotId: minisSlot.id, awayTeamId: selectTeamIds[0] }],
      { teamUniverse }
    );
    expect(observe(notBindable.findings).map((finding) => finding.code)).toContain(
      RESERVE_REASON.RESERVED_SLOT_SIDE_NOT_BINDABLE
    );

    // One team in two overlapping slots on the same date.
    const overlapping = sameDate
      .filter((entry) => entry.startMinutes === sameDate[0].startMinutes)
      .slice(0, 2);
    expect(overlapping.length).toBe(2);
    const clash = applySlotBindings(
      unnamed,
      overlapping.map((entry) => ({ slotId: entry.id, homeTeamId: selectTeamIds[0] })),
      { teamUniverse }
    );
    expect(observe(clash.findings).map((finding) => finding.code)).toContain(
      RESERVE_REASON.RESERVED_SLOT_TEAM_DOUBLE_BOOKED
    );
    // …and even the refusing run left every footprint where it was.
    expect(clash.meta.slotsMoved).toBe(0);
  });

  it('publishes a bound slot and an unbound one, and both keep their field and time', () => {
    const one = unnamed[0];
    const bound = /** @type {Object} */ (result.slots.find((entry) => entry.id === one.id));
    const projection = publicationRowsFor({ slots: [one, bound] });
    expect(projection.rows).toHaveLength(3); // unbound: 1 row; bound: home + away
    const unboundRow = projection.rows[0].row;
    expect(unboundRow[SCHEDULE_EXPORT_HEADERS.OPPONENT]).toBe(PUBLICATION_TBD.OPPONENT);
    expect(unboundRow[SCHEDULE_EXPORT_HEADERS.TEAM_NAME]).toBe(one.label);
    for (const entry of projection.rows) {
      expect(entry.row[SCHEDULE_EXPORT_HEADERS.FIELD]).toBe(one.surfaceId);
      expect(entry.row[SCHEDULE_EXPORT_HEADERS.START]).toBe(
        unboundRow[SCHEDULE_EXPORT_HEADERS.START]
      );
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Acceptance 2 — an unplaced fixture is visible, counted and exported         */
/* -------------------------------------------------------------------------- */

describe('acceptance 2 :: an unplaced fixture appears in totals and exports with its reason', () => {
  /**
   * Incident 10's scenario, through the Prompt 2.1 harness: offer the 9v9 games
   * of 08/22 only the one kickoff the Select layer already occupies. Constructed
   * — the corpus is a season in which everything *was* placed — from the
   * corpus's own date, games, surfaces and bookings.
   */
  const input = toSeason2026PlacementInput(graph, season.combinedGames, { date: '2026-08-22' });
  const run = replaceGamesUnderRegistry(engines, {
    ...input,
    candidateKickoffMinutes: [input.fixedBookings[0].startMinutes],
  });
  const unplaced = unplacedFromPlacementRun(run, { source: 'placement harness' });

  /**
   * The fixtures that must exist, enumerated from `combined_schedule.csv` rather
   * than from the run. A fixture the run dropped is precisely what is missing
   * from the run's own output, so a check that took its subjects from there
   * would report a clean season.
   */
  const expectedFixtureIds = season.combinedGames
    .filter((row) => row.date === '2026-08-22' && row.format === '9v9')
    .map((row) => String(row.id))
    .sort();

  it('keeps every fixture visible: none is placed, all are reported', () => {
    expect(expectedFixtureIds.length).toBeGreaterThan(0);
    expect(run.placements).toHaveLength(0);
    expect(unplaced).toHaveLength(expectedFixtureIds.length);
    for (const fixture of unplaced) {
      expect(fixture.timeStatus).toBe(PUBLICATION_TBD.TIME);
      expect(fixture.locationStatus).toBe(PUBLICATION_TBD.LOCATION);
      expect(fixture.reason).toMatch(/no candidate slot/);
      expect(fixture.publishedKickoffMinutes).toBeGreaterThan(0);
    }
  });

  it('counts them in the totals', () => {
    const accounting = accountForFixtures({
      expectedFixtureIds,
      placedFixtureIds: run.placements.map((placement) => placement.gameId),
      unplaced,
      expectedSource: 'combined_schedule.csv 9v9 rows on 2026-08-22',
    });
    expect(accounting.totals.expected).toBe(expectedFixtureIds.length);
    expect(accounting.totals.placed).toBe(0);
    expect(accounting.totals.unplaced).toBe(expectedFixtureIds.length);
    expect(accounting.totals.accounted).toBe(accounting.totals.expected);
    expect(accounting.totals.missing).toBe(0);
    expect(accounting.missingFixtureIds).toEqual([]);
    expect(accounting.meta.fixturesAccountedFor).toBe(expectedFixtureIds.length);
    // Visible, and visibly compromised: a season carrying TIME TBD rows is not
    // an `allowed` season.
    observe(accounting.findings);
    expect(accounting.status).toBe(RESERVE_STATUS.COMPROMISED);
  });

  it('catches a fixture that was silently dropped — the positive control', () => {
    const [victim, ...survivors] = unplaced;
    const dropped = accountForFixtures({
      expectedFixtureIds,
      placedFixtureIds: [],
      unplaced: survivors,
      expectedSource: 'combined_schedule.csv 9v9 rows on 2026-08-22',
    });
    expect(dropped.totals.missing).toBe(1);
    expect(dropped.missingFixtureIds).toEqual([victim.fixtureId]);
    expect(dropped.status).toBe(RESERVE_STATUS.REJECTED);
    expect(observe(dropped.findings).map((finding) => finding.code)).toContain(
      RESERVE_REASON.FIXTURE_DROPPED
    );
  });

  it('refuses an accounting that reconciled nothing', () => {
    const vacuous = accountForFixtures({
      expectedFixtureIds: [],
      placedFixtureIds: [],
      unplaced: [],
    });
    expect(vacuous.meta.fixturesAccountedFor).toBe(0);
    expect(observe(vacuous.findings).map((finding) => finding.code)).toContain(
      RESERVE_REASON.FIXTURE_ACCOUNTING_VACUOUS
    );
    expect(vacuous.status).toBe(RESERVE_STATUS.REJECTED);
  });

  it('exports every one of them with TIME TBD, LOCATION TBD and the reason', () => {
    const projection = publicationRowsFor({ slots: [], unplaced });
    expect(projection.rows).toHaveLength(unplaced.length);
    expect(projection.meta.rowsEmitted).toBe(unplaced.length);
    for (const entry of projection.rows) {
      expect(entry.row[SCHEDULE_EXPORT_HEADERS.START]).toBe(PUBLICATION_TBD.TIME);
      expect(entry.row[SCHEDULE_EXPORT_HEADERS.END]).toBe(PUBLICATION_TBD.TIME);
      expect(entry.row[SCHEDULE_EXPORT_HEADERS.FIELD]).toBe(PUBLICATION_TBD.LOCATION);
      expect(entry.row[SCHEDULE_EXPORT_HEADERS.NOTES]).toMatch(/no candidate slot/);
    }
    // Every column the master export declares is present, so these rows drop
    // into that vocabulary without a translation step.
    for (const column of projection.columns) {
      expect(Object.hasOwn(projection.rows[0].row, column)).toBe(true);
    }
    expect(projection.status).toBe(RESERVE_STATUS.ALLOWED);
  });

  it('reads the same state back from a real re-solve, not only from the harness', () => {
    // The corpus supplies the scenario here: Summit HS has **no permit at all**
    // on 09/19, and `resolve/` already carries a thawed game with nowhere to go
    // as TIME TBD with a reason. This module reads that; it does not re-derive
    // it.
    const blackoutDate = /** @type {string} */ (
      [...new Set(schedule.games.map((game) => game.date))]
        .sort()
        .find((date) =>
          calendar.permitsByVenue['summit-hs']?.some(
            (permit) => permit.date === date && permit.hasPermit === false
          )
        )
    );
    expect(blackoutDate).toBeTruthy();
    const stranded = /** @type {Object} */ (
      schedule.games.find((game) => game.format === '9v9' && game.date !== blackoutDate)
    );
    const resolveRun = applyChangeRequest({
      schedule,
      changes: [
        {
          gameId: stranded.id,
          date: blackoutDate,
          surfaceId: season2026SurfaceId('Summit HS', 'Stadium'),
          startMinutes: stranded.startMinutes,
        },
      ],
      engines,
      verify: false,
      onUnsatisfiable: 'report',
    });
    expect(resolveRun.unplaced.length).toBeGreaterThan(0);

    const fromResolve = unplacedFromResolveRun(resolveRun);
    expect(fromResolve).toHaveLength(resolveRun.unplaced.length);
    for (const fixture of fromResolve) {
      expect(fixture.reason).toMatch(/TIME TBD/);
      expect(fixture.timeStatus).toBe(PUBLICATION_TBD.TIME);
      // Kept with its identity, not just its id: the label and the published
      // position come from the baseline the run still holds.
      expect(fixture.label).not.toBe(fixture.fixtureId);
      expect(fixture.publishedSurfaceId).toBeTruthy();
      expect(fixture.publishedKickoffMinutes).not.toBeNull();
    }

    // The whole season's fixtures, reconciled: nothing left the schedule.
    const accounting = accountForFixtures({
      expectedFixtureIds: schedule.games.map((game) => game.id),
      placedFixtureIds: resolveRun.schedule.games.map((game) => game.id),
      unplaced: fromResolve,
      expectedSource: 'the baseline schedule',
    });
    expect(accounting.totals.expected).toBe(schedule.games.length);
    expect(accounting.totals.missing).toBe(0);
    expect(accounting.totals.accounted).toBe(schedule.games.length);
  });

  it('names which machinery decided, and does not invent a constraint that decided nothing', () => {
    // The corpus supplies this one too. A global re-optimisation of the season
    // around the eight externally-published fixtures places in one pass with no
    // backtracking, and four 9v9 games find no slot left on 08/22 — kept as
    // TIME TBD rather than dropped (incident 10).
    //
    // What they are *not* is constraint-caused. `resolve/stages.js` gives the
    // TIME TBD move no cause on purpose, and the dislodge that preceded it was
    // the global re-optimisation itself, so the honest answer to "what forced
    // this?" is `global-reoptimisation` and no reason code at all. That answer
    // is a **field** here rather than an empty list a reader has to interpret:
    // "no constraint forced this" and "nobody recorded what forced this" must
    // not look the same.
    const reoptimised = reoptimiseWholeSeason({
      schedule,
      changes: season2026ExternalFixtureChanges(loadExternalFixtures(), schedule),
      engines,
      reason: 'exercising the consequential TIME TBD path against the corpus',
      acknowledged: true,
      verify: false,
    });
    expect(reoptimised.unplaced.length).toBeGreaterThan(0);

    const fixtures = unplacedFromResolveRun(reoptimised);
    expect(fixtures).toHaveLength(reoptimised.unplaced.length);
    for (const fixture of fixtures) {
      expect(fixture.causeKind).toBe('global-reoptimisation');
      expect(fixture.reasonCodes).toEqual([]);
      expect(fixture.constraintIds).toEqual([]);
      expect(fixture.reason).toMatch(/incident 10/);
      // The identity survives: these came out of the baseline the run holds.
      expect(fixture.date).toBeTruthy();
      expect(fixture.label).not.toBe(fixture.fixtureId);
      expect(fixture.publishedSurfaceId).toBeTruthy();
    }

    // Nothing left the season: every baseline game is either placed or carried.
    const accounting = accountForFixtures({
      expectedFixtureIds: schedule.games.map((game) => game.id),
      placedFixtureIds: reoptimised.schedule.games.map((game) => game.id),
      unplaced: fixtures,
      expectedSource: 'the baseline schedule',
    });
    expect(accounting.totals.missing).toBe(0);
    expect(accounting.totals.unplaced).toBe(fixtures.length);
    observe(accounting.findings);
    // …and the cause travels into the finding an operator reads, rather than
    // stopping at the record.
    const tbd = accounting.findings.find(
      (finding) => finding.code === RESERVE_REASON.FIXTURE_TIME_TBD
    );
    expect(/** @type {Object} */ (tbd).details.causeKind).toBe('global-reoptimisation');
  });
});

/* -------------------------------------------------------------------------- */
/* Conditional slots are evaluated, not annotated                              */
/* -------------------------------------------------------------------------- */

describe('conditional slots are evaluated against the facility graph, not annotated', () => {
  const pitch2 = season2026SurfaceId('Alder Park', 'Pitch 2');
  const pitch3 = season2026SurfaceId('Alder Park', 'Pitch 3');
  const turf = season2026SurfaceId('Riverbend', 'Turf');
  const stadium = season2026SurfaceId('Summit HS', 'Stadium');

  it('derives the condition from the overlap relation, and only for ground that has one', () => {
    const two = conditionForSurface(graph, pitch2);
    const three = conditionForSurface(graph, pitch3);
    expect(two).not.toBeNull();
    expect(three).not.toBeNull();
    // Pitch 2 depends on Pitch 1 *and its halves*: the lineage clause of the
    // overlap relation, consumed rather than re-derived.
    expect(/** @type {Object} */ (two).surfaceIds.sort()).toEqual(
      [
        season2026SurfaceId('Alder Park', 'Pitch 1'),
        season2026SurfaceId('Alder Park', 'Pitch 1A'),
        season2026SurfaceId('Alder Park', 'Pitch 1B'),
      ].sort()
    );
    expect(/** @type {Object} */ (three).surfaceIds.sort()).toEqual(
      [
        season2026SurfaceId('Alder Park', 'Pitch 4'),
        season2026SurfaceId('Alder Park', 'Pitch 4A'),
        season2026SurfaceId('Alder Park', 'Pitch 4B'),
      ].sort()
    );
    // The only 11v11 ground at its venue carries no condition at all.
    expect(conditionForSurface(graph, turf)).toBeNull();
    expect(conditionForSurface(graph, stadium)).toBeNull();
  });

  it('reports a stored-but-unchecked condition as unenforced', () => {
    const slot = /** @type {Object} */ (unnamed.find((entry) => entry.surfaceId === pitch3));
    const declared = describeSlotCondition(slot);
    expect(declared.verdict).toBe(CONDITION_VERDICT.UNEVALUATED);
    expect(observe(declared.findings).map((finding) => finding.code)).toEqual([
      RESERVE_REASON.SLOT_CONDITION_UNENFORCED,
    ]);
    expect(deriveReserveStatus(declared.findings)).toBe(RESERVE_STATUS.COMPROMISED);
  });

  it('finds the condition satisfied where the corpus leaves the neighbour idle, and blocked where it does not', () => {
    const bookings = season2026ReserveBookings(season.combinedGames, {
      excludeIds: slots.map((slot) => slot.id),
    });

    // Pitch 3's reserved slots are satisfied on every reserved date: the corpus
    // never books Pitch 4 on a Select Saturday.
    const onPitch3 = unnamed.filter((slot) => slot.surfaceId === pitch3);
    expect(onPitch3.length).toBeGreaterThan(0);
    let satisfied = 0;
    for (const slot of onPitch3) {
      const verdict = evaluateSlotCondition(graph, slot, bookings, { reserved: true });
      observe(verdict.findings);
      if (verdict.verdict === CONDITION_VERDICT.SATISFIED) satisfied += 1;
    }
    expect(satisfied).toBe(onPitch3.length);

    // The same condition on Pitch 2 at the same times is a different answer,
    // because the rec layer stands on Pitch 1A/1B — the positive control, and
    // it comes from the corpus rather than from a construction.
    const recDate = '2026-10-17';
    const blocked = onPitch3
      .filter((slot) => slot.date === recDate)
      .map((slot) =>
        evaluateSlotCondition(
          graph,
          makeReservedSlot({
            ...slot,
            id: `${slot.id}#control`,
            surfaceId: pitch2,
            condition: conditionForSurface(graph, pitch2),
          }),
          bookings,
          { reserved: false }
        )
      );
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked.some((verdict) => verdict.verdict === CONDITION_VERDICT.BLOCKED)).toBe(true);
    const blocking = blocked.find((verdict) => verdict.verdict === CONDITION_VERDICT.BLOCKED);
    observe(/** @type {Object} */ (blocking).findings);
    expect(/** @type {Object} */ (blocking).blockingBookingIds.length).toBeGreaterThan(0);
    expect(/** @type {Object} */ (blocking).meta.conditionBookingsCompared).toBeGreaterThan(0);
  });

  it('refuses to decide a condition against a booking of unknown footprint (GAP-14)', () => {
    // The corpus's own reservation has no `game_formats.csv` row, so its own
    // footprint is unknown. Judged against the ground it depends on, the honest
    // answer is "cannot be decided", not "clear".
    const bookings = season2026ReserveBookings(season.combinedGames, {
      excludeIds: [reservations[0].id],
    });
    const verdict = evaluateSlotCondition(graph, reservations[0], bookings, { reserved: true });
    expect(reservations[0].endMinutes).toBeNull();
    expect(verdict.verdict).toBe(CONDITION_VERDICT.UNDECIDABLE);
    expect(observe(verdict.findings).map((finding) => finding.code)).toContain(
      RESERVE_REASON.SLOT_CONDITION_UNDECIDABLE
    );
    expect(verdict.undecidableBookingIds.length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Acceptance 3 — the capacity report                                          */
/* -------------------------------------------------------------------------- */

describe('acceptance 3 :: the reserve capacity report', () => {
  it('is not vacuous, and accounts for every published reservation', () => {
    observe(report.findings);
    expect(report.status).toBe(RESERVE_STATUS.COMPROMISED);
    expect(report.meta.datesExamined).toBe(10);
    expect(report.meta.surfaceDatesExamined).toBe(40);
    expect(report.meta.candidatesTested).toBeGreaterThan(report.meta.slotsGenerated);
    expect(report.meta.slotsGenerated).toBeGreaterThan(0);

    // The model's anchor is proved rather than assumed: all 100 published
    // reservations land on a slot it generates.
    expect(report.meta.reservedSlotsMatched).toBe(100);
    expect(report.meta.reservedSlotsOffGrid).toBe(0);
    expect(
      report.findings.some((finding) => finding.code === RESERVE_REASON.RESERVED_SLOT_OFF_GRID)
    ).toBe(false);
    expect(SEASON_2026_EARLIEST_KICKOFF_MINUTES).toBe(8 * 60);
    // The cadence is the format's block length from `game_formats.csv`, not a
    // number typed into this module.
    expect(report.cadenceMinutes).toBe(table.formats[SEASON_2026_RESERVE_FORMAT].blockMinutes);
    expect(report.cadenceMinutes).toBe(120);
  });

  it('catches a wrong anchor — the positive control for the off-grid check', () => {
    const wrong = buildReserveCapacityReport(
      { graph, table, calendar, registry },
      { ...capacityInput, earliestKickoffMinutes: 9 * 60 }
    );
    observe(wrong.findings);
    expect(wrong.meta.reservedSlotsOffGrid).toBeGreaterThan(0);
    expect(wrong.status).toBe(RESERVE_STATUS.REJECTED);
    expect(
      wrong.findings.some((finding) => finding.code === RESERVE_REASON.RESERVED_SLOT_OFF_GRID)
    ).toBe(true);
  });

  it('reproduces 14-18 slots per week against a 10-game cap', () => {
    expect(report.minSlots).toBe(14);
    expect(report.maxSlots).toBe(18);
    expect(report.dates).toHaveLength(10);

    for (const dateRow of report.dates) {
      // The cap is what limits the *reserved* number, not the facility.
      expect(dateRow.reserved).toBe(SEASON_2026_LEAGUE_CAP_PER_DATE);
      expect(dateRow.atCap).toBe(true);
      expect(dateRow.overCap).toBe(false);
      expect(dateRow.spare).toBe(dateRow.slots - dateRow.reserved);
      expect(dateRow.spare).toBeGreaterThanOrEqual(0);
      // Nothing is assigned: the league had not published its picks.
      expect(dateRow.assigned).toBe(0);
      expect(dateRow.unassigned).toBe(SEASON_2026_LEAGUE_CAP_PER_DATE);
      // The requirement is met on every date, on the slot count.
      expect(dateRow.meetsRequirement).toBe(true);
      expect(dateRow.slots).toBe(dateRow.unconditionalSlots + dateRow.conditionalSlots);
    }

    // The requirement is derived from the roster, not typed in.
    expect(report.requirement.slots).toBe(selectTeamIds.length);
    expect(report.requirement.slots).toBe(14);
    expect(season2026CapacityRequirement(season.teams).slots).toBe(14);
    expect(/** @type {Object} */ (report.cap).limit).toBe(SEASON_2026_LEAGUE_CAP_PER_DATE);
  });

  it('counts conditional slots separately from unconditional ones', () => {
    const pitch2 = season2026SurfaceId('Alder Park', 'Pitch 2');
    const pitch3 = season2026SurfaceId('Alder Park', 'Pitch 3');

    for (const dateRow of report.dates) {
      const conditional = dateRow.bySurface.filter((row) => row.conditional);
      const unconditional = dateRow.bySurface.filter((row) => !row.conditional);
      // Exactly the two Alder pitches are conditional, on every date.
      expect(conditional.map((row) => row.surfaceId).sort()).toEqual([pitch2, pitch3].sort());
      expect(unconditional).toHaveLength(2);
      expect(dateRow.conditionalSlots).toBe(conditional.reduce((sum, row) => sum + row.slots, 0));
      expect(dateRow.unconditionalSlots).toBe(
        unconditional.reduce((sum, row) => sum + row.slots, 0)
      );
      // Every conditional slot got a verdict; none was left unjudged.
      expect(
        dateRow.conditionSatisfied + dateRow.conditionBlocked + dateRow.conditionUndecidable
      ).toBe(dateRow.conditionalSlots);
      expect(dateRow.available).toBe(dateRow.unconditionalSlots + dateRow.conditionSatisfied);
    }

    // The two columns really do differ: on the dates the rec layer occupies
    // Alder Pitch 1, conditional ground is worth less than it looks, and the
    // report says so rather than counting it as free.
    const shortfalls = report.dates.filter((dateRow) => dateRow.available < dateRow.slots);
    expect(shortfalls.length).toBeGreaterThan(0);
    for (const dateRow of shortfalls) {
      expect(dateRow.conditionBlocked).toBeGreaterThan(0);
    }
    // Five dates clear the requirement on the slot count and fail it once the
    // conditions are evaluated. They are exactly the rec Saturdays on which the
    // 9v9 layer stands on Alder Pitch 1 — 10/10 has no rec games at all and is
    // the control that shows the shortfall is caused by the rec layer rather
    // than by the model.
    const failing = report.dates
      .filter((dateRow) => !dateRow.availableMeetsRequirement)
      .map((dateRow) => dateRow.date);
    expect(failing).toEqual(['2026-09-19', '2026-09-26', '2026-10-03', '2026-10-17', '2026-10-31']);
    const noRecGames = /** @type {Object} */ (
      report.dates.find((dateRow) => dateRow.date === '2026-10-10')
    );
    expect(
      season.combinedGames.filter(
        (row) =>
          row.date === '2026-10-10' && row.venue === 'Alder Park' && row.field.startsWith('Pitch 1')
      )
    ).toHaveLength(0);
    expect(noRecGames.conditionBlocked).toBe(0);
    expect(noRecGames.available).toBe(noRecGames.slots);
    expect(
      report.findings.filter(
        (finding) => finding.code === RESERVE_REASON.RESERVE_CAPACITY_CONDITIONAL_SHORTFALL
      )
    ).toHaveLength(failing.length);
  });

  it('identifies sunset as what trims the two November dates to the bare minimum', () => {
    // The bare-minimum dates are found, not named: they are the dates whose slot
    // count equals the requirement exactly.
    expect(report.bareMinimumDates).toEqual(['2026-11-07', '2026-11-14']);
    for (const date of report.bareMinimumDates) {
      const dateRow = /** @type {Object} */ (report.dates.find((row) => row.date === date));
      expect(dateRow.slots).toBe(report.requirement.slots);
      expect(dateRow.spare).toBe(report.requirement.slots - SEASON_2026_LEAGUE_CAP_PER_DATE);

      const sunset = dateRow.cappedBy.find((entry) => entry.kind === 'sunset');
      expect(sunset).toBeTruthy();
      // Three surfaces lost one slot each to daylight; adding them back would
      // put the date at 17 and clear of the requirement, which is precisely
      // what "trims it to the bare minimum" means.
      expect(/** @type {Object} */ (sunset).slotsLostVsBest).toBe(3);
      expect(dateRow.slots + /** @type {Object} */ (sunset).slotsLostVsBest).toBeGreaterThan(
        report.requirement.slots
      );
      // Every surface sunset capped is unlit ground, and each really did offer
      // fewer slots here than on any other date in the report.
      for (const surfaceId of /** @type {Object} */ (sunset).surfaceIds) {
        const surfaceRow = dateRow.bySurface.find((row) => row.surfaceId === surfaceId);
        expect(surfaceRow.slots).toBeLessThan(report.bestSlotsBySurface[surfaceId]);
        // Strictly fewer than on every date that is *not* at the bare minimum.
        // The two November dates are equal to each other, which is the point:
        // they are the pair sunset trims, and nothing else.
        for (const other of report.dates) {
          if (report.bareMinimumDates.includes(other.date)) continue;
          const otherRow = other.bySurface.find((row) => row.surfaceId === surfaceId);
          expect(surfaceRow.slots).toBeLessThan(otherRow.slots);
        }
      }
      // The lit stadium is capped by its permit, not by daylight, and holds the
      // same count it holds on eight other dates.
      const stadium = dateRow.bySurface.find(
        (row) => row.surfaceId === season2026SurfaceId('Summit HS', 'Stadium')
      );
      expect(stadium.cappedByKinds).toEqual(['permit']);
    }

    // The claim is checkable against `sunsets.csv`: these two dates carry the
    // earliest sunsets of the season.
    const bySunset = [...sunsets].sort((a, b) => a.sunsetMinutes - b.sunsetMinutes);
    expect(
      bySunset
        .slice(0, 2)
        .map((entry) => entry.date)
        .sort()
    ).toEqual(report.bareMinimumDates);
    // …and the report says the bare minimum out loud.
    const atRequirement = report.findings.filter(
      (finding) => finding.code === RESERVE_REASON.RESERVE_CAPACITY_AT_REQUIREMENT
    );
    expect(atRequirement).toHaveLength(2);
  });

  it('names the constraint that caps every date, and no date is left unattributed', () => {
    for (const dateRow of report.dates) {
      expect(dateRow.cappedBy.length).toBeGreaterThan(0);
      for (const row of dateRow.bySurface) {
        // Every surface either ran out of legal kickoffs or ran off the end of
        // the searched day; the first is what we assert, because the second
        // would mean nothing bounded it.
        expect(row.firstRejectedKickoffMinutes).not.toBeNull();
        expect(row.cappedByKinds.length).toBeGreaterThan(0);
        expect(row.blockingCodes.length).toBeGreaterThan(0);
        // The slack is Phase 1.3's number, read back rather than recomputed:
        // negative, because the candidate that ended the run broke its bound.
        if (row.slots > 0) expect(row.slackMinutes).toBeLessThan(0);
      }
    }

    // The registry is consulted for the codes, not second-guessed: the sunset
    // margin constraint is the one that claims `SUNSET_MARGIN_VIOLATED`.
    const november = /** @type {Object} */ (report.dates.find((row) => row.date === '2026-11-07'));
    const unlit = november.bySurface.filter((row) => row.cappedByKinds.includes('sunset'));
    expect(unlit.length).toBe(3);
    for (const row of unlit) {
      expect(row.constraintIds).toContain(SEASON_2026_CONSTRAINT_ID.SUNSET_MARGIN);
    }
    const stadium = november.bySurface.find(
      (row) => row.surfaceId === season2026SurfaceId('Summit HS', 'Stadium')
    );
    expect(stadium.constraintIds).toContain(SEASON_2026_CONSTRAINT_ID.PERMIT_WINDOW);
  });

  it('reports the permit blackout as what caps 09/19, and the early open as what lifts 09/12', () => {
    const stadiumId = season2026SurfaceId('Summit HS', 'Stadium');
    const blackout = /** @type {Object} */ (report.dates.find((row) => row.date === '2026-09-19'));
    const stadiumOnBlackout = blackout.bySurface.find((row) => row.surfaceId === stadiumId);
    expect(stadiumOnBlackout.slots).toBe(0);
    expect(stadiumOnBlackout.cappedByKinds).toEqual(['permit']);
    expect(blackout.slots).toBe(15);

    const early = /** @type {Object} */ (report.dates.find((row) => row.date === '2026-09-12'));
    const stadiumOnEarly = early.bySurface.find((row) => row.surfaceId === stadiumId);
    expect(stadiumOnEarly.slots).toBe(3);
    expect(early.slots).toBe(report.maxSlots);
    // The extra slot exists because that one date's permit opens at 14:00
    // instead of 17:00 — a date-scoped exception, read by the availability
    // calendar rather than by this module.
    expect(stadiumOnEarly.kickoffMinutes[0]).toBe(14 * 60);
    expect(stadiumOnBlackout.kickoffMinutes).toEqual([]);
  });

  it('refuses a report that examined nothing', () => {
    expect(() =>
      buildReserveCapacityReport(
        { graph, table, calendar, registry },
        { ...capacityInput, dates: [] }
      )
    ).toThrow();
    // A report over a surface no format fits generates zero slots and says so
    // rather than clearing the requirement on an empty count.
    const empty = buildReserveCapacityReport(
      { graph, table, calendar, registry },
      {
        ...capacityInput,
        surfaceIds: [season2026SurfaceId('Orchard Park', 'Field 1')],
        reservedSlots: [],
      }
    );
    expect(empty.meta.slotsGenerated).toBe(0);
    expect(observe(empty.findings).map((finding) => finding.code)).toContain(
      RESERVE_REASON.RESERVE_CAPACITY_VACUOUS
    );
    expect(empty.status).toBe(RESERVE_STATUS.REJECTED);

    // …and a run that was given nothing to evaluate the conditions against is
    // refused at the door rather than reporting every conditional slot free.
    const { bookings: _bookings, ...withoutBookings } = capacityInput;
    expect(() =>
      buildReserveCapacityReport({ graph, table, calendar, registry }, withoutBookings)
    ).toThrow();
    // An explicit empty list is a different statement and is accepted, with
    // every condition then genuinely satisfied because nothing stands anywhere.
    const nothingBooked = buildReserveCapacityReport(
      { graph, table, calendar, registry },
      { ...capacityInput, bookings: [] }
    );
    expect(nothingBooked.meta.conditionsEvaluated).toBeGreaterThan(0);
    expect(nothingBooked.dates.every((dateRow) => dateRow.available === dateRow.slots)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* The refusals the corpus never triggers, each shown firing                   */
/* -------------------------------------------------------------------------- */

describe('reserve :: the refusals a clean season never triggers', () => {
  // Every code below is one the published corpus does not produce, which is why
  // each gets a constructed case. A refusal nothing ever exercises is a refusal
  // nobody has checked the meaning of.

  it('refuses a binding that names a slot nobody holds, overwrites a named side, or plays a team against itself', () => {
    const slot = unnamed[0];

    const unknown = applySlotBindings(
      unnamed,
      [{ slotId: 'no-such-slot', homeTeamId: selectTeamIds[0] }],
      { teamUniverse }
    );
    expect(observe(unknown.findings).map((finding) => finding.code)).toContain(
      RESERVE_REASON.RESERVED_SLOT_UNKNOWN
    );

    const alreadyNamed = applySlotBindings(
      [
        makeReservedSlot({
          ...slot,
          homeSide: FIXTURE_SIDE.TEAM,
          homeTeamId: selectTeamIds[0],
          homeLabel: null,
        }),
      ],
      [{ slotId: slot.id, homeTeamId: selectTeamIds[1] }],
      { teamUniverse }
    );
    expect(observe(alreadyNamed.findings).map((finding) => finding.code)).toContain(
      RESERVE_REASON.RESERVED_SLOT_SIDE_ALREADY_NAMED
    );

    const selfPlay = applySlotBindings(
      [slot],
      [{ slotId: slot.id, homeTeamId: selectTeamIds[0], awayTeamId: selectTeamIds[0] }],
      { teamUniverse }
    );
    expect(observe(selfPlay.findings).map((finding) => finding.code)).toContain(
      RESERVE_REASON.RESERVED_SLOT_SIDES_IDENTICAL
    );

    // …and a half-filled slot is applied, and says it is half-filled.
    const partial = applySlotBindings([slot], [{ slotId: slot.id, homeTeamId: selectTeamIds[0] }], {
      teamUniverse,
    });
    expect(observe(partial.findings).map((finding) => finding.code)).toContain(
      RESERVE_REASON.RESERVED_SLOT_PARTIALLY_BOUND
    );
    expect(partial.meta.bindingsApplied).toBe(1);
    expect(slotIsSettled(partial.slots[0])).toBe(false);
    // Half-filled or not, it did not move.
    expect(reservedSlotFootprint(partial.slots[0])).toBe(reservedSlotFootprint(slot));

    // A binding must name at least one side; one that names neither would report
    // success having done nothing.
    expect(() => applySlotBindings([slot], [{ slotId: slot.id }], { teamUniverse })).toThrow();
    expect(() => applySlotBindings([slot], [], /** @type {Object} */ ({}))).toThrow(/teamUniverse/);
  });

  it('treats held ground whose condition fails as a blocking problem, not a fact about the day', () => {
    // Constructed: move the corpus's Pitch 3 reservation onto Pitch 2 on a rec
    // Saturday, where the 9v9 layer stands on Pitch 1A/1B. The club would have
    // held ground it cannot use.
    const bookings = season2026ReserveBookings(season.combinedGames, {
      excludeIds: slots.map((entry) => entry.id),
    });
    const pitch2 = season2026SurfaceId('Alder Park', 'Pitch 2');
    const midday = /** @type {Object} */ (
      unnamed.find((entry) => entry.date === '2026-10-17' && entry.startMinutes === 12 * 60)
    );
    const moved = makeReservedSlot({
      ...midday,
      id: `${midday.id}#control`,
      surfaceId: pitch2,
      condition: conditionForSurface(graph, pitch2),
    });
    const verdict = evaluateSlotCondition(graph, moved, bookings, { reserved: true });
    expect(verdict.verdict).toBe(CONDITION_VERDICT.BLOCKED);
    expect(observe(verdict.findings).map((finding) => finding.code)).toContain(
      RESERVE_REASON.RESERVED_SLOT_CONDITION_BLOCKED
    );
    expect(deriveReserveStatus(verdict.findings)).toBe(RESERVE_STATUS.REJECTED);
  });

  it('refuses a reason that is only whitespace, and a fixture counted twice', () => {
    // `UnplacedFixtureSchema` stops the empty string at the constructor; this is
    // the one that gets past it.
    const blank = makeUnplacedFixture({
      fixtureId: 'constructed-1',
      label: 'constructed v control',
      reason: '   ',
    });
    const accounting = accountForFixtures({
      expectedFixtureIds: ['constructed-1'],
      placedFixtureIds: [],
      unplaced: [blank],
    });
    expect(observe(accounting.findings).map((finding) => finding.code)).toContain(
      RESERVE_REASON.FIXTURE_REASON_MISSING
    );
    expect(accounting.status).toBe(RESERVE_STATUS.REJECTED);
    expect(() => makeUnplacedFixture({ fixtureId: 'x', label: 'y', reason: '' })).toThrow();

    const both = accountForFixtures({
      expectedFixtureIds: ['constructed-2'],
      placedFixtureIds: ['constructed-2'],
      unplaced: [
        makeUnplacedFixture({
          fixtureId: 'constructed-2',
          label: 'a v b',
          reason: 'nowhere to go',
        }),
      ],
    });
    expect(observe(both.findings).map((finding) => finding.code)).toContain(
      RESERVE_REASON.FIXTURE_DOUBLE_COUNTED
    );
  });

  it('reports a date over the external cap and a date under the requirement', () => {
    const tighter = buildReserveCapacityReport(
      { graph, table, calendar, registry },
      {
        ...capacityInput,
        cap: { ...capacityInput.cap, limit: SEASON_2026_LEAGUE_CAP_PER_DATE - 1 },
      }
    );
    expect(observe(tighter.findings).map((finding) => finding.code)).toContain(
      RESERVE_REASON.RESERVE_CAP_EXCEEDED
    );
    expect(tighter.dates.every((dateRow) => dateRow.overCap)).toBe(true);

    const demanding = buildReserveCapacityReport(
      { graph, table, calendar, registry },
      {
        ...capacityInput,
        requirement: {
          ...capacityInput.requirement,
          slots: /** @type {number} */ (report.maxSlots) + 1,
        },
      }
    );
    expect(observe(demanding.findings).map((finding) => finding.code)).toContain(
      RESERVE_REASON.RESERVE_CAPACITY_BELOW_REQUIREMENT
    );
    expect(demanding.dates.every((dateRow) => !dateRow.meetsRequirement)).toBe(true);
    expect(demanding.bareMinimumDates).toEqual([]);
  });

  it('hands reserved ground to the facility model as a booking (GAP-17)', () => {
    // A reservation is not a game and it still blocks a field. The proof is that
    // the Phase 1.1 conflict scan — which knows nothing about this module — sees
    // it clash with a concurrent booking on overlapping ground.
    const onPitch3 = /** @type {Object} */ (
      unnamed.find((slot) => slot.surfaceId === season2026SurfaceId('Alder Park', 'Pitch 3'))
    );
    const asBookings = slotsToBookings([onPitch3]);
    expect(asBookings[0].startMinutes).toBe(onPitch3.startMinutes);
    const neighbour = {
      id: 'constructed-neighbour',
      surfaceId: season2026SurfaceId('Alder Park', 'Pitch 4A'),
      date: onPitch3.date,
      startMinutes: onPitch3.startMinutes,
      endMinutes: onPitch3.startMinutes + 65,
      format: '9v9',
      label: 'constructed v control',
    };
    const scan = findFacilityConflicts(graph, [...asBookings, neighbour]);
    expect(scan.conflicts).toHaveLength(1);
    expect(scan.conflicts[0].code).toBe(FACILITY_REASON.OCCUPIED_SPATIAL_OVERLAP);
  });
});

/* -------------------------------------------------------------------------- */
/* Reason-code hygiene                                                         */
/* -------------------------------------------------------------------------- */

describe('reserve :: reason codes and severities', () => {
  it('registers a severity for every code and refuses an unregistered one', () => {
    for (const code of Object.values(RESERVE_REASON)) {
      expect(Object.values(RESERVE_SEVERITY)).toContain(reserveSeverityOf(code));
      expect(RESERVE_REASON_SEVERITY[code]).toBe(reserveSeverityOf(code));
    }
    expect(Object.keys(RESERVE_REASON_SEVERITY).sort()).toEqual(
      Object.values(RESERVE_REASON).sort()
    );
    expect(() => reserveSeverityOf('RESERVE_NOT_A_CODE')).toThrow(/no registered severity/);
  });

  it('looks severity up rather than accepting it', () => {
    const finding = makeReserveFinding(RESERVE_REASON.RESERVED_SLOT_MOVED, 'x');
    expect(finding.severity).toBe(RESERVE_SEVERITY.BLOCKING);
    expect(deriveReserveStatus([finding])).toBe(RESERVE_STATUS.REJECTED);
    expect(deriveReserveStatus([])).toBe(RESERVE_STATUS.ALLOWED);
  });

  it('starts every counter at zero and merges additively', () => {
    const meta = createReserveMeta();
    expect(Object.values(meta).every((value) => value === 0)).toBe(true);
    const merged = mergeReserveMeta(createReserveMeta(), { ...meta, slotsExamined: 3 });
    expect(merged.slotsExamined).toBe(3);
  });

  it('emits every code it declares, somewhere in this suite', () => {
    // The meta-assertion over the whole file. A code the module can declare but
    // never produce is one nothing proves the meaning of — the `declared-only`
    // state, at the level of a reason table. `OBSERVED` is filled by `observe()`
    // at each place findings are produced above, so this fails the moment a code
    // is added without a case that fires it.
    expect(OBSERVED.size).toBeGreaterThan(0);
    const declared = /** @type {string[]} */ (Object.values(RESERVE_REASON)).sort();
    const missing = declared.filter((code) => !OBSERVED.has(code));
    expect(
      missing,
      `these reason codes are declared and nothing in this suite makes the module emit them: ${missing.join(', ')}`
    ).toEqual([]);
    // And nothing emitted a code that is not in the table — which
    // `reserveSeverityOf()` would have thrown on anyway, so this is the belt to
    // that brace.
    expect([...OBSERVED].filter((code) => !declared.includes(code))).toEqual([]);
  });
});
