/**
 * **Fairness objectives as pure scoring functions. Nothing consumes them.**
 *
 * ## Stated plainly, because the alternative is a claim this module cannot back
 *
 * These three functions are **not wired into any solver.** `gameScheduling.js`,
 * `autoScheduler.js` and `resolve/`'s stage pipeline do not import this file,
 * are not modified by this work, and do not know it exists. Every
 * {@link FairnessObjectiveResult} carries a `FAIRNESS_OBJECTIVE_UNWIRED` finding
 * saying so, so a reader who encounters one in isolation cannot mistake it for
 * something the schedule was actually optimised against.
 *
 * What they are is the shape a solver *could* consume: pure, deterministic,
 * side-effect free, dependent on nothing but the fixture list and a config, and
 * returning a decomposition rather than only a number.
 *
 * ## The one thing that makes them safe to consume, and why it is not optional
 *
 * **An unscoreable subject contributes nothing and is counted, rather than
 * scoring zero.**
 *
 * This is not a tidiness point. Every objective here is a *penalty* the solver
 * would minimise. A subject folded in at zero is a subject with a **perfect**
 * score, so a schedule that made more subjects unmeasurable would score better
 * than one that did not, and the optimiser would learn to prefer arrangements it
 * cannot see. Folding "unmeasurable" into a number does not merely lose
 * information here — in a minimisation it inverts the incentive.
 *
 * So `score` is the sum over scored terms only, `coverage` reports what fraction
 * of the intended subjects that was, and {@link compareObjectiveScores} refuses
 * to rank two results whose coverage or configuration differ, returning
 * `comparable: false` with a blocking `FAIRNESS_OBJECTIVE_INCOMPARABLE` rather
 * than a number. Two scores over different populations are two different
 * quantities with the same name.
 *
 * **And the same rule at the level of the whole score.** A term that could not
 * be scored carries `penalty: null`; a *result* in which nothing at all could be
 * scored carries `score: null`, with a blocking
 * `FAIRNESS_OBJECTIVE_UNSCORED`. The rule was stated for one term and not for
 * the sum, so a season this module could not read — an unclassifiable row, a
 * repeated fixture id, a list of placeholders naming nobody — emptied `terms`,
 * left the `unscoredCount > 0` coverage guard unfired, and returned `score: 0`:
 * the best value a minimisation can hold, over a season it measured nothing of.
 * {@link compareObjectiveScores} refuses such a result rather than ranking it,
 * because two of them agree on every field it compares.
 *
 * ## The three
 *
 * | id | penalty | target |
 * |---|---|---|
 * | `hosting-balance` | \|hosting share − 0.5\| per team | an even split of two-sided fixtures |
 * | `game-count-parity` | \|games − cohort median\| per team | every team in a cohort plays the same number |
 * | `slot-rotation` | \|mean kickoff − cohort median\| per team, in hours | no team permanently in the early or late slot |
 *
 * Each is expressed against the **cohort median**, not against a constant,
 * because the constant would be a policy this module has no standing to set:
 * whether a nine-game season is right is the club's decision, and whether every
 * team in a division gets the same number of games is arithmetic.
 * `hosting-balance` is the exception and its constant is 0.5, which is not a
 * policy — it is what "even" means.
 *
 * @module fairness/objectives
 */

import {
  FAIRNESS_COMPETITION,
  classifyFairnessFixtures,
  participationOf,
} from './classification.js';
import { median } from './dispersion.js';
import {
  FAIRNESS_METRIC,
  FAIRNESS_METRIC_REGISTRY,
  FAIRNESS_SUBJECT_KIND,
  cohortKeysBySubject,
  groupKeyOf,
  measureSubject,
} from './metrics.js';
import { FAIRNESS_BASIS } from './outliers.js';
import {
  FAIRNESS_MEASURABILITY,
  FAIRNESS_QUESTION,
  FAIRNESS_REASON,
  assertFairnessFindings,
  deriveFairnessStatus,
  makeFairnessFinding,
} from './reasonCodes.js';
import { FairnessObjectiveConfigSchema } from './schemas.js';

/**
 * Which way is better. Stated once, on every result, so no consumer has to
 * remember — the sign convention failure `feasibility/` documents at length
 * begins with exactly this being implicit.
 *
 * @readonly
 * @enum {string}
 */
export const FAIRNESS_OBJECTIVE_SENSE = Object.freeze({
  /** Lower is better. Every objective in this module is one. */
  MINIMISE: 'minimise',
});

/**
 * The declared objectives.
 *
 * @readonly
 * @enum {string}
 */
export const FAIRNESS_OBJECTIVE = Object.freeze({
  HOSTING_BALANCE: 'hosting-balance',
  GAME_COUNT_PARITY: 'game-count-parity',
  SLOT_ROTATION: 'slot-rotation',
});

/**
 * Declared order, for deterministic rendering only.
 *
 * @type {ReadonlyArray<string>}
 */
export const FAIRNESS_OBJECTIVE_ORDER = Object.freeze([
  FAIRNESS_OBJECTIVE.HOSTING_BALANCE,
  FAIRNESS_OBJECTIVE.GAME_COUNT_PARITY,
  FAIRNESS_OBJECTIVE.SLOT_ROTATION,
]);

/**
 * Each objective's metric, its unit, and where its target comes from.
 *
 * `target: 'constant'` names a value that is not a policy choice;
 * `target: 'cohort-median'` derives it from the cohort, so the objective says
 * "these should match each other" rather than "these should equal a number this
 * module picked".
 *
 * @type {Readonly<Record<string, { metricId: string, unit: string, target: string, constant: number|null, divisor: number }>>}
 */
export const FAIRNESS_OBJECTIVE_REGISTRY = Object.freeze({
  [FAIRNESS_OBJECTIVE.HOSTING_BALANCE]: Object.freeze({
    metricId: FAIRNESS_METRIC.HOSTING_SHARE,
    unit: 'share of 1',
    target: 'constant',
    constant: 0.5,
    divisor: 1,
  }),
  [FAIRNESS_OBJECTIVE.GAME_COUNT_PARITY]: Object.freeze({
    metricId: FAIRNESS_METRIC.GAMES_PLAYED,
    unit: 'fixtures',
    target: 'cohort-median',
    constant: null,
    divisor: 1,
  }),
  [FAIRNESS_OBJECTIVE.SLOT_ROTATION]: Object.freeze({
    metricId: FAIRNESS_METRIC.MEAN_KICKOFF,
    unit: 'hours',
    target: 'cohort-median',
    constant: null,
    // Minutes are the metric's unit; hours are the objective's, so a 30-minute
    // deviation weighs 0.5 rather than 30 and cannot silently dominate a sum
    // alongside a share-of-1 term.
    divisor: 60,
  }),
});

/**
 * **Score one objective over a fixture list.**
 *
 * Pure: it reads the fixtures and the config and nothing else, allocates no
 * shared state, and returns a fresh object. Calling it twice with the same input
 * returns the same numbers.
 *
 * `fixtures` is the **authority**, and this is the second version of that
 * sentence. The first was only in the docstring: the function took a
 * `participation` map and never looked at `fixtures` at all, so
 * `scoreFairnessObjective(leagueOnlyList, config, participationOf(wholeSeason))`
 * scored the whole season, returned `coverage: 0.871` for a list whose real
 * coverage is 1, and said nothing about it. A parameter that reads as
 * load-bearing and is not is how the board waiver was lost, so the fixtures now
 * decide and the map is **optional corroboration**: supply one and it is checked
 * against the fixtures, subject by subject and fixture by fixture, and a
 * mismatch is refused rather than silently preferred.
 *
 * The fixture list is **classified** first, by the same
 * `classifyFairnessFixtures()` the report path runs, and its findings travel on
 * the result: a list this module cannot decide the meaning of scores nothing and
 * says so, rather than scoring whatever survived a silent filter. The cohort
 * keys come from `cohortKeysBySubject()`, the same helper the report uses, so a
 * subject is in one cohort and not two.
 *
 * @param {ReadonlyArray<import('./types.js').FairnessFixture>} fixtures
 * @param {unknown} config - parsed by `FairnessObjectiveConfigSchema`
 * @param {Map<string, import('./types.js').FairnessParticipation>|null} [supplied]
 *   an already-built participation map over the same fixtures; omit it and one
 *   is derived. Never a way to score a population the fixtures do not describe.
 * @returns {import('./types.js').FairnessObjectiveResult}
 */
export function scoreFairnessObjective(fixtures, config, supplied = null) {
  const parsed = FairnessObjectiveConfigSchema.parse(config);
  const definition = FAIRNESS_OBJECTIVE_REGISTRY[parsed.objectiveId];
  if (!definition) {
    throw new Error(
      `fairness: objective ${JSON.stringify(parsed.objectiveId)} is not a member of FAIRNESS_OBJECTIVE`
    );
  }
  const metric = FAIRNESS_METRIC_REGISTRY[definition.metricId];
  const observed = participationOf(fixtures);
  if (supplied !== null && supplied !== undefined) {
    assertParticipationMatches(observed, supplied, parsed.objectiveId);
  }
  // The same classification the report path runs, and the same consequence. It
  // used not to run here at all, so a list carrying one `competition:
  // 'tournament'` row came back `coverage: 1`, `status: 'allowed'`, no finding
  // and that row's opponent silently absent from the population — while
  // `fairnessReport()` refused the identical list with a blocking
  // FAIRNESS_FIXTURE_UNCLASSIFIED. Two entry points giving two answers about one
  // fixture list is the shape this module exists to prevent, and the objective
  // is the half a solver would consume.
  const classification = classifyFairnessFixtures(fixtures);
  const participation = classification.usable ? observed : new Map();

  /** @type {import('./types.js').FairnessFinding[]} */
  const findings = [
    makeFairnessFinding(
      FAIRNESS_REASON.FAIRNESS_OBJECTIVE_UNWIRED,
      `${parsed.objectiveId} is a scoring function only: nothing in this repository consumes it, no solver stage reads it, and no schedule in this corpus was produced under it`,
      { objectiveId: parsed.objectiveId, metricId: definition.metricId }
    ),
    ...classification.findings,
  ];

  // The cohort is drawn from the fixtures **this objective's metric counts**,
  // through the same helper `fairnessReport()` uses, so the two paths cannot
  // put one subject in two cohorts. Grouping on `entry.divisions` /
  // `entry.ageGroups` — every label a subject carries anywhere — is what made a
  // team with one friendly spelled `10B` against league rows spelled `U10B`
  // FAIRNESS_GROUP_AMBIGUOUS here and `U10B` in the report; through
  // `compareObjectiveScores()`'s coverage guard it also made two schedules
  // permanently incomparable on a scrimmage's spelling.
  const cohorts = cohortKeysBySubject(participation, metric.counts);

  /** @type {Map<string, import('./types.js').FairnessMeasurement>} */
  const measured = new Map();
  /** @type {Map<string, { key: string|null, reasonCode: string|null }>} */
  const groupOf = new Map();
  for (const subjectId of [...participation.keys()].sort()) {
    const entry = /** @type {import('./types.js').FairnessParticipation} */ (
      participation.get(subjectId)
    );
    measured.set(
      subjectId,
      measureSubject(metric, FAIRNESS_SUBJECT_KIND.TEAM, subjectId, entry.fixtures)
    );
    groupOf.set(
      subjectId,
      parsed.basisKind === FAIRNESS_BASIS.SEASON
        ? { key: FAIRNESS_BASIS.SEASON, reasonCode: null }
        : groupKeyOf(
            (parsed.basisKind === FAIRNESS_BASIS.AGE_GROUP
              ? cohorts.ageGroups.get(subjectId)
              : cohorts.divisions.get(subjectId)) ?? new Set()
          )
    );
  }

  /** @type {Map<string, number>} */
  const targetByGroup = new Map();
  if (definition.target === 'cohort-median') {
    /** @type {Map<string, number[]>} */
    const values = new Map();
    for (const [subjectId, measurement] of measured) {
      const groupKey = (groupOf.get(subjectId) ?? { key: null }).key;
      if (groupKey === null) continue;
      if (measurement.measurability !== FAIRNESS_MEASURABILITY.MEASURED) continue;
      if (!values.has(groupKey)) values.set(groupKey, []);
      /** @type {number[]} */ (values.get(groupKey)).push(
        /** @type {number} */ (measurement.value)
      );
    }
    for (const [groupKey, list] of values) {
      const centre = median(list);
      if (centre !== null) targetByGroup.set(groupKey, centre);
    }
  }

  /** @type {import('./types.js').FairnessObjectiveTerm[]} */
  const terms = [];
  let score = 0;
  let scoredCount = 0;

  for (const subjectId of [...measured.keys()].sort()) {
    const measurement = /** @type {import('./types.js').FairnessMeasurement} */ (
      measured.get(subjectId)
    );
    const group = groupOf.get(subjectId) ?? { key: null, reasonCode: null };
    const groupKey = group.key;
    const target =
      definition.target === 'constant'
        ? definition.constant
        : groupKey === null
          ? null
          : (targetByGroup.get(groupKey) ?? null);

    if (measurement.measurability !== FAIRNESS_MEASURABILITY.MEASURED || target === null) {
      terms.push({
        subjectKind: FAIRNESS_SUBJECT_KIND.TEAM,
        subjectId,
        groupKey,
        scored: false,
        value: measurement.value,
        target,
        // Null, never 0: this is a minimisation, and a zero penalty is the best
        // possible term. See the module note.
        penalty: null,
        // The measurement's own reason first, then the cohort's. Never a
        // default: a term that contributes nothing must say which question went
        // unanswered, or it is indistinguishable from a term that scored zero.
        reasonCode:
          measurement.reasonCode ??
          group.reasonCode ??
          FAIRNESS_REASON.FAIRNESS_POPULATION_TOO_SMALL,
      });
      continue;
    }

    const penalty =
      (Math.abs(/** @type {number} */ (measurement.value) - target) / definition.divisor) *
      parsed.weight;
    score += penalty;
    scoredCount += 1;
    terms.push({
      subjectKind: FAIRNESS_SUBJECT_KIND.TEAM,
      subjectId,
      groupKey,
      scored: true,
      value: measurement.value,
      target,
      penalty,
      reasonCode: null,
    });
  }

  const unscoredCount = terms.length - scoredCount;
  // **Nothing scored is not a score of zero**, and this is the same rule the
  // per-term `penalty: null` above states, applied to the total. A season this
  // module could not read — an unclassifiable row, a repeated fixture id, a
  // list of placeholders naming nobody — empties `participation`, which empties
  // `terms`, which leaves `unscoredCount` at zero so the coverage guard below
  // never fires: the objective returned `score: 0`, the **best possible value
  // of a minimisation**, with `coverage: 0`, and for a usable list of
  // placeholders it returned it at `status: 'allowed'` with no finding at all.
  // Two such results then compared as `{ comparable: true, better: null,
  // delta: 0 }`, a tie between two seasons neither of which was read.
  //
  // The guard is on `scoredCount`, not on `terms.length`: a list of six teams
  // whose every fixture names no opponent produces six terms and no score, and
  // is the same claim about the same nothing.
  const scoreOrNull = scoredCount === 0 ? null : score;
  if (scoredCount === 0) {
    findings.push(
      makeFairnessFinding(
        FAIRNESS_REASON.FAIRNESS_OBJECTIVE_UNSCORED,
        `${parsed.objectiveId} scored no subject at all over ${terms.length} considered, so it has no score; it is reported as null rather than as 0 because this objective is a ${FAIRNESS_OBJECTIVE_SENSE.MINIMISE} and 0 is its best possible value, which would rank a season nothing could be measured in above every season that could`,
        {
          objectiveId: parsed.objectiveId,
          metricId: definition.metricId,
          sense: FAIRNESS_OBJECTIVE_SENSE.MINIMISE,
          termsScored: scoredCount,
          termsConsidered: terms.length,
          subjectsObserved: participation.size,
        }
      )
    );
  }
  if (unscoredCount > 0) {
    findings.push(
      makeFairnessFinding(
        FAIRNESS_REASON.FAIRNESS_OBJECTIVE_COVERAGE_PARTIAL,
        `${unscoredCount} of ${terms.length} subject(s) could not be scored on ${parsed.objectiveId} and contribute nothing to the total; they are not folded in at zero, because in a minimisation a zero penalty is a perfect score and an optimiser would learn to prefer schedules it cannot measure`,
        {
          objectiveId: parsed.objectiveId,
          termsScored: scoredCount,
          termsUnscored: unscoredCount,
          coverage: terms.length === 0 ? 0 : scoredCount / terms.length,
        }
      )
    );
  }

  assertFairnessFindings(findings, `objective ${parsed.objectiveId}`);

  return {
    question: FAIRNESS_QUESTION.OBJECTIVE_SCORE,
    objectiveId: parsed.objectiveId,
    sense: FAIRNESS_OBJECTIVE_SENSE.MINIMISE,
    unit: definition.unit,
    weight: parsed.weight,
    basisKind: parsed.basisKind,
    score: scoreOrNull,
    termsScored: scoredCount,
    termsUnscored: unscoredCount,
    coverage: terms.length === 0 ? 0 : scoredCount / terms.length,
    status: deriveFairnessStatus(findings),
    terms,
    findings,
  };
}

/**
 * **Refuse a participation map these fixtures do not produce.**
 *
 * Compared subject by subject and, within a subject, fixture id by fixture id —
 * not by size, because two maps of 140 subjects over two different seasons are
 * the same size. A thrown `Error` rather than a finding, matching the refusal
 * {@link scoreFairnessObjective} already gives an unregistered `objectiveId`:
 * both are mistakes in the *call*, and neither is a property of a season that a
 * report could sensibly carry a reason code about.
 *
 * @param {Map<string, import('./types.js').FairnessParticipation>} observed
 * @param {Map<string, import('./types.js').FairnessParticipation>} supplied
 * @param {string} objectiveId
 * @returns {void}
 */
function assertParticipationMatches(observed, supplied, objectiveId) {
  /** @param {Map<string, import('./types.js').FairnessParticipation>} map */
  const shape = (map) =>
    [...map.keys()]
      .sort()
      .map((subjectId) => {
        const entry = map.get(subjectId);
        const held = entry === undefined ? [] : entry.fixtures;
        return `${subjectId}=${held
          .map((record) => record.fixture.fixtureId)
          .sort()
          .join(',')}`;
      })
      .join('|');
  if (shape(observed) === shape(supplied)) return;
  throw new Error(
    `fairness: the participation map supplied to ${JSON.stringify(objectiveId)} is not the one these fixtures produce (${observed.size} subject(s) observed, ${supplied.size} supplied); scoring the map instead of the fixtures is how a filtered fixture list is silently scored as a whole season`
  );
}

/**
 * **The number a result can be ranked on, or `null` if it holds none.**
 *
 * The one place that question is answered, and it is answered about the
 * quantity the ranking arithmetic actually reads. The guard in
 * {@link compareObjectiveScores} used to read `termsScored` and then cast
 * `score`'s null away, which is two quantities for one decision: a result with
 * `termsScored: 8` and no score — a JSON round trip writes any non-finite
 * number as `null` and drops an `undefined` key, and any future producer may
 * simply not set one — passed the guard, and `null < 0.5714` then declared the
 * side holding no number the better schedule, with a delta computed from a
 * null. The two states are refused together because they are one claim:
 *
 * - nothing was scored, so there is no number for a score to be; and
 * - no finite number is present, whatever the term counts say.
 *
 * A result claiming a score while claiming to have scored no subject is a
 * contradiction rather than a ranking, and the first test still refuses it.
 *
 * @param {import('./types.js').FairnessObjectiveResult} result
 * @returns {number|null}
 */
function rankableScoreOf(result) {
  if (result.termsScored === 0) return null;
  return Number.isFinite(result.score) ? result.score : null;
}

/**
 * **Compare two objective results, or refuse to.**
 *
 * A solver's whole use for a scalar is to decide whether one candidate is better
 * than another, and this is the one place that decision is made. It refuses
 * unless both results actually hold a score, and the two are the same
 * objective, the same weight, the same basis, and the same coverage — because a
 * smaller sum over fewer terms is not a better schedule, it is a shorter sum,
 * and nothing about the two numbers announces the difference.
 *
 * @param {import('./types.js').FairnessObjectiveResult} left
 * @param {import('./types.js').FairnessObjectiveResult} right
 * @returns {{ comparable: boolean, better: string|null, delta: number|null, findings: ReadonlyArray<import('./types.js').FairnessFinding> }}
 */
export function compareObjectiveScores(left, right) {
  // **A result that scored nothing has no score**, so there is nothing here to
  // rank — and this is checked first, before the mismatch fields, because when
  // both sides measured nothing they *agree* on every one of them. Two empty
  // results used to come back `{ comparable: true, better: null, delta: 0 }`:
  // identical objectiveId, weight, basis, `termsScored: 0` and `coverage: 0`,
  // two `score`s of 0, and a tie declared between two seasons neither of which
  // was read. `status` and `findings` say so loudly on both operands and this
  // function reads neither, which is why the refusal is stated on the one thing
  // it does read — and it is stated on the **number the comparison at the
  // bottom of this function performs its arithmetic with**, obtained here and
  // used there, so there is no second quantity standing in for it and no cast
  // between the test and the subtraction. See {@link rankableScoreOf}.
  const leftScore = rankableScoreOf(left);
  const rightScore = rankableScoreOf(right);
  /** @type {string[]} */
  const unscored = [];
  if (leftScore === null) unscored.push('left');
  if (rightScore === null) unscored.push('right');
  if (unscored.length > 0) {
    return {
      comparable: false,
      better: null,
      delta: null,
      findings: assertFairnessFindings([
        makeFairnessFinding(
          FAIRNESS_REASON.FAIRNESS_OBJECTIVE_INCOMPARABLE,
          `the ${unscored.join(' and ')} result(s) hold no score to rank — either no subject was scored, so there is no number for one to be, or no finite number is present; a ${FAIRNESS_OBJECTIVE_SENSE.MINIMISE} whose score is absent is not a schedule that scored zero, and ranking it would make the side nothing could be measured on the better schedule`,
          {
            unscored,
            left: {
              objectiveId: left.objectiveId,
              termsScored: left.termsScored,
              score: left.score,
            },
            right: {
              objectiveId: right.objectiveId,
              termsScored: right.termsScored,
              score: right.score,
            },
          }
        ),
      ]),
    };
  }

  /** @type {string[]} */
  const mismatches = [];
  if (left.objectiveId !== right.objectiveId) mismatches.push('objectiveId');
  if (left.weight !== right.weight) mismatches.push('weight');
  if (left.basisKind !== right.basisKind) mismatches.push('basisKind');
  if (left.termsScored !== right.termsScored) mismatches.push('termsScored');
  if (left.coverage !== right.coverage) mismatches.push('coverage');

  if (mismatches.length > 0) {
    return {
      comparable: false,
      better: null,
      delta: null,
      findings: assertFairnessFindings([
        makeFairnessFinding(
          FAIRNESS_REASON.FAIRNESS_OBJECTIVE_INCOMPARABLE,
          `these two results differ in ${mismatches.join(', ')}, so their scores are two different quantities wearing one name; the smaller of them is not the better schedule`,
          {
            mismatches,
            left: {
              objectiveId: left.objectiveId,
              termsScored: left.termsScored,
              coverage: left.coverage,
            },
            right: {
              objectiveId: right.objectiveId,
              termsScored: right.termsScored,
              coverage: right.coverage,
            },
          }
        ),
      ]),
    };
  }

  // `leftScore` and `rightScore` are the numbers the guard at the top of this
  // function tested — not `left.score` read a second time through a cast — so
  // the value the refusal was decided on is the value subtracted here, and
  // there is no arrangement of this function in which the two differ.
  return {
    comparable: true,
    // MINIMISE, stated on both results and read here rather than assumed.
    better: leftScore === rightScore ? null : leftScore < rightScore ? 'left' : 'right',
    delta: leftScore - rightScore,
    findings: [],
  };
}

/**
 * The competitions every declared objective reads. Re-exported for callers that
 * want to state, in their own tests, that an objective never sees a friendly.
 *
 * @type {ReadonlyArray<string>}
 */
export const FAIRNESS_OBJECTIVE_COMPETITIONS = Object.freeze([FAIRNESS_COMPETITION.LEAGUE]);
