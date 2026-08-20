/**
 * Machine-readable reason codes for the standing rule engine: the codes the
 * engine itself emits about *its own* health, the codes its rules emit about a
 * schedule, and the frozen severity tables behind both.
 *
 * Same two rules as `facility/reasonCodes.js`, `timing/reasonCodes.js`,
 * `availability/reasonCodes.js`, `constraints/reasonCodes.js` and
 * `waivers/reasonCodes.js`:
 *
 * 1. **`code` is the contract, `message` is decoration.** Never parse a message.
 * 2. **Severity lives in a table, never at a call site.**
 *
 * Severities and statuses are *imported* from the facility module rather than
 * redeclared, exactly as the other five modules import them, so a rule-engine
 * finding lands in the same list as a facility one and
 * {@link deriveRuleStatus} reads nothing but `finding.severity`.
 *
 * ## The two meta-assertion families, and why they are separate
 *
 * Incident 4 in `fixtures/season-2026/README.md` is **two** failures wearing
 * one number, and this module keeps them apart because the fixes are different:
 *
 * - **Matched too little.** *"A team-name format change made the coach
 *   validator's join match zero person-pairs. It reported zero conflicts."*
 *   The cure is a declared floor on how much a rule must have looked at:
 *   {@link RULE_REASON.RULE_EXERCISE_BELOW_MINIMUM} and
 *   {@link RULE_REASON.RULE_EXERCISE_COVERAGE_SHORT}.
 * - **Matched the wrong thing.** *"A second checker misread placeholder labels
 *   as team codes and reported phantom violations."* A count cannot catch this
 *   — the broken checker matched *more* rows, not fewer. The cure is a claim
 *   about the *shape* of what was matched:
 *   {@link RULE_REASON.RULE_MATCHED_PLACEHOLDER} and
 *   {@link RULE_REASON.RULE_MATCHED_UNKNOWN_IDENTIFIER}.
 *
 * Every one of those four is `blocking`. A validator that cannot prove it
 * looked at the right data is not a validator that reports "no violations"; it
 * is a validator that reports nothing at all, loudly.
 *
 * ## Where a *domain* violation's severity comes from
 *
 * Not from the table below, except as a fallback. A rule that enforces a
 * constraint takes its severity from that **constraint record's own `type`**,
 * through `severityForType()` — the same table `constraints/severity.js` uses
 * and the same mechanism `waivers/coachTravel.js` already follows. Retype
 * `round-robin-completeness` from `hard` to `preference` and every
 * `ROUND_ROBIN_INCOMPLETE` finding becomes `info` without an edit here. That is
 * GAP-12, and {@link RULE_VIOLATION_SEVERITY} is only what answers when no
 * record governs the code at all.
 *
 * @module ruleEngine/reasonCodes
 */

import { severityForType } from '../constraints/reasonCodes.js';
import {
  FACILITY_SEVERITY,
  FACILITY_STATUS,
  deriveFacilityStatus,
} from '../facility/reasonCodes.js';

/**
 * How badly a finding counts. Re-exported from the facility module so the six
 * vocabularies cannot drift apart.
 *
 * @readonly
 * @enum {string}
 */
export const RULE_SEVERITY = FACILITY_SEVERITY;

/**
 * The three-state outcome of any rule-engine check.
 *
 * @readonly
 * @enum {string}
 */
export const RULE_STATUS = FACILITY_STATUS;

/**
 * What kind of thing an identifier names.
 *
 * A rule declares the kind of every identifier it matched so the engine can
 * check the match against the schedule's own universe of that kind. This is
 * what makes "the checker read `Select Game 7` as a team code" a mechanical
 * failure rather than something a reviewer has to notice.
 *
 * @readonly
 * @enum {string}
 */
export const RULE_IDENTIFIER_KIND = Object.freeze({
  TEAM: 'team',
  PERSON: 'person',
  DIVISION: 'division',
  SURFACE: 'surface',
  VENUE: 'venue',
  GAME: 'game',
  DATE: 'date',
});

/**
 * Every reason the engine can give about itself, its rules and their exercise.
 *
 * @readonly
 * @enum {string}
 */
export const RULE_REASON = Object.freeze({
  /* -- building the engine -------------------------------------------------- */
  /**
   * The engine holds no rules.
   *
   * `blocking`, for the same reason `REGISTRY_EMPTY` is: an engine with no
   * rules answers "no violations" to every schedule ever put in front of it,
   * which is incident 4 with the volume turned all the way up.
   */
  RULE_SET_EMPTY: 'RULE_SET_EMPTY',
  /** Two rules claim the same id. */
  RULE_ID_DUPLICATE: 'RULE_ID_DUPLICATE',
  /**
   * A rule claims to enforce a constraint the registry does not hold.
   * `blocking`: the rule is running against a rule nobody wrote down, and the
   * severity it reports comes from a record that is not there.
   */
  RULE_CONSTRAINT_UNKNOWN: 'RULE_CONSTRAINT_UNKNOWN',
  /**
   * A rule enforces no registry constraint at all. `info`, and provenance
   * rather than a fault: `field-eligibility` is exactly this — Phase 1 checks
   * size and line markings, and the club never wrote a constraint record about
   * either. Saying so is better than inventing a record to make the coverage
   * table look tidy.
   */
  RULE_ENFORCES_NO_CONSTRAINT: 'RULE_ENFORCES_NO_CONSTRAINT',
  /**
   * A registry constraint has **no rule enforcing it**.
   *
   * `compromise`, and this is the code that keeps the engine honest about the
   * seeded set: ten of the fourteen season-2026 constraints are
   * `declared-only`, and an engine that reported "all constraints pass" while
   * ten of them are unenforceable would be incident 4 at the level of the whole
   * system. "Nothing checked this" and "this is satisfied" are different
   * statements and the report never collapses them.
   */
  RULE_CONSTRAINT_UNENFORCED: 'RULE_CONSTRAINT_UNENFORCED',
  /**
   * A rule enforces a constraint the registry records as `declared-only`.
   * `info`. The registry's `enforcement` field means "claims Phase 1 reason
   * codes whose severity it governs", which is a narrower thing than "something
   * checks it"; the rule engine is a second enforcement path and this finding
   * is where the two vocabularies are reconciled out loud.
   */
  RULE_ENFORCES_DECLARED_ONLY: 'RULE_ENFORCES_DECLARED_ONLY',

  /* -- meta-assertions: matched too little ---------------------------------- */
  /**
   * A rule reported a counter below the minimum its own definition declares.
   *
   * **The** code of this module. `blocking`, always: the coach validator that
   * matched zero person-pairs reported a perfect score, and a perfect score
   * meaning "I looked at nothing" is worse than an error.
   */
  RULE_EXERCISE_BELOW_MINIMUM: 'RULE_EXERCISE_BELOW_MINIMUM',
  /**
   * A rule declared a counter in its exercise expectation and did not report
   * it. `blocking`: an expectation nothing is measured against is an
   * expectation that has quietly stopped applying.
   */
  RULE_EXERCISE_COUNTER_MISSING: 'RULE_EXERCISE_COUNTER_MISSING',
  /**
   * A rule examined fewer subjects than the domain it declared it covers — the
   * round-robin rule that skipped a division. `blocking`: partial coverage
   * reported as a clean pass is the same lie as no coverage at all, only
   * harder to see.
   */
  RULE_EXERCISE_COVERAGE_SHORT: 'RULE_EXERCISE_COVERAGE_SHORT',
  /**
   * A rule declared coverage of a domain the schedule does not carry, so
   * coverage cannot be judged. `blocking` rather than skipped: an unjudgeable
   * expectation is an expectation that is not being enforced.
   */
  RULE_EXERCISE_DOMAIN_UNKNOWN: 'RULE_EXERCISE_DOMAIN_UNKNOWN',
  /**
   * A rule met every expectation it declared. `info`, and emitted every time:
   * the auditable record that this run's numbers were checked, not assumed.
   */
  RULE_EXERCISE_SATISFIED: 'RULE_EXERCISE_SATISFIED',

  /* -- meta-assertions: matched the wrong thing ----------------------------- */
  /**
   * A rule matched an identifier the schedule lists as a **placeholder label**
   * — `-`, `Select Game 7`, `Scrimmage - teams TBD`, `MinisA`.
   *
   * `blocking`. This is incident 4's second half exactly: a checker that reads
   * `Select Game 7` as a team code does not match *less* data, it matches
   * *more*, and every violation it then reports is a phantom. No count can
   * catch that; only a claim about what was matched can.
   */
  RULE_MATCHED_PLACEHOLDER: 'RULE_MATCHED_PLACEHOLDER',
  /**
   * A rule matched an identifier that is not in the schedule's universe for the
   * kind it declared — a "team id" that is not one of the schedule's teams.
   *
   * `blocking`. The broader sibling of the placeholder check, and the one that
   * catches a join against a foreign key space: `Visiting Club A - U14B South`
   * is a real opponent and is not a member team, and a rule that counts it as
   * one is measuring a different season.
   */
  RULE_MATCHED_UNKNOWN_IDENTIFIER: 'RULE_MATCHED_UNKNOWN_IDENTIFIER',
  /**
   * A rule declared an identifier kind the schedule carries no universe for, so
   * the shape of its match cannot be checked. `blocking`, for the same reason
   * as {@link RULE_REASON.RULE_EXERCISE_DOMAIN_UNKNOWN}.
   */
  RULE_IDENTIFIER_KIND_UNKNOWN: 'RULE_IDENTIFIER_KIND_UNKNOWN',

  /* -- running -------------------------------------------------------------- */
  /** A rule threw. `blocking`; the engine keeps going and reports the rest. */
  RULE_THREW: 'RULE_THREW',
  /**
   * The schedule handed to the engine holds no games. `blocking`: every rule
   * would pass, and none of them would mean anything.
   */
  RULE_SCHEDULE_EMPTY: 'RULE_SCHEDULE_EMPTY',

  /* -- the report ------------------------------------------------------------ */
  /**
   * A validation report was built over **zero subjects**. `blocking` — a report
   * whose every count is zero looks exactly like a clean season.
   */
  REPORT_VACUOUS: 'REPORT_VACUOUS',
  /**
   * A validation report was built and **no rule** passed its own exercise
   * expectation, so every count in it is unattributable. `blocking`.
   */
  REPORT_NO_RULE_EXERCISED: 'REPORT_NO_RULE_EXERCISED',
});

/**
 * Severity of every engine reason code.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const RULE_REASON_SEVERITY = Object.freeze({
  [RULE_REASON.RULE_SET_EMPTY]: RULE_SEVERITY.BLOCKING,
  [RULE_REASON.RULE_ID_DUPLICATE]: RULE_SEVERITY.BLOCKING,
  [RULE_REASON.RULE_CONSTRAINT_UNKNOWN]: RULE_SEVERITY.BLOCKING,
  [RULE_REASON.RULE_ENFORCES_NO_CONSTRAINT]: RULE_SEVERITY.INFO,
  [RULE_REASON.RULE_CONSTRAINT_UNENFORCED]: RULE_SEVERITY.COMPROMISE,
  [RULE_REASON.RULE_ENFORCES_DECLARED_ONLY]: RULE_SEVERITY.INFO,

  [RULE_REASON.RULE_EXERCISE_BELOW_MINIMUM]: RULE_SEVERITY.BLOCKING,
  [RULE_REASON.RULE_EXERCISE_COUNTER_MISSING]: RULE_SEVERITY.BLOCKING,
  [RULE_REASON.RULE_EXERCISE_COVERAGE_SHORT]: RULE_SEVERITY.BLOCKING,
  [RULE_REASON.RULE_EXERCISE_DOMAIN_UNKNOWN]: RULE_SEVERITY.BLOCKING,
  [RULE_REASON.RULE_EXERCISE_SATISFIED]: RULE_SEVERITY.INFO,

  [RULE_REASON.RULE_MATCHED_PLACEHOLDER]: RULE_SEVERITY.BLOCKING,
  [RULE_REASON.RULE_MATCHED_UNKNOWN_IDENTIFIER]: RULE_SEVERITY.BLOCKING,
  [RULE_REASON.RULE_IDENTIFIER_KIND_UNKNOWN]: RULE_SEVERITY.BLOCKING,

  [RULE_REASON.RULE_THREW]: RULE_SEVERITY.BLOCKING,
  [RULE_REASON.RULE_SCHEDULE_EMPTY]: RULE_SEVERITY.BLOCKING,

  [RULE_REASON.REPORT_VACUOUS]: RULE_SEVERITY.BLOCKING,
  [RULE_REASON.REPORT_NO_RULE_EXERCISED]: RULE_SEVERITY.BLOCKING,
});

/**
 * Every reason a *rule* can give about a schedule, for the rules that have no
 * Phase 1 evaluator behind them.
 *
 * The Phase 1 rules (adjacency, same ground, permits, sunset, eligibility)
 * report `FACILITY_REASON`, `TIMING_REASON` and `AVAILABILITY_REASON` codes
 * unchanged — re-implementing them here would be the second copy
 * `docs/ARCHITECTURE.md` §1.1 is about.
 *
 * @readonly
 * @enum {string}
 */
export const RULE_VIOLATION_REASON = Object.freeze({
  /* -- turnover ------------------------------------------------------------- */
  /** Two games on one surface are closer together than the turnover floor. */
  TURNOVER_BELOW_MINIMUM: 'TURNOVER_BELOW_MINIMUM',
  /** The earlier game has no known end, so the turnover cannot be measured. */
  TURNOVER_UNJUDGED: 'TURNOVER_UNJUDGED',
  /** No constraint record gives the turnover policy a number in this context. */
  TURNOVER_UNGOVERNED: 'TURNOVER_UNGOVERNED',

  /* -- round robin ---------------------------------------------------------- */
  /** Two teams in one division never met, in a division where they must. */
  ROUND_ROBIN_INCOMPLETE: 'ROUND_ROBIN_INCOMPLETE',
  /** One team's opponent counts differ by more than the permitted spread. */
  ROUND_ROBIN_SPREAD_EXCEEDED: 'ROUND_ROBIN_SPREAD_EXCEEDED',
  /**
   * A division has no two-sided games at all, so no round robin can be judged
   * in it. `compromise`, never `info`: the Minis division is exactly this, and
   * counting an unjudgeable division as a pass is how a rule reports coverage
   * it does not have.
   */
  ROUND_ROBIN_DIVISION_UNJUDGED: 'ROUND_ROBIN_DIVISION_UNJUDGED',
  /**
   * A division has more teams than its season has games, so a complete round
   * robin does not fit and completeness is not required of it. `info` — the
   * spread check still ran, and the corpus's U06B and U07B are this case.
   */
  ROUND_ROBIN_NOT_REQUIRED: 'ROUND_ROBIN_NOT_REQUIRED',

  /* -- hosting balance ------------------------------------------------------- */
  /** A team hosts more or fewer games than the balance constraint allows. */
  HOME_AWAY_OUT_OF_RANGE: 'HOME_AWAY_OUT_OF_RANGE',
  /** A team plays a different number of games than the season states. */
  GAMES_PLAYED_OFF_TARGET: 'GAMES_PLAYED_OFF_TARGET',
  /**
   * A team the roster puts in a judged division appears in no counted row at
   * all. Incident 4's own shape: a name-format change drops the team from every
   * row, so it plays 0 of 9 and every rule that takes its subjects from the
   * games leaves it out of the analysis rather than reporting it.
   */
  TEAM_ABSENT_FROM_SCHEDULE: 'TEAM_ABSENT_FROM_SCHEDULE',

  /* -- conflict fairness ------------------------------------------------------ */
  /** Within one age group, coach conflicts are concentrated on one team. */
  CONFLICT_SPREAD_EXCEEDED: 'CONFLICT_SPREAD_EXCEEDED',
});

/**
 * Fallback severity for a rule violation, used **only** when no constraint
 * record governs the code. When one does, its `type` decides — see the module
 * docstring.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const RULE_VIOLATION_SEVERITY = Object.freeze({
  [RULE_VIOLATION_REASON.TURNOVER_BELOW_MINIMUM]: RULE_SEVERITY.COMPROMISE,
  [RULE_VIOLATION_REASON.TURNOVER_UNJUDGED]: RULE_SEVERITY.COMPROMISE,
  [RULE_VIOLATION_REASON.TURNOVER_UNGOVERNED]: RULE_SEVERITY.COMPROMISE,

  [RULE_VIOLATION_REASON.ROUND_ROBIN_INCOMPLETE]: RULE_SEVERITY.COMPROMISE,
  [RULE_VIOLATION_REASON.ROUND_ROBIN_SPREAD_EXCEEDED]: RULE_SEVERITY.COMPROMISE,
  [RULE_VIOLATION_REASON.ROUND_ROBIN_DIVISION_UNJUDGED]: RULE_SEVERITY.COMPROMISE,
  [RULE_VIOLATION_REASON.ROUND_ROBIN_NOT_REQUIRED]: RULE_SEVERITY.INFO,

  [RULE_VIOLATION_REASON.HOME_AWAY_OUT_OF_RANGE]: RULE_SEVERITY.COMPROMISE,
  [RULE_VIOLATION_REASON.GAMES_PLAYED_OFF_TARGET]: RULE_SEVERITY.COMPROMISE,
  [RULE_VIOLATION_REASON.TEAM_ABSENT_FROM_SCHEDULE]: RULE_SEVERITY.BLOCKING,

  [RULE_VIOLATION_REASON.CONFLICT_SPREAD_EXCEEDED]: RULE_SEVERITY.COMPROMISE,
});

/**
 * Codes whose severity a constraint record may never change.
 *
 * `TURNOVER_UNJUDGED` and `ROUND_ROBIN_DIVISION_UNJUDGED` say *"this rule could
 * not decide"*, which is a fact about the evidence rather than a policy
 * position. `TEAM_ABSENT_FROM_SCHEDULE` is the same kind of statement about the
 * join rather than about the season, and retyping the hosting-balance record
 * must not be able to quieten a team that vanished from the schedule. Letting a `preference` record demote them to `info` would let a
 * schedule reach `allowed` on the strength of questions nobody answered — the
 * same reason `waivers/coachTravel.js` refuses to let a record soften
 * `TRAVEL_COMMITMENTS_OVERLAP`.
 *
 * @type {ReadonlySet<string>}
 */
const UNGOVERNABLE_CODES = Object.freeze(
  new Set([
    RULE_VIOLATION_REASON.TURNOVER_UNJUDGED,
    RULE_VIOLATION_REASON.TURNOVER_UNGOVERNED,
    RULE_VIOLATION_REASON.ROUND_ROBIN_DIVISION_UNJUDGED,
    RULE_VIOLATION_REASON.ROUND_ROBIN_NOT_REQUIRED,
    RULE_VIOLATION_REASON.TEAM_ABSENT_FROM_SCHEDULE,
  ])
);

/**
 * Severity of an engine reason code.
 *
 * Throws on an unknown code rather than defaulting to `info`, for the same
 * reason every other module's lookup does: a code with no severity is a code
 * somebody forgot to register, and defaulting would make it silently
 * non-blocking.
 *
 * @param {string} code - a {@link RULE_REASON} value
 * @returns {string} a {@link RULE_SEVERITY} value
 */
export function ruleSeverityOf(code) {
  const severity = RULE_REASON_SEVERITY[code];
  if (!severity) {
    throw new Error(`ruleEngine: reason code "${code}" has no registered severity`);
  }
  return severity;
}

/**
 * Severity of a rule violation under the constraint record that governs it.
 *
 * @param {string} code - a {@link RULE_VIOLATION_REASON} value
 * @param {import('../constraints/types.js').ConstraintRecord|null} [record]
 * @returns {string} a {@link RULE_SEVERITY} value
 */
export function violationSeverityOf(code, record = null) {
  const fallback = RULE_VIOLATION_SEVERITY[code];
  if (!fallback) {
    throw new Error(`ruleEngine: violation code "${code}" has no registered severity`);
  }
  if (record === null || UNGOVERNABLE_CODES.has(code)) return fallback;
  return severityForType(record.type);
}

/**
 * Build an engine finding. `severity` is looked up, never passed in.
 *
 * @param {string} code - a {@link RULE_REASON} value
 * @param {string} message - for humans only
 * @param {Record<string, unknown>} [details] - flat primitives and ids only
 * @returns {import('./types.js').RuleFinding}
 */
export function makeRuleFinding(code, message, details = {}) {
  return { code, severity: ruleSeverityOf(code), message, details };
}

/**
 * Build a rule violation finding. Severity comes from the governing constraint
 * record's type, or from the frozen fallback table — never from a call site.
 *
 * @param {string} code - a {@link RULE_VIOLATION_REASON} value
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @param {import('../constraints/types.js').ConstraintRecord|null} [record]
 * @returns {import('./types.js').RuleFinding}
 */
export function makeViolationFinding(code, message, details = {}, record = null) {
  return { code, severity: violationSeverityOf(code, record), message, details };
}

/**
 * Derive the status of a check mechanically from its findings.
 *
 * @param {ReadonlyArray<import('./types.js').RuleFinding>} findings
 * @returns {string} a {@link RULE_STATUS} value
 */
export function deriveRuleStatus(findings) {
  return deriveFacilityStatus(
    /** @type {ReadonlyArray<import('../facility/types.js').FacilityFinding>} */ (findings)
  );
}

/**
 * Is this finding a violation rather than provenance?
 *
 * `info` findings never count: an `EQUIPMENT_UNDECLARED` note is not something
 * anybody has to fix.
 *
 * @param {import('./types.js').RuleFinding} finding
 * @returns {boolean}
 */
export function isRuleViolation(finding) {
  return (
    finding.severity === RULE_SEVERITY.BLOCKING || finding.severity === RULE_SEVERITY.COMPROMISE
  );
}

/**
 * Fresh zeroed counters.
 *
 * Incident 4 in `fixtures/season-2026/README.md` is a validator that matched
 * zero records and reported a perfect score. Every result in this module
 * carries these so a test can assert the run was not vacuous.
 *
 * @returns {import('./types.js').RuleEngineMeta}
 */
export function createRuleEngineMeta() {
  return {
    rulesRegistered: 0,
    rulesRun: 0,
    rulesExercised: 0,
    rulesUnderExercised: 0,
    rulesThrew: 0,
    constraintsCovered: 0,
    constraintsUnenforced: 0,
    subjectsExamined: 0,
    findingsExamined: 0,
    violationsReported: 0,
    violationsWaived: 0,
    exerciseChecksRun: 0,
    identifiersChecked: 0,
  };
}

/**
 * Add one counter set into another, in place.
 *
 * @param {import('./types.js').RuleEngineMeta} target
 * @param {import('./types.js').RuleEngineMeta} source
 * @returns {import('./types.js').RuleEngineMeta}
 */
export function mergeRuleEngineMeta(target, source) {
  for (const key of Object.keys(target)) {
    target[key] += source[key] ?? 0;
  }
  return target;
}
