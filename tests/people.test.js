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

  it('reports a team with no active coach as blocking', () => {
    const uncoached = buildCoachRoster({
      people: [makePerson('p1', 'Ada', 'Stone')],
      assignments: [makeAssignment('p1', 'team-a', 1)],
    });
    // A team only exists in the index because an active assignment named it,
    // so the uncoached case is constructed by emptying one after the fact.
    /** @type {Map<string, Object>} */ (uncoached.teams).set('team-b', {
      teamId: 'team-b',
      slots: [],
      personIds: [],
    });
    const register2 = soleCoachRiskRegister(uncoached);
    expect(codesOf(register2.findings)).toContain(PEOPLE_REASON.TEAM_UNCOACHED);
    expect(register2.status).toBe(PEOPLE_STATUS.REJECTED);
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
    expect(codesOf(untouched.findings)).toEqual([PEOPLE_REASON.IDENTITY_REVIEW_PENDING]);

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
    expect(codesOf(accepted.findings)).toEqual([PEOPLE_REASON.IDENTITY_MERGE_APPLIED]);
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
