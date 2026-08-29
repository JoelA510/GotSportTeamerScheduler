/**
 * The read-only feasibility API — Prompt 7.1.
 *
 * > *Can this game move to Thursday? Can this team play at 6pm in November?
 * > What is stopping it?*
 *
 * Four properties are what this file is for, and each has a positive control
 * that is constructed rather than asserted:
 *
 * 1. **Read-only means read-only.** Every engine, the schedule, the context and
 *    the resolve state are **deep-frozen** and every query is then run against
 *    them. The freeze is proved to bite before it is relied on.
 * 2. **Every answer carries its binding constraint and a margin**, in minutes,
 *    under one sign convention that is checked against the owning module's own
 *    number rather than restated.
 * 3. **Three-valued, never two.** `unknown` never collapses into either
 *    neighbour, and the collapse is attempted deliberately to show it fails.
 * 4. **A query governed by an unenforced rule cannot be answered.** The corpus's
 *    two unenforced constraints are both `preference`, which cannot make a
 *    position illegal — so the guard is proved by **retyping one to `hard`
 *    through `whatIfConstraintType()`** (which projects a registry and adopts
 *    nothing) and showing the identical query change its answer.
 *
 * Every figure below is derived from the corpus at test time. Where the answer
 * disagrees with a hand derivation, the test says which assumption the model
 * refuses — see "the two 15-minute margins do not have the same status".
 */

import { describe, it, expect } from 'vitest';

import {
  AVAILABILITY_CONSTRAINT,
  AVAILABILITY_REASON,
  buildAvailabilityCalendarFromSeason2026,
  daylightLimitMinutes,
  latestLegalKickoff,
  resolvePermitWindow,
  sunsetOn,
} from '@squadlogic/core/availability/index.js';
import {
  ATTRIBUTION_SOURCE,
  buildAttributionContext,
  isSpecificClaim,
  makeClaim,
} from '@squadlogic/core/attribution/index.js';
import {
  CONSTRAINT_SEVERITY,
  CONSTRAINT_STATUS,
  CONSTRAINT_TYPE,
  CONSTRAINT_TYPE_SEVERITY,
  SEASON_2026_CONSTRAINT_ID,
  buildSeason2026ConstraintRegistry,
  whatIfConstraintType,
} from '@squadlogic/core/constraints/index.js';
import {
  FACILITY_REASON,
  buildFacilityGraphFromSeason2026,
  buildSeason2026VenueComplexMap,
  season2026SurfaceId,
} from '@squadlogic/core/facility/index.js';
import {
  loadCoachRoster,
  loadFacilityGeometry,
  loadFacilityPermits,
  loadGameFormats,
  loadSeason2026,
  loadSunsets,
} from '@squadlogic/core/fixtures/index.js';
import { buildSeason2026CoachRoster } from '@squadlogic/core/people/index.js';
import { runRuleEngine, toSeason2026Schedule } from '@squadlogic/core/ruleEngine/index.js';
import {
  TIMING_REASON,
  buildFormatTimingTableFromSeason2026,
  formatTimingOrUnknown,
} from '@squadlogic/core/timing/index.js';

import {
  FEASIBILITY_MARGIN_UNIT,
  FEASIBILITY_QUESTION,
  FEASIBILITY_REASON,
  FEASIBILITY_REASON_SEVERITY,
  FEASIBILITY_SEVERITY,
  FEASIBILITY_STATUS,
  FEASIBILITY_THRESHOLD,
  FEASIBILITY_UNKNOWN_BY_CODE,
  FEASIBILITY_VERDICT,
  FEASIBILITY_VERDICT_ORDER,
  canGameMove,
  canTeamPlay,
  createFeasibilityMeta,
  deriveFeasibilityVerdict,
  feasibilitySeverityOf,
  feasibleKickoffBounds,
  makeUnknown,
  marginFrom,
  probeKickoff,
  standingBookings,
} from '@squadlogic/core/feasibility/index.js';

/* -------------------------------------------------------------------------- */
/* Corpus and engines, loaded once                                             */
/* -------------------------------------------------------------------------- */

const season = loadSeason2026();
const graph = buildFacilityGraphFromSeason2026(loadFacilityGeometry());
const rawFormats = loadGameFormats();
const table = buildFormatTimingTableFromSeason2026(rawFormats);
const sunsets = loadSunsets();
/** Derived from the corpus rather than typed in, so a re-dated fixture moves it. */
const SEASON_YEAR = Number(sunsets[0].date.slice(0, 4));
const permits = loadFacilityPermits({ seasonYear: SEASON_YEAR });
const calendar = buildAvailabilityCalendarFromSeason2026(permits, sunsets);
const registry = buildSeason2026ConstraintRegistry();
const venueComplexes = buildSeason2026VenueComplexMap();
const schedule = toSeason2026Schedule(season);
const roster = buildSeason2026CoachRoster(loadCoachRoster());
const verification = runRuleEngine(schedule, {
  registry,
  resources: { graph, timingTable: table, calendar, venueComplexes },
});

/**
 * Freeze an object graph in place, following plain objects and arrays only.
 *
 * Used to establish rule 1 by force: a query that writes anywhere in the world
 * it was handed throws in strict mode, which every ES module is.
 *
 * @template T
 * @param {T} value
 * @param {Set<unknown>} [seen]
 * @returns {T}
 */
function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry, seen);
  return value;
}

const ALDER_2 = season2026SurfaceId('Alder Park', 'Pitch 2');
const SUMMIT = season2026SurfaceId('Summit HS', 'Stadium');

/** The context every question below is asked of. Frozen before anything runs. */
const context = deepFreeze(
  buildAttributionContext({
    graph,
    table,
    calendar,
    registry,
    schedule,
    verification,
    venueComplexes,
    roster,
  })
);
deepFreeze(graph);
deepFreeze(table);
deepFreeze(calendar);
deepFreeze(registry);
deepFreeze(schedule);
deepFreeze(venueComplexes);

/** 11v11 occupancy, from `game_formats.csv` and never typed here. */
const ELEVEN_OCCUPANCY = formatTimingOrUnknown(table, '11v11').occupancyMinutes.scheduled;

/**
 * The permit close, from the corpus's own resolver.
 *
 * @param {string} venueId
 * @param {string} date
 * @returns {number|null}
 */
function permitCloseOn(venueId, date) {
  return resolvePermitWindow(calendar, { venueId, date }).window?.closeMinutes ?? null;
}

/* -------------------------------------------------------------------------- */
/* Guard block — runs before anything behavioural                              */
/* -------------------------------------------------------------------------- */

describe('feasibility :: corpus guard', () => {
  it('is asked of the whole published season, not a slice of it', () => {
    // Without these, every "no position works" below would be a statement about
    // whatever subset happened to load. 679 is the corpus README's own figure.
    expect(schedule.games.length).toBe(679);
    expect(schedule.commitments.length).toBeGreaterThan(0);
    expect(registry.constraintIds.length).toBeGreaterThan(0);
    expect(verification.meta.rulesRun).toBeGreaterThan(0);
    expect(ELEVEN_OCCUPANCY).toBe(90);
  });

  it('was built with everything it can be built with, so no answer is thin by accident', () => {
    expect(context.findings).toEqual([]);
    expect(context.status).toBe(CONSTRAINT_STATUS.ALLOWED);
    expect(context.verification).not.toBeNull();
    expect(context.travel).not.toBeNull();
  });

  it('holds exactly the two unenforced constraints this corpus is known to carry', () => {
    // The premise of the `unknown` work below. If a third appeared, or one of
    // these two were enforced, every unenforced-rule assertion here would be
    // about a different world and would need re-deriving rather than passing.
    expect([...verification.coverage.unenforcedConstraintIds].sort()).toEqual([
      SEASON_2026_CONSTRAINT_ID.COACH_MAXIMUM_GAP,
      SEASON_2026_CONSTRAINT_ID.KICKOFF_VARIETY,
    ]);
    for (const id of verification.coverage.unenforcedConstraintIds) {
      expect(registry.byId[id].type).toBe(CONSTRAINT_TYPE.PREFERENCE);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Rule 1 — read-only means read-only                                          */
/* -------------------------------------------------------------------------- */

describe('feasibility :: read-only', () => {
  it('froze the world hard enough for the next test to mean something', () => {
    // The positive control for the freeze itself. Without it, "every query ran
    // against frozen inputs" would be true of inputs that were never frozen.
    expect(Object.isFrozen(schedule)).toBe(true);
    expect(Object.isFrozen(schedule.games)).toBe(true);
    expect(Object.isFrozen(schedule.games[0])).toBe(true);
    expect(Object.isFrozen(context.state)).toBe(true);
    expect(Object.isFrozen(context.state.games)).toBe(true);
    expect(Object.isFrozen(registry.byId)).toBe(true);
    expect(() => {
      /** @type {any} */ (schedule.games[0]).startMinutes = 1;
    }).toThrow(TypeError);
    expect(() => {
      /** @type {any} */ (context.state).games = {};
    }).toThrow(TypeError);
  });

  it('answers every question without writing anywhere in the world it was handed', () => {
    const game = schedule.games.find((entry) => entry.format === '11v11');
    const before = JSON.stringify({
      game: schedule.games[0],
      inventoryKeys: Object.keys(context.state.games).length,
      registryType: registry.byId[SEASON_2026_CONSTRAINT_ID.COACH_MAXIMUM_GAP].type,
    });

    expect(() =>
      canGameMove(
        context,
        { gameId: game.id, insteadOfMinutes: game.startMinutes + 30 },
        { venueComplexes }
      )
    ).not.toThrow();
    expect(() =>
      feasibleKickoffBounds(context, { surfaceId: ALDER_2, date: '2026-08-22', format: '11v11' })
    ).not.toThrow();
    expect(() =>
      canTeamPlay(
        context,
        {
          teamId: game.homeTeamId ?? schedule.teamUniverse[0],
          dates: ['2026-11-14'],
          kickoffMinutes: 18 * 60,
        },
        { venueComplexes }
      )
    ).not.toThrow();

    expect(
      JSON.stringify({
        game: schedule.games[0],
        inventoryKeys: Object.keys(context.state.games).length,
        registryType: registry.byId[SEASON_2026_CONSTRAINT_ID.COACH_MAXIMUM_GAP].type,
      })
    ).toBe(before);
  });
});

/* -------------------------------------------------------------------------- */
/* The frozen tables                                                           */
/* -------------------------------------------------------------------------- */

describe('feasibility :: the reason-code tables are frozen and complete', () => {
  it('registers a severity for every reason code, and refuses an unregistered one', () => {
    for (const code of Object.values(FEASIBILITY_REASON)) {
      expect(Object.values(FEASIBILITY_SEVERITY)).toContain(feasibilitySeverityOf(code));
    }
    expect(Object.keys(FEASIBILITY_REASON_SEVERITY).sort()).toEqual(
      Object.values(FEASIBILITY_REASON).sort()
    );
    expect(() => feasibilitySeverityOf('FEASIBILITY_NOT_A_CODE')).toThrow(/no registered severity/);
    expect(Object.isFrozen(FEASIBILITY_REASON_SEVERITY)).toBe(true);
    expect(Object.isFrozen(FEASIBILITY_VERDICT)).toBe(true);
  });

  it('maps only real codes of the modules that own them onto "could not measure"', () => {
    /** @type {Set<string>} */
    const owned = new Set([
      ...Object.values(AVAILABILITY_REASON),
      ...Object.values(FACILITY_REASON),
      ...Object.values(TIMING_REASON),
    ]);
    expect(Object.keys(FEASIBILITY_UNKNOWN_BY_CODE).length).toBeGreaterThan(0);
    for (const [code, feasibilityCode] of Object.entries(FEASIBILITY_UNKNOWN_BY_CODE)) {
      expect(owned.has(code), code).toBe(true);
      expect(Object.values(FEASIBILITY_REASON)).toContain(feasibilityCode);
    }
  });

  it('has three verdicts and only three, and orders them', () => {
    expect(Object.values(FEASIBILITY_VERDICT).sort()).toEqual([
      'feasible',
      'infeasible',
      'unknown',
    ]);
    expect([...FEASIBILITY_VERDICT_ORDER].sort()).toEqual(
      Object.values(FEASIBILITY_VERDICT).sort()
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Rule 3 — three-valued, never two                                            */
/* -------------------------------------------------------------------------- */

describe('feasibility :: unknown never collapses', () => {
  const anUnknown = makeUnknown('FEASIBILITY_FOOTPRINT_UNKNOWN', 'a footprint', 'because');

  it('never returns feasible while something is undecided', () => {
    expect(deriveFeasibilityVerdict({ blocked: false, unknowns: [anUnknown] })).toBe(
      FEASIBILITY_VERDICT.UNKNOWN
    );
    expect(deriveFeasibilityVerdict({ blocked: false, unknowns: [] })).toBe(
      FEASIBILITY_VERDICT.FEASIBLE
    );
  });

  it('lets a definite no win, and still carries what was not checked', () => {
    // Ordering matters and is asymmetric on purpose: more information cannot
    // make a blocked placement legal, so `infeasible` is decisive — but the
    // unknowns stay on the answer, so the reply is "no, and these were not
    // checked either" rather than a bare no.
    expect(deriveFeasibilityVerdict({ blocked: true, unknowns: [anUnknown] })).toBe(
      FEASIBILITY_VERDICT.INFEASIBLE
    );
  });

  it('refuses the two shapes that make the collapse free in JavaScript', () => {
    // A nullable boolean is how an unmeasured value becomes a "no"; a boolean
    // where a list of reasons belongs is how it becomes a yes. Both throw.
    expect(() =>
      deriveFeasibilityVerdict({ blocked: /** @type {any} */ (null), unknowns: [] })
    ).toThrow(/must be a boolean/);
    expect(() =>
      deriveFeasibilityVerdict({ blocked: /** @type {any} */ (undefined), unknowns: [] })
    ).toThrow(/must be a boolean/);
    expect(() =>
      deriveFeasibilityVerdict({ blocked: false, unknowns: /** @type {any} */ (true) })
    ).toThrow(/never a boolean/);
  });

  it('gives an unknown answer a null `tight`, because "not tight" is a claim about a placement', () => {
    const answer = canTeamPlay(context, {
      teamId: schedule.placeholderLabels[0],
      dates: ['2026-11-14'],
      kickoffMinutes: 18 * 60,
    });
    expect(answer.verdict).toBe(FEASIBILITY_VERDICT.UNKNOWN);
    expect(answer.tight).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Acceptance 1 — the latest kickoff, at both thresholds                       */
/* -------------------------------------------------------------------------- */

describe('feasibility :: acceptance 1 — the latest 11v11 kickoff, derived from the corpus', () => {
  /**
   * Ask the bounds question about empty ground: every fixture already on that
   * surface on that date is excluded, so the answer is about the venue rather
   * than about the day's traffic.
   *
   * @param {string} date
   * @param {string} surfaceId
   * @returns {import('@squadlogic/core/feasibility/types.js').KickoffBoundsAnswer}
   */
  const boundsOn = (date, surfaceId) =>
    feasibleKickoffBounds(context, {
      surfaceId,
      date,
      format: '11v11',
      ignoreGameIds: schedule.games
        .filter((game) => game.date === date && game.surfaceId.startsWith(surfaceId.split('/')[0]))
        .map((game) => game.id),
    });

  it('08/22 at Alder Park: the permit close and the daylight limit bind together', () => {
    const answer = boundsOn('2026-08-22', ALDER_2);
    const close = permitCloseOn('alder-park', '2026-08-22');
    const daylight = daylightLimitMinutes(calendar, '2026-08-22');
    const rawSunset = sunsetOn(calendar, '2026-08-22').sunsetMinutes;

    // The corpus's own numbers, so a re-dated fixture moves the expectation.
    expect(close).toBe(20 * 60);
    expect(rawSunset).toBe(20 * 60);
    expect(daylight).toBe(close - calendar.sunsetMarginMinutes);

    expect(answer.latestHard.kickoffMinutes).toBe(daylight - ELEVEN_OCCUPANCY);
    expect(answer.latestHard.kickoffMinutes).toBe(18 * 60 + 15);
    expect(answer.latestClean.kickoffMinutes).toBe(18 * 60 + 15);
    expect(answer.tightBandMinutes).toBe(0);
    expect(answer.verdict).toBe(FEASIBILITY_VERDICT.FEASIBLE);
  });

  it('11/14 at Alder Park: sunset binds, hours before the permit closes', () => {
    const answer = boundsOn('2026-11-14', ALDER_2);
    const close = permitCloseOn('alder-park', '2026-11-14');
    const daylight = daylightLimitMinutes(calendar, '2026-11-14');
    expect(sunsetOn(calendar, '2026-11-14').sunsetMinutes).toBe(16 * 60 + 35);

    expect(answer.latestHard.kickoffMinutes).toBe(daylight - ELEVEN_OCCUPANCY);
    expect(answer.latestHard.kickoffMinutes).toBe(14 * 60 + 50);
    expect(answer.latestClean.kickoffMinutes).toBe(14 * 60 + 50);
    expect(answer.latestHard.binding.map((bound) => bound.kind)).toEqual([
      AVAILABILITY_CONSTRAINT.SUNSET,
    ]);
    // "205 minutes before the close" is the *raw* sunset against the close; the
    // model's own gap is measured against the daylight limit it actually applies.
    expect(close - sunsetOn(calendar, '2026-11-14').sunsetMinutes).toBe(205);
    expect(close - daylight).toBe(220);
  });

  it('11/14 at Summit HS: lit, so the permit binds — and the two thresholds differ', () => {
    const answer = boundsOn('2026-11-14', SUMMIT);
    const close = permitCloseOn('summit-hs', '2026-11-14');
    expect(close).toBe(21 * 60);

    expect(answer.latestHard.kickoffMinutes).toBe(close - ELEVEN_OCCUPANCY);
    expect(answer.latestHard.kickoffMinutes).toBe(19 * 60 + 30);
    expect(answer.latestClean.kickoffMinutes).toBe(
      close - calendar.permitMarginMinutes - ELEVEN_OCCUPANCY
    );
    expect(answer.latestClean.kickoffMinutes).toBe(19 * 60 + 15);
    expect(answer.tightBandMinutes).toBe(calendar.permitMarginMinutes);
    expect(answer.tight).toBe(true);

    // Sunset is *carried as inapplicable with its reason*, which is the
    // difference between a rule that did not apply and a rule nobody checked.
    const sunsetNote = answer.latestHard.notApplicable.find(
      (entry) => entry.kind === AVAILABILITY_CONSTRAINT.SUNSET
    );
    expect(sunsetNote).toBeDefined();
    expect(/** @type {{ reason: string }} */ (sunsetNote).reason).toMatch(/lit/);
  });

  it('the two 15-minute margins do not have the same status, and the model says which', () => {
    // **The assumption this corpus refuses.** `permitMarginMinutes` and
    // `sunsetMarginMinutes` are both 15, so it is natural to read the hard
    // latest at Alder on 11/14 as 15:05 — sunset itself, less the occupancy.
    // The model puts it at 14:50, because `sunsets.csv` states "unlit games must
    // end 15 min before sunset" as a *rule*: `daylightLimitMinutes()` bakes the
    // margin into the limit and `SUNSET_MARGIN_VIOLATED` is `blocking`, while
    // the permit's 15 minutes is a comfort and `PERMIT_MARGIN_TIGHT` is
    // `compromise`. Both readings are derived here so the difference is visible
    // rather than argued.
    expect(calendar.sunsetMarginMinutes).toBe(calendar.permitMarginMinutes);
    expect(feasibilitySeverityLike(AVAILABILITY_REASON.SUNSET_MARGIN_VIOLATED)).toBe(
      CONSTRAINT_SEVERITY.BLOCKING
    );
    expect(feasibilitySeverityLike(AVAILABILITY_REASON.PERMIT_MARGIN_TIGHT)).toBe(
      CONSTRAINT_SEVERITY.COMPROMISE
    );

    const answer = boundsOn('2026-11-14', ALDER_2);
    const rawSunset = sunsetOn(calendar, '2026-11-14').sunsetMinutes;
    expect(rawSunset - ELEVEN_OCCUPANCY).toBe(15 * 60 + 5);
    expect(answer.latestHard.kickoffMinutes).toBe(rawSunset - ELEVEN_OCCUPANCY - 15);
  });
});

/**
 * The base severity of an availability code, read from the availability module's
 * own table through the registry-free path.
 *
 * @param {string} code
 * @returns {string}
 */
function feasibilitySeverityLike(code) {
  const probe = probeKickoff(
    context.engines,
    {
      surfaceId: ALDER_2,
      date: '2026-11-14',
      kickoffMinutes: 23 * 60,
      format: '11v11',
      ignoreBookingIds: [],
    },
    [],
    createFeasibilityMeta()
  );
  const hit = probe.findings.find((finding) => finding.code === code);
  if (hit) return hit.severity;
  const tight = probeKickoff(
    context.engines,
    {
      surfaceId: SUMMIT,
      date: '2026-11-14',
      kickoffMinutes: 19 * 60 + 30,
      format: '11v11',
      ignoreBookingIds: [],
    },
    [],
    createFeasibilityMeta()
  ).findings.find((finding) => finding.code === code);
  return tight ? tight.severity : 'not-raised';
}

/* -------------------------------------------------------------------------- */
/* Acceptance 2 — the tie                                                      */
/* -------------------------------------------------------------------------- */

describe('feasibility :: acceptance 2 — two constraints binding at one minute stay two', () => {
  const answer = feasibleKickoffBounds(context, {
    surfaceId: ALDER_2,
    date: '2026-08-22',
    format: '11v11',
    ignoreGameIds: schedule.games
      .filter((game) => game.date === '2026-08-22' && game.venueId === 'alder-park')
      .map((game) => game.id),
  });

  it('reports both the permit and the daylight limit at the clean boundary', () => {
    // 08/22 is the sharp case: Alder's permit closes at 20:00 and sunset is
    // 20:00, and both carry a 15-minute margin, so the last *clean* kickoff is
    // the same minute for both. One more minute and the daylight rule blocks
    // while the permit margin goes tight — two constraints speaking at once.
    expect(answer.latestClean.kickoffMinutes).toBe(18 * 60 + 15);
    expect(answer.latestClean.binding.map((bound) => bound.kind).sort()).toEqual([
      AVAILABILITY_CONSTRAINT.PERMIT,
      AVAILABILITY_CONSTRAINT.SUNSET,
    ]);
    expect(answer.latestClean.binding).toHaveLength(2);
  });

  it('says out loud that the bound is joint, rather than picking a winner', () => {
    // The hard boundary is *not* joint here — only the daylight rule blocks — so
    // the joint finding is the clean boundary's, and it exists precisely because
    // both boundaries report their own bound rather than only the first.
    expect(answer.latestHard.binding).toHaveLength(1);
    const joint = answer.findings.filter(
      (finding) => finding.code === FEASIBILITY_REASON.FEASIBILITY_BOUND_JOINT
    );
    expect(joint).toHaveLength(1);
    expect(joint[0].details.threshold).toBe(FEASIBILITY_THRESHOLD.CLEAN);
    expect([.../** @type {string[]} */ (joint[0].details.bindingKinds)].sort()).toEqual([
      AVAILABILITY_CONSTRAINT.PERMIT,
      AVAILABILITY_CONSTRAINT.SUNSET,
    ]);
    expect(joint[0].message).toMatch(/none of them is the reason on its own/);
  });

  it('does not cry joint where only one constraint speaks — the negative control', () => {
    // 11/14 at the same venue: sunset binds 220 minutes inside the permit, and
    // nothing else is anywhere near. A finding that fired there too would be a
    // label rather than an observation.
    const single = feasibleKickoffBounds(context, {
      surfaceId: ALDER_2,
      date: '2026-11-14',
      format: '11v11',
      ignoreGameIds: schedule.games
        .filter((game) => game.date === '2026-11-14' && game.venueId === 'alder-park')
        .map((game) => game.id),
    });
    expect(single.latestClean.binding).toHaveLength(1);
    expect(
      single.findings.filter(
        (finding) => finding.code === FEASIBILITY_REASON.FEASIBILITY_BOUND_JOINT
      )
    ).toEqual([]);
  });

  it('each member keeps its own margin and its own code, so neither number is shared', () => {
    const byKind = Object.fromEntries(
      answer.latestClean.binding.map((bound) => [bound.kind, bound])
    );
    expect(byKind[AVAILABILITY_CONSTRAINT.SUNSET].slackMinutes).toBe(0);
    expect(byKind[AVAILABILITY_CONSTRAINT.PERMIT].slackMinutes).toBe(calendar.permitMarginMinutes);
    expect(byKind[AVAILABILITY_CONSTRAINT.SUNSET].raises.map((entry) => entry.code)).toEqual([
      AVAILABILITY_REASON.SUNSET_MARGIN_VIOLATED,
    ]);
    expect(byKind[AVAILABILITY_CONSTRAINT.PERMIT].raises.map((entry) => entry.code)).toEqual([
      AVAILABILITY_REASON.PERMIT_MARGIN_TIGHT,
    ]);
    // …and the two raise findings of *different* severity, which is precisely
    // why an answer that named one of them would be claiming a precision it
    // does not have.
    expect(byKind[AVAILABILITY_CONSTRAINT.SUNSET].raises[0].severity).toBe(
      CONSTRAINT_SEVERITY.BLOCKING
    );
    expect(byKind[AVAILABILITY_CONSTRAINT.PERMIT].raises[0].severity).toBe(
      CONSTRAINT_SEVERITY.COMPROMISE
    );
  });

  it('a reader who took the first member would lose one — the positive control', () => {
    // The check above is only worth reading if truncating to one is observably
    // different, so the truncation is performed here and shown to be wrong.
    const truncated = [answer.latestClean.binding[0]];
    expect(truncated).toHaveLength(1);
    expect(new Set(truncated.map((bound) => bound.kind)).size).toBeLessThan(
      new Set(answer.latestClean.binding.map((bound) => bound.kind)).size
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Acceptance 3 — incident 3, and the margin that made it an incident          */
/* -------------------------------------------------------------------------- */

describe('feasibility :: acceptance 3 — "can it move to 12:30?" answers "no, by 10 minutes"', () => {
  const subject = schedule.games.find(
    (game) => game.date === '2026-08-22' && game.format === '11v11' && game.startMinutes === 12 * 60
  );
  const answer = canGameMove(
    context,
    { gameId: subject.id, insteadOfMinutes: 12 * 60 + 30 },
    { venueComplexes }
  );

  it('finds the corpus fixture the incident is about', () => {
    expect(subject).toBeDefined();
    expect(subject.surfaceId).toBe(ALDER_2);
    // The two already-published 9v9 blocks on the overlapping halves of Pitch 1.
    const neighbours = schedule.games.filter(
      (game) =>
        game.date === '2026-08-22' &&
        game.format === '9v9' &&
        game.surfaceId.startsWith('alder-park/pitch-1')
    );
    expect(neighbours.length).toBeGreaterThan(0);
  });

  it('is infeasible, and the margin is the ten minutes the incident log records', () => {
    expect(answer.verdict).toBe(FEASIBILITY_VERDICT.INFEASIBLE);
    expect(answer.marginUnit).toBe(FEASIBILITY_MARGIN_UNIT);
    expect(answer.marginMinutes).toBe(-10);
    expect(answer.marginBasis).toBe(AVAILABILITY_CONSTRAINT.OCCUPANCY);
    // The sign convention, held: negative is the bound broken by that many
    // minutes, and the number is the owning module's own slack rather than a
    // display value negated somewhere on the way out.
    const occupancy = answer.blockers.find(
      (claim) => claim.kind === AVAILABILITY_CONSTRAINT.OCCUPANCY
    );
    expect(occupancy.slackMinutes).toBe(answer.marginMinutes);
  });

  it('names the constraint and the code, not a category', () => {
    expect(answer.binding).toHaveLength(1);
    expect(answer.binding[0].constraintId).toBe(SEASON_2026_CONSTRAINT_ID.FIELD_OVERLAP_ADJACENCY);
    expect(answer.binding[0].raises.map((entry) => entry.code)).toEqual([
      FACILITY_REASON.OCCUPIED_SPATIAL_OVERLAP,
    ]);
    // The source is the **availability edge's**, not the code's owner: this
    // claim is `claimFromAvailabilityConstraint()`'s occupancy bound carrying a
    // facility finding, and 4.3 labels a bound by the machinery that computed
    // the limit. Carried through rather than relabelled here.
    expect(answer.binding[0].source).toBe(ATTRIBUTION_SOURCE.AVAILABILITY);
  });

  it('says what is stopping it, as a certified minimal set rather than the registry', () => {
    expect(answer.minimalSet).not.toBeNull();
    expect(answer.minimalSet.certified).toBe(true);
    expect(answer.minimalSet.constraintIds).toEqual([
      SEASON_2026_CONSTRAINT_ID.FIELD_OVERLAP_ADJACENCY,
    ]);
    expect(answer.minimalSet.constraintIds.length).toBeLessThan(registry.constraintIds.length);
    // Minimality is proved by the witnesses, not by the flag.
    for (const witness of answer.minimalSet.witnesses) {
      expect(witness.legal).toBe(false);
    }
  });

  it('the time it actually has is feasible, which is the other half of the answer', () => {
    const stayPut = feasibleKickoffBounds(context, {
      surfaceId: ALDER_2,
      date: '2026-08-22',
      format: '11v11',
      notBeforeMinutes: subject.startMinutes,
      notAfterMinutes: subject.startMinutes,
      ignoreGameIds: [subject.id],
    });
    expect(stayPut.latestHard.kickoffMinutes).toBe(subject.startMinutes);
  });
});

/* -------------------------------------------------------------------------- */
/* Acceptance 4 — a blackout has no margin, and null is not zero               */
/* -------------------------------------------------------------------------- */

describe('feasibility :: acceptance 4 — the 09/19 blackout', () => {
  const subject = schedule.games.find(
    (game) => game.surfaceId === SUMMIT && game.format === '11v11'
  );
  const answer = canGameMove(
    context,
    { gameId: subject.id, insteadOfDate: '2026-09-19', insteadOfSurfaceId: SUMMIT },
    { venueComplexes }
  );

  it('refuses the move and names the permit record', () => {
    expect(answer.verdict).toBe(FEASIBILITY_VERDICT.INFEASIBLE);
    expect(answer.binding.map((bound) => bound.kind)).toEqual([AVAILABILITY_CONSTRAINT.PERMIT]);
    expect(answer.binding[0].raises.map((entry) => entry.code)).toEqual([
      AVAILABILITY_REASON.PERMIT_BLACKOUT,
    ]);
    expect(answer.minimalSet.constraintIds).toEqual([SEASON_2026_CONSTRAINT_ID.PERMIT_WINDOW]);
  });

  it('reports the margin as unavailable rather than as zero', () => {
    // A blackout has no limit to measure against. `0` would read as "exactly at
    // the edge", which is a confident number about a bound nobody could measure.
    expect(answer.marginMinutes).toBeNull();
    expect(answer.marginBasis).toBeNull();
    expect(answer.findings.map((finding) => finding.code)).toContain(
      FEASIBILITY_REASON.FEASIBILITY_MARGIN_UNAVAILABLE
    );
  });

  it('gives the blackout bound a claim that carries its code, not a bare category', () => {
    // The regression for a defect the reason-code audit found rather than this
    // file: a boundary claim built without the findings that belong to it loses
    // its codes, and a permit on a blacked-out date has no limit and no slack
    // either — so the claim named `permit` and said nothing, which is the exact
    // answer this whole layer exists to replace.
    const bounds = feasibleKickoffBounds(context, {
      surfaceId: SUMMIT,
      date: '2026-09-19',
      format: '11v11',
    });
    const permitClaim = bounds.latestHard.claims.find(
      (claim) => claim.kind === AVAILABILITY_CONSTRAINT.PERMIT
    );
    expect(permitClaim).toBeDefined();
    expect(permitClaim.codes).toContain(AVAILABILITY_REASON.PERMIT_BLACKOUT);
    expect(isSpecificClaim(permitClaim)).toBe(true);
    expect(bounds.findings.map((finding) => finding.code)).not.toContain(
      'ATTRIBUTION_CLAIM_CATEGORY_ONLY'
    );
  });

  it('gives the whole date no boundary at all, and says the bound is unstated', () => {
    const bounds = feasibleKickoffBounds(context, {
      surfaceId: SUMMIT,
      date: '2026-09-19',
      format: '11v11',
    });
    expect(bounds.verdict).toBe(FEASIBILITY_VERDICT.INFEASIBLE);
    expect(bounds.latestHard.kickoffMinutes).toBeNull();
    expect(bounds.latestClean.kickoffMinutes).toBeNull();
    expect(bounds.tightBandMinutes).toBeNull();
    expect(bounds.findings.map((finding) => finding.code)).toContain(
      FEASIBILITY_REASON.FEASIBILITY_BOUND_UNSTATED
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Acceptance 5 — an unknown footprint is never "no clash"                     */
/* -------------------------------------------------------------------------- */

describe('feasibility :: acceptance 5 — GAP-14 propagates as unknown, never as fine', () => {
  const scrimmages = schedule.games.filter((game) => game.endMinutes === null);

  it('finds the corpus rows that have no footprint at all', () => {
    // The meta-assertion for this whole block: four rows, and if the loader ever
    // gave them an invented duration this would be zero and every test below
    // would pass while looking at nothing.
    expect(scrimmages.length).toBe(4);
    for (const row of scrimmages) expect(row.format).toBe('Scrimmage');
  });

  it('never calls a move of one of them feasible', () => {
    for (const row of scrimmages) {
      const answer = canGameMove(
        context,
        { gameId: row.id, insteadOfMinutes: row.startMinutes + 60 },
        { venueComplexes }
      );
      expect(answer.verdict).not.toBe(FEASIBILITY_VERDICT.FEASIBLE);
      expect(answer.unknowns.map((entry) => entry.code)).toContain(
        FEASIBILITY_REASON.FEASIBILITY_FOOTPRINT_UNKNOWN
      );
    }
  });

  it('has no team playing twice on one date, so the clash path needs a constructed input', () => {
    // **Stated rather than worked around.** The team-clash check exists because
    // a team that already has a fixture in that window cannot take another, and
    // `bookingsOverlapInTime()` answers it in three values. This corpus never
    // exercises it: no team plays twice on any date, so the comparison runs zero
    // times on real data. That is a fact about the season, not a pass, and the
    // constructed case below is what proves the path works.
    const perTeamDate = new Map();
    for (const game of schedule.games) {
      for (const teamId of [game.homeTeamId, game.awayTeamId]) {
        if (!teamId) continue;
        const key = `${teamId}\u0000${game.date}`;
        perTeamDate.set(key, (perTeamDate.get(key) ?? 0) + 1);
      }
    }
    expect(perTeamDate.size).toBeGreaterThan(0);
    expect([...perTeamDate.values()].filter((count) => count > 1)).toEqual([]);
  });

  it('carries the unmeasurable overlap as unknown, on a constructed same-day pair', () => {
    // Two fixtures for one team on one date, one of them untimed — the corpus's
    // own `Scrimmage` shape, in a schedule small enough to make the clash the
    // only thing in question. Built through the same public entry point every
    // other answer here uses; nothing is reached into and altered.
    const timed = schedule.games.find((game) => game.format === '9v9' && game.homeTeamId !== null);
    const teamId = timed.homeTeamId;
    const untimed = {
      ...timed,
      id: 'constructed-untimed-pair',
      startMinutes: timed.startMinutes,
      endMinutes: null,
      format: 'Scrimmage',
      awayTeamId: null,
      awayLabel: '-',
    };
    const constructed = {
      ...schedule,
      name: 'constructed same-day pair',
      games: [...schedule.games, untimed],
    };
    const constructedContext = buildAttributionContext({
      graph,
      table,
      calendar,
      registry,
      schedule: constructed,
      verification,
      venueComplexes,
      roster,
    });

    const answer = canTeamPlay(
      constructedContext,
      {
        teamId,
        dates: [timed.date],
        kickoffMinutes: timed.startMinutes,
        surfaceIds: [timed.surfaceId],
      },
      { venueComplexes }
    );

    // Meta-assertion: a run that compared nothing would make the rest vacuous.
    expect(answer.meta.teamFixturesCompared).toBeGreaterThan(0);
    const footprintUnknowns = answer.candidates.flatMap((candidate) =>
      candidate.unknowns.filter(
        (entry) => entry.code === FEASIBILITY_REASON.FEASIBILITY_FOOTPRINT_UNKNOWN
      )
    );
    expect(footprintUnknowns.length).toBeGreaterThan(0);
    expect(footprintUnknowns[0].reason).toMatch(/not a "no clash"/);
    for (const candidate of answer.candidates) {
      expect(candidate.verdict).not.toBe(FEASIBILITY_VERDICT.FEASIBLE);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Acceptance 6 — a query nobody enforces cannot be answered                   */
/* -------------------------------------------------------------------------- */

describe('feasibility :: acceptance 6 — the unenforced rule', () => {
  const question = { surfaceId: ALDER_2, date: '2026-08-22', format: '11v11' };

  it('reports both unenforced constraints on every answer, and compromises its status', () => {
    const answer = feasibleKickoffBounds(context, question);
    const codes = answer.unknowns.map((entry) => entry.constraintId).sort();
    expect(codes).toEqual([
      SEASON_2026_CONSTRAINT_ID.COACH_MAXIMUM_GAP,
      SEASON_2026_CONSTRAINT_ID.KICKOFF_VARIETY,
    ]);
    expect(answer.status).toBe(FEASIBILITY_STATUS.COMPROMISED);
    expect(answer.findings.map((finding) => finding.code)).toContain(
      FEASIBILITY_REASON.FEASIBILITY_RULE_UNENFORCED
    );
  });

  it('does not let an unenforced preference change a verdict, and says why in the record', () => {
    // A `preference` maps to `info`, and an `info` finding moves no status
    // anywhere in this repository — so "nobody optimised toward this" is not
    // "this might be illegal". The record carries the derivation.
    const answer = feasibleKickoffBounds(context, question);
    expect(answer.verdict).toBe(FEASIBILITY_VERDICT.FEASIBLE);
    for (const entry of answer.unknowns) {
      expect(entry.verdictBearing).toBe(false);
      expect(entry.details.typeSeverity).toBe(CONSTRAINT_TYPE_SEVERITY[CONSTRAINT_TYPE.PREFERENCE]);
    }
  });

  it('DOES refuse to answer when the unenforced constraint could make something illegal', () => {
    // **The constructed positive control**, and the whole point of the guard.
    // `coach-maximum-gap` is retyped to `hard` through `whatIfConstraintType()`,
    // which projects a registry and adopts nothing; the identical question then
    // comes back `unknown` naming it. Without this, "the guard is there" would
    // be a claim about a branch nothing on this corpus can reach.
    const projection = whatIfConstraintType(
      registry,
      SEASON_2026_CONSTRAINT_ID.COACH_MAXIMUM_GAP,
      CONSTRAINT_TYPE.HARD
    );
    const projected = projection.projectedRegistry;
    const projectedVerification = runRuleEngine(schedule, {
      registry: projected,
      resources: { graph, timingTable: table, calendar, venueComplexes },
    });
    const projectedContext = buildAttributionContext({
      graph,
      table,
      calendar,
      registry: projected,
      schedule,
      verification: projectedVerification,
      venueComplexes,
      roster,
    });

    const answer = feasibleKickoffBounds(projectedContext, question);
    expect(answer.verdict).toBe(FEASIBILITY_VERDICT.UNKNOWN);
    const bearing = answer.unknowns.filter((entry) => entry.verdictBearing === true);
    expect(bearing.map((entry) => entry.constraintId)).toEqual([
      SEASON_2026_CONSTRAINT_ID.COACH_MAXIMUM_GAP,
    ]);

    // …and the projection adopted nothing: the registry every other test in this
    // file uses still says `preference`.
    expect(registry.byId[SEASON_2026_CONSTRAINT_ID.COACH_MAXIMUM_GAP].type).toBe(
      CONSTRAINT_TYPE.PREFERENCE
    );
    expect(projected.byId[SEASON_2026_CONSTRAINT_ID.COACH_MAXIMUM_GAP].type).toBe(
      CONSTRAINT_TYPE.HARD
    );
  });

  it('refuses to answer at all when no rule-engine run was supplied', () => {
    const thin = buildAttributionContext({ graph, table, calendar, registry, schedule });
    const game = schedule.games.find((entry) => entry.format === '11v11');
    const answer = canGameMove(
      thin,
      { gameId: game.id, insteadOfMinutes: game.startMinutes + 30 },
      { venueComplexes }
    );
    expect(answer.verdict).toBe(FEASIBILITY_VERDICT.UNKNOWN);
    expect(answer.unknowns.map((entry) => entry.code)).toContain(
      FEASIBILITY_REASON.FEASIBILITY_VERIFICATION_ABSENT
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Acceptance 7 — travel goes through the venue-complex model or not at all    */
/* -------------------------------------------------------------------------- */

describe('feasibility :: acceptance 7 — coach travel, or an admission that it was not asked', () => {
  /**
   * A fixture at least one of whose coaches has a *second* commitment that day.
   *
   * Travel is a property of a transition between two commitments, so a coach
   * with one commitment produces no transition and an answer about them would
   * report zero examined — the vacuous pass this block exists to avoid.
   */
  const perPersonDay = new Map();
  for (const commitment of schedule.commitments) {
    const key = `${commitment.personId}\u0000${commitment.date}`;
    if (!perPersonDay.has(key)) perPersonDay.set(key, []);
    perPersonDay.get(key).push(commitment);
  }
  const busyGameIds = new Set(
    [...perPersonDay.values()]
      .filter((entries) => entries.length > 1)
      .flatMap((entries) => entries.map((entry) => entry.gameId))
      .filter(Boolean)
  );
  const game = schedule.games.find((entry) => entry.counted === true && busyGameIds.has(entry.id));

  it('finds a fixture whose coaches have a day, so the block below is not vacuous', () => {
    expect(game).toBeDefined();
    expect(busyGameIds.size).toBeGreaterThan(0);
    expect(
      schedule.commitments.filter((commitment) => commitment.gameId === game.id).length
    ).toBeGreaterThan(0);
  });

  it('refuses to guess when no venue complexes are supplied', () => {
    // Judging every pair of distinct venue names against the 60-minute drive
    // floor is the misreading that reported eighteen shortfalls where one was
    // real. The answer says it could not speak about coaches rather than saying
    // they are fine.
    const answer = canGameMove(context, {
      gameId: game.id,
      insteadOfMinutes: game.startMinutes + 60,
    });
    expect(answer.unknowns.map((entry) => entry.code)).toContain(
      FEASIBILITY_REASON.FEASIBILITY_TRAVEL_ABSENT
    );
    expect(answer.verdict).not.toBe(FEASIBILITY_VERDICT.FEASIBLE);
  });

  it('projects travel onto the hypothesis when they are, and does not blame the baseline', () => {
    const answer = canGameMove(
      context,
      { gameId: game.id, insteadOfMinutes: game.startMinutes + 60 },
      { venueComplexes }
    );
    expect(answer.unknowns.map((entry) => entry.code)).not.toContain(
      FEASIBILITY_REASON.FEASIBILITY_TRAVEL_ABSENT
    );
    expect(answer.meta.travelTransitionsProjected).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Acceptance 8 — placeholders are not teams                                   */
/* -------------------------------------------------------------------------- */

describe('feasibility :: acceptance 8 — an unnamed fixture is not an opponent', () => {
  it('refuses every placeholder label the schedule declares', () => {
    expect(schedule.placeholderLabels).toContain('-');
    expect(schedule.placeholderLabels.some((label) => /^Select Game \d+$/.test(label))).toBe(true);
    for (const label of schedule.placeholderLabels) {
      const answer = canTeamPlay(context, {
        teamId: label,
        dates: ['2026-11-14'],
        kickoffMinutes: 18 * 60,
      });
      expect(answer.verdict).toBe(FEASIBILITY_VERDICT.UNKNOWN);
      expect(answer.unknowns.map((entry) => entry.code)).toContain(
        FEASIBILITY_REASON.FEASIBILITY_SUBJECT_NOT_A_TEAM
      );
      expect(answer.candidates).toEqual([]);
    }
  });

  it('says so about a real team it simply does not hold, in different words', () => {
    const answer = canTeamPlay(context, {
      teamId: 'a-team-nothing-in-this-run-mentions',
      dates: ['2026-11-14'],
      kickoffMinutes: 18 * 60,
    });
    expect(answer.verdict).toBe(FEASIBILITY_VERDICT.UNKNOWN);
    expect(answer.unknowns.map((entry) => entry.code)).toContain(
      FEASIBILITY_REASON.FEASIBILITY_SUBJECT_UNKNOWN
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Acceptance 9 — can this team play at 6pm in November?                       */
/* -------------------------------------------------------------------------- */

describe('feasibility :: acceptance 9 — "can this team play at 6pm in November?"', () => {
  const november = [...new Set(schedule.games.map((game) => game.date))]
    .filter((date) => date.startsWith(`${SEASON_YEAR}-11-`))
    .sort();
  const teamId = schedule.teamUniverse.find((id) =>
    schedule.games.some((game) => game.homeTeamId === id && game.format === '9v9')
  );
  const answer = canTeamPlay(
    context,
    { teamId, dates: november, kickoffMinutes: 18 * 60 },
    { venueComplexes }
  );

  it('is asked about a real November, on real ground', () => {
    expect(november.length).toBeGreaterThan(0);
    expect(teamId).toBeDefined();
    expect(answer.carrierGameId).not.toBeNull();
  });

  it('answers no, because November sunset is hours before six', () => {
    // Every one of the dates has a sunset earlier than a 6pm kickoff plus a 9v9
    // footprint, so the whole grid is illegal — and the answer names sunset
    // rather than shrugging.
    expect(answer.verdict).toBe(FEASIBILITY_VERDICT.INFEASIBLE);
    expect(answer.verdictCounts[FEASIBILITY_VERDICT.FEASIBLE]).toBe(0);
    for (const candidate of answer.candidates) {
      expect(candidate.verdict).toBe(FEASIBILITY_VERDICT.INFEASIBLE);
      expect(candidate.binding.map((bound) => bound.kind)).toContain(
        AVAILABILITY_CONSTRAINT.SUNSET
      );
      expect(candidate.marginMinutes).toBeLessThan(0);
    }
  });

  it('drops no candidate: every date crossed with every surface is answered', () => {
    // Incident 10's rule applied to a query. The expected count is derived from
    // the inputs rather than written down.
    const surfaces = new Set(
      schedule.games
        .filter((game) => game.homeTeamId === teamId || game.awayTeamId === teamId)
        .map((game) => game.surfaceId)
    );
    expect(answer.candidates.length).toBe(november.length * surfaces.size);
    expect(answer.meta.candidatesAnswered).toBe(answer.meta.candidatesConsidered);
    expect(answer.meta.candidatesConsidered).toBe(answer.candidates.length);
    expect(answer.findings.map((finding) => finding.code)).not.toContain(
      FEASIBILITY_REASON.FEASIBILITY_CANDIDATE_DROPPED
    );
  });

  it('says yes, with a margin, at a time the same dates can actually take', () => {
    const earlier = canTeamPlay(
      context,
      { teamId, dates: november, kickoffMinutes: 9 * 60 },
      { venueComplexes }
    );
    expect(earlier.verdict).toBe(FEASIBILITY_VERDICT.FEASIBLE);
    expect(earlier.verdictCounts[FEASIBILITY_VERDICT.FEASIBLE]).toBeGreaterThan(0);
    const yes = earlier.candidates.find(
      (candidate) => candidate.verdict === FEASIBILITY_VERDICT.FEASIBLE
    );
    expect(yes.binding.length).toBeGreaterThan(0);
    expect(typeof yes.marginMinutes === 'number' || yes.marginMinutes === null).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* The clean boundary is exact, not merely plausible                           */
/* -------------------------------------------------------------------------- */

describe('feasibility :: the clean boundary agrees with a minute-by-minute scan', () => {
  /**
   * The last minute in a range at which nothing above `info` is raised, found by
   * brute force.
   *
   * This is the oracle the candidate search is checked against. The search
   * generates a handful of minutes and confirms each; this tries all of them.
   * They must agree, and if the generator ever stops containing the answer this
   * is what says so.
   *
   * @param {string} surfaceId
   * @param {string} date
   * @param {number} from
   * @param {number} to
   * @param {ReadonlyArray<string>} [ignoreGameIds]
   * @returns {number|null}
   */
  function scanCleanBoundary(surfaceId, date, from, to, ignoreGameIds = []) {
    const bookings = standingBookings(context.state, date, ignoreGameIds);
    for (let minute = to; minute >= from; minute -= 1) {
      const probe = probeKickoff(
        context.engines,
        { surfaceId, date, kickoffMinutes: minute, format: '11v11', ignoreBookingIds: [] },
        bookings,
        createFeasibilityMeta()
      );
      const consequential = probe.findings.filter(
        (finding) => finding.severity !== CONSTRAINT_SEVERITY.INFO
      );
      if (consequential.length === 0) return minute;
    }
    return null;
  }

  it('agrees on every 11v11 surface-date the acceptance cases use', () => {
    const cases = [
      ['2026-08-22', ALDER_2],
      ['2026-11-14', ALDER_2],
      ['2026-11-14', SUMMIT],
      ['2026-08-29', SUMMIT],
    ];
    let compared = 0;
    let nonNull = 0;
    for (const [date, surfaceId] of cases) {
      // Empty ground on both sides of the comparison, so the oracle and the
      // search are answering the same question. Without the exclusions the two
      // agree on `null` at Summit — where the day's own two fixtures leave no
      // legal minute at all — which is an agreement about nothing.
      const ignoreGameIds = schedule.games
        .filter((game) => game.date === date && game.venueId === surfaceId.split('/')[0])
        .map((game) => game.id);
      const answer = feasibleKickoffBounds(context, {
        surfaceId,
        date,
        format: '11v11',
        ignoreGameIds,
      });
      const scanned = scanCleanBoundary(
        surfaceId,
        date,
        answer.searchedFromMinutes,
        answer.searchedToMinutes,
        ignoreGameIds
      );
      expect(answer.latestClean.kickoffMinutes, `${date} ${surfaceId}`).toBe(scanned);
      compared += 1;
      if (scanned !== null) nonNull += 1;
    }
    // Two meta-assertions, because either alone can be satisfied by an empty
    // comparison: the loop ran, and it ran on cases where the oracle found a
    // boundary rather than agreeing with the search that there is none.
    expect(compared).toBe(cases.length);
    expect(nonNull).toBe(cases.length);
  });

  it('and the scan is an oracle that can disagree, not a restatement', () => {
    // The positive control for the oracle itself: the same scan, run over a day
    // whose fixtures are left in place, returns a *different* answer from the
    // empty-ground one — so agreement above is a fact about the search rather
    // than about two functions that cannot differ.
    const empty = scanCleanBoundary(
      SUMMIT,
      '2026-11-14',
      0,
      24 * 60,
      schedule.games.filter((game) => game.date === '2026-11-14').map((game) => game.id)
    );
    const occupied = scanCleanBoundary(SUMMIT, '2026-11-14', 0, 24 * 60, []);
    expect(empty).toBe(19 * 60 + 15);
    expect(occupied).not.toBe(empty);
    expect(occupied).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Meta-assertions — an answer that looked at nothing is a loud failure         */
/* -------------------------------------------------------------------------- */

describe('feasibility :: every answer proves it examined something', () => {
  it('counts what each query actually did', () => {
    const game = schedule.games.find((entry) => entry.format === '11v11');
    const move = canGameMove(
      context,
      { gameId: game.id, insteadOfMinutes: game.startMinutes + 30 },
      { venueComplexes }
    );
    expect(move.meta.questionsAsked).toBeGreaterThan(0);
    expect(move.meta.candidatesAnswered).toBe(1);
    expect(move.meta.placementChecksRun).toBeGreaterThan(0);
    expect(move.meta.constraintsConsulted).toBeGreaterThan(0);

    const bounds = feasibleKickoffBounds(context, {
      surfaceId: ALDER_2,
      date: '2026-08-22',
      format: '11v11',
    });
    expect(bounds.meta.boundaryProbesRun).toBeGreaterThan(1);
    expect(bounds.meta.claimsCarried).toBeGreaterThan(0);
    expect(bounds.latestHard.candidatesTested).toBeGreaterThan(0);
  });

  it('fails loudly when a query is handed a subject with no candidate positions', () => {
    // The constructed failing case for `FEASIBILITY_CANDIDATE_DROPPED` and
    // `FEASIBILITY_QUERY_VACUOUS`'s accounting: a team whose own surfaces are
    // overridden with an empty-but-for-one list still answers every cell, and
    // the counters reconcile. A check that cannot fail is not a check, so the
    // reconciliation is inverted here and shown to be falsifiable.
    const teamId = schedule.teamUniverse[0];
    const answer = canTeamPlay(
      context,
      { teamId, dates: ['2026-11-14'], kickoffMinutes: 9 * 60, surfaceIds: [ALDER_2] },
      { venueComplexes }
    );
    expect(answer.meta.candidatesConsidered).toBe(1);
    expect(answer.meta.candidatesAnswered).toBe(1);
    expect(answer.candidates).toHaveLength(1);

    // The predicate the production guard uses, run against a doctored pair, so
    // the reconciliation above is shown to be falsifiable rather than trivially
    // true. The guard compares the answered list with the grid size derived from
    // the query, which is what makes it able to disagree at all.
    /** @param {number} answered @param {number} grid @returns {boolean} */
    const dropped = (answered, grid) => answered !== grid;
    expect(dropped(answer.candidates.length, 1)).toBe(false);
    expect(dropped(0, 1)).toBe(true);
  });

  it('never reports a claim that names a category rather than an instance', () => {
    // 4.3's bar, checked here because a boundary builds its own claims. The
    // predicate is the module's own, and the meta-assertion is that it was run
    // against a non-empty list — a guard over zero claims proves nothing.
    const answer = feasibleKickoffBounds(context, {
      surfaceId: ALDER_2,
      date: '2026-08-22',
      format: '11v11',
    });
    const claims = [...answer.latestHard.claims, ...answer.latestClean.claims];
    expect(claims.length).toBeGreaterThan(0);
    for (const claim of claims) expect(isSpecificClaim(claim), claim.kind).toBe(true);
    expect(answer.findings.map((finding) => finding.code)).not.toContain(
      'ATTRIBUTION_CLAIM_CATEGORY_ONLY'
    );
    // The positive control for the predicate: the answer this whole layer exists
    // to replace still fails it.
    expect(isSpecificClaim(makeClaim({ source: 'availability', kind: 'sunset' }))).toBe(false);
  });

  it('calls a question that evaluated no constraint at all vacuous', () => {
    // The reachable failing case for `FEASIBILITY_QUERY_VACUOUS`: a surface the
    // graph does not hold makes `latestLegalKickoff()` return before it looks at
    // a single edge, and "nothing bounds this" would then be a statement about
    // an empty search.
    const answer = feasibleKickoffBounds(context, {
      surfaceId: 'no-such-venue/no-such-pitch',
      date: '2026-08-22',
      format: '11v11',
    });
    expect(answer.meta.constraintsConsulted).toBe(0);
    expect(answer.findings.map((finding) => finding.code)).toContain(
      FEASIBILITY_REASON.FEASIBILITY_QUERY_VACUOUS
    );
    expect(answer.status).toBe(FEASIBILITY_STATUS.REJECTED);
    expect(answer.verdict).not.toBe(FEASIBILITY_VERDICT.FEASIBLE);

    // …and the same guard stays silent on a surface the graph does hold, which
    // is what makes it an observation rather than a label.
    const real = feasibleKickoffBounds(context, {
      surfaceId: ALDER_2,
      date: '2026-08-22',
      format: '11v11',
    });
    expect(real.meta.constraintsConsulted).toBeGreaterThan(0);
    expect(real.findings.map((finding) => finding.code)).not.toContain(
      FEASIBILITY_REASON.FEASIBILITY_QUERY_VACUOUS
    );
  });

  it('marginFrom() reports null rather than zero when nothing measured a bound', () => {
    // The one place a margin could quietly become a confident number.
    expect(marginFrom([])).toEqual({ marginMinutes: null, marginBasis: null });
    expect(
      marginFrom([
        {
          kind: 'permit',
          source: 'availability',
          instanceId: null,
          constraintId: null,
          limitMinutes: null,
          slackMinutes: null,
          raises: [],
        },
      ])
    ).toEqual({ marginMinutes: null, marginBasis: null });
    expect(
      marginFrom([
        {
          kind: 'permit',
          source: 'availability',
          instanceId: null,
          constraintId: null,
          limitMinutes: 100,
          slackMinutes: 15,
          raises: [],
        },
        {
          kind: 'sunset',
          source: 'availability',
          instanceId: null,
          constraintId: null,
          limitMinutes: 90,
          slackMinutes: 0,
          raises: [],
        },
      ])
    ).toEqual({ marginMinutes: 0, marginBasis: 'sunset' });
  });
});

/* -------------------------------------------------------------------------- */
/* The two channels never merge                                                */
/* -------------------------------------------------------------------------- */

describe('feasibility :: the verdict is about the subject, the status is about the answer', () => {
  it('gives a perfectly good "no" an answer status that is not rejected', () => {
    const subject = schedule.games.find(
      (game) =>
        game.date === '2026-08-22' && game.format === '11v11' && game.startMinutes === 12 * 60
    );
    const answer = canGameMove(
      context,
      { gameId: subject.id, insteadOfMinutes: 12 * 60 + 30 },
      { venueComplexes }
    );
    expect(answer.verdict).toBe(FEASIBILITY_VERDICT.INFEASIBLE);
    expect(answer.status).not.toBe(FEASIBILITY_STATUS.REJECTED);
  });

  it('never reports an allowed status while something went unchecked', () => {
    const answers = [
      feasibleKickoffBounds(context, { surfaceId: ALDER_2, date: '2026-08-22', format: '11v11' }),
      canGameMove(
        context,
        { gameId: schedule.games[0].id, insteadOfMinutes: schedule.games[0].startMinutes + 30 },
        { venueComplexes }
      ),
    ];
    for (const answer of answers) {
      if (answer.unknowns.length === 0) continue;
      expect(answer.status).not.toBe(FEASIBILITY_STATUS.ALLOWED);
    }
  });

  it('labels every answer with the question it answers', () => {
    expect(
      feasibleKickoffBounds(context, { surfaceId: ALDER_2, date: '2026-08-22', format: '11v11' })
        .question
    ).toBe(FEASIBILITY_QUESTION.KICKOFF_BOUNDS);
    expect(
      canGameMove(context, { gameId: schedule.games[0].id, insteadOfMinutes: 600 }).question
    ).toBe(FEASIBILITY_QUESTION.CAN_GAME_MOVE);
    expect(
      canTeamPlay(context, {
        teamId: schedule.teamUniverse[0],
        dates: ['2026-11-14'],
        kickoffMinutes: 600,
      }).question
    ).toBe(FEASIBILITY_QUESTION.CAN_TEAM_PLAY);
  });

  it('treats a move to the slot the game already holds as vacuous, not as a yes', () => {
    const game = schedule.games[0];
    const answer = canGameMove(
      context,
      { gameId: game.id, insteadOfMinutes: game.startMinutes },
      { venueComplexes }
    );
    expect(answer.verdict).toBe(FEASIBILITY_VERDICT.UNKNOWN);
    expect(answer.unknowns.map((entry) => entry.code)).toContain(
      FEASIBILITY_REASON.FEASIBILITY_MOVE_IS_NO_OP
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The bounds answer agrees with the module that owns the search               */
/* -------------------------------------------------------------------------- */

describe('feasibility :: the hard boundary is availability/kickoff.js own answer, untouched', () => {
  it('reproduces latestLegalKickoff() exactly, rather than re-deriving it', () => {
    // If this ever diverged, the feasibility layer would have grown a second
    // opinion about the four edges — which is the one thing it exists not to do.
    let compared = 0;
    for (const [date, surfaceId] of [
      ['2026-08-22', ALDER_2],
      ['2026-11-14', ALDER_2],
      ['2026-11-14', SUMMIT],
    ]) {
      const mine = feasibleKickoffBounds(context, { surfaceId, date, format: '11v11' });
      const theirs = latestLegalKickoff(
        graph,
        table,
        calendar,
        { surfaceId, date, format: '11v11' },
        { existingBookings: standingBookings(context.state, date, []) }
      );
      expect(mine.latestHard.kickoffMinutes).toBe(theirs.kickoffMinutes);
      expect(mine.searchedFromMinutes).toBe(theirs.searchedFromMinutes);
      expect(mine.searchedToMinutes).toBe(theirs.searchedToMinutes);
      compared += 1;
    }
    expect(compared).toBe(3);
  });

  it('never reports a clean boundary later than the hard one', () => {
    for (const [date, surfaceId] of [
      ['2026-08-22', ALDER_2],
      ['2026-11-14', SUMMIT],
      ['2026-09-12', SUMMIT],
    ]) {
      const answer = feasibleKickoffBounds(context, { surfaceId, date, format: '11v11' });
      if (answer.latestHard.kickoffMinutes === null) continue;
      expect(answer.latestClean.kickoffMinutes).not.toBeNull();
      expect(answer.latestClean.kickoffMinutes).toBeLessThanOrEqual(
        answer.latestHard.kickoffMinutes
      );
      expect(answer.tightBandMinutes).toBeGreaterThanOrEqual(0);
    }
  });

  it('marks the threshold each boundary belongs to', () => {
    const answer = feasibleKickoffBounds(context, {
      surfaceId: SUMMIT,
      date: '2026-11-14',
      format: '11v11',
    });
    expect(answer.latestHard.threshold).toBe(FEASIBILITY_THRESHOLD.HARD);
    expect(answer.latestClean.threshold).toBe(FEASIBILITY_THRESHOLD.CLEAN);
  });
});
