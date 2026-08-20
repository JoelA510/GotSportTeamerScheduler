/**
 * Machine-readable reason codes for the change-request re-solver.
 *
 * Same two rules as the six modules before it:
 *
 * 1. **`code` is the contract, `message` is decoration.** Never parse a message.
 * 2. **Severity lives in a table, never at a call site.**
 *
 * Severities and statuses come from `freeze/reasonCodes.js`, which takes them
 * from `constraints/reasonCodes.js`, which takes them from the facility module.
 * A resolve finding therefore lands in the same list as a facility one and
 * {@link deriveResolveStatus} reads nothing but `finding.severity`.
 *
 * @module resolve/reasonCodes
 */

import { FREEZE_SEVERITY, FREEZE_STATUS, deriveFreezeStatus } from '../freeze/reasonCodes.js';

/**
 * How badly a finding counts.
 *
 * @readonly
 * @enum {string}
 */
export const RESOLVE_SEVERITY = FREEZE_SEVERITY;

/**
 * The three-state outcome of a resolve run.
 *
 * @readonly
 * @enum {string}
 */
export const RESOLVE_STATUS = FREEZE_STATUS;

/**
 * Every reason the re-solver can give.
 *
 * @readonly
 * @enum {string}
 */
export const RESOLVE_REASON = Object.freeze({
  /* -- the run itself -------------------------------------------------------- */
  /**
   * The run had no games, or a change request had no changes.
   *
   * `blocking`. Incident 4: a run that examined nothing must never read as a
   * run that found nothing wrong.
   */
  RESOLVE_RUN_VACUOUS: 'RESOLVE_RUN_VACUOUS',
  /**
   * The whole run considered **zero** moves.
   *
   * `compromise`. Distinct from `RESOLVE_RUN_VACUOUS`: the run had games and
   * changes and still never asked the freeze a single question, which means the
   * "no frozen game moved" verdict below it is worth nothing.
   */
  RESOLVE_NOTHING_CONSIDERED: 'RESOLVE_NOTHING_CONSIDERED',

  /* -- the change request ---------------------------------------------------- */
  /** The change names a game the baseline does not hold. `blocking`. */
  RESOLVE_CHANGE_UNKNOWN_GAME: 'RESOLVE_CHANGE_UNKNOWN_GAME',
  /** The change asks for the slot the game already occupies. Provenance. */
  RESOLVE_CHANGE_NO_OP: 'RESOLVE_CHANGE_NO_OP',
  /** The change was applied exactly as asked. Provenance. */
  RESOLVE_CHANGE_APPLIED: 'RESOLVE_CHANGE_APPLIED',
  /**
   * The change names a game the plan freezes.
   *
   * `blocking`, and the correct answer rather than a fault: an operator who
   * froze `9v9 on 08/22` and then asked to move a 9v9 game on 08/22 has asked
   * for two contradictory things, and the resolver refuses rather than choosing
   * for them.
   */
  RESOLVE_CHANGE_REFUSED_FROZEN: 'RESOLVE_CHANGE_REFUSED_FROZEN',
  /**
   * The requested slot is not legal and the game was placed elsewhere.
   *
   * `compromise`. This is incident 3's actual resolution, made mechanical: the
   * external league's published 12:30 could not stand beside a frozen 9v9
   * block, so the fixture went to the nearest slot the schedule already used —
   * 12:00, thirty minutes earlier, which is exactly what the humans negotiated.
   */
  RESOLVE_CHANGE_DISPLACED: 'RESOLVE_CHANGE_DISPLACED',
  /**
   * A change asked for a slot the baseline schedule never used.
   *
   * Provenance, and deliberately allowed: an externally-published fixture
   * brings its own time and the club does not get to invent one for it. It is
   * recorded because every *other* slot in this run comes from the baseline's
   * own inventory, and the one exception should be visible.
   */
  RESOLVE_CHANGE_SLOT_OUTSIDE_INVENTORY: 'RESOLVE_CHANGE_SLOT_OUTSIDE_INVENTORY',
  /**
   * The games a change request moved were pinned at the slots it named.
   *
   * Provenance for `holdChanges`. The right setting for an externally-published
   * fixture: the request states a fact rather than a preference, so a slot the
   * fact cannot occupy becomes a contradiction to raise rather than a request
   * to quietly reinterpret.
   */
  RESOLVE_CHANGE_PINNED: 'RESOLVE_CHANGE_PINNED',

  /* -- placement ------------------------------------------------------------- */
  /** A thawed game was lifted out of a slot that stopped being legal. */
  RESOLVE_GAME_DISLODGED: 'RESOLVE_GAME_DISLODGED',
  /** A dislodged game found a slot. Provenance. */
  RESOLVE_GAME_REPLACED: 'RESOLVE_GAME_REPLACED',
  /**
   * A thawed game has no legal slot left and is carried as TIME TBD.
   *
   * `compromise`, never silence. Incident 10: one fixture in a reduced-venue
   * scenario genuinely had nowhere to go, and it stayed visible with a reason
   * rather than being dropped.
   */
  RESOLVE_GAME_TIME_TBD: 'RESOLVE_GAME_TIME_TBD',
  /**
   * A **frozen** game's slot is not legal and it may not move.
   *
   * `blocking`, and never conflated with `RESOLVE_GAME_TIME_TBD`. A thawed
   * game with nowhere to go is a scheduling problem; a frozen game with nowhere
   * to go is a contradiction between two things an operator asserted, and it
   * accompanies a thrown `FrozenGameUnsatisfiable` unless the caller asked for
   * it to be reported instead.
   */
  RESOLVE_FROZEN_GAME_UNSATISFIABLE: 'RESOLVE_FROZEN_GAME_UNSATISFIABLE',
  /**
   * A stage tried to place a game on a slot the baseline never used.
   *
   * `blocking`. The anti-third-solver guard at the chokepoint: this package
   * re-places existing games onto kickoffs and surfaces the schedule already
   * had, and a slot from anywhere else means something in here started
   * inventing.
   */
  RESOLVE_SLOT_OUTSIDE_INVENTORY: 'RESOLVE_SLOT_OUTSIDE_INVENTORY',

  /* -- verification ---------------------------------------------------------- */
  /**
   * The standing rule engine reports a violation on the resolved schedule that
   * the baseline did not carry.
   *
   * `compromise`. The resolver repairs *facility legality* — occupancy,
   * permits, lighting, daylight, size, lining. Turnover floors, round-robin
   * completeness and coach travel are the rule engine's, and a change that
   * breaks one of them is reported here rather than quietly repaired: repairing
   * a soft constraint needs the weighted objective Prompt 4.2 owns.
   */
  RESOLVE_VERIFY_NEW_VIOLATION: 'RESOLVE_VERIFY_NEW_VIOLATION',

  /* -- the audit ------------------------------------------------------------- */
  /**
   * A frozen game's placement differs from the baseline's.
   *
   * `blocking`, and this is the code the whole prompt exists to make
   * unreachable. It is derived by comparing the **final schedule against the
   * baseline**, game by game, and never from the move ledger — a stage that
   * wrote around the gate would not be in the ledger, which is precisely the
   * case this must catch.
   */
  RESOLVE_AUDIT_FROZEN_GAME_MOVED: 'RESOLVE_AUDIT_FROZEN_GAME_MOVED',
  /**
   * A stage changed a placement without a matching entry in the move ledger.
   *
   * `blocking`. Deep-freezing the state stops a stage mutating it in place; it
   * does not stop one returning a state it built itself. This is the check that
   * does.
   */
  RESOLVE_AUDIT_STAGE_BYPASSED_GATE: 'RESOLVE_AUDIT_STAGE_BYPASSED_GATE',
  /**
   * A stage that declared no mutation kinds wrote anyway. `blocking`.
   */
  RESOLVE_AUDIT_STAGE_WROTE_WITHOUT_DECLARING: 'RESOLVE_AUDIT_STAGE_WROTE_WITHOUT_DECLARING',
  /**
   * The audit examined zero games.
   *
   * `blocking`. An audit that looked at nothing reporting "no frozen game
   * moved" is incident 4 guarding incident 1, which would be the worst of both.
   */
  RESOLVE_AUDIT_VACUOUS: 'RESOLVE_AUDIT_VACUOUS',
});

/**
 * Severity of every reason code.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const RESOLVE_REASON_SEVERITY = Object.freeze({
  [RESOLVE_REASON.RESOLVE_RUN_VACUOUS]: RESOLVE_SEVERITY.BLOCKING,
  [RESOLVE_REASON.RESOLVE_NOTHING_CONSIDERED]: RESOLVE_SEVERITY.COMPROMISE,

  [RESOLVE_REASON.RESOLVE_CHANGE_UNKNOWN_GAME]: RESOLVE_SEVERITY.BLOCKING,
  [RESOLVE_REASON.RESOLVE_CHANGE_NO_OP]: RESOLVE_SEVERITY.INFO,
  [RESOLVE_REASON.RESOLVE_CHANGE_APPLIED]: RESOLVE_SEVERITY.INFO,
  [RESOLVE_REASON.RESOLVE_CHANGE_REFUSED_FROZEN]: RESOLVE_SEVERITY.BLOCKING,
  [RESOLVE_REASON.RESOLVE_CHANGE_DISPLACED]: RESOLVE_SEVERITY.COMPROMISE,
  [RESOLVE_REASON.RESOLVE_CHANGE_SLOT_OUTSIDE_INVENTORY]: RESOLVE_SEVERITY.INFO,
  [RESOLVE_REASON.RESOLVE_CHANGE_PINNED]: RESOLVE_SEVERITY.INFO,

  [RESOLVE_REASON.RESOLVE_GAME_DISLODGED]: RESOLVE_SEVERITY.INFO,
  [RESOLVE_REASON.RESOLVE_GAME_REPLACED]: RESOLVE_SEVERITY.INFO,
  [RESOLVE_REASON.RESOLVE_GAME_TIME_TBD]: RESOLVE_SEVERITY.COMPROMISE,
  [RESOLVE_REASON.RESOLVE_FROZEN_GAME_UNSATISFIABLE]: RESOLVE_SEVERITY.BLOCKING,
  [RESOLVE_REASON.RESOLVE_SLOT_OUTSIDE_INVENTORY]: RESOLVE_SEVERITY.BLOCKING,

  [RESOLVE_REASON.RESOLVE_VERIFY_NEW_VIOLATION]: RESOLVE_SEVERITY.COMPROMISE,

  [RESOLVE_REASON.RESOLVE_AUDIT_FROZEN_GAME_MOVED]: RESOLVE_SEVERITY.BLOCKING,
  [RESOLVE_REASON.RESOLVE_AUDIT_STAGE_BYPASSED_GATE]: RESOLVE_SEVERITY.BLOCKING,
  [RESOLVE_REASON.RESOLVE_AUDIT_STAGE_WROTE_WITHOUT_DECLARING]: RESOLVE_SEVERITY.BLOCKING,
  [RESOLVE_REASON.RESOLVE_AUDIT_VACUOUS]: RESOLVE_SEVERITY.BLOCKING,
});

/**
 * Severity of a resolve reason code.
 *
 * Throws on an unknown code rather than defaulting to `info`.
 *
 * @param {string} code - a {@link RESOLVE_REASON} value
 * @returns {string} a {@link RESOLVE_SEVERITY} value
 */
export function resolveSeverityOf(code) {
  const severity = RESOLVE_REASON_SEVERITY[code];
  if (!severity) {
    throw new Error(`resolve: reason code "${code}" has no registered severity`);
  }
  return severity;
}

/**
 * Build a resolve finding. `severity` is looked up, never passed in.
 *
 * @param {string} code - a {@link RESOLVE_REASON} value
 * @param {string} message - for humans only
 * @param {Record<string, unknown>} [details] - flat primitives and ids only
 * @returns {import('../freeze/types.js').FreezeFinding}
 */
export function makeResolveFinding(code, message, details = {}) {
  return { code, severity: resolveSeverityOf(code), message, details };
}

/**
 * Derive the status of a run mechanically from its findings.
 *
 * @param {ReadonlyArray<import('../freeze/types.js').FreezeFinding>} findings
 * @returns {string} a {@link RESOLVE_STATUS} value
 */
export function deriveResolveStatus(findings) {
  return deriveFreezeStatus(findings);
}

/**
 * Fresh zeroed counters.
 *
 * `movesRejectedByFreeze` is the one that matters most. Every per-stage probe
 * asserts it grew: without it a probe passes just as happily against a stage
 * that never looked at the freeze as against one that honoured it.
 *
 * @returns {import('./types.js').ResolveMeta}
 */
export function createResolveMeta() {
  return {
    gamesExamined: 0,
    freezeJudgements: 0,
    stagesRegistered: 0,
    stagesRun: 0,
    movesConsidered: 0,
    movesRejectedByFreeze: 0,
    movesApplied: 0,
    candidatesEvaluated: 0,
    candidatesRejected: 0,
    conflictsExamined: 0,
    gamesDislodged: 0,
    gamesReplaced: 0,
    gamesTimeTbd: 0,
    gamesAudited: 0,
    rulesRun: 0,
    rulesExercised: 0,
    constraintsConsulted: 0,
    slotsAvailable: 0,
  };
}

/**
 * Add one counter set into another, in place.
 *
 * @param {import('./types.js').ResolveMeta} target
 * @param {import('./types.js').ResolveMeta} source
 * @returns {import('./types.js').ResolveMeta}
 */
export function mergeResolveMeta(target, source) {
  for (const key of Object.keys(target)) {
    target[key] += source[key] ?? 0;
  }
  return target;
}
