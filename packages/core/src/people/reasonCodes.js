/**
 * Machine-readable reason codes for the person-centric model: rosters and coach
 * slots, personal commitment timelines, derived must-attend, fallback priority
 * and identity resolution.
 *
 * Same two rules as `facility/reasonCodes.js`, `timing/reasonCodes.js`,
 * `availability/reasonCodes.js`, `constraints/reasonCodes.js` and
 * `waivers/reasonCodes.js`:
 *
 * 1. **`code` is the contract, `message` is decoration.** Never parse a message.
 * 2. **Severity lives in a table, never at a call site.**
 *
 * Severities and statuses are *imported* from the facility module rather than
 * redeclared, exactly as the other five modules import them, so a people finding
 * lands in the same list as a facility one and {@link derivePeopleStatus} reads
 * nothing but `finding.severity`.
 *
 * ## Why these codes are **not** merged into `BASE_REASON_SEVERITY`
 *
 * `constraints/baseSeverity.js` merges the tables of every module whose codes a
 * *constraint record may claim*. Exactly one code here is governed by a
 * constraint — {@link PEOPLE_REASON.PERSON_DAY_GAP_EXCEEDED}, which the
 * `coach-maximum-gap` record governs — and that record is `preference`-typed,
 * which by the registry's own definition means *"optimise toward; no violation
 * concept"*. Registering the code would let the record claim it and would move
 * `coach-maximum-gap` off `declared-only` while nothing in the solver optimises
 * toward it; that is precisely the "wired-looking but unwired" state Phase 2 was
 * told not to pretend. Severity for that one code therefore comes from the
 * record's own `type` through `severityForType()` — the same seam
 * `waivers/coachTravel.js` uses — with the frozen table below as the fallback
 * for the case where no record governs the policy at all.
 *
 * @module people/reasonCodes
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
export const PEOPLE_SEVERITY = FACILITY_SEVERITY;

/**
 * The three-state outcome of any person-centric check.
 *
 * @readonly
 * @enum {string}
 */
export const PEOPLE_STATUS = FACILITY_STATUS;

/**
 * Where a commitment came from.
 *
 * **This enum is the whole of requirement 2.** Incident 5 is not "a scrimmage
 * was missing"; it is "a scrimmage was appended *after* the solve, so the
 * optimiser never saw an evening commitment". A timeline that cannot say which
 * sources it was built from cannot tell those two states apart, so a partial
 * timeline and a complete one look identical to every consumer — which is
 * exactly how the 6.5-hour hole survived review.
 *
 * A source is *declared* when it is ingested, and `sealTimelines()` refuses to
 * seal a set whose required sources are not all declared. "The optimiser never
 * saw it" becomes a `blocking` finding rather than silence.
 *
 * @readonly
 * @enum {string}
 */
export const COMMITMENT_SOURCE = Object.freeze({
  /** A fixture the club itself scheduled: league games, minis sessions. */
  CLUB_FIXTURE: 'club-fixture',
  /** A fixture an external league published. Not ours to move. */
  EXTERNAL_FIXTURE: 'external-fixture',
  /** A friendly the club arranged, often late and often in the evening. */
  SCRIMMAGE: 'scrimmage',
  /** A non-club obligation a person declared. Never derived from a schedule. */
  NON_CLUB: 'non-club',
});

/** Every source value, sorted, for validation and for meta-assertions. */
export const COMMITMENT_SOURCES = Object.freeze(Object.values(COMMITMENT_SOURCE).sort());

/**
 * The lifecycle position of a coach assignment (GAP-23).
 *
 * The corpus carries `Assigned` on all 215 rows, which is a single-valued column
 * and *obviously* an enum position. Modelling it as one now is what makes
 * "declined" expressible later without the fallback logic having to change: a
 * person who declined is not a fallback, and that has to be a status question
 * rather than a deletion.
 *
 * @readonly
 * @enum {string}
 */
export const ASSIGNMENT_STATUS = Object.freeze({
  ASSIGNED: 'assigned',
  PENDING: 'pending',
  DECLINED: 'declined',
  WITHDRAWN: 'withdrawn',
});

/**
 * The statuses that actually put a person on a touchline.
 *
 * `pending` is deliberately **not** among them: a coach who has not accepted is
 * not fallback capacity, and counting them would make a sole-coach team look
 * covered.
 *
 * @type {ReadonlySet<string>}
 */
export const ACTIVE_ASSIGNMENT_STATUSES = Object.freeze(new Set([ASSIGNMENT_STATUS.ASSIGNED]));

/**
 * Why a person is must-attend. **Derived, never asserted about a named person.**
 *
 * @readonly
 * @enum {string}
 */
export const MUST_ATTEND_BASIS = Object.freeze({
  /**
   * The person is the *only* active coach of two or more teams. Nobody can
   * cover for them anywhere, so there is no fallback to fall back to.
   */
  SOLE_COACH_OF_MULTIPLE_TEAMS: 'sole-coach-of-multiple-teams',
  /**
   * A declared personal constraint says so — the single-car family, who could
   * not split. A *record*, entered by an operator, not a name in a source file.
   */
  DECLARED_PERSONAL_CONSTRAINT: 'declared-personal-constraint',
});

/**
 * What a declared personal constraint says.
 *
 * The policy ships **empty**: the corpus carries no such record, and seeding one
 * would put a real family's arrangement into a repository that
 * `CLAUDE.md` forbids from holding PII. The shape exists so the operator has
 * somewhere to put it, exactly as `facility/venueComplex.js` ships
 * `EMPTY_VENUE_COMPLEX_MAP`.
 *
 * @readonly
 * @enum {string}
 */
export const PERSONAL_CONSTRAINT_KIND = Object.freeze({
  /**
   * This person cannot be in two places on one day even when the clock allows
   * it — one car, one household, one journey.
   */
  CANNOT_SPLIT: 'cannot-split',
  /** This person is unavailable over the constraint's window. */
  UNAVAILABLE: 'unavailable',
});

/**
 * What happened to one team in a resolved attendance clash.
 *
 * @readonly
 * @enum {string}
 */
export const ATTENDANCE_OUTCOME = Object.freeze({
  /** The person stays with this team — they hold the lower coach slot here. */
  RETAINED: 'retained',
  /** A co-coach with no clash of their own covers this team. */
  FALLBACK: 'fallback',
  /** A co-coach exists but is themself clashing; the pair has to split. */
  FALLBACK_CONTESTED: 'fallback-contested',
  /** Nobody is left. This team has no coach for that commitment. */
  UNCOVERED: 'uncovered',
});

/**
 * The named pieces of evidence an identity proposal may carry.
 *
 * Every one of them is a *general* statement about two names. None of them
 * mentions a given-name pair, a nickname list, or anything else that would make
 * the corpus's own case pass while a different spelling of the same mistake
 * sailed through.
 *
 * @readonly
 * @enum {string}
 */
export const IDENTITY_SIGNAL = Object.freeze({
  /** The two family names are identical once normalised. */
  SURNAME_EXACT: 'SURNAME_EXACT',
  /**
   * The shorter given name is a **subsequence** of the longer one, shares its
   * first letter, and is strictly shorter.
   *
   * This is the general shape of a hypocorism formed by deletion — the family
   * that contains Tom/Thomas, Kate/Katherine, Dan/Daniel and Ben/Benjamin. It
   * is a rule about string structure; there is no list of names anywhere.
   */
  GIVEN_NAME_CONTRACTION: 'GIVEN_NAME_CONTRACTION',
  /** The two given names share a prefix of at least three characters. */
  GIVEN_NAME_PREFIX: 'GIVEN_NAME_PREFIX',
  /** Jaro-Winkler similarity of the two given names, as a strength in [0,1]. */
  GIVEN_NAME_SIMILARITY: 'GIVEN_NAME_SIMILARITY',
  /** The two given names begin with the same letter. */
  GIVEN_NAME_INITIAL: 'GIVEN_NAME_INITIAL',
  /**
   * The two identities are assigned to no team in common — consistent with
   * being one person seen twice.
   */
  TEAM_DISJOINT: 'TEAM_DISJOINT',
});

/**
 * How much each signal contributes to a proposal's confidence. **Frozen, and
 * summing to 1**, so a confidence is a weighted mean of strengths in [0,1] and
 * not an unbounded score whose meaning drifts with the signal list.
 *
 * @type {Readonly<Record<string, number>>}
 */
export const IDENTITY_SIGNAL_WEIGHT = Object.freeze({
  [IDENTITY_SIGNAL.SURNAME_EXACT]: 0.35,
  [IDENTITY_SIGNAL.GIVEN_NAME_CONTRACTION]: 0.3,
  [IDENTITY_SIGNAL.GIVEN_NAME_PREFIX]: 0.1,
  [IDENTITY_SIGNAL.GIVEN_NAME_SIMILARITY]: 0.15,
  [IDENTITY_SIGNAL.GIVEN_NAME_INITIAL]: 0.05,
  [IDENTITY_SIGNAL.TEAM_DISJOINT]: 0.05,
});

/**
 * Where a review-queue entry has got to.
 *
 * `pending` is the only state {@link IDENTITY_REVIEW_STATE} can be created in.
 * A merge exists only because a human moved an entry to `accepted`.
 *
 * @readonly
 * @enum {string}
 */
export const IDENTITY_REVIEW_STATE = Object.freeze({
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
});

/**
 * Every reason a person-centric check can give.
 *
 * @readonly
 * @enum {string}
 */
export const PEOPLE_REASON = Object.freeze({
  /* -- roster and coach slots (GAP-20, GAP-23) ----------------------------- */
  /** The roster holds no active assignment at all. Incident 4's shape. */
  ROSTER_EMPTY: 'ROSTER_EMPTY',
  /**
   * A team has exactly one active coach — the sole-coach risk register.
   * `info`: having one coach is not a violation of anything, it is a standing
   * absence of fallback capacity, and 50 of this corpus's 132 teams are in it.
   */
  TEAM_SOLE_COACH: 'TEAM_SOLE_COACH',
  /** A team has no active coach at all. */
  TEAM_UNCOACHED: 'TEAM_UNCOACHED',
  /** Two active assignments claim the same coach slot on one team. */
  ASSIGNMENT_SLOT_DUPLICATE: 'ASSIGNMENT_SLOT_DUPLICATE',
  /** One person holds two active assignments on one team. */
  ASSIGNMENT_PERSON_DUPLICATE: 'ASSIGNMENT_PERSON_DUPLICATE',
  /** An assignment references a person the roster does not carry. */
  ASSIGNMENT_PERSON_UNKNOWN: 'ASSIGNMENT_PERSON_UNKNOWN',
  /**
   * A person is the only active coach of two or more teams. The derived
   * must-attend case, and the one with no fallback anywhere.
   */
  PERSON_SOLE_COACH_OF_MULTIPLE_TEAMS: 'PERSON_SOLE_COACH_OF_MULTIPLE_TEAMS',
  /** The sole-coach scan examined zero teams. Incident 4. */
  SOLE_COACH_SCAN_VACUOUS: 'SOLE_COACH_SCAN_VACUOUS',

  /* -- the one coach model (8.2) ------------------------------------------ */
  /**
   * Two sources rank a team's coaches differently: the same person holds two
   * different slots, or the sources give the lowest slot to two different
   * people. The union is exported in the surviving source's order **and** this
   * is emitted, on the same contract as
   * `availability/`'s `LIGHTING_SOURCE_DISAGREES` — the disagreement is
   * surfaced, never resolved by picking a side.
   *
   * `compromise` rather than the lighting code's `info` for one reason: slot
   * order is the *clash-breaker*. `ATTENDANCE_RESOLVED_BY_SLOT` keeps the
   * person on the team where they hold the lower slot, so two sources that
   * disagree about the order make that resolution unreliable — the same thing
   * {@link PEOPLE_REASON.ATTENDANCE_SLOT_TIE} is a compromise for.
   */
  COACH_ORDER_SOURCE_DISAGREES: 'COACH_ORDER_SOURCE_DISAGREES',
  /**
   * A source omits a coach another source names for the same team. The union
   * is exported; the omission is reported. This is the 8.1 defect one level up
   * — a check keyed off the shorter source misses a real coach.
   */
  COACH_LIST_SOURCE_INCOMPLETE: 'COACH_LIST_SOURCE_INCOMPLETE',
  /**
   * Exactly one source carries this team's coaches, so the order was not
   * cross-checked against anything. **Not the same as agreement**, and said out
   * loud so it cannot be read as one.
   */
  COACH_LIST_UNCORROBORATED: 'COACH_LIST_UNCORROBORATED',
  /**
   * A coach arrived with no slot, so slot order cannot break their clashes.
   * They are still exported — every coach is on every artifact — and listed
   * after the slotted ones in id order. Reported rather than given a very large
   * slot number, which reads downstream as a genuine low-priority slot; the
   * same call {@link PEOPLE_REASON.ATTENDANCE_TEAM_LINK_MISSING} makes.
   */
  COACH_SLOT_UNDECLARED: 'COACH_SLOT_UNDECLARED',
  /**
   * The reconciliation examined zero coaches for a team the caller named, so
   * "no disagreement" says nothing. Incident 4's shape, in this module.
   */
  COACH_LIST_SCAN_VACUOUS: 'COACH_LIST_SCAN_VACUOUS',
  /**
   * An active assignment carries an effective window and the roster was built
   * with no as-of date, so the window could not be applied. The assignment is
   * still counted active — dropping a coach on a window nobody judged would be
   * the worse error — but "we applied the window" and "there was no window" are
   * different claims and this is the one that says which happened.
   *
   * The sibling of `CONSTRAINT_WINDOW_UNJUDGED`, and `compromise` for the same
   * reason, differing only in which way it fails safe: an unjudged *rule* does
   * not apply, because inventing a live rule is the risk there, while an
   * unjudged *coach* stays on the roster, because losing coverage is the risk
   * here. Both say so out loud rather than choosing in silence.
   */
  ASSIGNMENT_WINDOW_UNJUDGED: 'ASSIGNMENT_WINDOW_UNJUDGED',
  /**
   * A scheduled fixture names a team the roster carries with **no active
   * coach**, so no personal timeline can hold it. Incident 10: a fixture that
   * leaves the model without a word said about it is how a team loses a game.
   */
  FIXTURE_TEAM_UNCOACHED: 'FIXTURE_TEAM_UNCOACHED',

  /* -- the personal timeline (GAP-19) -------------------------------------- */
  /**
   * A source the caller required was never ingested. **Incident 5, made
   * representable**: this is the finding a solver gets instead of a plausible
   * timeline with an evening missing from it.
   */
  TIMELINE_SOURCE_NOT_INGESTED: 'TIMELINE_SOURCE_NOT_INGESTED',
  /**
   * A source was ingested and contributed **zero** commitments. `compromise`,
   * never silence: "we read the scrimmage file" and "the scrimmage file had
   * rows in it" are different claims, and incident 4 is what conflating them
   * looks like.
   */
  TIMELINE_SOURCE_EMPTY: 'TIMELINE_SOURCE_EMPTY',
  /**
   * Commitments were offered to a **sealed** timeline set. This is literally
   * the sentence "scrimmages were appended after solving", and it is
   * `blocking`.
   */
  TIMELINE_SEALED_APPEND: 'TIMELINE_SEALED_APPEND',
  /** A consumer that requires a sealed timeline set was handed an open one. */
  TIMELINE_NOT_SEALED: 'TIMELINE_NOT_SEALED',
  /** The timeline scan examined zero commitments. Incident 4. */
  TIMELINE_SCAN_VACUOUS: 'TIMELINE_SCAN_VACUOUS',
  /**
   * A commitment has no known end (GAP-14), so the day around it cannot be
   * measured. `compromise`, never `info` — a clean report over a commitment of
   * unknown length is a lie dressed as a pass.
   */
  COMMITMENT_FOOTPRINT_UNKNOWN: 'COMMITMENT_FOOTPRINT_UNKNOWN',
  /** Two consecutive commitments leave a gap longer than the policy allows. */
  PERSON_DAY_GAP_EXCEEDED: 'PERSON_DAY_GAP_EXCEEDED',
  /** No constraint record gives the maximum-gap policy a number here. */
  PERSON_DAY_GAP_UNGOVERNED: 'PERSON_DAY_GAP_UNGOVERNED',

  /* -- must-attend and fallback priority ----------------------------------- */
  /**
   * The declared-personal-constraint policy is empty. `info` provenance: the
   * derivation ran, and one of its two bases had nothing to say.
   */
  PERSONAL_CONSTRAINT_POLICY_EMPTY: 'PERSONAL_CONSTRAINT_POLICY_EMPTY',
  /** A declared personal constraint names a person no roster carries. */
  PERSONAL_CONSTRAINT_PERSON_UNKNOWN: 'PERSONAL_CONSTRAINT_PERSON_UNKNOWN',
  /**
   * A declared personal constraint carries a window and the derivation was
   * given no date, so the window could not be applied. The record is still
   * honoured, for the same reason an unjudged assignment window is: silently
   * dropping a declared must-attend is worse than reporting an unjudged one.
   */
  PERSONAL_CONSTRAINT_WINDOW_UNJUDGED: 'PERSONAL_CONSTRAINT_WINDOW_UNJUDGED',
  /** The clash was resolved by coach slot; the lower slot kept the person. */
  ATTENDANCE_RESOLVED_BY_SLOT: 'ATTENDANCE_RESOLVED_BY_SLOT',
  /**
   * Both teams give the person the same coach slot, so slot order cannot
   * decide. A deterministic tie-break is applied **and reported** — never
   * silently, on the same contract as `CONSTRAINT_PRECEDENCE_AMBIGUOUS`.
   */
  ATTENDANCE_SLOT_TIE: 'ATTENDANCE_SLOT_TIE',
  /** A must-attend person is wanted in two places; no resolution exists. */
  ATTENDANCE_MUST_ATTEND_UNRESOLVABLE: 'ATTENDANCE_MUST_ATTEND_UNRESOLVABLE',
  /**
   * A clashing commitment names a team the roster gives this person no active
   * slot on, so the clash could not be ranked by slot order. Reported rather
   * than encoded as a very large slot number, which reads downstream as a
   * genuine — and very low priority — coach slot.
   */
  ATTENDANCE_TEAM_LINK_MISSING: 'ATTENDANCE_TEAM_LINK_MISSING',
  /** The losing team is covered by a co-coach — recorded as its conflict. */
  TEAM_FALLBACK_TO_CO_COACH: 'TEAM_FALLBACK_TO_CO_COACH',
  /** The losing team's only co-coach is clashing too; the pair must split. */
  TEAM_FALLBACK_CONTESTED: 'TEAM_FALLBACK_CONTESTED',
  /** The losing team has no other active coach. Nobody is on that touchline. */
  TEAM_NO_FALLBACK_AVAILABLE: 'TEAM_NO_FALLBACK_AVAILABLE',
  /** The attendance scan examined zero clashes. Incident 4. */
  ATTENDANCE_SCAN_VACUOUS: 'ATTENDANCE_SCAN_VACUOUS',

  /* -- identity resolution (GAP-21, GAP-22) -------------------------------- */
  /**
   * Two identities are probably one person. **Queued, never merged.**
   * `compromise`: an unreviewed probable duplicate is an unresolved risk, and
   * incident 6 is what it costs when one sits unnoticed.
   */
  IDENTITY_REVIEW_PENDING: 'IDENTITY_REVIEW_PENDING',
  /**
   * A candidate pair was refused before it could be scored, because the two
   * identities coach the same team — which makes them two people, not one.
   */
  IDENTITY_MATCH_VETOED: 'IDENTITY_MATCH_VETOED',
  /** The identity scan compared zero pairs. Incident 4. */
  IDENTITY_SCAN_VACUOUS: 'IDENTITY_SCAN_VACUOUS',
  /** A decision names a review entry the queue does not hold. */
  IDENTITY_DECISION_UNKNOWN_ENTRY: 'IDENTITY_DECISION_UNKNOWN_ENTRY',
  /** A human accepted a proposal and two identities became one. Provenance. */
  IDENTITY_MERGE_APPLIED: 'IDENTITY_MERGE_APPLIED',
});

/**
 * Severity of every reason code.
 *
 * {@link PEOPLE_REASON.PERSON_DAY_GAP_EXCEEDED} is the one entry that is only a
 * *fallback*: when a constraint record governs the maximum-gap policy, that
 * record's `type` decides. See the module docstring.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const PEOPLE_REASON_SEVERITY = Object.freeze({
  [PEOPLE_REASON.ROSTER_EMPTY]: PEOPLE_SEVERITY.BLOCKING,
  [PEOPLE_REASON.TEAM_SOLE_COACH]: PEOPLE_SEVERITY.INFO,
  [PEOPLE_REASON.TEAM_UNCOACHED]: PEOPLE_SEVERITY.BLOCKING,
  [PEOPLE_REASON.ASSIGNMENT_SLOT_DUPLICATE]: PEOPLE_SEVERITY.BLOCKING,
  [PEOPLE_REASON.ASSIGNMENT_PERSON_DUPLICATE]: PEOPLE_SEVERITY.COMPROMISE,
  [PEOPLE_REASON.ASSIGNMENT_PERSON_UNKNOWN]: PEOPLE_SEVERITY.BLOCKING,
  [PEOPLE_REASON.PERSON_SOLE_COACH_OF_MULTIPLE_TEAMS]: PEOPLE_SEVERITY.COMPROMISE,
  [PEOPLE_REASON.SOLE_COACH_SCAN_VACUOUS]: PEOPLE_SEVERITY.COMPROMISE,
  [PEOPLE_REASON.ASSIGNMENT_WINDOW_UNJUDGED]: PEOPLE_SEVERITY.COMPROMISE,
  [PEOPLE_REASON.FIXTURE_TEAM_UNCOACHED]: PEOPLE_SEVERITY.BLOCKING,
  [PEOPLE_REASON.COACH_ORDER_SOURCE_DISAGREES]: PEOPLE_SEVERITY.COMPROMISE,
  [PEOPLE_REASON.COACH_LIST_SOURCE_INCOMPLETE]: PEOPLE_SEVERITY.COMPROMISE,
  [PEOPLE_REASON.COACH_LIST_UNCORROBORATED]: PEOPLE_SEVERITY.INFO,
  [PEOPLE_REASON.COACH_SLOT_UNDECLARED]: PEOPLE_SEVERITY.COMPROMISE,
  [PEOPLE_REASON.COACH_LIST_SCAN_VACUOUS]: PEOPLE_SEVERITY.COMPROMISE,

  [PEOPLE_REASON.TIMELINE_SOURCE_NOT_INGESTED]: PEOPLE_SEVERITY.BLOCKING,
  [PEOPLE_REASON.TIMELINE_SOURCE_EMPTY]: PEOPLE_SEVERITY.COMPROMISE,
  [PEOPLE_REASON.TIMELINE_SEALED_APPEND]: PEOPLE_SEVERITY.BLOCKING,
  [PEOPLE_REASON.TIMELINE_NOT_SEALED]: PEOPLE_SEVERITY.BLOCKING,
  [PEOPLE_REASON.TIMELINE_SCAN_VACUOUS]: PEOPLE_SEVERITY.COMPROMISE,
  [PEOPLE_REASON.COMMITMENT_FOOTPRINT_UNKNOWN]: PEOPLE_SEVERITY.COMPROMISE,
  [PEOPLE_REASON.PERSON_DAY_GAP_EXCEEDED]: PEOPLE_SEVERITY.COMPROMISE,
  [PEOPLE_REASON.PERSON_DAY_GAP_UNGOVERNED]: PEOPLE_SEVERITY.COMPROMISE,

  [PEOPLE_REASON.PERSONAL_CONSTRAINT_POLICY_EMPTY]: PEOPLE_SEVERITY.INFO,
  [PEOPLE_REASON.PERSONAL_CONSTRAINT_PERSON_UNKNOWN]: PEOPLE_SEVERITY.BLOCKING,
  [PEOPLE_REASON.PERSONAL_CONSTRAINT_WINDOW_UNJUDGED]: PEOPLE_SEVERITY.COMPROMISE,
  [PEOPLE_REASON.ATTENDANCE_RESOLVED_BY_SLOT]: PEOPLE_SEVERITY.INFO,
  [PEOPLE_REASON.ATTENDANCE_SLOT_TIE]: PEOPLE_SEVERITY.COMPROMISE,
  [PEOPLE_REASON.ATTENDANCE_MUST_ATTEND_UNRESOLVABLE]: PEOPLE_SEVERITY.BLOCKING,
  [PEOPLE_REASON.ATTENDANCE_TEAM_LINK_MISSING]: PEOPLE_SEVERITY.COMPROMISE,
  [PEOPLE_REASON.TEAM_FALLBACK_TO_CO_COACH]: PEOPLE_SEVERITY.COMPROMISE,
  [PEOPLE_REASON.TEAM_FALLBACK_CONTESTED]: PEOPLE_SEVERITY.COMPROMISE,
  [PEOPLE_REASON.TEAM_NO_FALLBACK_AVAILABLE]: PEOPLE_SEVERITY.BLOCKING,
  [PEOPLE_REASON.ATTENDANCE_SCAN_VACUOUS]: PEOPLE_SEVERITY.COMPROMISE,

  [PEOPLE_REASON.IDENTITY_REVIEW_PENDING]: PEOPLE_SEVERITY.COMPROMISE,
  [PEOPLE_REASON.IDENTITY_MATCH_VETOED]: PEOPLE_SEVERITY.INFO,
  [PEOPLE_REASON.IDENTITY_SCAN_VACUOUS]: PEOPLE_SEVERITY.COMPROMISE,
  [PEOPLE_REASON.IDENTITY_DECISION_UNKNOWN_ENTRY]: PEOPLE_SEVERITY.BLOCKING,
  [PEOPLE_REASON.IDENTITY_MERGE_APPLIED]: PEOPLE_SEVERITY.INFO,
});

/**
 * The codes whose severity a constraint record may override, paired with the
 * policy that governs them.
 *
 * One entry, and it is deliberately a table rather than an `if`: when a second
 * policy-governed code arrives it goes here, and `peopleSeverityOf()` does not
 * change.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const PEOPLE_POLICY_BY_CODE = Object.freeze({
  [PEOPLE_REASON.PERSON_DAY_GAP_EXCEEDED]: 'coach-maximum-gap',
});

/**
 * Severity of a people reason code under a given constraint record.
 *
 * Throws on an unknown code rather than defaulting to `info`, for the same
 * reason every other module's `severityOf()` does: a code with no severity is a
 * code somebody forgot to register, and defaulting would make it silently
 * non-blocking.
 *
 * @param {string} code - a {@link PEOPLE_REASON} value
 * @param {import('../constraints/types.js').ConstraintRecord|null} [record]
 * @returns {string} a {@link PEOPLE_SEVERITY} value
 */
export function peopleSeverityOf(code, record = null) {
  const fallback = PEOPLE_REASON_SEVERITY[code];
  if (!fallback) {
    throw new Error(`people: reason code "${code}" has no registered severity`);
  }
  if (record === null) return fallback;
  if (!(code in PEOPLE_POLICY_BY_CODE)) return fallback;
  return severityForType(record.type);
}

/**
 * Build a people finding. `severity` is looked up from a frozen table (or from
 * the governing record's type), never passed in.
 *
 * @param {string} code - a {@link PEOPLE_REASON} value
 * @param {string} message - for humans only
 * @param {Record<string, unknown>} [details] - flat primitives and ids only
 * @param {import('../constraints/types.js').ConstraintRecord|null} [record]
 * @returns {import('./types.js').PeopleFinding}
 */
export function makePeopleFinding(code, message, details = {}, record = null) {
  return { code, severity: peopleSeverityOf(code, record), message, details };
}

/**
 * Derive the status of a check mechanically from its findings.
 *
 * @param {ReadonlyArray<import('./types.js').PeopleFinding>} findings
 * @returns {string} a {@link PEOPLE_STATUS} value
 */
export function derivePeopleStatus(findings) {
  return deriveFacilityStatus(
    /** @type {ReadonlyArray<import('../facility/types.js').FacilityFinding>} */ (findings)
  );
}

/**
 * Fresh zeroed counters.
 *
 * Incident 4 is a validator that matched zero records and reported a perfect
 * score. Every result in this module carries these so a test can assert the
 * check was not vacuous — and every counter here is one a real break would
 * drive to zero, rather than one derived from the same data the break corrupts.
 *
 * @returns {import('./types.js').PeopleMeta}
 */
export function createPeopleMeta() {
  return {
    /* roster */
    peopleExamined: 0,
    assignmentsExamined: 0,
    assignmentsActive: 0,
    assignmentsInactive: 0,
    teamsExamined: 0,
    soleCoachTeams: 0,
    uncoachedTeams: 0,
    multiTeamPeople: 0,
    /* the one coach model */
    coachListsExamined: 0,
    coachesExported: 0,
    coachListSourcesRead: 0,
    /* timeline */
    commitmentsIngested: 0,
    commitmentsExamined: 0,
    sourcesDeclared: 0,
    sourcesRequired: 0,
    timelinesBuilt: 0,
    personDaysExamined: 0,
    transitionsExamined: 0,
    transitionsJudged: 0,
    gapPoliciesResolved: 0,
    /* attendance */
    clashesExamined: 0,
    clashesResolved: 0,
    fallbacksFound: 0,
    mustAttendPeople: 0,
    personalConstraintsExamined: 0,
    /* identity */
    identityBlocksExamined: 0,
    identityPairsCompared: 0,
    identityCandidates: 0,
    identityProposals: 0,
    identityVetoed: 0,
    identityMergesApplied: 0,
  };
}

/**
 * Add one counter set into another, in place.
 *
 * @param {import('./types.js').PeopleMeta} target
 * @param {import('./types.js').PeopleMeta} source
 * @returns {import('./types.js').PeopleMeta}
 */
export function mergePeopleMeta(target, source) {
  for (const key of Object.keys(target)) {
    target[key] += source[key] ?? 0;
  }
  return target;
}
