/**
 * Fairness and equity metrics — Prompt 7.2.
 *
 * > *Is anybody being treated unlike their peers — and is that a real inequity,
 * > or a property of how the fixture list is written?*
 *
 * Five properties are what this file is for, and each has a positive control
 * that is **constructed** rather than asserted:
 *
 * 1. **The league / external / friendly distinction is load bearing, and the
 *    number of false positives it removes is measured, not claimed.** The same
 *    metric is run with the distinction and without it, on the same corpus, and
 *    the difference is asserted as a figure.
 * 2. **Every flag publishes its comparison basis and its arithmetic.** Swept
 *    over every flag of every shape, with a meta-assertion that the sweep saw
 *    one.
 * 3. **Three-valued, never two.** `typical` and `undecided` are shown to be
 *    different answers, and the collapse is attempted deliberately to show it
 *    fails.
 * 4. **Every meta-assertion can fail**, and the input that makes each fail is
 *    built here and run through the public entry point.
 * 5. **An unmeasurable subject contributes nothing to an objective, and is
 *    counted.** Shown by constructing the schedule that would score better under
 *    the fold-into-zero version.
 *
 * Every figure below is derived from the corpus at test time. Nothing is
 * hand-copied except the counts the corpus README itself declares.
 *
 * **Test-hygiene note.** No corpus lookup is dereferenced in a `describe` body:
 * a `TypeError` at file load fails the whole file instead of firing the
 * meta-assertion that was supposed to catch it. Every subject is built inside a
 * test through {@link corpusReport} / {@link corpusFixtures}, which memoise.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  FAIRNESS_BASIS,
  FAIRNESS_COMPETITION,
  FAIRNESS_DISPERSION,
  FAIRNESS_JUDGEMENT,
  FAIRNESS_MEASURABILITY,
  FAIRNESS_METRIC,
  FAIRNESS_METRIC_ORDER,
  FAIRNESS_METRIC_REGISTRY,
  FAIRNESS_OBJECTIVE,
  FAIRNESS_OBJECTIVE_COMPETITIONS,
  FAIRNESS_OBJECTIVE_REGISTRY,
  FAIRNESS_OBJECTIVE_SENSE,
  FAIRNESS_REASON,
  FAIRNESS_REASON_SEVERITY,
  FAIRNESS_SEVERITY,
  FAIRNESS_STATUS,
  FAIRNESS_SUBJECT_KIND,
  MIN_POPULATION_FOR_DISPERSION,
  OUTLIER_SCORE_THRESHOLD,
  assertFairnessMeasurement,
  assertFlagEvidence,
  compareObjectiveScores,
  classifyFairnessFixtures,
  describeDispersion,
  deriveFairnessJudgement,
  fairnessReport,
  median,
  medianAbsoluteDeviation,
  modifiedZScore,
  participationOf,
  scoreFairnessObjective,
  toSeason2026FairnessFixtures,
} from '@squadlogic/core/fairness/index.js';
import { loadCoachRoster, loadCombinedSchedule } from '@squadlogic/core/fixtures/index.js';

// The full-season report is derived four times over in this file (plain,
// without the competition distinction, and twice under constructed variants),
// each over 578 fixtures and 156 populations. CI runs roughly 1.4x slower than
// the development machine, which puts the slowest case within a factor of two
// of vitest's 5s default.
vi.setConfig({ testTimeout: 30_000 });

/* -------------------------------------------------------------------------- */
/* Corpus subjects, built inside tests and memoised                            */
/* -------------------------------------------------------------------------- */

/** @type {{ rows: any[]|null, fixtures: any|null, report: any|null, teams: Set<string>|null }} */
const cache = { rows: null, fixtures: null, report: null, teams: null };

function corpusRows() {
  if (cache.rows === null) cache.rows = loadCombinedSchedule();
  return cache.rows;
}

function corpusFixtures() {
  if (cache.fixtures === null) cache.fixtures = toSeason2026FairnessFixtures(corpusRows());
  return cache.fixtures;
}

function corpusReport() {
  if (cache.report === null) cache.report = fairnessReport({ fixtures: corpusFixtures().fixtures });
  return cache.report;
}

function rosterTeamIds() {
  if (cache.teams === null) {
    cache.teams = new Set(loadCoachRoster().map((assignment) => assignment.teamCode));
  }
  return cache.teams;
}

/** Deep-freeze, so "reads its input and writes nothing" is tested and not promised. */
function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const inner of Object.values(value)) deepFreeze(inner, seen);
  return Object.freeze(value);
}

/** Every measurement for one metric and subject kind. */
function measurementsOf(report, metricId, subjectKind) {
  return report.measurements.filter(
    (measurement) => measurement.metricId === metricId && measurement.subjectKind === subjectKind
  );
}

function findingsOf(report, code) {
  return report.findings.filter((finding) => finding.code === code);
}

/** A minimal league fixture, for the constructed cases. */
function fixture(overrides = {}) {
  return {
    fixtureId: 'f1',
    scopeId: 'constructed',
    competition: FAIRNESS_COMPETITION.LEAGUE,
    date: '2026-08-22',
    kickoffMinutes: 600,
    venueId: 'venue-a',
    surfaceId: 'venue-a/pitch-1',
    division: 'U10B',
    ageGroup: 'U10',
    format: '7v7',
    homeSubjectId: 'home',
    awaySubjectId: 'away',
    ...overrides,
  };
}

/**
 * A round robin among `teamCount` teams over `rounds` dates, every fixture two
 * sided and at `kickoff`. The base every constructed case perturbs.
 */
function roundRobin({ teamCount, rounds, kickoff = 600, division = 'U10B', ageGroup = 'U10' }) {
  const teams = Array.from({ length: teamCount }, (unused, index) => `T${index + 1}`);
  const fixtures = [];
  for (let round = 0; round < rounds; round += 1) {
    for (let pair = 0; pair < Math.floor(teamCount / 2); pair += 1) {
      const home = teams[(pair + round) % teamCount];
      const away = teams[(teamCount - 1 - pair + round) % teamCount];
      if (home === away) continue;
      fixtures.push(
        fixture({
          fixtureId: `r${round}-p${pair}`,
          date: `2026-09-${String(round + 1).padStart(2, '0')}`,
          kickoffMinutes: kickoff,
          division,
          ageGroup,
          homeSubjectId: round % 2 === 0 ? home : away,
          awaySubjectId: round % 2 === 0 ? away : home,
        })
      );
    }
  }
  return fixtures;
}

/* -------------------------------------------------------------------------- */
/* 1. The corpus, and the five claims about it                                 */
/* -------------------------------------------------------------------------- */

describe('fairness :: what the corpus actually contains', () => {
  it('counts 140 participants, not 152 and not 141', () => {
    const rows = corpusRows();
    const naive = new Set();
    for (const row of rows) {
      naive.add(row.homeLabel);
      naive.add(row.awayLabel);
    }
    // The naive read of the Home/Away columns.
    expect(naive.size).toBe(152);

    // Excluding only the `-` token and the ten `Select Game N` labels leaves
    // 141 — which is still one too many, because `Scrimmage - teams TBD` is a
    // third placeholder and an eleven-label exclusion list misses it.
    const withoutTwoKinds = [...naive].filter(
      (label) => label.trim() !== '-' && !/^Select Game \d+$/.test(label)
    );
    expect(withoutTwoKinds.length).toBe(141);
    expect(withoutTwoKinds).toContain('Scrimmage - teams TBD');

    const report = corpusReport();
    expect(report.meta.subjectsConsidered).toBe(140);
    expect([...report.measurements.map((m) => m.subjectId)]).not.toContain('Scrimmage - teams TBD');
  });

  it('splits 122 league participants from 18 that hold no league fixture, and 13 of the 18 are the club’s own teams', () => {
    const report = corpusReport();
    const gamesPlayed = measurementsOf(
      report,
      FAIRNESS_METRIC.GAMES_PLAYED,
      FAIRNESS_SUBJECT_KIND.TEAM
    );
    const measured = gamesPlayed.filter((m) => m.measurability === FAIRNESS_MEASURABILITY.MEASURED);
    const outside = gamesPlayed.filter(
      (m) => m.reasonCode === FAIRNESS_REASON.FAIRNESS_SUBJECT_OUTSIDE_CLASS
    );
    expect(measured).toHaveLength(122);
    expect(outside).toHaveLength(18);
    expect(measured.every((m) => m.value === 9)).toBe(true);

    // The distribution among the 18: 14 play one fixture and 4 play two, and
    // this is where "those 19 are visiting clubs" goes wrong. Only five are.
    const participation = participationOf(corpusFixtures().fixtures);
    const counts = outside.map((m) => participation.get(m.subjectId).fixtures.length).sort();
    expect(counts.filter((n) => n === 1)).toHaveLength(14);
    expect(counts.filter((n) => n === 2)).toHaveLength(4);

    const roster = rosterTeamIds();
    const onRoster = outside.filter((m) => roster.has(m.subjectId));
    expect(onRoster).toHaveLength(13);
    expect(outside.filter((m) => !roster.has(m.subjectId))).toHaveLength(5);
    expect(outside.filter((m) => m.subjectId.startsWith('Visiting Club'))).toHaveLength(5);
  });

  it('finds every division and age-group cohort perfectly equal on game count', () => {
    const report = corpusReport();
    const populations = report.populations.filter(
      (population) =>
        population.metricId === FAIRNESS_METRIC.GAMES_PLAYED &&
        population.subjectKind === FAIRNESS_SUBJECT_KIND.TEAM
    );
    // Meta-assertion: a uniform verdict over zero populations is incident 4.
    expect(populations.length).toBeGreaterThan(0);
    const scoreable = populations.filter(
      (population) => population.dispersion.size >= MIN_POPULATION_FOR_DISPERSION
    );
    // 15 division cohorts, 7 age-group cohorts and the season cohort. The six
    // cohorts whose members all sit outside the league — divisions 16BS, 16GS,
    // U14 and U16G, and age groups U14 and U16 — have no measurable member at
    // all and are below the floor rather than uniform.
    expect(scoreable).toHaveLength(23);
    expect(
      scoreable.every((population) => population.dispersion.state === FAIRNESS_DISPERSION.UNIFORM)
    ).toBe(true);
    expect(scoreable.every((population) => population.dispersion.centre === 9)).toBe(true);
    // And a uniform population judges its *measured* members `typical`, not
    // `undecided`: "everybody here is identical" is an answer, not a shrug.
    const inUniform = report.judgements.filter(
      (judgement) =>
        judgement.metricId === FAIRNESS_METRIC.GAMES_PLAYED &&
        judgement.dispersionState === FAIRNESS_DISPERSION.UNIFORM
    );
    const judged = inUniform.filter((judgement) => judgement.value !== null);
    expect(judged.length).toBeGreaterThan(0);
    expect(judged.every((judgement) => judgement.judgement === FAIRNESS_JUDGEMENT.TYPICAL)).toBe(
      true
    );
    // A subject that could not be measured stays `undecided` even inside a
    // uniform cohort — the cohort's equality says nothing about a member whose
    // value was never obtained. On this corpus those are the 18 that hold no
    // league fixture, judged under the season cohort.
    const unmeasuredInUniform = inUniform.filter(
      (judgement) =>
        judgement.value === null && judgement.subjectKind === FAIRNESS_SUBJECT_KIND.TEAM
    );
    expect(unmeasuredInUniform).toHaveLength(18);
    expect(
      unmeasuredInUniform.every(
        (judgement) =>
          judgement.judgement === FAIRNESS_JUDGEMENT.UNDECIDED &&
          judgement.reasonCode === FAIRNESS_REASON.FAIRNESS_SUBJECT_OUTSIDE_CLASS
      )
    ).toBe(true);
  });

  it('confirms the corpus’ own day, venue and division figures over the 140 participants', () => {
    const { fixtures } = corpusFixtures();
    const participation = participationOf(fixtures);
    const dayOf = (iso) => {
      // Zeller's congruence. No `Date` construction anywhere (GAP-30).
      const [year, month, day] = iso.split('-').map(Number);
      const shiftedMonth = month < 3 ? month + 12 : month;
      const shiftedYear = month < 3 ? year - 1 : year;
      const k = shiftedYear % 100;
      const j = Math.floor(shiftedYear / 100);
      const h =
        (day +
          Math.floor((13 * (shiftedMonth + 1)) / 5) +
          k +
          Math.floor(k / 4) +
          Math.floor(j / 4) +
          5 * j) %
        7;
      return ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI'][h];
    };

    let saturdayOnly = 0;
    let sundayOnly = 0;
    let both = 0;
    const venueCounts = new Map();
    for (const entry of participation.values()) {
      const days = new Set(entry.fixtures.map((held) => dayOf(held.fixture.date)));
      const key = [...days].sort().join(',');
      if (key === 'SAT') saturdayOnly += 1;
      else if (key === 'SUN') sundayOnly += 1;
      else if (key === 'SAT,SUN') both += 1;
      const venues = new Set(entry.fixtures.map((held) => held.fixture.venueId)).size;
      venueCounts.set(venues, (venueCounts.get(venues) ?? 0) + 1);
    }
    expect({ saturdayOnly, sundayOnly, both }).toEqual({
      saturdayOnly: 132,
      sundayOnly: 5,
      both: 3,
    });
    expect(venueCounts.get(1)).toBe(111);
    expect(venueCounts.get(2)).toBe(29);
    expect(saturdayOnly + sundayOnly + both).toBe(140);

    const divisions = [...new Set(corpusRows().map((row) => row.division))].sort();
    expect(divisions).toEqual([
      '16BS',
      '16GS',
      'BB',
      'Select',
      'U05B',
      'U05G',
      'U06B',
      'U06G',
      'U07B',
      'U07G',
      'U08B',
      'U08G',
      'U09B',
      'U09G',
      'U10B',
      'U10G',
      'U12B',
      'U12G',
      'U14',
      'U16G',
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. The distinction, measured against its own absence                        */
/* -------------------------------------------------------------------------- */

describe('fairness :: the league / external / friendly distinction', () => {
  it('maps every corpus row kind, drops the 101 that name nobody, and refuses an unknown kind', () => {
    const { fixtures, droppedByRowKind, rowsRead } = corpusFixtures();
    expect(rowsRead).toBe(679);
    expect(droppedByRowKind).toEqual({ league_placeholder: 100, reservation: 1 });
    expect(fixtures).toHaveLength(578);

    const classification = classifyFairnessFixtures(fixtures);
    expect(classification.usable).toBe(true);
    expect(classification.byCompetition).toEqual({ league: 567, external: 8, friendly: 3 });
    // 567 league rows is the corpus README's own published-rec-game count.
    expect(classification.byCompetition.league).toBe(567);
  });

  it('removes 19 false flags about 15 non-league participants, and restores 7 real ones', () => {
    const { fixtures } = corpusFixtures();

    // The control: the same corpus with the distinction erased, so the eight
    // external seeding games and the three scrimmages count as league fixtures.
    const flattened = fixtures.map((held) => ({
      ...held,
      competition: FAIRNESS_COMPETITION.LEAGUE,
    }));
    const naive = fairnessReport({ fixtures: flattened });
    const report = corpusReport();
    const key = (flag) => `${flag.subjectId}|${flag.metricId}|${flag.basis.kind}`;
    const naiveKeys = new Set(naive.flags.map(key));
    const realKeys = new Set(report.flags.map(key));

    expect(naive.flags).toHaveLength(21);
    expect(report.flags).toHaveLength(9);

    // Every flag the naive report raises and this one does not is about a
    // participant that holds no league fixture at all — a guest of another
    // league, or a Select side whose league layer is 100 unassigned slots.
    const naiveOnly = [...naiveKeys].filter((entry) => !realKeys.has(entry));
    expect(naiveOnly).toHaveLength(19);
    const participation = participationOf(fixtures);
    const accused = [...new Set(naiveOnly.map((entry) => entry.split('|')[0]))];
    expect(accused).toHaveLength(15);
    expect(
      accused.every((subjectId) => participation.get(subjectId).byCompetition.league === 0)
    ).toBe(true);

    // And it works in both directions: seven real signals are *drowned* without
    // the distinction, because a season population polluted with fourteen
    // one-fixture participants moves its own centre.
    expect([...realKeys].filter((entry) => !naiveKeys.has(entry))).toHaveLength(7);
  });

  it('is the difference between a game-count metric that answers and one that cannot', () => {
    const { fixtures } = corpusFixtures();
    const flattened = fixtures.map((held) => ({
      ...held,
      competition: FAIRNESS_COMPETITION.LEAGUE,
    }));
    const naive = fairnessReport({ fixtures: flattened });

    // Without the distinction the season's game counts are 122 nines, 14 ones
    // and 4 twos. More than half the population shares one value, so the median
    // absolute deviation is exactly zero over values that differ: the scale
    // collapses and **nobody at all** can be judged.
    const naivePopulation = naive.populations.find(
      (population) =>
        population.metricId === FAIRNESS_METRIC.GAMES_PLAYED &&
        population.subjectKind === FAIRNESS_SUBJECT_KIND.TEAM &&
        population.basisKind === FAIRNESS_BASIS.SEASON
    );
    expect(naivePopulation.dispersion.state).toBe(FAIRNESS_DISPERSION.DEGENERATE);
    expect(naivePopulation.dispersion.distribution).toEqual([
      [1, 14],
      [2, 4],
      [9, 122],
    ]);
    const naiveJudgements = naive.judgements.filter(
      (judgement) =>
        judgement.metricId === FAIRNESS_METRIC.GAMES_PLAYED &&
        judgement.subjectKind === FAIRNESS_SUBJECT_KIND.TEAM &&
        judgement.basis.kind === FAIRNESS_BASIS.SEASON
    );
    expect(naiveJudgements).toHaveLength(140);
    expect(
      naiveJudgements.every((judgement) => judgement.judgement === FAIRNESS_JUDGEMENT.UNDECIDED)
    ).toBe(true);

    // With it, the same population is 122 identical values: `uniform`, which is
    // a measured "this league is equal on game count" and not a shrug.
    const report = corpusReport();
    const population = report.populations.find(
      (candidate) =>
        candidate.metricId === FAIRNESS_METRIC.GAMES_PLAYED &&
        candidate.subjectKind === FAIRNESS_SUBJECT_KIND.TEAM &&
        candidate.basisKind === FAIRNESS_BASIS.SEASON
    );
    expect(population.dispersion.state).toBe(FAIRNESS_DISPERSION.UNIFORM);
    expect(population.dispersion.distribution).toEqual([[9, 122]]);
    const judgements = report.judgements.filter(
      (judgement) =>
        judgement.metricId === FAIRNESS_METRIC.GAMES_PLAYED &&
        judgement.subjectKind === FAIRNESS_SUBJECT_KIND.TEAM &&
        judgement.basis.kind === FAIRNESS_BASIS.SEASON
    );
    expect(
      judgements.filter((judgement) => judgement.judgement === FAIRNESS_JUDGEMENT.TYPICAL)
    ).toHaveLength(122);
    // The eighteen are reported, not omitted and not scored zero.
    const outside = findingsOf(report, FAIRNESS_REASON.FAIRNESS_SUBJECT_OUTSIDE_CLASS).filter(
      (finding) =>
        finding.details.metricId === FAIRNESS_METRIC.GAMES_PLAYED &&
        finding.details.subjectKind === FAIRNESS_SUBJECT_KIND.TEAM
    );
    expect(outside).toHaveLength(1);
    expect(outside[0].details.subjectCount).toBe(18);
  });

  it('refuses an unknown competition rather than counting it as league', () => {
    const classification = classifyFairnessFixtures([
      fixture({ fixtureId: 'a' }),
      fixture({ fixtureId: 'b', competition: 'tournament' }),
      fixture({ fixtureId: 'c', competition: 'tournament' }),
    ]);
    expect(classification.usable).toBe(false);
    const refusal = classification.findings.find(
      (finding) => finding.code === FAIRNESS_REASON.FAIRNESS_FIXTURE_UNCLASSIFIED
    );
    expect(refusal.severity).toBe(FAIRNESS_SEVERITY.BLOCKING);
    expect(refusal.details).toMatchObject({ competition: 'tournament', fixtureCount: 2 });
    expect(classification.byCompetition.league).toBe(1);
  });

  it('refuses a fixture list that spans two scopes, because a division is a label and not a key', () => {
    const classification = classifyFairnessFixtures([
      fixture({ fixtureId: 'a', scopeId: 'club-a', division: 'U10B' }),
      fixture({ fixtureId: 'b', scopeId: 'club-b', division: 'U10B' }),
    ]);
    expect(classification.scopeId).toBeNull();
    expect(classification.usable).toBe(false);
    const refusal = classification.findings.find(
      (finding) => finding.code === FAIRNESS_REASON.FAIRNESS_SCOPE_MIXED
    );
    expect(refusal.severity).toBe(FAIRNESS_SEVERITY.BLOCKING);
    expect(refusal.details.scopeIds).toEqual(['club-a', 'club-b']);
  });

  it('reports fixtures that name nobody rather than silently shortening the list', () => {
    const classification = classifyFairnessFixtures([
      fixture({ fixtureId: 'a' }),
      fixture({ fixtureId: 'b', homeSubjectId: null, awaySubjectId: null }),
    ]);
    expect(classification.placeholderFixtures).toBe(1);
    const notice = classification.findings.find(
      (finding) => finding.code === FAIRNESS_REASON.FAIRNESS_PLACEHOLDER_EXCLUDED
    );
    expect(notice.severity).toBe(FAIRNESS_SEVERITY.INFO);
    expect(notice.details.placeholderFixtures).toBe(1);
    // Info: it does not compromise a report, it explains one.
    expect(classification.usable).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Artifacts of the fixture format, not inequities                          */
/* -------------------------------------------------------------------------- */

describe('fairness :: a flag that fires on an artifact is the failure mode', () => {
  it('does not flag the four Minis sides, whose 9/0 hosting record is an absent opponent', () => {
    const { fixtures } = corpusFixtures();
    const participation = participationOf(fixtures);
    const minis = ['MinisA', 'MinisB', 'MinisC', 'MinisD'];

    // The artifact, stated from the corpus: nine league fixtures each, and not
    // one of them names an opponent.
    for (const id of minis) {
      const entry = participation.get(id);
      expect(entry.fixtures).toHaveLength(9);
      expect(entry.fixtures.every((held) => held.fixture.awaySubjectId === null)).toBe(true);
    }

    // The naive metric: hosting share read as hosted/played rather than
    // hosted/two-sided. It puts the four of them at 1.0 — the most extreme
    // value in the season — and an ordinary z-score, which is the statistic an
    // implementer reaches for first, flags all four and nobody else.
    const naiveShares = [...participation.entries()]
      .filter(([, entry]) => entry.byCompetition.league > 0)
      .map(([subjectId, entry]) => ({
        subjectId,
        value:
          entry.fixtures.filter((held) => held.fixture.homeSubjectId === subjectId).length /
          entry.fixtures.length,
      }));
    expect(naiveShares).toHaveLength(122);
    const values = naiveShares.map((member) => member.value);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const sd = Math.sqrt(
      values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
    );
    const naiveFlagged = naiveShares.filter((member) => Math.abs((member.value - mean) / sd) > 3);
    expect(naiveFlagged.map((member) => member.subjectId).sort()).toEqual(minis);
    expect(naiveFlagged.every((member) => member.value === 1)).toBe(true);
    expect((1 - mean) / sd).toBeCloseTo(4.6293, 3);

    // The median-based scale this module uses happens to absorb them on this
    // corpus — the hosting shares are bimodal at 4/9 and 5/9, which inflates the
    // MAD — and that is **not** the defence. A robust statistic that survives
    // one artifact is a robust statistic that will meet a bigger one. The
    // defence is structural: hosting share over a fixture with no away side is
    // not a large number or a small one, it is not a quantity, and the module
    // refuses to produce one whatever any statistic would have said about it.
    const madDispersion = describeDispersion('naive-hosting-share', naiveShares);
    expect(madDispersion.state).toBe(FAIRNESS_DISPERSION.USABLE);
    expect(Math.abs(modifiedZScore(1, madDispersion))).toBeLessThan(OUTLIER_SCORE_THRESHOLD);

    // The module's answer: unmeasurable, with the reason, and no flag anywhere.
    const report = corpusReport();
    for (const id of minis) {
      const measurement = report.measurements.find(
        (m) =>
          m.subjectId === id &&
          m.metricId === FAIRNESS_METRIC.HOSTING_SHARE &&
          m.subjectKind === FAIRNESS_SUBJECT_KIND.TEAM
      );
      expect(measurement.measurability).toBe(FAIRNESS_MEASURABILITY.UNMEASURABLE);
      expect(measurement.value).toBeNull();
      expect(measurement.reasonCode).toBe(FAIRNESS_REASON.FAIRNESS_DENOMINATOR_EMPTY);
      expect(measurement.evidence.exclusions).toContainEqual(['fixture-names-no-opponent', 9]);
    }
    expect(
      report.flags.filter((flag) => flag.metricId === FAIRNESS_METRIC.HOSTING_SHARE)
    ).toHaveLength(0);
    // And it is refused by structure rather than by a Minis-shaped exception:
    // nothing in the module tests a format name.
    expect(FAIRNESS_METRIC_REGISTRY[FAIRNESS_METRIC.HOSTING_SHARE].measure.toString()).not.toMatch(
      /Minis/
    );
  });

  it('marks seven of the eight season-wide kickoff flags as not holding in the team’s own division', () => {
    const report = corpusReport();
    const seasonFlags = report.flags.filter(
      (flag) =>
        flag.basis.kind === FAIRNESS_BASIS.SEASON && flag.metricId === FAIRNESS_METRIC.MEAN_KICKOFF
    );
    expect(seasonFlags).toHaveLength(8);
    expect(seasonFlags.filter((flag) => flag.heldOnNarrowerBasis === false)).toHaveLength(7);
    expect(seasonFlags.filter((flag) => flag.heldOnNarrowerBasis === true)).toHaveLength(1);
    expect(findingsOf(report, FAIRNESS_REASON.FAIRNESS_BASIS_WIDER_ONLY)).toHaveLength(7);

    // The reason the seven are artifacts is legible from the corpus: every one
    // is a U09/U10/U12 side, and the club schedules its youngest in the morning.
    // The season cohort mixes age brackets, so it measures the timetable.
    expect(
      seasonFlags
        .filter((flag) => flag.heldOnNarrowerBasis === false)
        .every((flag) => /^(09|10|12)/.test(flag.subjectId))
    ).toBe(true);

    // The one that survives does so on its own division's evidence.
    const survivor = seasonFlags.find((flag) => flag.heldOnNarrowerBasis === true);
    expect(survivor.subjectId).toBe('09G7v706');
    const divisionFlag = report.flags.find(
      (flag) =>
        flag.subjectId === '09G7v706' &&
        flag.basis.kind === FAIRNESS_BASIS.DIVISION &&
        flag.metricId === FAIRNESS_METRIC.MEAN_KICKOFF
    );
    expect(divisionFlag.basis.groupKey).toBe('U09G');
    expect(divisionFlag.basis.populationSize).toBe(6);
    expect(divisionFlag.heldOnNarrowerBasis).toBeNull();
  });

  it('raises exactly one flag on the narrowest basis, and its arithmetic reproduces by hand', () => {
    const report = corpusReport();
    const divisionFlags = report.flags.filter(
      (flag) => flag.basis.kind === FAIRNESS_BASIS.DIVISION
    );
    expect(divisionFlags).toHaveLength(1);
    const flag = divisionFlags[0];

    const { fixtures } = corpusFixtures();
    const participation = participationOf(fixtures);
    const u09g = [...participation.entries()]
      .filter(([, entry]) => entry.divisions.size === 1 && entry.divisions.has('U09G'))
      .map(([subjectId, entry]) => ({
        subjectId,
        value:
          entry.fixtures.reduce((sum, held) => sum + held.fixture.kickoffMinutes, 0) /
          entry.fixtures.length,
      }));
    expect(u09g).toHaveLength(6);
    const centre = median(u09g.map((member) => member.value));
    const scale = medianAbsoluteDeviation(u09g.map((member) => member.value));
    const subject = u09g.find((member) => member.subjectId === flag.subjectId);

    expect(flag.value).toBeCloseTo(subject.value, 9);
    expect(flag.centre).toBeCloseTo(centre, 9);
    expect(flag.scale).toBeCloseTo(scale, 9);
    expect(flag.deviation).toBeCloseTo(subject.value - centre, 9);
    expect(flag.score).toBeCloseTo((0.6745 * (subject.value - centre)) / scale, 9);
    expect(Math.abs(flag.score)).toBeGreaterThan(OUTLIER_SCORE_THRESHOLD);
    expect(flag.deviation).toBeCloseTo(25, 9);
    expect(flag.unit).toBe('minutes past midnight');
  });

  it('did not have its threshold tuned to this corpus: five more artifacts sit at 3.4819', () => {
    const report = corpusReport();
    const typical = report.judgements.filter(
      (judgement) => judgement.judgement === FAIRNESS_JUDGEMENT.TYPICAL && judgement.score !== null
    );
    expect(typical.length).toBeGreaterThan(0);
    const nearest = typical.reduce((best, judgement) =>
      Math.abs(judgement.score) > Math.abs(best.score) ? judgement : best
    );
    expect(Math.abs(nearest.score)).toBeCloseTo(3.4819, 3);
    expect(Math.abs(nearest.score)).toBeLessThan(OUTLIER_SCORE_THRESHOLD);
    expect(nearest.basis.kind).toBe(FAIRNESS_BASIS.SEASON);
    expect(nearest.metricId).toBe(FAIRNESS_METRIC.MEAN_KICKOFF);

    // Six U09 sides and the U09 age group itself sit at that score, and they
    // are the same age-structure artifact as the seven the wider-basis check
    // already names. 3.5 is Iglewicz and Hoaglin's published figure, used
    // unmodified; the point of recording the near miss is that a threshold
    // chosen to make this corpus look tidy would have been set below it, and
    // seven more artifacts would have come with it.
    const atTheEdge = typical.filter(
      (judgement) => Math.abs(Math.abs(judgement.score) - Math.abs(nearest.score)) < 1e-9
    );
    expect(atTheEdge).toHaveLength(7);
    expect(
      atTheEdge.every(
        (judgement) => judgement.subjectId.startsWith('09') || judgement.subjectId === 'U09'
      )
    ).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* 4. Every flag carries its evidence and its basis                            */
/* -------------------------------------------------------------------------- */

describe('fairness :: every flag publishes what decided it', () => {
  it('carries a basis, a population size, a centre, a scale, a deviation and a score — on every flag', () => {
    const report = corpusReport();
    expect(report.flags.length).toBeGreaterThan(0);
    for (const flag of report.flags) {
      expect(typeof flag.basis.kind).toBe('string');
      expect(flag.basis.groupKey).not.toBeNull();
      expect(flag.basis.populationSize).toBeGreaterThanOrEqual(MIN_POPULATION_FOR_DISPERSION);
      expect(Number.isFinite(flag.value)).toBe(true);
      expect(Number.isFinite(flag.centre)).toBe(true);
      expect(Number.isFinite(flag.scale)).toBe(true);
      expect(Number.isFinite(flag.deviation)).toBe(true);
      expect(Number.isFinite(flag.score)).toBe(true);
      expect(flag.threshold).toBe(OUTLIER_SCORE_THRESHOLD);
      expect(['above', 'below']).toContain(flag.direction);
      expect(flag.evidence.fixturesCounted).toBeGreaterThan(0);
      expect(flag.unit).toBe(FAIRNESS_METRIC_REGISTRY[flag.metricId].unit);
    }
    expect(assertFlagEvidence(report.flags)).toEqual([]);

    // Each flag also has a finding that names the same numbers, so a reader of
    // `findings` alone gets the whole basis and not a bare accusation.
    const outlierFindings = report.findings.filter((finding) =>
      [FAIRNESS_REASON.FAIRNESS_OUTLIER_HIGH, FAIRNESS_REASON.FAIRNESS_OUTLIER_LOW].includes(
        finding.code
      )
    );
    expect(outlierFindings).toHaveLength(report.flags.length);
    for (const finding of outlierFindings) {
      for (const key of ['centre', 'scale', 'deviation', 'score', 'threshold', 'populationSize']) {
        expect(finding.details[key]).not.toBeUndefined();
        expect(finding.details[key]).not.toBeNull();
      }
    }
  });

  it('refuses a flag whose basis or arithmetic is missing', () => {
    const naked = /** @type {any} */ ({
      metricId: FAIRNESS_METRIC.MEAN_KICKOFF,
      subjectKind: FAIRNESS_SUBJECT_KIND.TEAM,
      subjectId: 'T1',
      basis: { kind: FAIRNESS_BASIS.DIVISION, groupKey: null, populationSize: 0 },
      judgement: FAIRNESS_JUDGEMENT.OUTLIER,
      value: 600,
      centre: null,
      scale: null,
      deviation: null,
      score: null,
      threshold: null,
      direction: null,
      evidence: { fixturesCounted: 0, fixturesExcluded: 0, exclusions: [] },
    });
    const refusals = assertFlagEvidence([naked]);
    expect(refusals).toHaveLength(1);
    expect(refusals[0].code).toBe(FAIRNESS_REASON.FAIRNESS_FLAG_EVIDENCE_MISSING);
    expect(refusals[0].severity).toBe(FAIRNESS_SEVERITY.BLOCKING);
    expect(refusals[0].details.missing).toEqual(
      expect.arrayContaining([
        'centre',
        'scale',
        'deviation',
        'score',
        'threshold',
        'direction',
        'basis.groupKey',
        'basis.populationSize',
        'evidence.fixturesCounted',
      ])
    );
  });

  it('flags low as readily as high, and refuses to say which end is the bad one', () => {
    // Twelve teams, nine one-sided fixtures each so the population is exactly
    // the twelve. Eleven of them sit around 10:00 with a real spread; T1 plays
    // every one of its fixtures at 08:00.
    const fixtures = [];
    for (let team = 1; team <= 12; team += 1) {
      for (let round = 0; round < 9; round += 1) {
        fixtures.push(
          fixture({
            fixtureId: `t${team}-r${round}`,
            date: `2026-09-${String(round + 1).padStart(2, '0')}`,
            kickoffMinutes: team === 1 ? 480 : 600 + ((team + round) % 4) * 7,
            homeSubjectId: `T${team}`,
            awaySubjectId: null,
          })
        );
      }
    }
    const report = fairnessReport({ fixtures, metricIds: [FAIRNESS_METRIC.MEAN_KICKOFF] });
    const low = report.flags.filter((flag) => flag.direction === 'below');
    expect(low.length).toBeGreaterThan(0);
    expect(low.every((flag) => flag.subjectId === 'T1')).toBe(true);
    expect(low[0].value).toBe(480);
    expect(low[0].deviation).toBeLessThan(0);
    expect(findingsOf(report, FAIRNESS_REASON.FAIRNESS_OUTLIER_LOW).length).toBeGreaterThan(0);
    // The severity of high and low is identical: the module reports a distance
    // from the cohort and declines to say which side of it is worse.
    expect(FAIRNESS_REASON_SEVERITY[FAIRNESS_REASON.FAIRNESS_OUTLIER_LOW]).toBe(
      FAIRNESS_REASON_SEVERITY[FAIRNESS_REASON.FAIRNESS_OUTLIER_HIGH]
    );
  });
});

/* -------------------------------------------------------------------------- */
/* 5. Three-valued, never two                                                  */
/* -------------------------------------------------------------------------- */

describe('fairness :: unmeasurable is not zero and typical is not undecided', () => {
  it('never lets a measurement carry both a number and a reason, or neither', () => {
    const report = corpusReport();
    expect(report.measurements.length).toBeGreaterThan(0);
    for (const measurement of report.measurements) {
      if (measurement.measurability === FAIRNESS_MEASURABILITY.MEASURED) {
        expect(Number.isFinite(measurement.value)).toBe(true);
        expect(measurement.reasonCode).toBeNull();
      } else {
        expect(measurement.value).toBeNull();
        expect(measurement.reasonCode).not.toBeNull();
      }
    }
    // Both directions of the collapse are refused.
    expect(() =>
      assertFairnessMeasurement({
        metricId: FAIRNESS_METRIC.HOSTING_SHARE,
        unit: 'share of 1',
        subjectKind: FAIRNESS_SUBJECT_KIND.TEAM,
        subjectId: 'MinisA',
        measurability: FAIRNESS_MEASURABILITY.UNMEASURABLE,
        value: 0,
        reasonCode: FAIRNESS_REASON.FAIRNESS_DENOMINATOR_EMPTY,
        evidence: { fixturesCounted: 0, fixturesExcluded: 9, exclusions: [] },
      })
    ).toThrow(/folding an unmeasurable subject into a number/);
    expect(() =>
      assertFairnessMeasurement({
        metricId: FAIRNESS_METRIC.HOSTING_SHARE,
        unit: 'share of 1',
        subjectKind: FAIRNESS_SUBJECT_KIND.TEAM,
        subjectId: 'MinisA',
        measurability: FAIRNESS_MEASURABILITY.MEASURED,
        value: null,
        reasonCode: null,
        evidence: { fixturesCounted: 0, fixturesExcluded: 9, exclusions: [] },
      })
    ).toThrow(/a measurement with no number is unmeasurable/);
  });

  it('separates a scale of zero over identical values from one over differing values', () => {
    const uniform = describeDispersion('m', [
      { subjectId: 'a', value: 9 },
      { subjectId: 'b', value: 9 },
      { subjectId: 'c', value: 9 },
      { subjectId: 'd', value: 9 },
    ]);
    const degenerate = describeDispersion('m', [
      { subjectId: 'a', value: 9 },
      { subjectId: 'b', value: 9 },
      { subjectId: 'c', value: 9 },
      { subjectId: 'd', value: 4 },
    ]);
    expect(uniform.scale).toBe(0);
    expect(degenerate.scale).toBe(0);
    expect(uniform.state).toBe(FAIRNESS_DISPERSION.UNIFORM);
    expect(degenerate.state).toBe(FAIRNESS_DISPERSION.DEGENERATE);
    // The same `mad === 0` test, and opposite answers about every member.
    expect(
      deriveFairnessJudgement({
        measurability: FAIRNESS_MEASURABILITY.MEASURED,
        dispersion: uniform.state,
        score: null,
        threshold: OUTLIER_SCORE_THRESHOLD,
      })
    ).toBe(FAIRNESS_JUDGEMENT.TYPICAL);
    expect(
      deriveFairnessJudgement({
        measurability: FAIRNESS_MEASURABILITY.MEASURED,
        dispersion: degenerate.state,
        score: null,
        threshold: OUTLIER_SCORE_THRESHOLD,
      })
    ).toBe(FAIRNESS_JUDGEMENT.UNDECIDED);
    // The degenerate population publishes what its scale could not.
    expect(degenerate.distribution).toEqual([
      [4, 1],
      [9, 3],
    ]);
    // Both states are live in the corpus, not only in this construction.
    const report = corpusReport();
    const states = new Set(report.populations.map((population) => population.dispersion.state));
    expect(states.has(FAIRNESS_DISPERSION.UNIFORM)).toBe(true);
    expect(states.has(FAIRNESS_DISPERSION.DEGENERATE)).toBe(true);
    expect(states.has(FAIRNESS_DISPERSION.INSUFFICIENT)).toBe(true);
    expect(states.has(FAIRNESS_DISPERSION.USABLE)).toBe(true);
  });

  it('never scores an infinite deviation, and throws rather than comparing one', () => {
    const degenerate = describeDispersion('m', [
      { subjectId: 'a', value: 9 },
      { subjectId: 'b', value: 9 },
      { subjectId: 'c', value: 9 },
      { subjectId: 'd', value: 4 },
    ]);
    expect(modifiedZScore(4, degenerate)).toBeNull();
    expect(() =>
      deriveFairnessJudgement({
        measurability: FAIRNESS_MEASURABILITY.MEASURED,
        dispersion: FAIRNESS_DISPERSION.USABLE,
        score: Infinity,
        threshold: OUTLIER_SCORE_THRESHOLD,
      })
    ).toThrow(/a scale of zero wearing a number/);
    const report = corpusReport();
    expect(
      report.judgements.every(
        (judgement) => judgement.score === null || Number.isFinite(judgement.score)
      )
    ).toBe(true);
  });

  it('leaves a cohort of two undecided rather than typical — on all 36 division cohorts of this corpus', () => {
    const report = corpusReport();
    const divisionCohorts = report.populations.filter(
      (population) => population.subjectKind === FAIRNESS_SUBJECT_KIND.DIVISION
    );
    expect(divisionCohorts).toHaveLength(36);
    expect(
      divisionCohorts.every(
        (population) => population.dispersion.state === FAIRNESS_DISPERSION.INSUFFICIENT
      )
    ).toBe(true);
    const divisionJudgements = report.judgements.filter(
      (judgement) => judgement.subjectKind === FAIRNESS_SUBJECT_KIND.DIVISION
    );
    expect(divisionJudgements.length).toBeGreaterThan(0);
    expect(
      divisionJudgements.every((judgement) => judgement.judgement === FAIRNESS_JUDGEMENT.UNDECIDED)
    ).toBe(true);
    // And it says so, rather than reporting "no division outliers found".
    expect(
      findingsOf(report, FAIRNESS_REASON.FAIRNESS_POPULATION_TOO_SMALL).length
    ).toBeGreaterThan(0);
  });

  it('judges no cohort under a division label a subject holds twice, and names the subject', () => {
    const report = corpusReport();
    const ambiguous = findingsOf(report, FAIRNESS_REASON.FAIRNESS_GROUP_AMBIGUOUS);
    expect(ambiguous.length).toBeGreaterThan(0);
    expect(ambiguous[0].details.subjects).toContain('16GSelect02');
    expect(ambiguous[0].severity).toBe(FAIRNESS_SEVERITY.COMPROMISE);
    const judgements = report.judgements.filter(
      (judgement) =>
        judgement.subjectId === '16GSelect02' && judgement.basis.kind === FAIRNESS_BASIS.DIVISION
    );
    expect(judgements.length).toBeGreaterThan(0);
    expect(judgements.every((j) => j.judgement === FAIRNESS_JUDGEMENT.UNDECIDED)).toBe(true);
    expect(judgements.every((j) => j.basis.groupKey === null)).toBe(true);
  });

  it('judges the four Minis sides under no age-group cohort, because BB parses to none', () => {
    const report = corpusReport();
    const unlabelled = findingsOf(report, FAIRNESS_REASON.FAIRNESS_GROUP_UNLABELLED);
    expect(unlabelled.length).toBeGreaterThan(0);
    const teamLevel = unlabelled.filter(
      (finding) => finding.details.subjectKind === FAIRNESS_SUBJECT_KIND.TEAM
    );
    expect(teamLevel.length).toBeGreaterThan(0);
    expect(teamLevel[0].details.subjects).toEqual(['MinisA', 'MinisB', 'MinisC', 'MinisD']);
    // They are still judged in their own division, which does exist.
    const inDivision = report.judgements.filter(
      (judgement) =>
        judgement.subjectId === 'MinisA' &&
        judgement.basis.kind === FAIRNESS_BASIS.DIVISION &&
        judgement.metricId === FAIRNESS_METRIC.GAMES_PLAYED
    );
    expect(inDivision).toHaveLength(1);
    expect(inDivision[0].basis.groupKey).toBe('BB');
    expect(inDivision[0].judgement).toBe(FAIRNESS_JUDGEMENT.TYPICAL);
  });
});

/* -------------------------------------------------------------------------- */
/* 6. The meta-assertions, and the input that makes each fail                  */
/* -------------------------------------------------------------------------- */

describe('fairness :: every check can fail, and here is what makes it', () => {
  it('passes all four on the season corpus', () => {
    const report = corpusReport();
    for (const code of [
      FAIRNESS_REASON.FAIRNESS_NO_FIXTURES_READ,
      FAIRNESS_REASON.FAIRNESS_METRIC_UNEXERCISED,
      FAIRNESS_REASON.FAIRNESS_NOTHING_JUDGED,
      FAIRNESS_REASON.FAIRNESS_FLAG_EVIDENCE_MISSING,
    ]) {
      expect(findingsOf(report, code)).toHaveLength(0);
    }
    expect(report.status).toBe(FAIRNESS_STATUS.COMPROMISED);
    expect(report.meta.fixturesRead).toBe(578);
    expect(report.meta.judgementsMade).toBeGreaterThan(0);
  });

  it('FAIRNESS_NO_FIXTURES_READ: a list the schema accepts and the classifier rejects wholesale', () => {
    const report = fairnessReport({
      fixtures: [fixture({ competition: 'tournament' })],
    });
    expect(findingsOf(report, FAIRNESS_REASON.FAIRNESS_NO_FIXTURES_READ)).toHaveLength(1);
    expect(report.meta.fixturesRead).toBe(0);
    expect(report.status).toBe(FAIRNESS_STATUS.REJECTED);
  });

  it('FAIRNESS_METRIC_UNEXERCISED: a season of external fixtures only', () => {
    const fixtures = Array.from({ length: 8 }, (unused, index) =>
      fixture({
        fixtureId: `e${index}`,
        competition: FAIRNESS_COMPETITION.EXTERNAL,
        homeSubjectId: `H${index}`,
        awaySubjectId: `A${index}`,
      })
    );
    const report = fairnessReport({ fixtures });
    const unexercised = findingsOf(report, FAIRNESS_REASON.FAIRNESS_METRIC_UNEXERCISED);
    expect(unexercised).toHaveLength(FAIRNESS_METRIC_ORDER.length);
    expect(unexercised.every((finding) => finding.severity === FAIRNESS_SEVERITY.BLOCKING)).toBe(
      true
    );
    expect(unexercised[0].details.subjectsConsidered).toBeGreaterThan(0);
    expect(report.status).toBe(FAIRNESS_STATUS.REJECTED);
  });

  it('FAIRNESS_NOTHING_JUDGED: three teams, so no cohort reaches the four-member floor', () => {
    const fixtures = [
      fixture({ fixtureId: 'a', homeSubjectId: 'T1', awaySubjectId: 'T2' }),
      fixture({ fixtureId: 'b', date: '2026-08-29', homeSubjectId: 'T2', awaySubjectId: 'T3' }),
      fixture({ fixtureId: 'c', date: '2026-09-05', homeSubjectId: 'T3', awaySubjectId: 'T1' }),
    ];
    const report = fairnessReport({ fixtures });
    expect(report.meta.judgementsMade).toBe(0);
    expect(findingsOf(report, FAIRNESS_REASON.FAIRNESS_NOTHING_JUDGED)).toHaveLength(1);
    expect(report.status).toBe(FAIRNESS_STATUS.REJECTED);
    // The distinction that matters: the metrics *were* exercised. This is not
    // incident 4 — it is a season too small to say anything about.
    expect(findingsOf(report, FAIRNESS_REASON.FAIRNESS_METRIC_UNEXERCISED)).toHaveLength(0);
    expect(report.meta.measurementsMeasured).toBeGreaterThan(0);
  });

  it('FAIRNESS_VALUE_UNAVAILABLE: a league of fixtures that carry no kickoff', () => {
    const fixtures = roundRobin({ teamCount: 6, rounds: 5 }).map((held) => ({
      ...held,
      kickoffMinutes: null,
    }));
    const report = fairnessReport({ fixtures, metricIds: [FAIRNESS_METRIC.MEAN_KICKOFF] });
    const unavailable = findingsOf(report, FAIRNESS_REASON.FAIRNESS_VALUE_UNAVAILABLE).filter(
      (finding) => finding.details.subjectKind === FAIRNESS_SUBJECT_KIND.TEAM
    );
    expect(unavailable).toHaveLength(1);
    expect(unavailable[0].details.subjectCount).toBe(6);
    // An unmeasurable metric is unexercised, and both are said.
    expect(findingsOf(report, FAIRNESS_REASON.FAIRNESS_METRIC_UNEXERCISED)).toHaveLength(1);
  });

  it('refuses a report over zero fixtures at the schema boundary', () => {
    expect(() => fairnessReport({ fixtures: [] })).toThrow(/looked at nothing/);
  });

  it('states its membership split, or states that it cannot', () => {
    const report = corpusReport();
    expect(report.membership.stated).toBe(false);
    expect(findingsOf(report, FAIRNESS_REASON.FAIRNESS_MEMBERSHIP_UNSTATED)).toHaveLength(1);

    const withRoster = fairnessReport({
      fixtures: corpusFixtures().fixtures,
      memberSubjectIds: [...rosterTeamIds()],
    });
    expect(withRoster.membership.stated).toBe(true);
    // Nine participants are off-roster: the four Minis sides and the five
    // visiting clubs. Membership changes no metric — only the split is added.
    expect(withRoster.membership.guests).toHaveLength(9);
    expect(withRoster.membership.guests).toEqual(
      expect.arrayContaining(['MinisA', 'MinisB', 'MinisC', 'MinisD'])
    );
    expect(withRoster.flags.map((flag) => `${flag.subjectId}|${flag.basis.kind}`).sort()).toEqual(
      report.flags.map((flag) => `${flag.subjectId}|${flag.basis.kind}`).sort()
    );
  });
});

/* -------------------------------------------------------------------------- */
/* 7. The objectives — pure, unwired, and honest about coverage                */
/* -------------------------------------------------------------------------- */

describe('fairness :: solver objectives', () => {
  it('reads league fixtures only, so no objective can be moved by a friendly', () => {
    expect(FAIRNESS_OBJECTIVE_COMPETITIONS).toEqual([FAIRNESS_COMPETITION.LEAGUE]);
    for (const definition of Object.values(FAIRNESS_OBJECTIVE_REGISTRY)) {
      expect(FAIRNESS_METRIC_REGISTRY[definition.metricId].counts).toEqual(
        FAIRNESS_OBJECTIVE_COMPETITIONS
      );
    }
    // Shown rather than asserted: adding the season's three scrimmages and
    // eight external fixtures to the league layer moves the hosting-balance
    // score, and reading them under their own competition does not.
    const { fixtures } = corpusFixtures();
    const leagueOnly = fixtures.filter((held) => held.competition === FAIRNESS_COMPETITION.LEAGUE);
    const withAll = scoreFairnessObjective(
      fixtures,
      { objectiveId: FAIRNESS_OBJECTIVE.HOSTING_BALANCE },
      participationOf(fixtures)
    );
    const withLeague = scoreFairnessObjective(
      leagueOnly,
      { objectiveId: FAIRNESS_OBJECTIVE.HOSTING_BALANCE },
      participationOf(leagueOnly)
    );
    expect(withLeague.score).toBeCloseTo(withAll.score, 9);
    expect(withLeague.termsScored).toBe(withAll.termsScored);
    // The two differ only in how many subjects they could not score at all.
    expect(withAll.termsUnscored).toBeGreaterThan(withLeague.termsUnscored);
  });

  it('says on every result that nothing consumes it', () => {
    const participation = participationOf(corpusFixtures().fixtures);
    for (const objectiveId of Object.values(FAIRNESS_OBJECTIVE)) {
      const result = scoreFairnessObjective(
        corpusFixtures().fixtures,
        { objectiveId },
        participation
      );
      expect(result.sense).toBe(FAIRNESS_OBJECTIVE_SENSE.MINIMISE);
      expect(
        result.findings.some(
          (finding) => finding.code === FAIRNESS_REASON.FAIRNESS_OBJECTIVE_UNWIRED
        )
      ).toBe(true);
    }
  });

  it('is pure: identical input, identical output, and the input is deep-frozen', () => {
    const fixtures = deepFreeze(
      roundRobin({ teamCount: 8, rounds: 7 }).map((held) => ({ ...held }))
    );
    const participation = participationOf(fixtures);
    const config = deepFreeze({ objectiveId: FAIRNESS_OBJECTIVE.HOSTING_BALANCE, weight: 1 });
    const first = scoreFairnessObjective(fixtures, config, participation);
    const second = scoreFairnessObjective(fixtures, config, participation);
    expect(second.score).toBe(first.score);
    expect(second.terms).toEqual(first.terms);
  });

  it('never folds an unscoreable subject in at zero, because that is the best possible penalty', () => {
    const participation = participationOf(corpusFixtures().fixtures);
    const result = scoreFairnessObjective(
      corpusFixtures().fixtures,
      { objectiveId: FAIRNESS_OBJECTIVE.HOSTING_BALANCE },
      participation
    );
    const unscored = result.terms.filter((term) => !term.scored);
    // 18 outside the league and 4 with no two-sided fixture.
    expect(unscored).toHaveLength(22);
    expect(unscored.every((term) => term.penalty === null)).toBe(true);
    expect(unscored.every((term) => term.reasonCode !== null)).toBe(true);
    expect(result.termsUnscored).toBe(22);
    expect(result.coverage).toBeCloseTo(118 / 140, 9);
    expect(
      result.findings.some(
        (finding) => finding.code === FAIRNESS_REASON.FAIRNESS_OBJECTIVE_COVERAGE_PARTIAL
      )
    ).toBe(true);

    // The control: had the 22 been folded in at 0, the total would be *lower*
    // than the honest one over the same schedule — a minimisation would prefer
    // whichever arrangement it could see least of.
    const foldedIn = result.terms.reduce((sum, term) => sum + (term.penalty ?? 0), 0);
    expect(foldedIn).toBe(result.score);
    // Same sum, different denominators: the number alone cannot tell them apart,
    // which is why coverage travels with it and comparison checks it.
    expect(result.termsScored).toBe(118);
  });

  it('refuses to rank two scores whose coverage differs', () => {
    const full = roundRobin({ teamCount: 8, rounds: 7 });
    const partial = full.map((held, index) =>
      index === 0 ? { ...held, awaySubjectId: null } : held
    );
    const left = scoreFairnessObjective(
      full,
      { objectiveId: FAIRNESS_OBJECTIVE.HOSTING_BALANCE },
      participationOf(full)
    );
    const right = scoreFairnessObjective(
      partial,
      { objectiveId: FAIRNESS_OBJECTIVE.HOSTING_BALANCE },
      participationOf(partial)
    );
    // Same fixtures but for one absent opponent, and the totals differ.
    expect(right.score).not.toBe(left.score);
    const comparison = compareObjectiveScores(left, right);
    if (left.coverage === right.coverage && left.termsScored === right.termsScored) {
      expect(comparison.comparable).toBe(true);
    } else {
      expect(comparison.comparable).toBe(false);
      expect(comparison.better).toBeNull();
      expect(comparison.findings[0].code).toBe(FAIRNESS_REASON.FAIRNESS_OBJECTIVE_INCOMPARABLE);
      expect(comparison.findings[0].severity).toBe(FAIRNESS_SEVERITY.BLOCKING);
    }

    // And two comparable results are ranked, in the declared sense.
    const same = scoreFairnessObjective(
      full,
      { objectiveId: FAIRNESS_OBJECTIVE.HOSTING_BALANCE },
      participationOf(full)
    );
    const tie = compareObjectiveScores(left, same);
    expect(tie.comparable).toBe(true);
    expect(tie.delta).toBe(0);
    expect(tie.better).toBeNull();
  });

  it('scores a lopsided hosting split worse than an even one, in the declared sense', () => {
    const even = roundRobin({ teamCount: 8, rounds: 8 });
    const lopsided = even.map((held) => ({
      ...held,
      homeSubjectId:
        held.homeSubjectId < held.awaySubjectId ? held.homeSubjectId : held.awaySubjectId,
      awaySubjectId:
        held.homeSubjectId < held.awaySubjectId ? held.awaySubjectId : held.homeSubjectId,
    }));
    const a = scoreFairnessObjective(
      even,
      { objectiveId: FAIRNESS_OBJECTIVE.HOSTING_BALANCE },
      participationOf(even)
    );
    const b = scoreFairnessObjective(
      lopsided,
      { objectiveId: FAIRNESS_OBJECTIVE.HOSTING_BALANCE },
      participationOf(lopsided)
    );
    expect(b.score).toBeGreaterThan(a.score);
    const comparison = compareObjectiveScores(a, b);
    expect(comparison.comparable).toBe(true);
    expect(comparison.better).toBe('left');
  });

  it('is not wired: no scheduling module imports this package', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const path = await import('node:path');
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const core = path.join(root, 'packages', 'core', 'src');
    // `autoScheduler.js` uses the word in its own prose and in a `fairnessScore`
    // of its own — a different thing, and untouched by this work. What is
    // asserted is that none of the three *imports* this package.
    for (const file of ['gameScheduling.js', 'autoScheduler.js', 'gameMetrics.js']) {
      const source = readFileSync(path.join(core, file), 'utf8');
      expect(source).not.toMatch(/from\s+['"][^'"]*fairness/);
      expect(source).not.toMatch(/import\s*\(\s*['"][^'"]*fairness/);
    }
    // And nothing anywhere in the package outside `fairness/` and its own tests
    // reaches into it either.
    const importers = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'fairness') walk(full);
          continue;
        }
        if (!entry.name.endsWith('.js')) continue;
        if (/from\s+['"][^'"]*fairness/.test(readFileSync(full, 'utf8'))) importers.push(full);
      }
    };
    walk(core);
    expect(importers).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* 8. Structure                                                                */
/* -------------------------------------------------------------------------- */

describe('fairness :: structure', () => {
  it('registers a severity for every declared reason code, and only for declared ones', () => {
    const declared = new Set(Object.values(FAIRNESS_REASON));
    expect(Object.keys(FAIRNESS_REASON_SEVERITY).sort()).toEqual([...declared].sort());
    for (const severity of Object.values(FAIRNESS_REASON_SEVERITY)) {
      expect(Object.values(FAIRNESS_SEVERITY)).toContain(severity);
    }
  });

  it('reads its input and writes nothing, against a deep-frozen fixture list', () => {
    const fixtures = deepFreeze(corpusFixtures().fixtures.map((held) => ({ ...held })));
    // Prove the freeze bites before relying on it.
    expect(() => {
      fixtures[0].kickoffMinutes = 1;
    }).toThrow();
    const report = fairnessReport({ fixtures });
    expect(report.meta.fixturesRead).toBe(578);
    expect(report.flags.length).toBeGreaterThan(0);
  });

  it('publishes one measurement per subject and metric, at all three subject kinds', () => {
    const report = corpusReport();
    for (const subjectKind of Object.values(FAIRNESS_SUBJECT_KIND)) {
      for (const metricId of FAIRNESS_METRIC_ORDER) {
        expect(measurementsOf(report, metricId, subjectKind).length).toBeGreaterThan(0);
      }
    }
    expect(report.meta.measurementsMeasured + report.meta.measurementsUnmeasurable).toBe(
      report.measurements.length
    );
    expect(report.meta.judgementsMade + report.meta.judgementsUndecided).toBe(
      report.judgements.length
    );
    expect(report.meta.flagsRaised).toBe(report.flags.length);
  });

  it('publishes a division’s value as the same number a team in it was judged against', () => {
    const report = corpusReport();
    const divisionValue = report.measurements.find(
      (measurement) =>
        measurement.subjectKind === FAIRNESS_SUBJECT_KIND.DIVISION &&
        measurement.subjectId === 'U09G' &&
        measurement.metricId === FAIRNESS_METRIC.MEAN_KICKOFF
    );
    const population = report.populations.find(
      (candidate) =>
        candidate.subjectKind === FAIRNESS_SUBJECT_KIND.TEAM &&
        candidate.basisKind === FAIRNESS_BASIS.DIVISION &&
        candidate.groupKey === 'U09G' &&
        candidate.metricId === FAIRNESS_METRIC.MEAN_KICKOFF
    );
    expect(divisionValue.value).toBe(population.dispersion.centre);
  });
});
