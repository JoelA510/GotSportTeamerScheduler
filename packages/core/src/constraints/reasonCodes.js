/**
 * Machine-readable reason codes for every constraint-registry decision, the
 * three constraint types, the scope vocabulary with its specificity ranks, and
 * the severity table that turns a list of findings into a status.
 *
 * Same two rules as `facility/reasonCodes.js`, `timing/reasonCodes.js` and
 * `availability/reasonCodes.js`, for the same reasons:
 *
 * 1. **`code` is the contract, `message` is decoration.** Never parse a message.
 * 2. **Severity lives in a table, never at a call site.** The difference here is
 *    that this module's table is not the last word: the *registry* is. A
 *    constraint record of type `hard` makes every reason code it claims
 *    `blocking`; the same record retyped `preference` makes them `info`. That is
 *    GAP-12 — hardness as data — and `severity.js` is where the two tables meet.
 *
 * Severities and statuses are *imported* from the facility module rather than
 * redeclared, exactly as the timing and availability modules import them. A
 * constraint finding ends up in the same list as a facility one, and
 * `deriveConstraintStatus()` reads nothing but `finding.severity`.
 *
 * @module constraints/reasonCodes
 */

import {
  FACILITY_SEVERITY,
  FACILITY_STATUS,
  deriveFacilityStatus,
} from '../facility/reasonCodes.js';

/**
 * How badly a finding counts. Re-exported from the facility module so the four
 * vocabularies cannot drift apart.
 *
 * @readonly
 * @enum {string}
 */
export const CONSTRAINT_SEVERITY = FACILITY_SEVERITY;

/**
 * The three-state outcome of any constraint-registry check.
 *
 * @readonly
 * @enum {string}
 */
export const CONSTRAINT_STATUS = FACILITY_STATUS;

/**
 * The hardness of a constraint — the whole point of the registry.
 *
 * `soft` and `preference` are **not** synonyms and the distinction is load
 * bearing: a soft constraint has a violation concept and therefore a cost, and
 * may be broken when the alternative is infeasibility; a preference has no
 * violation concept at all, only a direction to optimise toward. Collapsing the
 * two is how "try to leave a field between them" ended up indistinguishable
 * from "never put a game here" — incident 3 in
 * `fixtures/season-2026/README.md`.
 *
 * @readonly
 * @enum {string}
 */
export const CONSTRAINT_TYPE = Object.freeze({
  /** Never violate. Any finding it claims is `blocking`. */
  HARD: 'hard',
  /** Violate only if infeasible, at a stated cost. Findings are `compromise`. */
  SOFT: 'soft',
  /** Optimise toward; no violation concept. Findings are `info`. */
  PREFERENCE: 'preference',
});

/**
 * The severity a constraint of each type imposes on the reason codes it claims.
 *
 * This one table is the entire hard/soft seam. `docs/ARCHITECTURE.md` §6.7
 * records the status quo it replaces: hardness was "implicit — `hasCoachConflict`
 * is an unconditional `continue`, `computeConsistencyScore` is a ranking term".
 * Changing a constraint's hardness now changes a field on a record, not a branch
 * in a solver.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const CONSTRAINT_TYPE_SEVERITY = Object.freeze({
  [CONSTRAINT_TYPE.HARD]: CONSTRAINT_SEVERITY.BLOCKING,
  [CONSTRAINT_TYPE.SOFT]: CONSTRAINT_SEVERITY.COMPROMISE,
  [CONSTRAINT_TYPE.PREFERENCE]: CONSTRAINT_SEVERITY.INFO,
});

/**
 * How restrictive each type is, for the "more restrictive wins" tie-break.
 *
 * @type {Readonly<Record<string, number>>}
 */
export const CONSTRAINT_TYPE_RANK = Object.freeze({
  [CONSTRAINT_TYPE.PREFERENCE]: 0,
  [CONSTRAINT_TYPE.SOFT]: 1,
  [CONSTRAINT_TYPE.HARD]: 2,
});

/**
 * What a constraint is narrowed to.
 *
 * Vocabulary note: the prompt's *field* is this module's **`surface`**, because
 * that is what `facility/types.js` calls a bookable patch of ground and a second
 * name for one concept is exactly the drift `docs/ARCHITECTURE.md` §1.1
 * documents. A `surface`-scoped constraint applies to that surface **and its
 * descendants** — a rule about Pitch 1 is a rule about 1A and 1B — which is why
 * scope matching takes the caller's surface *lineage* rather than a bare id.
 *
 * @readonly
 * @enum {string}
 */
export const CONSTRAINT_SCOPE_KIND = Object.freeze({
  GLOBAL: 'global',
  DATE: 'date',
  DATE_RANGE: 'date-range',
  VENUE: 'venue',
  /** The prompt's "field". */
  SURFACE: 'surface',
  DIVISION: 'division',
  TEAM: 'team',
  PERSON: 'person',
});

/**
 * The specificity rank of each scope kind. **Higher wins.**
 *
 * This is a deliberately *partial* order flattened onto integers, and the ties
 * are the interesting part:
 *
 * - `global` (0) loses to everything. This is what makes the Orchard Park
 *   20-minute turnover beat the global 10-minute floor (GAP-12).
 * - `date-range` (1) loses to a single named date, which is narrower.
 * - `date`, `division` and `venue` all sit at **2** because none of them
 *   contains another: a date-scoped rule covers every venue on one day, a
 *   venue-scoped rule covers every day at one site. Asking which is "narrower"
 *   has no answer, so two of them that *disagree* are reported as ambiguous and
 *   the more restrictive is applied — never picked silently. That is the same
 *   contract `EQUIPMENT_PRECEDENCE_AMBIGUOUS` and `PERMIT_PRECEDENCE_AMBIGUOUS`
 *   already keep in Phase 1.
 * - `surface`, `team` and `person` sit at **3**: each names one concrete thing.
 *
 * @type {Readonly<Record<string, number>>}
 */
export const CONSTRAINT_SCOPE_SPECIFICITY = Object.freeze({
  [CONSTRAINT_SCOPE_KIND.GLOBAL]: 0,
  [CONSTRAINT_SCOPE_KIND.DATE_RANGE]: 1,
  [CONSTRAINT_SCOPE_KIND.DATE]: 2,
  [CONSTRAINT_SCOPE_KIND.DIVISION]: 2,
  [CONSTRAINT_SCOPE_KIND.VENUE]: 2,
  [CONSTRAINT_SCOPE_KIND.SURFACE]: 3,
  [CONSTRAINT_SCOPE_KIND.TEAM]: 3,
  [CONSTRAINT_SCOPE_KIND.PERSON]: 3,
});

/**
 * How a constraint reaches the rest of the system.
 *
 * `declared-only` is not a weasel word — it is the honest state of eight of the
 * twelve seeded constraints. Round-robin completeness, home/away balance,
 * kickoff variety, conflict fairness, coach travel, coach maximum gap and the
 * turnover minimums have no Phase 1 reason code to attach to because the modules
 * that would emit one do not exist yet. Recording them as data now, and saying
 * out loud that nothing enforces them yet, is strictly better than either
 * omitting them or pretending they are wired.
 *
 * @readonly
 * @enum {string}
 */
export const CONSTRAINT_ENFORCEMENT = Object.freeze({
  /** Claims reason codes and therefore overrides their severity. */
  REASON_CODES: 'reason-codes',
  /** Recorded, scoped and auditable, but nothing consumes it yet. */
  DECLARED_ONLY: 'declared-only',
});

/**
 * Every reason a constraint-registry check can give.
 *
 * @readonly
 * @enum {string}
 */
export const CONSTRAINT_REASON = Object.freeze({
  /* -- building the registry ---------------------------------------------- */
  /**
   * The registry holds no constraints at all.
   *
   * `blocking`, not `info`: an empty registry makes every "this is allowed"
   * answer true for the wrong reason, which is incident 4 — a validator that
   * matched zero records and reported a perfect score.
   */
  REGISTRY_EMPTY: 'REGISTRY_EMPTY',
  /** Two records claim the same id. */
  CONSTRAINT_ID_DUPLICATE: 'CONSTRAINT_ID_DUPLICATE',
  /**
   * A record claims a reason code that no severity table registers. Blocking
   * for the same reason `severityOf()` throws on one: a code nobody registered
   * is a code somebody misspelled, and letting it through would make the
   * constraint silently govern nothing.
   */
  CONSTRAINT_REASON_CODE_UNKNOWN: 'CONSTRAINT_REASON_CODE_UNKNOWN',
  /** The record is recorded but nothing consumes it yet. Provenance. */
  CONSTRAINT_DECLARED_ONLY: 'CONSTRAINT_DECLARED_ONLY',
  /** The record's type has changed at least once. Provenance — incident 3. */
  CONSTRAINT_TYPE_CHANGED: 'CONSTRAINT_TYPE_CHANGED',

  /* -- effective windows --------------------------------------------------- */
  /** The context date precedes the record's `effectiveFrom`. */
  CONSTRAINT_NOT_YET_EFFECTIVE: 'CONSTRAINT_NOT_YET_EFFECTIVE',
  /** The context date follows the record's `effectiveTo` — it has expired. */
  CONSTRAINT_EXPIRED: 'CONSTRAINT_EXPIRED',
  /**
   * The record has an effective window and the caller supplied no date, so
   * whether it applies cannot be decided.
   *
   * `compromise`, not `info`: answering "the rule applies" for a rule that may
   * have expired, or "it does not" for one that may be live, are both fabricated
   * answers. The caller is told it asked an unanswerable question.
   */
  CONSTRAINT_WINDOW_UNJUDGED: 'CONSTRAINT_WINDOW_UNJUDGED',

  /* -- scope resolution ---------------------------------------------------- */
  /**
   * The record is scoped to a dimension the caller's context does not carry —
   * a venue-scoped turnover rule when nobody said which venue. `compromise` for
   * the same reason as `CONSTRAINT_WINDOW_UNJUDGED`: falling through to the
   * global answer here is how the Orchard Park rule gets quietly lost.
   */
  CONSTRAINT_SCOPE_UNJUDGED: 'CONSTRAINT_SCOPE_UNJUDGED',
  /**
   * A narrower record beat a broader one. Provenance, and the one an operator
   * asking "why is turnover 20 here?" needs.
   */
  CONSTRAINT_SCOPE_NARROWER_APPLIED: 'CONSTRAINT_SCOPE_NARROWER_APPLIED',
  /**
   * Two records survive at the same specificity and disagree. The more
   * restrictive one is applied *and* this is emitted; the resolver never picks
   * a winner silently (same contract as `EQUIPMENT_PRECEDENCE_AMBIGUOUS` and
   * `PERMIT_PRECEDENCE_AMBIGUOUS`).
   */
  CONSTRAINT_PRECEDENCE_AMBIGUOUS: 'CONSTRAINT_PRECEDENCE_AMBIGUOUS',
  /**
   * A division-scoped record was matched on its **label**. GAP-24: division
   * labels are not a key — `16GSelect02` appears under `U16G` and `16GS` in the
   * same corpus — so a label match is a best effort and says so.
   */
  CONSTRAINT_DIVISION_LABEL_MATCH: 'CONSTRAINT_DIVISION_LABEL_MATCH',
  /**
   * A policy was resolved and **nothing governs it** — no record of that policy
   * survived scope and window filtering. `compromise`: "no rule applies" and
   * "the rule permits it" are different statements and must not be collapsed.
   */
  CONSTRAINT_POLICY_UNGOVERNED: 'CONSTRAINT_POLICY_UNGOVERNED',

  /* -- the severity seam --------------------------------------------------- */
  /** A constraint changed a reason code's severity away from its base. */
  CONSTRAINT_SEVERITY_OVERRIDDEN: 'CONSTRAINT_SEVERITY_OVERRIDDEN',
  /**
   * Two records of different type claim the same reason code at the same
   * specificity. The harder one wins and this is emitted.
   */
  CONSTRAINT_SEVERITY_AMBIGUOUS: 'CONSTRAINT_SEVERITY_AMBIGUOUS',

  /* -- the what-if query --------------------------------------------------- */
  /** The projection changes nothing: the constraint already has that type. */
  CONSTRAINT_PROJECTION_NO_OP: 'CONSTRAINT_PROJECTION_NO_OP',
  /**
   * Evaluations were handed to a projection and **not one finding** in them
   * mentions a code the constraint governs, so the reported delta is empty for
   * a reason that has nothing to do with the constraint. Incident 4 again: a
   * query that examined nothing must not look like a clean answer.
   */
  CONSTRAINT_PROJECTION_VACUOUS: 'CONSTRAINT_PROJECTION_VACUOUS',
});

/**
 * Severity of every reason code.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const CONSTRAINT_REASON_SEVERITY = Object.freeze({
  [CONSTRAINT_REASON.REGISTRY_EMPTY]: CONSTRAINT_SEVERITY.BLOCKING,
  [CONSTRAINT_REASON.CONSTRAINT_ID_DUPLICATE]: CONSTRAINT_SEVERITY.BLOCKING,
  [CONSTRAINT_REASON.CONSTRAINT_REASON_CODE_UNKNOWN]: CONSTRAINT_SEVERITY.BLOCKING,
  [CONSTRAINT_REASON.CONSTRAINT_DECLARED_ONLY]: CONSTRAINT_SEVERITY.INFO,
  [CONSTRAINT_REASON.CONSTRAINT_TYPE_CHANGED]: CONSTRAINT_SEVERITY.INFO,

  [CONSTRAINT_REASON.CONSTRAINT_NOT_YET_EFFECTIVE]: CONSTRAINT_SEVERITY.INFO,
  [CONSTRAINT_REASON.CONSTRAINT_EXPIRED]: CONSTRAINT_SEVERITY.INFO,
  [CONSTRAINT_REASON.CONSTRAINT_WINDOW_UNJUDGED]: CONSTRAINT_SEVERITY.COMPROMISE,

  [CONSTRAINT_REASON.CONSTRAINT_SCOPE_UNJUDGED]: CONSTRAINT_SEVERITY.COMPROMISE,
  [CONSTRAINT_REASON.CONSTRAINT_SCOPE_NARROWER_APPLIED]: CONSTRAINT_SEVERITY.INFO,
  [CONSTRAINT_REASON.CONSTRAINT_PRECEDENCE_AMBIGUOUS]: CONSTRAINT_SEVERITY.INFO,
  [CONSTRAINT_REASON.CONSTRAINT_DIVISION_LABEL_MATCH]: CONSTRAINT_SEVERITY.INFO,
  [CONSTRAINT_REASON.CONSTRAINT_POLICY_UNGOVERNED]: CONSTRAINT_SEVERITY.COMPROMISE,

  [CONSTRAINT_REASON.CONSTRAINT_SEVERITY_OVERRIDDEN]: CONSTRAINT_SEVERITY.INFO,
  [CONSTRAINT_REASON.CONSTRAINT_SEVERITY_AMBIGUOUS]: CONSTRAINT_SEVERITY.INFO,

  [CONSTRAINT_REASON.CONSTRAINT_PROJECTION_NO_OP]: CONSTRAINT_SEVERITY.INFO,
  [CONSTRAINT_REASON.CONSTRAINT_PROJECTION_VACUOUS]: CONSTRAINT_SEVERITY.COMPROMISE,
});

/**
 * Severity of a constraint reason code.
 *
 * Throws on an unknown code rather than defaulting to `info`, for the same
 * reason the other three modules do: a code with no severity is a code somebody
 * forgot to register, and defaulting would make it silently non-blocking.
 *
 * @param {string} code
 * @returns {string} a {@link CONSTRAINT_SEVERITY} value
 */
export function constraintSeverityOf(code) {
  const severity = CONSTRAINT_REASON_SEVERITY[code];
  if (!severity) {
    throw new Error(`constraints: reason code "${code}" has no registered severity`);
  }
  return severity;
}

/**
 * The severity a constraint of this type imposes on the codes it claims.
 *
 * Throws on an unknown type for the same reason as above.
 *
 * @param {string} type - a {@link CONSTRAINT_TYPE} value
 * @returns {string} a {@link CONSTRAINT_SEVERITY} value
 */
export function severityForType(type) {
  const severity = CONSTRAINT_TYPE_SEVERITY[type];
  if (!severity) {
    throw new Error(`constraints: constraint type "${type}" has no registered severity`);
  }
  return severity;
}

/**
 * The specificity rank of a scope kind. Higher is narrower.
 *
 * @param {string} scopeKind - a {@link CONSTRAINT_SCOPE_KIND} value
 * @returns {number}
 */
export function specificityOf(scopeKind) {
  const rank = CONSTRAINT_SCOPE_SPECIFICITY[scopeKind];
  if (rank === undefined) {
    throw new Error(`constraints: scope kind "${scopeKind}" has no registered specificity`);
  }
  return rank;
}

/**
 * How restrictive a constraint type is. Higher is harder.
 *
 * @param {string} type - a {@link CONSTRAINT_TYPE} value
 * @returns {number}
 */
export function typeRankOf(type) {
  const rank = CONSTRAINT_TYPE_RANK[type];
  if (rank === undefined) {
    throw new Error(`constraints: constraint type "${type}" has no registered rank`);
  }
  return rank;
}

/**
 * Build a constraint finding. `severity` is looked up, never passed in.
 *
 * @param {string} code - a {@link CONSTRAINT_REASON} value
 * @param {string} message - for humans only
 * @param {Record<string, unknown>} [details] - flat primitives and ids only
 * @returns {import('./types.js').ConstraintFinding}
 */
export function makeConstraintFinding(code, message, details = {}) {
  return { code, severity: constraintSeverityOf(code), message, details };
}

/**
 * Derive the status of a check mechanically from its findings.
 *
 * Delegates to the facility implementation, which reads nothing but
 * `finding.severity`. That is what lets one list hold constraint, availability,
 * timing and facility findings at once.
 *
 * @param {ReadonlyArray<import('./types.js').ConstraintFinding>} findings
 * @returns {string} a {@link CONSTRAINT_STATUS} value
 */
export function deriveConstraintStatus(findings) {
  return deriveFacilityStatus(
    /** @type {ReadonlyArray<import('../facility/types.js').FacilityFinding>} */ (findings)
  );
}

/**
 * Fresh zeroed counters.
 *
 * Incident 4 in `fixtures/season-2026/README.md` is a validator that matched
 * zero records and reported a perfect score. Every result in this module carries
 * these so a test can assert the check was not vacuous.
 *
 * @returns {import('./types.js').ConstraintMeta}
 */
export function createConstraintMeta() {
  return {
    constraintsConsidered: 0,
    constraintsApplicable: 0,
    constraintsInactive: 0,
    constraintsOutOfScope: 0,
    scopeDimensionsTested: 0,
    policiesResolved: 0,
    ambiguitiesReported: 0,
    reasonCodesGoverned: 0,
    reasonCodesOverridden: 0,
    findingsExamined: 0,
    findingsReseverified: 0,
    evaluationsExamined: 0,
  };
}

/**
 * Add one counter set into another, in place.
 *
 * @param {import('./types.js').ConstraintMeta} target
 * @param {import('./types.js').ConstraintMeta} source
 * @returns {import('./types.js').ConstraintMeta}
 */
export function mergeConstraintMeta(target, source) {
  for (const key of Object.keys(target)) {
    target[key] += source[key] ?? 0;
  }
  return target;
}
