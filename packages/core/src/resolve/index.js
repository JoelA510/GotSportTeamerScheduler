/**
 * A **change-request re-solver**, not a scheduler.
 *
 * Read this paragraph before reading anything else in the package. `resolve/`
 * answers one question — *"the schedule families already have needs this
 * change; what is the smallest set of games that has to move, and did anything
 * move that was not allowed to?"* — over the same date-indexed
 * {@link import('../ruleEngine/types.js').Schedule} the standing rule engine
 * consumes. It is deliberately unable to do more:
 *
 * - **It cannot generate a season.** There is no round-robin generator here and
 *   no matchup generator. It re-places games that already exist.
 * - **It cannot invent a slot.** `inventory.js` derives every candidate date,
 *   surface and kickoff from the baseline schedule itself. The single exception
 *   is a slot a change request names — an externally-published fixture arrives
 *   at the time the other league published, and the club does not get to invent
 *   one for it — and that exception is per game and stamped
 *   `RESOLVE_CHANGE_SLOT_OUTSIDE_INVENTORY`.
 * - **It does not import `gameScheduling.js`**, and `gameScheduling.js` does not
 *   import it. That engine is week-indexed and generates matchups from a
 *   round-robin; this one is date-indexed and re-places rows. Bridging them is
 *   not 4.1's work, and `scheduleGames()` now refuses a `freeze` argument
 *   outright rather than pretending it can honour one.
 * - **It repairs facility legality only.** Occupancy, permits, lighting,
 *   daylight, size and lining come from Phase 1.3 through `legality.js`.
 *   Turnover floors, round-robin completeness, home/away balance and coach
 *   travel are the rule engine's; the `verify` stage reports what a change
 *   introduced and repairs none of it, because trading one soft constraint
 *   against another needs the weighted objective **Prompt 4.2** owns by name.
 * - **It does not touch practices.** `autoScheduler.js` has its own locks.
 *
 * ## Its relationship with `placement/`
 *
 * `packages/core/src/placement/` remains the Prompt 2.1 demonstration harness
 * and is not superseded, retired or imported. It proves one thing this package
 * deliberately cannot — that flipping a constraint's *hardness* changes where
 * games go — by placing earliest-legal-first with no objective at all, which is
 * the opposite of what a production re-solve must do. Two modules, two
 * questions.
 *
 * ## What freeze applies to
 *
 * Games. **Commitments are inputs and are held by definition**: a coach's
 * evening obligation, a field reservation, an external club's window. A change
 * request cannot edit one, so there is no disposition to give them. Incident 5
 * is what happens when a commitment arrives *after* the solve rather than
 * before it.
 *
 * Phase 4.1 is **in-memory only**. There is no SQL home for a freeze plan or a
 * resolve run yet and this work deliberately does not create one, consistently
 * with Phases 1-3.
 *
 * @module resolve
 */

export {
  RESOLVE_REASON,
  RESOLVE_REASON_SEVERITY,
  RESOLVE_SEVERITY,
  RESOLVE_STATUS,
  createResolveMeta,
  deriveResolveStatus,
  makeResolveFinding,
  mergeResolveMeta,
  resolveSeverityOf,
} from './reasonCodes.js';

export {
  FreezeContractSchema,
  ResolveStageSchema,
  STAGE_PROBE,
  ScheduleChangeRequestSchema,
} from './schemas.js';

export {
  FrozenGameMoveAttempt,
  MOVE_KIND,
  applyMove,
  createResolveLedger,
  createResolveState,
  diffAgainstBaseline,
  isFrozen,
  isSlotAdmissible,
  mayMove,
  pinGames,
  slotKey,
  slotOf,
  stageCounters,
} from './state.js';

export { FrozenGameUnsatisfiable, frozenGameUnsatisfiable } from './errors.js';

export { buildSlotInventory, candidateSlotsFor } from './inventory.js';

export { bookingsOn, checkPlacement } from './legality.js';

export { FREEZE_AUDIT_STAGE_ID, RESOLVE_STAGES, buildResolvePipeline } from './stages.js';

export { probeStage, probeEveryStage } from './probe.js';

export { applyChangeRequest, reoptimiseWholeSeason, resolvedScheduleOf } from './resolve.js';

export { season2026ExternalFixtureChanges } from './adapters/season2026ChangeRequest.js';
