/**
 * Machine-readable vocabulary for the fairness and equity layer — Prompt 7.2.
 *
 * The same two rules as the twelve modules before it:
 *
 * 1. **`code` is the contract, `message` is decoration.** Never parse a message.
 * 2. **Severity lives in a table, never at a call site.**
 *
 * ## The four things this file declares, and they are not the same thing
 *
 * - **{@link FAIRNESS_MEASURABILITY}** — could this subject be *measured* on
 *   this metric at all? Two states, and `unmeasurable` never carries a number.
 * - **{@link FAIRNESS_DISPERSION}** — could this *population* produce a scale to
 *   judge a deviation against? Four states, because "everybody is identical"
 *   and "the scale collapsed but the values differ" are opposite answers that a
 *   single `mad === 0` test cannot tell apart.
 * - **{@link FAIRNESS_JUDGEMENT}** — the answer about *the subject*: is it an
 *   outlier? Three values, never two.
 * - **{@link FAIRNESS_REASON} / {@link deriveFairnessStatus}** — the answer's own
 *   integrity, in the three-state `allowed` / `compromised` / `rejected`
 *   vocabulary every other module uses. This is `status`, and it is about *the
 *   report*, not about any team in it.
 *
 * ## Why `undecided` is a member of the judgement enum and not a `false`
 *
 * "Unknown is not zero" is the failure this repository has now reproduced four
 * times (`docs/BUILD_PLAN_STATUS.md` §4), and a fairness report is where it does
 * the most damage. A boolean `isOutlier` has exactly one value for *"we measured
 * this team and it is like its peers"* and *"we could not measure this team at
 * all"*, and the first of those reads to an administrator as an all-clear. So
 * the judgement is a required string from a frozen three-member enum,
 * {@link deriveFairnessJudgement} is the only place one is produced, and every
 * `undecided` carries the reason code that decided it.
 *
 * The corpus makes the point without any construction. Four Minis teams show a
 * hosting share of 1.0 because a Minis session has no away side at all; a
 * boolean metric calls them the four most inequitably treated teams of the
 * season, and the honest answer is that hosting share is not a thing that can be
 * measured about them. See `classification.js`.
 *
 * @module fairness/reasonCodes
 */

import {
  CONSTRAINT_SEVERITY,
  CONSTRAINT_STATUS,
  deriveConstraintStatus,
} from '../constraints/reasonCodes.js';

/**
 * How badly a finding counts against a report.
 *
 * @readonly
 * @enum {string}
 */
export const FAIRNESS_SEVERITY = CONSTRAINT_SEVERITY;

/**
 * The three-state outcome of a **report**.
 *
 * @readonly
 * @enum {string}
 */
export const FAIRNESS_STATUS = CONSTRAINT_STATUS;

/**
 * Whether a metric produced a number for a subject.
 *
 * A measurement is `measured` with a numeric `value`, or `unmeasurable` with
 * `value === null` and a stated `reasonCode`. There is no third arrangement and
 * {@link assertFairnessMeasurement} refuses one: a numeric value on an
 * `unmeasurable` measurement, or a null value on a `measured` one, is the
 * collapse this enum exists to stop.
 *
 * @readonly
 * @enum {string}
 */
export const FAIRNESS_MEASURABILITY = Object.freeze({
  /** A number was produced, and the evidence behind it is published. */
  MEASURED: 'measured',
  /** No number could be produced. Never `0`, never omitted from the report. */
  UNMEASURABLE: 'unmeasurable',
});

/**
 * **Whether a population can supply a scale to judge a deviation against.**
 *
 * Four states rather than a nullable number, because the degenerate cases are
 * not variations on one another and an administrator needs to be told which one
 * happened:
 *
 * - {@link USABLE} — a centre and a non-zero scale. Deviations are scoreable.
 * - {@link UNIFORM} — every member holds the identical value. The scale is zero
 *   **and that is a real, confident finding**: this population is perfectly
 *   equal on this metric, and nobody in it is an outlier. This is the answer for
 *   every division's game count in the season-2026 corpus.
 * - {@link DEGENERATE} — the scale is zero and the values are *not* all
 *   identical, which happens whenever more than half the population shares one
 *   value. Every non-median member scores infinitely far from the centre, which
 *   is not a judgement, it is a division by zero wearing a number. Members are
 *   `undecided`, and the finding publishes the observed distribution so the
 *   reader can see what the scale could not.
 * - {@link INSUFFICIENT} — fewer members than {@link MIN_POPULATION_FOR_DISPERSION}.
 *
 * Folding {@link UNIFORM} and {@link DEGENERATE} into one `mad === 0` branch is
 * the specific mistake this enum prevents, and the corpus contains both: every
 * division is `uniform` on game count and six populations are `degenerate` on
 * mean kickoff.
 *
 * @readonly
 * @enum {string}
 */
export const FAIRNESS_DISPERSION = Object.freeze({
  /** A centre and a non-zero scale. */
  USABLE: 'usable',
  /** Zero scale because every value is identical. A measured "perfectly equal". */
  UNIFORM: 'uniform',
  /** Zero scale while values differ. No judgement is possible on this scale. */
  DEGENERATE: 'degenerate',
  /** Too few members to establish a centre and a scale at all. */
  INSUFFICIENT: 'insufficient',
});

/**
 * **The three-state outcome about a subject.** Three values, never two.
 *
 * @readonly
 * @enum {string}
 */
export const FAIRNESS_JUDGEMENT = Object.freeze({
  /** Measured, scored, and beyond the stated threshold. The flag. */
  OUTLIER: 'outlier',
  /** Measured, scored, and inside the stated threshold. A real all-clear. */
  TYPICAL: 'typical',
  /**
   * Not scored. Either the subject had no value or the population had no
   * scale — never "probably fine". Always carries the reason code that decided.
   */
  UNDECIDED: 'undecided',
});

/**
 * Which side of the population centre a flagged subject sits on.
 *
 * Direction is reported and never interpreted: whether a *later* mean kickoff is
 * the bad end or the good end is a question about a club's families, not about
 * arithmetic, and this module refuses to answer it. It reports the value, the
 * centre, and which side of it the subject is on.
 *
 * @readonly
 * @enum {string}
 */
export const FAIRNESS_DIRECTION = Object.freeze({
  ABOVE: 'above',
  BELOW: 'below',
});

/**
 * The questions this module answers.
 *
 * @readonly
 * @enum {string}
 */
export const FAIRNESS_QUESTION = Object.freeze({
  /** *"Is any team, division or age group being treated unlike its peers?"* */
  FAIRNESS_REPORT: 'fairness-report',
  /** *"How unequal is this schedule, as one number a solver could minimise?"* */
  OBJECTIVE_SCORE: 'objective-score',
});

/**
 * Every reason code this module can emit.
 *
 * @readonly
 * @enum {string}
 */
export const FAIRNESS_REASON = Object.freeze({
  /* -- the population a metric is computed over -------------------------- */

  /** A fixture arrived whose class the classifier could not decide. */
  FAIRNESS_FIXTURE_UNCLASSIFIED: 'FAIRNESS_FIXTURE_UNCLASSIFIED',
  /** Two rows arrived under one fixture id. One fixture is one fixture. */
  FAIRNESS_FIXTURE_DUPLICATED: 'FAIRNESS_FIXTURE_DUPLICATED',
  /** Placeholder rows were excluded from every metric. Provenance, with counts. */
  FAIRNESS_PLACEHOLDER_EXCLUDED: 'FAIRNESS_PLACEHOLDER_EXCLUDED',
  /** A subject holds no fixture of the class this metric counts. Not a flag. */
  FAIRNESS_SUBJECT_OUTSIDE_CLASS: 'FAIRNESS_SUBJECT_OUTSIDE_CLASS',
  /** A subject was observed under more than one key for this grouping. */
  FAIRNESS_GROUP_AMBIGUOUS: 'FAIRNESS_GROUP_AMBIGUOUS',
  /** A subject has no key at all for this grouping. */
  FAIRNESS_GROUP_UNLABELLED: 'FAIRNESS_GROUP_UNLABELLED',
  /** Fixtures from more than one scope. Division labels are not keys across scopes. */
  FAIRNESS_SCOPE_MIXED: 'FAIRNESS_SCOPE_MIXED',
  /** No member-team list was supplied, so guest and member cannot be separated. */
  FAIRNESS_MEMBERSHIP_UNSTATED: 'FAIRNESS_MEMBERSHIP_UNSTATED',

  /* -- measuring one subject --------------------------------------------- */

  /** The metric's denominator counted zero fixtures for this subject. */
  FAIRNESS_DENOMINATOR_EMPTY: 'FAIRNESS_DENOMINATOR_EMPTY',
  /** Every fixture this metric would have read is missing the field it needs. */
  FAIRNESS_VALUE_UNAVAILABLE: 'FAIRNESS_VALUE_UNAVAILABLE',

  /* -- judging one subject against a population -------------------------- */

  /** Fewer members than a centre and a scale can be established from. */
  FAIRNESS_POPULATION_TOO_SMALL: 'FAIRNESS_POPULATION_TOO_SMALL',
  /** Every member holds the identical value. A measured "perfectly equal". */
  FAIRNESS_POPULATION_UNIFORM: 'FAIRNESS_POPULATION_UNIFORM',
  /** Zero scale while the values differ. No deviation is scoreable here. */
  FAIRNESS_DISPERSION_DEGENERATE: 'FAIRNESS_DISPERSION_DEGENERATE',
  /** A subject sits beyond the threshold, above the population centre. */
  FAIRNESS_OUTLIER_HIGH: 'FAIRNESS_OUTLIER_HIGH',
  /** A subject sits beyond the threshold, below the population centre. */
  FAIRNESS_OUTLIER_LOW: 'FAIRNESS_OUTLIER_LOW',
  /** Flagged against a wider cohort only, and not against its own narrowest one. */
  FAIRNESS_BASIS_WIDER_ONLY: 'FAIRNESS_BASIS_WIDER_ONLY',

  /* -- meta-assertions: the check that proves the check ran --------------- */

  /** Zero fixtures were read. Incident 4 in one code. */
  FAIRNESS_NO_FIXTURES_READ: 'FAIRNESS_NO_FIXTURES_READ',
  /** A metric measured zero subjects. A perfect score meaning "I looked at nothing". */
  FAIRNESS_METRIC_UNEXERCISED: 'FAIRNESS_METRIC_UNEXERCISED',
  /** Every population of every metric was too small or degenerate to judge. */
  FAIRNESS_NOTHING_JUDGED: 'FAIRNESS_NOTHING_JUDGED',
  /** A flag reached the report without the evidence a flag is required to carry. */
  FAIRNESS_FLAG_EVIDENCE_MISSING: 'FAIRNESS_FLAG_EVIDENCE_MISSING',

  /* -- objectives --------------------------------------------------------- */

  /** Stated on every objective result: nothing in this repository consumes it. */
  FAIRNESS_OBJECTIVE_UNWIRED: 'FAIRNESS_OBJECTIVE_UNWIRED',
  /** Some subjects could not be scored, so the score covers a subset. */
  FAIRNESS_OBJECTIVE_COVERAGE_PARTIAL: 'FAIRNESS_OBJECTIVE_COVERAGE_PARTIAL',
  /** Two results were compared whose coverage or configuration differ. */
  FAIRNESS_OBJECTIVE_INCOMPARABLE: 'FAIRNESS_OBJECTIVE_INCOMPARABLE',
  /** No subject at all was scored, so the objective has no score. Never `0`. */
  FAIRNESS_OBJECTIVE_UNSCORED: 'FAIRNESS_OBJECTIVE_UNSCORED',
});

/**
 * Severity of every reason code.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const FAIRNESS_REASON_SEVERITY = Object.freeze({
  [FAIRNESS_REASON.FAIRNESS_FIXTURE_UNCLASSIFIED]: FAIRNESS_SEVERITY.BLOCKING,
  [FAIRNESS_REASON.FAIRNESS_FIXTURE_DUPLICATED]: FAIRNESS_SEVERITY.BLOCKING,
  [FAIRNESS_REASON.FAIRNESS_PLACEHOLDER_EXCLUDED]: FAIRNESS_SEVERITY.INFO,
  [FAIRNESS_REASON.FAIRNESS_SUBJECT_OUTSIDE_CLASS]: FAIRNESS_SEVERITY.INFO,
  [FAIRNESS_REASON.FAIRNESS_GROUP_AMBIGUOUS]: FAIRNESS_SEVERITY.COMPROMISE,
  [FAIRNESS_REASON.FAIRNESS_GROUP_UNLABELLED]: FAIRNESS_SEVERITY.COMPROMISE,
  [FAIRNESS_REASON.FAIRNESS_SCOPE_MIXED]: FAIRNESS_SEVERITY.BLOCKING,
  [FAIRNESS_REASON.FAIRNESS_MEMBERSHIP_UNSTATED]: FAIRNESS_SEVERITY.INFO,

  [FAIRNESS_REASON.FAIRNESS_DENOMINATOR_EMPTY]: FAIRNESS_SEVERITY.COMPROMISE,
  [FAIRNESS_REASON.FAIRNESS_VALUE_UNAVAILABLE]: FAIRNESS_SEVERITY.COMPROMISE,

  [FAIRNESS_REASON.FAIRNESS_POPULATION_TOO_SMALL]: FAIRNESS_SEVERITY.COMPROMISE,
  [FAIRNESS_REASON.FAIRNESS_POPULATION_UNIFORM]: FAIRNESS_SEVERITY.INFO,
  [FAIRNESS_REASON.FAIRNESS_DISPERSION_DEGENERATE]: FAIRNESS_SEVERITY.COMPROMISE,
  [FAIRNESS_REASON.FAIRNESS_OUTLIER_HIGH]: FAIRNESS_SEVERITY.COMPROMISE,
  [FAIRNESS_REASON.FAIRNESS_OUTLIER_LOW]: FAIRNESS_SEVERITY.COMPROMISE,
  [FAIRNESS_REASON.FAIRNESS_BASIS_WIDER_ONLY]: FAIRNESS_SEVERITY.COMPROMISE,

  [FAIRNESS_REASON.FAIRNESS_NO_FIXTURES_READ]: FAIRNESS_SEVERITY.BLOCKING,
  [FAIRNESS_REASON.FAIRNESS_METRIC_UNEXERCISED]: FAIRNESS_SEVERITY.BLOCKING,
  [FAIRNESS_REASON.FAIRNESS_NOTHING_JUDGED]: FAIRNESS_SEVERITY.BLOCKING,
  [FAIRNESS_REASON.FAIRNESS_FLAG_EVIDENCE_MISSING]: FAIRNESS_SEVERITY.BLOCKING,

  [FAIRNESS_REASON.FAIRNESS_OBJECTIVE_UNWIRED]: FAIRNESS_SEVERITY.INFO,
  [FAIRNESS_REASON.FAIRNESS_OBJECTIVE_COVERAGE_PARTIAL]: FAIRNESS_SEVERITY.COMPROMISE,
  [FAIRNESS_REASON.FAIRNESS_OBJECTIVE_INCOMPARABLE]: FAIRNESS_SEVERITY.BLOCKING,
  [FAIRNESS_REASON.FAIRNESS_OBJECTIVE_UNSCORED]: FAIRNESS_SEVERITY.BLOCKING,
});

/**
 * Which reason code a {@link FAIRNESS_DISPERSION} state raises. One row per
 * member of the enum, and {@link dispersionFinding} is its only reader.
 *
 * The table exists for the reason `feasibility/reasonCodes.js`'s
 * `FEASIBILITY_SEVERITY_EFFECT` exists: the alternative is a chain of `if`s that
 * has to be extended, correctly, at every call site, every time the enum grows.
 * `usable` maps to `null` because a scale that works announces nothing.
 *
 * @type {Readonly<Record<string, string|null>>}
 */
export const FAIRNESS_DISPERSION_REASON = Object.freeze({
  [FAIRNESS_DISPERSION.USABLE]: null,
  [FAIRNESS_DISPERSION.UNIFORM]: FAIRNESS_REASON.FAIRNESS_POPULATION_UNIFORM,
  [FAIRNESS_DISPERSION.DEGENERATE]: FAIRNESS_REASON.FAIRNESS_DISPERSION_DEGENERATE,
  [FAIRNESS_DISPERSION.INSUFFICIENT]: FAIRNESS_REASON.FAIRNESS_POPULATION_TOO_SMALL,
});

/**
 * Severity of a fairness reason code.
 *
 * Throws on an unknown code rather than defaulting to `info`, for the same
 * reason the twelve modules before it do: a code with no severity is a code
 * somebody forgot to register, and a default would make it silently harmless.
 *
 * @param {string} code
 * @returns {string} a {@link FAIRNESS_SEVERITY} value
 */
export function fairnessSeverityOf(code) {
  const severity = FAIRNESS_REASON_SEVERITY[code];
  if (!severity) {
    throw new Error(`fairness: reason code "${code}" has no registered severity`);
  }
  return severity;
}

/**
 * **Render a value a guard refused, without losing what kind of value it was.**
 *
 * The four numeric guards in this layer all print the thing they rejected, and
 * the two obvious ways to do it are each wrong in one direction:
 *
 * - A bare template slot or `String(value)` renders `'3.5'` as `3.5`, so the
 *   refusal of a string reads exactly like the number that would have been
 *   accepted, and renders `''` and `[]` as nothing at all, so the message names
 *   no value.
 * - `JSON.stringify` alone renders `NaN` and `Infinity` as the word `null`,
 *   which is a *different* value this same guard also refuses — and it throws
 *   outright on a `BigInt`, which would replace the diagnostic with a
 *   `TypeError` raised from inside a `throw`.
 *
 * So: numbers by `String`, which prints every non-finite one as itself, and
 * everything else by `JSON.stringify`, which keeps quotes, brackets and braces.
 * The two fallbacks cover the values `JSON.stringify` declines to return a
 * string for — `undefined` and symbols — and the ones it refuses outright.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function describeRefusedValue(value) {
  if (typeof value === 'number') return String(value);
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}

/**
 * Build a fairness finding. `severity` is looked up, never passed in.
 *
 * @param {string} code - a {@link FAIRNESS_REASON} value
 * @param {string} message - for humans only
 * @param {Record<string, unknown>} [details] - flat primitives, ids and counts
 * @returns {import('./types.js').FairnessFinding}
 */
export function makeFairnessFinding(code, message, details = {}) {
  return { code, severity: fairnessSeverityOf(code), message, details };
}

/**
 * **Every finding this module emits, checked against the table that owns it.**
 *
 * Run over the composed list of every sealed report, so the property is "this
 * module cannot emit an unregistered finding" rather than "these codes happen to
 * be registered". Adopted verbatim from
 * `feasibility/reasonCodes.js#assertFeasibilityFindings`, which exists because a
 * foreign finding forwarded in from another module once left that package
 * pretending to be one of its own.
 *
 * @param {ReadonlyArray<import('./types.js').FairnessFinding>} findings
 * @param {string} [question] - named in the failure, so it says which report
 * @returns {ReadonlyArray<import('./types.js').FairnessFinding>} the same list
 */
export function assertFairnessFindings(findings, question = 'a report') {
  for (const finding of findings) {
    const severity = fairnessSeverityOf(finding.code);
    if (finding.severity !== severity) {
      throw new Error(
        `fairness: ${question} carries "${finding.code}" at severity ${JSON.stringify(finding.severity)}, but the frozen table registers it as "${severity}"`
      );
    }
  }
  return findings;
}

/**
 * Derive the status of a **report** mechanically from its findings.
 *
 * @param {ReadonlyArray<import('./types.js').FairnessFinding>} findings
 * @returns {string} a {@link FAIRNESS_STATUS} value
 */
export function deriveFairnessStatus(findings) {
  return deriveConstraintStatus(
    /** @type {ReadonlyArray<import('../constraints/types.js').ConstraintFinding>} */ (findings)
  );
}

/**
 * **The only place a measurement is built**, and the guard that keeps
 * {@link FAIRNESS_MEASURABILITY} honest.
 *
 * A `measured` measurement must carry a finite number and no reason code; an
 * `unmeasurable` one must carry `value === null` and a reason code naming why.
 * Both halves are enforced, because the failure mode runs in both directions: a
 * null on a `measured` row is an unmeasured subject wearing a measurement, and a
 * number on an `unmeasurable` one is the "fold it into zero" defect with a label
 * denying it.
 *
 * @param {import('./types.js').FairnessMeasurement} measurement
 * @returns {import('./types.js').FairnessMeasurement} the same measurement
 */
export function assertFairnessMeasurement(measurement) {
  const where = `${measurement.metricId} of ${measurement.subjectKind} ${JSON.stringify(measurement.subjectId)}`;
  if (measurement.measurability === FAIRNESS_MEASURABILITY.MEASURED) {
    if (typeof measurement.value !== 'number' || !Number.isFinite(measurement.value)) {
      throw new Error(
        `fairness: ${where} is "measured" but its value is ${JSON.stringify(measurement.value)}; a measurement with no number is unmeasurable and must say so`
      );
    }
    if (measurement.reasonCode !== null) {
      throw new Error(
        `fairness: ${where} is "measured" and also names reason ${JSON.stringify(measurement.reasonCode)}; a reason code is what an unmeasurable measurement carries instead of a number`
      );
    }
    return measurement;
  }
  if (measurement.measurability !== FAIRNESS_MEASURABILITY.UNMEASURABLE) {
    throw new Error(
      `fairness: ${where} carries measurability ${JSON.stringify(measurement.measurability)}, which is not a member of FAIRNESS_MEASURABILITY`
    );
  }
  if (measurement.value !== null) {
    throw new Error(
      `fairness: ${where} is "unmeasurable" and still carries the value ${JSON.stringify(measurement.value)}; folding an unmeasurable subject into a number is the defect this enum exists to stop`
    );
  }
  if (measurement.reasonCode === null) {
    throw new Error(
      `fairness: ${where} is "unmeasurable" and names no reason; an unmeasurable measurement must say which question could not be answered`
    );
  }
  fairnessSeverityOf(measurement.reasonCode);
  return measurement;
}

/**
 * **The only place a judgement is produced.**
 *
 * The order is the whole design and it is deliberately not symmetric:
 *
 * 1. **A subject with no value is `undecided`.** Nothing about a population can
 *    rescue a measurement that does not exist.
 * 2. **A population with no usable scale leaves every member `undecided`** —
 *    except {@link FAIRNESS_DISPERSION.UNIFORM}, which is a scale of zero over
 *    identical values and therefore a real, measured "nobody here differs from
 *    anybody". That single exception is the difference between a report that can
 *    say "this division is perfectly equal" and one that can only shrug.
 * 3. Only a scored deviation past the threshold is an `outlier`; a scored
 *    deviation inside it is `typical`, which is an all-clear the report has
 *    earned.
 *
 * `score` must be a finite number or an explicit `null`. An `Infinity` arriving
 * here throws rather than comparing greater than every threshold, because an
 * infinite modified z-score is what a zero scale produces and it means "no
 * scale", not "infinitely unfair".
 *
 * `threshold` must be a finite number for the same reason, but it is **not**
 * checked the same way. Its check sits below the four early returns, at the one
 * line that reads it, because those four answer without ever comparing against
 * it: an absent threshold makes `Math.abs(47.2) > undefined` evaluate `false`
 * and returns `typical`, a clean bill of health from a comparison that could
 * not have found anything. So the parameter is optional here, and a record that
 * lost the key in transit is still answerable from what it carries — on those
 * four paths only.
 *
 * That placement does **not** make a re-derived `undecided()` row work, and
 * nothing here claims it does. `undecided()` reads its state and its threshold
 * off the same absent dispersion, so a row with `threshold: null` carries
 * `dispersionState: null` beside it and is refused one guard earlier, by the
 * membership check. Such a row does not carry a `measurability` for a caller to
 * supply either. Re-deriving one is not an operation this function offers.
 *
 * @param {{ measurability: string, dispersion: string, score: number|null, threshold?: number|null }} input
 * @returns {string} a {@link FAIRNESS_JUDGEMENT} value
 */
export function deriveFairnessJudgement(input) {
  if (
    !(/** @type {string[]} */ (Object.values(FAIRNESS_MEASURABILITY)).includes(input.measurability))
  ) {
    throw new Error(
      `fairness: measurability ${JSON.stringify(input.measurability)} is not a member of FAIRNESS_MEASURABILITY`
    );
  }
  if (!Object.hasOwn(FAIRNESS_DISPERSION_REASON, input.dispersion)) {
    throw new Error(
      `fairness: dispersion ${JSON.stringify(input.dispersion)} is not a member of FAIRNESS_DISPERSION; a state nobody decided the meaning of must not judge a subject by default`
    );
  }
  if (input.score !== null && !Number.isFinite(input.score)) {
    throw new Error(
      `fairness: score ${describeRefusedValue(input.score)} is not finite; an infinite deviation is a scale of zero wearing a number, and it means "no scale", never "infinitely unfair"`
    );
  }
  if (input.measurability === FAIRNESS_MEASURABILITY.UNMEASURABLE) {
    return FAIRNESS_JUDGEMENT.UNDECIDED;
  }
  if (input.dispersion === FAIRNESS_DISPERSION.UNIFORM) return FAIRNESS_JUDGEMENT.TYPICAL;
  if (input.dispersion !== FAIRNESS_DISPERSION.USABLE) return FAIRNESS_JUDGEMENT.UNDECIDED;
  if (input.score === null) return FAIRNESS_JUDGEMENT.UNDECIDED;
  // The fourth input, checked below the four returns that never reach the
  // comparison, because this is the only line that reads it. Past here a
  // comparison is about to happen, and `Math.abs(47.2) > undefined` is `false`:
  // an absent threshold returned `typical`, a clean bill of health from a
  // comparison that could not have found anything.
  //
  // The arrival this placement serves is narrow and real: a record that lost
  // the key in transit — a JSON round trip drops an absent `threshold` — on one
  // of the four paths above, which answer from what such a record still
  // carries. It does **not** make a re-derived `undecided()` row work; that row
  // has `dispersionState: null` too and the membership guard above refuses it
  // first. Both halves are proved in tests/fairnessMetrics.test.js, section 15.
  if (!Number.isFinite(input.threshold)) {
    throw new Error(
      `fairness: threshold ${describeRefusedValue(input.threshold)} is not a finite number; the judgement about to be returned is a comparison against it, and a comparison against nothing answers "typical"`
    );
  }
  return Math.abs(input.score) > input.threshold
    ? FAIRNESS_JUDGEMENT.OUTLIER
    : FAIRNESS_JUDGEMENT.TYPICAL;
}

/**
 * The finding a dispersion state raises, or `null` when it raises none.
 *
 * @param {import('./types.js').FairnessDispersion} dispersion
 * @param {import('./types.js').FairnessBasis} basis
 * @returns {import('./types.js').FairnessFinding|null}
 */
export function dispersionFinding(dispersion, basis) {
  const code = FAIRNESS_DISPERSION_REASON[dispersion.state];
  if (code === undefined) {
    throw new Error(
      `fairness: dispersion state ${JSON.stringify(dispersion.state)} has no row in FAIRNESS_DISPERSION_REASON`
    );
  }
  if (code === null) return null;
  const where = `${dispersion.metricId} over ${basis.kind} ${JSON.stringify(basis.groupKey)}`;
  // `uniform` is decided on the six-decimal-place tolerance the distribution is
  // published at, not on an exact `===` over the raw doubles — see
  // `describeDispersion()`. So the message says *one published value* and prints
  // the published one. Saying "the identical value" and printing the raw median
  // produced "all 4 members hold the identical value 605.0000000000001", which
  // is a sentence disproved by the number inside it.
  const published =
    dispersion.distribution.length === 1 ? dispersion.distribution[0][0] : dispersion.centre;
  const messages = {
    [FAIRNESS_REASON.FAIRNESS_POPULATION_UNIFORM]: `${where}: all ${dispersion.size} members hold one value, ${published}, at the six decimal places this report publishes values to — their median absolute deviation is exactly zero — so this population is equal on this metric at that precision and nobody in it is an outlier`,
    [FAIRNESS_REASON.FAIRNESS_DISPERSION_DEGENERATE]: `${where}: the median absolute deviation is 0 while the values differ, so no deviation here is scoreable; the observed distribution is published in details.distribution instead`,
    [FAIRNESS_REASON.FAIRNESS_POPULATION_TOO_SMALL]: `${where}: ${dispersion.size} measurable member(s) is fewer than the ${dispersion.minimumSize} a centre and a scale can be established from, so no member was judged`,
  };
  return makeFairnessFinding(code, messages[code], {
    metricId: dispersion.metricId,
    basisKind: basis.kind,
    groupKind: basis.groupKind,
    groupKey: basis.groupKey,
    populationSize: dispersion.size,
    centre: dispersion.centre,
    scale: dispersion.scale,
    distribution: dispersion.distribution,
  });
}

/**
 * Fresh zeroed counters.
 *
 * Incident 4 in `fixtures/season-2026/README.md` is a validator whose join
 * matched zero records and reported a perfect score. Every one of these is
 * additive, so a per-metric result folds into a per-report one without any of
 * them meaning something different at the two scales, and
 * `assertFairnessExercised()` in `report.js` turns the zeroes into **blocking**
 * findings rather than into silence.
 *
 * @returns {import('./types.js').FairnessMeta}
 */
export function createFairnessMeta() {
  return {
    /** Fixtures handed to the classifier, of every class. */
    fixturesRead: 0,
    /**
     * Distinct fixtures at least one **requested** metric read — those of a
     * competition one of them counts. Never simply every fixture naming a
     * participant: that made it equal to `fixturesRead` on the season corpus,
     * so the one shortfall it exists to surface was the one it could not show.
     *
     * Scope-level, and it stops there: a metric's *own* exclusions — a fixture
     * naming no opponent, carrying no kickoff, held at no venue — are counted
     * per subject on each measurement's `evidence`, because which fixtures they
     * were is a question a measurement can answer and a report-wide counter
     * cannot.
     */
    fixturesCounted: 0,
    /** Fixtures excluded as placeholders — not teams, not games. */
    fixturesPlaceholder: 0,
    /** Distinct subjects of every kind the report holds a measurement for. */
    subjectsConsidered: 0,
    /** Subject/metric pairs that produced a number. */
    measurementsMeasured: 0,
    /** Subject/metric pairs that could not, each with a stated reason. */
    measurementsUnmeasurable: 0,
    /** Populations built — one per (metric, basis, group). */
    populationsBuilt: 0,
    /** Populations that supplied a usable centre and scale. */
    populationsScored: 0,
    /** Subject/metric/basis triples actually judged (`outlier` or `typical`). */
    judgementsMade: 0,
    /** Triples left `undecided`, each with a stated reason. */
    judgementsUndecided: 0,
    /** Flags raised. */
    flagsRaised: 0,
    /** Flags that hold on a strictly narrower basis too. */
    flagsHeldNarrower: 0,
  };
}

/**
 * Fold one set of counters into another.
 *
 * @param {import('./types.js').FairnessMeta} target
 * @param {import('./types.js').FairnessMeta} source
 * @returns {import('./types.js').FairnessMeta}
 */
export function mergeFairnessMeta(target, source) {
  for (const key of Object.keys(target)) {
    target[key] += source[key] ?? 0;
  }
  return target;
}
