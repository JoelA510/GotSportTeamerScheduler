/**
 * Barrel for the explain-why layer.
 *
 * Every public export of `attribution/` goes through this file, exactly as
 * `facility/index.js`, `timing/index.js`, `availability/index.js`,
 * `constraints/index.js`, `waivers/index.js`, `ruleEngine/index.js`,
 * `people/index.js`, `freeze/index.js` and `resolve/index.js` do for theirs.
 *
 * ## What this module is
 *
 * The consumer every earlier phase named. It decides nothing: every number it
 * reports was computed by a module that owns the question, and the whole of this
 * package is a coherent shape over those answers plus one search
 * (`minimal.js`'s deletion filter) that no earlier module could perform because
 * it needs all of them at once.
 *
 * | it needs | it asks |
 * | --- | --- |
 * | which of the four edges binds, and by how much | `availability/kickoff.js` — `checkKickoffAvailability()`, whose `orderByTightness()` ordering is passed through untouched |
 * | may this game stand here | `resolve/legality.js` — `checkPlacement()` |
 * | which registry constraint claims this code | `resolve/errors.js` — `registryConstraintIdsFor()` |
 * | which violations are about this game | `resolve/errors.js` — `violationsAbout()`, matched on identity, never substring |
 * | what a violation computed, and how to say it | `ruleEngine/engine.js` — `RuleViolation` and `summariseComputed()` |
 * | what a coach's day costs | `waivers/coachTravel.js` — `evaluateCoachTravel()` |
 * | could anybody else have covered | `people/roster.js` — `soleCoachRiskRegister()` |
 * | what kickoff yields a full warm-up | `timing/warmup.js` — `earliestKickoffWithWarmup()` |
 * | what would this constraint being softer change | `constraints/whatIf.js` — `whatIfConstraintType()` |
 *
 * ## What it deliberately is not
 *
 * - **Not a second evaluator.** There is no overlap test, no permit parser, no
 *   gap arithmetic and no tightness comparison over the four edges in this
 *   package. A second copy of any of them would be free to disagree with the
 *   first, and the disagreement would surface as an explanation that contradicts
 *   the schedule it explains.
 * - **Not a solver.** It never moves a game. Every game in the state it builds
 *   is frozen, and the only writer in `resolve/` is `applyMove()`, which nothing
 *   here calls.
 * - **Not persisted.** Phase 4 is in-memory only. There is no SQL home for an
 *   attribution and this work deliberately does not create one, consistently
 *   with Phases 1-3.
 * - **Not an adapter's business.** Unlike every other module this one ships no
 *   `adapters/season2026*.js`, because it reads no corpus shape: it takes the
 *   engines the other adapters already built.
 *
 * @module attribution
 */

export {
  ATTRIBUTION_CODES_BY_CONSTRAINT_KIND,
  ATTRIBUTION_QUESTION,
  ATTRIBUTION_REASON,
  ATTRIBUTION_REASON_SEVERITY,
  ATTRIBUTION_SEVERITY,
  ATTRIBUTION_SOURCE,
  ATTRIBUTION_SOURCE_BY_REASON_CODE,
  ATTRIBUTION_SOURCE_ORDER,
  ATTRIBUTION_STATUS,
  attributionSeverityOf,
  attributionSourceOf,
  createAttributionMeta,
  deriveAttributionStatus,
  makeAttributionFinding,
  mergeAttributionMeta,
} from './reasonCodes.js';

export {
  AlternativeTimeQuerySchema,
  EarliestKickoffQuestionSchema,
  GameAttributionQuerySchema,
  LatestKickoffQuestionSchema,
  MinimalBlockingSetQuerySchema,
  TeamConflictQuerySchema,
} from './schemas.js';

export {
  categoryOnlyClaimFindings,
  claimFromAvailabilityConstraint,
  claimFromConstraintFindings,
  claimFromFinding,
  claimFromRosterFinding,
  claimFromTravelTransition,
  claimFromViolation,
  claimFromWarmupBound,
  entitiesOf,
  groupFindingsByConstraintKind,
  isSpecificClaim,
  makeClaim,
  mergeClaimsByTightness,
  numbersIn,
} from './claims.js';

export { buildAttributionContext } from './context.js';

export {
  explainEarliestKickoff,
  explainGame,
  explainKickoffTime,
  explainLatestKickoff,
  explainTeamConflict,
} from './explain.js';

export { minimalBlockingSet } from './minimal.js';

export { explainSchedule } from './sweep.js';
