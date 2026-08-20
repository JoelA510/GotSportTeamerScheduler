/**
 * The acceptance test for Prompt 2.1, run through the placement demonstration
 * harness (`packages/core/src/placement/`).
 *
 * > *Acceptance test: flipping adjacency from hard to preference produces a
 * > different solve, and the system reports which specific games differ.*
 *
 * The harness is **not a solver** and this suite does not pretend otherwise —
 * see `packages/core/src/placement/replaceGames.js`, whose opening paragraph
 * states what it refuses to do. Wiring the registry into `gameScheduling.js` is
 * Phase 4. What is demonstrated here is narrower and real: the registry is the
 * *only* difference between two runs over identical corpus data, and the second
 * run puts four named games somewhere else.
 *
 * Everything is derived from the corpus at test time. The date, the games, the
 * candidate surfaces and the candidate kickoffs all come from
 * `combined_schedule.csv`; no clock time and no field name is typed in as an
 * expectation. The one date the harness runs on is incident 3's own: the
 * external league's seeding fixtures were published at 10:30/12:30 and finally
 * agreed at 10:00/12:00, on Pitches 2 and 3, which physically overlap the 9v9
 * ground on Pitches 1 and 4.
 *
 * Meta-assertion discipline (incident 4): every check asserts the run examined
 * a non-zero number of candidates, and `compareRuns()` throws rather than
 * comparing two empty populations.
 */

import { describe, it, expect } from 'vitest';

import {
  formatClockMinutes,
  indexFormats,
  loadCombinedSchedule,
  loadFacilityGeometry,
  loadFacilityPermits,
  loadGameFormats,
  loadSunsets,
} from '@squadlogic/core/fixtures/index.js';

import {
  FACILITY_REASON,
  buildFacilityGraphFromSeason2026,
  season2026SurfaceId,
} from '@squadlogic/core/facility/index.js';
import { buildFormatTimingTableFromSeason2026 } from '@squadlogic/core/timing/index.js';
import { buildAvailabilityCalendarFromSeason2026 } from '@squadlogic/core/availability/index.js';

import {
  CONSTRAINT_SEVERITY,
  CONSTRAINT_STATUS,
  CONSTRAINT_TYPE,
  SEASON_2026_CONSTRAINT_ID,
  buildSeason2026ConstraintRegistry,
  retypeConstraint,
  whatIfConstraintType,
} from '@squadlogic/core/constraints/index.js';

import {
  SEASON_2026_PLACEMENT_FORMAT,
  compareRuns,
  replaceGamesUnderRegistry,
  toSeason2026PlacementInput,
} from '@squadlogic/core/placement/index.js';

/* -------------------------------------------------------------------------- */
/* Corpus, loaded once                                                         */
/* -------------------------------------------------------------------------- */

const geometry = loadFacilityGeometry();
const graph = buildFacilityGraphFromSeason2026(geometry);
const rawFormats = loadGameFormats();
const table = buildFormatTimingTableFromSeason2026(rawFormats);
const formatsByName = indexFormats(rawFormats);
const rows = loadCombinedSchedule({ formatsByName });
const sunsets = loadSunsets();
/** Derived from the corpus rather than typed in, so a re-dated fixture moves it. */
const SEASON_YEAR = Number(sunsets[0].date.slice(0, 4));
const calendar = buildAvailabilityCalendarFromSeason2026(
  loadFacilityPermits({ seasonYear: SEASON_YEAR }),
  sunsets
);

/**
 * Incident 3's date, found in the corpus rather than asserted into existence:
 * `find` fails loudly if the fixture stops containing it.
 */
const ACCEPTANCE_DATE = rows.find((row) => row.date.endsWith('-08-22')).date;

const input = toSeason2026PlacementInput(graph, rows, { date: ACCEPTANCE_DATE });

const hardRegistry = buildSeason2026ConstraintRegistry();
const ADJACENCY = SEASON_2026_CONSTRAINT_ID.FIELD_OVERLAP_ADJACENCY;

/** The same registry with adjacency demoted to what it originally was. */
const preferenceRegistry = retypeConstraint(hardRegistry, ADJACENCY, {
  type: CONSTRAINT_TYPE.PREFERENCE,
  by: 'the acceptance test',
  at: null,
  note: 'returned to the preference it was introduced as, to see what changes',
  weight: 1,
});

const engines = { graph, table, calendar, registry: hardRegistry };
const hardRun = replaceGamesUnderRegistry(engines, input);
const preferenceRun = replaceGamesUnderRegistry(
  { ...engines, registry: preferenceRegistry },
  input
);
const comparison = compareRuns(hardRun, preferenceRun);

/* -------------------------------------------------------------------------- */
/* The bounded slice the harness runs on                                       */
/* -------------------------------------------------------------------------- */

describe('the bounded corpus slice', () => {
  it('selects one date, one format and one venue', () => {
    expect(input.date).toBe(ACCEPTANCE_DATE);
    expect(input.games.length).toBeGreaterThan(0);
    for (const game of input.games) {
      expect(game.format).toBe(SEASON_2026_PLACEMENT_FORMAT);
      expect(game.publishedSurfaceId).toBeTruthy();
      expect(game.publishedKickoffMinutes).toBeGreaterThan(0);
    }
    // Cross-checked against the raw corpus rather than hard-coded.
    const expected = rows.filter(
      (row) => row.date === ACCEPTANCE_DATE && row.format === SEASON_2026_PLACEMENT_FORMAT
    );
    expect(input.games).toHaveLength(expected.length);
  });

  it('holds the Select layer still, on ground that overlaps the 9v9 pitches', () => {
    // Meta-assertion: with no fixed bookings, adjacency could never bind and
    // both runs would be identical for a reason that has nothing to do with it.
    expect(input.fixedBookings.length).toBeGreaterThan(0);
    for (const booking of input.fixedBookings) {
      expect(booking.date).toBe(ACCEPTANCE_DATE);
      expect(booking.endMinutes).toBeGreaterThan(booking.startMinutes);
    }
    const blocked = new Set(
      input.candidateSurfaceIds.flatMap((surfaceId) =>
        graph.surfaces[surfaceId].lineage.flatMap((id) => graph.overlapBySurface[id] ?? [])
      )
    );
    const overlapping = input.fixedBookings.filter((booking) =>
      [...blocked].some((id) => graph.surfaces[booking.surfaceId].lineage.includes(id))
    );
    expect(overlapping.length).toBeGreaterThan(0);
  });

  it('searches only slots the corpus itself used at that venue that day', () => {
    const observed = new Set(
      rows
        .filter((row) => row.date === ACCEPTANCE_DATE && row.venue === 'Alder Park')
        .map((row) => row.kickoffMinutes)
    );
    expect(new Set(input.candidateKickoffMinutes)).toEqual(observed);
    expect(input.candidateKickoffMinutes.length).toBeGreaterThan(1);
    // The Select kickoffs are in the search space; without them the flip would
    // have nothing to change.
    const selectKickoffs = input.fixedBookings.map((booking) => booking.startMinutes);
    for (const kickoff of selectKickoffs) {
      expect(input.candidateKickoffMinutes).toContain(kickoff);
    }
  });

  it('offers only the surfaces the published schedule used for the format', () => {
    const published = new Set(
      rows
        .filter(
          (row) => row.date === ACCEPTANCE_DATE && row.format === SEASON_2026_PLACEMENT_FORMAT
        )
        .map((row) => season2026SurfaceId(row.venue, row.field))
    );
    expect(new Set(input.candidateSurfaceIds)).toEqual(published);
    expect(input.candidateSurfaceIds.length).toBeGreaterThan(1);
  });

  it('refuses a date or format the corpus does not have', () => {
    expect(() => toSeason2026PlacementInput(graph, rows, { date: '1999-01-01' })).toThrow(
      /no rows on/
    );
    expect(() =>
      toSeason2026PlacementInput(graph, rows, { date: ACCEPTANCE_DATE, format: 'korfball' })
    ).toThrow(/no korfball rows/);
  });
});

/* -------------------------------------------------------------------------- */
/* The run under the real (hard) registry                                      */
/* -------------------------------------------------------------------------- */

describe('placing under the seeded registry, with adjacency hard', () => {
  it('examined the whole candidate grid', () => {
    expect(hardRun.meta.gamesConsidered).toBe(input.games.length);
    expect(hardRun.meta.candidatesEvaluated).toBeGreaterThan(0);
    expect(hardRun.meta.candidatesRejected).toBeGreaterThan(0);
    expect(hardRun.meta.findingsExamined).toBeGreaterThan(0);
    expect(hardRun.meta.registryCodesGoverned).toBeGreaterThan(0);
    // The seeded registry restates Phase 1's severities, so nothing is rewritten.
    expect(hardRun.meta.registryOverridesApplied).toBe(0);
    expect(hardRun.meta.findingsReseverified).toBe(0);
  });

  it('places every game and reproduces the published schedule exactly', () => {
    expect(hardRun.placements).toHaveLength(input.games.length);
    expect(hardRun.unplaced).toHaveLength(0);
    // Not asserted as a count: every game is where the corpus published it.
    expect(hardRun.diffVsPublished.changed).toEqual([]);
    expect(hardRun.diffVsPublished.counts.unchanged).toBe(input.games.length);
    for (const placement of hardRun.placements) {
      expect(placement.status).toBe(CONSTRAINT_STATUS.ALLOWED);
      expect(placement.surfaceId).toBe(placement.publishedSurfaceId);
      expect(placement.kickoffMinutes).toBe(placement.publishedKickoffMinutes);
    }
  });

  it('rejects the Select-overlapping slots for the right reason', () => {
    const selectKickoffs = new Set(input.fixedBookings.map((booking) => booking.startMinutes));
    const clashing = hardRun.rejections.filter((rejection) =>
      selectKickoffs.has(rejection.kickoffMinutes)
    );
    expect(clashing.length).toBeGreaterThan(0);
    for (const rejection of clashing) {
      const overlap = rejection.findings.find(
        (finding) => finding.code === FACILITY_REASON.OCCUPIED_SPATIAL_OVERLAP
      );
      expect(overlap?.severity).toBe(CONSTRAINT_SEVERITY.BLOCKING);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* The acceptance test                                                         */
/* -------------------------------------------------------------------------- */

describe('flipping adjacency from hard to preference', () => {
  it('changes nothing else about the two runs', () => {
    // The single difference between the two runs is one field on one record.
    expect(preferenceRegistry.stats.constraintCount).toBe(hardRegistry.stats.constraintCount);
    expect(preferenceRegistry.stats.hardCount).toBe(hardRegistry.stats.hardCount - 1);
    expect(preferenceRun.meta.gamesConsidered).toBe(hardRun.meta.gamesConsidered);
    expect(preferenceRun.meta.kickoffsConsidered).toBe(hardRun.meta.kickoffsConsidered);
    expect(preferenceRun.meta.surfacesConsidered).toBe(hardRun.meta.surfacesConsidered);
    expect(preferenceRun.meta.registryOverridesApplied).toBeGreaterThan(0);
    expect(preferenceRun.meta.findingsReseverified).toBeGreaterThan(0);
  });

  it('produces a different solve', () => {
    expect(comparison.counts.compared).toBe(input.games.length);
    expect(comparison.counts.changed).toBeGreaterThan(0);
    expect(comparison.counts.changed + comparison.counts.unchanged).toBe(input.games.length);
  });

  it('reports which specific games differ, not just how many', () => {
    for (const change of comparison.changed) {
      expect(change.gameId).toBeTruthy();
      expect(change.label).toBeTruthy();
      expect(change.changedFields.length).toBeGreaterThan(0);
      expect(change.before).not.toBeNull();
      expect(change.after).not.toBeNull();
      // The game genuinely moved: at least one coordinate is different.
      expect(
        change.before.surfaceId !== change.after.surfaceId ||
          change.before.kickoffMinutes !== change.after.kickoffMinutes
      ).toBe(true);
      // And each named game is one of the games actually asked about.
      expect(input.games.map((game) => game.id)).toContain(change.gameId);
    }
    // The named games are exactly the ones the two runs disagree about.
    const changedIds = comparison.changed.map((change) => change.gameId).sort();
    const recomputed = input.games
      .map((game) => game.id)
      .filter((id) => {
        const a = hardRun.placements.find((p) => p.gameId === id);
        const b = preferenceRun.placements.find((p) => p.gameId === id);
        return a.surfaceId !== b.surfaceId || a.kickoffMinutes !== b.kickoffMinutes;
      })
      .sort();
    expect(changedIds).toEqual(recomputed);
  });

  it('moves the games into the slots adjacency had been forbidding', () => {
    const selectKickoffs = new Set(input.fixedBookings.map((booking) => booking.startMinutes));
    let landedOnOverlap = 0;
    for (const change of comparison.changed) {
      if (!selectKickoffs.has(change.after.kickoffMinutes)) continue;
      landedOnOverlap += 1;
      const placement = preferenceRun.placements.find((p) => p.gameId === change.gameId);
      const overlap = placement.findings.find(
        (finding) => finding.code === FACILITY_REASON.OCCUPIED_SPATIAL_OVERLAP
      );
      // Demoted, not deleted. The clash is still on the record, with the
      // constraint that demoted it named.
      expect(overlap).toBeTruthy();
      expect(overlap.severity).toBe(CONSTRAINT_SEVERITY.INFO);
      expect(overlap.details.baseSeverity).toBe(CONSTRAINT_SEVERITY.BLOCKING);
      expect(overlap.details.severityBy).toBe(ADJACENCY);
      expect(placement.status).toBe(CONSTRAINT_STATUS.ALLOWED);
    }
    expect(landedOnOverlap).toBeGreaterThan(0);
  });

  it('still refuses two games on the identical patch of ground', () => {
    const seen = new Map();
    for (const placement of preferenceRun.placements) {
      const key = `${placement.surfaceId}@${placement.kickoffMinutes}`;
      expect(seen.has(key)).toBe(false);
      seen.set(key, placement.gameId);
    }
    expect(seen.size).toBe(preferenceRun.placements.length);
  });

  it('shows the demoted run drifting from the published schedule', () => {
    // The published schedule is the ground truth families already have; the
    // preference run is a different, also-legal answer, and the diff says so
    // game by game rather than as a bare number (incident 1).
    expect(preferenceRun.diffVsPublished.counts.changed).toBe(comparison.counts.changed);
    for (const change of preferenceRun.diffVsPublished.changed) {
      expect(change.before.kickoffMinutes).not.toBeNull();
      expect(formatClockMinutes(change.after.kickoffMinutes)).toMatch(/^\d{2}:\d{2}$/);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* The what-if query predicts the second run                                   */
/* -------------------------------------------------------------------------- */

describe('the what-if query, cross-checked against the run it predicts', () => {
  const evaluations = hardRun.rejections.map((rejection) => ({
    id: `${rejection.gameId}|${rejection.surfaceId}|${rejection.kickoffMinutes}`,
    findings: rejection.findings,
  }));
  const projection = whatIfConstraintType(hardRegistry, ADJACENCY, CONSTRAINT_TYPE.PREFERENCE, {
    evaluations,
  });

  it('examined the refusals rather than reporting an empty delta', () => {
    expect(evaluations.length).toBeGreaterThan(0);
    expect(projection.meta.evaluationsExamined).toBe(evaluations.length);
    expect(projection.meta.findingsExamined).toBeGreaterThan(0);
    expect(projection.status).toBe(CONSTRAINT_STATUS.ALLOWED);
    const overlapDelta = projection.findingDeltas.find(
      (delta) => delta.code === FACILITY_REASON.OCCUPIED_SPATIAL_OVERLAP
    );
    expect(overlapDelta?.findingCount).toBeGreaterThan(0);
    expect(projection.statusDeltas.length).toBeGreaterThan(0);
  });

  it('predicts exactly the slots the demoted run then used', () => {
    const wouldBecomeLegal = new Set(projection.statusDeltas.map((delta) => delta.id));
    let checked = 0;
    for (const change of comparison.changed) {
      const placement = preferenceRun.placements.find((p) => p.gameId === change.gameId);
      const key = `${placement.gameId}|${placement.surfaceId}|${placement.kickoffMinutes}`;
      expect(wouldBecomeLegal.has(key)).toBe(true);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* The harness refuses to produce a vacuous result                             */
/* -------------------------------------------------------------------------- */

describe('the harness refuses vacuous work', () => {
  it('will not run over zero games, surfaces or kickoffs', () => {
    expect(() => replaceGamesUnderRegistry(engines, { ...input, games: [] })).toThrow();
    expect(() =>
      replaceGamesUnderRegistry(engines, { ...input, candidateSurfaceIds: [] })
    ).toThrow();
    expect(() =>
      replaceGamesUnderRegistry(engines, { ...input, candidateKickoffMinutes: [] })
    ).toThrow();
  });

  it('will not run without all four engines', () => {
    expect(() =>
      replaceGamesUnderRegistry(/** @type {any} */ ({ graph, table, calendar }), input)
    ).toThrow(/graph, table, calendar, registry/);
  });

  it('will not compare two runs over different games', () => {
    const halved = replaceGamesUnderRegistry(engines, {
      ...input,
      games: input.games.slice(0, 2),
    });
    expect(() => compareRuns(hardRun, halved)).toThrow(/different games/);
  });

  it('keeps an unplaceable fixture visible with a reason (incident 10)', () => {
    // Offer only the slot the Select layer occupies: under hard adjacency
    // nothing fits, and the games must be reported, never dropped.
    const onlyClashing = replaceGamesUnderRegistry(engines, {
      ...input,
      candidateKickoffMinutes: [input.fixedBookings[0].startMinutes],
    });
    expect(onlyClashing.placements).toHaveLength(0);
    expect(onlyClashing.unplaced).toHaveLength(input.games.length);
    for (const game of onlyClashing.unplaced) {
      expect(game.reason).toMatch(/no candidate slot/);
      expect(game.attempts).toBeGreaterThan(0);
      expect(game.publishedKickoffMinutes).toBeGreaterThan(0);
    }
    expect(onlyClashing.diffVsPublished.unplacedGameIds).toHaveLength(input.games.length);
  });

  it('refuses a candidate surface from another venue', () => {
    expect(() =>
      replaceGamesUnderRegistry(engines, {
        ...input,
        candidateSurfaceIds: [
          ...input.candidateSurfaceIds,
          season2026SurfaceId('Summit HS', 'Stadium'),
        ],
      })
    ).toThrow(/bounded to one venue/);
  });
});
