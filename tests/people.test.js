/**
 * Tests for the person-centric model (`packages/core/src/people/`) — Prompt 3.1.
 *
 * The build plan gives four acceptance tests, and each has its own `describe`
 * below, named after it. Two of them the corpus supplies outright; two need a
 * constructed scenario, and each says so where it is constructed rather than
 * leaving a reader to wonder.
 *
 * **Meta-assertion discipline.** Incident 4 is a validator whose join matched
 * zero records and reported a perfect score, and Phase 2's own review found
 * meta-assertions that could not fail — a coverage set compared against itself,
 * a subject set derived from the data a break would corrupt. So every
 * behavioural check here also asserts it examined a non-zero number of records
 * against a number derived from a *different* source than the check itself, and
 * the checks whose failure mode matters are given an explicit positive control:
 * a mutated input that makes them fail. Where a control is present it is
 * labelled "positive control".
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import {
  CONSTRAINT_TYPE,
  SEASON_2026_CONSTRAINT_ID,
  buildConstraintRegistry,
  buildSeason2026ConstraintRegistry,
  requireConstraint,
  retypeConstraint,
} from '@squadlogic/core/constraints/index.js';
import {
  EMPTY_VENUE_COMPLEX_MAP,
  buildSeason2026VenueComplexMap,
} from '@squadlogic/core/facility/index.js';
import {
  findSingleCoachGames,
  loadCoachRoster,
  loadSeason2026,
} from '@squadlogic/core/fixtures/index.js';
import {
  ASSIGNMENT_STATUS,
  ATTENDANCE_OUTCOME,
  COMMITMENT_SOURCE,
  COMMITMENT_SOURCES,
  IDENTITY_DEFAULTS,
  IDENTITY_REVIEW_STATE,
  IDENTITY_SIGNAL,
  IDENTITY_SIGNAL_WEIGHT,
  MUST_ATTEND_BASIS,
  PEOPLE_REASON,
  PEOPLE_REASON_SEVERITY,
  PEOPLE_SEVERITY,
  PEOPLE_STATUS,
  PERSONAL_CONSTRAINT_KIND,
  CoachAssignmentSchema,
  PersonCommitmentSchema,
  PersonalConstraintSchema,
  applyIdentityDecisions,
  buildCoachRoster,
  buildIdentityReviewQueue,
  buildPersonDays,
  buildPersonalConstraintPolicy,
  buildSeason2026CoachRoster,
  buildSeason2026Timelines,
  coCoachesOf,
  coachSlotOf,
  createTimelineSet,
  deriveMustAttend,
  derivePeopleStatus,
  distinctIdentityCount,
  evaluatePersonDays,
  findAttendanceClashes,
  ingestCommitments,
  isContraction,
  jaroWinkler,
  makePeopleFinding,
  normaliseNamePart,
  peopleSeverityOf,
  personTimeline,
  requireSealedTimelines,
  resolveAttendance,
  scoreIdentityPair,
  sealTimelines,
  sharedPrefixLength,
  soleCoachRiskRegister,
  teamsCoachedBy,
  toSeason2026CommitmentBatches,
  toTravelCommitments,
} from '@squadlogic/core/people/index.js';
import { TRAVEL_REASON, evaluateCoachTravel } from '@squadlogic/core/waivers/index.js';

/* -------------------------------------------------------------------------- */
/* The corpus, loaded once                                                     */
/* -------------------------------------------------------------------------- */

const season = loadSeason2026();
const registry = buildSeason2026ConstraintRegistry();
const venueComplexes = buildSeason2026VenueComplexMap();
const roster = buildSeason2026CoachRoster(season.assignments);
const timelines = buildSeason2026Timelines(season, roster);

/** Codes of a finding list, for terse assertions. */
const codesOf = (findings) => findings.map((finding) => finding.code);

/** How many findings carry each code. */
function countByCode(findings) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const finding of findings) counts[finding.code] = (counts[finding.code] ?? 0) + 1;
  return counts;
}

/* -------------------------------------------------------------------------- */
/* A synthetic club, for the cases the corpus does not contain                  */
/* -------------------------------------------------------------------------- */

const DATE = '2026-08-22';
const OTHER_DATE = '2026-08-29';

/** Minutes past midnight from `HH:MM`, so the fixtures read like a schedule. */
function at(clock) {
  const [hours, minutes] = clock.split(':').map(Number);
  return hours * 60 + minutes;
}

function makePerson(id, givenName, familyName) {
  return { id, givenName, familyName, displayName: `${givenName} ${familyName}`, aliases: [] };
}

/** @param {string} [status] */
function makeAssignment(personId, teamId, slot, status = ASSIGNMENT_STATUS.ASSIGNED) {
  return {
    id: `${teamId}|${personId}|${slot}`,
    personId,
    teamId,
    slot,
    status,
    effectiveFrom: null,
    effectiveTo: null,
    source: 'test',
  };
}

function makeCommitment(overrides) {
  return {
    id: 'c1',
    personId: 'p1',
    date: DATE,
    startMinutes: at('09:00'),
    endMinutes: at('10:00'),
    venueId: 'venue-1',
    surfaceId: 'venue-1::field-1',
    teamId: 'team-a',
    gameId: 'g1',
    label: null,
    source: COMMITMENT_SOURCE.CLUB_FIXTURE,
    ...overrides,
  };
}

/** Ingest one batch and seal, for the many tests that need nothing else. */
function timelineOf(commitments, options = {}) {
  const source = options.source ?? COMMITMENT_SOURCE.CLUB_FIXTURE;
  return sealTimelines(ingestCommitments(createTimelineSet(), commitments, { source }), {
    requiredSources: options.requiredSources ?? [source],
  });
}

/* -------------------------------------------------------------------------- */
/* Reason codes and severity                                                    */
/* -------------------------------------------------------------------------- */

describe('people :: reason codes and severity', () => {
  it('registers a severity for every code it can emit, and refuses one it cannot', () => {
    const codes = Object.values(PEOPLE_REASON);
    expect(codes.length).toBeGreaterThan(20);
    for (const code of codes) {
      expect(PEOPLE_REASON_SEVERITY[code], code).toBeDefined();
      expect(Object.values(PEOPLE_SEVERITY)).toContain(PEOPLE_REASON_SEVERITY[code]);
    }
    // Every registered code is a code the enum can produce — no orphans that
    // nothing emits and nothing would notice going stale.
    expect(Object.keys(PEOPLE_REASON_SEVERITY).sort()).toEqual([...codes].sort());
    expect(() => peopleSeverityOf('NOT_A_PEOPLE_CODE')).toThrow(/no registered severity/);
  });

  it('derives the three-state status mechanically from severities alone', () => {
    expect(derivePeopleStatus([])).toBe(PEOPLE_STATUS.ALLOWED);
    expect(
      derivePeopleStatus([makePeopleFinding(PEOPLE_REASON.TEAM_SOLE_COACH, 'info only')])
    ).toBe(PEOPLE_STATUS.ALLOWED);
    expect(
      derivePeopleStatus([makePeopleFinding(PEOPLE_REASON.TEAM_FALLBACK_TO_CO_COACH, 'soft')])
    ).toBe(PEOPLE_STATUS.COMPROMISED);
    expect(
      derivePeopleStatus([makePeopleFinding(PEOPLE_REASON.TEAM_NO_FALLBACK_AVAILABLE, 'hard')])
    ).toBe(PEOPLE_STATUS.REJECTED);
  });

  it('lets the governing constraint record decide the one policy-governed code', () => {
    const preference = requireConstraint(registry, SEASON_2026_CONSTRAINT_ID.COACH_MAXIMUM_GAP);
    expect(preference.type).toBe(CONSTRAINT_TYPE.PREFERENCE);
    expect(peopleSeverityOf(PEOPLE_REASON.PERSON_DAY_GAP_EXCEEDED, preference)).toBe(
      PEOPLE_SEVERITY.INFO
    );

    const retyped = requireConstraint(
      retypeConstraint(registry, SEASON_2026_CONSTRAINT_ID.COACH_MAXIMUM_GAP, {
        type: CONSTRAINT_TYPE.SOFT,
        by: 'test',
        note: 'the same hole, judged as a cost rather than a wish',
      }),
      SEASON_2026_CONSTRAINT_ID.COACH_MAXIMUM_GAP
    );
    expect(peopleSeverityOf(PEOPLE_REASON.PERSON_DAY_GAP_EXCEEDED, retyped)).toBe(
      PEOPLE_SEVERITY.COMPROMISE
    );
    // …and a code the registry does not govern is unmoved by the same record.
    expect(peopleSeverityOf(PEOPLE_REASON.TEAM_NO_FALLBACK_AVAILABLE, retyped)).toBe(
      PEOPLE_SEVERITY.BLOCKING
    );
  });

  it('keeps a commitment source vocabulary that the schema enforces', () => {
    expect(COMMITMENT_SOURCES).toEqual([...Object.values(COMMITMENT_SOURCE)].sort());
    expect(() =>
      PersonCommitmentSchema.parse(makeCommitment({ source: 'invented-source' }))
    ).toThrow();
    // No default: a commitment that does not say where it came from is a
    // timeline that cannot tell "ingested" from "assumed absent".
    const { source, ...sourceless } = makeCommitment({});
    void source;
    expect(() => PersonCommitmentSchema.parse(sourceless)).toThrow();
  });

  it('refuses a commitment that ends before it starts, and any unknown field', () => {
    expect(() =>
      PersonCommitmentSchema.parse(makeCommitment({ startMinutes: 600, endMinutes: 540 }))
    ).toThrow(/may not end before it starts/);
    expect(() =>
      PersonCommitmentSchema.parse({ ...makeCommitment({}), cachedConflict: true })
    ).toThrow();
    // An unknown end stays representable (GAP-14) rather than being coerced.
    expect(
      PersonCommitmentSchema.parse(makeCommitment({ endMinutes: null })).endMinutes
    ).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* The roster (GAP-20, GAP-22, GAP-23)                                          */
/* -------------------------------------------------------------------------- */

describe('people :: the coach roster', () => {
  it('re-derives the corpus’s own roster shape from the roster file', () => {
    // Every number here is checked against the corpus rather than typed from
    // the README: `season.teams` / `season.people` / `season.assignments` come
    // from a different assembly path (`fixtures/season2026Loader.js`), so an
    // adapter that lost a row disagrees with them.
    expect(roster.status).toBe(PEOPLE_STATUS.ALLOWED);
    expect(roster.findings).toEqual([]);
    expect(roster.meta.assignmentsExamined).toBe(season.assignments.length);
    expect(roster.meta.assignmentsExamined).toBe(215);
    expect(roster.meta.assignmentsActive).toBe(215);
    expect(roster.teams.size).toBe(season.teams.length);
    expect(roster.teams.size).toBe(132);
    expect(roster.peopleById.size).toBe(season.people.length);
    expect(roster.peopleById.size).toBe(196);
    expect(roster.meta.multiTeamPeople).toBe(19);
  });

  it('keeps the coach slot as an order, not a boolean', () => {
    const sizes = { 1: 0, 2: 0, 3: 0 };
    for (const team of roster.teams.values()) sizes[team.personIds.length] += 1;
    // "81 teams have 2 coaches, 50 have 1, 1 has 3."
    expect(sizes).toEqual({ 1: 50, 2: 81, 3: 1 });

    let slotsChecked = 0;
    for (const team of roster.teams.values()) {
      const slots = team.slots.map((assignment) => assignment.slot);
      expect(slots, team.teamId).toEqual([...slots].sort((a, b) => a - b));
      expect(new Set(slots).size, team.teamId).toBe(slots.length);
      expect(slots[0], team.teamId).toBe(1);
      slotsChecked += slots.length;
    }
    expect(slotsChecked).toBe(215);
  });

  it('excludes an assignment that is not active, and says so in the counters', () => {
    // Positive control for the sole-coach register below: withdrawing the
    // second coach of a two-coach team must move that team into the register.
    const twoCoach = [...roster.teams.values()].find((team) => team.personIds.length === 2);
    expect(twoCoach).toBeDefined();
    const withdrawn = season.assignments.map((row) =>
      row.teamCode === twoCoach.teamId && row.personKey === twoCoach.personIds[1]
        ? { ...row, status: 'Withdrawn' }
        : row
    );
    expect(withdrawn.filter((row) => row.status === 'Withdrawn')).toHaveLength(1);

    const damaged = buildSeason2026CoachRoster(withdrawn);
    expect(damaged.meta.assignmentsActive).toBe(214);
    expect(damaged.meta.assignmentsInactive).toBe(1);
    expect(damaged.teams.get(twoCoach.teamId).personIds).toEqual([twoCoach.personIds[0]]);

    const before = soleCoachRiskRegister(roster).teams.length;
    const after = soleCoachRiskRegister(damaged).teams.length;
    expect(after).toBe(before + 1);
  });

  it('reports a duplicate slot and an unknown person instead of guessing', () => {
    const clash = buildCoachRoster({
      people: [makePerson('p1', 'Ada', 'Stone'), makePerson('p2', 'Bo', 'Stone')],
      assignments: [makeAssignment('p1', 'team-a', 1), makeAssignment('p2', 'team-a', 1)],
    });
    expect(codesOf(clash.findings)).toContain(PEOPLE_REASON.ASSIGNMENT_SLOT_DUPLICATE);
    expect(clash.status).toBe(PEOPLE_STATUS.REJECTED);

    const orphan = buildCoachRoster({
      people: [makePerson('p1', 'Ada', 'Stone')],
      assignments: [makeAssignment('p1', 'team-a', 1), makeAssignment('ghost', 'team-a', 2)],
    });
    expect(codesOf(orphan.findings)).toContain(PEOPLE_REASON.ASSIGNMENT_PERSON_UNKNOWN);
    expect(orphan.teams.get('team-a').personIds).toEqual(['p1']);
  });

  it('says out loud when every assignment is inactive', () => {
    const empty = buildCoachRoster({
      people: [makePerson('p1', 'Ada', 'Stone')],
      assignments: [makeAssignment('p1', 'team-a', 1, ASSIGNMENT_STATUS.DECLINED)],
    });
    expect(codesOf(empty.findings)).toContain(PEOPLE_REASON.ROSTER_EMPTY);
    expect(empty.status).toBe(PEOPLE_STATUS.REJECTED);
  });

  it('refuses a status the vocabulary does not know rather than defaulting', () => {
    expect(() =>
      buildSeason2026CoachRoster([
        {
          teamCode: 'team-a',
          personKey: 'p1',
          firstName: 'Ada',
          lastName: 'Stone',
          coachSlot: 1,
          status: 'Maybe',
        },
      ])
    ).toThrow(/not a known status/);
  });
});

/* -------------------------------------------------------------------------- */
/* Requirement 6 — the sole-coach risk register                                 */
/* -------------------------------------------------------------------------- */

describe('people :: requirement 6, the sole-coach risk register', () => {
  const register = soleCoachRiskRegister(roster);

  it('reports every team with exactly one coach, because they have no fallback', () => {
    expect(register.meta.teamsExamined).toBe(132);
    expect(register.teams).toHaveLength(50);
    expect(register.meta.soleCoachTeams).toBe(50);
    // Cross-checked against a count taken straight off the roster rows rather
    // than off the register's own indexes.
    const perTeam = new Map();
    for (const row of season.assignments) {
      perTeam.set(row.teamCode, (perTeam.get(row.teamCode) ?? 0) + 1);
    }
    expect([...perTeam.values()].filter((count) => count === 1)).toHaveLength(50);

    for (const entry of register.teams) {
      expect(entry.slot).toBe(1);
      expect(coCoachesOf(roster, entry.teamId, entry.personId)).toEqual([]);
    }
    expect(countByCode(register.findings)[PEOPLE_REASON.TEAM_SOLE_COACH]).toBe(50);
    // A standing absence of fallback is not a violation: 50 of them and the
    // season still ran.
    expect(register.status).toBe(PEOPLE_STATUS.COMPROMISED);
  });

  it('escalates the person who is the sole coach of more than one team', () => {
    expect(register.people).toHaveLength(2);
    for (const entry of register.people) {
      expect(entry.teamIds.length).toBeGreaterThanOrEqual(2);
      for (const teamId of entry.teamIds) {
        expect(roster.teams.get(teamId).personIds).toEqual([entry.personId]);
      }
    }
    expect(countByCode(register.findings)[PEOPLE_REASON.PERSON_SOLE_COACH_OF_MULTIPLE_TEAMS]).toBe(
      2
    );
  });

  it('reports an empty scan as a failure, not as a clean register', () => {
    // Positive control: the vacuity finding exists to catch a roster join that
    // matched nothing, so it is exercised against exactly that.
    const nothing = soleCoachRiskRegister(
      buildCoachRoster({ people: [makePerson('p1', 'Ada', 'Stone')], assignments: [] })
    );
    expect(nothing.meta.teamsExamined).toBe(0);
    expect(codesOf(nothing.findings)).toContain(PEOPLE_REASON.SOLE_COACH_SCAN_VACUOUS);
    expect(nothing.status).toBe(PEOPLE_STATUS.COMPROMISED);
  });

  /**
   * **Finding 1 of the Milestone 3 review.** The previous version of this test
   * forged the state it checked — it reached into `roster.teams` and put an
   * empty team there by hand, which is exactly incident 4's shape: a check that
   * passes because the test manufactured a state the real code could not
   * produce. Everything below comes from ordinary adapter input, and it asserts
   * the other half of the damage as well: an absent team's fixtures leave the
   * corpus with nothing said about them.
   */
  it('reports a team whose coaches have all declined, from ordinary roster input', () => {
    // Chosen from the corpus rather than named: the first team in id order that
    // actually has fixtures, so the fixture assertions below are about real
    // rows. `fixturesByTeam` is built from `season.combinedGames`, a different
    // assembly path than the roster the assertions are about.
    /** @type {Map<string, string[]>} */
    const fixturesByTeam = new Map();
    for (const game of season.combinedGames) {
      for (const teamId of [game.homeTeamId, game.awayTeamId]) {
        if (!teamId || !roster.teams.has(String(teamId))) continue;
        if (!fixturesByTeam.has(String(teamId))) fixturesByTeam.set(String(teamId), []);
        fixturesByTeam.get(String(teamId)).push(String(game.id));
      }
    }
    const [targetTeamId, targetGameIds] = [...fixturesByTeam.entries()].sort((a, b) =>
      a[0].localeCompare(b[0])
    )[0];
    expect(targetGameIds.length).toBeGreaterThan(0);
    const coachCount = roster.teams.get(targetTeamId).personIds.length;
    expect(coachCount).toBeGreaterThan(0);

    // Ordinary adapter input: the corpus's own rows, with every assignment on
    // that one team declined. Nothing here touches an index.
    const declinedRows = season.assignments.map((row) =>
      row.teamCode === targetTeamId ? { ...row, status: 'Declined' } : row
    );
    expect(declinedRows.filter((row) => row.status === 'Declined')).toHaveLength(coachCount);

    const damaged = buildSeason2026CoachRoster(declinedRows);
    // The team is present-and-uncoached rather than absent: a team the roster
    // names does not stop existing because nobody accepted it.
    expect(damaged.teams.size).toBe(roster.teams.size);
    expect(damaged.teams.get(targetTeamId).personIds).toEqual([]);
    expect(damaged.meta.assignmentsInactive).toBe(coachCount);

    const register = soleCoachRiskRegister(damaged);
    const uncoached = register.findings.filter(
      (finding) => finding.code === PEOPLE_REASON.TEAM_UNCOACHED
    );
    expect(uncoached).toHaveLength(1);
    expect(uncoached[0].details.teamId).toBe(targetTeamId);
    expect(uncoached[0].severity).toBe(PEOPLE_SEVERITY.BLOCKING);
    expect(register.meta.uncoachedTeams).toBe(1);
    expect(register.status).toBe(PEOPLE_STATUS.REJECTED);
    // …and the published corpus has none, so the finding is not simply always on.
    expect(soleCoachRiskRegister(roster).meta.uncoachedTeams).toBe(0);

    // Nobody is left to hold a commitment, so the batch count drops by exactly
    // the commitments those coaches carried — and every fixture that lost its
    // coaches is named rather than silently absent. This is incident 10: a
    // dropped fixture is how a team loses a game.
    const total = (batches) =>
      [...batches.values()].reduce((sum, entries) => sum + entries.length, 0);
    const before = total(toSeason2026CommitmentBatches(season, roster));
    const after = total(toSeason2026CommitmentBatches(season, damaged));
    expect(before - after).toBe(targetGameIds.length * coachCount);

    const damagedTimelines = buildSeason2026Timelines(season, damaged);
    const dropped = damagedTimelines.findings.filter(
      (finding) => finding.code === PEOPLE_REASON.FIXTURE_TEAM_UNCOACHED
    );
    expect(dropped.map((finding) => finding.details.gameId).sort()).toEqual(
      [...targetGameIds].sort()
    );
    for (const finding of dropped) expect(finding.details.teamId).toBe(targetTeamId);
    expect(damagedTimelines.status).toBe(PEOPLE_STATUS.REJECTED);
    // The published corpus reports none of them, so this is not always on either.
    expect(
      timelines.findings.filter((finding) => finding.code === PEOPLE_REASON.FIXTURE_TEAM_UNCOACHED)
    ).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Requirement 1 — the personal timeline, and where pairwise disagrees          */
/* -------------------------------------------------------------------------- */

/**
 * The condemned model, implemented faithfully so the comparison is fair.
 *
 * "Pairwise team comparison" means: for a person coaching teams A and B, take
 * A's schedule and B's schedule and judge every cross-team pair. It reuses the
 * **same** travel judgement as the timeline model, so the only difference
 * between the two answers is *which pairs get judged* — which is precisely the
 * claim under test.
 */
function stripSource(commitment) {
  const { source, ...rest } = commitment;
  void source;
  return rest;
}

function pairwiseTravelFindings(commitments, options) {
  /** @type {Map<string, Map<string, Array<Object>>>} */
  const byPersonTeam = new Map();
  for (const commitment of commitments) {
    if (!byPersonTeam.has(commitment.personId)) byPersonTeam.set(commitment.personId, new Map());
    const teams = byPersonTeam.get(commitment.personId);
    const teamId = String(commitment.teamId);
    if (!teams.has(teamId)) teams.set(teamId, []);
    teams.get(teamId).push(commitment);
  }

  /** @type {Array<Object>} */
  const findings = [];
  let pairsJudged = 0;
  for (const teams of byPersonTeam.values()) {
    const teamIds = [...teams.keys()].sort();
    for (let i = 0; i < teamIds.length; i += 1) {
      for (let j = i + 1; j < teamIds.length; j += 1) {
        for (const left of teams.get(teamIds[i])) {
          for (const right of teams.get(teamIds[j])) {
            if (left.date !== right.date) continue;
            pairsJudged += 1;
            const verdict = evaluateCoachTravel([left, right].map(stripSource), options);
            findings.push(...verdict.findings.filter((finding) => finding.severity !== 'info'));
          }
        }
      }
    }
  }
  return { findings, pairsJudged };
}

describe('people :: requirement 1, personal timeline versus pairwise team comparison', () => {
  /**
   * **Constructed, not from the corpus.** See the corpus test below for why the
   * corpus cannot supply this scenario.
   *
   * One person, coaching team A and team B. On the first date team A plays
   * twice; on the second date it plays twice again, with team B's game landing
   * between them.
   */
  const P = 'coach-1';
  const falseNegativeDay = [
    makeCommitment({
      id: 'a1',
      personId: P,
      date: DATE,
      teamId: 'team-a',
      gameId: 'ga1',
      startMinutes: at('09:00'),
      endMinutes: at('10:00'),
      venueId: 'venue-1',
    }),
    makeCommitment({
      id: 'a2',
      personId: P,
      date: DATE,
      teamId: 'team-a',
      gameId: 'ga2',
      startMinutes: at('10:20'),
      endMinutes: at('11:20'),
      venueId: 'venue-2',
    }),
    makeCommitment({
      id: 'b1',
      personId: P,
      date: DATE,
      teamId: 'team-b',
      gameId: 'gb1',
      startMinutes: at('12:30'),
      endMinutes: at('13:30'),
      venueId: 'venue-2',
    }),
  ];
  const falsePositiveDay = [
    makeCommitment({
      id: 'a3',
      personId: P,
      date: OTHER_DATE,
      teamId: 'team-a',
      gameId: 'ga3',
      startMinutes: at('09:00'),
      endMinutes: at('10:00'),
      venueId: 'venue-1',
    }),
    makeCommitment({
      id: 'a4',
      personId: P,
      date: OTHER_DATE,
      teamId: 'team-a',
      gameId: 'ga4',
      startMinutes: at('10:20'),
      endMinutes: at('11:20'),
      venueId: 'venue-1',
    }),
    makeCommitment({
      id: 'b2',
      personId: P,
      date: OTHER_DATE,
      teamId: 'team-b',
      gameId: 'gb2',
      startMinutes: at('10:45'),
      endMinutes: at('11:45'),
      venueId: 'venue-2',
    }),
  ];
  const travelOptions = { registry, venueComplexes: EMPTY_VENUE_COMPLEX_MAP };

  it('validates a coach whose team plays twice in a day — the case pairwise cannot see', () => {
    const set = timelineOf(falseNegativeDay);
    const day = buildPersonDays(set).find((entry) => entry.date === DATE);
    expect(day.commitments.map((commitment) => commitment.id)).toEqual(['a1', 'a2', 'b1']);
    expect(day.transitions.map((transition) => transition.gapMinutes)).toEqual([20, 70]);
    // The transition pairwise structurally cannot look at: same team, therefore
    // not a cross-team pair.
    expect(day.transitions[0].sameTeam).toBe(true);

    const timelineVerdict = evaluateCoachTravel(toTravelCommitments(set), travelOptions);
    expect(timelineVerdict.meta.transitionsExamined).toBe(2);
    const timelineShortfalls = timelineVerdict.findings.filter(
      (finding) => finding.code === TRAVEL_REASON.TRAVEL_BETWEEN_VENUES_TOO_SHORT
    );
    // 20 minutes to cross town between team A's own two games is a real
    // shortfall against the 60-minute floor.
    expect(timelineShortfalls).toHaveLength(1);
    expect(timelineShortfalls[0].details.fromId).toBe('a1');
    expect(timelineShortfalls[0].details.toId).toBe('a2');
    expect(timelineShortfalls[0].details.gapMinutes).toBe(20);

    const pairwise = pairwiseTravelFindings(falseNegativeDay, travelOptions);
    // Meta-assertion: the pairwise model did run and did judge pairs. A zero
    // here would make "pairwise found nothing" true for the wrong reason.
    expect(pairwise.pairsJudged).toBe(2);
    expect(
      pairwise.findings.filter(
        (finding) => finding.code === TRAVEL_REASON.TRAVEL_BETWEEN_VENUES_TOO_SHORT
      )
    ).toHaveLength(0);
    // Both answers asserted, and they disagree: the timeline finds the
    // impossibility, pairwise reports a clean day.
    expect(timelineShortfalls.length).toBeGreaterThan(0);
  });

  it('does not invent the journey nobody makes — the false positive pairwise reports', () => {
    const set = timelineOf(falsePositiveDay);
    const day = buildPersonDays(set).find((entry) => entry.date === OTHER_DATE);
    expect(day.commitments.map((commitment) => commitment.id)).toEqual(['a3', 'a4', 'b2']);

    const timelineVerdict = evaluateCoachTravel(toTravelCommitments(set), travelOptions);
    const timelineCodes = countByCode(
      timelineVerdict.findings.filter((finding) => finding.severity !== 'info')
    );
    // The real problem: team A's second game and team B's game overlap.
    expect(timelineCodes[TRAVEL_REASON.TRAVEL_COMMITMENTS_OVERLAP]).toBe(1);
    // And no travel shortfall, because the only cross-venue move on this day
    // is the one out of the overlap.
    expect(timelineCodes[TRAVEL_REASON.TRAVEL_BETWEEN_VENUES_TOO_SHORT]).toBeUndefined();

    const pairwise = pairwiseTravelFindings(falsePositiveDay, travelOptions);
    expect(pairwise.pairsJudged).toBe(2);
    const pairwiseCodes = countByCode(pairwise.findings);
    expect(pairwiseCodes[TRAVEL_REASON.TRAVEL_COMMITMENTS_OVERLAP]).toBe(1);
    // …plus a 45-minute "drive" from team A's *first* game to team B's, which
    // nobody makes: team A's second game sits between them.
    expect(pairwiseCodes[TRAVEL_REASON.TRAVEL_BETWEEN_VENUES_TOO_SHORT]).toBe(1);
    const phantom = pairwise.findings.find(
      (finding) => finding.code === TRAVEL_REASON.TRAVEL_BETWEEN_VENUES_TOO_SHORT
    );
    expect(phantom.details.fromId).toBe('a3');
    expect(phantom.details.toId).toBe('b2');
    expect(phantom.details.gapMinutes).toBe(45);
  });

  it('states why the corpus cannot supply either case', () => {
    // Looked for first, and the reason is a property of the corpus rather than
    // a defence of pairwise: no team plays twice on any date, and no person
    // coaches more than two teams, so every person-day holds at most two
    // commitments and "consecutive" and "cross-team" name the same pair. The
    // day a fixture gains a double-header, this fails loudly.
    const perTeamDate = new Map();
    for (const game of season.combinedGames) {
      for (const teamId of [game.homeTeamId, game.awayTeamId]) {
        if (!teamId || !roster.teams.has(String(teamId))) continue;
        const key = `${teamId}|${game.date}`;
        perTeamDate.set(key, (perTeamDate.get(key) ?? 0) + 1);
      }
    }
    expect(perTeamDate.size).toBeGreaterThan(1000);
    expect([...perTeamDate.values()].filter((count) => count > 1)).toEqual([]);

    const teamsPerPerson = [...roster.assignmentsByPerson.keys()].map(
      (personId) => teamsCoachedBy(roster, personId).length
    );
    expect(teamsPerPerson).toHaveLength(196);
    expect(Math.max(...teamsPerPerson)).toBe(2);

    const days = buildPersonDays(timelines);
    expect(days.length).toBe(1627);
    expect(Math.max(...days.map((day) => day.commitments.length))).toBe(2);
  });

  it('sorts one person’s whole life into a single list, across teams and sources', () => {
    // The person the corpus gives two sources on one day.
    const mixed = buildPersonDays(timelines).filter(
      (day) => new Set(day.commitments.map((commitment) => commitment.source)).size > 1
    );
    expect(mixed.length).toBeGreaterThan(0);
    for (const day of mixed) {
      const starts = day.commitments.map((commitment) => commitment.startMinutes);
      expect(starts).toEqual([...starts].sort((a, b) => a - b));
      expect(new Set(day.commitments.map((commitment) => commitment.personId)).size).toBe(1);
    }
    const sample = mixed[0];
    expect(personTimeline(timelines, sample.personId).length).toBeGreaterThan(
      sample.commitments.length
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Requirement 2 — external commitments enter the timeline BEFORE the solve     */
/* -------------------------------------------------------------------------- */

describe('people :: requirement 2, external commitments before the solve', () => {
  it('files every corpus row kind under a source, and never silently drops a layer', () => {
    const batches = toSeason2026CommitmentBatches(season, roster);
    const sizes = Object.fromEntries(
      [...batches.entries()].map(([source, entries]) => [source, entries.length])
    );
    expect(sizes[COMMITMENT_SOURCE.CLUB_FIXTURE]).toBeGreaterThan(1000);
    expect(sizes[COMMITMENT_SOURCE.EXTERNAL_FIXTURE]).toBeGreaterThan(0);
    expect(sizes[COMMITMENT_SOURCE.SCRIMMAGE]).toBeGreaterThan(0);
    const total = Object.values(sizes).reduce((sum, count) => sum + count, 0);
    expect(total).toBe(1764);

    // Positive control: an unfiled row kind is a whole layer leaving the
    // timeline, and it throws rather than contributing nothing.
    expect(() =>
      toSeason2026CommitmentBatches(
        { combinedGames: [{ ...season.combinedGames[0], kind: 'tournament' }] },
        roster
      )
    ).toThrow(/has no commitment source/);
  });

  it('makes a timeline that never ingested the scrimmages blocking, not merely different', () => {
    const partial = buildSeason2026Timelines(season, roster, {
      sources: [COMMITMENT_SOURCE.CLUB_FIXTURE, COMMITMENT_SOURCE.EXTERNAL_FIXTURE],
    });
    expect(partial.sources).toEqual([
      COMMITMENT_SOURCE.CLUB_FIXTURE,
      COMMITMENT_SOURCE.EXTERNAL_FIXTURE,
    ]);
    expect(partial.status).toBe(PEOPLE_STATUS.REJECTED);
    const missing = partial.findings.filter(
      (finding) => finding.code === PEOPLE_REASON.TIMELINE_SOURCE_NOT_INGESTED
    );
    expect(missing).toHaveLength(1);
    expect(missing[0].details.source).toBe(COMMITMENT_SOURCE.SCRIMMAGE);
    // A consumer that demands a complete timeline gets the same answer.
    expect(codesOf(requireSealedTimelines(partial))).toEqual([
      PEOPLE_REASON.TIMELINE_SOURCE_NOT_INGESTED,
    ]);
    // …and the complete one is clean, so the finding is not simply always on.
    expect(requireSealedTimelines(timelines)).toEqual([]);
    expect(timelines.status).toBe(PEOPLE_STATUS.ALLOWED);
  });

  it('refuses to append to a sealed set, which is incident 5 in one sentence', () => {
    const batches = toSeason2026CommitmentBatches(season, roster);
    const solved = buildSeason2026Timelines(season, roster, {
      sources: [COMMITMENT_SOURCE.CLUB_FIXTURE, COMMITMENT_SOURCE.EXTERNAL_FIXTURE],
      requiredSources: [COMMITMENT_SOURCE.CLUB_FIXTURE, COMMITMENT_SOURCE.EXTERNAL_FIXTURE],
    });
    expect(solved.status).toBe(PEOPLE_STATUS.ALLOWED);
    expect(solved.sealed).toBe(true);

    const tooLate = ingestCommitments(solved, batches.get(COMMITMENT_SOURCE.SCRIMMAGE), {
      source: COMMITMENT_SOURCE.SCRIMMAGE,
    });
    expect(codesOf(tooLate.findings)).toContain(PEOPLE_REASON.TIMELINE_SEALED_APPEND);
    expect(tooLate.status).toBe(PEOPLE_STATUS.REJECTED);
    // A consumer of the *resulting* set refuses too: "completed after the
    // fact" has to be as visible as "never completed".
    expect(codesOf(requireSealedTimelines(tooLate))).toEqual([
      PEOPLE_REASON.TIMELINE_SEALED_APPEND,
    ]);
    // Nothing was ingested: the sealed set is the sealed set.
    expect(tooLate.byPerson).toBe(solved.byPerson);
    expect(tooLate.sources).toEqual(solved.sources);
  });

  it('reports an unsealed set and an empty source rather than letting either pass', () => {
    const open = ingestCommitments(createTimelineSet(), [makeCommitment({})], {
      source: COMMITMENT_SOURCE.CLUB_FIXTURE,
    });
    expect(open.sealed).toBe(false);
    expect(codesOf(requireSealedTimelines(open))).toEqual([PEOPLE_REASON.TIMELINE_NOT_SEALED]);

    const empty = ingestCommitments(createTimelineSet(), [], {
      source: COMMITMENT_SOURCE.SCRIMMAGE,
    });
    expect(codesOf(empty.findings)).toEqual([PEOPLE_REASON.TIMELINE_SOURCE_EMPTY]);
    // …and a non-empty batch of the same source does not raise it.
    expect(
      codesOf(
        ingestCommitments(
          createTimelineSet(),
          [makeCommitment({ source: COMMITMENT_SOURCE.SCRIMMAGE })],
          {
            source: COMMITMENT_SOURCE.SCRIMMAGE,
          }
        ).findings
      )
    ).toEqual([]);

    expect(() =>
      ingestCommitments(createTimelineSet(), [makeCommitment({})], {
        source: COMMITMENT_SOURCE.SCRIMMAGE,
      })
    ).toThrow(/declares source/);
    expect(() => ingestCommitments(createTimelineSet(), [], { source: 'made-up' })).toThrow(
      /is not a commitment source/
    );
  });

  /**
   * **The acceptance test, on a constructed 6.5-hour hole.**
   *
   * The corpus's own instance of this is 265 minutes rather than 390 (asserted
   * below), so the exact figure the incident records is constructed here to
   * name the number the build plan names.
   */
  it('adding an evening scrimmage BEFORE the solve prevents the 6.5-hour-gap outcome', () => {
    const morning = makeCommitment({
      id: 'morning',
      personId: 'coach-2',
      teamId: 'team-a',
      gameId: 'g-morning',
      startMinutes: at('09:00'),
      endMinutes: at('10:30'),
      source: COMMITMENT_SOURCE.CLUB_FIXTURE,
    });
    const evening = makeCommitment({
      id: 'evening',
      personId: 'coach-2',
      teamId: 'team-b',
      gameId: 'g-evening',
      startMinutes: at('17:00'),
      endMinutes: at('18:30'),
      source: COMMITMENT_SOURCE.SCRIMMAGE,
    });
    const required = [COMMITMENT_SOURCE.CLUB_FIXTURE, COMMITMENT_SOURCE.SCRIMMAGE];

    /* The way it went wrong: solve on club fixtures, add the scrimmage after. */
    const beforeIngest = sealTimelines(
      ingestCommitments(createTimelineSet(), [morning], {
        source: COMMITMENT_SOURCE.CLUB_FIXTURE,
      }),
      { requiredSources: required }
    );
    const blind = evaluatePersonDays(beforeIngest, { registry });
    // The optimiser's view: one commitment, no transition, nothing to shorten.
    expect(blind.meta.personDaysExamined).toBe(1);
    expect(blind.meta.transitionsExamined).toBe(0);
    expect(countByCode(blind.findings)[PEOPLE_REASON.PERSON_DAY_GAP_EXCEEDED]).toBeUndefined();
    // But the timeline itself refuses to look complete.
    expect(codesOf(requireSealedTimelines(beforeIngest))).toEqual([
      PEOPLE_REASON.TIMELINE_SOURCE_NOT_INGESTED,
    ]);
    expect(beforeIngest.status).toBe(PEOPLE_STATUS.REJECTED);

    /* The way it should go: ingest the scrimmage, then seal, then judge. */
    const complete = sealTimelines(
      ingestCommitments(
        ingestCommitments(createTimelineSet(), [morning], {
          source: COMMITMENT_SOURCE.CLUB_FIXTURE,
        }),
        [evening],
        { source: COMMITMENT_SOURCE.SCRIMMAGE }
      ),
      { requiredSources: required }
    );
    expect(requireSealedTimelines(complete)).toEqual([]);

    const seen = evaluatePersonDays(complete, { registry });
    expect(seen.meta.transitionsExamined).toBe(1);
    expect(seen.meta.transitionsJudged).toBe(1);
    const gaps = seen.findings.filter(
      (finding) => finding.code === PEOPLE_REASON.PERSON_DAY_GAP_EXCEEDED
    );
    expect(gaps).toHaveLength(1);
    // Six and a half hours, exactly, and now a fact the optimiser can act on.
    expect(gaps[0].details.gapMinutes).toBe(390);
    expect(Number(gaps[0].details.gapMinutes) / 60).toBe(6.5);
    expect(gaps[0].details.maximumGapMinutes).toBe(180);
    expect(gaps[0].details.excessMinutes).toBe(210);
    expect(gaps[0].details.toSource).toBe(COMMITMENT_SOURCE.SCRIMMAGE);
    // Severity comes from the record: `coach-maximum-gap` is a preference.
    expect(gaps[0].severity).toBe(PEOPLE_SEVERITY.INFO);

    const day = seen.days[0];
    expect(day.spanMinutes).toBe(at('18:30') - at('09:00'));
    expect(day.idleMinutes).toBe(390);
  });

  it('finds the corpus’s own stranded evening, and only when the scrimmages are on', () => {
    const complete = evaluatePersonDays(timelines, { registry });
    const gaps = complete.findings.filter(
      (finding) => finding.code === PEOPLE_REASON.PERSON_DAY_GAP_EXCEEDED
    );
    expect(gaps).toHaveLength(1);
    // 11:50-12:55 rec game, then a 17:20 scrimmage at the same park.
    expect(gaps[0].details.gapMinutes).toBe(265);
    expect(gaps[0].details.toSource).toBe(COMMITMENT_SOURCE.SCRIMMAGE);
    // Derived, not named: the stranded coach is one of the two people the
    // register already flagged as the sole coach of two teams.
    expect(soleCoachRiskRegister(roster).people.map((entry) => entry.personId)).toContain(
      gaps[0].details.personId
    );

    const partial = buildSeason2026Timelines(season, roster, {
      sources: [COMMITMENT_SOURCE.CLUB_FIXTURE, COMMITMENT_SOURCE.EXTERNAL_FIXTURE],
      requiredSources: [COMMITMENT_SOURCE.CLUB_FIXTURE, COMMITMENT_SOURCE.EXTERNAL_FIXTURE],
    });
    const blind = evaluatePersonDays(partial, { registry });
    expect(blind.meta.personDaysExamined).toBe(1619);
    expect(
      blind.findings.filter((finding) => finding.code === PEOPLE_REASON.PERSON_DAY_GAP_EXCEEDED)
    ).toHaveLength(0);
    // The partial run is not simply smaller — it examined 8 fewer person-days
    // and 1 fewer transition, and lost the only long hole in the season.
    expect(complete.meta.personDaysExamined - blind.meta.personDaysExamined).toBe(8);
    expect(complete.meta.transitionsExamined - blind.meta.transitionsExamined).toBe(1);
  });

  it('reports an unknown footprint rather than measuring a day it cannot measure', () => {
    const complete = evaluatePersonDays(timelines, { registry });
    const unknown = complete.findings.filter(
      (finding) => finding.code === PEOPLE_REASON.COMMITMENT_FOOTPRINT_UNKNOWN
    );
    // The corpus's three scrimmage rows, once per rostered coach of a named
    // side: 1 + 2, 1 + 2, 2 + 1.
    expect(unknown).toHaveLength(9);
    for (const finding of unknown) {
      expect(finding.details.source).toBe(COMMITMENT_SOURCE.SCRIMMAGE);
      expect(finding.severity).toBe(PEOPLE_SEVERITY.COMPROMISE);
    }
    expect(complete.status).toBe(PEOPLE_STATUS.COMPROMISED);

    const days = buildPersonDays(timelines).filter((day) => day.lastEndMinutes === null);
    expect(days).toHaveLength(9);
    for (const day of days) expect(day.spanMinutes).toBeNull();
  });

  it('says when no record governs the maximum gap, instead of passing everything', () => {
    // Positive control for `PERSON_DAY_GAP_UNGOVERNED`: an empty registry has
    // no maximum, and "no rule applies" must not read as "the rule permits it".
    const bare = buildConstraintRegistry({ constraints: [] });
    const set = timelineOf([
      makeCommitment({ id: 'x1', startMinutes: at('09:00'), endMinutes: at('10:00') }),
      makeCommitment({
        id: 'x2',
        startMinutes: at('20:00'),
        endMinutes: at('21:00'),
        gameId: 'g2',
      }),
    ]);
    const judged = evaluatePersonDays(set, { registry: bare });
    expect(judged.meta.transitionsJudged).toBe(1);
    expect(codesOf(judged.findings)).toContain(PEOPLE_REASON.PERSON_DAY_GAP_UNGOVERNED);
    expect(
      judged.findings.filter((finding) => finding.code === PEOPLE_REASON.PERSON_DAY_GAP_EXCEEDED)
    ).toHaveLength(0);
  });

  it('reports a scan that examined nothing', () => {
    const nothing = evaluatePersonDays(sealTimelines(createTimelineSet(), {}), { registry });
    expect(nothing.meta.personDaysExamined).toBe(0);
    expect(codesOf(nothing.findings)).toContain(PEOPLE_REASON.TIMELINE_SCAN_VACUOUS);
  });
});

/* -------------------------------------------------------------------------- */
/* Requirement 3 — derived must-attend                                          */
/* -------------------------------------------------------------------------- */

const PEOPLE_SRC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'packages',
  'core',
  'src',
  'people'
);

function sourceFilesUnder(dir) {
  /** @type {string[]} */
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...sourceFilesUnder(full));
    else if (entry.endsWith('.js')) files.push(full);
  }
  return files;
}

describe('people :: requirement 3, must-attend is derived and never hardcoded', () => {
  const derived = deriveMustAttend({ roster });

  it('classifies the sole coach of two teams as must-attend', () => {
    expect(derived.meta.peopleExamined).toBe(196);
    expect(derived.meta.multiTeamPeople).toBe(19);
    expect(derived.byPerson.size).toBe(2);
    for (const verdict of derived.byPerson.values()) {
      expect(verdict.mustAttend).toBe(true);
      expect(verdict.bases).toEqual([MUST_ATTEND_BASIS.SOLE_COACH_OF_MULTIPLE_TEAMS]);
      expect(verdict.teamIds).toHaveLength(2);
      for (const teamId of verdict.teamIds) {
        expect(roster.teams.get(teamId).personIds).toEqual([verdict.personId]);
      }
    }
    // The same two people the register found, by a different route.
    expect([...derived.byPerson.keys()]).toEqual(
      soleCoachRiskRegister(roster).people.map((entry) => entry.personId)
    );
    // …and a coach of two teams who has a co-coach on one of them is not
    // must-attend, so the derivation is discriminating rather than blanket.
    expect(derived.byPerson.size).toBeLessThan(derived.meta.multiTeamPeople);
  });

  it('moves with the roster: give one of those teams a co-coach and the flag goes', () => {
    // Positive control. The derivation is only "derived" if this changes it.
    const [target] = derived.byPerson.values();
    const extended = buildSeason2026CoachRoster([
      ...season.assignments,
      {
        teamCode: target.teamIds[0],
        firstName: 'Newly',
        lastName: 'Appointed',
        coachSlot: 2,
        personKey: 'newly appointed',
        status: 'Assigned',
      },
    ]);
    expect(extended.teams.get(target.teamIds[0]).personIds).toHaveLength(2);
    const after = deriveMustAttend({ roster: extended });
    expect(after.byPerson.has(target.personId)).toBe(false);
    expect(after.byPerson.size).toBe(derived.byPerson.size - 1);
  });

  it('honours a declared personal constraint — the single car — with no name in the code', () => {
    // The policy ships empty, so this is constructed: the shape exists, the
    // corpus seeds nothing into it.
    expect(codesOf(derived.findings)).toEqual([PEOPLE_REASON.PERSONAL_CONSTRAINT_POLICY_EMPTY]);

    const local = buildCoachRoster({
      people: [makePerson('p1', 'Ada', 'Stone'), makePerson('p2', 'Bo', 'Reed')],
      assignments: [
        makeAssignment('p1', 'team-a', 1),
        makeAssignment('p2', 'team-a', 2),
        makeAssignment('p1', 'team-b', 1),
        makeAssignment('p2', 'team-b', 2),
      ],
    });
    // p1 is not the sole coach of anything, so the roster basis says nothing.
    expect(deriveMustAttend({ roster: local }).byPerson.size).toBe(0);

    const policy = buildPersonalConstraintPolicy({
      constraints: [
        {
          id: 'household-1',
          personId: 'p1',
          kind: PERSONAL_CONSTRAINT_KIND.CANNOT_SPLIT,
          teamIds: ['team-a', 'team-b'],
          fromDate: null,
          toDate: null,
          rationale: 'one household, one car; this person cannot cover two venues in a day',
          source: { setBy: 'registrar', setAt: null, reference: null, note: null },
        },
      ],
    });
    const withPolicy = deriveMustAttend({ roster: local, policy });
    expect(withPolicy.meta.personalConstraintsExamined).toBe(1);
    expect(withPolicy.byPerson.get('p1').bases).toEqual([
      MUST_ATTEND_BASIS.DECLARED_PERSONAL_CONSTRAINT,
    ]);
    expect(withPolicy.byPerson.has('p2')).toBe(false);
    expect(codesOf(withPolicy.findings)).toEqual([]);

    // A constraint naming nobody on the roster governs nobody, and says so.
    const orphaned = deriveMustAttend({
      roster: local,
      policy: buildPersonalConstraintPolicy({
        constraints: [
          {
            id: 'household-2',
            personId: 'ghost',
            kind: PERSONAL_CONSTRAINT_KIND.CANNOT_SPLIT,
            teamIds: null,
            fromDate: null,
            toDate: null,
            rationale: 'a record whose subject has left the club',
            source: { setBy: 'registrar', setAt: null, reference: null, note: null },
          },
        ],
      }),
    });
    expect(codesOf(orphaned.findings)).toContain(PEOPLE_REASON.PERSONAL_CONSTRAINT_PERSON_UNKNOWN);
    expect(orphaned.status).toBe(PEOPLE_STATUS.REJECTED);
  });

  it('demands a rationale and a setter on a declared constraint', () => {
    const base = {
      id: 'household-3',
      personId: 'p1',
      kind: PERSONAL_CONSTRAINT_KIND.CANNOT_SPLIT,
      teamIds: null,
      fromDate: null,
      toDate: null,
      rationale: 'stated',
      source: { setBy: 'registrar', setAt: null, reference: null, note: null },
    };
    expect(() => PersonalConstraintSchema.parse({ ...base, rationale: '' })).toThrow();
    expect(() =>
      PersonalConstraintSchema.parse({
        ...base,
        source: { setBy: '', setAt: null, reference: null, note: null },
      })
    ).toThrow();
    expect(() =>
      PersonalConstraintSchema.parse({ ...base, fromDate: '2026-09-01', toDate: '2026-08-01' })
    ).toThrow(/may not expire before it takes effect/);
  });

  it('names nobody: no corpus person key, display name or team code is in this package', () => {
    const needles = new Set();
    for (const rows of [season.assignments, loadCoachRoster({ revision: 'v1' })]) {
      for (const row of rows) {
        needles.add(row.personKey.toLowerCase());
        needles.add(`${row.firstName} ${row.lastName}`.toLowerCase());
        needles.add(row.teamCode.toLowerCase());
      }
    }
    // Meta-assertion, and one that can fail: a needle set that collapsed to
    // nothing would make the scan below pass for the worst possible reason.
    expect(needles.size).toBe(329);

    const files = sourceFilesUnder(PEOPLE_SRC);
    expect(files.length).toBeGreaterThanOrEqual(7);
    expect(files.some((file) => file.endsWith(path.join('people', 'mustAttend.js')))).toBe(true);

    /** @type {string[]} */
    const offenders = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8').toLowerCase();
      for (const needle of needles) {
        if (text.includes(needle)) offenders.push(`${path.basename(file)}: ${needle}`);
      }
    }
    expect(
      offenders,
      `these files name the corpus directly, which makes "derived" a claim rather than a fact: ${offenders.join(', ')}`
    ).toEqual([]);

    // Positive control: the same scan over a file that *does* name the corpus
    // finds it, so the empty result above means something.
    const control = readFileSync(
      path.join(PEOPLE_SRC, '..', 'fixtures', 'season2026Loader.js'),
      'utf8'
    ).toLowerCase();
    expect([...needles].some((needle) => control.includes(needle))).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Requirement 4 — fallback priority                                            */
/* -------------------------------------------------------------------------- */

describe('people :: requirement 4, fallback priority by coach slot', () => {
  const clashes = findAttendanceClashes(timelines);
  const mustAttend = deriveMustAttend({ roster });
  const resolved = resolveAttendance({
    roster,
    timelines,
    clashes,
    mustAttend: mustAttend.byPerson,
  });

  it('finds the corpus’s three coach clashes, cross-checked against the loader', () => {
    expect(resolved.meta.timelinesBuilt).toBe(196);
    expect(clashes).toHaveLength(3);
    expect(resolved.meta.clashesExamined).toBe(3);
    expect(resolved.meta.clashesResolved).toBe(3);

    // The corpus's own reading of the same clashes, from its own loader.
    const singleCoach = findSingleCoachGames(season.recGames, season.coachTimelines, season.teams);
    expect(singleCoach).toHaveLength(3);
    const releasedGames = new Set(
      resolved.resolutions.map((resolution) => resolution.releasedTeamId)
    );
    const loaderTeams = new Set(singleCoach.map((entry) => entry.teamId));
    for (const teamId of releasedGames) expect(loaderTeams).toContain(teamId);
  });

  it('records the released team’s cover as that team’s conflict', () => {
    const outcomes = resolved.resolutions.map((resolution) => resolution.outcome);
    expect(outcomes.filter((outcome) => outcome === ATTENDANCE_OUTCOME.FALLBACK)).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome === ATTENDANCE_OUTCOME.FALLBACK_CONTESTED)
    ).toHaveLength(2);
    const counts = countByCode(resolved.findings);
    expect(counts[PEOPLE_REASON.TEAM_FALLBACK_TO_CO_COACH]).toBe(1);
    // The pair who co-coach both clashing teams: neither can cover for the
    // other, so the corpus's "they split one each" is reported as contested
    // rather than as a solved fallback.
    expect(counts[PEOPLE_REASON.TEAM_FALLBACK_CONTESTED]).toBe(2);
    expect(resolved.status).toBe(PEOPLE_STATUS.COMPROMISED);

    for (const resolution of resolved.resolutions) {
      expect(resolution.retainedTeamId).not.toBe(resolution.releasedTeamId);
      expect(resolution.fallbackPersonIds.length).toBeGreaterThan(0);
      for (const candidate of resolution.fallbackPersonIds) {
        expect(coCoachesOf(roster, resolution.releasedTeamId, resolution.personId)).toContain(
          candidate
        );
      }
    }
  });

  it('reports a slot tie rather than breaking it silently', () => {
    // Every corpus clash is a genuine tie — each person holds the same slot on
    // both of their teams — so the corpus exercises the tie path and not the
    // ordering path. That is asserted, not assumed.
    expect(countByCode(resolved.findings)[PEOPLE_REASON.ATTENDANCE_SLOT_TIE]).toBe(3);
    for (const resolution of resolved.resolutions) {
      expect(coachSlotOf(roster, resolution.personId, resolution.retainedTeamId)).toBe(
        coachSlotOf(roster, resolution.personId, resolution.releasedTeamId)
      );
    }
    expect(
      countByCode(resolved.findings)[PEOPLE_REASON.ATTENDANCE_RESOLVED_BY_SLOT]
    ).toBeUndefined();
  });

  /**
   * **Constructed**, because the corpus has no clash where the two slots
   * differ — see the tie assertion above.
   */
  it('keeps the person on the team where they hold the lower slot', () => {
    const local = buildCoachRoster({
      people: [
        makePerson('p1', 'Ada', 'Stone'),
        makePerson('p2', 'Bo', 'Reed'),
        makePerson('p3', 'Cy', 'Nolan'),
      ],
      assignments: [
        // p1 is slot 2 on team-a and slot 1 on team-b: team-b keeps them.
        makeAssignment('p1', 'team-a', 2),
        makeAssignment('p2', 'team-a', 1),
        makeAssignment('p1', 'team-b', 1),
        makeAssignment('p3', 'team-b', 2),
      ],
    });
    const set = timelineOf([
      makeCommitment({
        id: 'ta',
        personId: 'p1',
        teamId: 'team-a',
        gameId: 'ga',
        startMinutes: at('10:00'),
        endMinutes: at('11:00'),
      }),
      makeCommitment({
        id: 'tb',
        personId: 'p1',
        teamId: 'team-b',
        gameId: 'gb',
        startMinutes: at('10:30'),
        endMinutes: at('11:30'),
      }),
      makeCommitment({
        id: 'ta-p2',
        personId: 'p2',
        teamId: 'team-a',
        gameId: 'ga',
        startMinutes: at('10:00'),
        endMinutes: at('11:00'),
      }),
      makeCommitment({
        id: 'tb-p3',
        personId: 'p3',
        teamId: 'team-b',
        gameId: 'gb',
        startMinutes: at('10:30'),
        endMinutes: at('11:30'),
      }),
    ]);
    const localClashes = findAttendanceClashes(set);
    expect(localClashes).toHaveLength(1);

    const verdict = resolveAttendance({ roster: local, timelines: set, clashes: localClashes });
    expect(verdict.resolutions).toHaveLength(1);
    const [resolution] = verdict.resolutions;
    expect(resolution.retainedTeamId).toBe('team-b');
    expect(resolution.retainedSlot).toBe(1);
    expect(resolution.releasedTeamId).toBe('team-a');
    expect(resolution.releasedSlot).toBe(2);
    expect(resolution.outcome).toBe(ATTENDANCE_OUTCOME.FALLBACK);
    expect(resolution.fallbackPersonIds).toEqual(['p2']);
    expect(codesOf(resolution.findings)).toEqual([
      PEOPLE_REASON.ATTENDANCE_RESOLVED_BY_SLOT,
      PEOPLE_REASON.TEAM_FALLBACK_TO_CO_COACH,
    ]);

    // Swap the slots and the answer swaps with them — the rule is the slot,
    // not the team id or the order the commitments arrived in.
    const mirrored = buildCoachRoster({
      people: [
        makePerson('p1', 'Ada', 'Stone'),
        makePerson('p2', 'Bo', 'Reed'),
        makePerson('p3', 'Cy', 'Nolan'),
      ],
      assignments: [
        makeAssignment('p1', 'team-a', 1),
        makeAssignment('p2', 'team-a', 2),
        makeAssignment('p1', 'team-b', 2),
        makeAssignment('p3', 'team-b', 1),
      ],
    });
    const mirroredVerdict = resolveAttendance({
      roster: mirrored,
      timelines: set,
      clashes: localClashes,
    });
    expect(mirroredVerdict.resolutions[0].retainedTeamId).toBe('team-a');
    expect(mirroredVerdict.resolutions[0].releasedTeamId).toBe('team-b');
  });

  it('reports a released team with no co-coach as blocking, and must-attend as unresolvable', () => {
    const local = buildCoachRoster({
      people: [makePerson('p1', 'Ada', 'Stone')],
      assignments: [makeAssignment('p1', 'team-a', 1), makeAssignment('p1', 'team-b', 2)],
    });
    const set = timelineOf([
      makeCommitment({
        id: 'ta',
        personId: 'p1',
        teamId: 'team-a',
        gameId: 'ga',
        startMinutes: at('10:00'),
        endMinutes: at('11:00'),
      }),
      makeCommitment({
        id: 'tb',
        personId: 'p1',
        teamId: 'team-b',
        gameId: 'gb',
        startMinutes: at('10:30'),
        endMinutes: at('11:30'),
      }),
    ]);
    const mustAttendLocal = deriveMustAttend({ roster: local });
    expect(mustAttendLocal.byPerson.get('p1').bases).toEqual([
      MUST_ATTEND_BASIS.SOLE_COACH_OF_MULTIPLE_TEAMS,
    ]);

    const verdict = resolveAttendance({
      roster: local,
      timelines: set,
      clashes: findAttendanceClashes(set),
      mustAttend: mustAttendLocal.byPerson,
    });
    const [resolution] = verdict.resolutions;
    expect(resolution.retainedTeamId).toBe('team-a');
    expect(resolution.outcome).toBe(ATTENDANCE_OUTCOME.UNCOVERED);
    expect(resolution.mustAttend).toBe(true);
    expect(codesOf(resolution.findings)).toEqual([
      PEOPLE_REASON.ATTENDANCE_RESOLVED_BY_SLOT,
      PEOPLE_REASON.TEAM_NO_FALLBACK_AVAILABLE,
      PEOPLE_REASON.ATTENDANCE_MUST_ATTEND_UNRESOLVABLE,
    ]);
    expect(verdict.status).toBe(PEOPLE_STATUS.REJECTED);
  });

  it('gives an undelegable non-club obligation rank 0 and keeps the person on it', () => {
    const local = buildCoachRoster({
      people: [makePerson('p1', 'Ada', 'Stone'), makePerson('p2', 'Bo', 'Reed')],
      assignments: [makeAssignment('p1', 'team-a', 1), makeAssignment('p2', 'team-a', 2)],
    });
    const set = sealTimelines(
      ingestCommitments(
        ingestCommitments(
          createTimelineSet(),
          [
            makeCommitment({
              id: 'ta',
              personId: 'p1',
              teamId: 'team-a',
              gameId: 'ga',
              startMinutes: at('10:00'),
              endMinutes: at('11:00'),
            }),
            makeCommitment({
              id: 'ta-p2',
              personId: 'p2',
              teamId: 'team-a',
              gameId: 'ga',
              startMinutes: at('10:00'),
              endMinutes: at('11:00'),
            }),
          ],
          { source: COMMITMENT_SOURCE.CLUB_FIXTURE }
        ),
        [
          makeCommitment({
            id: 'family',
            personId: 'p1',
            teamId: null,
            gameId: null,
            label: 'declared non-club obligation',
            startMinutes: at('10:30'),
            endMinutes: at('12:00'),
            source: COMMITMENT_SOURCE.NON_CLUB,
          }),
        ],
        { source: COMMITMENT_SOURCE.NON_CLUB }
      ),
      { requiredSources: [COMMITMENT_SOURCE.CLUB_FIXTURE, COMMITMENT_SOURCE.NON_CLUB] }
    );

    const verdict = resolveAttendance({
      roster: local,
      timelines: set,
      clashes: findAttendanceClashes(set),
    });
    const [resolution] = verdict.resolutions;
    expect(resolution.retainedTeamId).toBeNull();
    expect(resolution.retainedSlot).toBeNull();
    expect(resolution.releasedTeamId).toBe('team-a');
    expect(resolution.releasedSlot).toBe(1);
    expect(resolution.outcome).toBe(ATTENDANCE_OUTCOME.FALLBACK);
    expect(resolution.fallbackPersonIds).toEqual(['p2']);
  });

  it('reports a scan handed no timelines, and does not report a clean season as vacuous', () => {
    // Positive control on the shape Phase 2's review criticised: the vacuity
    // check is on the *input*, so a legitimately clean season does not raise
    // it and a broken join does.
    expect(codesOf(resolved.findings)).not.toContain(PEOPLE_REASON.ATTENDANCE_SCAN_VACUOUS);
    const empty = resolveAttendance({
      roster,
      timelines: sealTimelines(createTimelineSet(), {}),
      clashes: [],
    });
    expect(codesOf(empty.findings)).toEqual([PEOPLE_REASON.ATTENDANCE_SCAN_VACUOUS]);

    const cleanSeason = resolveAttendance({ roster, timelines, clashes: [] });
    expect(cleanSeason.findings).toEqual([]);
    expect(cleanSeason.status).toBe(PEOPLE_STATUS.ALLOWED);
  });

  it('sees an overlap that a consecutive-pair-only sweep would miss', () => {
    // A long commitment straddling two short ones: the neighbours are fine,
    // the intervals are not.
    const set = timelineOf([
      makeCommitment({
        id: 'long',
        startMinutes: at('09:00'),
        endMinutes: at('13:00'),
        teamId: 'team-a',
        gameId: 'g-long',
      }),
      makeCommitment({
        id: 'mid',
        startMinutes: at('09:30'),
        endMinutes: at('10:00'),
        teamId: 'team-b',
        gameId: 'g-mid',
      }),
      makeCommitment({
        id: 'late',
        startMinutes: at('12:00'),
        endMinutes: at('12:30'),
        teamId: 'team-c',
        gameId: 'g-late',
      }),
    ]);
    const found = findAttendanceClashes(set);
    expect(found.map((clash) => `${clash.from.id}><${clash.to.id}`)).toEqual([
      'long><mid',
      'long><late',
    ]);
    // The consecutive pair `mid -> late` has a 120-minute gap and is not a
    // clash, which is exactly what a neighbours-only sweep would have reported
    // for the whole day.
    const day = buildPersonDays(set)[0];
    expect(day.transitions.map((transition) => transition.gapMinutes)).toEqual([-210, 120]);
  });
});

/* -------------------------------------------------------------------------- */
/* Requirement 5 — identity resolution with a review queue                      */
/* -------------------------------------------------------------------------- */

describe('people :: requirement 5, identity resolution with a review queue', () => {
  const v1Rows = loadCoachRoster({ revision: 'v1' });
  const v1Roster = buildSeason2026CoachRoster(v1Rows);
  const queueOf = (source) =>
    buildIdentityReviewQueue([...source.peopleById.values()], {
      assignmentsByPerson: source.assignmentsByPerson,
    });
  const currentQueue = queueOf(roster);
  const v1Queue = queueOf(v1Roster);

  it('surfaces the given-name variant from the earlier revision for review', () => {
    expect(v1Rows).toHaveLength(215);
    // The revision genuinely splits one person into two identities.
    expect(v1Roster.peopleById.size).toBe(197);
    expect(roster.peopleById.size).toBe(196);

    expect(v1Queue.meta.identityPairsCompared).toBe(206);
    expect(v1Queue.entries).toHaveLength(1);
    const [entry] = v1Queue.entries;
    expect(entry.state).toBe(IDENTITY_REVIEW_STATE.PENDING);
    expect(entry.confidence).toBeGreaterThan(0.9);
    expect(entry.confidence).toBeLessThanOrEqual(1);

    // The evidence, named. The contraction signal is what separates this pair
    // from the 205 same-surname pairs that are two different people.
    const fired = entry.evidence.filter((item) => item.strength > 0).map((item) => item.signal);
    expect(fired).toContain(IDENTITY_SIGNAL.SURNAME_EXACT);
    expect(fired).toContain(IDENTITY_SIGNAL.GIVEN_NAME_CONTRACTION);
    expect(fired).toContain(IDENTITY_SIGNAL.TEAM_DISJOINT);

    // The two identities are the sole coach of one team each — which is the
    // rest of incident 6: the hidden link had no fallback behind it.
    const teamsA = teamsCoachedBy(v1Roster, entry.leftPersonId);
    const teamsB = teamsCoachedBy(v1Roster, entry.rightPersonId);
    expect(teamsA).toHaveLength(1);
    expect(teamsB).toHaveLength(1);
    for (const teamId of [...teamsA, ...teamsB]) {
      expect(v1Roster.teams.get(teamId).personIds).toHaveLength(1);
    }
    // In the current revision those two teams are one person's, and that
    // person is must-attend. The link the earlier file hid is a must-attend.
    const merged = deriveMustAttend({ roster });
    expect(
      [...merged.byPerson.values()].some((verdict) =>
        [...teamsA, ...teamsB].every((teamId) => verdict.teamIds.includes(teamId))
      )
    ).toBe(true);
  });

  it('is not merged and not ignored: the queue holds, nothing collapses', () => {
    expect(v1Queue.status).toBe(PEOPLE_STATUS.COMPROMISED);
    expect(countByCode(v1Queue.findings)[PEOPLE_REASON.IDENTITY_REVIEW_PENDING]).toBe(1);

    const untouched = applyIdentityDecisions(v1Queue, []);
    expect(distinctIdentityCount(untouched.canonicalIdByPersonId)).toBe(197);
    expect(untouched.meta.identityMergesApplied).toBe(0);
    expect(untouched.queue.entries[0].state).toBe(IDENTITY_REVIEW_STATE.PENDING);
    // A decision pass accumulates rather than replaces: the queue's own vetoes
    // come through, because a pair that was deliberately never queued still
    // needs its explanation, and the pending entry is restated once and not
    // twice. The veto count is read off the queue rather than typed here.
    const vetoedPairs = countByCode(v1Queue.findings)[PEOPLE_REASON.IDENTITY_MATCH_VETOED];
    expect(vetoedPairs).toBeGreaterThan(0);
    expect(countByCode(untouched.findings)).toEqual({
      [PEOPLE_REASON.IDENTITY_MATCH_VETOED]: vetoedPairs,
      [PEOPLE_REASON.IDENTITY_REVIEW_PENDING]: 1,
    });
    expect(untouched.meta.peopleExamined).toBe(197);
    expect(untouched.meta.identityPairsCompared).toBe(v1Queue.meta.identityPairsCompared);

    const accepted = applyIdentityDecisions(v1Queue, [
      {
        entryId: v1Queue.entries[0].id,
        state: 'accepted',
        decidedBy: 'registrar',
        decidedAt: null,
        note: null,
      },
    ]);
    expect(distinctIdentityCount(accepted.canonicalIdByPersonId)).toBe(196);
    expect(accepted.meta.identityMergesApplied).toBe(1);
    expect(countByCode(accepted.findings)).toEqual({
      [PEOPLE_REASON.IDENTITY_MATCH_VETOED]: vetoedPairs,
      [PEOPLE_REASON.IDENTITY_MERGE_APPLIED]: 1,
    });
    expect(accepted.queue.entries[0].state).toBe('accepted');

    const rejected = applyIdentityDecisions(v1Queue, [
      {
        entryId: v1Queue.entries[0].id,
        state: 'rejected',
        decidedBy: 'registrar',
        decidedAt: null,
        note: null,
      },
    ]);
    expect(distinctIdentityCount(rejected.canonicalIdByPersonId)).toBe(197);
    expect(rejected.queue.entries[0].state).toBe('rejected');

    const unknown = applyIdentityDecisions(v1Queue, [
      {
        entryId: 'no-such-entry',
        state: 'accepted',
        decidedBy: 'registrar',
        decidedAt: null,
        note: null,
      },
    ]);
    expect(codesOf(unknown.findings)).toContain(PEOPLE_REASON.IDENTITY_DECISION_UNKNOWN_ENTRY);
    expect(unknown.status).toBe(PEOPLE_STATUS.REJECTED);
  });

  it('proposes nothing on the corrected roster, having compared plenty of pairs', () => {
    // The other half of the claim: a matcher that queues everything is as
    // useless as one that queues nothing, so the mechanism has to *discriminate*.
    expect(currentQueue.meta.peopleExamined).toBe(196);
    expect(currentQueue.meta.identityBlocksExamined).toBe(53);
    expect(currentQueue.meta.identityPairsCompared).toBe(205);
    expect(currentQueue.meta.identityCandidates).toBe(0);
    expect(currentQueue.entries).toEqual([]);
    expect(currentQueue.status).toBe(PEOPLE_STATUS.ALLOWED);
    // The two revisions differ by exactly one compared pair, which is the pair.
    expect(v1Queue.meta.identityPairsCompared - currentQueue.meta.identityPairsCompared).toBe(1);
  });

  it('vetoes two identities that hold two slots on one team', () => {
    const local = buildCoachRoster({
      people: [makePerson('p1', 'Dan', 'Vale'), makePerson('p2', 'Daniel', 'Vale')],
      assignments: [makeAssignment('p1', 'team-a', 1), makeAssignment('p2', 'team-a', 2)],
    });
    const queue = buildIdentityReviewQueue([...local.peopleById.values()], {
      assignmentsByPerson: local.assignmentsByPerson,
    });
    expect(queue.meta.identityPairsCompared).toBe(1);
    expect(queue.meta.identityVetoed).toBe(1);
    expect(queue.entries).toEqual([]);
    expect(codesOf(queue.findings)).toContain(PEOPLE_REASON.IDENTITY_MATCH_VETOED);

    // Positive control: the identical name pair on *different* teams is a
    // proposal, so the veto is what suppressed it and not the scoring.
    const split = buildCoachRoster({
      people: [makePerson('p1', 'Dan', 'Vale'), makePerson('p2', 'Daniel', 'Vale')],
      assignments: [makeAssignment('p1', 'team-a', 1), makeAssignment('p2', 'team-b', 1)],
    });
    const splitQueue = buildIdentityReviewQueue([...split.peopleById.values()], {
      assignmentsByPerson: split.assignmentsByPerson,
    });
    expect(splitQueue.entries).toHaveLength(1);
    expect(splitQueue.meta.identityVetoed).toBe(0);
  });

  it('reports an empty scan rather than an empty queue', () => {
    const alone = buildIdentityReviewQueue([makePerson('p1', 'Ada', 'Stone')]);
    expect(alone.meta.identityPairsCompared).toBe(0);
    expect(codesOf(alone.findings)).toContain(PEOPLE_REASON.IDENTITY_SCAN_VACUOUS);
    expect(alone.status).toBe(PEOPLE_STATUS.COMPROMISED);
  });

  it('scores from a frozen weight table that sums to one', () => {
    const total = Object.values(IDENTITY_SIGNAL_WEIGHT).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBeCloseTo(1, 10);
    expect(Object.keys(IDENTITY_SIGNAL_WEIGHT).sort()).toEqual(
      Object.values(IDENTITY_SIGNAL).sort()
    );

    const scored = scoreIdentityPair(
      { givenName: 'Dan', familyName: 'Vale', teamIds: ['team-a'] },
      { givenName: 'Daniel', familyName: 'Vale', teamIds: ['team-b'] }
    );
    expect(scored.confidence).toBeGreaterThan(IDENTITY_DEFAULTS.minimumConfidence);
    expect(scored.confidence).toBeLessThanOrEqual(1);
    expect(scored.evidence).toHaveLength(Object.keys(IDENTITY_SIGNAL_WEIGHT).length);
    for (const item of scored.evidence) {
      expect(item.strength).toBeGreaterThanOrEqual(0);
      expect(item.strength).toBeLessThanOrEqual(1);
      expect(item.note.length).toBeGreaterThan(0);
    }

    // Two genuinely different people with one surname score low and never
    // become a candidate.
    const different = scoreIdentityPair(
      { givenName: 'Wanda', familyName: 'Vale', teamIds: ['team-a'] },
      { givenName: 'Hana', familyName: 'Vale', teamIds: ['team-b'] }
    );
    expect(different.confidence).toBeLessThan(scored.confidence);
  });

  it('implements the string primitives it claims to', () => {
    expect(normaliseNamePart('  \u00c9lodie-Mae  ')).toBe('elodiemae');
    expect(normaliseNamePart(null)).toBe('');
    expect(jaroWinkler('vale', 'vale')).toBe(1);
    expect(jaroWinkler('abc', 'xyz')).toBe(0);
    expect(sharedPrefixLength('daniel', 'danube')).toBe(3);

    // Contraction by deletion, in both a positive and several negative forms.
    expect(isContraction('dan', 'daniel')).toBe(true);
    expect(isContraction('kate', 'katherine')).toBe(true);
    expect(isContraction('tom', 'thomas')).toBe(true);
    expect(isContraction('ben', 'benjamin')).toBe(true);
    // Too short — an initial is not evidence.
    expect(isContraction('d', 'daniel')).toBe(false);
    // Different first letter.
    expect(isContraction('liz', 'elizabeth')).toBe(false);
    // Not a subsequence.
    expect(isContraction('mike', 'michael')).toBe(false);
    // Not strictly shorter.
    expect(isContraction('daniel', 'daniel')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* The seam with Prompt 2.2                                                     */
/* -------------------------------------------------------------------------- */

describe('people :: feeding a complete timeline to the Phase 2 travel evaluator', () => {
  it('hands `evaluateCoachTravel()` the whole season, scrimmages included', () => {
    const commitments = toTravelCommitments(timelines);
    expect(commitments).toHaveLength(1764);
    // The shape `CoachCommitmentSchema` accepts: strict, and no `source`.
    for (const commitment of commitments.slice(0, 5)) {
      expect('source' in commitment).toBe(false);
    }

    const travel = evaluateCoachTravel(commitments, { registry, venueComplexes });
    expect(travel.meta.commitmentsExamined).toBe(1764);
    expect(travel.meta.peopleExamined).toBe(196);
    expect(travel.meta.transitionsExamined).toBe(137);
    const counts = countByCode(
      travel.findings.filter((finding) => finding.severity !== PEOPLE_SEVERITY.INFO)
    );
    // The same accepted exceptions the rule engine reports, from a timeline
    // this module built rather than the one the fixture loader assembles.
    expect(counts[TRAVEL_REASON.TRAVEL_BETWEEN_VENUES_TOO_SHORT]).toBe(1);
    expect(counts[TRAVEL_REASON.TRAVEL_COMMITMENTS_OVERLAP]).toBe(3);
    expect(counts[TRAVEL_REASON.TRAVEL_WITHIN_VENUE_TOO_SHORT]).toBeUndefined();
  });

  it('agrees with `findAttendanceClashes()` about who cannot be in two places', () => {
    const travel = evaluateCoachTravel(toTravelCommitments(timelines), {
      registry,
      venueComplexes,
    });
    const overlaps = travel.findings.filter(
      (finding) => finding.code === TRAVEL_REASON.TRAVEL_COMMITMENTS_OVERLAP
    );
    const clashPeople = new Set(findAttendanceClashes(timelines).map((clash) => clash.personId));
    expect(clashPeople.size).toBe(3);
    expect(new Set(overlaps.map((finding) => finding.details.personId))).toEqual(clashPeople);
  });
});

/* -------------------------------------------------------------------------- */
/* Regressions from the Milestone 3 review                                      */
/* -------------------------------------------------------------------------- */

/**
 * One `it` per remaining finding of the Milestone 3 code review, each written
 * to fail on the code as it stood and named with the finding number so the
 * trail from review to regression is not a matter of memory. Finding 1's
 * regression lives with the sole-coach register above, where its subject is.
 *
 * Every case here is built the way a caller would build it. Finding 1 exists
 * because a test forged internal state; none of these does.
 */
describe('people :: regressions from the Milestone 3 review', () => {
  /** A human decision accepting one review entry. */
  const accept = (entryId) => ({
    entryId,
    state: 'accepted',
    decidedBy: 'registrar',
    decidedAt: null,
    note: null,
  });

  it('carries a queue’s own findings and counters through a decision pass (finding 2)', () => {
    // A vacuous queue: one identity, no pair compared, so an empty queue says
    // nothing. Deciding nothing on it must not turn that answer clean.
    const vacuous = buildIdentityReviewQueue([makePerson('p1', 'Ada', 'Stone')]);
    expect(vacuous.status).toBe(PEOPLE_STATUS.COMPROMISED);
    const decided = applyIdentityDecisions(vacuous, []);
    expect(codesOf(decided.findings)).toContain(PEOPLE_REASON.IDENTITY_SCAN_VACUOUS);
    expect(decided.status).toBe(PEOPLE_STATUS.COMPROMISED);
    expect(decided.queue.status).toBe(PEOPLE_STATUS.COMPROMISED);
    expect(decided.meta.peopleExamined).toBe(1);

    // The veto is evidence about a pair that was deliberately never queued;
    // losing it makes a surprising absence unexplained again.
    const vetoedRoster = buildCoachRoster({
      people: [makePerson('p1', 'Dan', 'Vale'), makePerson('p2', 'Daniel', 'Vale')],
      assignments: [makeAssignment('p1', 'team-a', 1), makeAssignment('p2', 'team-a', 2)],
    });
    const vetoed = buildIdentityReviewQueue([...vetoedRoster.peopleById.values()], {
      assignmentsByPerson: vetoedRoster.assignmentsByPerson,
    });
    const afterVeto = applyIdentityDecisions(vetoed, []);
    expect(codesOf(afterVeto.findings)).toContain(PEOPLE_REASON.IDENTITY_MATCH_VETOED);
    expect(afterVeto.meta.identityVetoed).toBe(1);
    expect(afterVeto.meta.identityPairsCompared).toBe(1);
  });

  it('files every absorbed id under the surviving id after a transitive merge (finding 3)', () => {
    const local = buildCoachRoster({
      people: [
        makePerson('id-a', 'Dan', 'Vale'),
        makePerson('id-b', 'Danie', 'Vale'),
        makePerson('id-c', 'Daniel', 'Vale'),
      ],
      assignments: [
        makeAssignment('id-a', 'team-a', 1),
        makeAssignment('id-b', 'team-b', 1),
        makeAssignment('id-c', 'team-c', 1),
      ],
    });
    const queue = buildIdentityReviewQueue([...local.peopleById.values()], {
      assignmentsByPerson: local.assignmentsByPerson,
    });
    expect(queue.entries.map((entry) => entry.id)).toEqual([
      'id-a::id-b',
      'id-a::id-c',
      'id-b::id-c',
    ]);

    // Two accepted decisions that chain: a absorbs b, and b absorbs c.
    const applied = applyIdentityDecisions(queue, [accept('id-a::id-b'), accept('id-b::id-c')]);
    expect(applied.canonicalIdByPersonId.get('id-b')).toBe('id-a');
    expect(applied.canonicalIdByPersonId.get('id-c')).toBe('id-a');
    expect(distinctIdentityCount(applied.canonicalIdByPersonId)).toBe(1);
    // The alias index has to agree with the canonical map, or "who was this
    // person also called?" and "who is this person?" give different answers.
    expect(applied.aliasesByCanonicalId.get('id-a')).toEqual(['id-b', 'id-c']);
    expect(applied.aliasesByCanonicalId.has('id-b')).toBe(false);
    for (const [survivor, aliases] of applied.aliasesByCanonicalId) {
      expect(applied.canonicalIdByPersonId.get(survivor)).toBe(survivor);
      for (const alias of aliases) {
        expect(applied.canonicalIdByPersonId.get(alias)).toBe(survivor);
      }
    }
  });

  it('reports an unknown overlap as unknown rather than as zero minutes (finding 4)', () => {
    const set = timelineOf([
      makeCommitment({
        id: 'game',
        teamId: 'team-a',
        gameId: 'g-game',
        startMinutes: at('10:00'),
        endMinutes: at('11:00'),
      }),
      makeCommitment({
        id: 'open',
        teamId: 'team-b',
        gameId: 'g-open',
        startMinutes: at('10:30'),
        endMinutes: null,
      }),
    ]);
    const [clash] = findAttendanceClashes(set);
    expect(clash.from.id).toBe('game');
    expect(clash.to.id).toBe('open');
    // Zero is a measurement and this is not one: a commitment of unknown
    // footprint starting mid-game overlaps by an amount nobody knows.
    expect(clash.overlapMinutes).toBeNull();

    // Positive control: give the same commitment an end and the magnitude is
    // measured again, so `null` means "unknown" and not "always".
    const measured = timelineOf([
      makeCommitment({
        id: 'game',
        teamId: 'team-a',
        gameId: 'g-game',
        startMinutes: at('10:00'),
        endMinutes: at('11:00'),
      }),
      makeCommitment({
        id: 'open',
        teamId: 'team-b',
        gameId: 'g-open',
        startMinutes: at('10:30'),
        endMinutes: at('11:30'),
      }),
    ]);
    expect(findAttendanceClashes(measured)[0].overlapMinutes).toBe(30);
  });

  it('ends a day at its latest end, not at the last commitment to start (finding 5)', () => {
    const straddled = timelineOf([
      makeCommitment({
        id: 'long',
        teamId: 'team-a',
        gameId: 'g-long',
        startMinutes: at('09:00'),
        endMinutes: at('12:00'),
      }),
      makeCommitment({
        id: 'short',
        teamId: 'team-b',
        gameId: 'g-short',
        startMinutes: at('10:00'),
        endMinutes: at('10:30'),
      }),
    ]);
    const [day] = buildPersonDays(straddled);
    expect(day.commitments.map((commitment) => commitment.id)).toEqual(['long', 'short']);
    expect(day.lastEndMinutes).toBe(at('12:00'));
    expect(day.spanMinutes).toBe(180);

    // An unknown end anywhere in the day makes the day's end unknown, whether
    // or not that commitment happens to sort last.
    const openEarly = timelineOf([
      makeCommitment({
        id: 'open',
        teamId: 'team-a',
        gameId: 'g-open',
        startMinutes: at('09:00'),
        endMinutes: null,
      }),
      makeCommitment({
        id: 'later',
        teamId: 'team-b',
        gameId: 'g-later',
        startMinutes: at('14:00'),
        endMinutes: at('15:00'),
      }),
    ]);
    const [openDay] = buildPersonDays(openEarly);
    expect(openDay.commitments[openDay.commitments.length - 1].id).toBe('later');
    expect(openDay.lastEndMinutes).toBeNull();
    expect(openDay.spanMinutes).toBeNull();
  });

  it('honours an assignment’s effective window wherever activity is judged (finding 6)', () => {
    const people = [makePerson('p1', 'Ada', 'Stone'), makePerson('p2', 'Bo', 'Reed')];
    // p2 co-coaches both of p1's teams and leaves at the end of August.
    const assignments = [
      makeAssignment('p1', 'team-a', 1),
      makeAssignment('p1', 'team-b', 1),
      { ...makeAssignment('p2', 'team-a', 2), effectiveTo: '2026-08-31' },
      { ...makeAssignment('p2', 'team-b', 2), effectiveTo: '2026-08-31' },
    ];

    const during = buildCoachRoster({ people, assignments }, { asOf: '2026-08-15' });
    expect(during.teams.get('team-a').personIds).toEqual(['p1', 'p2']);
    expect(during.meta.assignmentsActive).toBe(4);
    expect(soleCoachRiskRegister(during).teams).toEqual([]);
    expect(deriveMustAttend({ roster: during }).byPerson.size).toBe(0);

    const after = buildCoachRoster({ people, assignments }, { asOf: '2026-09-05' });
    expect(after.teams.get('team-a').personIds).toEqual(['p1']);
    expect(after.meta.assignmentsActive).toBe(2);
    expect(after.meta.assignmentsInactive).toBe(2);
    expect(coCoachesOf(after, 'team-a', 'p1')).toEqual([]);
    expect(teamsCoachedBy(after, 'p2')).toEqual([]);
    expect(coachSlotOf(after, 'p2', 'team-a')).toBeNull();
    // The register and the must-attend derivation both move, because both read
    // the roster's own answer about who is active.
    expect(soleCoachRiskRegister(after).teams.map((entry) => entry.teamId)).toEqual([
      'team-a',
      'team-b',
    ]);
    expect(deriveMustAttend({ roster: after }).byPerson.get('p1').bases).toEqual([
      MUST_ATTEND_BASIS.SOLE_COACH_OF_MULTIPLE_TEAMS,
    ]);

    // With no as-of date the window cannot be applied, and the roster says so
    // rather than counting a departed coach as fallback capacity in silence.
    const undated = buildCoachRoster({ people, assignments });
    const unjudged = undated.findings.filter(
      (finding) => finding.code === PEOPLE_REASON.ASSIGNMENT_WINDOW_UNJUDGED
    );
    expect(unjudged).toHaveLength(2);
    expect(unjudged.map((finding) => finding.details.assignmentId).sort()).toEqual([
      'team-a|p2|2',
      'team-b|p2|2',
    ]);
    expect(undated.teams.get('team-a').personIds).toEqual(['p1', 'p2']);

    // A roster whose assignments carry no window raises nothing — the corpus
    // included, whose 215 rows have no such column.
    expect(
      codesOf(
        buildCoachRoster({ people, assignments: [makeAssignment('p1', 'team-a', 1)] }).findings
      )
    ).toEqual([]);
    expect(codesOf(roster.findings)).toEqual([]);

    // The schema refuses a window that closes before it opens, exactly as
    // `PersonalConstraintSchema` refuses one.
    expect(() =>
      CoachAssignmentSchema.parse({
        ...makeAssignment('p1', 'team-a', 1),
        effectiveFrom: '2026-09-01',
        effectiveTo: '2026-08-01',
      })
    ).toThrow(/may not end before it takes effect/);
  });

  it('honours a declared UNAVAILABLE record when judging fallback capacity (finding 7)', () => {
    const local = buildCoachRoster({
      people: [
        makePerson('p1', 'Ada', 'Stone'),
        makePerson('p2', 'Bo', 'Reed'),
        makePerson('p3', 'Cy', 'Nolan'),
      ],
      assignments: [
        makeAssignment('p1', 'team-a', 2),
        makeAssignment('p2', 'team-a', 1),
        makeAssignment('p1', 'team-b', 1),
        makeAssignment('p3', 'team-b', 2),
      ],
    });
    const set = timelineOf([
      makeCommitment({
        id: 'ta',
        personId: 'p1',
        teamId: 'team-a',
        gameId: 'ga',
        startMinutes: at('10:00'),
        endMinutes: at('11:00'),
      }),
      makeCommitment({
        id: 'tb',
        personId: 'p1',
        teamId: 'team-b',
        gameId: 'gb',
        startMinutes: at('10:30'),
        endMinutes: at('11:30'),
      }),
      makeCommitment({
        id: 'ta-p2',
        personId: 'p2',
        teamId: 'team-a',
        gameId: 'ga',
        startMinutes: at('10:00'),
        endMinutes: at('11:00'),
      }),
    ]);
    const clashes = findAttendanceClashes(set);
    expect(clashes).toHaveLength(1);

    // With no declared record, team-a's co-coach covers.
    const covered = resolveAttendance({ roster: local, timelines: set, clashes });
    expect(covered.resolutions[0].releasedTeamId).toBe('team-a');
    expect(covered.resolutions[0].outcome).toBe(ATTENDANCE_OUTCOME.FALLBACK);

    // A person declared unavailable that day is not fallback capacity, on the
    // same reasoning that a coach who has not accepted is not.
    const away = buildPersonalConstraintPolicy({
      constraints: [
        {
          id: 'away-1',
          personId: 'p2',
          kind: PERSONAL_CONSTRAINT_KIND.UNAVAILABLE,
          teamIds: null,
          fromDate: DATE,
          toDate: DATE,
          rationale: 'declared away for the weekend',
          source: { setBy: 'registrar', setAt: null, reference: null, note: null },
        },
      ],
    });
    const contested = resolveAttendance({
      roster: local,
      timelines: set,
      clashes,
      policy: away,
    });
    const [resolution] = contested.resolutions;
    expect(resolution.outcome).toBe(ATTENDANCE_OUTCOME.FALLBACK_CONTESTED);
    const contestedFinding = resolution.findings.find(
      (finding) => finding.code === PEOPLE_REASON.TEAM_FALLBACK_CONTESTED
    );
    expect(contestedFinding.details.unavailablePersonIds).toEqual(['p2']);

    // …and a record whose window has closed does not bite, so the dates are
    // applied rather than decorative.
    const expired = buildPersonalConstraintPolicy({
      constraints: [
        {
          id: 'away-2',
          personId: 'p2',
          kind: PERSONAL_CONSTRAINT_KIND.UNAVAILABLE,
          teamIds: null,
          fromDate: '2026-08-01',
          toDate: '2026-08-21',
          rationale: 'declared away the weekend before',
          source: { setBy: 'registrar', setAt: null, reference: null, note: null },
        },
      ],
    });
    expect(
      resolveAttendance({ roster: local, timelines: set, clashes, policy: expired }).resolutions[0]
        .outcome
    ).toBe(ATTENDANCE_OUTCOME.FALLBACK);
  });

  it('applies a personal constraint’s window, and says so when it cannot (finding 7)', () => {
    const local = buildCoachRoster({
      people: [makePerson('p1', 'Ada', 'Stone'), makePerson('p2', 'Bo', 'Reed')],
      assignments: [
        makeAssignment('p1', 'team-a', 1),
        makeAssignment('p2', 'team-a', 2),
        makeAssignment('p1', 'team-b', 1),
        makeAssignment('p2', 'team-b', 2),
      ],
    });
    const windowed = buildPersonalConstraintPolicy({
      constraints: [
        {
          id: 'household-4',
          personId: 'p1',
          kind: PERSONAL_CONSTRAINT_KIND.CANNOT_SPLIT,
          teamIds: ['team-a', 'team-b'],
          fromDate: '2026-08-01',
          toDate: '2026-08-31',
          rationale: 'one household, one car, for the weeks the other car is off the road',
          source: { setBy: 'registrar', setAt: null, reference: null, note: null },
        },
      ],
    });

    const inForce = deriveMustAttend({ roster: local, policy: windowed, date: DATE });
    expect(inForce.byPerson.get('p1').bases).toEqual([
      MUST_ATTEND_BASIS.DECLARED_PERSONAL_CONSTRAINT,
    ]);
    expect(inForce.meta.personalConstraintsExamined).toBe(1);
    expect(codesOf(inForce.findings)).toEqual([]);

    // An expired `cannot-split` is not permanent.
    const expired = deriveMustAttend({ roster: local, policy: windowed, date: '2026-09-05' });
    expect(expired.byPerson.has('p1')).toBe(false);
    expect(expired.meta.personalConstraintsExamined).toBe(1);

    // With no date the window cannot be judged: the record is still applied,
    // because dropping a declared must-attend in silence is the worse failure,
    // but the caller is told the window went unjudged.
    const undated = deriveMustAttend({ roster: local, policy: windowed });
    expect(codesOf(undated.findings)).toContain(PEOPLE_REASON.PERSONAL_CONSTRAINT_WINDOW_UNJUDGED);
    expect(undated.byPerson.has('p1')).toBe(true);

    // A record with no window is judged the same way with or without a date,
    // and raises nothing.
    const openEnded = buildPersonalConstraintPolicy({
      constraints: [
        {
          id: 'household-5',
          personId: 'p1',
          kind: PERSONAL_CONSTRAINT_KIND.CANNOT_SPLIT,
          teamIds: ['team-a', 'team-b'],
          fromDate: null,
          toDate: null,
          rationale: 'one household, one car',
          source: { setBy: 'registrar', setAt: null, reference: null, note: null },
        },
      ],
    });
    expect(codesOf(deriveMustAttend({ roster: local, policy: openEnded }).findings)).toEqual([]);
    expect(
      deriveMustAttend({ roster: local, policy: openEnded, date: '2026-09-05' }).byPerson.has('p1')
    ).toBe(true);
  });

  it('gives one person coaching both sides of a fixture two distinct commitments (finding 8)', () => {
    // The corpus already carries intra-club fixtures — rows whose two sides are
    // both teams this roster knows — so the collision is reachable from real
    // data the moment one person is appointed to both sides.
    const intraClub = season.combinedGames
      .filter(
        (game) =>
          game.homeTeamId &&
          game.awayTeamId &&
          roster.teams.has(String(game.homeTeamId)) &&
          roster.teams.has(String(game.awayTeamId))
      )
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    expect(intraClub.length).toBeGreaterThan(0);
    const [game] = intraClub;

    const homeCoach = season.assignments.find((row) => row.teamCode === String(game.homeTeamId));
    expect(homeCoach).toBeDefined();
    // Ordinary adapter input: the same roster rows, plus one appointing that
    // person to the other side of the same fixture.
    const both = buildSeason2026CoachRoster([
      ...season.assignments,
      { ...homeCoach, teamCode: String(game.awayTeamId), coachSlot: 9 },
    ]);
    expect(teamsCoachedBy(both, homeCoach.personKey)).toContain(String(game.awayTeamId));

    const mine = [...toSeason2026CommitmentBatches(season, both).values()]
      .flat()
      .filter(
        (commitment) =>
          commitment.personId === homeCoach.personKey && commitment.gameId === String(game.id)
      );
    expect(mine).toHaveLength(2);
    expect(new Set(mine.map((commitment) => commitment.teamId)).size).toBe(2);
    expect(new Set(mine.map((commitment) => commitment.id)).size).toBe(2);

    // …and ids stay unique across the whole corpus, not merely in this pair.
    const all = [...toSeason2026CommitmentBatches(season, roster).values()].flat();
    expect(new Set(all.map((commitment) => commitment.id)).size).toBe(all.length);
  });

  it('says the roster carries no link for a team instead of a very large slot (finding 9)', () => {
    const local = buildCoachRoster({
      people: [makePerson('p1', 'Ada', 'Stone'), makePerson('p2', 'Bo', 'Reed')],
      assignments: [makeAssignment('p1', 'team-a', 1), makeAssignment('p2', 'team-a', 2)],
    });
    // A commitment naming a team this roster does not link p1 to — a timeline
    // built over one roster revision and judged against another.
    const set = timelineOf([
      makeCommitment({
        id: 'ta',
        personId: 'p1',
        teamId: 'team-a',
        gameId: 'ga',
        startMinutes: at('10:00'),
        endMinutes: at('11:00'),
      }),
      makeCommitment({
        id: 'tz',
        personId: 'p1',
        teamId: 'team-z',
        gameId: 'gz',
        startMinutes: at('10:30'),
        endMinutes: at('11:30'),
      }),
    ]);
    const verdict = resolveAttendance({
      roster: local,
      timelines: set,
      clashes: findAttendanceClashes(set),
    });
    const [resolution] = verdict.resolutions;
    expect(resolution.retainedTeamId).toBe('team-a');
    expect(resolution.retainedSlot).toBe(1);
    expect(resolution.releasedTeamId).toBe('team-z');
    // Not `Number.MAX_SAFE_INTEGER` dressed as a coach slot.
    expect(resolution.releasedSlot).toBeNull();
    const missing = resolution.findings.filter(
      (finding) => finding.code === PEOPLE_REASON.ATTENDANCE_TEAM_LINK_MISSING
    );
    expect(missing).toHaveLength(1);
    expect(missing[0].details.teamId).toBe('team-z');
    expect(missing[0].details.commitmentId).toBe('tz');
    expect(JSON.stringify(verdict.resolutions)).not.toContain(String(Number.MAX_SAFE_INTEGER));
    expect(JSON.stringify(verdict.findings)).not.toContain(String(Number.MAX_SAFE_INTEGER));
  });
});
