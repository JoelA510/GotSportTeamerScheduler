/**
 * JSDoc typedefs for the waiver ledger.
 *
 * Type-only module: no runtime exports, ending in `export {};` so it stays a
 * module, exactly like `facility/types.js` and `constraints/types.js`.
 *
 * The model this file describes is [GAP-26](../../../../docs/MODEL_GAPS.md#gap-26).
 * What it replaces is not a bad abstraction but the *absence* of one: incident 9
 * in `fixtures/season-2026/README.md` records a board-approved exception to the
 * 60-minute inter-venue travel floor that lived in a code comment, was lost
 * across a rebuild, became unnecessary when times shifted, and then became
 * relevant again. Every field below exists because one step of that lifecycle
 * was unrepresentable.
 *
 * @module waivers/types
 */

/**
 * Who approved a waiver, when, and on the strength of what.
 *
 * `approvedBy` and `reference` are **required and non-empty**: an exception
 * nobody is named as having granted is the code comment again, wearing a
 * schema. `approvedAt` is *nullable* for the same reason
 * `ConstraintSource.setAt` is — incident 9's approval survives only as a
 * sentence in the log, which preserves the order events happened in but not
 * their dates, and a plausible-looking invented date is worse than an admitted
 * absence. When `approvedAt` is null, `note` must say why.
 *
 * @typedef {Object} WaiverApproval
 * @property {string} approvedBy - the person or body that granted it
 * @property {string|null} approvedAt - ISO `YYYY-MM-DD`, or null when unrecorded
 * @property {string} reference - where to go and read the decision
 * @property {string|null} note - required when `approvedAt` is null
 */

/**
 * What a waiver reaches.
 *
 * Unlike `ConstraintScope`, **several dimensions may be named at once** and
 * they compose as a conjunction: every dimension the waiver names must match
 * the subject. Incident 9's waiver is genuinely two-dimensional — *this coach*,
 * *between these two venues* — and a one-axis scope could only express it by
 * throwing half of it away.
 *
 * The reason a constraint scope may not do this, and a waiver scope may:
 * constraint precedence rests on a specificity rank, and a two-axis scope has
 * no defensible rank against a one-axis scope. Waivers never compete for
 * precedence. Two waivers that both apply both apply.
 *
 * `venueIds` is a **set the waiver covers**, and a subject matches when every
 * venue it touches is in that set. "These two sites are five minutes apart" is
 * a statement about a pair, and a subject that wanders to a third venue is not
 * the thing the board approved.
 *
 * @typedef {Object} WaiverScope
 * @property {string|null} personId
 * @property {string|null} teamId
 * @property {string|null} gameId
 * @property {string[]|null} venueIds - the venues the exception covers
 * @property {string|null} surfaceId
 * @property {string|null} divisionLabel - a label, not a key (GAP-24)
 * @property {string|null} date - ISO `YYYY-MM-DD`
 * @property {string|null} fromDate - inclusive
 * @property {string|null} toDate - inclusive
 * @property {string|null} label - display text, never parsed
 */

/**
 * One waiver, as a record rather than as a comment.
 *
 * Note what is **not** here: any field named `dormant`, `active`, `inUse` or
 * `lastFired`. Dormancy is a property of a waiver *and a schedule together*,
 * and the moment it is stored on the record it is a cache that goes stale the
 * next time anything moves — which is the second half of incident 9, where the
 * waiver became unnecessary and then necessary again without anybody editing
 * it. `detectDormantWaivers()` computes it, every time, from the solve in
 * front of it. The schema is `.strict()`, so a record that tries to carry a
 * `dormant` field is rejected rather than believed.
 *
 * @typedef {Object} WaiverRecord
 * @property {string} id
 * @property {string} constraintId - the constraint this excepts
 * @property {string} name - display label
 * @property {WaiverScope} scope
 * @property {string[]} reasonCodes - the codes it excuses; empty means "all the
 *   constraint governs"
 * @property {string} reason - why the exception was granted. Required.
 * @property {WaiverApproval} approval
 * @property {string|null} effectiveFrom - inclusive ISO date, null for "always"
 * @property {string|null} effectiveTo - the optional expiry; null for "no expiry"
 * @property {Record<string, number|string|boolean|null>} parameters - the facts
 *   the approval rested on, e.g. `{ observedTravelMinutes: 5 }`
 */

/**
 * The built ledger. Deep-frozen; every mutation returns a new one.
 *
 * @typedef {Object} WaiverLedger
 * @property {string|null} name
 * @property {string|null} source
 * @property {WaiverRecord[]} waivers - sorted by id
 * @property {string[]} waiverIds
 * @property {Record<string, WaiverRecord>} byId
 * @property {Record<string, string[]>} idsByConstraint
 * @property {string[]} constraintIds
 * @property {string} status - a `WAIVER_STATUS` value
 * @property {WaiverFinding[]} findings
 * @property {WaiverMeta} meta
 * @property {WaiverLedgerStats} stats
 */

/**
 * Structural counts, so a test can meta-assert the *ledger* before asserting
 * any behaviour on it.
 *
 * @typedef {Object} WaiverLedgerStats
 * @property {number} waiverCount
 * @property {number} constraintCount - distinct constraints excepted
 * @property {number} expiringCount - records with an expiry
 * @property {number} openEndedCount - records with none
 * @property {number} datedApprovalCount - records whose approval carries a date
 * @property {number} scopeDimensionCount - total dimensions named across records
 * @property {number} codeNarrowedCount - records that name specific reason codes
 */

/**
 * Counters proving a check actually looked at something.
 *
 * @typedef {Object} WaiverMeta
 * @property {number} waiversConsidered
 * @property {number} waiversApplicable
 * @property {number} waiversInactive
 * @property {number} waiversOutOfScope
 * @property {number} waiversUnjudged
 * @property {number} waiversApplied - waiver x subject pairs where one fired
 * @property {number} scopeDimensionsTested
 * @property {number} subjectsExamined
 * @property {number} findingsExamined
 * @property {number} findingsWaived
 * @property {number} constraintsLinked
 * @property {number} dormancyProbes
 */

/**
 * One machine-readable reason. Identical in shape to `FacilityFinding`,
 * `TimingFinding`, `AvailabilityFinding` and `ConstraintFinding`.
 *
 * @typedef {Object} WaiverFinding
 * @property {string} code
 * @property {string} severity
 * @property {string} message
 * @property {Record<string, unknown>} details
 */

/**
 * Where a caller is standing when it asks the ledger a question.
 *
 * Every field is optional, and an absent field is *not* a wildcard: a
 * person-scoped waiver judged against a subject with no `personId` is reported
 * `WAIVER_SCOPE_UNJUDGED`, never quietly applied and never quietly dropped.
 *
 * @typedef {Object} WaiverContext
 * @property {string} [date] - ISO `YYYY-MM-DD`
 * @property {string} [personId]
 * @property {string[]} [personIds]
 * @property {string} [teamId]
 * @property {string[]} [teamIds]
 * @property {string} [gameId]
 * @property {string[]} [gameIds]
 * @property {string} [venueId]
 * @property {string[]} [venueIds] - every venue the subject touches
 * @property {string} [surfaceId]
 * @property {string[]} [surfaceLineage]
 * @property {string} [divisionLabel]
 */

/**
 * Why one waiver did or did not reach one subject.
 *
 * @typedef {Object} WaiverApplicability
 * @property {string} waiverId
 * @property {string} constraintId
 * @property {boolean} applicable
 * @property {boolean} inWindow
 * @property {boolean} inScope
 * @property {boolean} judged - false when the subject could not decide
 * @property {number} specificity - narrowest dimension it names
 * @property {string[]} dimensions - the dimensions it names, sorted
 * @property {string|null} code - the `WAIVER_REASON` explaining a `false`
 */

/**
 * One subject handed to the applier: a game, a candidate placement, a coach's
 * transition between two commitments.
 *
 * @typedef {Object} WaiverSubject
 * @property {string} id
 * @property {WaiverContext} [context]
 * @property {ReadonlyArray<WaiverFinding>} findings
 * @property {Record<string, unknown>} [details] - carried through to annotations
 */

/**
 * One subject after the ledger has spoken.
 *
 * @typedef {Object} WaivedSubject
 * @property {string} id
 * @property {WaiverFinding[]} findings - originals (re-severitied where waived)
 *   plus the module's own provenance findings
 * @property {string} status - a `WAIVER_STATUS` value
 * @property {string} statusWithoutWaivers - what it would be with none applied
 * @property {string} disposition - a `WAIVER_DISPOSITION` value
 * @property {string[]} appliedWaiverIds
 * @property {WaiverApplicability[]} applicability
 * @property {number} waivedCount
 * @property {number} uncoveredViolationCount
 */

/**
 * The whole result of applying a ledger to a set of subjects.
 *
 * @typedef {Object} WaiverApplication
 * @property {WaivedSubject[]} subjects
 * @property {Record<string, WaivedSubject>} byId
 * @property {WaiverFinding[]} findings - every subject's findings, flattened,
 *   plus ledger-level ones
 * @property {string} status
 * @property {string} disposition
 * @property {WaiverAnnotation[]} annotations
 * @property {string[]} appliedWaiverIds
 * @property {WaiverMeta} meta
 */

/**
 * One row-level annotation for published output.
 *
 * Shaped for a schedule row rather than for this module: `subjectId` is the row
 * key the caller handed in, and `note` is a one-line rendering ready for a
 * `Notes` cell. The structured fields are kept beside it so a richer renderer
 * does not have to parse the sentence.
 *
 * @typedef {Object} WaiverAnnotation
 * @property {string} subjectId
 * @property {string} waiverId
 * @property {string} constraintId
 * @property {string[]} reasonCodes - the codes actually waived on this subject
 * @property {string} reason
 * @property {string} approvedBy
 * @property {string|null} approvedAt
 * @property {string|null} expiresOn
 * @property {string} note - a one-line rendering for a `Notes` column
 * @property {Record<string, unknown>} details - the subject's own details
 */

/**
 * One waiver's dormancy verdict for one solve.
 *
 * @typedef {Object} WaiverDormancy
 * @property {string} waiverId
 * @property {string} constraintId
 * @property {boolean} dormant - it covered nothing at all
 * @property {boolean} loadBearing - it covered at least one violation
 * @property {boolean} changesStatus - some subject's status depends on it
 * @property {boolean} retirementCandidate - `!changesStatus`
 * @property {number} appliedCount - findings it covered
 * @property {string[]} subjectIds - subjects it touched
 * @property {Array<{ id: string, statusWith: string, statusWithout: string }>} statusDeltas
 * @property {string} reason - `never-matched` | `not-status-bearing` | `load-bearing`
 */

/**
 * The dormancy scan over a whole solve.
 *
 * @typedef {Object} WaiverDormancyReport
 * @property {WaiverDormancy[]} waivers - one per ledger record, in id order
 * @property {string[]} dormantWaiverIds
 * @property {string[]} retirementCandidateIds
 * @property {string[]} loadBearingWaiverIds
 * @property {WaiverFinding[]} findings
 * @property {string} status
 * @property {WaiverMeta} meta
 */

export {};
