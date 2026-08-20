/**
 * Machine-readable reason codes for every freeze decision, the freeze scope
 * vocabulary with its specificity ranks, and the frozen severity table behind
 * both.
 *
 * Same two rules as `facility/reasonCodes.js`, `timing/reasonCodes.js`,
 * `availability/reasonCodes.js`, `constraints/reasonCodes.js`,
 * `waivers/reasonCodes.js` and `ruleEngine/reasonCodes.js`:
 *
 * 1. **`code` is the contract, `message` is decoration.** Never parse a message.
 * 2. **Severity lives in a table, never at a call site.**
 *
 * Severities and statuses are *imported* from `constraints/reasonCodes.js`
 * (which imports them from the facility module) rather than redeclared, so a
 * freeze finding lands in the same list as a facility one and
 * {@link deriveFreezeStatus} reads nothing but `finding.severity`.
 *
 * ## The one deliberate inversion in this module
 *
 * A waiver that cannot be judged is **not applied** — see
 * `waivers/scope.js` step 2. A freeze that cannot be judged **is**: an unjudged
 * freeze resolves to `frozen`. The two modules are not inconsistent; the safe
 * direction differs. The safe answer to "I cannot tell whether this exception
 * covers you" is *don't excuse it*. The safe answer to "I cannot tell whether
 * this game is held" is *don't move it* — incident 1 is 366 games that moved
 * because nothing said they must not. Both defaults refuse to act on an
 * unanswered question; they just point opposite ways because the action does.
 *
 * @module freeze/reasonCodes
 */

import {
  CONSTRAINT_SCOPE_SPECIFICITY,
  CONSTRAINT_SEVERITY,
  CONSTRAINT_STATUS,
  deriveConstraintStatus,
} from '../constraints/reasonCodes.js';

/**
 * How badly a finding counts. Re-exported so the seven vocabularies cannot
 * drift apart.
 *
 * @readonly
 * @enum {string}
 */
export const FREEZE_SEVERITY = CONSTRAINT_SEVERITY;

/**
 * The three-state outcome of any freeze check.
 *
 * @readonly
 * @enum {string}
 */
export const FREEZE_STATUS = CONSTRAINT_STATUS;

/**
 * What a freeze judgement can conclude about one game.
 *
 * Two states, not three. "Unjudged" is not a disposition — it is a *finding*
 * attached to a judgement that still resolves to `frozen`, because a solver
 * cannot act on a third answer and the only safe reading of "I could not tell"
 * is "leave it alone".
 *
 * @readonly
 * @enum {string}
 */
export const FREEZE_DISPOSITION = Object.freeze({
  /** Held. No stage may move it. */
  FROZEN: 'frozen',
  /** Free to move, at the hold rule's discretion. */
  THAWED: 'thawed',
});

/**
 * The two kinds of rule a plan can carry.
 *
 * `thaw` is the exception form, and it is why this module does not simply reuse
 * `ConstraintScope`: a constraint scope expresses precedence between records
 * that all *say* something, while a freeze plan expresses set membership with
 * carve-outs — "everything, except 9v9 on 08/22".
 *
 * @readonly
 * @enum {string}
 */
export const FREEZE_RULE_KIND = Object.freeze({
  FREEZE: 'freeze',
  THAW: 'thaw',
});

/**
 * The dimensions a freeze match can name, all composable inside one `match` as
 * a conjunction.
 *
 * The build plan's list is `date, date-range, division, venue, field, team,
 * individual game`; `format` is the eighth because the plan's own worked
 * example — *"freeze everything except 9v9 on 08/22"* — cannot be expressed
 * without it. `field` is this codebase's `surface`, for the reason
 * `constraints/reasonCodes.js` gives: a second name for one concept is exactly
 * the drift `docs/ARCHITECTURE.md` §1.1 documents.
 *
 * @readonly
 * @enum {string}
 */
export const FREEZE_SCOPE_DIMENSION = Object.freeze({
  DATE: 'date',
  DATE_RANGE: 'date-range',
  DIVISION: 'division',
  VENUE: 'venue',
  /** The build plan's "field". Matched against a surface's **lineage**. */
  SURFACE: 'surface',
  FORMAT: 'format',
  /** Matched against **either** side of a game. */
  TEAM: 'team',
  GAME: 'game',
});

/**
 * The specificity rank of each dimension. **Higher is narrower.**
 *
 * The integers are deliberately the ones `CONSTRAINT_SCOPE_SPECIFICITY` and
 * `WAIVER_SCOPE_SPECIFICITY` already use, and they are asserted equal in
 * `tests/freezeScopes.test.js` rather than copied and hoped over. That is what
 * makes "this thaw is broader than the freeze it carves out of" a meaningful
 * comparison rather than a coincidence of two private scales.
 *
 * `format` is the one rank this table adds. It sits at 2 alongside `division`
 * for the same reason `division` does: it names a class of games that spans
 * every date and every venue, and no ordering against a date or a venue exists.
 *
 * @type {Readonly<Record<string, number>>}
 */
export const FREEZE_SCOPE_SPECIFICITY = Object.freeze({
  [FREEZE_SCOPE_DIMENSION.DATE_RANGE]: CONSTRAINT_SCOPE_SPECIFICITY['date-range'],
  [FREEZE_SCOPE_DIMENSION.DATE]: CONSTRAINT_SCOPE_SPECIFICITY.date,
  [FREEZE_SCOPE_DIMENSION.DIVISION]: CONSTRAINT_SCOPE_SPECIFICITY.division,
  [FREEZE_SCOPE_DIMENSION.VENUE]: CONSTRAINT_SCOPE_SPECIFICITY.venue,
  [FREEZE_SCOPE_DIMENSION.FORMAT]: CONSTRAINT_SCOPE_SPECIFICITY.division,
  [FREEZE_SCOPE_DIMENSION.SURFACE]: CONSTRAINT_SCOPE_SPECIFICITY.surface,
  [FREEZE_SCOPE_DIMENSION.TEAM]: CONSTRAINT_SCOPE_SPECIFICITY.team,
  [FREEZE_SCOPE_DIMENSION.GAME]: CONSTRAINT_SCOPE_SPECIFICITY.person,
});

/**
 * Every reason a freeze check can give.
 *
 * @readonly
 * @enum {string}
 */
export const FREEZE_REASON = Object.freeze({
  /* -- building a plan ------------------------------------------------------ */
  /**
   * The plan defaults every game to `thawed`. **Blocking**, always, and it is
   * the single most important entry in this table.
   *
   * A global re-solve is a legitimate operation and this code does not forbid
   * it — it makes it impossible for one to produce a clean report. Incident 1
   * is a run that came back valid while half a season had silently moved; an
   * operator who reads "allowed" after a global re-optimisation has been
   * misled by the report, not by the solver.
   */
  FREEZE_GLOBAL_REOPTIMISATION: 'FREEZE_GLOBAL_REOPTIMISATION',
  /**
   * A `thaw` rule is broader than the freeze it carves out of — its narrowest
   * dimension is no narrower than the plan's own default reach.
   *
   * `compromise`, and the direct analogue of `WAIVER_BROADER_THAN_CONSTRAINT`:
   * an exception broader than its rule is a repeal wearing an exception's
   * clothes. It is still applied, because the operator wrote it down; nobody
   * gets to be surprised by it later.
   */
  FREEZE_THAW_BROADER_THAN_FREEZE: 'FREEZE_THAW_BROADER_THAN_FREEZE',
  /**
   * A `freeze` and a `thaw` in the same plan narrow to the **same** rank, so
   * any game both reach will be held and reported ambiguous.
   *
   * `compromise`, and it is emitted at **build time** rather than once per
   * affected game. The specificity ranks are deliberately shared with the
   * constraint and waiver models, and that sharing flattens genuinely different
   * kinds of narrowness onto one integer — `surface`, `team` and `game` all sit
   * at 3, so "freeze Pitch 1 except this one game" is a tie rather than a
   * narrowing. That is a real limitation of the shared scale and it is stated
   * here, once, where an operator can act on it, instead of surfacing as a
   * blocking surprise on every game later.
   */
  FREEZE_THAW_TIES_FREEZE: 'FREEZE_THAW_TIES_FREEZE',
  /**
   * A rule in the plan matched **no game at all** in this run.
   *
   * `compromise`. Incident 4 at the level of the freeze plan: an operator who
   * froze `Pitch 5` on a season that has no Pitch 5 believes they protected
   * something. A rule that matched nothing protected nothing, and the run says
   * so rather than reporting a tidy "all frozen".
   */
  FREEZE_RULE_MATCHED_NOTHING: 'FREEZE_RULE_MATCHED_NOTHING',

  /* -- judging one game ------------------------------------------------------ */
  /**
   * A rule names a dimension the game does not carry — a division-scoped rule
   * against a Minis session whose rows name no division.
   *
   * `compromise`, and the judgement still resolves to `frozen`. See this
   * module's docstring for why that is the opposite of the waiver module's
   * answer and why both are right.
   */
  FREEZE_SCOPE_UNJUDGED: 'FREEZE_SCOPE_UNJUDGED',
  /**
   * A `freeze` and a `thaw` match the same game at the same specificity.
   *
   * `blocking`. The plan is genuinely contradictory and no reading of it is
   * more correct than the other; the game resolves **frozen** and the run can
   * never come back clean until an operator narrows one of the two rules.
   */
  FREEZE_AMBIGUOUS_DISPOSITION: 'FREEZE_AMBIGUOUS_DISPOSITION',
  /** A narrower rule beat a broader one. Provenance. */
  FREEZE_NARROWER_APPLIED: 'FREEZE_NARROWER_APPLIED',
  /** No rule matched, so the plan's default decided. Provenance. */
  FREEZE_DEFAULT_APPLIED: 'FREEZE_DEFAULT_APPLIED',
  /**
   * A rule matched on a division **label**. GAP-24: division labels are not a
   * key — `16GSelect02` appears under `U16G` and `16GS` in the same corpus — so
   * a label match is a best effort and says so.
   */
  FREEZE_DIVISION_LABEL_MATCH: 'FREEZE_DIVISION_LABEL_MATCH',

  /* -- the mutation chokepoint ---------------------------------------------- */
  /**
   * A stage asked whether it could move a frozen game and was told no.
   *
   * `info`: this is the machinery working. It is also the counter that gives
   * every per-stage probe its teeth — a probe that only asserts "nothing moved"
   * passes just as happily against a stage that never looked.
   */
  FREEZE_MOVE_REFUSED: 'FREEZE_MOVE_REFUSED',
  /**
   * A stage reached the one writer with a frozen game in hand, without asking
   * first.
   *
   * `blocking`, and it accompanies a thrown `FrozenGameMoveAttempt`. Incident 2
   * is exactly this: the initial assignment honoured the freeze and the
   * local-search and pair-repair stages did not, and four frozen games were
   * quietly swapped.
   */
  FREEZE_MOVE_ATTEMPTED: 'FREEZE_MOVE_ATTEMPTED',
});

/**
 * Severity of every reason code.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const FREEZE_REASON_SEVERITY = Object.freeze({
  [FREEZE_REASON.FREEZE_GLOBAL_REOPTIMISATION]: FREEZE_SEVERITY.BLOCKING,
  [FREEZE_REASON.FREEZE_THAW_BROADER_THAN_FREEZE]: FREEZE_SEVERITY.COMPROMISE,
  [FREEZE_REASON.FREEZE_THAW_TIES_FREEZE]: FREEZE_SEVERITY.COMPROMISE,
  [FREEZE_REASON.FREEZE_RULE_MATCHED_NOTHING]: FREEZE_SEVERITY.COMPROMISE,

  [FREEZE_REASON.FREEZE_SCOPE_UNJUDGED]: FREEZE_SEVERITY.COMPROMISE,
  [FREEZE_REASON.FREEZE_AMBIGUOUS_DISPOSITION]: FREEZE_SEVERITY.BLOCKING,
  [FREEZE_REASON.FREEZE_NARROWER_APPLIED]: FREEZE_SEVERITY.INFO,
  [FREEZE_REASON.FREEZE_DEFAULT_APPLIED]: FREEZE_SEVERITY.INFO,
  [FREEZE_REASON.FREEZE_DIVISION_LABEL_MATCH]: FREEZE_SEVERITY.INFO,

  [FREEZE_REASON.FREEZE_MOVE_REFUSED]: FREEZE_SEVERITY.INFO,
  [FREEZE_REASON.FREEZE_MOVE_ATTEMPTED]: FREEZE_SEVERITY.BLOCKING,
});

/**
 * Severity of a freeze reason code.
 *
 * Throws on an unknown code rather than defaulting to `info`, for the same
 * reason every sibling module's lookup does: a code with no severity is a code
 * somebody forgot to register, and defaulting would make it silently
 * non-blocking.
 *
 * @param {string} code - a {@link FREEZE_REASON} value
 * @returns {string} a {@link FREEZE_SEVERITY} value
 */
export function freezeSeverityOf(code) {
  const severity = FREEZE_REASON_SEVERITY[code];
  if (!severity) {
    throw new Error(`freeze: reason code "${code}" has no registered severity`);
  }
  return severity;
}

/**
 * The specificity rank of a freeze scope dimension. Higher is narrower.
 *
 * @param {string} dimension - a {@link FREEZE_SCOPE_DIMENSION} value
 * @returns {number}
 */
export function freezeSpecificityOf(dimension) {
  const rank = FREEZE_SCOPE_SPECIFICITY[dimension];
  if (rank === undefined) {
    throw new Error(`freeze: scope dimension "${dimension}" has no registered specificity`);
  }
  return rank;
}

/**
 * Build a freeze finding. `severity` is looked up, never passed in.
 *
 * @param {string} code - a {@link FREEZE_REASON} value
 * @param {string} message - for humans only
 * @param {Record<string, unknown>} [details] - flat primitives and ids only
 * @returns {import('./types.js').FreezeFinding}
 */
export function makeFreezeFinding(code, message, details = {}) {
  return { code, severity: freezeSeverityOf(code), message, details };
}

/**
 * Derive the status of a check mechanically from its findings.
 *
 * @param {ReadonlyArray<import('./types.js').FreezeFinding>} findings
 * @returns {string} a {@link FREEZE_STATUS} value
 */
export function deriveFreezeStatus(findings) {
  return deriveConstraintStatus(
    /** @type {ReadonlyArray<import('../constraints/types.js').ConstraintFinding>} */ (findings)
  );
}

/**
 * Fresh zeroed counters.
 *
 * Incident 4 in `fixtures/season-2026/README.md` is a validator that matched
 * zero records and reported a perfect score. Every result in this module
 * carries these so a test can assert the judgement was not vacuous.
 *
 * @returns {import('./types.js').FreezeMeta}
 */
export function createFreezeMeta() {
  return {
    gamesJudged: 0,
    rulesTested: 0,
    dimensionsTested: 0,
    frozenGames: 0,
    thawedGames: 0,
    unjudgedDimensions: 0,
    ambiguitiesReported: 0,
    rulesThatMatchedSomething: 0,
    rulesThatMatchedNothing: 0,
  };
}

/**
 * Add one counter set into another, in place.
 *
 * @param {import('./types.js').FreezeMeta} target
 * @param {import('./types.js').FreezeMeta} source
 * @returns {import('./types.js').FreezeMeta}
 */
export function mergeFreezeMeta(target, source) {
  for (const key of Object.keys(target)) {
    target[key] += source[key] ?? 0;
  }
  return target;
}
