/**
 * The error a frozen game raises when it cannot be satisfied.
 *
 * > *"A frozen game that cannot be satisfied must raise a clear error naming
 * > the game and the binding constraint. It must never be silently moved."*
 *
 * Everything in the message is **consumed, not re-derived**. The binding
 * constraint, the tightness ordering behind it and the slack in minutes come
 * from `availability/kickoff.js`'s `checkKickoffAvailability()` /
 * `orderByTightness()` — Phase 1.3 already answers "which of the four edges
 * binds, and by how much", and a second answer computed here would be free to
 * disagree with it. The rule-level violations come from `ruleEngine`'s
 * `runRuleEngine()`. This file formats; it does not decide.
 *
 * ## Why the counters are in the message
 *
 * *"Bound by occupancy and the permit"* is a different statement from *"bound
 * by occupancy and the permit, and those were the only two things checked"*.
 * The error therefore carries `constraintsConsulted`, `rulesRun` and
 * `rulesExercised`, and the message says how many of each applied out of how
 * many were asked. An operator reading a short list must be able to tell
 * "these two, because only two applied" from "these two, because only two were
 * looked at" — which is incident 4 wearing its most dangerous face, on the one
 * report a human acts on under time pressure.
 *
 * ## An unsatisfiable *thawed* game is a different thing entirely
 *
 * It becomes TIME TBD with a reason (`RESOLVE_GAME_TIME_TBD`, incident 10),
 * stays visible in the schedule, and raises nothing. The two are never
 * conflated: a thawed game with nowhere to go is a scheduling problem, and a
 * frozen game with nowhere to go is a contradiction between two things an
 * operator asserted.
 *
 * @module resolve/errors
 */

/**
 * Thrown when a frozen game's slot is not legal and it may not move.
 */
export class FrozenGameUnsatisfiable extends Error {
  /**
   * @param {string} message
   * @param {Object} detail
   */
  constructor(message, detail) {
    super(message);
    this.name = 'FrozenGameUnsatisfiable';
    /** @type {string} */
    this.gameId = detail.gameId;
    /** @type {string} */
    this.label = detail.label;
    /** @type {string} */
    this.stageId = detail.stageId;
    /** @type {string} */
    this.date = detail.date;
    /** @type {import('./types.js').Slot} */
    this.slot = detail.slot;
    /** @type {string|null} */
    this.heldByRuleId = detail.heldByRuleId;
    /** @type {Object|null} */
    this.binding = detail.binding;
    /** @type {string[]} */
    this.bindingKinds = detail.bindingKinds;
    /** @type {Array<Object>} */
    this.constraints = detail.constraints;
    /** @type {string[]} */
    this.blockingCodes = detail.blockingCodes;
    /** @type {Array<Object>} */
    this.blockingFindings = detail.blockingFindings;
    /** @type {string[]} */
    this.counterpartGameIds = detail.counterpartGameIds;
    /** @type {string[]} */
    this.constraintIds = detail.constraintIds;
    /** @type {string|null} */
    this.constraintId = detail.constraintId;
    /** @type {Array<Object>} */
    this.violations = detail.violations;
    /** @type {{ constraintsConsulted: number, constraintsApplicable: number, rulesRun: number, rulesExercised: number, violationsReported: number, verificationRan: boolean }} */
    this.meta = detail.meta;
  }
}

/**
 * Which registry constraints govern these reason codes.
 *
 * @param {import('../constraints/types.js').ConstraintRegistry} registry
 * @param {ReadonlyArray<string>} codes
 * @returns {string[]}
 */
function constraintIdsFor(registry, codes) {
  /** @type {Set<string>} */
  const ids = new Set();
  for (const code of codes) {
    for (const id of registry.idsByReasonCode[code] ?? []) ids.add(id);
  }
  return [...ids].sort();
}

/**
 * The violations a rule-engine run reports about one game.
 *
 * @param {Object|null} verification - a `runRuleEngine()` result
 * @param {string} gameId
 * @returns {Array<Object>}
 */
function violationsAbout(verification, gameId) {
  if (!verification) return [];
  return verification.violations.filter((violation) => {
    if (typeof violation.subjectId === 'string' && violation.subjectId.includes(gameId)) {
      return true;
    }
    if (violation.details && violation.details.gameId === gameId) return true;
    return (violation.entities ?? []).some(
      (entity) => entity.kind === 'game' && entity.id === gameId
    );
  });
}

/**
 * Build the error for one unsatisfiable frozen game.
 *
 * @param {Object} input
 * @param {import('./types.js').ResolveState} input.state
 * @param {string} input.gameId
 * @param {import('./types.js').Slot} input.slot
 * @param {ReturnType<import('./legality.js').checkPlacement>} input.placement
 * @param {import('../constraints/types.js').ConstraintRegistry} input.registry
 * @param {Object|null} input.verification - a `runRuleEngine()` result, or null
 * @param {string|null} input.ruleId - the freeze rule holding the game
 * @param {string} input.stageId
 * @returns {FrozenGameUnsatisfiable}
 */
export function frozenGameUnsatisfiable(input) {
  const { state, gameId, slot, placement, registry, verification, ruleId, stageId } = input;
  const game = state.baseline[gameId];
  const label = `${game.homeLabel} v ${game.awayLabel}`;
  const availability = /** @type {Object} */ (placement.availability);

  const constraints = availability.constraints ?? [];
  const applicable = constraints.filter((constraint) => constraint.applicable);
  const binding = availability.binding ?? null;
  const bindingKinds = availability.bindingKinds ?? [];
  const constraintIds = constraintIdsFor(registry, placement.blockingCodes);
  const violations = violationsAbout(verification, gameId);

  const rulesRun = verification?.meta?.rulesRun ?? 0;
  const rulesExercised = verification?.meta?.rulesExercised ?? 0;

  const heldBy = ruleId ? `freeze rule "${ruleId}"` : "the plan's frozen default";
  const bindingText =
    binding === null
      ? 'nothing this run holds bounds it, which means the block is a hard clash rather than a limit'
      : `${bindingKinds.join(' and ')} (limit minute ${binding.limitMinutes}, slack ${binding.slackMinutes} min)`;
  const constraintText =
    constraintIds.length === 0
      ? 'no registry constraint claims the codes it broke'
      : constraintIds.join(', ');

  const message =
    `resolve: frozen game "${gameId}" (${label}) cannot be satisfied on ${slot.date} at minute ` +
    `${slot.startMinutes} on ${slot.surfaceId}. It is held by ${heldBy}. ` +
    `Binding constraint: ${bindingText}. ` +
    `Registry constraint(s): ${constraintText}. ` +
    `Blocking reason code(s): ${placement.blockingCodes.join(', ') || 'none'}. ` +
    `${applicable.length} of ${constraints.length} availability constraints applied here, and ` +
    `${rulesExercised} of ${rulesRun} standing rules proved they examined data — so this list is ` +
    `what was checked, not everything that could be true. ` +
    `Stage "${stageId}" stopped rather than moving it: the game has NOT been moved.`;

  return new FrozenGameUnsatisfiable(message, {
    gameId,
    label,
    stageId,
    date: slot.date,
    slot,
    heldByRuleId: ruleId,
    binding,
    bindingKinds,
    constraints,
    blockingCodes: placement.blockingCodes,
    blockingFindings: placement.findings.filter((finding) =>
      placement.blockingCodes.includes(finding.code)
    ),
    counterpartGameIds: placement.counterpartGameIds,
    constraintIds,
    constraintId: constraintIds[0] ?? null,
    violations,
    meta: {
      constraintsConsulted: constraints.length,
      constraintsApplicable: applicable.length,
      rulesRun,
      rulesExercised,
      violationsReported: violations.length,
      verificationRan: verification !== null,
    },
  });
}
