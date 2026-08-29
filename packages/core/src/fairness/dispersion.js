/**
 * **What "outlier" means here, and why it means that.**
 *
 * ## The choice
 *
 * A subject is an outlier when its **modified z-score** — Iglewicz and
 * Hoaglin's `0.6745 * (value - median) / MAD`, where MAD is the median absolute
 * deviation of the population from its own median — exceeds
 * {@link OUTLIER_SCORE_THRESHOLD} in absolute value.
 *
 * Three reasons, in order of how much they mattered:
 *
 * 1. **It survives the populations this domain actually produces.** A division
 *    in the season-2026 corpus has between four and fourteen teams. A mean and a
 *    standard deviation over six values are dominated by the very member the
 *    test is about: one team scheduled far from its peers inflates the scale it
 *    is being judged against, and the classic result is that a single extreme
 *    outlier hides itself. The median and the MAD do not move for it.
 * 2. **Both of its parameters are things an administrator can read.** The centre
 *    is a value some team actually holds and the scale is a typical distance
 *    from it, both in the metric's own units. An answer that says *"your median
 *    U09G team kicks off at 12:11 and the typical spread is four minutes; this
 *    team averages 12:36"* is checkable by hand. `CLAUDE.md` §3's binding
 *    requirement — every flag carries its evidence and its comparison basis — is
 *    only satisfiable with statistics whose evidence is legible.
 * 3. **It fails loudly.** When more than half a population shares one value the
 *    MAD is exactly zero and every other member's score is infinite. That is not
 *    a very confident outlier; it is the absence of a scale. This module refuses
 *    to divide by it, reports {@link FAIRNESS_DISPERSION.DEGENERATE} and leaves
 *    the members `undecided` — see {@link describeDispersion}. Six populations in
 *    the season corpus land there, which is why the branch is exercised by the
 *    fixtures rather than only by a construction.
 *
 * ## What was rejected, and why it is worth saying
 *
 * **A fallback scale.** When the MAD collapses it is tempting to fall back to a
 * standard deviation, or to an inter-quartile range, so that *some* number comes
 * out. Two populations judged on two different rulers, with nothing in the
 * answer saying which ruler was used, is precisely the class of defect the
 * feasibility layer spent four review rounds removing. So there is no fallback:
 * a degenerate scale publishes the observed distribution as evidence and judges
 * nobody.
 *
 * **A fixed absolute tolerance** ("more than one game behind is unfair"). It
 * needs a domain constant per metric that nobody in this project is in a
 * position to set, and it answers a different question — conformance to a
 * target, not unlikeness to peers. Where a club *does* have a target, that
 * belongs in the constraint registry as a rule, not here as a statistic.
 *
 * ## The two constants, and the reasoning behind each
 *
 * @module fairness/dispersion
 */

import { FAIRNESS_DISPERSION } from './reasonCodes.js';

/**
 * The consistency constant that puts a modified z-score on the same scale as an
 * ordinary z-score for normally distributed data: `0.6745` is the 0.75 quantile
 * of the standard normal, so `MAD / 0.6745` estimates a standard deviation.
 *
 * Stated as a named constant rather than inlined because a bare `0.6745` in an
 * expression is indistinguishable from a tuning parameter somebody chose, and
 * this one is not adjustable — changing it changes what the threshold means.
 *
 * @type {number}
 */
export const MAD_CONSISTENCY_CONSTANT = 0.6745;

/**
 * The score past which a subject is called an outlier.
 *
 * `3.5` is Iglewicz and Hoaglin's published recommendation and it is used here
 * unmodified and untuned. It corresponds, for normally distributed data, to
 * roughly a one-in-two-thousand deviation — deliberately conservative, because
 * the cost of a false flag in this module is an administrator told that a
 * volunteer-run schedule mistreated a nine-year-old's team when it did not.
 *
 * It was **not** chosen by looking at what it does to the season corpus. For the
 * record of what it does do: on `combined_schedule.csv` it raises one flag
 * against a division cohort, none against an age-group cohort, and eight against
 * the season-wide cohort — of which seven do not hold on any narrower basis and
 * are reported as such. See `outliers.js`.
 *
 * @type {number}
 */
export const OUTLIER_SCORE_THRESHOLD = 3.5;

/**
 * The fewest measurable members a population may have and still judge anybody.
 *
 * Four, and the reasoning is structural rather than statistical: to say *"this
 * member is unlike the others"* the others must be able to establish a centre
 * and a scale without the member in question dominating both. Three peers is the
 * least that can do so — with fewer, the median is either the subject's own
 * value or the midpoint of a pair, and the "population" is a comparison of one
 * thing against one other thing wearing the vocabulary of statistics.
 *
 * A population below this floor is {@link FAIRNESS_DISPERSION.INSUFFICIENT} and
 * every member is `undecided`, never `typical`. Reporting `typical` there would
 * be the exact failure this module is built against: a clean bill of health from
 * a check that could not have found anything.
 *
 * @type {number}
 */
export const MIN_POPULATION_FOR_DISPERSION = 4;

/**
 * The median of a list of finite numbers.
 *
 * @param {ReadonlyArray<number>} values
 * @returns {number|null} null for an empty list — never `0`
 */
export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length / 2;
  return sorted.length % 2 === 1
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * The median absolute deviation of a list from its own median.
 *
 * @param {ReadonlyArray<number>} values
 * @returns {number|null} null for an empty list — never `0`
 */
export function medianAbsoluteDeviation(values) {
  const centre = median(values);
  if (centre === null) return null;
  return median(values.map((value) => Math.abs(value - centre)));
}

/**
 * **Describe a population's dispersion, in the four-state vocabulary.**
 *
 * The order of the tests is the design:
 *
 * 1. Too few members — nothing else is asked, because a centre computed from
 *    three values is not a centre.
 * 2. A zero scale over values that are identical **at the precision this module
 *    publishes them at** is {@link FAIRNESS_DISPERSION.UNIFORM}: a real,
 *    measured statement that this population is equal on this metric.
 * 3. A zero scale over values that differ **visibly at that same precision** is
 *    {@link FAIRNESS_DISPERSION.DEGENERATE}: no scale exists, and the observed
 *    distribution is carried on the result so the reader gets the information
 *    the scale could not give them.
 * 4. Otherwise the scale is usable.
 *
 * Steps 2 and 3 are the same `scale === 0` test in any implementation that
 * checks it once, and telling them apart is the whole reason this function
 * exists rather than a `mad()` call at four sites.
 *
 * @param {string} metricId
 * @param {ReadonlyArray<{ subjectId: string, value: number }>} members
 * @returns {import('./types.js').FairnessDispersion}
 */
export function describeDispersion(metricId, members) {
  const values = members.map((member) => member.value);
  const size = values.length;
  const base = {
    metricId,
    size,
    minimumSize: MIN_POPULATION_FOR_DISPERSION,
    threshold: OUTLIER_SCORE_THRESHOLD,
  };

  if (size < MIN_POPULATION_FOR_DISPERSION) {
    return {
      ...base,
      state: FAIRNESS_DISPERSION.INSUFFICIENT,
      centre: null,
      scale: null,
      distribution: distributionOf(values),
    };
  }

  const centre = /** @type {number} */ (median(values));
  const scale = /** @type {number} */ (medianAbsoluteDeviation(values));
  if (scale === 0) {
    // Decided **on the distribution this result publishes**, and not on an
    // exact `===` over the raw doubles. The two are not the same test: a
    // population of means that differ in the fifteenth decimal place has a
    // median absolute deviation of exactly zero and values that are not
    // exactly equal, so an exact test called it `degenerate` while the
    // `distribution` printed beside it showed a single value. A verdict that
    // contradicts its own published evidence is unreadable, and choosing which
    // of the two to trust is not a choice a reader should have to make.
    //
    // So there is one tolerance, {@link distributionOf}'s six decimal places,
    // and it is applied by reading that function's output rather than by a
    // second constant free to drift from it. It is a deliberate choice and not
    // a rounding accident: a difference the published distribution *can* show
    // is still `degenerate`.
    const distribution = distributionOf(values);
    return {
      ...base,
      state:
        distribution.length === 1 ? FAIRNESS_DISPERSION.UNIFORM : FAIRNESS_DISPERSION.DEGENERATE,
      centre,
      scale,
      distribution,
    };
  }

  return {
    ...base,
    state: FAIRNESS_DISPERSION.USABLE,
    centre,
    scale,
    distribution: distributionOf(values),
  };
}

/**
 * The observed distribution, as sorted `[value, count]` pairs.
 *
 * Carried on every dispersion result, and it is the *only* evidence a
 * `degenerate` population can offer. Values are rounded to six decimal places
 * for the key so that a mean of `605.0000000000001` and one of `605` do not read
 * as two distinct values in the report. That rounding is also the tolerance
 * {@link describeDispersion} decides `uniform` against `degenerate` on — read
 * from this function's output rather than restated as a second constant — so the
 * state a population reports and the distribution it publishes cannot
 * contradict each other. It never touches the scoring: `centre`, `scale` and
 * every modified z-score are computed from the raw values.
 *
 * @param {ReadonlyArray<number>} values
 * @returns {ReadonlyArray<[number, number]>}
 */
export function distributionOf(values) {
  /** @type {Map<number, number>} */
  const counts = new Map();
  for (const value of values) {
    const key = Math.round(value * 1e6) / 1e6;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.freeze([...counts.entries()].sort((a, b) => a[0] - b[0]));
}

/**
 * The modified z-score of one value against a described population.
 *
 * Returns `null` — never `Infinity`, never `0` — whenever the population has no
 * usable scale. `deriveFairnessJudgement()` throws on a non-finite score for
 * exactly this reason: an infinity here would compare greater than every
 * threshold and flag every member of a degenerate population.
 *
 * @param {number} value
 * @param {import('./types.js').FairnessDispersion} dispersion
 * @returns {number|null}
 */
export function modifiedZScore(value, dispersion) {
  if (dispersion.state !== FAIRNESS_DISPERSION.USABLE) return null;
  const centre = /** @type {number} */ (dispersion.centre);
  const scale = /** @type {number} */ (dispersion.scale);
  return (MAD_CONSISTENCY_CONSTANT * (value - centre)) / scale;
}
