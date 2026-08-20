/**
 * Barrel for the freeze scope model.
 *
 * The package is pure domain logic: no React, no `node:*`, no `Date`
 * construction, and no import from `fixtures/`. It depends on exactly one other
 * module — `constraints/reasonCodes.js` — and only for the severity vocabulary
 * and the specificity integers, so that "this thaw is broader than the freeze
 * it carves out of" is measured on the same scale as
 * `CONSTRAINT_SCOPE_SPECIFICITY` and `WAIVER_SCOPE_SPECIFICITY`.
 *
 * It holds **no schedule state and performs no placement.** A plan answers one
 * question about one game — *is it held?* — and the module that acts on the
 * answer is `resolve/`.
 *
 * Phase 4.1 is **in-memory only**: there is no SQL home for a freeze plan yet
 * and this work deliberately does not create one, consistently with Phases 1-3.
 *
 * @module freeze
 */

export {
  FREEZE_DISPOSITION,
  FREEZE_REASON,
  FREEZE_REASON_SEVERITY,
  FREEZE_RULE_KIND,
  FREEZE_SCOPE_DIMENSION,
  FREEZE_SCOPE_SPECIFICITY,
  FREEZE_SCOPE_TIE_BREAK,
  FREEZE_SEVERITY,
  FREEZE_STATUS,
  createFreezeMeta,
  deriveFreezeStatus,
  freezeSeverityOf,
  freezeSpecificityOf,
  freezeTieBreakOf,
  makeFreezeFinding,
  mergeFreezeMeta,
} from './reasonCodes.js';

export {
  FREEZE_MATCH_FIELDS,
  FreezeMatchSchema,
  FreezePlanInputSchema,
  FreezeRuleSchema,
  GlobalReoptimisationSchema,
} from './schemas.js';

export {
  freezeDimensions,
  freezeSpecificity,
  freezeTieBreak,
  judgeFreezeMatch,
  normaliseFreezeContext,
} from './scope.js';

export {
  buildFreezePlan,
  freezeAllExcept,
  freezeForChanges,
  judgeFreeze,
  judgeFreezeAll,
  scopesTouchedBy,
} from './plan.js';
