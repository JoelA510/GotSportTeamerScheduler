/**
 * Barrel for the waiver ledger.
 *
 * Every public export of `waivers/` goes through this file, exactly as
 * `packages/core/src/facility/index.js`, `timing/index.js`,
 * `availability/index.js` and `constraints/index.js` do for their modules.
 *
 * The package is pure domain logic: no React, no `node:*`, no `Date`
 * construction, and **no import from `fixtures/`**. The arrow points
 * fixtures -> waivers, never back; the season-2026 adapter transcribes what
 * incident 9 records and takes the one thing the incident does not record — the
 * coach and the venue pair — as an argument.
 *
 * It imports `constraints/` (a waiver excepts a constraint, so it must be able
 * to look one up, judge its scope against its own, and read its hardness) and,
 * through it, the Phase 1 severity vocabulary. The dependency is
 * one-directional: nothing in `constraints/` knows waivers exist, and
 * `BASE_REASON_SEVERITY` deliberately does not carry this module's codes.
 *
 * What this module deliberately does **not** do: it does not touch
 * `gameScheduling.js`, `autoScheduler.js`, `gameMetrics.js` or
 * `outputGeneration.js`. `annotations.js` supplies the row-level annotation
 * data an exporter would consume; wiring it into `generateScheduleExports()`
 * is a follow-up and this phase's diff is additive.
 *
 * Phase 2 is **in-memory only**. There is no SQL home for waiver records and
 * this work deliberately does not create one.
 *
 * @module waivers
 */

export {
  WAIVER_DISPOSITION,
  WAIVER_REASON,
  WAIVER_REASON_SEVERITY,
  WAIVER_SCOPE_DIMENSION,
  WAIVER_SCOPE_SPECIFICITY,
  WAIVER_SEVERITY,
  WAIVER_STATUS,
  createWaiverMeta,
  deriveWaiverDisposition,
  deriveWaiverStatus,
  isViolationFinding,
  makeWaiverFinding,
  mergeWaiverMeta,
  waiverSeverityOf,
  waiverSpecificityOf,
} from './reasonCodes.js';

export {
  WAIVER_SCOPE_FIELDS,
  WaiverApprovalSchema,
  WaiverContextSchema,
  WaiverLedgerInputSchema,
  WaiverRecordSchema,
  WaiverScopeSchema,
  WaiverSubjectSchema,
} from './schemas.js';

export {
  judgeWaiverApplicability,
  judgeWaiverScope,
  judgeWaiverWindow,
  normaliseWaiverContext,
  waiverDimensions,
  waiverSpecificity,
} from './scope.js';

export {
  buildWaiverLedger,
  getWaiver,
  reconcileWaiverLedger,
  requireWaiver,
  waiversForConstraint,
  withoutWaiver,
} from './ledger.js';

export { applyWaivers, isWaived } from './apply.js';

export { DORMANCY_REASON, detectDormantWaivers } from './dormancy.js';

export {
  NOTE_SEPARATOR,
  annotationsBySubject,
  mergeWaiverNote,
  waiverNotesBySubject,
} from './annotations.js';

export {
  CoachCommitmentSchema,
  TRAVEL_POLICY,
  TRAVEL_REASON,
  TRAVEL_REASON_SEVERITY,
  createTravelMeta,
  evaluateCoachTravel,
  makeTravelFinding,
  travelConstraintIdByCode,
  travelSeverityOf,
} from './coachTravel.js';

export {
  INCIDENT_9_OBSERVED_TRAVEL_MINUTES,
  SEASON_2026_WAIVER_ID,
  buildSeason2026WaiverLedger,
  makeSeason2026TravelWaiver,
} from './adapters/season2026Waivers.js';
