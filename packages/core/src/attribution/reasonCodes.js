/**
 * Machine-readable reason codes for the explain-why layer, the sources a claim
 * can come from, and the four questions this module answers in one call.
 *
 * Same two rules as the eight modules before it:
 *
 * 1. **`code` is the contract, `message` is decoration.** Never parse a message.
 * 2. **Severity lives in a table, never at a call site.**
 *
 * Severities and statuses come from `constraints/reasonCodes.js`, which takes
 * them from the facility module. An attribution finding therefore lands in the
 * same list as a facility, timing, availability, waiver, rule or resolve one,
 * and {@link deriveAttributionStatus} reads nothing but `finding.severity`.
 *
 * ## What the status of an attribution means
 *
 * It is the status of **the answer**, not of the game the answer is about. A
 * game that is illegal where it stands gets a perfectly good attribution saying
 * so, and that attribution's status is `allowed`; an attribution whose status is
 * `rejected` is one this module could not build honestly — a claim that names a
 * category rather than an instance, a game the schedule does not hold, a sweep
 * that examined nothing. The subject's own verdict travels beside it as
 * `placementStatus`, and the two are never conflated.
 *
 * @module attribution/reasonCodes
 */

import { AVAILABILITY_CONSTRAINT, AVAILABILITY_REASON } from '../availability/reasonCodes.js';
import {
  CONSTRAINT_SEVERITY,
  CONSTRAINT_STATUS,
  deriveConstraintStatus,
} from '../constraints/reasonCodes.js';
import { FACILITY_REASON } from '../facility/reasonCodes.js';

/**
 * How badly a finding counts against an answer.
 *
 * @readonly
 * @enum {string}
 */
export const ATTRIBUTION_SEVERITY = CONSTRAINT_SEVERITY;

/**
 * The three-state outcome of an attribution.
 *
 * @readonly
 * @enum {string}
 */
export const ATTRIBUTION_STATUS = CONSTRAINT_STATUS;

/**
 * Which machinery decided a claim.
 *
 * This is provenance and it is load bearing: every claim this module reports was
 * computed somewhere else, and the source says where to go and argue with it.
 * There is deliberately no `attribution` member — a claim this module derived
 * itself would be a second answer to a question that already has an owner.
 *
 * @readonly
 * @enum {string}
 */
export const ATTRIBUTION_SOURCE = Object.freeze({
  /** `availability/kickoff.js` — the four edges, ordered by tightness. */
  AVAILABILITY: 'availability',
  /** `facility/` — surface, size, lining, equipment, concurrency. */
  FACILITY: 'facility',
  /** `ruleEngine/engine.js` — a structured `RuleViolation`. */
  RULE_ENGINE: 'rule-engine',
  /** `waivers/coachTravel.js` — one transition on one person's day. */
  COACH_TRAVEL: 'coach-travel',
  /** `people/roster.js` — who else could have covered, and who could not. */
  ROSTER: 'roster',
  /** `timing/warmup.js` — warm-up as occupancy (incident 8). */
  WARMUP: 'warmup',
});

/**
 * Declared order of the sources.
 *
 * Claims are reported **ordered by tightness**, not by this list. This is only
 * the deterministic tie-break for claims whose owners reported the same slack,
 * so two runs over the same data produce the same ordering — the same contract
 * `AVAILABILITY_CONSTRAINT_ORDER` keeps one layer down.
 *
 * @type {ReadonlyArray<string>}
 */
export const ATTRIBUTION_SOURCE_ORDER = Object.freeze([
  ATTRIBUTION_SOURCE.AVAILABILITY,
  ATTRIBUTION_SOURCE.FACILITY,
  ATTRIBUTION_SOURCE.WARMUP,
  ATTRIBUTION_SOURCE.COACH_TRAVEL,
  ATTRIBUTION_SOURCE.RULE_ENGINE,
  ATTRIBUTION_SOURCE.ROSTER,
]);

/**
 * The four questions the build plan names, as ids rather than as prose.
 *
 * @readonly
 * @enum {string}
 */
export const ATTRIBUTION_QUESTION = Object.freeze({
  /** *"Why is this game at 12:00 and not 12:30?"* */
  WHY_THIS_TIME: 'why-this-time',
  /** *"What's the earliest kickoff allowing a full 30-minute warm-up?"* */
  EARLIEST_KICKOFF: 'earliest-kickoff-with-warmup',
  /** *"Why did this team get a conflict?"* */
  TEAM_CONFLICT: 'why-this-conflict',
  /** *"Why can't this game go later?"* */
  WHY_NOT_LATER: 'why-not-later',
});

/**
 * Which reason codes speak about each of the four constraint kinds.
 *
 * Two jobs, both of which need the same table:
 *
 * 1. **Naming the registry constraint behind a bound.** A bound that has not
 *    been broken carries no reason code — "the permit closes at 20:00 and you
 *    have 150 minutes of slack" is not a finding — so a claim built from a bound
 *    has nothing to look up in `registry.idsByReasonCode` and would be unable to
 *    name the constraint that governs it.
 * 2. **Attaching a finding to the bound it is about**, so one constraint
 *    instance produces one claim rather than a bound and a violation reported as
 *    two unrelated things.
 *
 * It maps kinds to **codes**, never to constraint ids: which constraint claims a
 * code is the registry's answer and stays the registry's answer. A code listed
 * here that no constraint claims simply contributes no id.
 *
 * `tests/attribution.test.js` asserts every kind has an entry, that every code
 * listed is a real reason code of the module that owns it, and that every
 * availability code the season-2026 registry governs appears in exactly one
 * bucket.
 *
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const ATTRIBUTION_CODES_BY_CONSTRAINT_KIND = Object.freeze({
  [AVAILABILITY_CONSTRAINT.OCCUPANCY]: Object.freeze([
    FACILITY_REASON.OCCUPIED_SAME_SURFACE,
    FACILITY_REASON.OCCUPIED_PARENT_CHILD,
    FACILITY_REASON.OCCUPIED_SPATIAL_OVERLAP,
  ]),
  [AVAILABILITY_CONSTRAINT.LIGHTING]: Object.freeze([AVAILABILITY_REASON.LIGHTS_OFF_EXCEEDED]),
  [AVAILABILITY_CONSTRAINT.SUNSET]: Object.freeze([AVAILABILITY_REASON.SUNSET_MARGIN_VIOLATED]),
  [AVAILABILITY_CONSTRAINT.PERMIT]: Object.freeze([
    AVAILABILITY_REASON.PERMIT_OPEN_PRECEDED,
    AVAILABILITY_REASON.PERMIT_CLOSE_EXCEEDED,
    AVAILABILITY_REASON.PERMIT_BLACKOUT,
    AVAILABILITY_REASON.PERMIT_MARGIN_TIGHT,
  ]),
});

/**
 * Every reason an attribution can give **about itself**.
 *
 * None of these is a scheduling verdict. The verdicts belong to the modules the
 * claims come from; these say whether the answer built out of them can be
 * trusted.
 *
 * @readonly
 * @enum {string}
 */
export const ATTRIBUTION_REASON = Object.freeze({
  /* -- the answer's own integrity ------------------------------------------- */
  /**
   * A claim names a category and nothing else — `sunset`, with no record, no
   * limit and no slack.
   *
   * `blocking`, and the reason this module exists: *"sunset"* is the answer that
   * made somebody derive the real one by hand. A claim that cannot name an
   * instance or carry a computed value is worse than no claim, because it reads
   * like an answer.
   */
  ATTRIBUTION_CLAIM_CATEGORY_ONLY: 'ATTRIBUTION_CLAIM_CATEGORY_ONLY',
  /**
   * A game reached the end of the sweep with no claim at all.
   *
   * `blocking`. A sweep that quietly skips the rows it cannot explain is
   * incident 4 with better manners.
   */
  ATTRIBUTION_GAME_UNATTRIBUTED: 'ATTRIBUTION_GAME_UNATTRIBUTED',
  /**
   * The sweep examined zero games.
   *
   * `blocking`. "Every game is attributed" is a true statement about an empty
   * schedule and means nothing.
   */
  ATTRIBUTION_SWEEP_VACUOUS: 'ATTRIBUTION_SWEEP_VACUOUS',
  /** The question named a game the schedule does not hold. `blocking`. */
  ATTRIBUTION_GAME_UNKNOWN: 'ATTRIBUTION_GAME_UNKNOWN',
  /** The question named a team no commitment in this run belongs to. `blocking`. */
  ATTRIBUTION_TEAM_UNKNOWN: 'ATTRIBUTION_TEAM_UNKNOWN',

  /* -- what the answer was built without ------------------------------------ */
  /**
   * No standing-rule-engine run was supplied, so the answer carries facility
   * legality only.
   *
   * `compromise`, never `info`: turnover, travel and round-robin findings are
   * simply absent, and an answer that is silent about them must not read as an
   * answer that found none.
   */
  ATTRIBUTION_VERIFICATION_ABSENT: 'ATTRIBUTION_VERIFICATION_ABSENT',
  /**
   * No coach-travel evaluation was supplied and none could be built, because
   * the run declared no venue complexes.
   *
   * `compromise`. Judging every distinct venue name against the drive floor is
   * the misreading that reported eighteen shortfalls across five coaches on a
   * clean season, so this module refuses to guess and says so instead.
   */
  ATTRIBUTION_TRAVEL_ABSENT: 'ATTRIBUTION_TRAVEL_ABSENT',
  /**
   * No coach roster was supplied, so *"the sole coach of the other team"* is a
   * sentence this answer cannot say. `compromise`.
   */
  ATTRIBUTION_ROSTER_ABSENT: 'ATTRIBUTION_ROSTER_ABSENT',
  /**
   * Nothing this run holds bounds the thing that was asked about.
   *
   * `compromise`. An unbounded answer is not the same as a generous one.
   */
  ATTRIBUTION_BOUND_UNSTATED: 'ATTRIBUTION_BOUND_UNSTATED',
  /**
   * The question cannot be answered from what was supplied — no warm-up length
   * is stated, the format has no timing row. `compromise`.
   */
  ATTRIBUTION_QUESTION_UNANSWERABLE: 'ATTRIBUTION_QUESTION_UNANSWERABLE',

  /* -- the counterfactual --------------------------------------------------- */
  /** The alternative slot is legal too; the game's time is not forced. Provenance. */
  ATTRIBUTION_ALTERNATIVE_LEGAL: 'ATTRIBUTION_ALTERNATIVE_LEGAL',
  /** The alternative slot is blocked, and here is by what. Provenance. */
  ATTRIBUTION_ALTERNATIVE_BLOCKED: 'ATTRIBUTION_ALTERNATIVE_BLOCKED',
  /**
   * The alternative asked about is the slot the game already occupies.
   *
   * `compromise`: the comparison is vacuous and its empty answer must not read
   * as "nothing would break".
   */
  ATTRIBUTION_ALTERNATIVE_NO_OP: 'ATTRIBUTION_ALTERNATIVE_NO_OP',

  /* -- the minimal blocking set --------------------------------------------- */
  /** The placement asked about is legal, so no set of constraints blocks it. Provenance. */
  ATTRIBUTION_PLACEMENT_NOT_BLOCKED: 'ATTRIBUTION_PLACEMENT_NOT_BLOCKED',
  /**
   * A blocking reason code no registry constraint claims.
   *
   * `compromise`. Relaxing the registry cannot lift it, so the reported set
   * cannot be the whole story and says so rather than looking complete.
   */
  ATTRIBUTION_BLOCKER_UNGOVERNED: 'ATTRIBUTION_BLOCKER_UNGOVERNED',
  /**
   * Relaxing every candidate constraint at once still left the placement
   * illegal.
   *
   * `blocking`. The set on offer is not a blocking set at all, and reporting it
   * as one would be a minimality claim resting on nothing.
   */
  ATTRIBUTION_MINIMAL_SET_UNCERTIFIED: 'ATTRIBUTION_MINIMAL_SET_UNCERTIFIED',
  /**
   * Every member of the reported set was proved necessary: dropping it leaves
   * the placement illegal. Provenance, and the counters behind it.
   */
  ATTRIBUTION_MINIMAL_SET_PROVEN: 'ATTRIBUTION_MINIMAL_SET_PROVEN',

  /* -- the conflict question ------------------------------------------------ */
  /** The team named has no conflict in this run. Provenance. */
  ATTRIBUTION_TEAM_NO_CONFLICT: 'ATTRIBUTION_TEAM_NO_CONFLICT',
});

/**
 * Severity of every reason code.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const ATTRIBUTION_REASON_SEVERITY = Object.freeze({
  [ATTRIBUTION_REASON.ATTRIBUTION_CLAIM_CATEGORY_ONLY]: ATTRIBUTION_SEVERITY.BLOCKING,
  [ATTRIBUTION_REASON.ATTRIBUTION_GAME_UNATTRIBUTED]: ATTRIBUTION_SEVERITY.BLOCKING,
  [ATTRIBUTION_REASON.ATTRIBUTION_SWEEP_VACUOUS]: ATTRIBUTION_SEVERITY.BLOCKING,
  [ATTRIBUTION_REASON.ATTRIBUTION_GAME_UNKNOWN]: ATTRIBUTION_SEVERITY.BLOCKING,
  [ATTRIBUTION_REASON.ATTRIBUTION_TEAM_UNKNOWN]: ATTRIBUTION_SEVERITY.BLOCKING,

  [ATTRIBUTION_REASON.ATTRIBUTION_VERIFICATION_ABSENT]: ATTRIBUTION_SEVERITY.COMPROMISE,
  [ATTRIBUTION_REASON.ATTRIBUTION_TRAVEL_ABSENT]: ATTRIBUTION_SEVERITY.COMPROMISE,
  [ATTRIBUTION_REASON.ATTRIBUTION_ROSTER_ABSENT]: ATTRIBUTION_SEVERITY.COMPROMISE,
  [ATTRIBUTION_REASON.ATTRIBUTION_BOUND_UNSTATED]: ATTRIBUTION_SEVERITY.COMPROMISE,
  [ATTRIBUTION_REASON.ATTRIBUTION_QUESTION_UNANSWERABLE]: ATTRIBUTION_SEVERITY.COMPROMISE,

  [ATTRIBUTION_REASON.ATTRIBUTION_ALTERNATIVE_LEGAL]: ATTRIBUTION_SEVERITY.INFO,
  [ATTRIBUTION_REASON.ATTRIBUTION_ALTERNATIVE_BLOCKED]: ATTRIBUTION_SEVERITY.INFO,
  [ATTRIBUTION_REASON.ATTRIBUTION_ALTERNATIVE_NO_OP]: ATTRIBUTION_SEVERITY.COMPROMISE,

  [ATTRIBUTION_REASON.ATTRIBUTION_PLACEMENT_NOT_BLOCKED]: ATTRIBUTION_SEVERITY.INFO,
  [ATTRIBUTION_REASON.ATTRIBUTION_BLOCKER_UNGOVERNED]: ATTRIBUTION_SEVERITY.COMPROMISE,
  [ATTRIBUTION_REASON.ATTRIBUTION_MINIMAL_SET_UNCERTIFIED]: ATTRIBUTION_SEVERITY.BLOCKING,
  [ATTRIBUTION_REASON.ATTRIBUTION_MINIMAL_SET_PROVEN]: ATTRIBUTION_SEVERITY.INFO,

  [ATTRIBUTION_REASON.ATTRIBUTION_TEAM_NO_CONFLICT]: ATTRIBUTION_SEVERITY.INFO,
});

/**
 * Severity of an attribution reason code.
 *
 * Throws on an unknown code rather than defaulting to `info`, for the same
 * reason the other eight modules do: a code with no severity is a code somebody
 * forgot to register, and defaulting would make it silently non-blocking.
 *
 * @param {string} code
 * @returns {string} an {@link ATTRIBUTION_SEVERITY} value
 */
export function attributionSeverityOf(code) {
  const severity = ATTRIBUTION_REASON_SEVERITY[code];
  if (!severity) {
    throw new Error(`attribution: reason code "${code}" has no registered severity`);
  }
  return severity;
}

/**
 * Build an attribution finding. `severity` is looked up, never passed in.
 *
 * @param {string} code - an {@link ATTRIBUTION_REASON} value
 * @param {string} message - for humans only
 * @param {Record<string, unknown>} [details] - flat primitives and ids only
 * @returns {import('./types.js').AttributionFinding}
 */
export function makeAttributionFinding(code, message, details = {}) {
  return { code, severity: attributionSeverityOf(code), message, details };
}

/**
 * Derive the status of an answer mechanically from its findings.
 *
 * @param {ReadonlyArray<import('./types.js').AttributionFinding>} findings
 * @returns {string} an {@link ATTRIBUTION_STATUS} value
 */
export function deriveAttributionStatus(findings) {
  return deriveConstraintStatus(
    /** @type {ReadonlyArray<import('../constraints/types.js').ConstraintFinding>} */ (findings)
  );
}

/**
 * Fresh zeroed counters.
 *
 * Every one of these is additive, so {@link mergeAttributionMeta} can fold a
 * per-game answer into a whole-season one without any of them meaning something
 * different at the two scales. Facts that are *not* sums — how many constraints
 * the registry holds, how many games the schedule carries — live in the result
 * body rather than here.
 *
 * @returns {import('./types.js').AttributionMeta}
 */
export function createAttributionMeta() {
  return {
    /** Games this answer looked at. */
    gamesExamined: 0,
    /** Games it produced at least one claim for. */
    gamesAttributed: 0,
    /** Claims built, over every source. */
    claimsBuilt: 0,
    /** Claims marked binding by the machinery that owns them. */
    claimsBinding: 0,
    /** Claims that failed the specific-instance test. Never above zero. */
    claimsCategoryOnly: 0,
    /** Availability constraints consulted, applicable or not. */
    availabilityConstraintsConsulted: 0,
    /** Rule-engine violations read. */
    violationsConsulted: 0,
    /** Coach-travel transitions read. */
    transitionsConsulted: 0,
    /** Roster entries read. */
    rosterEntriesConsulted: 0,
    /** Calls into `checkPlacement()`. */
    placementChecksRun: 0,
    /** Calls into `latestLegalKickoff()` / `earliestKickoffWithWarmup()`. */
    boundaryQueriesRun: 0,
    /** Registries projected to test whether a constraint is necessary. */
    relaxationsTested: 0,
    /** Members of a reported blocking set proved necessary by a dropped-member test. */
    membersProvenNecessary: 0,
    /** Candidate constraints the deletion filter discarded as unnecessary. */
    membersDropped: 0,
  };
}

/**
 * Fold one set of counters into another.
 *
 * @param {import('./types.js').AttributionMeta} target
 * @param {import('./types.js').AttributionMeta} source
 * @returns {import('./types.js').AttributionMeta}
 */
export function mergeAttributionMeta(target, source) {
  for (const key of Object.keys(target)) {
    target[key] += source[key] ?? 0;
  }
  return target;
}
