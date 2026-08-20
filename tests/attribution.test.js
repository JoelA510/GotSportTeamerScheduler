/**
 * Constraint attribution on every decision — Prompt 4.3.
 *
 * > *"Every placement, rejection, and computed boundary must be able to state
 * > the binding constraint."*
 *
 * Two acceptance tests, both against the season-2026 corpus:
 *
 * 1. **For every game in the fixture, the system produces an attribution.** All
 *    679 rows of `combined_schedule.csv`, counted rather than sampled, with the
 *    coverage comparison built from two independently-derived numbers and a
 *    positive control proving it can fail.
 * 2. **A deliberately over-constrained placement names a minimal blocking set of
 *    2-3 constraints rather than everything.** Minimality is *proved*: for each
 *    member, relaxing every other member leaves the placement illegal, and the
 *    test re-establishes that property itself rather than reading the module's
 *    `certified` flag — then runs the same check against a padded set to show it
 *    fails there.
 *
 * Plus the four questions the build plan names, each answered in one call, each
 * with its answer derived from the corpus rather than written down here.
 *
 * Every figure below is computed at test time. Where a scenario had to be built
 * rather than found, the test says so in the word "constructed" and says what
 * the corpus supplied.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

import {
  AVAILABILITY_CONSTRAINT,
  AVAILABILITY_REASON,
  buildAvailabilityCalendarFromSeason2026,
  resolveLighting,
  resolvePermitWindow,
} from '@squadlogic/core/availability/index.js';
import {
  CONSTRAINT_ENFORCEMENT,
  CONSTRAINT_SCOPE_KIND,
  CONSTRAINT_TYPE,
  SEASON_2026_CONSTRAINT_ID,
  buildConstraintRegistry,
  buildSeason2026ConstraintRegistry,
} from '@squadlogic/core/constraints/index.js';
import {
  buildFacilityGraphFromSeason2026,
  buildSeason2026VenueComplexMap,
  season2026SurfaceId,
} from '@squadlogic/core/facility/index.js';
import {
  loadCoachRoster,
  loadExternalFixtures,
  loadFacilityGeometry,
  loadFacilityPermits,
  loadGameFormats,
  loadSeason2026,
  loadSunsets,
} from '@squadlogic/core/fixtures/index.js';
import { buildSeason2026CoachRoster } from '@squadlogic/core/people/index.js';
import {
  checkPlacement,
  season2026ExternalFixtureChanges,
} from '@squadlogic/core/resolve/index.js';
import { runRuleEngine, toSeason2026Schedule } from '@squadlogic/core/ruleEngine/index.js';
import {
  SEASON_2026_INCIDENT_8_WARMUP_MINUTES,
  buildFormatTimingTableFromSeason2026,
} from '@squadlogic/core/timing/index.js';

import {
  ATTRIBUTION_CODES_BY_CONSTRAINT_KIND,
  ATTRIBUTION_QUESTION,
  ATTRIBUTION_REASON,
  ATTRIBUTION_REASON_SEVERITY,
  ATTRIBUTION_SEVERITY,
  ATTRIBUTION_SOURCE,
  ATTRIBUTION_STATUS,
  attributionSeverityOf,
  buildAttributionContext,
  explainEarliestKickoff,
  explainGame,
  explainKickoffTime,
  explainLatestKickoff,
  explainSchedule,
  explainTeamConflict,
  isSpecificClaim,
  makeClaim,
  minimalBlockingSet,
} from '@squadlogic/core/attribution/index.js';

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
const calendar = buildAvailabilityCalendarFromSeason2026(
  loadFacilityPermits({ seasonYear: SEASON_YEAR }),
  sunsets
);
const registry = buildSeason2026ConstraintRegistry();
const venueComplexes = buildSeason2026VenueComplexMap();
const schedule = toSeason2026Schedule(season);
const roster = buildSeason2026CoachRoster(loadCoachRoster());
const verification = runRuleEngine(schedule, {
  registry,
  resources: { graph, timingTable: table, calendar, venueComplexes },
});

/** The context every question below is asked of. */
const context = buildAttributionContext({
  graph,
  table,
  calendar,
  registry,
  schedule,
  verification,
  venueComplexes,
  roster,
});

/** The whole season, attributed once. */
const sweep = explainSchedule(context);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE = path.join(ROOT, 'packages', 'core', 'src');

/* -------------------------------------------------------------------------- */
/* Guard block — runs before anything behavioural                              */
/* -------------------------------------------------------------------------- */

describe('attribution :: corpus guard', () => {
  it('is asked of the whole published season, not a slice of it', () => {
    // Without these, "every game is attributed" would be a statement about
    // whatever subset happened to load. 679 is the corpus README's own figure.
    expect(schedule.games.length).toBe(679);
    expect(schedule.commitments.length).toBeGreaterThan(0);
    expect(registry.constraintIds.length).toBeGreaterThan(0);
    expect(verification.meta.rulesRun).toBeGreaterThan(0);
  });

  it('was built with everything it can be built with, so no answer is thin by accident', () => {
    // The context reports what it is missing. This one is missing nothing, and
    // that is asserted here so that a `compromise` anywhere below is a fact
    // about the schedule rather than about the question.
    expect(context.findings).toEqual([]);
    expect(context.status).toBe(ATTRIBUTION_STATUS.ALLOWED);
    expect(context.verification).not.toBeNull();
    expect(context.travel).not.toBeNull();
    expect(context.soleCoach).not.toBeNull();
    expect(context.meta.transitionsConsulted).toBeGreaterThan(0);
    expect(context.meta.rosterEntriesConsulted).toBeGreaterThan(0);
  });

  it('says what it is missing when it is missing something', () => {
    // The positive control for the block above: the same builder, handed less.
    const thin = buildAttributionContext({ graph, table, calendar, registry, schedule });
    const codes = thin.findings.map((finding) => finding.code).sort();
    expect(codes).toEqual([
      ATTRIBUTION_REASON.ATTRIBUTION_ROSTER_ABSENT,
      ATTRIBUTION_REASON.ATTRIBUTION_TRAVEL_ABSENT,
      ATTRIBUTION_REASON.ATTRIBUTION_VERIFICATION_ABSENT,
    ]);
    expect(thin.status).toBe(ATTRIBUTION_STATUS.COMPROMISED);
    // …and the thinness travels: an answer built from that context carries it,
    // so a facility-only explanation can never read as a complete one.
    const answer = explainGame(thin, { gameId: schedule.games[0].id });
    expect(answer.status).toBe(ATTRIBUTION_STATUS.COMPROMISED);
    expect(answer.findings.map((finding) => finding.code)).toContain(
      ATTRIBUTION_REASON.ATTRIBUTION_VERIFICATION_ABSENT
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The frozen tables                                                           */
/* -------------------------------------------------------------------------- */

describe('attribution :: the reason-code tables are frozen and complete', () => {
  it('registers a severity for every reason code, and refuses an unregistered one', () => {
    for (const code of Object.values(ATTRIBUTION_REASON)) {
      expect(Object.values(ATTRIBUTION_SEVERITY)).toContain(attributionSeverityOf(code));
    }
    expect(Object.keys(ATTRIBUTION_REASON_SEVERITY).sort()).toEqual(
      Object.values(ATTRIBUTION_REASON).sort()
    );
    expect(() => attributionSeverityOf('ATTRIBUTION_NOT_A_CODE')).toThrow(/no registered severity/);
    expect(Object.isFrozen(ATTRIBUTION_REASON_SEVERITY)).toBe(true);
  });

  it('gives every constraint kind a code bucket, and every code in it is real', () => {
    const kinds = Object.values(AVAILABILITY_CONSTRAINT).sort();
    expect(Object.keys(ATTRIBUTION_CODES_BY_CONSTRAINT_KIND).sort()).toEqual(kinds);
    const known = new Set([
      ...Object.values(AVAILABILITY_REASON),
      // The occupancy codes are the facility module's, which is why they are
      // read from a finding rather than spelled: `checkKickoffAvailability()`
      // returns them verbatim from `checkBooking()`.
      'OCCUPIED_SAME_SURFACE',
      'OCCUPIED_PARENT_CHILD',
      'OCCUPIED_SPATIAL_OVERLAP',
    ]);
    for (const codes of Object.values(ATTRIBUTION_CODES_BY_CONSTRAINT_KIND)) {
      expect(codes.length).toBeGreaterThan(0);
      for (const code of codes) expect(known.has(code), code).toBe(true);
    }
  });

  it('buckets every reason code the registry governs exactly once', () => {
    // The drift check. A registry constraint that claims a code nothing buckets
    // would produce claims that cannot name the constraint governing them —
    // "an instance, not a category" failing quietly at the seam.
    const bucketed = Object.values(ATTRIBUTION_CODES_BY_CONSTRAINT_KIND).flat();
    expect(new Set(bucketed).size).toBe(bucketed.length);
    const governed = Object.keys(registry.idsByReasonCode);
    expect(governed.length).toBeGreaterThan(0);
    const placementCodes = governed.filter((code) => !code.startsWith('WARMUP_'));
    for (const code of placementCodes) {
      expect(bucketed.filter((entry) => entry === code).length, code).toBe(1);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* The bar every claim has to clear                                            */
/* -------------------------------------------------------------------------- */

describe('attribution :: a claim names an instance and says something computed', () => {
  it('refuses a category label — the check that would otherwise never fire', () => {
    // The positive control. `sunset` with nothing attached is exactly the answer
    // this module exists to replace, and the predicate every answer is checked
    // against has to reject it or the checks below mean nothing.
    const category = makeClaim({ source: ATTRIBUTION_SOURCE.AVAILABILITY, kind: 'sunset' });
    expect(isSpecificClaim(category)).toBe(false);

    // Named but silent, and computed but anonymous: both halves are required.
    expect(
      isSpecificClaim(
        makeClaim({
          source: ATTRIBUTION_SOURCE.AVAILABILITY,
          kind: 'sunset',
          instanceId: '2026-10-31',
        })
      )
    ).toBe(false);
    expect(
      isSpecificClaim(
        makeClaim({
          source: ATTRIBUTION_SOURCE.AVAILABILITY,
          kind: 'sunset',
          computed: { limitMinutes: 1064 },
        })
      )
    ).toBe(false);
    expect(
      isSpecificClaim(
        makeClaim({
          source: ATTRIBUTION_SOURCE.AVAILABILITY,
          kind: 'sunset',
          instanceId: '2026-10-31',
          computed: { limitMinutes: 1064, slackMinutes: 14 },
        })
      )
    ).toBe(true);
  });

  it('makes an answer carrying a category-only claim rejected, not merely noisy', () => {
    // The severity is what enforces it: a `blocking` finding derives `rejected`.
    expect(ATTRIBUTION_REASON_SEVERITY[ATTRIBUTION_REASON.ATTRIBUTION_CLAIM_CATEGORY_ONLY]).toBe(
      ATTRIBUTION_SEVERITY.BLOCKING
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Acceptance 1 — every game in the fixture produces an attribution            */
/* -------------------------------------------------------------------------- */

describe('attribution :: acceptance 1 — every game in the fixture is attributed', () => {
  it('attributes all 679 games, counted from the schedule rather than from the answers', () => {
    expect(sweep.coverage.gamesInSchedule).toBe(schedule.games.length);
    expect(sweep.coverage.gamesAttributed).toBe(schedule.games.length);
    expect(sweep.coverage.gamesUnattributed).toEqual([]);
    expect(sweep.coverage.complete).toBe(true);
    // The two numbers come from different places — the schedule and the answers
    // — and the counter behind the second one agrees with it.
    expect(sweep.meta.gamesExamined).toBe(schedule.games.length);
    expect(sweep.meta.gamesAttributed).toBe(schedule.games.length);
    expect(Object.keys(sweep.byGameId).length).toBe(schedule.games.length);
  });

  it('gives every one of them at least one claim, and none of them a category label', () => {
    expect(sweep.coverage.claimsPerGameMinimum).toBeGreaterThan(0);
    expect(sweep.coverage.categoryOnlyClaims).toBe(0);
    expect(sweep.coverage.claims).toBeGreaterThan(schedule.games.length);
    expect(sweep.status).toBe(ATTRIBUTION_STATUS.ALLOWED);

    // Asserted over every claim of every game, not over a sample: the predicate
    // is cheap and "most of them are specific" is not the guarantee.
    let checked = 0;
    for (const attribution of sweep.attributions) {
      expect(attribution.claims.length, attribution.gameId).toBeGreaterThan(0);
      for (const claim of attribution.claims) {
        checked += 1;
        expect(isSpecificClaim(claim), `${attribution.gameId} :: ${claim.kind}`).toBe(true);
      }
    }
    expect(checked).toBe(sweep.coverage.claims);
  });

  it('names the binding constraint of every game it says has one', () => {
    // `bindingKinds` is `checkKickoffAvailability()`'s answer, consumed. Where
    // it names a kind, a claim of that kind must be present and marked binding —
    // otherwise the attribution and the machinery behind it disagree.
    let withBinding = 0;
    for (const attribution of sweep.attributions) {
      if (attribution.bindingKinds.length === 0) continue;
      withBinding += 1;
      const kinds = attribution.claims.filter((claim) => claim.binding).map((claim) => claim.kind);
      for (const kind of attribution.bindingKinds) {
        expect(kinds, attribution.gameId).toContain(kind);
      }
    }
    // Meta-assertion: this ran against a real population.
    expect(withBinding).toBe(schedule.games.length);
  });

  it('refuses to call an empty schedule fully attributed', () => {
    // "Every game is attributed" is true of a season with no games and means
    // nothing, which is incident 4 in one sentence.
    const empty = explainSchedule({ ...context, schedule: { ...schedule, games: [] } });
    expect(empty.coverage.complete).toBe(false);
    expect(empty.coverage.gamesInSchedule).toBe(0);
    expect(empty.status).toBe(ATTRIBUTION_STATUS.REJECTED);
    expect(empty.findings.map((finding) => finding.code)).toContain(
      ATTRIBUTION_REASON.ATTRIBUTION_SWEEP_VACUOUS
    );
  });

  it('detects a game it cannot explain, rather than leaving it out of the list', () => {
    // The positive control for the coverage check. A schedule row the state does
    // not hold is the shape of a row a broken join dropped: the sweep must name
    // it and go `rejected`, never quietly report 679 of 680.
    const phantom = { ...schedule.games[0], id: 'phantom::not-in-the-state' };
    const doctored = {
      ...context,
      schedule: { ...schedule, games: [...schedule.games, phantom] },
    };
    const broken = explainSchedule(doctored);
    expect(broken.coverage.gamesInSchedule).toBe(schedule.games.length + 1);
    expect(broken.coverage.gamesAttributed).toBe(schedule.games.length);
    expect(broken.coverage.gamesUnattributed).toEqual([phantom.id]);
    expect(broken.coverage.complete).toBe(false);
    expect(broken.status).toBe(ATTRIBUTION_STATUS.REJECTED);
    expect(broken.findings.map((finding) => finding.code)).toContain(
      ATTRIBUTION_REASON.ATTRIBUTION_GAME_UNKNOWN
    );
  });

  it('reports claims tightest-first, in the order the availability module set', () => {
    // The ordering is `orderByTightness()`'s and is passed through. Asserted
    // against that function's own output, per game, for every game: the ordered
    // availability claims must be the applicable constraints in the same order.
    let compared = 0;
    for (const attribution of sweep.attributions) {
      const placement = checkPlacement(
        { graph, table, calendar, registry },
        context.state,
        attribution.gameId,
        attribution.slot
      );
      const expected = placement.availability.constraints
        .filter((constraint) => constraint.applicable)
        .map((constraint) => constraint.kind);
      const actual = attribution.claims
        .filter((claim) => claim.source === ATTRIBUTION_SOURCE.AVAILABILITY)
        .map((claim) => claim.kind);
      expect(actual, attribution.gameId).toEqual(expected);
      compared += expected.length;
    }
    expect(compared).toBeGreaterThan(schedule.games.length);
  });
});

/* -------------------------------------------------------------------------- */
/* The four questions the build plan names                                     */
/* -------------------------------------------------------------------------- */

/**
 * The external fixtures whose agreed time differs from the time the other league
 * published — the corpus's own record of incident 3.
 */
const externalChanges = season2026ExternalFixtureChanges(loadExternalFixtures(), schedule);
const negotiated = externalChanges.filter(
  (change) =>
    /** @type {Object} */ (schedule.games.find((game) => game.id === change.gameId))
      .startMinutes !== change.startMinutes
);
/** The later of the two negotiated kickoffs: the 12:30 that made a 9v9 block illegal. */
const latePublished = [...negotiated].sort((a, b) => b.startMinutes - a.startMinutes)[0];

describe('attribution :: "why is this game at this time and not that one?"', () => {
  it('answers with the constraint instance the alternative would break, and by how much', () => {
    // One call. The alternative is the time `external_fixtures_published.csv`
    // records, read from the corpus rather than typed here.
    const answer = explainKickoffTime(context, {
      gameId: latePublished.gameId,
      insteadOfMinutes: latePublished.startMinutes,
      insteadOfSurfaceId: latePublished.surfaceId,
      insteadOfDate: latePublished.date,
    });

    expect(answer.question).toBe(ATTRIBUTION_QUESTION.WHY_THIS_TIME);
    expect(answer.status).toBe(ATTRIBUTION_STATUS.ALLOWED);

    // The fact: it is legal where it stands.
    expect(answer.current.legal).toBe(true);
    expect(answer.slot.startMinutes).toBeLessThan(answer.alternative.startMinutes);

    // The counterfactual: at the published time it is not, and the answer names
    // the specific instance — which registry constraint, which *other games*,
    // and how many minutes short. Incident 3's "illegal by exactly 10 minutes".
    expect(answer.counterfactual.legal).toBe(false);
    expect(answer.counterfactual.constraintIds).toContain(
      SEASON_2026_CONSTRAINT_ID.FIELD_OVERLAP_ADJACENCY
    );
    expect(answer.counterfactual.counterpartGameIds.length).toBeGreaterThan(0);
    const binding = /** @type {Object} */ (answer.counterfactual.binding);
    expect(binding.kind).toBe(AVAILABILITY_CONSTRAINT.OCCUPANCY);
    expect(binding.slackMinutes).toBe(-10);
    expect(binding.summary).toContain('slack -10 min');

    // The counterparts are the already-published games on *overlapping* ground,
    // not on the pitch itself — which is the whole of incident 3.
    const counterparts = answer.counterfactual.counterpartGameIds.map((gameId) =>
      schedule.games.find((game) => game.id === gameId)
    );
    expect(counterparts.every((game) => game !== undefined)).toBe(true);
    for (const game of counterparts) {
      expect(/** @type {Object} */ (game).surfaceId).not.toBe(answer.alternative.surfaceId);
      expect(/** @type {Object} */ (game).format).toBe('9v9');
    }

    const explained = answer.findings.find(
      (finding) => finding.code === ATTRIBUTION_REASON.ATTRIBUTION_ALTERNATIVE_BLOCKED
    );
    expect(explained).toBeDefined();
    expect(/** @type {Object} */ (explained).details.slackMinutes).toBe(-10);
  });

  it('says so when the alternative is legal too, rather than implying the time was forced', () => {
    // The other half of the same question, and it has to be *found*: an answer
    // that only ever says "blocked" would pass every assertion above while being
    // unable to tell a forced time from a chosen one. The alternatives tried are
    // kickoff minutes the corpus itself uses at that venue on that date, never
    // invented ones.
    /** @type {Object|null} */
    let legal = null;
    let attempts = 0;
    for (const game of schedule.games) {
      const kickoffs = [
        ...new Set(
          schedule.games
            .filter((entry) => entry.date === game.date && entry.venueId === game.venueId)
            .map((entry) => entry.startMinutes)
        ),
      ].sort((a, b) => a - b);
      for (const minutes of kickoffs) {
        if (minutes === game.startMinutes) continue;
        attempts += 1;
        const answer = explainKickoffTime(context, {
          gameId: game.id,
          insteadOfMinutes: minutes,
        });
        if (!answer.counterfactual.legal) continue;
        legal = answer;
        break;
      }
      if (legal !== null) break;
    }

    // Meta-assertions: alternatives really were tried, and rejected ones existed.
    expect(attempts).toBeGreaterThan(1);
    expect(legal).not.toBeNull();
    const answer = /** @type {Object} */ (legal);
    expect(answer.findings.map((finding) => finding.code)).toContain(
      ATTRIBUTION_REASON.ATTRIBUTION_ALTERNATIVE_LEGAL
    );
    expect(answer.counterfactual.blockingCodes).toEqual([]);
    expect(answer.counterfactual.claims.length).toBeGreaterThan(0);
    expect(answer.status).toBe(ATTRIBUTION_STATUS.ALLOWED);
  });

  it('refuses to compare a slot with itself', () => {
    const game = schedule.games[0];
    const answer = explainKickoffTime(context, {
      gameId: game.id,
      insteadOfMinutes: game.startMinutes,
    });
    expect(answer.findings.map((finding) => finding.code)).toContain(
      ATTRIBUTION_REASON.ATTRIBUTION_ALTERNATIVE_NO_OP
    );
    expect(answer.status).toBe(ATTRIBUTION_STATUS.COMPROMISED);
  });
});

describe('attribution :: "why can\'t this game go later?"', () => {
  /**
   * The game with the least room against the daylight limit, found in the
   * corpus by reading the attributions rather than chosen here.
   */
  const sunsetBound = sweep.attributions
    .filter((attribution) => attribution.bindingKinds.includes(AVAILABILITY_CONSTRAINT.SUNSET))
    .map((attribution) => ({
      attribution,
      claim: /** @type {Object} */ (
        attribution.claims.find((entry) => entry.kind === AVAILABILITY_CONSTRAINT.SUNSET)
      ),
    }))
    .filter((entry) => entry.claim && typeof entry.claim.slackMinutes === 'number')
    .sort((a, b) => a.claim.slackMinutes - b.claim.slackMinutes)[0];

  it('answers "sunset margin, not permit close" — with both numbers', () => {
    expect(sunsetBound).toBeDefined();
    const answer = explainLatestKickoff(context, { gameId: sunsetBound.attribution.gameId });

    expect(answer.question).toBe(ATTRIBUTION_QUESTION.WHY_NOT_LATER);
    expect(answer.status).toBe(ATTRIBUTION_STATUS.ALLOWED);
    expect(answer.bindingKinds).toEqual([AVAILABILITY_CONSTRAINT.SUNSET]);
    expect(answer.kickoffMinutes).not.toBeNull();
    expect(answer.headroomMinutes).toBeGreaterThanOrEqual(0);

    // Ordered by tightness, and *both* edges reported: the answer to "why not
    // later" is useless without the runner-up, because "sunset" alone reads as
    // "the site closes" to everybody who has not read the permit table.
    const sunset = /** @type {Object} */ (
      answer.claims.find((claim) => claim.kind === AVAILABILITY_CONSTRAINT.SUNSET)
    );
    const permit = /** @type {Object} */ (
      answer.claims.find((claim) => claim.kind === AVAILABILITY_CONSTRAINT.PERMIT)
    );
    expect(sunset).toBeDefined();
    expect(permit).toBeDefined();
    expect(answer.claims.indexOf(sunset)).toBeLessThan(answer.claims.indexOf(permit));
    expect(sunset.binding).toBe(true);
    expect(permit.binding).toBe(false);

    // The instance, not the category: the sunset record for that date, the
    // margin it was reduced by, the permit record and its close minute.
    expect(sunset.instanceId).toBe(sunsetBound.attribution.slot.date);
    expect(sunset.constraintIds).toEqual([SEASON_2026_CONSTRAINT_ID.SUNSET_MARGIN]);
    expect(sunset.computed.sunsetMinutes).toBeGreaterThan(0);
    expect(sunset.computed.sunsetMarginMinutes).toBeGreaterThan(0);
    expect(sunset.computed.limitMinutes).toBe(
      sunset.computed.sunsetMinutes - sunset.computed.sunsetMarginMinutes
    );
    expect(permit.constraintIds).toEqual([SEASON_2026_CONSTRAINT_ID.PERMIT_WINDOW]);
    expect(permit.computed.closeMinutes).toBeGreaterThan(sunset.computed.limitMinutes);
    expect(permit.slackMinutes).toBeGreaterThan(/** @type {number} */ (sunset.slackMinutes));

    // The boundary itself is the sunset limit less the occupancy, which is the
    // availability module's arithmetic and is only read back here.
    expect(answer.kickoffMinutes).toBe(sunset.computed.latestKickoffMinutes);

    // And the edges that do not bound it say why, rather than being absent.
    expect(answer.notApplicable.map((entry) => entry.kind)).toContain(
      AVAILABILITY_CONSTRAINT.LIGHTING
    );
    for (const entry of answer.notApplicable) expect(entry.reason.length).toBeGreaterThan(0);
  });

  it('names a game it does not hold rather than answering about nothing', () => {
    const answer = explainLatestKickoff(context, { gameId: 'not-a-game' });
    expect(answer.status).toBe(ATTRIBUTION_STATUS.REJECTED);
    expect(answer.findings.map((finding) => finding.code)).toContain(
      ATTRIBUTION_REASON.ATTRIBUTION_GAME_UNKNOWN
    );
    expect(answer.claims).toEqual([]);
  });
});

const ALDER = 'Alder Park';
const PITCH_2 = season2026SurfaceId(ALDER, 'Pitch 2');
const PITCH_1A = season2026SurfaceId(ALDER, 'Pitch 1A');
const PITCH_1B = season2026SurfaceId(ALDER, 'Pitch 1B');
const WARMUP = SEASON_2026_INCIDENT_8_WARMUP_MINUTES;

// Derived exactly as `tests/gameTimeModel.test.js` derives it, so the two
// suites cannot drift into asking about different days. Incident 8's date is
// the one where 9v9s run on the ground Pitch 2 overlaps.
const busyDate = [
  ...new Set(schedule.games.filter((game) => game.surfaceId === PITCH_2).map((game) => game.date)),
]
  .sort()
  .filter((date) =>
    schedule.games.some(
      (game) =>
        game.date === date && game.format === '9v9' && [PITCH_1A, PITCH_1B].includes(game.surfaceId)
    )
  )[0];
/** The search floor: when the last already-booked Pitch 2 slot clears. */
const floor = Math.max(
  ...schedule.games
    .filter((game) => game.surfaceId === PITCH_2 && game.date === busyDate)
    .map((game) => /** @type {number} */ (game.endMinutes))
);
/** The last 9v9 to finish on the overlapping Pitch 1A: incident 8's 2:55 PM. */
const afternoonNine = schedule.games
  .filter((game) => game.date === busyDate && game.format === '9v9' && game.surfaceId === PITCH_1A)
  .sort((a, b) => /** @type {number} */ (b.endMinutes) - /** @type {number} */ (a.endMinutes))[0];

describe('attribution :: "what\'s the earliest kickoff allowing a full 30-minute warm-up?"', () => {
  it('answers with the booking that set it — on the overlapping field, not this one', () => {
    const answer = explainEarliestKickoff(context, {
      surfaceId: PITCH_2,
      date: busyDate,
      format: '11v11',
      warmupMinutes: WARMUP,
      notBeforeMinutes: floor,
    });

    expect(answer.question).toBe(ATTRIBUTION_QUESTION.EARLIEST_KICKOFF);
    expect(answer.status).toBe(ATTRIBUTION_STATUS.ALLOWED);
    // Meta-assertion: the bound really is the overlapping pitch rather than the
    // floor the question named, or "3:25 PM" would be an answer to a question
    // with no constraint in it.
    expect(/** @type {number} */ (afternoonNine.endMinutes)).toBeGreaterThan(floor);
    // 3:25 PM in the source project's words; derived here from the 9v9 that
    // clears the overlapping ground plus the stated warm-up.
    expect(answer.kickoffMinutes).toBe(/** @type {number} */ (afternoonNine.endMinutes) + WARMUP);

    const claim = /** @type {Object} */ (answer.binding);
    expect(claim.source).toBe(ATTRIBUTION_SOURCE.WARMUP);
    expect(claim.computed.warmupMinutes).toBe(WARMUP);
    expect(claim.computed.warmupStartMinutes).toBe(afternoonNine.endMinutes);
    expect(claim.computed.kickoffMinutes).toBe(answer.kickoffMinutes);
    // The instance is the booking, and it is on ground that overlaps rather than
    // on the pitch being played on. That sentence is the whole incident.
    expect(claim.entities.some((entity) => entity.id === afternoonNine.id)).toBe(true);
    expect(claim.detail).toContain('overlaps this pitch');
    expect(claim.constraintIds).toContain(SEASON_2026_CONSTRAINT_ID.FIELD_OVERLAP_ADJACENCY);
  });

  it('says when nothing bounded the answer, rather than presenting a floor as a limit', () => {
    // Asked from after everything on that ground has cleared, the answer is the
    // floor the question named. That is a different statement from "a booking
    // pushed you here", and an answer that could not tell them apart would read
    // as a constraint where there is none.
    const lastEnd = Math.max(
      ...schedule.games
        .filter((game) => game.date === busyDate && game.endMinutes !== null)
        .map((game) => /** @type {number} */ (game.endMinutes))
    );
    const answer = explainEarliestKickoff(context, {
      surfaceId: PITCH_2,
      date: busyDate,
      format: '11v11',
      warmupMinutes: WARMUP,
      notBeforeMinutes: lastEnd,
    });
    expect(answer.kickoffMinutes).toBe(lastEnd + WARMUP);
    expect(answer.binding).toBeNull();
    expect(answer.bindingKinds).toEqual([]);
    expect(answer.findings.map((finding) => finding.code)).toContain(
      ATTRIBUTION_REASON.ATTRIBUTION_BOUND_UNSTATED
    );
    expect(answer.status).toBe(ATTRIBUTION_STATUS.COMPROMISED);
  });

  it('will not invent a warm-up length nobody stated', () => {
    const answer = explainEarliestKickoff(context, {
      surfaceId: PITCH_2,
      date: busyDate,
      format: '11v11',
      notBeforeMinutes: floor,
    });
    expect(answer.kickoffMinutes).toBeNull();
    expect(answer.status).toBe(ATTRIBUTION_STATUS.COMPROMISED);
    expect(answer.findings.map((finding) => finding.code)).toContain(
      ATTRIBUTION_REASON.ATTRIBUTION_QUESTION_UNANSWERABLE
    );
  });
});

describe('attribution :: "why did this team get a conflict?"', () => {
  /** Every transition the travel evaluator reports something above `info` about. */
  const conflicted = /** @type {Object} */ (context.travel).transitions.filter((transition) =>
    transition.findings.some((finding) => finding.severity !== 'info')
  );
  /** The teams the sole-coach register says have exactly one active coach. */
  const soleCoachTeams = new Set(
    /** @type {Object} */ (context.soleCoach).teams.map((entry) => entry.teamId)
  );
  /** A conflict where one of the two teams has no fallback coach at all. */
  const withSoleCoach = conflicted.find(
    (transition) =>
      soleCoachTeams.has(transition.from.teamId) || soleCoachTeams.has(transition.to.teamId)
  );
  /** A conflict judged against the inter-venue travel floor. */
  const withTravelFloor = conflicted.find(
    (transition) => typeof transition.minimumGapMinutes === 'number'
  );

  it('names the other team, its game, and whether anybody could have covered', () => {
    expect(withSoleCoach).toBeDefined();
    // Ask about the team that is *not* the sole-coached one: "why did this team
    // get a conflict" is asked by whoever is looking at the other fixture.
    const soleTeam = soleCoachTeams.has(withSoleCoach.from.teamId)
      ? withSoleCoach.from.teamId
      : withSoleCoach.to.teamId;
    const teamId =
      soleTeam === withSoleCoach.from.teamId ? withSoleCoach.to.teamId : withSoleCoach.from.teamId;

    const answer = explainTeamConflict(context, { teamId });
    expect(answer.question).toBe(ATTRIBUTION_QUESTION.TEAM_CONFLICT);
    expect(answer.conflicts.length).toBeGreaterThan(0);
    expect(answer.meta.transitionsConsulted).toBe(
      /** @type {Object} */ (context.travel).transitions.length
    );

    const conflict = /** @type {Object} */ (
      answer.conflicts.find((entry) => entry.transitionId === withSoleCoach.id)
    );
    expect(conflict).toBeDefined();
    expect(conflict.personId).toBe(withSoleCoach.personId);
    expect(conflict.counterpartTeamIds).toEqual([soleTeam]);
    expect(conflict.counterpartGameIds).toContain(withSoleCoach.from.gameId);
    expect(conflict.counterpartGameIds).toContain(withSoleCoach.to.gameId);

    // The travel claim carries the two kickoffs, so "ten minutes earlier" is a
    // number the answer holds rather than one a reader has to look up.
    const travel = /** @type {Object} */ (
      conflict.claims.find((claim) => claim.source === ATTRIBUTION_SOURCE.COACH_TRAVEL)
    );
    expect(travel.computed.fromStartMinutes).toBe(withSoleCoach.from.startMinutes);
    expect(travel.computed.toStartMinutes).toBe(withSoleCoach.to.startMinutes);
    expect(travel.instanceId).toBe(withSoleCoach.id);
    expect(travel.entities.some((entity) => entity.kind === 'person')).toBe(true);
    expect(travel.entities.some((entity) => entity.id === soleTeam)).toBe(true);

    // And the roster's half of the answer: that team had nobody else. Two
    // independent roster functions agree — the register's finding, and the list
    // of people who could actually have taken the fixture.
    const rosterClaim = /** @type {Object} */ (
      conflict.claims.find((claim) => claim.source === ATTRIBUTION_SOURCE.ROSTER)
    );
    expect(rosterClaim).toBeDefined();
    expect(rosterClaim.instanceId).toBe(soleTeam);
    expect(rosterClaim.entities.some((entity) => entity.id === withSoleCoach.personId)).toBe(true);
    expect(conflict.coverPersonIds).toEqual([]);
    // …and the same list is non-empty where the team does have a second coach,
    // or "nobody could have covered" would be a sentence this answer says about
    // every conflict.
    const covered = answer.conflicts
      .concat(
        explainTeamConflict(context, {
          teamId: /** @type {string} */ (withTravelFloor.to.teamId),
        }).conflicts
      )
      .filter((entry) => entry.coverPersonIds.length > 0);
    expect(covered.length).toBeGreaterThan(0);
  });

  it('names the floor the gap was judged against, and the shortfall', () => {
    expect(withTravelFloor).toBeDefined();
    const teamId = /** @type {string} */ (withTravelFloor.to.teamId ?? withTravelFloor.from.teamId);
    const answer = explainTeamConflict(context, { teamId });
    const claim = /** @type {Object} */ (
      answer.claims.find((entry) => entry.instanceId === withTravelFloor.id)
    );
    expect(claim).toBeDefined();
    expect(claim.constraintIds).toContain(SEASON_2026_CONSTRAINT_ID.COACH_TRAVEL_BETWEEN_VENUES);
    expect(claim.computed.gapMinutes).toBe(withTravelFloor.gapMinutes);
    expect(claim.computed.minimumGapMinutes).toBe(withTravelFloor.minimumGapMinutes);
    expect(claim.computed.shortfallMinutes).toBe(
      withTravelFloor.minimumGapMinutes - withTravelFloor.gapMinutes
    );
    expect(claim.slackMinutes).toBe(-claim.computed.shortfallMinutes);
    expect(claim.summary).toContain('minimum gap');
  });

  it('refuses a team the schedule does not declare, rather than reporting "no conflict"', () => {
    // Incident 4's shape: a broken join empties a team's commitments, and the
    // honest answer is "unknown", never "clean".
    const answer = explainTeamConflict(context, { teamId: 'U12B04' });
    expect(answer.status).toBe(ATTRIBUTION_STATUS.REJECTED);
    expect(answer.findings.map((finding) => finding.code)).toContain(
      ATTRIBUTION_REASON.ATTRIBUTION_TEAM_UNKNOWN
    );
  });

  it('reports a clean team as clean, with the count of what it examined', () => {
    const quiet = /** @type {string} */ (
      schedule.teamUniverse.find(
        (teamId) =>
          !conflicted.some(
            (transition) => transition.from.teamId === teamId || transition.to.teamId === teamId
          )
      )
    );
    const answer = explainTeamConflict(context, { teamId: quiet });
    expect(answer.conflicts).toEqual([]);
    const finding = /** @type {Object} */ (
      answer.findings.find(
        (entry) => entry.code === ATTRIBUTION_REASON.ATTRIBUTION_TEAM_NO_CONFLICT
      )
    );
    expect(finding.details.transitionsExamined).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Acceptance 2 — the minimal blocking set                                     */
/* -------------------------------------------------------------------------- */

/**
 * **Constructed**, and here is what the corpus supplied and what was built.
 *
 * The corpus supplies: an unlit venue, its permit close, that date's sunset, and
 * two games standing on one surface. What is constructed is a single slot no
 * corpus row occupies — one of those two games moved to the minute its venue's
 * permit closes, and the other asked to stand on top of it. That breaks three
 * things at once, which is what an over-constrained placement is, and every
 * number in it is still the corpus's.
 */
function overConstrained() {
  /** @type {Map<string, { date: string, surfaceId: string, venueId: string, games: Object[] }>} */
  const groups = new Map();
  for (const game of schedule.games) {
    if (game.endMinutes === null) continue;
    const key = `${game.date}|${game.surfaceId}`;
    if (!groups.has(key)) {
      groups.set(key, {
        date: game.date,
        surfaceId: game.surfaceId,
        venueId: game.venueId,
        games: [],
      });
    }
    /** @type {Object} */ (groups.get(key)).games.push(game);
  }

  /** @type {Array<{ date: string, surfaceId: string, venueId: string, closeMinutes: number, games: Object[] }>} */
  const candidates = [];
  for (const { date, surfaceId, venueId, games } of groups.values()) {
    if (games.length < 2) continue;
    // The venue must be unlit and the date must have a sunset, or the daylight
    // rule does not apply and the placement breaks two constraints, not three.
    if (resolveLighting(graph, calendar, surfaceId).lit) continue;
    const permit = resolvePermitWindow(calendar, { venueId, date });
    if (permit.window === null || permit.window.closeMinutes === null) continue;
    candidates.push({
      date,
      surfaceId,
      venueId,
      closeMinutes: permit.window.closeMinutes,
      games: [...games].sort((a, b) => a.startMinutes - b.startMinutes),
    });
  }
  candidates.sort(
    (a, b) =>
      b.games.length - a.games.length ||
      b.date.localeCompare(a.date) ||
      a.surfaceId.localeCompare(b.surfaceId)
  );

  const chosen = candidates[0];
  const [anchor, subject] = chosen.games;
  const stackedSchedule = {
    ...schedule,
    games: schedule.games.map((game) =>
      game.id === anchor.id
        ? {
            ...game,
            startMinutes: chosen.closeMinutes,
            endMinutes:
              chosen.closeMinutes + /** @type {number} */ (anchor.endMinutes - anchor.startMinutes),
          }
        : game
    ),
  };
  return {
    chosen,
    anchor,
    subject,
    slot: {
      date: chosen.date,
      surfaceId: chosen.surfaceId,
      startMinutes: chosen.closeMinutes,
    },
    stackedContext: buildAttributionContext({
      graph,
      table,
      calendar,
      registry,
      schedule: stackedSchedule,
      verification,
      venueComplexes,
      roster,
    }),
  };
}

const over = overConstrained();

/**
 * Is `constraintIds` a minimal blocking set for this placement, checked
 * independently of the module that reported it?
 *
 * Deliberately a second implementation *of the property*, not of the search: the
 * property is what the acceptance test is about, and reading the module's own
 * `certified` flag would be the module marking its own homework.
 *
 * @param {Object} attributionContext
 * @param {string} gameId
 * @param {Object} slot
 * @param {ReadonlyArray<string>} constraintIds
 * @returns {{ sufficient: boolean, eachNecessary: boolean, minimal: boolean }}
 */
function verifyMinimality(attributionContext, gameId, slot, constraintIds) {
  /**
   * @param {ReadonlyArray<string>} relaxedIds
   * @returns {boolean}
   */
  const legalWith = (relaxedIds) =>
    checkPlacement(
      {
        ...attributionContext.engines,
        registry: softened(attributionContext.engines.registry, relaxedIds),
      },
      attributionContext.state,
      gameId,
      slot
    ).legal;
  const sufficient = legalWith(constraintIds);
  const eachNecessary = constraintIds.every(
    (constraintId) => !legalWith(constraintIds.filter((id) => id !== constraintId))
  );
  return { sufficient, eachNecessary, minimal: sufficient && eachNecessary };
}

/**
 * A registry with these constraints softened to preferences, rebuilt from the
 * records here rather than through the projection helper the module under test
 * uses. Two routes to the same registry, so the check above is independent of
 * the search it is checking.
 *
 * @param {Object} source
 * @param {ReadonlyArray<string>} constraintIds
 * @returns {Object}
 */
function softened(source, constraintIds) {
  const soften = new Set(constraintIds);
  return buildConstraintRegistry({
    name: source.name,
    source: source.source,
    constraints: source.constraints.map((record) =>
      soften.has(record.id)
        ? { ...record, type: CONSTRAINT_TYPE.PREFERENCE, weight: record.weight ?? 1 }
        : record
    ),
  });
}

describe('attribution :: acceptance 2 — a minimal blocking set, not the registry', () => {
  const result = minimalBlockingSet(over.stackedContext, {
    gameId: over.subject.id,
    slot: over.slot,
  });

  it('is over-constrained in the first place, by three separate things', () => {
    // The meta-assertion this whole block rests on. A placement blocked by one
    // constraint would produce a "minimal set" of one and prove nothing.
    const placement = checkPlacement(
      { graph, table, calendar, registry },
      over.stackedContext.state,
      over.subject.id,
      over.slot
    );
    expect(placement.legal).toBe(false);
    expect(placement.blockingCodes.length).toBeGreaterThanOrEqual(3);
    expect(placement.blockingCodes).toContain(AVAILABILITY_REASON.PERMIT_CLOSE_EXCEEDED);
    expect(placement.blockingCodes).toContain(AVAILABILITY_REASON.SUNSET_MARGIN_VIOLATED);
    expect(placement.blockingCodes).toContain('OCCUPIED_SAME_SURFACE');
  });

  it('names 3 constraints out of the registry’s 14, each with its own numbers', () => {
    expect(result.blocked).toBe(true);
    expect(result.constraintIds.length).toBeGreaterThanOrEqual(2);
    expect(result.constraintIds.length).toBeLessThanOrEqual(3);
    expect(result.constraintIds).toEqual(
      [
        SEASON_2026_CONSTRAINT_ID.FIELD_SAME_GROUND_EXCLUSIVE,
        SEASON_2026_CONSTRAINT_ID.PERMIT_WINDOW,
        SEASON_2026_CONSTRAINT_ID.SUNSET_MARGIN,
      ].sort()
    );
    // "Do not dump the whole registry": the denominator is reported so three of
    // fourteen is legible as three of fourteen.
    expect(result.proof.registryConstraintsHeld).toBe(registry.constraintIds.length);
    expect(result.constraintIds.length).toBeLessThan(registry.constraintIds.length);
    expect(result.ungovernedBlockingCodes).toEqual([]);

    // Every member arrives as an instance with computed values, not as an id.
    expect(result.claims.length).toBe(result.constraintIds.length);
    for (const claim of result.claims) {
      expect(isSpecificClaim(claim), claim.kind).toBe(true);
      expect(Object.keys(claim.computed).length).toBeGreaterThan(0);
      expect(claim.constraintIds.length).toBeGreaterThan(0);
    }
    const permitClaim = /** @type {Object} */ (
      result.claims.find((claim) =>
        claim.constraintIds.includes(SEASON_2026_CONSTRAINT_ID.PERMIT_WINDOW)
      )
    );
    expect(permitClaim.computed.closeMinutes).toBe(over.chosen.closeMinutes);
    expect(permitClaim.computed.overrunMinutes).toBeGreaterThan(0);
  });

  it('proves every member necessary, and hands back the proof', () => {
    expect(result.certified).toBe(true);
    expect(result.proof.legalWhenAllRelaxed).toBe(true);
    expect(result.witnesses.length).toBe(result.constraintIds.length);
    for (const witness of result.witnesses) {
      // Dropping this member changes the answer: with every *other* member
      // relaxed the placement is still illegal, and the code that survives is
      // this member's own.
      expect(witness.legal, witness.constraintId).toBe(false);
      expect(witness.relaxedConstraintIds).toEqual(
        result.constraintIds.filter((id) => id !== witness.constraintId)
      );
      expect(witness.blockingCodes.length).toBeGreaterThan(0);
    }
    expect(result.meta.membersProvenNecessary).toBe(result.constraintIds.length);
    expect(result.meta.relaxationsTested).toBeGreaterThan(result.constraintIds.length);
    expect(result.proof.candidatesConsidered).toBe(result.candidateConstraintIds.length);
    expect(result.proof.membersReported).toBe(result.constraintIds.length);

    // The proof is stated as a finding too, with the counters behind it, so a
    // reader who never opens `witnesses` still sees how it was established.
    const proven = /** @type {Object} */ (
      result.findings.find(
        (finding) => finding.code === ATTRIBUTION_REASON.ATTRIBUTION_MINIMAL_SET_PROVEN
      )
    );
    expect(proven).toBeDefined();
    expect(proven.details.witnessCount).toBe(result.witnesses.length);
    expect(proven.details.registryConstraintsHeld).toBe(registry.constraintIds.length);
  });

  it('is minimal when checked independently — and a padded set is not', () => {
    // The property, re-established from outside the module.
    const verdict = verifyMinimality(
      over.stackedContext,
      over.subject.id,
      over.slot,
      result.constraintIds
    );
    expect(verdict.sufficient).toBe(true);
    expect(verdict.eachNecessary).toBe(true);
    expect(verdict.minimal).toBe(true);

    // The positive control that makes the check above worth reading: a set that
    // is merely *short* is not minimal, and the same check says so. Padding the
    // reported set with one constraint that has nothing to do with this
    // placement keeps it under three and breaks minimality.
    const padded = [...result.constraintIds, SEASON_2026_CONSTRAINT_ID.TURNOVER_FLOOR_GLOBAL];
    const paddedVerdict = verifyMinimality(over.stackedContext, over.subject.id, over.slot, padded);
    expect(paddedVerdict.sufficient).toBe(true);
    expect(paddedVerdict.eachNecessary).toBe(false);
    expect(paddedVerdict.minimal).toBe(false);
    // …and the module did not report that padded set.
    expect(result.constraintIds).not.toContain(SEASON_2026_CONSTRAINT_ID.TURNOVER_FLOOR_GLOBAL);
  });

  it('drops a candidate that turns out to be unnecessary', () => {
    // The control that proves the deletion filter is a search rather than a
    // rename of "the constraints the codes implied". A venue-scoped record
    // claiming the same daylight code outranks the global one wherever it
    // applies, so relaxing the global one alone changes nothing and it is
    // dropped — leaving a set that is smaller than its own candidate list.
    const shadowed = buildSeason2026ConstraintRegistry({
      extraConstraints: [
        {
          id: 'sunset-margin-at-this-venue',
          policy: 'sunset-margin',
          name: 'Daylight margin, stated again for one venue',
          type: CONSTRAINT_TYPE.HARD,
          scope: { kind: CONSTRAINT_SCOPE_KIND.VENUE, venueId: over.chosen.venueId },
          parameters: {},
          restrictiveDirection: 'none',
          rationale:
            'Constructed by tests/attribution.test.js: a narrower record claiming the same code, so that the global one becomes an unnecessary candidate and the deletion filter has something real to drop.',
          source: {
            setBy: 'tests/attribution.test.js',
            setAt: null,
            reference: 'tests/attribution.test.js — the deletion-filter control',
            note: 'constructed for a test; never part of the seeded season-2026 set',
          },
          effectiveFrom: null,
          effectiveTo: null,
          enforcement: CONSTRAINT_ENFORCEMENT.REASON_CODES,
          reasonCodes: [AVAILABILITY_REASON.SUNSET_MARGIN_VIOLATED],
          weight: null,
          waivable: false,
          history: [],
        },
      ],
    });
    const shadowedContext = {
      ...over.stackedContext,
      engines: { ...over.stackedContext.engines, registry: shadowed },
    };
    const shadowedResult = minimalBlockingSet(shadowedContext, {
      gameId: over.subject.id,
      slot: over.slot,
    });

    expect(shadowedResult.candidateConstraintIds).toContain(
      SEASON_2026_CONSTRAINT_ID.SUNSET_MARGIN
    );
    expect(shadowedResult.candidateConstraintIds).toContain('sunset-margin-at-this-venue');
    expect(shadowedResult.droppedConstraintIds).toEqual([SEASON_2026_CONSTRAINT_ID.SUNSET_MARGIN]);
    expect(shadowedResult.constraintIds).toContain('sunset-margin-at-this-venue');
    expect(shadowedResult.constraintIds.length).toBe(
      shadowedResult.candidateConstraintIds.length - 1
    );
    expect(shadowedResult.certified).toBe(true);
    expect(shadowedResult.meta.membersDropped).toBe(1);
  });

  it('says so when a blocker cannot be lifted by any change of hardness', () => {
    // The corpus's four `Scrimmage` rows are blocked by `SIZE_UNKNOWN_FORMAT`
    // (GAP-14), which no constraint in the registry claims. A "minimal
    // explanation" that quietly omitted it would be the most confident kind of
    // wrong, so the set is left uncertified and the code is named.
    const unliftable = /** @type {Object} */ (
      sweep.attributions.find((attribution) => !attribution.legal)
    );
    expect(unliftable).toBeDefined();
    const answer = minimalBlockingSet(context, { gameId: unliftable.gameId });
    expect(answer.blocked).toBe(true);
    expect(answer.ungovernedBlockingCodes.length).toBeGreaterThan(0);
    expect(answer.certified).toBe(false);
    expect(answer.witnesses).toEqual([]);
    expect(answer.proof.legalWhenAllRelaxed).toBe(false);
    const codes = answer.findings.map((finding) => finding.code);
    expect(codes).toContain(ATTRIBUTION_REASON.ATTRIBUTION_BLOCKER_UNGOVERNED);
    // …and the set is not merely uncertified, it is refused: relaxing every
    // candidate left the placement illegal, so there is no blocking set to
    // report and saying otherwise would be a minimality claim resting on
    // nothing.
    expect(codes).toContain(ATTRIBUTION_REASON.ATTRIBUTION_MINIMAL_SET_UNCERTIFIED);
    expect(answer.status).toBe(ATTRIBUTION_STATUS.REJECTED);
  });

  it('has no answer, rather than an empty one, for a placement that is legal', () => {
    const legal = /** @type {Object} */ (
      sweep.attributions.find((attribution) => attribution.legal)
    );
    const answer = minimalBlockingSet(context, { gameId: legal.gameId });
    expect(answer.blocked).toBe(false);
    expect(answer.constraintIds).toEqual([]);
    expect(answer.findings.map((finding) => finding.code)).toContain(
      ATTRIBUTION_REASON.ATTRIBUTION_PLACEMENT_NOT_BLOCKED
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Structural — the module answers questions, it does not decide them          */
/* -------------------------------------------------------------------------- */

describe('attribution :: every declared reason code is reachable', () => {
  it('fires all but the two that guard a state this corpus cannot reach', () => {
    // "Declared is not enforced" applied to this module's own vocabulary: a
    // reason code nothing can emit is a promise nothing keeps. The answers below
    // are recomputed here so the check does not depend on the order the other
    // tests ran in.
    /** @type {Set<string>} */
    const fired = new Set();
    /** @param {{ findings: ReadonlyArray<{ code: string }> }} answer */
    const record = (answer) => {
      for (const finding of answer.findings) fired.add(finding.code);
    };

    record(buildAttributionContext({ graph, table, calendar, registry, schedule }));
    record(explainSchedule({ ...context, schedule: { ...schedule, games: [] } }));
    record(explainGame(context, { gameId: 'not-a-game' }));
    record(
      explainKickoffTime(context, {
        gameId: latePublished.gameId,
        insteadOfMinutes: latePublished.startMinutes,
        insteadOfSurfaceId: latePublished.surfaceId,
        insteadOfDate: latePublished.date,
      })
    );
    record(
      explainKickoffTime(context, {
        gameId: schedule.games[0].id,
        insteadOfMinutes: schedule.games[0].startMinutes,
      })
    );
    for (const game of schedule.games) {
      const kickoffs = [
        ...new Set(
          schedule.games
            .filter((entry) => entry.date === game.date && entry.venueId === game.venueId)
            .map((entry) => entry.startMinutes)
        ),
      ];
      const legal = kickoffs
        .filter((minutes) => minutes !== game.startMinutes)
        .map((minutes) =>
          explainKickoffTime(context, { gameId: game.id, insteadOfMinutes: minutes })
        )
        .find((answer) => answer.counterfactual.legal);
      if (legal) {
        record(legal);
        break;
      }
    }
    record(
      explainEarliestKickoff(context, {
        surfaceId: PITCH_2,
        date: busyDate,
        format: '11v11',
        notBeforeMinutes: floor,
      })
    );
    record(
      explainEarliestKickoff(context, {
        surfaceId: PITCH_2,
        date: busyDate,
        format: '11v11',
        warmupMinutes: WARMUP,
        notBeforeMinutes: Math.max(
          ...schedule.games
            .filter((game) => game.date === busyDate && game.endMinutes !== null)
            .map((game) => /** @type {number} */ (game.endMinutes))
        ),
      })
    );
    record(explainTeamConflict(context, { teamId: 'U12B04' }));
    record(
      explainTeamConflict(context, {
        teamId: /** @type {string} */ (
          schedule.teamUniverse.find(
            (teamId) =>
              !(
                /** @type {Object} */ (context.travel).transitions.some(
                  (transition) =>
                    (transition.from.teamId === teamId || transition.to.teamId === teamId) &&
                    transition.findings.some((finding) => finding.severity !== 'info')
                )
              )
          )
        ),
      })
    );
    record(minimalBlockingSet(over.stackedContext, { gameId: over.subject.id, slot: over.slot }));
    record(
      minimalBlockingSet(context, {
        gameId: /** @type {Object} */ (sweep.attributions.find((attribution) => !attribution.legal))
          .gameId,
      })
    );
    record(
      minimalBlockingSet(context, {
        gameId: /** @type {Object} */ (sweep.attributions.find((attribution) => attribution.legal))
          .gameId,
      })
    );

    // Meta-assertion: this collected a real population rather than nothing.
    expect(fired.size).toBeGreaterThan(10);

    const unfired = Object.values(ATTRIBUTION_REASON)
      .filter((code) => !fired.has(code))
      .sort();
    // The two that remain are guards for states the *published* season does not
    // contain, and both are named here rather than left to be discovered:
    //
    // - `ATTRIBUTION_CLAIM_CATEGORY_ONLY` needs a finding carrying neither an
    //   identifier nor a number. Every finding the six source modules can emit
    //   carries at least one, which is why the sweep's 1,900-odd claims are all
    //   specific; the predicate behind it is exercised directly instead, with
    //   its own positive control.
    // - `ATTRIBUTION_GAME_UNATTRIBUTED` needs a game the schedule holds, the
    //   state holds, and no constraint or finding says anything about. Every
    //   venue in this corpus has a permit record, so the permit bound alone
    //   attributes all 679.
    expect(unfired).toEqual(
      [
        ATTRIBUTION_REASON.ATTRIBUTION_CLAIM_CATEGORY_ONLY,
        ATTRIBUTION_REASON.ATTRIBUTION_GAME_UNATTRIBUTED,
      ].sort()
    );
  });
});

describe('attribution :: structural', () => {
  /**
   * @param {string} dir
   * @returns {string[]}
   */
  function filesUnder(dir) {
    /** @type {string[]} */
    const files = [];
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) files.push(...filesUnder(full));
      else if (entry.endsWith('.js')) files.push(full);
    }
    return files;
  }

  const files = filesUnder(path.join(CORE, 'attribution'));
  const sources = files.map((file) => ({
    file,
    text: readFileSync(file, 'utf8'),
    /** Prose quotes the machinery it explains, so the checks below read code only. */
    code: readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
  }));

  it('scans a plausible number of files', () => {
    // The meta-assertion the rest of this block rests on.
    expect(files.length).toBeGreaterThanOrEqual(7);
    expect(sources.every((source) => source.text.length > 0)).toBe(true);
  });

  it('re-implements none of the machinery it reports', () => {
    // The named functions are the ones that decide the things this module
    // explains. Calling any of them here would be a second answer free to
    // disagree with the first.
    for (const source of sources) {
      for (const forbidden of [
        'surfacesConflict',
        'checkOccupancy',
        'checkFieldEligibility',
        'resolvePermitWindow',
        'daylightLimitMinutes',
        'sunsetOn',
        'formatTimingOrUnknown',
        'occupancyEndMinutes',
        'warmupMinutesFor',
      ]) {
        expect(source.code.includes(forbidden), `${source.file} :: ${forbidden}`).toBe(false);
      }
    }
  });

  it('sorts claims in exactly one place', () => {
    const declaring = sources.filter((source) => /function tightnessKey\b/.test(source.code));
    expect(declaring.map((source) => path.basename(source.file))).toEqual(['claims.js']);
    const merging = sources.filter((source) =>
      /function mergeClaimsByTightness\b/.test(source.code)
    );
    expect(merging.map((source) => path.basename(source.file))).toEqual(['claims.js']);
  });

  it('constructs no Date anywhere', () => {
    for (const source of sources) {
      expect(/new Date\b/.test(source.text), source.file).toBe(false);
      expect(/Date\.now\b/.test(source.text), source.file).toBe(false);
      expect(/toISOString/.test(source.text), source.file).toBe(false);
    }
  });

  it('leaves the shipping solvers and the frontend alone', () => {
    for (const source of sources) {
      expect(/from '.*autoScheduler\.js'/.test(source.code), source.file).toBe(false);
      expect(/from '.*gameMetrics\.js'/.test(source.code), source.file).toBe(false);
      expect(/from '.*gameScheduling\.js'/.test(source.code), source.file).toBe(false);
      expect(/from '.*fixtures\//.test(source.code), source.file).toBe(false);
      expect(/from 'react/.test(source.code), source.file).toBe(false);
      expect(/from 'node:/.test(source.code), source.file).toBe(false);
    }
  });

  it('registers every new export in the package barrel', () => {
    const barrel = readFileSync(path.join(CORE, 'attribution', 'index.js'), 'utf8');
    for (const name of [
      'ATTRIBUTION_REASON',
      'ATTRIBUTION_QUESTION',
      'buildAttributionContext',
      'explainGame',
      'explainSchedule',
      'explainKickoffTime',
      'explainLatestKickoff',
      'explainEarliestKickoff',
      'explainTeamConflict',
      'minimalBlockingSet',
      'isSpecificClaim',
      'mergeClaimsByTightness',
    ]) {
      expect(barrel, name).toContain(name);
    }
    // And the two lookups it borrowed are exported from the module that owns
    // them rather than copied into this one.
    const resolveBarrel = readFileSync(path.join(CORE, 'resolve', 'index.js'), 'utf8');
    expect(resolveBarrel).toContain('violationsAbout');
    expect(resolveBarrel).toContain('registryConstraintIdsFor');
  });
});
