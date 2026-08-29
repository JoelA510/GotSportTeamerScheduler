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

import { FAIRNESS_COMPETITION } from './classification.js';
import { median } from './dispersion.js';
import {
  FAIRNESS_METRIC,
  FAIRNESS_METRIC_REGISTRY,
  FAIRNESS_SUBJECT_KIND,
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
 * @param {ReadonlyArray<import('./types.js').FairnessFixture>} fixtures
 * @param {unknown} config - parsed by `FairnessObjectiveConfigSchema`
 * @param {Map<string, import('./types.js').FairnessParticipation>} participation
 * @returns {import('./types.js').FairnessObjectiveResult}
 */
export function scoreFairnessObjective(fixtures, config, participation) {
  const parsed = FairnessObjectiveConfigSchema.parse(config);
  const definition = FAIRNESS_OBJECTIVE_REGISTRY[parsed.objectiveId];
  if (!definition) {
    throw new Error(
      `fairness: objective ${JSON.stringify(parsed.objectiveId)} is not a member of FAIRNESS_OBJECTIVE`
    );
  }
  const metric = FAIRNESS_METRIC_REGISTRY[definition.metricId];

  /** @type {import('./types.js').FairnessFinding[]} */
  const findings = [
    makeFairnessFinding(
      FAIRNESS_REASON.FAIRNESS_OBJECTIVE_UNWIRED,
      `${parsed.objectiveId} is a scoring function only: nothing in this repository consumes it, no solver stage reads it, and no schedule in this corpus was produced under it`,
      { objectiveId: parsed.objectiveId, metricId: definition.metricId }
    ),
  ];

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
            parsed.basisKind === FAIRNESS_BASIS.AGE_GROUP ? entry.ageGroups : entry.divisions
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
    score,
    termsScored: scoredCount,
    termsUnscored: unscoredCount,
    coverage: terms.length === 0 ? 0 : scoredCount / terms.length,
    status: deriveFairnessStatus(findings),
    terms,
    findings,
  };
}

/**
 * **Compare two objective results, or refuse to.**
 *
 * A solver's whole use for a scalar is to decide whether one candidate is better
 * than another, and this is the one place that decision is made. It refuses
 * unless the two results are the same objective, the same weight, the same
 * basis, and the same coverage — because a smaller sum over fewer terms is not a
 * better schedule, it is a shorter sum, and nothing about the two numbers
 * announces the difference.
 *
 * @param {import('./types.js').FairnessObjectiveResult} left
 * @param {import('./types.js').FairnessObjectiveResult} right
 * @returns {{ comparable: boolean, better: string|null, delta: number|null, findings: ReadonlyArray<import('./types.js').FairnessFinding> }}
 */
export function compareObjectiveScores(left, right) {
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

  return {
    comparable: true,
    // MINIMISE, stated on both results and read here rather than assumed.
    better: left.score === right.score ? null : left.score < right.score ? 'left' : 'right',
    delta: left.score - right.score,
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
