/**
 * Machine-readable reason codes for scheduled things that are not fully known
 * yet, plus the kinds and verdicts this module distinguishes.
 *
 * Same two rules as the nine modules before it:
 *
 * 1. **`code` is the contract, `message` is decoration.** Never parse a message.
 * 2. **Severity lives in a table, never at a call site.**
 *
 * Severities and statuses come from `constraints/reasonCodes.js`, which takes
 * them from the facility module, so a reserve finding lands in the same list as
 * a facility, timing, availability, waiver, rule, resolve or attribution one and
 * {@link deriveReserveStatus} reads nothing but `finding.severity`.
 *
 * @module reserve/reasonCodes
 */

import {
  CONSTRAINT_SEVERITY,
  CONSTRAINT_STATUS,
  deriveConstraintStatus,
} from '../constraints/reasonCodes.js';

/**
 * How badly a finding counts against a reserve result.
 *
 * @readonly
 * @enum {string}
 */
export const RESERVE_SEVERITY = CONSTRAINT_SEVERITY;

/**
 * The three-state outcome of any check in this module.
 *
 * @readonly
 * @enum {string}
 */
export const RESERVE_STATUS = CONSTRAINT_STATUS;

/**
 * The two things this module holds that are committed but not fully known.
 *
 * They are **not** the same thing and the corpus contains both:
 *
 * - an *unnamed fixture* is a game the club has committed a field and a time to
 *   while an external league decides who plays in it (`Select Game 7`, 100 rows
 *   across 10 dates — GAP-16);
 * - a *reservation* is ground held for a purpose with no fixture behind it at
 *   all (`Scrimmage - teams TBD`, exactly one row — GAP-17).
 *
 * Both occupy a surface and both appear in exports; only the first is a game.
 *
 * @readonly
 * @enum {string}
 */
export const RESERVE_KIND = Object.freeze({
  /** A reserved league slot whose participating teams are not yet known. */
  UNNAMED_FIXTURE: 'unnamed-fixture',
  /** Ground held for a purpose, with no fixture behind it. */
  RESERVATION: 'reservation',
});

/**
 * What one side of a fixture *is*.
 *
 * The distinction between {@link FIXTURE_SIDE.TBD} and {@link FIXTURE_SIDE.NONE}
 * is the whole reason this enum exists. `Select Game 7`'s away side is not yet
 * known and will be filled in; `MinisA`'s away side does not exist and never
 * will, because a Minis session has no opponent (GAP-15). The source project
 * spelled both as the string `-` and therefore could not tell "waiting on the
 * league" from "there is nobody to wait for".
 *
 * {@link FIXTURE_SIDE.EXTERNAL} is the third one the corpus needs: a visiting
 * club is a real, named opponent that has no roster, no coaches and no id in
 * this system (GAP-18). It is display text with a kind attached, which is
 * strictly more than a bare label — but it is still not an entity, and nothing
 * here pretends otherwise.
 *
 * @readonly
 * @enum {string}
 */
export const FIXTURE_SIDE = Object.freeze({
  /** A member team, present in the roster's team universe. */
  TEAM: 'team',
  /** A non-member club. Carries a label; is not an identity. */
  EXTERNAL: 'external',
  /**
   * A participant group that is not a rostered team and never will be.
   *
   * `MinisA`..`MinisD` are four *sessions* of five-year-olds, not four teams
   * (GAP-15). Counting them as teams is what turns 118 teams into 122 — the
   * sort of miscount that produces phantom results downstream.
   */
  SESSION: 'session',
  /** Not yet known. Bindable later. */
  TBD: 'tbd',
  /** No opponent exists. Not bindable, ever. */
  NONE: 'none',
});

/**
 * The sides a binding may fill in. Frozen, and read by `slots.js` rather than
 * re-spelled there.
 *
 * @type {ReadonlySet<string>}
 */
export const BINDABLE_SIDES = Object.freeze(new Set([FIXTURE_SIDE.TBD]));

/**
 * The kinds of condition a slot can carry.
 *
 * One member today, because the corpus states one kind of condition. It is an
 * enum rather than a boolean so that the *reason* a slot is conditional travels
 * with it: the build plan's instruction is "encode the condition; do not put it
 * in a note field", and a boolean `conditional: true` is a note field with
 * better manners.
 *
 * @readonly
 * @enum {string}
 */
export const SLOT_CONDITION_KIND = Object.freeze({
  /**
   * This slot exists only while named surfaces are idle for its footprint.
   *
   * Alder Park's Pitch 2 is 11v11-sized ground that physically overlaps Pitch 1
   * (and therefore its halves 1A and 1B); Pitch 3 overlaps Pitch 4, 4A and 4B.
   * The surface list is **derived from the facility graph's overlap relation**
   * (`facility/occupancy.js` `surfacesConflict()` reporting
   * `OCCUPIED_SPATIAL_OVERLAP`), never typed in.
   */
  SURFACE_IDLE: 'surface-idle',
});

/**
 * What evaluating a slot's condition concluded.
 *
 * `UNDECIDABLE` is not a synonym for `BLOCKED`. It is the GAP-14 answer: one of
 * the bookings involved has no known footprint, so concurrency cannot be
 * decided, and a `false` here would be a fabricated all-clear of exactly the
 * kind `facility/occupancy.js` refuses to give.
 *
 * @readonly
 * @enum {string}
 */
export const CONDITION_VERDICT = Object.freeze({
  /** The slot carries no condition at all. */
  UNCONDITIONAL: 'unconditional',
  /** Every named surface is idle for the slot's footprint. */
  SATISFIED: 'satisfied',
  /** At least one named surface is busy. */
  BLOCKED: 'blocked',
  /** A footprint involved is unknown, so this cannot be decided. */
  UNDECIDABLE: 'undecidable',
  /** The condition was recorded and nothing evaluated it. */
  UNEVALUATED: 'unevaluated',
});

/**
 * The two publication tokens incident 10 requires.
 *
 * > *"it must remain VISIBLE, be counted in totals, and export with explicit
 * > TIME TBD / LOCATION TBD plus the reason. It must never be silently
 * > dropped — that's how a team loses a game."*
 *
 * Frozen constants rather than string literals at call sites, so the token a
 * family reads on a schedule is one edit away and cannot drift between the
 * master export and a per-team one.
 *
 * @readonly
 * @enum {string}
 */
export const PUBLICATION_TBD = Object.freeze({
  TIME: 'TIME TBD',
  LOCATION: 'LOCATION TBD',
  OPPONENT: 'TBD',
});

/**
 * Every reason this module can give.
 *
 * @readonly
 * @enum {string}
 */
export const RESERVE_REASON = Object.freeze({
  /* -- binding teams into a reserved slot ----------------------------------- */
  /**
   * A binding named a slot this run does not hold.
   *
   * `blocking`. Silently ignoring it would report "0 slots moved, 0 teams
   * assigned" as a success.
   */
  RESERVED_SLOT_UNKNOWN: 'RESERVED_SLOT_UNKNOWN',
  /**
   * A binding named a team that is not in the roster's team universe.
   *
   * `blocking`, and the same discipline `ruleEngine/adapters/season2026Schedule.js`
   * applies: a team identifier is a member of the roster or it is not one.
   * Incident 4's second half is a checker that accepted `Select Game 7` as a
   * team code.
   */
  RESERVED_SLOT_TEAM_UNKNOWN: 'RESERVED_SLOT_TEAM_UNKNOWN',
  /**
   * A binding tried to fill a side that is not waiting to be filled — a Minis
   * session's absent opponent, or an external club's.
   *
   * `blocking`. `NONE` means there is nobody to name.
   */
  RESERVED_SLOT_SIDE_NOT_BINDABLE: 'RESERVED_SLOT_SIDE_NOT_BINDABLE',
  /** A binding tried to overwrite a side that already names a team. `blocking`. */
  RESERVED_SLOT_SIDE_ALREADY_NAMED: 'RESERVED_SLOT_SIDE_ALREADY_NAMED',
  /** A binding put the same team on both sides. `blocking`. */
  RESERVED_SLOT_SIDES_IDENTICAL: 'RESERVED_SLOT_SIDES_IDENTICAL',
  /**
   * One team was bound into two slots that overlap in time.
   *
   * `blocking`. The league picks the teams; nothing stops it picking the same
   * one twice, and a schedule that accepted it would publish a team in two
   * places at once.
   */
  RESERVED_SLOT_TEAM_DOUBLE_BOOKED: 'RESERVED_SLOT_TEAM_DOUBLE_BOOKED',
  /** A binding filled one side and left the other TBD. `compromise`. */
  RESERVED_SLOT_PARTIALLY_BOUND: 'RESERVED_SLOT_PARTIALLY_BOUND',
  /** A slot was bound. Provenance, and the counters behind it. */
  RESERVED_SLOT_BOUND: 'RESERVED_SLOT_BOUND',

  /* -- the guarantee the whole idea rests on -------------------------------- */
  /**
   * A slot's date, surface, kickoff, footprint or format changed.
   *
   * `blocking`, and this is the load-bearing code of the module. The club
   * committed a field and a time to families **before** knowing who would play
   * in it; if naming the teams can move it, the commitment was fiction.
   */
  RESERVED_SLOT_MOVED: 'RESERVED_SLOT_MOVED',
  /** A slot present before an operation is absent after it. `blocking`. */
  RESERVED_SLOT_DROPPED: 'RESERVED_SLOT_DROPPED',
  /**
   * The unmoved comparison examined zero pairs.
   *
   * `blocking`. "No slot moved" is a true statement about an empty comparison
   * and means nothing — incident 4, on the one assertion this module exists to
   * make.
   */
  RESERVED_SLOT_COMPARISON_VACUOUS: 'RESERVED_SLOT_COMPARISON_VACUOUS',
  /** Every compared slot held its position. Provenance, with the counters. */
  RESERVED_SLOT_UNMOVED: 'RESERVED_SLOT_UNMOVED',

  /* -- conditional slots ---------------------------------------------------- */
  /** Every surface the condition names is idle for the slot. Provenance. */
  SLOT_CONDITION_SATISFIED: 'SLOT_CONDITION_SATISFIED',
  /**
   * A surface the condition names is busy, so this candidate slot does not
   * exist right now. Provenance: an unreserved candidate that is unavailable is
   * a fact about the day, not a defect.
   */
  SLOT_CONDITION_BLOCKED: 'SLOT_CONDITION_BLOCKED',
  /**
   * A slot the club actually **reserved** has a condition that does not hold.
   *
   * `blocking`, unlike the candidate case: ground was held that cannot be used.
   */
  RESERVED_SLOT_CONDITION_BLOCKED: 'RESERVED_SLOT_CONDITION_BLOCKED',
  /**
   * A footprint involved in the condition is unknown (GAP-14), so it cannot be
   * decided. `compromise`, never a silent pass.
   */
  SLOT_CONDITION_UNDECIDABLE: 'SLOT_CONDITION_UNDECIDABLE',
  /**
   * A condition was recorded and nothing evaluated it.
   *
   * `compromise`. This is the registry's `declared-only` distinction applied to
   * a slot: a condition that is stored but never checked must never read as one
   * that held.
   */
  SLOT_CONDITION_UNENFORCED: 'SLOT_CONDITION_UNENFORCED',

  /* -- unplaced fixtures (incident 10) -------------------------------------- */
  /** A fixture that must exist has no legal slot and is carried TBD. `compromise`. */
  FIXTURE_TIME_TBD: 'FIXTURE_TIME_TBD',
  /**
   * An unplaced fixture carries no usable reason.
   *
   * `blocking`: *"kept with a reason"* is only as good as the reason, and a
   * category label is what made somebody derive the real one by hand.
   * `UnplacedFixtureSchema` refuses the empty string at the constructor; this
   * catches the one that gets past it — a reason that is nothing but
   * whitespace — at the reconciler, which is the layer a stored record would
   * arrive through.
   */
  FIXTURE_REASON_MISSING: 'FIXTURE_REASON_MISSING',
  /**
   * A fixture that must exist is neither placed nor reported unplaced.
   *
   * `blocking`, and the failure the whole of incident 10 is about: *"that's how
   * a team loses a game"*.
   */
  FIXTURE_DROPPED: 'FIXTURE_DROPPED',
  /** A fixture appears both placed and unplaced. `blocking`: the totals cannot both be right. */
  FIXTURE_DOUBLE_COUNTED: 'FIXTURE_DOUBLE_COUNTED',
  /** The accounting examined zero fixtures. `blocking`. */
  FIXTURE_ACCOUNTING_VACUOUS: 'FIXTURE_ACCOUNTING_VACUOUS',

  /* -- capacity ------------------------------------------------------------- */
  /** A date holds fewer slots than the stated requirement. `blocking`. */
  RESERVE_CAPACITY_BELOW_REQUIREMENT: 'RESERVE_CAPACITY_BELOW_REQUIREMENT',
  /**
   * A date holds exactly the requirement and not one slot more.
   *
   * `compromise`. Meeting a requirement with zero spare is a different fact from
   * meeting it comfortably, and it is the one an operator needs told.
   */
  RESERVE_CAPACITY_AT_REQUIREMENT: 'RESERVE_CAPACITY_AT_REQUIREMENT',
  /**
   * The date's slot count clears the requirement, but not once the conditional
   * slots' conditions are evaluated against what is already standing.
   *
   * `compromise`, and exactly the declared-versus-enforced gap this repository
   * keeps finding: a capacity tab that counts conditional ground as if it were
   * free is reporting a number nobody can use.
   */
  RESERVE_CAPACITY_CONDITIONAL_SHORTFALL: 'RESERVE_CAPACITY_CONDITIONAL_SHORTFALL',
  /** Reservations on a date exactly reach the external cap. Provenance. */
  RESERVE_CAP_REACHED: 'RESERVE_CAP_REACHED',
  /** Reservations on a date exceed the external cap. `blocking`. */
  RESERVE_CAP_EXCEEDED: 'RESERVE_CAP_EXCEEDED',
  /**
   * A reserved slot does not sit on any slot the capacity model generates.
   *
   * `blocking`. The model claims to describe the ground the club actually books;
   * a published reservation it cannot account for means the model is wrong, and
   * a capacity number from a wrong model is worse than none.
   */
  RESERVED_SLOT_OFF_GRID: 'RESERVED_SLOT_OFF_GRID',
  /** The capacity report examined zero dates, zero surfaces or generated zero slots. `blocking`. */
  RESERVE_CAPACITY_VACUOUS: 'RESERVE_CAPACITY_VACUOUS',
  /** A date's slot count is bounded by named availability constraints. Provenance. */
  RESERVE_CAPACITY_BOUND: 'RESERVE_CAPACITY_BOUND',
});

/**
 * Severity of every reason code.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const RESERVE_REASON_SEVERITY = Object.freeze({
  [RESERVE_REASON.RESERVED_SLOT_UNKNOWN]: RESERVE_SEVERITY.BLOCKING,
  [RESERVE_REASON.RESERVED_SLOT_TEAM_UNKNOWN]: RESERVE_SEVERITY.BLOCKING,
  [RESERVE_REASON.RESERVED_SLOT_SIDE_NOT_BINDABLE]: RESERVE_SEVERITY.BLOCKING,
  [RESERVE_REASON.RESERVED_SLOT_SIDE_ALREADY_NAMED]: RESERVE_SEVERITY.BLOCKING,
  [RESERVE_REASON.RESERVED_SLOT_SIDES_IDENTICAL]: RESERVE_SEVERITY.BLOCKING,
  [RESERVE_REASON.RESERVED_SLOT_TEAM_DOUBLE_BOOKED]: RESERVE_SEVERITY.BLOCKING,
  [RESERVE_REASON.RESERVED_SLOT_PARTIALLY_BOUND]: RESERVE_SEVERITY.COMPROMISE,
  [RESERVE_REASON.RESERVED_SLOT_BOUND]: RESERVE_SEVERITY.INFO,

  [RESERVE_REASON.RESERVED_SLOT_MOVED]: RESERVE_SEVERITY.BLOCKING,
  [RESERVE_REASON.RESERVED_SLOT_DROPPED]: RESERVE_SEVERITY.BLOCKING,
  [RESERVE_REASON.RESERVED_SLOT_COMPARISON_VACUOUS]: RESERVE_SEVERITY.BLOCKING,
  [RESERVE_REASON.RESERVED_SLOT_UNMOVED]: RESERVE_SEVERITY.INFO,

  [RESERVE_REASON.SLOT_CONDITION_SATISFIED]: RESERVE_SEVERITY.INFO,
  [RESERVE_REASON.SLOT_CONDITION_BLOCKED]: RESERVE_SEVERITY.INFO,
  [RESERVE_REASON.RESERVED_SLOT_CONDITION_BLOCKED]: RESERVE_SEVERITY.BLOCKING,
  [RESERVE_REASON.SLOT_CONDITION_UNDECIDABLE]: RESERVE_SEVERITY.COMPROMISE,
  [RESERVE_REASON.SLOT_CONDITION_UNENFORCED]: RESERVE_SEVERITY.COMPROMISE,

  [RESERVE_REASON.FIXTURE_TIME_TBD]: RESERVE_SEVERITY.COMPROMISE,
  [RESERVE_REASON.FIXTURE_REASON_MISSING]: RESERVE_SEVERITY.BLOCKING,
  [RESERVE_REASON.FIXTURE_DROPPED]: RESERVE_SEVERITY.BLOCKING,
  [RESERVE_REASON.FIXTURE_DOUBLE_COUNTED]: RESERVE_SEVERITY.BLOCKING,
  [RESERVE_REASON.FIXTURE_ACCOUNTING_VACUOUS]: RESERVE_SEVERITY.BLOCKING,

  [RESERVE_REASON.RESERVE_CAPACITY_BELOW_REQUIREMENT]: RESERVE_SEVERITY.BLOCKING,
  [RESERVE_REASON.RESERVE_CAPACITY_AT_REQUIREMENT]: RESERVE_SEVERITY.COMPROMISE,
  [RESERVE_REASON.RESERVE_CAPACITY_CONDITIONAL_SHORTFALL]: RESERVE_SEVERITY.COMPROMISE,
  [RESERVE_REASON.RESERVE_CAP_REACHED]: RESERVE_SEVERITY.INFO,
  [RESERVE_REASON.RESERVE_CAP_EXCEEDED]: RESERVE_SEVERITY.BLOCKING,
  [RESERVE_REASON.RESERVED_SLOT_OFF_GRID]: RESERVE_SEVERITY.BLOCKING,
  [RESERVE_REASON.RESERVE_CAPACITY_VACUOUS]: RESERVE_SEVERITY.BLOCKING,
  [RESERVE_REASON.RESERVE_CAPACITY_BOUND]: RESERVE_SEVERITY.INFO,
});

/**
 * Severity of a reserve reason code.
 *
 * Throws on an unknown code rather than defaulting to `info`, for the same
 * reason the nine modules before it do: a code with no severity is a code
 * somebody forgot to register, and defaulting would make it silently
 * non-blocking.
 *
 * @param {string} code
 * @returns {string} a {@link RESERVE_SEVERITY} value
 */
export function reserveSeverityOf(code) {
  const severity = RESERVE_REASON_SEVERITY[code];
  if (!severity) {
    throw new Error(`reserve: reason code "${code}" has no registered severity`);
  }
  return severity;
}

/**
 * Build a reserve finding. `severity` is looked up, never passed in.
 *
 * @param {string} code - a {@link RESERVE_REASON} value
 * @param {string} message - for humans only
 * @param {Record<string, unknown>} [details] - flat primitives and ids only
 * @returns {import('./types.js').ReserveFinding}
 */
export function makeReserveFinding(code, message, details = {}) {
  return { code, severity: reserveSeverityOf(code), message, details };
}

/**
 * Derive the status of a result mechanically from its findings.
 *
 * @param {ReadonlyArray<import('./types.js').ReserveFinding>} findings
 * @returns {string} a {@link RESERVE_STATUS} value
 */
export function deriveReserveStatus(findings) {
  return deriveConstraintStatus(
    /** @type {ReadonlyArray<import('../constraints/types.js').ConstraintFinding>} */ (findings)
  );
}

/**
 * Fresh zeroed counters.
 *
 * Every one of these is additive so {@link mergeReserveMeta} can fold a
 * per-date result into a whole-season one without any of them meaning something
 * different at the two scales. Facts that are *not* sums — the requirement, the
 * cap — live in the result body rather than here.
 *
 * @returns {import('./types.js').ReserveMeta}
 */
export function createReserveMeta() {
  return {
    /** Reserved slots this result looked at. */
    slotsExamined: 0,
    /** Bindings applied. */
    bindingsApplied: 0,
    /** Bindings refused, for any reason. */
    bindingsRefused: 0,
    /** Before/after slot pairs compared for movement. Never zero on a real run. */
    slotPairsCompared: 0,
    /** Slots that changed position. Never above zero. */
    slotsMoved: 0,
    /** Slots that carry a condition. */
    conditionsDeclared: 0,
    /** Conditions actually evaluated against bookings. */
    conditionsEvaluated: 0,
    /** Booking pairs the condition evaluation compared. */
    conditionBookingsCompared: 0,
    /** Dates the capacity report covered. */
    datesExamined: 0,
    /** Surface/date combinations the capacity report covered. */
    surfaceDatesExamined: 0,
    /** Candidate kickoffs put through `checkKickoffAvailability()`. */
    candidatesTested: 0,
    /** Candidates that survived and became slots. */
    slotsGenerated: 0,
    /** Reserved slots matched to a generated slot. */
    reservedSlotsMatched: 0,
    /** Reserved slots the model could not account for. Never above zero. */
    reservedSlotsOffGrid: 0,
    /** Fixtures the accounting reconciled. */
    fixturesAccountedFor: 0,
    /** Fixtures carried as TIME TBD. */
    fixturesTimeTbd: 0,
    /** Publication rows emitted. */
    rowsEmitted: 0,
  };
}

/**
 * Fold one set of counters into another.
 *
 * @param {import('./types.js').ReserveMeta} target
 * @param {import('./types.js').ReserveMeta} source
 * @returns {import('./types.js').ReserveMeta}
 */
export function mergeReserveMeta(target, source) {
  for (const key of Object.keys(target)) {
    target[key] += source[key] ?? 0;
  }
  return target;
}
