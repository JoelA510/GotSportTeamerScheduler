/**
 * Barrel for the fairness and equity layer — Prompt 7.2.
 *
 * Every public export of `fairness/` goes through this file, exactly as
 * `facility/index.js`, `timing/index.js`, `availability/index.js`,
 * `constraints/index.js`, `waivers/index.js`, `ruleEngine/index.js`,
 * `people/index.js`, `freeze/index.js`, `resolve/index.js`,
 * `attribution/index.js`, `reserve/index.js`, `publication/index.js`,
 * `scenario/index.js` and `feasibility/index.js` do for theirs.
 *
 * ## What this module is
 *
 * *"Is anybody being treated unlike their peers, and how would I check that
 * claim?"* — per team, per division, per age group, with every flag carrying the
 * population it was judged against, the measure, the magnitude and the fixtures
 * behind it.
 *
 * ## What it deliberately is not
 *
 * - **Not a writer, and not a solver.** It reads a fixture list and returns a
 *   report. It moves nothing, proposes nothing, and persists nothing.
 * - **Not wired to a solver.** `objectives.js` ships three scoring functions in
 *   the shape a solver could consume, and **nothing consumes them.**
 *   `gameScheduling.js` and `autoScheduler.js` are untouched by this work and do
 *   not import this module; every objective result says so in a finding.
 * - **Not `gameMetrics.js`.** That module measures a *schedule* — counts,
 *   coverage, utilisation. This one measures the *distribution of a schedule's
 *   burdens across its participants*, which is a different question with a
 *   different failure mode, and it is not modified by this work.
 * - **Not a judge of what is fair.** It reports that a team's mean kickoff is 25
 *   minutes later than its division's, with the cohort, the spread and the
 *   arithmetic. Whether that is unfair is a club's decision, and the module
 *   declines to encode one — including by refusing to say whether `above` or
 *   `below` is the bad direction.
 * - **Not persisted.** In-memory only, consistently with Phases 1-7. There is no
 *   SQL home for a fairness report and this work deliberately does not create
 *   one.
 *
 * ## The one thing to read first
 *
 * `classification.js`. Every metric here is a comparison, and a comparison over
 * the wrong population is the failure mode this module exists to avoid — not a
 * subtle one, the headline one. On the season-2026 corpus a games-played metric
 * without the league/external/friendly distinction accuses eighteen teams of
 * being short-changed, and every one of the eighteen is a team that is not in
 * the league.
 *
 * @module fairness
 */

export {
  DUPLICATE_ID_CAP,
  FAIRNESS_COMPETITION,
  FAIRNESS_COMPETITION_ORDER,
  FAIRNESS_SIDE,
  classifyFairnessFixtures,
  isTwoSided,
  membershipSplit,
  participationOf,
  sideOf,
} from './classification.js';

export {
  MAD_CONSISTENCY_CONSTANT,
  MIN_POPULATION_FOR_DISPERSION,
  OUTLIER_SCORE_THRESHOLD,
  describeDispersion,
  distributionOf,
  median,
  medianAbsoluteDeviation,
  modifiedZScore,
} from './dispersion.js';

export {
  FAIRNESS_METRIC,
  FAIRNESS_METRIC_ORDER,
  FAIRNESS_METRIC_REGISTRY,
  FAIRNESS_METRIC_UNIT,
  FAIRNESS_SUBJECT_KIND,
  cohortKeysBySubject,
  fairnessMetricOf,
  groupKeyOf,
  measureGroup,
  measureSubject,
  measureTeams,
  unanimousReasonOf,
} from './metrics.js';

export {
  FAIRNESS_OBJECTIVE,
  FAIRNESS_OBJECTIVE_COMPETITIONS,
  FAIRNESS_OBJECTIVE_ORDER,
  FAIRNESS_OBJECTIVE_REGISTRY,
  FAIRNESS_OBJECTIVE_SENSE,
  compareObjectiveScores,
  scoreFairnessObjective,
} from './objectives.js';

export {
  FAIRNESS_BASIS,
  FAIRNESS_BASIS_ORDER,
  FAIRNESS_BASIS_WIDTH,
  assertFlagEvidence,
  basesFor,
  buildPopulations,
  corroborateFlags,
  narrowerBases,
} from './outliers.js';

export {
  FAIRNESS_DIRECTION,
  FAIRNESS_DISPERSION,
  FAIRNESS_DISPERSION_REASON,
  FAIRNESS_JUDGEMENT,
  FAIRNESS_MEASURABILITY,
  FAIRNESS_QUESTION,
  FAIRNESS_REASON,
  FAIRNESS_REASON_SEVERITY,
  FAIRNESS_SEVERITY,
  FAIRNESS_STATUS,
  assertFairnessFindings,
  assertFairnessMeasurement,
  createFairnessMeta,
  deriveFairnessJudgement,
  deriveFairnessStatus,
  dispersionFinding,
  fairnessSeverityOf,
  makeFairnessFinding,
  mergeFairnessMeta,
} from './reasonCodes.js';

export {
  NAMED_SUBJECT_CAP,
  assertFairnessExercised,
  countedFixturesOf,
  fairnessReport,
  summariseUnmeasured,
} from './report.js';

export {
  FairnessFixtureSchema,
  FairnessObjectiveConfigSchema,
  FairnessReportQuerySchema,
} from './schemas.js';

export {
  SEASON_2026_COMPETITION_OF_ROW_KIND,
  season2026FairnessAgeGroup,
  toSeason2026FairnessFixtures,
} from './adapters/season2026Fairness.js';
