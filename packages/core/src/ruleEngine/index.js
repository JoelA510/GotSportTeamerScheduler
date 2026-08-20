/**
 * Barrel for the standing rule engine.
 *
 * Every public export of `ruleEngine/` goes through this file, exactly as
 * `packages/core/src/facility/index.js`, `timing/index.js`,
 * `availability/index.js`, `constraints/index.js` and `waivers/index.js` do for
 * their modules.
 *
 * The package is pure domain logic: no React, no `node:*`, no `Date`
 * construction, and **no import from `fixtures/`**. The arrow points
 * fixtures -> ruleEngine, never back; the season-2026 adapter takes the
 * already-parsed season object as an argument, so this module never learns
 * where the corpus lives or how it is read.
 *
 * It imports `constraints/` (a rule enforces a constraint, so it must resolve
 * one and read its hardness), `waivers/` (a violation may be excepted, and the
 * coach-travel evaluator lives there), and `facility/`, `timing/` and
 * `availability/` for the Phase 1 evaluators it drives. Nothing in those six
 * modules knows the rule engine exists.
 *
 * What this module deliberately does **not** do: it does not touch
 * `gameScheduling.js`, `autoScheduler.js` or `gameMetrics.js`. Those solvers are
 * week-indexed while everything here is date-indexed, and wiring the engine into
 * them is Phase 4.
 *
 * Phase 2 is **in-memory only**. There is no SQL home for rules or reports and
 * this work deliberately does not create one.
 *
 * @module ruleEngine
 */

export {
  RULE_IDENTIFIER_KIND,
  RULE_REASON,
  RULE_REASON_SEVERITY,
  RULE_SEVERITY,
  RULE_STATUS,
  RULE_VIOLATION_REASON,
  RULE_VIOLATION_SEVERITY,
  createRuleEngineMeta,
  deriveRuleStatus,
  isRuleViolation,
  makeRuleFinding,
  makeViolationFinding,
  mergeRuleEngineMeta,
  ruleSeverityOf,
  violationSeverityOf,
} from './reasonCodes.js';

export {
  RuleDefinitionSchema,
  RuleEngineInputSchema,
  RuleExerciseSchema,
  ScheduleSchema,
  ScheduledCommitmentSchema,
  ScheduledGameSchema,
  ScheduledTeamSchema,
} from './schemas.js';

export {
  checkCoverage,
  checkIdentifiers,
  checkMinimums,
  createExerciseMeta,
  describeExpectation,
  judgeExercise,
  universeOf,
} from './exercise.js';

export {
  RULE_ID,
  STANDING_RULES,
  coachConflictRule,
  conflictFairnessRule,
  fieldAdjacencyRule,
  fieldEligibilityRule,
  fieldSameGroundRule,
  homeAwayBalanceRule,
  permitWindowRule,
  roundRobinRule,
  sunsetMarginRule,
  turnoverMinimumRule,
} from './rules.js';

export {
  buildRuleEngine,
  buildStandingRuleEngine,
  constraintIdsByReasonCode,
  ruleCoverage,
  runRuleEngine,
  summariseComputed,
} from './engine.js';

export { SEVERITY_ORDER, buildValidationReport, renderValidationReport } from './report.js';

export {
  SEASON_2026_COUNTED_ROW_KINDS,
  season2026AgeGroup,
  toSeason2026Schedule,
} from './adapters/season2026Schedule.js';
