/**
 * **The metrics, and the populations they are read against.**
 *
 * ## What a metric is here
 *
 * A frozen registry entry with an id, a unit, the set of
 * {@link FAIRNESS_COMPETITION} values it counts, and one pure function from a
 * subject's fixtures to a number **or a stated refusal**. Nothing in this file
 * decides whether a value is good; it decides what the value is and whether it
 * could be obtained at all.
 *
 * Four are declared, and the reason for each is a question a club committee
 * actually asks:
 *
 * | id | question | unit |
 * |---|---|---|
 * | `games-played` | *"does every team get the same number of games?"* | fixtures |
 * | `hosting-share` | *"does every team host its share?"* | share of 1 |
 * | `mean-kickoff` | *"is one team always in the 8:30 slot?"* | minutes past midnight |
 * | `venue-spread` | *"is one team always the one that travels?"* | distinct venues |
 *
 * ## The three subject kinds, and what each is actually measured on
 *
 * The build plan asks for per-team, per-division and per-age-group metrics, and
 * the three are **not** three parallel computations:
 *
 * - A **team** is measured directly from its own fixtures.
 * - A **division** and an **age group** are measured as the *summary of their
 *   member teams' values* — the median of them, which is precisely the centre of
 *   the population those teams were judged against. Deliberate: it means every
 *   group figure the report publishes is the same number that decided a team's
 *   judgement, rather than a second aggregate computed a second way that is free
 *   to disagree with the first. A division's `mean-kickoff` of 731.67 is both
 *   "this division's typical kickoff" and "the centre `09G7v706` was 25 minutes
 *   away from", and there is no arrangement of the code in which those two
 *   differ.
 *
 * Summing a group's fixtures instead was considered and rejected: a division's
 * total game count is a function of how many teams are in it, so comparing two
 * divisions on it measures enrolment and calls the answer fairness.
 *
 * ## Three-valued, at the level of a single subject
 *
 * Every measurement is `measured` with a number or `unmeasurable` with a reason,
 * and {@link assertFairnessMeasurement} refuses any other arrangement. The
 * corpus exercises three distinct unmeasurable reasons without a line of
 * constructed input:
 *
 * - `FAIRNESS_SUBJECT_OUTSIDE_CLASS` — 18 participants hold no league fixture,
 *   so no league metric has anything to read for them. They are *reported*, not
 *   omitted and not scored zero, which is the difference between "these teams
 *   are outside this comparison" and "these teams got no games".
 * - `FAIRNESS_DENOMINATOR_EMPTY` — the four Minis sides have nine league
 *   fixtures each and **no two-sided one among them**, so hosting share has a
 *   denominator of zero. This is the trap the whole module is built around: as a
 *   number their hosting share is 9/9 = 1.0, the most extreme value in the
 *   season, and it is an artifact of a fixture format that writes the absent
 *   opponent as `-`.
 * - `FAIRNESS_GROUP_UNLABELLED` / `FAIRNESS_GROUP_AMBIGUOUS` — a subject with no
 *   key, or two keys, for a grouping is judged under no cohort for it rather
 *   than assigned to one.
 *
 * @module fairness/metrics
 */

import { FAIRNESS_COMPETITION, FAIRNESS_SIDE, isTwoSided } from './classification.js';
import { median } from './dispersion.js';
import {
  FAIRNESS_MEASURABILITY,
  FAIRNESS_REASON,
  assertFairnessMeasurement,
} from './reasonCodes.js';

/**
 * The kinds of thing a measurement can be about.
 *
 * @readonly
 * @enum {string}
 */
export const FAIRNESS_SUBJECT_KIND = Object.freeze({
  TEAM: 'team',
  DIVISION: 'division',
  AGE_GROUP: 'age-group',
});

/**
 * The declared metrics.
 *
 * @readonly
 * @enum {string}
 */
export const FAIRNESS_METRIC = Object.freeze({
  GAMES_PLAYED: 'games-played',
  HOSTING_SHARE: 'hosting-share',
  MEAN_KICKOFF: 'mean-kickoff',
  VENUE_SPREAD: 'venue-spread',
});

/**
 * Declared order, for deterministic rendering only.
 *
 * @type {ReadonlyArray<string>}
 */
export const FAIRNESS_METRIC_ORDER = Object.freeze([
  FAIRNESS_METRIC.GAMES_PLAYED,
  FAIRNESS_METRIC.HOSTING_SHARE,
  FAIRNESS_METRIC.MEAN_KICKOFF,
  FAIRNESS_METRIC.VENUE_SPREAD,
]);

/**
 * The unit of every metric, stated once. There is no unitless metric.
 *
 * `mean-kickoff` is **minutes past local midnight** and never a `Date`: the
 * corpus is wall-clock only, two of its dates fall after DST ends, and GAP-30
 * forbids turning either into an absolute instant. Averaging `Date` objects
 * across a DST boundary is how a schedule acquires a phantom hour.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const FAIRNESS_METRIC_UNIT = Object.freeze({
  [FAIRNESS_METRIC.GAMES_PLAYED]: 'fixtures',
  [FAIRNESS_METRIC.HOSTING_SHARE]: 'share of 1',
  [FAIRNESS_METRIC.MEAN_KICKOFF]: 'minutes past midnight',
  [FAIRNESS_METRIC.VENUE_SPREAD]: 'distinct venues',
});

/** Every metric in this module counts league fixtures and only league fixtures. */
const LEAGUE_ONLY = Object.freeze([FAIRNESS_COMPETITION.LEAGUE]);

/**
 * One evidence record per measurement: what was read, what was set aside, why.
 *
 * **Every entry in `exclusions` is a count of fixtures**, and `fixturesExcluded`
 * is their sum. That is the whole contract, and it is written down because it
 * was broken: {@link measureGroup} used to fold *"four member teams were
 * unmeasurable"* into the same total as *"thirty-six fixtures named no
 * opponent"*, and published `fixturesExcluded: 40` about a division of 36
 * fixtures. Evidence a reader can check by hand is the point of this module, and
 * a count larger than the population it is drawn from destroys that. Anything
 * denominated in something other than fixtures belongs in a field of its own —
 * see `membersCounted` / `membersExcluded`.
 *
 * @param {number} counted
 * @param {ReadonlyArray<[string, number]>} exclusions - fixture counts, only
 * @returns {import('./types.js').FairnessEvidence}
 */
function evidence(counted, exclusions = []) {
  return Object.freeze({
    fixturesCounted: counted,
    fixturesExcluded: exclusions.reduce((total, [, count]) => total + count, 0),
    exclusions: Object.freeze(
      /** @type {Array<[string, number]>} */ (exclusions).filter(([, count]) => count > 0)
    ),
  });
}

/**
 * **The frozen metric registry.**
 *
 * Each `measure` takes the subject's counted fixtures — `{ fixture, side }`
 * records, already filtered to the metric's competitions — and returns either a
 * value or a reason code, never both and never neither.
 *
 * @type {Readonly<Record<string, import('./types.js').FairnessMetricDefinition>>}
 */
export const FAIRNESS_METRIC_REGISTRY = Object.freeze({
  [FAIRNESS_METRIC.GAMES_PLAYED]: Object.freeze({
    id: FAIRNESS_METRIC.GAMES_PLAYED,
    unit: FAIRNESS_METRIC_UNIT[FAIRNESS_METRIC.GAMES_PLAYED],
    label: 'league fixtures played',
    counts: LEAGUE_ONLY,
    measure(entries) {
      return { value: entries.length, reasonCode: null, evidence: evidence(entries.length) };
    },
  }),

  [FAIRNESS_METRIC.HOSTING_SHARE]: Object.freeze({
    id: FAIRNESS_METRIC.HOSTING_SHARE,
    unit: FAIRNESS_METRIC_UNIT[FAIRNESS_METRIC.HOSTING_SHARE],
    label: 'share of two-sided league fixtures hosted',
    counts: LEAGUE_ONLY,
    measure(entries) {
      const twoSided = entries.filter((entry) => isTwoSided(entry.fixture));
      const oneSided = entries.length - twoSided.length;
      if (twoSided.length === 0) {
        return {
          value: null,
          reasonCode: FAIRNESS_REASON.FAIRNESS_DENOMINATOR_EMPTY,
          evidence: evidence(0, [['fixture-names-no-opponent', oneSided]]),
        };
      }
      const hosted = twoSided.filter((entry) => entry.side === FAIRNESS_SIDE.HOME).length;
      return {
        value: hosted / twoSided.length,
        reasonCode: null,
        evidence: evidence(twoSided.length, [['fixture-names-no-opponent', oneSided]]),
      };
    },
  }),

  [FAIRNESS_METRIC.MEAN_KICKOFF]: Object.freeze({
    id: FAIRNESS_METRIC.MEAN_KICKOFF,
    unit: FAIRNESS_METRIC_UNIT[FAIRNESS_METRIC.MEAN_KICKOFF],
    label: 'mean kickoff across league fixtures',
    counts: LEAGUE_ONLY,
    measure(entries) {
      const timed = entries.filter((entry) => Number.isFinite(entry.fixture.kickoffMinutes));
      const untimed = entries.length - timed.length;
      if (timed.length === 0) {
        return {
          value: null,
          reasonCode: FAIRNESS_REASON.FAIRNESS_VALUE_UNAVAILABLE,
          evidence: evidence(0, [['fixture-has-no-kickoff', untimed]]),
        };
      }
      const total = timed.reduce((sum, entry) => sum + entry.fixture.kickoffMinutes, 0);
      return {
        value: total / timed.length,
        reasonCode: null,
        evidence: evidence(timed.length, [['fixture-has-no-kickoff', untimed]]),
      };
    },
  }),

  [FAIRNESS_METRIC.VENUE_SPREAD]: Object.freeze({
    id: FAIRNESS_METRIC.VENUE_SPREAD,
    unit: FAIRNESS_METRIC_UNIT[FAIRNESS_METRIC.VENUE_SPREAD],
    label: 'distinct venues visited across league fixtures',
    counts: LEAGUE_ONLY,
    measure(entries) {
      const located = entries.filter((entry) => entry.fixture.venueId !== null);
      const unlocated = entries.length - located.length;
      if (located.length === 0) {
        return {
          value: null,
          reasonCode: FAIRNESS_REASON.FAIRNESS_VALUE_UNAVAILABLE,
          evidence: evidence(0, [['fixture-has-no-venue', unlocated]]),
        };
      }
      const venues = new Set(located.map((entry) => entry.fixture.venueId));
      return {
        value: venues.size,
        reasonCode: null,
        evidence: evidence(located.length, [['fixture-has-no-venue', unlocated]]),
      };
    },
  }),
});

/**
 * **The metric a caller named, or a refusal naming what it is not.**
 *
 * Adopted from `scoreFairnessObjective()`'s treatment of an unregistered
 * `objectiveId` rather than invented a second time: a metric id nobody declared
 * is a mistake in the *call*, not a property of the season, and the answer to it
 * is the same answer that module already gives. It is emphatically not a silent
 * filter — `metricIds: ['mean-kickof']` used to select nothing, run nothing, and
 * come back `rejected` with `FAIRNESS_NOTHING_JUDGED`, which tells an operator
 * their data is unjudgeable when what happened is that they misspelled an
 * argument.
 *
 * @param {string} metricId
 * @returns {import('./types.js').FairnessMetricDefinition}
 */
export function fairnessMetricOf(metricId) {
  const metric = FAIRNESS_METRIC_REGISTRY[metricId];
  if (!metric) {
    throw new Error(
      `fairness: metric ${JSON.stringify(metricId)} is not a member of FAIRNESS_METRIC; the declared metrics are ${FAIRNESS_METRIC_ORDER.map((id) => JSON.stringify(id)).join(', ')}`
    );
  }
  return metric;
}

/**
 * Build one measurement, through the guard that keeps the two-state
 * measurability honest.
 *
 * @param {import('./types.js').FairnessMetricDefinition} metric
 * @param {string} subjectKind - a {@link FAIRNESS_SUBJECT_KIND} value
 * @param {string} subjectId
 * @param {ReadonlyArray<{ fixture: import('./types.js').FairnessFixture, side: string }>} allEntries
 * @returns {import('./types.js').FairnessMeasurement}
 */
export function measureSubject(metric, subjectKind, subjectId, allEntries) {
  const counted = allEntries.filter((entry) => metric.counts.includes(entry.fixture.competition));
  const setAside = allEntries.length - counted.length;

  if (counted.length === 0) {
    return assertFairnessMeasurement({
      metricId: metric.id,
      unit: metric.unit,
      subjectKind,
      subjectId,
      measurability: FAIRNESS_MEASURABILITY.UNMEASURABLE,
      value: null,
      reasonCode: FAIRNESS_REASON.FAIRNESS_SUBJECT_OUTSIDE_CLASS,
      evidence: evidence(0, [['fixture-of-another-competition', setAside]]),
    });
  }

  const result = metric.measure(counted);
  return assertFairnessMeasurement({
    metricId: metric.id,
    unit: metric.unit,
    subjectKind,
    subjectId,
    measurability:
      result.value === null ? FAIRNESS_MEASURABILITY.UNMEASURABLE : FAIRNESS_MEASURABILITY.MEASURED,
    value: result.value,
    reasonCode: result.reasonCode,
    evidence: {
      ...result.evidence,
      fixturesExcluded: result.evidence.fixturesExcluded + setAside,
      exclusions: Object.freeze(
        /** @type {Array<[string, number]>} */ ([
          ...result.evidence.exclusions,
          ['fixture-of-another-competition', setAside],
        ]).filter(([, count]) => count > 0)
      ),
    },
  });
}

/**
 * Measure every team subject on the requested metrics.
 *
 * `metricIds` defaults to every declared metric and is **read**, not decorative:
 * a report restricted to one metric must publish measurements about one metric.
 * It used to measure all four whatever it was asked for, which put 588
 * measurements and findings about three unrequested metrics into a report that
 * asked for one — a filter that silently does nothing being worse than no
 * filter, because the caller cannot tell it did nothing.
 *
 * @param {Map<string, import('./types.js').FairnessParticipation>} participation
 * @param {ReadonlyArray<string>} [metricIds] - {@link FAIRNESS_METRIC} values
 * @returns {import('./types.js').FairnessMeasurement[]}
 */
export function measureTeams(participation, metricIds = FAIRNESS_METRIC_ORDER) {
  const metrics = metricIds.map((metricId) => fairnessMetricOf(metricId));
  /** @type {import('./types.js').FairnessMeasurement[]} */
  const measurements = [];
  for (const subjectId of [...participation.keys()].sort()) {
    const entry = /** @type {import('./types.js').FairnessParticipation} */ (
      participation.get(subjectId)
    );
    for (const metric of metrics) {
      measurements.push(
        measureSubject(metric, FAIRNESS_SUBJECT_KIND.TEAM, subjectId, entry.fixtures)
      );
    }
  }
  return measurements;
}

/**
 * The group key a subject holds for a grouping, or a stated refusal.
 *
 * Three answers, never two. `null` with `FAIRNESS_GROUP_UNLABELLED` is a subject
 * the corpus gives no key for — the four Minis sides play in division `BB`,
 * which parses to no age group at all — and `null` with
 * `FAIRNESS_GROUP_AMBIGUOUS` is a subject with two (GAP-24). Neither is assigned
 * to a cohort by picking one, which is what `buildTeams()` already refuses to do
 * for the same subject.
 *
 * The keys handed in here are the ones the metric's **own competitions** supply
 * — see `report.js`. That changes which of the two refusals season-2026
 * exercises: `16GSelect02` is listed as `16GS` on one row and `U16G` on another,
 * but both rows are scrimmages and it holds no league fixture, so under a league
 * metric it is *unlabelled* rather than ambiguous. Two spellings on two
 * friendlies are not a reason to refuse a team its league division, and this
 * corpus holds no subject with two league labels; the ambiguous branch is driven
 * from constructed league input in `tests/reasonCodeReachability.test.js`.
 *
 * @param {ReadonlySet<string>} keys
 * @returns {{ key: string|null, reasonCode: string|null }}
 */
export function groupKeyOf(keys) {
  if (keys.size === 1) return { key: [...keys][0], reasonCode: null };
  if (keys.size === 0) {
    return { key: null, reasonCode: FAIRNESS_REASON.FAIRNESS_GROUP_UNLABELLED };
  }
  return { key: null, reasonCode: FAIRNESS_REASON.FAIRNESS_GROUP_AMBIGUOUS };
}

/**
 * **Measure a division or an age group: the median of its teams' values.**
 *
 * See the module note — this is deliberately the same number the group's own
 * population supplies as its centre, so the figure the report publishes about a
 * division and the figure a team was judged against cannot drift apart.
 *
 * A group whose member teams are all unmeasurable on a metric is itself
 * unmeasurable on it, and says so: division `BB` has four teams and no hosting
 * share, because none of its thirty-six fixtures names an opponent.
 *
 * @param {string} subjectKind - {@link FAIRNESS_SUBJECT_KIND} DIVISION or AGE_GROUP
 * @param {string} groupKey
 * @param {string} metricId
 * @param {ReadonlyArray<import('./types.js').FairnessMeasurement>} memberMeasurements
 * @returns {import('./types.js').FairnessMeasurement}
 */
export function measureGroup(subjectKind, groupKey, metricId, memberMeasurements) {
  const metric = fairnessMetricOf(metricId);
  const usable = memberMeasurements.filter(
    (measurement) => measurement.measurability === FAIRNESS_MEASURABILITY.MEASURED
  );
  // The median, not `describeDispersion()`'s centre: a group's own value is
  // well defined for any non-empty membership, and the four-member floor in
  // `dispersion.js` governs whether a *deviation* can be scored, which is a
  // different question. Conflating them would leave a three-team division with
  // no published typical kickoff at all.
  const centre = median(usable.map((measurement) => /** @type {number} */ (measurement.value)));
  // Both totals are summed over **every** member, so a group's fixture
  // accounting is exactly the sum of its members' and a reader can add the rows
  // up. (An unmeasurable member always counts zero fixtures, so this is the same
  // arithmetic as summing `counted` over the measurable ones — it is written
  // this way so the identity is one a test can assert rather than one that
  // happens to hold.)
  const counted = memberMeasurements.reduce(
    (total, measurement) => total + measurement.evidence.fixturesCounted,
    0
  );
  const excluded = memberMeasurements.reduce(
    (total, measurement) => total + measurement.evidence.fixturesExcluded,
    0
  );
  return assertFairnessMeasurement({
    metricId,
    unit: metric.unit,
    subjectKind,
    subjectId: groupKey,
    measurability:
      centre === null ? FAIRNESS_MEASURABILITY.UNMEASURABLE : FAIRNESS_MEASURABILITY.MEASURED,
    value: centre,
    reasonCode: centre === null ? unanimousReasonOf(memberMeasurements) : null,
    evidence: {
      // Fixtures, and only fixtures, in the fixture fields — the member tally
      // is real evidence and is published under its own name rather than added
      // to a count of rows it is not denominated in. See `evidence()`.
      ...evidence(counted, [['fixture-not-counted-by-metric', excluded]]),
      membersCounted: usable.length,
      membersExcluded: memberMeasurements.length - usable.length,
    },
  });
}

/**
 * The reason an unmeasurable group carries: its members', when they agree.
 *
 * A division whose every team is `FAIRNESS_SUBJECT_OUTSIDE_CLASS` is outside the
 * class itself, and saying `FAIRNESS_DENOMINATOR_EMPTY` about it would be true
 * of the arithmetic and wrong about the cause — `Select` has no league median
 * because none of its teams plays a league fixture, not because a denominator
 * happened to be zero. Where the members disagree, or where there are none, the
 * honest answer is the arithmetic one.
 *
 * @param {ReadonlyArray<import('./types.js').FairnessMeasurement>} memberMeasurements
 * @returns {string}
 */
export function unanimousReasonOf(memberMeasurements) {
  const reasons = new Set(
    memberMeasurements.map((measurement) => measurement.reasonCode).filter((code) => code !== null)
  );
  return reasons.size === 1
    ? /** @type {string} */ ([...reasons][0])
    : FAIRNESS_REASON.FAIRNESS_DENOMINATOR_EMPTY;
}
