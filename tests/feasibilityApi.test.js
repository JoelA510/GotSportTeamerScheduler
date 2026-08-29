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
  categoryOnlyClaimFindings,
  createAttributionMeta,
  explainKickoffTime,
  isSpecificClaim,
  makeClaim,
} from '@squadlogic/core/attribution/index.js';
import {
  CONSTRAINT_SEVERITY,
  CONSTRAINT_STATUS,
  CONSTRAINT_TYPE,
  CONSTRAINT_TYPE_SEVERITY,
  SEASON_2026_CONSTRAINT_ID,
  baseSeverityOf,
  buildSeason2026ConstraintRegistry,
  effectiveSeverityTable,
  whatIfConstraintType,
} from '@squadlogic/core/constraints/index.js';
import {
  FACILITY_REASON,
  buildFacilityGraphFromSeason2026,
  buildSeason2026VenueComplexMap,
  getSurface,
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
  TRAVEL_REASON,
  TRAVEL_REASON_SEVERITY,
  evaluateCoachTravel,
  travelSeverityOf,
} from '@squadlogic/core/waivers/index.js';

import {
  FEASIBILITY_MARGIN_UNIT,
  FEASIBILITY_QUESTION,
  FEASIBILITY_REASON,
  FEASIBILITY_REASON_SEVERITY,
  FEASIBILITY_SEVERITY,
  FEASIBILITY_SEVERITY_EFFECT,
  FEASIBILITY_STATUS,
  FEASIBILITY_THRESHOLD,
  FEASIBILITY_TIGHTNESS,
  FEASIBILITY_UNKNOWN_BY_CODE,
  FEASIBILITY_VERDICT,
  FEASIBILITY_VERDICT_ORDER,
  assertBoundaryResult,
  assertFeasibilityFindings,
  blockingEvidenceOf,
  canGameMove,
  canTeamPlay,
  candidateAccountingFindings,
  createFeasibilityMeta,
  deriveFeasibilityEvidence,
  deriveFeasibilityTightness,
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
    expect(answer.tight).toBe(FEASIBILITY_TIGHTNESS.TIGHT);

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
    // The clash's own `null`, named rather than taken by position: the cell also
    // carries a footprint unknown from the placement check, and "the first one
    // in the list" would be an assertion about ordering rather than about the
    // overlap this case exists to prove.
    const fromTheClash = footprintUnknowns.filter((entry) => /not a "no clash"/.test(entry.reason));
    expect(fromTheClash.length).toBeGreaterThan(0);
    expect(fromTheClash[0].details.gameId).toBe('constructed-untimed-pair');
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

/* -------------------------------------------------------------------------- */
/* Pre-PR review of 7.1 — eight defects, each with its own falsification        */
/* -------------------------------------------------------------------------- */

/**
 * The whole corpus as a grid of bounds questions.
 *
 * 24 surfaces the schedule actually uses x 13 scheduled dates x the 6 formats
 * `game_formats.csv` declares. Derived from the corpus, never typed in, so a
 * re-dated or re-surfaced fixture moves the population rather than the
 * expectation.
 *
 * @returns {Array<{ surfaceId: string, date: string, format: string }>}
 */
function boundsCorpus() {
  const surfaces = [...new Set(schedule.games.map((game) => game.surfaceId))].sort();
  const dates = [...new Set(schedule.games.map((game) => game.date))].sort();
  /** @type {Array<{ surfaceId: string, date: string, format: string }>} */
  const out = [];
  for (const surfaceId of surfaces) {
    for (const date of dates) {
      for (const format of [...table.formatNames].sort()) out.push({ surfaceId, date, format });
    }
  }
  return out;
}

/** Every real team the schedule names, placeholders excluded. */
const realTeams = schedule.teamUniverse.filter(
  (teamId) => !schedule.placeholderLabels.includes(teamId)
);

describe('feasibility :: finding 1 — "no clean position exists" is not "not tight"', () => {
  const NINE = '9v9';

  it('has a hard bound and no clean one at all on Alder pitch 2, 08/22, 9v9', () => {
    const answer = feasibleKickoffBounds(context, {
      surfaceId: ALDER_2,
      date: '2026-08-22',
      format: NINE,
    });
    expect(answer.latestHard.kickoffMinutes).toBe(18 * 60 + 40);
    expect(answer.latestClean.kickoffMinutes).toBeNull();
    expect(answer.tightBandMinutes).toBeNull();
    expect(answer.verdict).toBe(FEASIBILITY_VERDICT.FEASIBLE);
  });

  it('and the minute-by-minute oracle agrees, so the state is a fact about the ground', () => {
    // Without this the fix below would be dressing up a search that simply
    // missed the answer. The pitch is not lined for 9v9, so `LINING_MISMATCH`
    // — a `compromise` — speaks at every legal minute of the day and there is
    // genuinely nothing clean to report.
    const answer = feasibleKickoffBounds(context, {
      surfaceId: ALDER_2,
      date: '2026-08-22',
      format: NINE,
    });
    const bookings = standingBookings(context.state, '2026-08-22', []);
    let scanned = null;
    let examined = 0;
    for (let minute = answer.searchedToMinutes; minute >= answer.searchedFromMinutes; minute -= 1) {
      examined += 1;
      const probe = probeKickoff(
        context.engines,
        {
          surfaceId: ALDER_2,
          date: '2026-08-22',
          kickoffMinutes: minute,
          format: NINE,
          ignoreBookingIds: [],
        },
        bookings,
        createFeasibilityMeta()
      );
      if (probe.findings.every((finding) => finding.severity === CONSTRAINT_SEVERITY.INFO)) {
        scanned = minute;
        break;
      }
    }
    expect(examined).toBeGreaterThan(0);
    expect(scanned).toBeNull();
  });

  it('says so in a value that cannot be read as "there is room here"', () => {
    const answer = feasibleKickoffBounds(context, {
      surfaceId: ALDER_2,
      date: '2026-08-22',
      format: NINE,
    });
    expect(answer.tight).toBe(FEASIBILITY_TIGHTNESS.NO_CLEAN_POSITION);
    expect(answer.findings.map((finding) => finding.code)).toContain(
      FEASIBILITY_REASON.FEASIBILITY_NO_CLEAN_POSITION
    );
    expect(answer.status).not.toBe(FEASIBILITY_STATUS.ALLOWED);
  });

  it('holds as a rule over the whole corpus, not just that one cell', () => {
    // **The rule, not the instance.** Every bounds answer with a hard bound
    // and no clean one must say `no-clean-position`; every one with both must
    // say `tight` or `clean` according to the band; and none may report a
    // tightness while its verdict is not `feasible`.
    let noClean = 0;
    let banded = 0;
    let judged = 0;
    for (const cell of boundsCorpus()) {
      const answer = feasibleKickoffBounds(context, cell);
      const label = `${cell.surfaceId} ${cell.date} ${cell.format}`;
      if (answer.verdict !== FEASIBILITY_VERDICT.FEASIBLE) {
        expect(answer.tight, label).toBeNull();
        continue;
      }
      judged += 1;
      if (answer.latestClean.kickoffMinutes === null) {
        noClean += 1;
        expect(answer.tight, label).toBe(FEASIBILITY_TIGHTNESS.NO_CLEAN_POSITION);
        continue;
      }
      banded += 1;
      expect(answer.tight, label).toBe(
        answer.tightBandMinutes > 0 ? FEASIBILITY_TIGHTNESS.TIGHT : FEASIBILITY_TIGHTNESS.CLEAN
      );
    }
    // Meta-assertions: both arms of the rule were exercised, and the
    // population is the one the review measured — 772 of the corpus's
    // surface-date-format combinations reach a hard bound with nothing clean
    // beneath it, and every one of them used to read as "not tight".
    expect(judged).toBeGreaterThan(0);
    expect(banded).toBeGreaterThan(0);
    expect(noClean).toBe(772);
  }, 120_000);

  it('is a named value from a frozen table, so `if (answer.tight)` cannot decide it', () => {
    expect(Object.isFrozen(FEASIBILITY_TIGHTNESS)).toBe(true);
    expect(Object.values(FEASIBILITY_TIGHTNESS).sort()).toEqual([
      'clean',
      'no-clean-position',
      'tight',
    ]);
    for (const value of Object.values(FEASIBILITY_TIGHTNESS)) expect(typeof value).toBe('string');
    // The producer refuses both shapes that make the collapse free, exactly as
    // `deriveFeasibilityVerdict()` refuses them for `blocked`.
    expect(() =>
      deriveFeasibilityTightness({
        verdict: FEASIBILITY_VERDICT.FEASIBLE,
        compromised: /** @type {any} */ (null),
        cleanBoundaryExists: true,
      })
    ).toThrow(/must be a boolean/);
    expect(() =>
      deriveFeasibilityTightness({
        verdict: FEASIBILITY_VERDICT.FEASIBLE,
        compromised: false,
        cleanBoundaryExists: /** @type {any} */ (undefined),
      })
    ).toThrow(/boolean or an explicit null/);
    // …and "nothing clean anywhere" beats "inside a stated margin", rather than
    // the two being alternatives.
    expect(
      deriveFeasibilityTightness({
        verdict: FEASIBILITY_VERDICT.FEASIBLE,
        compromised: false,
        cleanBoundaryExists: false,
      })
    ).toBe(FEASIBILITY_TIGHTNESS.NO_CLEAN_POSITION);
    expect(
      deriveFeasibilityTightness({
        verdict: FEASIBILITY_VERDICT.INFEASIBLE,
        compromised: true,
        cleanBoundaryExists: false,
      })
    ).toBeNull();
  });
});

describe('feasibility :: finding 2 — a margin’s basis names the bound it came from', () => {
  it('names the bound whose slack the margin is, not whichever was claimed first', () => {
    // The corpus's own instance: three constraints bind, the first claimed is
    // 5 minutes short and the tightest is 55 minutes short, and the answer used
    // to report the 55 under the first one's name.
    const answer = canTeamPlay(
      context,
      {
        teamId: '06GMicro01',
        dates: [...new Set(schedule.games.map((game) => game.date))].sort(),
        kickoffMinutes: 12 * 60 + 30,
      },
      { venueComplexes }
    );
    expect(answer.binding.length).toBeGreaterThan(1);
    const named = answer.binding.filter((bound) => bound.kind === answer.marginBasis);
    expect(named).toHaveLength(1);
    expect(named[0].slackMinutes).toBe(answer.marginMinutes);
    expect(answer.marginBasis).not.toBe(answer.binding[0].kind);
  });

  it('never reports a basis without a margin, on any answer shape', () => {
    // **The rule.** A basis is the name of the bound the number came from, so
    // one without the other is a claim with no source. Checked over every
    // shape rather than over the one that had the defect.
    let checked = 0;
    let withBasis = 0;
    let withoutBasis = 0;
    /** @param {{ marginMinutes: number|null, marginBasis: string|null, binding: ReadonlyArray<{ kind: string, slackMinutes: number|null }> }} answer @param {string} label */
    const assertBasis = (answer, label) => {
      checked += 1;
      expect(answer.marginBasis === null, label).toBe(answer.marginMinutes === null);
      if (answer.marginBasis === null) {
        withoutBasis += 1;
        return;
      }
      withBasis += 1;
      const source = answer.binding.filter((bound) => bound.kind === answer.marginBasis);
      expect(source.length, label).toBeGreaterThan(0);
      expect(source[0].slackMinutes, label).toBe(answer.marginMinutes);
    };

    const dates = [...new Set(schedule.games.map((game) => game.date))].sort();
    for (const teamId of realTeams) {
      const answer = canTeamPlay(
        context,
        { teamId, dates, kickoffMinutes: 18 * 60 },
        {
          venueComplexes,
        }
      );
      assertBasis(answer, `canTeamPlay ${teamId}`);
      for (const candidate of answer.candidates) {
        assertBasis(candidate, `candidate ${teamId} ${candidate.date} ${candidate.surfaceId}`);
      }
    }
    for (const game of schedule.games.slice(0, 60)) {
      assertBasis(
        canGameMove(
          context,
          { gameId: game.id, insteadOfMinutes: game.startMinutes + 30 },
          { venueComplexes }
        ),
        `canGameMove ${game.id}`
      );
    }
    for (const cell of boundsCorpus().filter((entry) => entry.format === '11v11')) {
      const answer = feasibleKickoffBounds(context, cell);
      assertBasis(answer, `bounds ${cell.surfaceId} ${cell.date}`);
      assertBasis(answer.latestHard, `hard ${cell.surfaceId} ${cell.date}`);
      assertBasis(answer.latestClean, `clean ${cell.surfaceId} ${cell.date}`);
    }
    // Meta-assertions: the sweep ran, and it saw both a stated basis and an
    // unmeasured one — a rule checked only against nulls proves nothing.
    expect(checked).toBeGreaterThan(1000);
    expect(withBasis).toBeGreaterThan(0);
    expect(withoutBasis).toBeGreaterThan(0);
  }, 120_000);
});

describe('feasibility :: finding 3 — a team asked about the slot it already holds', () => {
  const carrierOf = (/** @type {string} */ teamId) =>
    [...schedule.games]
      .filter((game) => game.homeTeamId === teamId || game.awayTeamId === teamId)
      .sort((a, b) =>
        a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)
      )[0];

  it('answers it from the standing schedule rather than shrugging', () => {
    const teamId = realTeams.find((id) => carrierOf(id) !== undefined);
    const carrier = carrierOf(/** @type {string} */ (teamId));
    const answer = canTeamPlay(
      context,
      {
        teamId,
        dates: [carrier.date],
        kickoffMinutes: carrier.startMinutes,
        surfaceIds: [carrier.surfaceId],
      },
      { venueComplexes }
    );
    expect(answer.candidates).toHaveLength(1);
    const cell = answer.candidates[0];
    expect(cell.unknowns.map((entry) => entry.code)).not.toContain(
      FEASIBILITY_REASON.FEASIBILITY_MOVE_IS_NO_OP
    );
    expect(cell.verdict).toBe(FEASIBILITY_VERDICT.FEASIBLE);
    expect(answer.verdict).toBe(FEASIBILITY_VERDICT.FEASIBLE);
    expect(answer.findings.map((finding) => finding.code)).toContain(
      FEASIBILITY_REASON.FEASIBILITY_POSITION_ALREADY_HELD
    );
  });

  it('holds for every team the schedule names', () => {
    let asked = 0;
    let measurable = 0;
    let feasible = 0;
    let unmeasurable = 0;
    for (const teamId of realTeams) {
      const carrier = carrierOf(teamId);
      if (carrier === undefined) continue;
      asked += 1;
      const answer = canTeamPlay(
        context,
        {
          teamId,
          dates: [carrier.date],
          kickoffMinutes: carrier.startMinutes,
          surfaceIds: [carrier.surfaceId],
        },
        { venueComplexes }
      );
      const cell = answer.candidates[0];
      expect(
        cell.unknowns.map((entry) => entry.code),
        teamId
      ).not.toContain(FEASIBILITY_REASON.FEASIBILITY_MOVE_IS_NO_OP);
      // **The one honest exception, stated rather than absorbed.** A carrier
      // whose format has no declared timing has no footprint (GAP-14), and
      // acceptance 5 requires that such a fixture is never called feasible
      // anywhere. Those five teams keep that answer here; every other team
      // plainly can play where it already plays.
      if (
        (formatTimingOrUnknown(table, carrier.format).occupancyMinutes?.scheduled ?? null) === null
      ) {
        unmeasurable += 1;
        expect(cell.verdict, teamId).not.toBe(FEASIBILITY_VERDICT.FEASIBLE);
        continue;
      }
      measurable += 1;
      if (cell.verdict === FEASIBILITY_VERDICT.FEASIBLE) feasible += 1;
    }
    expect(asked).toBeGreaterThan(100);
    expect(unmeasurable).toBeGreaterThan(0);
    expect(measurable).toBeGreaterThan(100);
    expect(feasible).toBe(measurable);
  }, 120_000);

  it('still refuses the move question, which really is a thing compared with itself', () => {
    // The distinction the fix rests on: *"can this game move to where it is?"*
    // is vacuous and stays vacuous. Only the team question — *"can this team
    // play where it plays?"* — has an answer, and it is the standing one.
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

describe('feasibility :: finding 4 — the subject names where the game would be', () => {
  it('pairs the destination surface with the destination venue', () => {
    const game = schedule.games.find(
      (entry) => entry.venueId === 'summit-hs' && entry.format === '11v11'
    );
    const answer = canGameMove(
      context,
      { gameId: game.id, insteadOfSurfaceId: 'riverbend/turf' },
      { venueComplexes }
    );
    expect(answer.subject.surfaceId).toBe('riverbend/turf');
    expect(answer.subject.venueId).toBe('riverbend');
    expect(answer.subject.venueId).not.toBe(game.venueId);
  });

  it('holds for every move this corpus can be asked about', () => {
    // The rule: the subject's venue is the venue of the subject's surface, on
    // every answer, or `null` when the graph does not hold that surface.
    const destinations = [ALDER_2, SUMMIT, 'riverbend/turf', 'no-such-venue/no-such-pitch'];
    let checked = 0;
    let moved = 0;
    for (const game of schedule.games.slice(0, 40)) {
      for (const surfaceId of destinations) {
        const answer = canGameMove(
          context,
          { gameId: game.id, insteadOfSurfaceId: surfaceId },
          {
            venueComplexes,
          }
        );
        checked += 1;
        const expected = getSurface(graph, answer.subject.surfaceId)?.venueId ?? null;
        expect(answer.subject.venueId, `${game.id} -> ${surfaceId}`).toBe(expected);
        if (answer.subject.venueId !== game.venueId) moved += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(moved).toBeGreaterThan(0);
  }, 120_000);
});

describe('feasibility :: finding 5 — the format a team question names is the format it judges', () => {
  const nineOnly = realTeams.find((teamId) => {
    const games = schedule.games.filter(
      (game) => game.homeTeamId === teamId || game.awayTeamId === teamId
    );
    return games.length > 0 && games.every((game) => game.format === '9v9');
  });

  it('finds a single-format team, so the case below is not vacuous', () => {
    expect(nineOnly).toBeDefined();
  });

  it('refuses a format no fixture of the team can carry, rather than judging another one', () => {
    const answer = canTeamPlay(
      context,
      { teamId: nineOnly, dates: ['2026-11-14'], kickoffMinutes: 14 * 60, format: '11v11' },
      { venueComplexes }
    );
    expect(answer.carrierGameId).toBeNull();
    expect(answer.verdict).toBe(FEASIBILITY_VERDICT.UNKNOWN);
    expect(answer.unknowns.map((entry) => entry.code)).toContain(
      FEASIBILITY_REASON.FEASIBILITY_FORMAT_UNCARRIED
    );
    // The defect in one line: the same query used to come back with a grid
    // judged as 9v9 under an 11v11 label.
    expect(answer.candidates).toHaveLength(0);
  });

  it('carries a named format on a fixture that plays it, when the team spans two', () => {
    // The corpus has no two-format team, so one is constructed as an *input* —
    // an extra fixture in the schedule — rather than reached into.
    const anchor = schedule.games.find((game) => game.format === '9v9' && game.homeTeamId !== null);
    const constructed = buildAttributionContext({
      graph,
      table,
      calendar,
      registry,
      schedule: {
        ...schedule,
        games: [
          ...schedule.games,
          { ...anchor, id: 'review-second-format', format: '7v7', date: '2026-10-03' },
        ],
      },
      verification,
      venueComplexes,
      roster,
    });
    const ambiguous = canTeamPlay(
      constructed,
      { teamId: anchor.homeTeamId, dates: ['2026-10-03'], kickoffMinutes: 10 * 60 },
      { venueComplexes }
    );
    expect(ambiguous.subject.format).toBeNull();
    expect(ambiguous.unknowns.map((entry) => entry.code)).toContain(
      FEASIBILITY_REASON.FEASIBILITY_FORMAT_UNRESOLVED
    );

    const named = canTeamPlay(
      constructed,
      {
        teamId: anchor.homeTeamId,
        dates: ['2026-10-03'],
        kickoffMinutes: 10 * 60,
        format: '7v7',
      },
      { venueComplexes }
    );
    expect(named.subject.format).toBe('7v7');
    expect(named.carrierGameId).toBe('review-second-format');
    expect(named.unknowns.map((entry) => entry.code)).not.toContain(
      FEASIBILITY_REASON.FEASIBILITY_FORMAT_UNRESOLVED
    );
  });

  it('never reports a format the grid was not judged with', () => {
    // The rule the field has to earn: a stated `subject.format` is the format
    // of the carrier fixture every cell was judged through.
    const byId = new Map(schedule.games.map((game) => [game.id, game]));
    let stated = 0;
    let refused = 0;
    for (const teamId of realTeams.slice(0, 60)) {
      for (const format of [null, '9v9', '11v11', '7v7']) {
        const answer = canTeamPlay(
          context,
          { teamId, dates: ['2026-11-14'], kickoffMinutes: 10 * 60, format },
          { venueComplexes }
        );
        const label = `${teamId} ${String(format)}`;
        if (answer.carrierGameId === null) {
          refused += 1;
          expect(answer.verdict, label).toBe(FEASIBILITY_VERDICT.UNKNOWN);
          continue;
        }
        stated += 1;
        expect(byId.get(answer.carrierGameId).format, label).toBe(
          answer.subject.format ?? byId.get(answer.carrierGameId).format
        );
        if (answer.subject.format !== null) {
          expect(byId.get(answer.carrierGameId).format, label).toBe(answer.subject.format);
        }
      }
    }
    expect(stated).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);
  }, 120_000);
});

describe('feasibility :: finding 6 — the module cannot emit a finding it cannot look up', () => {
  it('has a foreign code that would detonate, which is what the class guard is for', () => {
    // The positive control, built from 4.3's own guard over 4.3's own
    // category-only claim. This finding is what used to be pushed straight into
    // a feasibility answer's `findings`.
    const foreign = categoryOnlyClaimFindings(
      [makeClaim({ source: ATTRIBUTION_SOURCE.AVAILABILITY, kind: 'sunset' })],
      { surfaceId: ALDER_2, date: '2026-08-22' },
      createAttributionMeta()
    );
    expect(foreign).toHaveLength(1);
    expect(foreign[0].code).toBe('ATTRIBUTION_CLAIM_CATEGORY_ONLY');
    expect(() => feasibilitySeverityOf(foreign[0].code)).toThrow(/no registered severity/);
    expect(() => assertFeasibilityFindings(foreign, 'a constructed answer')).toThrow(
      /no registered severity/
    );
    // …and a registered code carrying the wrong severity is refused too, so the
    // guard is about the table rather than about the key.
    expect(() =>
      assertFeasibilityFindings([
        {
          code: FEASIBILITY_REASON.FEASIBILITY_TIGHT,
          severity: FEASIBILITY_SEVERITY.BLOCKING,
          message: 'mislabelled',
          details: {},
        },
      ])
    ).toThrow(/frozen table registers it/);
  });

  it('translates the category-only guard into its own vocabulary', () => {
    expect(Object.keys(FEASIBILITY_REASON_SEVERITY)).toContain(
      FEASIBILITY_REASON.FEASIBILITY_CLAIM_CATEGORY_ONLY
    );
    expect(feasibilitySeverityOf(FEASIBILITY_REASON.FEASIBILITY_CLAIM_CATEGORY_ONLY)).toBe(
      FEASIBILITY_SEVERITY.BLOCKING
    );
  });

  it('looks up every finding of every answer this corpus produces', () => {
    // **The class, over real output.** Not a list of codes written here: every
    // finding of every answer of all three shapes is resolved against the
    // frozen table, and the severity it carries must be the one registered.
    let findings = 0;
    /** @type {Set<string>} */
    const codes = new Set();
    /** @param {{ findings: ReadonlyArray<import('@squadlogic/core/feasibility/types.js').FeasibilityFinding> }} answer */
    const audit = (answer) => {
      assertFeasibilityFindings(answer.findings);
      findings += answer.findings.length;
      for (const finding of answer.findings) codes.add(finding.code);
    };
    for (const cell of boundsCorpus()) audit(feasibleKickoffBounds(context, cell));
    for (const game of schedule.games.slice(0, 40)) {
      audit(
        canGameMove(
          context,
          { gameId: game.id, insteadOfMinutes: game.startMinutes + 30 },
          { venueComplexes }
        )
      );
    }
    audit(canGameMove(context, { gameId: 'no-such-game' }, { venueComplexes }));
    for (const teamId of realTeams.slice(0, 20)) {
      audit(
        canTeamPlay(
          context,
          { teamId, dates: ['2026-11-14'], kickoffMinutes: 18 * 60 },
          {
            venueComplexes,
          }
        )
      );
    }
    // Meta-assertions: an audit over an empty list, or over one code, would
    // pass while proving nothing.
    expect(findings).toBeGreaterThan(5000);
    expect(codes.size).toBeGreaterThanOrEqual(6);
  }, 120_000);
});

describe('feasibility :: finding 7 — every candidate considered is a candidate answered', () => {
  it('accounts for the candidate even when the subject is not in the run', () => {
    const answer = canGameMove(context, { gameId: 'no-such-game' }, { venueComplexes });
    expect(answer.meta.candidatesConsidered).toBe(1);
    expect(answer.meta.candidatesAnswered).toBe(answer.meta.candidatesConsidered);
    expect(answer.findings.map((finding) => finding.code)).not.toContain(
      FEASIBILITY_REASON.FEASIBILITY_CANDIDATE_DROPPED
    );
    // A good answer to a bad question is not a broken answer.
    expect(answer.verdict).toBe(FEASIBILITY_VERDICT.UNKNOWN);
    expect(answer.status).not.toBe(FEASIBILITY_STATUS.REJECTED);
  });

  it('has a guard that can fail, shown by constructing the ledger it reads', () => {
    // **Constructed rather than asserted.** The production guard is this
    // function, called from `seal()`; here it is handed a ledger that does not
    // balance and is shown to say so.
    const balanced = createFeasibilityMeta();
    balanced.candidatesConsidered = 3;
    balanced.candidatesAnswered = 3;
    expect(candidateAccountingFindings(balanced, { question: 'test' })).toEqual([]);

    const short = createFeasibilityMeta();
    short.candidatesConsidered = 3;
    short.candidatesAnswered = 2;
    const raised = candidateAccountingFindings(short, { question: 'test' });
    expect(raised).toHaveLength(1);
    expect(raised[0].code).toBe(FEASIBILITY_REASON.FEASIBILITY_CANDIDATE_DROPPED);
    expect(raised[0].severity).toBe(FEASIBILITY_SEVERITY.BLOCKING);
    expect(raised[0].details.candidatesConsidered).toBe(3);
    expect(raised[0].details.candidatesAnswered).toBe(2);
  });

  it('balances on every answer of every shape', () => {
    let checked = 0;
    /** @param {{ meta: { candidatesConsidered: number, candidatesAnswered: number }, findings: ReadonlyArray<{ code: string }> }} answer @param {string} label */
    const balances = (answer, label) => {
      checked += 1;
      expect(answer.meta.candidatesAnswered, label).toBe(answer.meta.candidatesConsidered);
      expect(
        answer.findings.map((finding) => finding.code),
        label
      ).not.toContain(FEASIBILITY_REASON.FEASIBILITY_CANDIDATE_DROPPED);
    };
    for (const cell of boundsCorpus().filter((entry) => entry.format === '9v9')) {
      balances(feasibleKickoffBounds(context, cell), `bounds ${cell.surfaceId} ${cell.date}`);
    }
    for (const game of schedule.games.slice(0, 40)) {
      balances(
        canGameMove(
          context,
          { gameId: game.id, insteadOfMinutes: game.startMinutes + 30 },
          { venueComplexes }
        ),
        `move ${game.id}`
      );
    }
    balances(
      canGameMove(context, { gameId: 'no-such-game' }, { venueComplexes }),
      'move of a game nothing holds'
    );
    for (const teamId of [...realTeams.slice(0, 20), schedule.placeholderLabels[0]]) {
      balances(
        canTeamPlay(
          context,
          { teamId, dates: ['2026-11-14'], kickoffMinutes: 18 * 60 },
          {
            venueComplexes,
          }
        ),
        `team ${teamId}`
      );
    }
    expect(checked).toBeGreaterThan(100);
  }, 120_000);
});

describe('feasibility :: finding 8 — the unknown counter counts each unknown once', () => {
  const november = [...new Set(schedule.games.map((game) => game.date))]
    .filter((date) => date.startsWith(`${SEASON_YEAR}-11-`))
    .sort();
  const nineTeam = schedule.teamUniverse.find((id) =>
    schedule.games.some((game) => game.homeTeamId === id && game.format === '9v9')
  );

  it('counts the grid’s unknowns once, not once per cell and again in the roll-up', () => {
    const answer = canTeamPlay(
      context,
      { teamId: nineTeam, dates: november, kickoffMinutes: 18 * 60 },
      { venueComplexes }
    );
    const perCell = answer.candidates.reduce(
      (total, candidate) => total + candidate.unknowns.length,
      0
    );
    // Meta-assertions first: a roll-up carrying no unknowns, or cells carrying
    // none, would make the comparison below true of nothing.
    expect(perCell).toBeGreaterThan(0);
    expect(answer.unknowns.length).toBeGreaterThan(0);
    expect(answer.meta.unknownsRaised).toBe(perCell);
    expect(answer.meta.unknownsRaised).not.toBe(perCell + answer.unknowns.length);
  });

  it('counts a single-answer query’s unknowns exactly once', () => {
    const move = canGameMove(
      context,
      { gameId: schedule.games[0].id, insteadOfMinutes: schedule.games[0].startMinutes + 30 },
      { venueComplexes }
    );
    expect(move.unknowns.length).toBeGreaterThan(0);
    expect(move.meta.unknownsRaised).toBe(move.unknowns.length);

    const bounds = feasibleKickoffBounds(context, {
      surfaceId: ALDER_2,
      date: '2026-08-22',
      format: '11v11',
    });
    expect(bounds.unknowns.length).toBeGreaterThan(0);
    expect(bounds.meta.unknownsRaised).toBe(bounds.unknowns.length);
  });

  it('does not write into the counters of the answer it is handed', () => {
    // The same query twice must produce the same ledger; a seal that added to
    // the meta it was given would make the second run disagree with the first
    // as soon as anything reused a meta.
    const once = canTeamPlay(
      context,
      { teamId: nineTeam, dates: november, kickoffMinutes: 18 * 60 },
      { venueComplexes }
    );
    const twice = canTeamPlay(
      context,
      { teamId: nineTeam, dates: november, kickoffMinutes: 18 * 60 },
      { venueComplexes }
    );
    expect(twice.meta).toEqual(once.meta);
  });
});

/* -------------------------------------------------------------------------- */
/* Second pre-PR review of 7.1 — the first round's own fixes, reviewed          */
/* -------------------------------------------------------------------------- */

/**
 * The claims on a blocker list carrying one severity.
 *
 * Read off the claim rather than re-derived: severity is the owning module's
 * word, and a second opinion here would be free to disagree with the one the
 * answer is carrying. Taking the severity as an argument rather than naming one
 * is the point — round three's rule is asserted at every level, and a helper
 * that knew only about `blocking` is how the previous round's rule came to
 * cover only `blocking`.
 *
 * @param {ReadonlyArray<{ severity: string, codes: ReadonlyArray<string> }>} blockers
 * @param {string} severity
 * @returns {Array<{ severity: string, codes: ReadonlyArray<string> }>}
 */
function claimsAtSeverity(blockers, severity) {
  return blockers.filter((claim) => claim.severity === severity);
}

/**
 * The claims on a blocker list that their own owner marked `blocking`.
 *
 * @param {ReadonlyArray<{ severity: string, codes: ReadonlyArray<string> }>} blockers
 * @returns {Array<{ severity: string, codes: ReadonlyArray<string> }>}
 */
function blockingClaimsIn(blockers) {
  return claimsAtSeverity(blockers, CONSTRAINT_SEVERITY.BLOCKING);
}

describe('feasibility :: round 2, finding 1 — a blocking blocker is never a feasible answer', () => {
  /**
   * One standing position, asked the way `canTeamPlay()`'s grid asks it:
   * *"is this position legal"*, answered from the standing schedule rather
   * than refused as a comparison between a thing and itself.
   *
   * @param {{ id: string, date: string, surfaceId: string, startMinutes: number }} game
   */
  const standing = (game) =>
    canGameMove(
      context,
      {
        gameId: game.id,
        insteadOfDate: game.date,
        insteadOfSurfaceId: game.surfaceId,
        insteadOfMinutes: game.startMinutes,
      },
      { venueComplexes, minimalSet: false, standingPositionIsAnAnswer: true }
    );

  it('refuses the four standing positions that sealed as feasible while blocked', () => {
    // The reviewer's own four. `explainGame()` merges the rule engine's
    // violation claims into `claims` and takes `legal` from facility legality
    // alone, so a position carrying a blocking `TRAVEL_COMMITMENTS_OVERLAP`
    // sealed as `feasible` / `clean`: the blockers said no and the verdict
    // said yes, from one answer.
    const relayed = [534, 548, 564, 575].map((n) => `combined_schedule.csv#${n}`);
    for (const gameId of relayed) {
      const game = schedule.games.find((entry) => entry.id === gameId);
      // Meta-assertions: a game this corpus no longer holds, or one that
      // stopped carrying the claim, would make the verdict assertion below a
      // statement about nothing.
      expect(game, gameId).toBeDefined();
      const answer = standing(/** @type {any} */ (game));
      const blocking = blockingClaimsIn(answer.blockers);
      expect(
        blocking.flatMap((claim) => claim.codes),
        gameId
      ).toContain(TRAVEL_REASON.TRAVEL_COMMITMENTS_OVERLAP);
      expect(answer.verdict, gameId).toBe(FEASIBILITY_VERDICT.INFEASIBLE);
      expect(answer.tight, gameId).toBeNull();
    }
  });

  it('holds at every severity a blocker can carry, over every answer this corpus produces', () => {
    // **The rule, not the instance — and every severity, not one of them.**
    // Round two derived `blocked` from the published blockers and left
    // `compromised` on the facility layer's own status, so this same sweep
    // passed while `combined_schedule.csv#7` and `#18` sealed `feasible` /
    // `clean` carrying a compromise-severity TRAVEL_BETWEEN_VENUES_TOO_SHORT.
    // A rule written about one severity is a rule that cannot notice the next
    // one, so the whole table is asserted here: each severity a published
    // blocker can carry has one declared effect on the answer that publishes
    // it, and each is checked over the same four sweeps.
    /**
     * @type {Record<string, { says: string,
     *   holds: (answer: { verdict: string, tight: string|null }) => boolean }>}
     */
    const EFFECT = {
      [CONSTRAINT_SEVERITY.BLOCKING]: {
        says: 'a blocking blocker makes the verdict infeasible',
        holds: (answer) => answer.verdict === FEASIBILITY_VERDICT.INFEASIBLE,
      },
      [CONSTRAINT_SEVERITY.COMPROMISE]: {
        says: 'a compromise blocker means the answer is never clean',
        holds: (answer) => answer.tight !== FEASIBILITY_TIGHTNESS.CLEAN,
      },
      [CONSTRAINT_SEVERITY.INFO]: {
        says: 'an info blocker moves neither the verdict nor the tightness',
        holds: () => true,
      },
    };
    // Meta-assertion: a severity with no row above is a severity this rule
    // silently does not cover, which is the defect restated as a test.
    expect(Object.keys(EFFECT).sort()).toEqual(Object.values(CONSTRAINT_SEVERITY).sort());

    /** @type {string[]} */
    const offenders = [];
    /**
     * @type {Record<string, Record<string,
     *   { checked: number, carrying: number, onlyInfo: number, onlyInfoClean: number }>>}
     */
    const arms = {};
    /**
     * @param {string} arm
     * @param {string} label
     * @param {{ verdict: string, tight: string|null }} answer
     * @param {ReadonlyArray<{ severity: string, codes: ReadonlyArray<string> }>} blockers
     */
    const rule = (arm, label, answer, blockers) => {
      const tally = (arms[arm] ??= {});
      const above = blockers.filter((claim) => claim.severity !== CONSTRAINT_SEVERITY.INFO);
      for (const [severity, effect] of Object.entries(EFFECT)) {
        const seen = (tally[severity] ??= {
          checked: 0,
          carrying: 0,
          onlyInfo: 0,
          onlyInfoClean: 0,
        });
        seen.checked += 1;
        const carried = claimsAtSeverity(blockers, severity);
        if (carried.length === 0) continue;
        seen.carrying += 1;
        // The positive control for the row that must do nothing: an answer
        // whose blockers are info and nothing else is exactly the answer that
        // is allowed to read `clean`. Without it, "info moves nothing" would
        // be a rule no observation could fail.
        if (severity === CONSTRAINT_SEVERITY.INFO && above.length === 0) {
          seen.onlyInfo += 1;
          if (answer.tight === FEASIBILITY_TIGHTNESS.CLEAN) seen.onlyInfoClean += 1;
        }
        if (effect.holds(answer)) continue;
        offenders.push(
          `${label}: verdict "${answer.verdict}", tight ${JSON.stringify(answer.tight)}, carrying ` +
            `${severity} ${[...new Set(carried.flatMap((claim) => claim.codes))].sort().join(', ')} — ` +
            effect.says
        );
      }
    };

    for (const game of schedule.games) {
      const held = standing(game);
      rule('standing', `standing ${game.id}`, held, held.blockers);
      const moved = canGameMove(
        context,
        { gameId: game.id, insteadOfMinutes: game.startMinutes + 60 },
        { venueComplexes, minimalSet: false }
      );
      rule('moved', `move ${game.id} +60`, moved, moved.blockers);
      for (const teamId of [game.homeTeamId, game.awayTeamId]) {
        if (teamId === null || schedule.placeholderLabels.includes(teamId)) continue;
        const team = canTeamPlay(
          context,
          {
            teamId,
            dates: [game.date],
            kickoffMinutes: game.startMinutes,
            surfaceIds: [game.surfaceId],
          },
          { venueComplexes }
        );
        for (const candidate of team.candidates) {
          rule(
            'teamCell',
            `team ${teamId} ${candidate.date} ${candidate.surfaceId}`,
            candidate,
            candidate.blockers
          );
        }
      }
    }
    for (const cell of boundsCorpus()) {
      const answer = feasibleKickoffBounds(context, cell);
      // A bounds answer's blockers are its hard boundary's claims — the list
      // `seal()` is handed; the public shape names them on the boundary.
      rule(
        'bounds',
        `bounds ${cell.surfaceId} ${cell.date} ${cell.format}`,
        answer,
        answer.latestHard.claims
      );
    }

    expect(offenders).toEqual([]);
    // Meta-assertions. The three arms that judge a *position* must each have
    // actually seen answers carrying a blocking blocker, or the rule above
    // matched zero records and passed silently.
    expect(arms.standing[CONSTRAINT_SEVERITY.BLOCKING].checked).toBe(schedule.games.length);
    expect(arms.moved[CONSTRAINT_SEVERITY.BLOCKING].checked).toBe(schedule.games.length);
    expect(arms.teamCell[CONSTRAINT_SEVERITY.BLOCKING].checked).toBeGreaterThan(1000);
    expect(arms.bounds[CONSTRAINT_SEVERITY.BLOCKING].checked).toBe(boundsCorpus().length);
    // **Per arm and per severity.** Every arm must have seen a real answer at
    // every level, or that cell of the table is a rule matched against nothing.
    // The bounds arm carrying a *blocking* blocker is not obvious: `latestHard`
    // is the last minute at which nothing blocking speaks, so a bounded answer
    // never carries one. The six that do are Summit HS on the blacked-out
    // 09/19, where there is no hard bound at all — `PERMIT_BLACKOUT` speaks at
    // every minute, `kickoffMinutes` is null and the verdict is `infeasible`.
    // Exactly the shape the rule is about, arrived at from the other side.
    for (const arm of ['standing', 'moved', 'teamCell', 'bounds']) {
      for (const severity of Object.keys(EFFECT)) {
        expect(arms[arm][severity].carrying, `${arm} / ${severity}`).toBeGreaterThan(0);
      }
      expect(
        arms[arm][CONSTRAINT_SEVERITY.INFO].onlyInfoClean,
        `${arm} / info-only answers that read clean`
      ).toBeGreaterThan(0);
    }
  }, 180_000);
});

describe('feasibility :: round 2, finding 4 — a boundary that does not exist carries nothing', () => {
  it('does not walk the hard result a second time when there is no clean boundary', () => {
    const answer = feasibleKickoffBounds(context, {
      surfaceId: ALDER_2,
      date: '2026-08-22',
      format: '9v9',
    });
    // Meta-assertions: this must still be the cell the defect is about — a
    // real hard bound, no clean one, and a non-empty claim list at the hard
    // bound for a duplicate to be visible in.
    expect(answer.latestHard.kickoffMinutes).not.toBeNull();
    expect(answer.latestClean.kickoffMinutes).toBeNull();
    expect(answer.latestHard.claims.length).toBeGreaterThan(0);
    // There is no clean boundary, so nothing is carried under its name…
    expect(answer.latestClean.claims).toEqual([]);
    expect(answer.latestClean.notApplicable).toEqual([]);
    // …and the counter that proves this answer looked at something counts the
    // hard boundary's claims once rather than twice.
    expect(answer.meta.claimsCarried).toBe(answer.latestHard.claims.length);
  });

  it('still carries both boundaries where both exist', () => {
    const answer = feasibleKickoffBounds(context, {
      surfaceId: ALDER_2,
      date: '2026-08-22',
      format: '11v11',
    });
    expect(answer.latestClean.kickoffMinutes).not.toBeNull();
    expect(answer.latestClean.claims.length).toBeGreaterThan(0);
    expect(answer.meta.claimsCarried).toBe(
      answer.latestHard.claims.length + answer.latestClean.claims.length
    );
  });

  it('holds over the corpus, so no cell counts one claim as two', () => {
    let withoutClean = 0;
    let withClean = 0;
    for (const cell of boundsCorpus()) {
      const answer = feasibleKickoffBounds(context, cell);
      const label = `${cell.surfaceId} ${cell.date} ${cell.format}`;
      if (answer.latestClean.kickoffMinutes === null) {
        withoutClean += 1;
        expect(answer.latestClean.claims, label).toEqual([]);
        expect(answer.meta.claimsCarried, label).toBe(answer.latestHard.claims.length);
        continue;
      }
      withClean += 1;
      expect(answer.meta.claimsCarried, label).toBe(
        answer.latestHard.claims.length + answer.latestClean.claims.length
      );
    }
    // Meta-assertions: both arms were exercised. A sweep that saw only cells
    // with a clean boundary would never reach the branch this is about.
    expect(withoutClean).toBeGreaterThan(0);
    expect(withClean).toBeGreaterThan(0);
  }, 120_000);
});

/* -------------------------------------------------------------------------- */
/* Third pre-PR review of 7.1 — one derivation, for every severity              */
/* -------------------------------------------------------------------------- */

/**
 * One standing position, asked the way `canTeamPlay()`'s grid asks it, with the
 * minimal blocking set left at its default.
 *
 * The default is the point for round three's finding 2: the round-two sweep
 * passes `minimalSet: false` and therefore never sees the answer an operator
 * actually gets.
 *
 * @param {{ id: string, date: string, surfaceId: string, startMinutes: number }} game
 * @returns {import('@squadlogic/core/feasibility/types.js').FeasibilityAnswer}
 */
function standingAnswer(game) {
  return canGameMove(
    context,
    {
      gameId: game.id,
      insteadOfDate: game.date,
      insteadOfSurfaceId: game.surfaceId,
      insteadOfMinutes: game.startMinutes,
    },
    { venueComplexes, standingPositionIsAnAnswer: true }
  );
}

describe('feasibility :: round 3, finding 1 — the derivation reads every severity', () => {
  it('refuses to call the two standing positions clean while they publish a compromise blocker', () => {
    // The reviewer's own two. `blocked` was derived from the merged blockers in
    // round two and `compromised` was left on `checkPlacement()`'s facility
    // status, so a position carrying a compromise-severity
    // TRAVEL_BETWEEN_VENUES_TOO_SHORT sealed `feasible` / `clean`: the blockers
    // said "worse than it looks" and the answer said "there is room here".
    for (const gameId of ['combined_schedule.csv#7', 'combined_schedule.csv#18']) {
      const game = schedule.games.find((entry) => entry.id === gameId);
      // Meta-assertions: a game this corpus no longer holds, or one that
      // stopped carrying the claim, would make the assertion below a statement
      // about nothing.
      expect(game, gameId).toBeDefined();
      const answer = standingAnswer(/** @type {any} */ (game));
      const compromise = claimsAtSeverity(answer.blockers, CONSTRAINT_SEVERITY.COMPROMISE);
      expect(
        compromise.flatMap((claim) => claim.codes),
        gameId
      ).toContain(TRAVEL_REASON.TRAVEL_BETWEEN_VENUES_TOO_SHORT);
      expect(answer.verdict, gameId).toBe(FEASIBILITY_VERDICT.FEASIBLE);
      expect(answer.tight, gameId).toBe(FEASIBILITY_TIGHTNESS.TIGHT);
    }
  });

  it('reads one frozen table, with a row for every member of the severity enum', () => {
    // **The reason this is a class rather than an instance.** Round two fixed
    // `blocking` with a line at a call site; the same defect one severity down
    // survived it. So the mapping from a severity to what it does is a table,
    // every member of the enum has a row, and `deriveFeasibilityEvidence()` is
    // the only reader — a severity added to `CONSTRAINT_SEVERITY` without a row
    // fails here rather than deciding nothing in silence.
    expect(Object.isFrozen(FEASIBILITY_SEVERITY_EFFECT)).toBe(true);
    expect(Object.keys(FEASIBILITY_SEVERITY_EFFECT).sort()).toEqual(
      Object.values(FEASIBILITY_SEVERITY).sort()
    );
    expect(deriveFeasibilityEvidence([])).toEqual({ blocked: false, compromised: false });
    expect(deriveFeasibilityEvidence([{ severity: FEASIBILITY_SEVERITY.BLOCKING }])).toEqual({
      blocked: true,
      compromised: false,
    });
    expect(deriveFeasibilityEvidence([{ severity: FEASIBILITY_SEVERITY.COMPROMISE }])).toEqual({
      blocked: false,
      compromised: true,
    });
    expect(deriveFeasibilityEvidence([{ severity: FEASIBILITY_SEVERITY.INFO }])).toEqual({
      blocked: false,
      compromised: false,
    });
    // A severity nobody registered decides nothing by default — it throws, in
    // the same discipline `feasibilitySeverityOf()` refuses an unknown code.
    expect(() => deriveFeasibilityEvidence([{ severity: 'severe-ish' }])).toThrow(
      /does not register/
    );
    // …and neither shape that makes the collapse free in JavaScript is accepted.
    expect(() => deriveFeasibilityEvidence(/** @type {any} */ (true))).toThrow(/never a boolean/);
    // Inherited keys are not rows: a claim whose severity is "toString" is an
    // unregistered severity like any other.
    expect(() => deriveFeasibilityEvidence([{ severity: 'toString' }])).toThrow(
      /does not register/
    );
  });

  it('lost nothing the facility layer used to decide on its own', () => {
    // **The no-weakening control.** The derivation used to read two flags
    // `checkPlacement()` owns — `legal` and `placementStatus` — and now reads
    // only the evidence the answer publishes. That is a narrowing, so it has to
    // be shown to lose nothing: every position the facility layer called
    // illegal is still `infeasible`, and every one it called compromised is
    // still not `clean`, because both facts are published as claims before they
    // are derived from.
    let illegal = 0;
    let compromised = 0;
    for (const game of schedule.games) {
      const time = explainKickoffTime(context, {
        gameId: game.id,
        insteadOfDate: game.date,
        insteadOfSurfaceId: game.surfaceId,
        insteadOfMinutes: game.startMinutes,
      });
      const facility = time.current;
      if (facility === null) continue;
      if (facility.legal !== false && facility.placementStatus !== CONSTRAINT_STATUS.COMPROMISED) {
        continue;
      }
      const answer = standingAnswer(game);
      if (facility.legal === false) {
        illegal += 1;
        expect(answer.verdict, game.id).toBe(FEASIBILITY_VERDICT.INFEASIBLE);
      }
      if (facility.placementStatus === CONSTRAINT_STATUS.COMPROMISED) {
        compromised += 1;
        expect(answer.tight, game.id).not.toBe(FEASIBILITY_TIGHTNESS.CLEAN);
      }
    }
    // Meta-assertions: both arms saw real positions. A corpus where the
    // facility layer never refused anything would make this control vacuous.
    expect(illegal).toBeGreaterThan(0);
    expect(compromised).toBeGreaterThan(0);
  }, 120_000);
});

describe('feasibility :: round 3, finding 2 — an answer never denies its own verdict', () => {
  it('says which layer blocked the standing positions the facility layer did not', () => {
    // With `minimalSet` at its default these four came back `infeasible`
    // alongside `minimalSet.blocked === false` and
    // ATTRIBUTION_PLACEMENT_NOT_BLOCKED — "no set of constraints blocks it"
    // printed beside "infeasible". The information is kept, because a blocked
    // answer with no *facility* explanation is worth saying; what changes is
    // that the answer now says which layer did decide.
    for (const n of [534, 548, 564, 575]) {
      const gameId = `combined_schedule.csv#${n}`;
      const game = schedule.games.find((entry) => entry.id === gameId);
      expect(game, gameId).toBeDefined();
      const answer = standingAnswer(/** @type {any} */ (game));
      expect(answer.verdict, gameId).toBe(FEASIBILITY_VERDICT.INFEASIBLE);
      // Meta-assertion: the minimal set is still asked for and still denies,
      // or the case below is about a shape that no longer occurs.
      expect(answer.minimalSet, gameId).not.toBeNull();
      expect(answer.minimalSet.blocked, gameId).toBe(false);
      const said = answer.findings.filter(
        (finding) => finding.code === FEASIBILITY_REASON.FEASIBILITY_BLOCKED_OUTSIDE_FACILITY
      );
      expect(said, gameId).toHaveLength(1);
      expect(said[0].details.sources, gameId).toContain(ATTRIBUTION_SOURCE.RULE_ENGINE);
      expect(said[0].details.codes, gameId).toContain(TRAVEL_REASON.TRAVEL_COMMITMENTS_OVERLAP);
    }
  });

  it('holds as a rule: no answer carries a verdict and a minimal-set claim that disagree', () => {
    /** @type {string[]} */
    const offenders = [];
    let denying = 0;
    let agreeing = 0;
    let absent = 0;
    /**
     * @param {string} label
     * @param {import('@squadlogic/core/feasibility/types.js').FeasibilityAnswer} answer
     */
    const rule = (label, answer) => {
      if (answer.minimalSet === null) {
        absent += 1;
        // A minimal set is only asked for when the answer is blocked, so its
        // absence must never sit beside an `infeasible` verdict either.
        if (answer.verdict === FEASIBILITY_VERDICT.INFEASIBLE) {
          offenders.push(`${label}: infeasible with no minimal set at all`);
        }
        return;
      }
      if (answer.minimalSet.blocked === true) {
        agreeing += 1;
        if (answer.verdict !== FEASIBILITY_VERDICT.INFEASIBLE) {
          offenders.push(`${label}: minimal set blocks it but the verdict is "${answer.verdict}"`);
        }
        // …and an answer whose facility layer *did* block it must not claim
        // the explanation came from somewhere else.
        if (
          answer.findings.some(
            (finding) => finding.code === FEASIBILITY_REASON.FEASIBILITY_BLOCKED_OUTSIDE_FACILITY
          )
        ) {
          offenders.push(`${label}: the facility layer blocked it and the answer says it did not`);
        }
        return;
      }
      denying += 1;
      if (answer.verdict !== FEASIBILITY_VERDICT.INFEASIBLE) {
        offenders.push(
          `${label}: minimal set denies blocking beside a verdict of "${answer.verdict}"`
        );
        return;
      }
      const said = answer.findings.filter(
        (finding) => finding.code === FEASIBILITY_REASON.FEASIBILITY_BLOCKED_OUTSIDE_FACILITY
      );
      if (said.length !== 1) {
        offenders.push(
          `${label}: infeasible beside "no set of constraints blocks it", with ${said.length} finding(s) saying which layer did`
        );
        return;
      }
      const sources = /** @type {string[]} */ (said[0].details.sources ?? []);
      if (sources.length === 0) {
        offenders.push(`${label}: named no layer at all`);
      }
    };

    for (const game of schedule.games) {
      rule(`standing ${game.id}`, standingAnswer(game));
      rule(
        `move ${game.id} +60`,
        canGameMove(
          context,
          { gameId: game.id, insteadOfMinutes: game.startMinutes + 60 },
          { venueComplexes }
        )
      );
    }

    expect(offenders).toEqual([]);
    // Meta-assertions: both arms of the rule were exercised. A sweep that saw
    // no denying minimal set would never reach the branch this is about, and
    // one that saw no agreeing set would not have exercised the ordinary case
    // the denial is measured against.
    expect(denying).toBeGreaterThan(0);
    expect(agreeing).toBeGreaterThan(0);
    expect(absent).toBeGreaterThan(0);
  }, 120_000);
});

describe('feasibility :: round 3, finding 3 — a boundary describes its own position', () => {
  it('keeps the claim that explains why the 09/19 hard boundary does not exist', () => {
    // **The contract was wrong, not the code.** `types.js` declared that a
    // boundary with no position carries no claims. It never has: the whole date
    // is blacked out, so there is no hard bound *and* there is a permit record
    // that says why. That claim is the answer to "why is there no boundary
    // here?", and the reachability driver and acceptance 4 both read it as one.
    const answer = feasibleKickoffBounds(context, {
      surfaceId: SUMMIT,
      date: '2026-09-19',
      format: '11v11',
    });
    expect(answer.latestHard.kickoffMinutes).toBeNull();
    expect(answer.latestHard.binding).toEqual([]);
    expect(answer.latestHard.marginMinutes).toBeNull();
    expect(answer.latestHard.claims).toHaveLength(1);
    expect(answer.latestHard.claims[0].codes).toContain(AVAILABILITY_REASON.PERMIT_BLACKOUT);
    // …and it is a claim about a real record, not a category, which is the
    // difference between an explanation and a shrug.
    expect(isSpecificClaim(answer.latestHard.claims[0])).toBe(true);
  });

  it('refuses a boundary built from a result about a different minute', () => {
    // **The falsification.** The rule that replaces the old contract is
    // enforced where a boundary is built, so it has to be shown to bite. This
    // is round two's finding 4 reconstructed exactly: Alder pitch 2 on 08/22 at
    // 9v9 has a hard bound and no clean one, and the clean boundary was once
    // built from the *hard* result — a position no minute of the day offers,
    // described in another minute's constraints.
    const hardResult = latestLegalKickoff(
      graph,
      table,
      calendar,
      { surfaceId: ALDER_2, date: '2026-08-22', format: '9v9' },
      { existingBookings: standingBookings(context.state, '2026-08-22', []) }
    );
    // Meta-assertion: a result with no position of its own would make the
    // refusal below true for the wrong reason.
    expect(hardResult.kickoffMinutes).not.toBeNull();
    expect(() => assertBoundaryResult(hardResult, null, FEASIBILITY_THRESHOLD.CLEAN)).toThrow(
      /never in another minute's words/
    );
    // The two pairings that are honest both pass: the result about its own
    // position, and the absence of a result about no position at all.
    expect(
      assertBoundaryResult(hardResult, hardResult.kickoffMinutes, FEASIBILITY_THRESHOLD.HARD)
    ).toBe(hardResult);
    expect(
      assertBoundaryResult({ constraints: [], findings: [] }, null, FEASIBILITY_THRESHOLD.CLEAN)
    ).toEqual({ constraints: [], findings: [] });
  });

  it('carries the constraints of its own minute, checked against a fresh probe', () => {
    // The positive half: a positioned boundary's claims are the applicable
    // constraints at that minute, confirmed by asking `checkKickoffAvailability()`
    // again rather than by trusting the list.
    let checked = 0;
    for (const cell of [
      { surfaceId: ALDER_2, date: '2026-08-22', format: '11v11' },
      { surfaceId: SUMMIT, date: '2026-11-14', format: '11v11' },
      { surfaceId: ALDER_2, date: '2026-11-14', format: '11v11' },
    ]) {
      const answer = feasibleKickoffBounds(context, cell);
      for (const boundary of [answer.latestHard, answer.latestClean]) {
        if (boundary.kickoffMinutes === null) continue;
        checked += 1;
        const probe = probeKickoff(
          { graph, table, calendar, registry },
          {
            surfaceId: cell.surfaceId,
            date: cell.date,
            kickoffMinutes: boundary.kickoffMinutes,
            format: cell.format,
            ignoreBookingIds: [],
          },
          standingBookings(context.state, cell.date, []),
          createFeasibilityMeta()
        );
        const expected = probe.result.constraints
          .filter((constraint) => constraint.applicable)
          .map((constraint) => constraint.kind)
          .sort();
        expect(
          boundary.claims.map((claim) => claim.kind).sort(),
          `${cell.surfaceId} ${cell.date} ${boundary.threshold}`
        ).toEqual(expected);
      }
    }
    // Meta-assertion: the loop reached positioned boundaries at all.
    expect(checked).toBeGreaterThan(3);
  });

  it('holds over the corpus: a boundary with no position binds nothing and explains itself', () => {
    let explained = 0;
    let silent = 0;
    let positioned = 0;
    for (const cell of boundsCorpus()) {
      const answer = feasibleKickoffBounds(context, cell);
      const label = `${cell.surfaceId} ${cell.date} ${cell.format}`;
      for (const boundary of [answer.latestHard, answer.latestClean]) {
        if (boundary.kickoffMinutes !== null) {
          positioned += 1;
          continue;
        }
        // No position, so nothing binds at one and no margin is measurable.
        expect(boundary.binding, `${label} ${boundary.threshold}`).toEqual([]);
        expect(boundary.marginMinutes, `${label} ${boundary.threshold}`).toBeNull();
        expect(boundary.marginBasis, `${label} ${boundary.threshold}`).toBeNull();
        expect(boundary.endMinutes, `${label} ${boundary.threshold}`).toBeNull();
        if (boundary.claims.length === 0) {
          silent += 1;
          expect(boundary.notApplicable, `${label} ${boundary.threshold}`).toEqual([]);
          continue;
        }
        explained += 1;
        // Whatever it carries is an explanation of the absence: a real record,
        // with the codes that spoke, never a bare category.
        for (const claim of boundary.claims) {
          expect(isSpecificClaim(claim), `${label} ${boundary.threshold}`).toBe(true);
          expect(claim.codes.length, `${label} ${boundary.threshold}`).toBeGreaterThan(0);
        }
      }
    }
    // Meta-assertions: all three arms were exercised. A sweep that never saw a
    // boundary explaining its own absence would be asserting the old contract
    // by accident.
    expect(explained).toBeGreaterThan(0);
    expect(silent).toBeGreaterThan(0);
    expect(positioned).toBeGreaterThan(0);
  }, 120_000);
});

/* -------------------------------------------------------------------------- */
/* Fourth pre-PR review of 7.1 — one severity view, and a finding that names    */
/* its source                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * **A HARD registry record over a base-`compromise` availability code.**
 *
 * `PERMIT_MARGIN_TIGHT` is `compromise` in `availability/reasonCodes.js` — the
 * permit's fifteen minutes are a comfort — and re-severitying exactly that kind
 * of code is the registry's entire purpose (GAP-12). A club that wrote the
 * comfort margin into its permit as a condition rather than a courtesy holds
 * this record, so it is the registry used as designed and not a contrivance.
 *
 * Built through `buildSeason2026ConstraintRegistry({ extraConstraints })`, which
 * is the adapter's own public door, and validated by `ConstraintRecordSchema`
 * like every other record.
 */
const PERMIT_MARGIN_IS_HARD = Object.freeze({
  id: 'permit-margin-hard-2026',
  policy: 'permit-margin',
  name: 'The permit comfort margin is a condition of the permit here',
  type: CONSTRAINT_TYPE.HARD,
  scope: { kind: 'global' },
  parameters: { marginMinutes: 15 },
  restrictiveDirection: 'higher',
  rationale:
    'A club whose permit states the fifteen minutes as a condition rather than a courtesy holds this record; the code is the same one, at a hardness the registry decides.',
  source: {
    setBy: 'pre-PR review, round four',
    setAt: null,
    reference: 'the review finding about two severity views in one answer',
    note: 'a constructed record, carried by no season corpus and dated by nothing',
  },
  effectiveFrom: null,
  effectiveTo: null,
  enforcement: 'reason-codes',
  reasonCodes: [AVAILABILITY_REASON.PERMIT_MARGIN_TIGHT],
  weight: null,
  waivable: false,
  history: [],
});

/** The same world, under a registry that holds one more record. Built once. */
let promotedContextMemo = null;
function promotedContext() {
  if (promotedContextMemo !== null) return promotedContextMemo;
  const promotedRegistry = buildSeason2026ConstraintRegistry({
    extraConstraints: [PERMIT_MARGIN_IS_HARD],
  });
  const promotedVerification = runRuleEngine(schedule, {
    registry: promotedRegistry,
    resources: { graph, timingTable: table, calendar, venueComplexes },
  });
  promotedContextMemo = deepFreeze(
    buildAttributionContext({
      graph,
      table,
      calendar,
      registry: promotedRegistry,
      schedule,
      verification: promotedVerification,
      venueComplexes,
      roster,
    })
  );
  return promotedContextMemo;
}

describe('feasibility :: round 4, finding 1 — the bound is chosen under the view it is judged under', () => {
  it('really does promote the code, so everything below is about a live re-severity', () => {
    // **The meta-assertion the whole block rests on.** If the registry did not
    // move `PERMIT_MARGIN_TIGHT` from `compromise` to `blocking`, every
    // assertion after this would be a statement about the ordinary corpus
    // wearing a second registry's name.
    const where = {
      date: '2026-08-22',
      venueId: 'brookside-park',
      surfaceId: 'brookside-park/upper-1',
      surfaceLineage: ['brookside-park/upper-1'],
    };
    expect(baseSeverityOf(AVAILABILITY_REASON.PERMIT_MARGIN_TIGHT)).toBe(
      CONSTRAINT_SEVERITY.COMPROMISE
    );
    // Nothing in the shipped season governs it, which is why this is latent.
    expect(
      effectiveSeverityTable(registry, where).severityByCode[
        AVAILABILITY_REASON.PERMIT_MARGIN_TIGHT
      ]
    ).toBeUndefined();
    expect(
      effectiveSeverityTable(promotedContext().engines.registry, where).severityByCode[
        AVAILABILITY_REASON.PERMIT_MARGIN_TIGHT
      ]
    ).toBe(CONSTRAINT_SEVERITY.BLOCKING);
  });

  it('never names a boundary it calls infeasible, under either registry', () => {
    /** @type {string[]} */
    const offenders = [];
    let promotedInfeasible = 0;
    let promotedNamed = 0;
    let plainNamed = 0;
    for (const [label, ctx] of /** @type {const} */ ([
      ['plain', context],
      ['promoted', promotedContext()],
    ])) {
      for (const cell of boundsCorpus()) {
        const answer = feasibleKickoffBounds(ctx, cell);
        const at = `${label} ${cell.surfaceId} ${cell.date} ${cell.format}`;
        if (label === 'promoted' && answer.verdict === FEASIBILITY_VERDICT.INFEASIBLE) {
          promotedInfeasible += 1;
        }
        if (answer.latestHard.kickoffMinutes !== null) {
          if (label === 'promoted') promotedNamed += 1;
          else plainNamed += 1;
        }
        if (answer.verdict !== FEASIBILITY_VERDICT.INFEASIBLE) continue;
        if (answer.latestHard.kickoffMinutes !== null) {
          offenders.push(
            `${at}: infeasible while naming minute ${answer.latestHard.kickoffMinutes}, bound by ${answer.binding.map((bound) => bound.kind).join(', ') || 'nothing'}, margin ${JSON.stringify(answer.marginMinutes)}`
          );
          continue;
        }
        // …and an answer with no boundary names none of its parts either.
        if (answer.binding.length > 0 || answer.marginMinutes !== null) {
          offenders.push(`${at}: no boundary, yet it reports a binding set or a margin`);
        }
      }
    }
    expect(offenders.slice(0, 5)).toEqual([]);
    expect(offenders).toHaveLength(0);
    // Meta-assertions: both registries answered real questions, and the
    // promoted one really did reach the infeasible arm this rule is about.
    expect(plainNamed).toBeGreaterThan(0);
    expect(promotedNamed).toBeGreaterThan(0);
    expect(promotedInfeasible).toBeGreaterThan(0);
  }, 300_000);

  it('moves the hard bound to the latest minute the registry actually allows', () => {
    // The oracle: a minute-by-minute scan at the *hard* threshold, under the
    // promoted registry, so the search is checked against brute force exactly
    // as the clean boundary already is.
    const ctx = promotedContext();
    const cell = { surfaceId: 'brookside-park/upper-1', date: '2026-08-22', format: '4v4' };
    const answer = feasibleKickoffBounds(ctx, cell);
    const bookings = standingBookings(ctx.state, cell.date, []);
    /** @type {number|null} */
    let scanned = null;
    for (let minute = answer.searchedToMinutes; minute >= answer.searchedFromMinutes; minute -= 1) {
      const probe = probeKickoff(
        ctx.engines,
        { ...cell, kickoffMinutes: minute, ignoreBookingIds: [] },
        bookings,
        createFeasibilityMeta()
      );
      if (probe.findings.every((finding) => finding.severity !== CONSTRAINT_SEVERITY.BLOCKING)) {
        scanned = minute;
        break;
      }
    }
    // Meta-assertions: the scan found a minute, and it is *not* the minute the
    // registry-blind search offers — so the two really do disagree here.
    expect(scanned).not.toBeNull();
    const blind = latestLegalKickoff(
      graph,
      table,
      calendar,
      { surfaceId: cell.surfaceId, date: cell.date, format: cell.format },
      { existingBookings: bookings }
    );
    expect(blind.kickoffMinutes).not.toBe(scanned);
    expect(answer.latestHard.kickoffMinutes).toBe(scanned);
    // Not `feasible`: the added record is a `hard` constraint no rule in the run
    // enforces, so rule 4 holds the answer open as `unknown` naming it. What
    // matters here is that it is not `infeasible` beside a named bound, which is
    // the contradiction, and that the bound it names is the scanned one.
    expect(answer.verdict).not.toBe(FEASIBILITY_VERDICT.INFEASIBLE);
    expect(
      answer.unknowns
        .filter((entry) => entry.verdictBearing === true)
        .map((entry) => entry.constraintId)
    ).toContain(PERMIT_MARGIN_IS_HARD.id);
  });

  it('says out loud that the registry, not availability, chose the bound', () => {
    const answer = feasibleKickoffBounds(promotedContext(), {
      surfaceId: 'brookside-park/upper-1',
      date: '2026-08-22',
      format: '4v4',
    });
    const said = answer.findings.filter(
      (finding) => finding.code === FEASIBILITY_REASON.FEASIBILITY_BOUND_UNDER_REGISTRY
    );
    expect(said).toHaveLength(1);
    expect(said[0].details.codes).toContain(AVAILABILITY_REASON.PERMIT_MARGIN_TIGHT);
    expect(said[0].details.availabilityKickoffMinutes).not.toBe(answer.latestHard.kickoffMinutes);
    // …and the ordinary corpus never says it, because nothing there disagrees.
    const plain = feasibleKickoffBounds(context, {
      surfaceId: ALDER_2,
      date: '2026-08-22',
      format: '11v11',
    });
    expect(
      plain.findings.filter(
        (finding) => finding.code === FEASIBILITY_REASON.FEASIBILITY_BOUND_UNDER_REGISTRY
      )
    ).toEqual([]);
  });
});

describe('feasibility :: round 4, finding 2 — a denial names the layer that decided it', () => {
  it('names every blocking record in the list the verdict was derived from', () => {
    // **The unit the corpus cannot reach.** `blockingEvidenceOf()` is handed
    // the same shape `deriveFeasibilityEvidence()` reads, including a
    // coach-travel record no transition owns — the case the `travelFindings`
    // list exists for and the message used to be unable to describe.
    const claim = makeClaim({
      source: ATTRIBUTION_SOURCE.RULE_ENGINE,
      kind: 'coach-travel-between-venues',
      instanceId: 'coach-1',
      constraintIds: [],
      codes: [TRAVEL_REASON.TRAVEL_COMMITMENTS_OVERLAP],
      severity: CONSTRAINT_SEVERITY.BLOCKING,
      binding: true,
      limitMinutes: null,
      slackMinutes: null,
      computed: {},
      detail: 'two commitments overlap',
      entities: [{ kind: 'person', id: 'coach-1' }],
    });
    const unowned = {
      source: ATTRIBUTION_SOURCE.COACH_TRAVEL,
      severity: CONSTRAINT_SEVERITY.BLOCKING,
      codes: [TRAVEL_REASON.TRAVEL_SCAN_VACUOUS],
    };
    expect(blockingEvidenceOf([claim, unowned])).toEqual({
      sources: [ATTRIBUTION_SOURCE.COACH_TRAVEL, ATTRIBUTION_SOURCE.RULE_ENGINE].sort(),
      codes: [TRAVEL_REASON.TRAVEL_COMMITMENTS_OVERLAP, TRAVEL_REASON.TRAVEL_SCAN_VACUOUS].sort(),
    });
    // The negative control: nothing below `blocking` is a reason the answer is
    // blocked, so nothing below `blocking` is named as one.
    expect(
      blockingEvidenceOf([
        {
          source: ATTRIBUTION_SOURCE.COACH_TRAVEL,
          severity: CONSTRAINT_SEVERITY.COMPROMISE,
          codes: ['X'],
        },
        { source: ATTRIBUTION_SOURCE.FACILITY, severity: CONSTRAINT_SEVERITY.INFO, codes: ['Y'] },
      ])
    ).toEqual({ sources: [], codes: [] });
  });

  it('never emits the denial without naming a source, on any answer this corpus produces', () => {
    let said = 0;
    /** @type {string[]} */
    const offenders = [];
    /**
     * @param {string} label
     * @param {import('@squadlogic/core/feasibility/types.js').FeasibilityAnswer} answer
     */
    const rule = (label, answer) => {
      for (const finding of answer.findings) {
        if (finding.code !== FEASIBILITY_REASON.FEASIBILITY_BLOCKED_OUTSIDE_FACILITY) continue;
        said += 1;
        const sources = /** @type {string[]} */ (finding.details.sources ?? []);
        const codes = /** @type {string[]} */ (finding.details.codes ?? []);
        if (sources.length === 0) offenders.push(`${label}: named no layer`);
        if (codes.length === 0) offenders.push(`${label}: named no code`);
        // The message is decoration, but it must not decorate with a sentence
        // the answer cannot back: "stated in the blockers" was printed where
        // the blockers stated nothing.
        for (const source of sources) {
          if (!finding.message.includes(source)) {
            offenders.push(`${label}: message omits the source "${source}"`);
          }
        }
        if (/stated in the blockers/.test(finding.message)) {
          offenders.push(`${label}: message defers to blockers that name nothing`);
        }
      }
    };
    for (const game of schedule.games) {
      rule(`standing ${game.id}`, standingAnswer(game));
      rule(
        `move ${game.id} +60`,
        canGameMove(
          context,
          { gameId: game.id, insteadOfMinutes: game.startMinutes + 60 },
          { venueComplexes }
        )
      );
    }
    expect(offenders).toEqual([]);
    // Meta-assertion: the sweep actually met the finding.
    expect(said).toBeGreaterThan(0);
  }, 180_000);

  it('states plainly which travel findings the end-to-end case needs, and that none exists', () => {
    // **Why the unit above is a unit.** `projectTravel()` drops a finding no
    // transition owns, so a *blocking* unowned travel finding is what would
    // reach the message through `canGameMove()`. Today the only unowned
    // findings are scan-level, and no scan-level travel code can be blocking
    // under any constraint type — so the end-to-end case cannot be constructed
    // honestly and this is a guard rather than a live path. If that ever
    // changes, this fails and the message has to be re-checked against a real
    // one instead of against the unit.
    // The scan-level set is read off the evaluator rather than typed here, so a
    // scan-level code added later joins this check instead of escaping it.
    const vacuous = evaluateCoachTravel(
      [
        {
          id: 'c1',
          personId: 'coach-1',
          date: '2026-08-22',
          startMinutes: 600,
          endMinutes: 690,
          venueId: 'alder-park',
        },
      ],
      { registry, venueComplexes }
    );
    const scanLevel = vacuous.findings.filter(
      (finding) => !vacuous.transitions.some((entry) => entry.findings.includes(finding))
    );
    expect(scanLevel.map((finding) => finding.code)).toEqual([TRAVEL_REASON.TRAVEL_SCAN_VACUOUS]);
    // No constraint type can make a scan-level code blocking: `travelSeverityOf()`
    // reads a record's type only for the two *gap* codes, and neither of those
    // is scan-level. That is what makes the end-to-end case unconstructible.
    for (const finding of scanLevel) {
      expect(TRAVEL_REASON_SEVERITY[finding.code]).not.toBe(CONSTRAINT_SEVERITY.BLOCKING);
      for (const type of Object.values(CONSTRAINT_TYPE)) {
        const record = {
          ...registry.byId[SEASON_2026_CONSTRAINT_ID.COACH_TRAVEL_BETWEEN_VENUES],
          type,
        };
        expect(
          travelSeverityOf(finding.code, record),
          `${finding.code} under a ${type} record`
        ).not.toBe(CONSTRAINT_SEVERITY.BLOCKING);
      }
    }

    const overlapping = evaluateCoachTravel(
      [
        {
          id: 'c1',
          personId: 'coach-1',
          date: '2026-08-22',
          startMinutes: 600,
          endMinutes: 720,
          venueId: 'alder-park',
        },
        {
          id: 'c2',
          personId: 'coach-1',
          date: '2026-08-22',
          startMinutes: 660,
          endMinutes: 780,
          venueId: 'summit-hs',
        },
      ],
      { registry, venueComplexes }
    );
    const blocking = overlapping.findings.filter(
      (finding) => finding.severity === CONSTRAINT_SEVERITY.BLOCKING
    );
    expect(blocking.map((finding) => finding.code)).toEqual([
      TRAVEL_REASON.TRAVEL_COMMITMENTS_OVERLAP,
    ]);
    for (const finding of blocking) {
      expect(overlapping.transitions.some((entry) => entry.findings.includes(finding))).toBe(true);
    }
  });
});
