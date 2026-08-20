/**
 * **The second step.** Turning a proposal into the schedule.
 *
 * > *"DRY RUN by default on any re-solve: report what would change before
 * > committing. Commit as an explicit second step."*
 *
 * That is an **API shape**, not a paragraph of documentation. Neither
 * `applyChangeRequest()` nor `reoptimiseWholeSeason()` takes a `commit` flag,
 * and neither can produce a committed result however it is called: they stamp
 * `committed: false` unconditionally and every one of them emits
 * `RESOLVE_DRY_RUN`. The only function in either package that can produce
 * `committed: true` is this one, `tests/minimalDiff.test.js` asserts that
 * structurally by scanning the source, and its name says what it does — exactly
 * the shape Prompt 4.1 gave `reoptimiseWholeSeason()`, for the same reason.
 *
 * ## What it refuses, and what it will not let you override
 *
 * | situation | answer |
 * |---|---|
 * | `acknowledged` is not the literal `true` | `TypeError`. `1`, `'yes'` and `{}` are truthy and none of them is somebody saying yes |
 * | the change budget was exceeded | {@link ChangeBudgetExceeded}, and **no override exists** |
 * | any other blocking finding | throws, naming each code, unless the caller listed that code in `acceptFindingCodes` |
 * | quality was never measured (`verify: false`) | throws unless `RESOLVE_REPORT_QUALITY_UNMEASURED` is accepted by name |
 *
 * The budget is the one thing with no override on purpose. A cap an operator
 * can wave through under pressure is a cap that will be waved through under
 * pressure; a caller willing to move more games says so by naming a bigger
 * number, which leaves a record of the number they agreed to. Everything else
 * is overridable *by code*, one code at a time, and the accepted codes are
 * recorded on the commit — accepting a finding is a decision, and a decision
 * that leaves no trace is the shape incident 9's board waiver went missing in.
 *
 * @module resolve/commit
 */

import { FREEZE_SEVERITY } from '../freeze/reasonCodes.js';

import { RESOLVE_REASON } from './reasonCodes.js';

/**
 * Thrown when a run moves more games than its change budget allows.
 *
 * Carries the numbers and the constraint ids that forced the consequential
 * moves, so the operator reading it is told *what* would have to give rather
 * than only that something did.
 */
export class ChangeBudgetExceeded extends Error {
  /**
   * @param {string} message
   * @param {Object} detail
   */
  constructor(message, detail) {
    super(message);
    this.name = 'ChangeBudgetExceeded';
    /** @type {number} */
    this.budget = detail.budget;
    /** @type {number} */
    this.moved = detail.moved;
    /** @type {number} */
    this.requested = detail.requested;
    /** @type {number} */
    this.consequential = detail.consequential;
    /** @type {string[]} */
    this.constraintIds = detail.constraintIds;
    /** @type {string|null} */
    this.constraintId = detail.constraintId;
    /** @type {Array<Object>} */
    this.consequentialMoves = detail.consequentialMoves;
  }
}

/**
 * Commit a dry run. **The named second step.**
 *
 * @param {import('./types.js').ResolveRun} run - what `applyChangeRequest()` returned
 * @param {{ acknowledged: true, committedBy?: string|null, acceptFindingCodes?: ReadonlyArray<string> }} input
 * @returns {import('./types.js').CommittedResolve}
 */
export function commitResolve(run, input) {
  // The cast is the point: a `ResolveRun` is typed `committed: false`, so the
  // only way to reach this branch is a caller handing back something that is not
  // one — most often the `CommittedResolve` this function already gave them.
  if (/** @type {{ committed?: unknown }} */ (run)?.committed === true) {
    // Checked before the shape guard, because a committed result *is* the thing
    // a caller is most likely to hand back by mistake and "that is not a run"
    // would be a true answer to the wrong question.
    throw new Error(
      'resolve: this has already been committed; commit a re-solve once, or run a new one against the schedule it produced'
    );
  }
  if (!run || typeof run !== 'object' || !run.report || !Array.isArray(run.findings)) {
    throw new TypeError(
      'resolve: commitResolve() takes the run applyChangeRequest() or reoptimiseWholeSeason() returned'
    );
  }
  if (input?.acknowledged !== true) {
    throw new TypeError(
      'resolve: commitResolve() needs `acknowledged: true` — the literal, not a truthy value. Committing is the step that gives families a new time; it is not something a caller does by passing a default through'
    );
  }

  const accepted = [...new Set(input.acceptFindingCodes ?? [])].sort();

  const budget = run.report.budget;
  if (!budget.withinBudget) {
    throw new ChangeBudgetExceeded(
      `resolve: this re-solve moves ${budget.moved} game(s) and its change budget is ${budget.limit}. ` +
        `${budget.requested} of them were named by the request and ${budget.consequential} moved as a consequence, forced by ` +
        `${budget.blockingConstraintIds.join(', ') || 'no constraint this run can name'}. ` +
        'The budget has no override: raise it by name if you mean to move that many. Nothing has been committed.',
      {
        budget: budget.limit,
        moved: budget.moved,
        requested: budget.requested,
        consequential: budget.consequential,
        constraintIds: budget.blockingConstraintIds,
        constraintId: budget.blockingConstraintIds[0] ?? null,
        consequentialMoves: run.report.consequential,
      }
    );
  }

  const blocking = run.findings.filter(
    (finding) => finding.severity === FREEZE_SEVERITY.BLOCKING && !accepted.includes(finding.code)
  );
  if (blocking.length > 0) {
    const codes = [...new Set(blocking.map((finding) => finding.code))].sort();
    throw new Error(
      `resolve: this re-solve carries ${blocking.length} blocking finding(s) — ${codes.join(', ')} — and has NOT been committed. ` +
        'Accept them by code through `acceptFindingCodes` if they are decisions rather than faults; the codes you accept are recorded on the commit.'
    );
  }

  const unmeasured = run.findings.some(
    (finding) => finding.code === RESOLVE_REASON.RESOLVE_REPORT_QUALITY_UNMEASURED
  );
  if (unmeasured && !accepted.includes(RESOLVE_REASON.RESOLVE_REPORT_QUALITY_UNMEASURED)) {
    throw new Error(
      `resolve: the standing rule engine did not run over this re-solve, so its quality deltas are unknown rather than empty; accept ${RESOLVE_REASON.RESOLVE_REPORT_QUALITY_UNMEASURED} by name if you mean to commit a schedule nothing checked`
    );
  }

  return /** @type {import('./types.js').CommittedResolve} */ (
    Object.freeze({
      committed: true,
      name: run.name,
      schedule: run.schedule,
      baselineSchedule: run.baselineSchedule,
      moved: run.moved,
      unplaced: run.unplaced,
      report: run.report,
      acceptedFindingCodes: Object.freeze(accepted),
      committedBy: input.committedBy ?? null,
      run,
    })
  );
}
