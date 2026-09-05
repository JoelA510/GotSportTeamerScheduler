/**
 * Type definitions for the person-centric model.
 *
 * JSDoc typedefs only — this file emits no runtime code, exactly as
 * `facility/types.js`, `timing/types.js`, `availability/types.js`,
 * `constraints/types.js` and `waivers/types.js` do for their modules.
 *
 * ## The one distinction that matters here
 *
 * A {@link Person} is **not** a `Profile` (GAP-22). `Profile` requires an Auth
 * UUID, an email and an organization id; a coach who has never logged in has
 * none of those, and `CLAUDE.md`'s data-minimisation rule forbids inventing
 * one to make the type fit. A `Person` carries a name, an id whose provenance
 * is stated, and an alias set — and nothing else. Linking a `Person` to a
 * `Profile` is a later concern and deliberately not modelled here, because the
 * moment the two are one type, every coach needs an account.
 *
 * @module people/types
 */

/**
 * A finding: `{ code, severity, message, details }`.
 *
 * Structurally identical to `FacilityFinding` — deliberately, so people,
 * facility, timing, availability, constraint and waiver findings live in one
 * list and one `derive*Status()` reads them all.
 *
 * @typedef {import('../facility/types.js').FacilityFinding} PeopleFinding
 */

/**
 * @typedef {Object} PeopleMeta
 * @property {number} peopleExamined
 * @property {number} assignmentsExamined
 * @property {number} assignmentsActive
 * @property {number} assignmentsInactive
 * @property {number} teamsExamined
 * @property {number} soleCoachTeams
 * @property {number} uncoachedTeams
 * @property {number} multiTeamPeople
 * @property {number} coachListsExamined
 * @property {number} coachesExported
 * @property {number} coachListSourcesRead
 * @property {number} commitmentsIngested
 * @property {number} commitmentsExamined
 * @property {number} sourcesDeclared
 * @property {number} sourcesRequired
 * @property {number} timelinesBuilt
 * @property {number} personDaysExamined
 * @property {number} transitionsExamined
 * @property {number} transitionsJudged
 * @property {number} gapPoliciesResolved
 * @property {number} clashesExamined
 * @property {number} clashesResolved
 * @property {number} fallbacksFound
 * @property {number} mustAttendPeople
 * @property {number} personalConstraintsExamined
 * @property {number} identityBlocksExamined
 * @property {number} identityPairsCompared
 * @property {number} identityCandidates
 * @property {number} identityProposals
 * @property {number} identityVetoed
 * @property {number} identityMergesApplied
 */

/**
 * A person the club knows about, independent of whether they have an account.
 *
 * @typedef {Object} Person
 * @property {string} id - stable within one roster revision; **not** a UUID
 * @property {string} givenName
 * @property {string} familyName
 * @property {string} displayName
 * @property {string[]} aliases - other spellings this id has been seen under
 */

/**
 * One person's appointment to one team, with its slot and its lifecycle
 * position (GAP-20 and GAP-23).
 *
 * @typedef {Object} CoachAssignment
 * @property {string} id
 * @property {string} personId
 * @property {string} teamId
 * @property {number} slot - 1 is the team's primary coach; lower wins a clash
 * @property {string} status - an `ASSIGNMENT_STATUS` value
 * @property {string|null} effectiveFrom - applied against `buildCoachRoster()`'s `asOf`
 * @property {string|null} effectiveTo - applied against `buildCoachRoster()`'s `asOf`
 * @property {string|null} source
 */

/**
 * The assembled roster: people, their assignments, and the two indexes every
 * downstream question needs.
 *
 * @typedef {Object} CoachRoster
 * @property {ReadonlyMap<string, Person>} peopleById
 * @property {ReadonlyMap<string, TeamCoaching>} teams - keyed by team id
 * @property {ReadonlyMap<string, ReadonlyArray<CoachAssignment>>} assignmentsByPerson
 * @property {ReadonlyArray<CoachAssignment>} assignments - active ones only
 * @property {PeopleFinding[]} findings
 * @property {PeopleMeta} meta
 * @property {string} status
 */

/**
 * @typedef {Object} TeamCoaching
 * @property {string} teamId
 * @property {ReadonlyArray<CoachAssignment>} slots - sorted by slot ascending; empty when uncoached
 * @property {ReadonlyArray<string>} personIds - sorted by slot ascending; empty when uncoached
 */

/**
 * One coach on a reconciled team coach list. `slot` is the club's declared
 * order and is `null` when no source gave one; it is a tie-break, never a role.
 *
 * @typedef {Object} ReconciledCoach
 * @property {string} personId
 * @property {string|null} displayName
 * @property {string|null} email
 * @property {number|null} slot - lowest slot any source gives them; null when none does
 * @property {ReadonlyArray<string>} sourceIds - every source naming them, sorted
 */

/**
 * A team's coaches as every source together sees them.
 *
 * @typedef {Object} TeamCoachList
 * @property {string} teamId
 * @property {ReadonlyArray<ReconciledCoach>} coaches - slot ascending, unslotted last, ties by id
 * @property {ReadonlyArray<string>} personIds - the same order
 * @property {boolean} orderCrossChecked - two or more sources ranked this team, agreeing or not
 * @property {PeopleFinding[]} findings
 * @property {PeopleMeta} meta
 * @property {string} status
 */

/**
 * One commitment on one person's day.
 *
 * `endMinutes` is nullable so a row of unknown footprint stays representable
 * (GAP-14) instead of being coerced into a plausible-looking number, and
 * `source` is required so a timeline can say what it was built from.
 *
 * @typedef {Object} PersonCommitment
 * @property {string} id
 * @property {string} personId
 * @property {string} date - `YYYY-MM-DD`
 * @property {number} startMinutes - minutes past midnight
 * @property {number|null} endMinutes
 * @property {string} venueId
 * @property {string|null} surfaceId
 * @property {string|null} teamId
 * @property {string|null} gameId
 * @property {string|null} label
 * @property {string} source - a `COMMITMENT_SOURCE` value
 */

/**
 * A set of personal timelines, plus the record of what it was built from.
 *
 * Immutable: `ingestCommitments()` and `sealTimelines()` both return a new set.
 *
 * @typedef {Object} TimelineSet
 * @property {ReadonlyMap<string, ReadonlyArray<PersonCommitment>>} byPerson
 * @property {ReadonlyArray<string>} sources - sources actually ingested, sorted
 * @property {ReadonlyArray<string>} requiredSources - sorted; empty until sealed
 * @property {boolean} sealed
 * @property {PeopleFinding[]} findings
 * @property {PeopleMeta} meta
 * @property {string} status
 */

/**
 * One person's one day, as a shape rather than a list.
 *
 * @typedef {Object} PersonDay
 * @property {string} id - `<personId>|<date>`
 * @property {string} personId
 * @property {string} date
 * @property {ReadonlyArray<PersonCommitment>} commitments - sorted
 * @property {number} firstStartMinutes
 * @property {number|null} lastEndMinutes - the latest end, null when any commitment's end is unknown
 * @property {number|null} spanMinutes
 * @property {ReadonlyArray<PersonTransition>} transitions
 * @property {number|null} idleMinutes - total measurable gap between commitments
 * @property {PeopleFinding[]} findings
 * @property {string} status
 */

/**
 * A move between two **consecutive** commitments on one person's day.
 *
 * The word consecutive is the whole point of requirement 1: this is a pair of
 * neighbours in one sorted timeline, not a pair drawn from two team schedules.
 *
 * @typedef {Object} PersonTransition
 * @property {string} id
 * @property {string} personId
 * @property {string} date
 * @property {PersonCommitment} from
 * @property {PersonCommitment} to
 * @property {number|null} gapMinutes - null when `from` has no known end
 * @property {boolean} sameTeam
 */

/**
 * Two commitments one person cannot both keep.
 *
 * @typedef {Object} AttendanceClash
 * @property {string} id
 * @property {string} personId
 * @property {string} date
 * @property {PersonCommitment} from
 * @property {PersonCommitment} to
 * @property {number|null} overlapMinutes - null when the later commitment has no known end
 */

/**
 * What a person's must-attend status is, and why.
 *
 * @typedef {Object} MustAttendVerdict
 * @property {string} personId
 * @property {boolean} mustAttend
 * @property {ReadonlyArray<string>} bases - `MUST_ATTEND_BASIS` values, sorted
 * @property {ReadonlyArray<string>} teamIds - teams the basis was derived over
 */

/**
 * How one clash was resolved: who the person stays with, and what happens to
 * the team they leave.
 *
 * @typedef {Object} AttendanceResolution
 * @property {string} id
 * @property {string} personId
 * @property {string} date
 * @property {string|null} retainedTeamId
 * @property {number|null} retainedSlot
 * @property {string|null} releasedTeamId
 * @property {number|null} releasedSlot
 * @property {string} outcome - an `ATTENDANCE_OUTCOME` value for the released team
 * @property {ReadonlyArray<string>} fallbackPersonIds
 * @property {boolean} mustAttend
 * @property {PeopleFinding[]} findings
 * @property {string} status
 */

/**
 * One proposal that two identities are the same person. **A proposal, not a
 * merge.**
 *
 * @typedef {Object} IdentityProposal
 * @property {string} id - `<leftId>::<rightId>`, ids sorted
 * @property {string} leftPersonId
 * @property {string} rightPersonId
 * @property {number} confidence - weighted mean of signal strengths, in [0,1]
 * @property {ReadonlyArray<IdentityEvidence>} evidence
 * @property {string} state - an `IDENTITY_REVIEW_STATE` value
 */

/**
 * @typedef {Object} IdentityEvidence
 * @property {string} signal - an `IDENTITY_SIGNAL` value
 * @property {number} weight
 * @property {number} strength - in [0,1]
 * @property {string} note - what was actually observed
 */

/**
 * The review queue. Nothing merges until a human moves an entry.
 *
 * @typedef {Object} IdentityReviewQueue
 * @property {ReadonlyArray<IdentityProposal>} entries
 * @property {ReadonlyArray<string>} personIds - the identities that were scanned
 * @property {PeopleFinding[]} findings
 * @property {PeopleMeta} meta
 * @property {string} status
 */

/**
 * A declared personal constraint — the single-car family, written down.
 *
 * @typedef {Object} PersonalConstraint
 * @property {string} id
 * @property {string} personId
 * @property {string} kind - a `PERSONAL_CONSTRAINT_KIND` value
 * @property {string[]|null} teamIds
 * @property {string|null} fromDate
 * @property {string|null} toDate
 * @property {string} rationale
 * @property {{ setBy: string, setAt: string|null, reference: string|null, note: string|null }} source
 */

/**
 * @typedef {Object} PersonalConstraintPolicy
 * @property {ReadonlyArray<PersonalConstraint>} constraints
 * @property {ReadonlyMap<string, ReadonlyArray<PersonalConstraint>>} byPerson
 */

export {};
