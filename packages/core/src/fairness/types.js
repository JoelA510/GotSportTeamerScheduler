/**
 * Type declarations for the fairness and equity layer.
 *
 * JSDoc typedefs only — this file emits no runtime value, exactly as
 * `feasibility/types.js`, `attribution/types.js` and `facility/types.js` do for
 * theirs. It is the single place the shape of a report is written down, so a
 * consumer reads one file rather than inferring the contract from a builder.
 *
 * ## The contracts worth reading before the fields
 *
 * 1. **A measurement is a number or a stated refusal, never both and never
 *    neither.** `measurability === 'measured'` implies a finite `value` and
 *    `reasonCode === null`; `'unmeasurable'` implies `value === null` and a
 *    `reasonCode`. `assertFairnessMeasurement()` enforces both directions.
 * 2. **A judgement is three-valued.** `typical` is an all-clear the module
 *    earned; `undecided` is one it did not, and the two are never merged.
 * 3. **Every flag publishes its comparison basis and its arithmetic.**
 *    `assertFlagEvidence()` refuses one that does not.
 * 4. **`heldOnNarrowerBasis` is three-valued too.** `null` is "no narrower
 *    cohort judged this subject", not "it did not hold".
 *
 * @module fairness/types
 */

/**
 * @typedef {Object} FairnessFinding
 * @property {string} code - a {@link import('./reasonCodes.js').FAIRNESS_REASON} value
 * @property {string} severity - looked up from the frozen table, never passed in
 * @property {string} message - for humans only; never parse it
 * @property {Record<string, unknown>} details - flat primitives, ids and counts
 */

/**
 * One fixture as this module reads it. See `schemas.js` for the parsed contract.
 *
 * @typedef {Object} FairnessFixture
 * @property {string} fixtureId
 * @property {string} scopeId
 * @property {string} competition - a {@link import('./classification.js').FAIRNESS_COMPETITION} value
 * @property {string} date - `YYYY-MM-DD`
 * @property {number|null} kickoffMinutes - minutes past local midnight
 * @property {string|null} venueId
 * @property {string|null} surfaceId
 * @property {string|null} division
 * @property {string|null} ageGroup
 * @property {string|null} format
 * @property {string|null} homeSubjectId
 * @property {string|null} awaySubjectId - null means *no opponent*, not *unknown*
 */

/**
 * What was read and what was set aside to produce one number.
 *
 * Every field named `fixtures*` is a count of **fixtures**, and `exclusions` is
 * a breakdown of `fixturesExcluded` denominated the same way. A group's evidence
 * aggregates its member subjects, and that tally is denominated in *members*, so
 * it travels in its own two fields rather than being added to a count of rows it
 * is not made of.
 *
 * @typedef {Object} FairnessEvidence
 * @property {number} fixturesCounted - fixtures that contributed to the value
 * @property {number} fixturesExcluded - fixtures read and not counted
 * @property {ReadonlyArray<[string, number]>} exclusions - why, and how many each
 * @property {number} [membersCounted] - group subjects only: members that supplied a value
 * @property {number} [membersExcluded] - group subjects only: members that could not
 */

/**
 * @typedef {Object} FairnessMeasurement
 * @property {string} metricId
 * @property {string} unit
 * @property {string} subjectKind - a {@link import('./metrics.js').FAIRNESS_SUBJECT_KIND} value
 * @property {string} subjectId
 * @property {string} measurability - a {@link import('./reasonCodes.js').FAIRNESS_MEASURABILITY} value
 * @property {number|null} value - null if and only if `unmeasurable`
 * @property {string|null} reasonCode - non-null if and only if `unmeasurable`
 * @property {FairnessEvidence} evidence
 */

/**
 * @typedef {Object} FairnessDispersion
 * @property {string} metricId
 * @property {string} state - a {@link import('./reasonCodes.js').FAIRNESS_DISPERSION} value
 * @property {number} size - measurable members
 * @property {number} minimumSize
 * @property {number} threshold
 * @property {number|null} centre - the median; null when there is no member
 * @property {number|null} scale - the median absolute deviation
 * @property {ReadonlyArray<[number, number]>} distribution - observed `[value, count]`
 */

/**
 * @typedef {Object} FairnessBasis
 * @property {string} kind - a {@link import('./outliers.js').FAIRNESS_BASIS} value
 * @property {string} [groupKind]
 * @property {string|null} groupKey
 * @property {number} [populationSize]
 */

/**
 * @typedef {Object} FairnessPopulation
 * @property {string} metricId
 * @property {string} unit
 * @property {string} subjectKind
 * @property {string} basisKind
 * @property {string} groupKey
 * @property {FairnessDispersion} dispersion
 * @property {ReadonlyArray<string>} memberIds
 * @property {ReadonlyArray<string>} undecidedMemberIds
 */

/**
 * @typedef {Object} FairnessJudgement
 * @property {string} metricId
 * @property {string} unit
 * @property {string} subjectKind
 * @property {string} subjectId
 * @property {FairnessBasis} basis
 * @property {string} judgement - a {@link import('./reasonCodes.js').FAIRNESS_JUDGEMENT} value
 * @property {string|null} dispersionState
 * @property {number|null} value
 * @property {number|null} centre
 * @property {number|null} scale
 * @property {number|null} deviation - `value - centre`, in the metric's own unit
 * @property {number|null} score - the modified z-score; never `Infinity`
 * @property {number|null} threshold
 * @property {string|null} direction - a {@link import('./reasonCodes.js').FAIRNESS_DIRECTION} value
 * @property {string|null} reasonCode - why, when `undecided`
 * @property {boolean|null} heldOnNarrowerBasis - three-valued; null is "not checked"
 * @property {FairnessEvidence} evidence
 */

/**
 * @typedef {Object} FairnessParticipation
 * @property {string} subjectId
 * @property {Record<string, number>} byCompetition
 * @property {Array<{ fixture: FairnessFixture, side: string }>} fixtures
 * @property {Set<string>} divisions
 * @property {Set<string>} ageGroups
 */

/**
 * @typedef {Object} FairnessClassification
 * @property {string|null} scopeId - null when the fixtures span more than one
 * @property {ReadonlyArray<string>} scopeIds
 * @property {Readonly<Record<string, number>>} byCompetition
 * @property {number} placeholderFixtures - fixtures naming no participant on either side
 * @property {boolean} usable - false when a blocking finding was raised
 * @property {FairnessFinding[]} findings
 */

/**
 * @typedef {Object} FairnessMetricDefinition
 * @property {string} id
 * @property {string} unit
 * @property {string} label
 * @property {ReadonlyArray<string>} counts - the competitions this metric reads
 * @property {(entries: ReadonlyArray<{ fixture: FairnessFixture, side: string }>) => { value: number|null, reasonCode: string|null, evidence: FairnessEvidence }} measure
 */

/**
 * @typedef {Object} FairnessMeta
 * @property {number} fixturesRead
 * @property {number} fixturesCounted - distinct fixtures a requested metric read
 * @property {number} fixturesPlaceholder
 * @property {number} subjectsConsidered
 * @property {number} measurementsMeasured
 * @property {number} measurementsUnmeasurable
 * @property {number} populationsBuilt
 * @property {number} populationsScored
 * @property {number} judgementsMade
 * @property {number} judgementsUndecided
 * @property {number} flagsRaised
 * @property {number} flagsHeldNarrower
 */

/**
 * @typedef {Object} FairnessReport
 * @property {string} question
 * @property {string|null} scopeId
 * @property {string} status - a {@link import('./reasonCodes.js').FAIRNESS_STATUS} value
 * @property {Readonly<Record<string, number>>} fixturesByCompetition
 * @property {{ stated: boolean, members: string[], guests: string[] }} membership
 * @property {FairnessMeasurement[]} measurements
 * @property {FairnessPopulation[]} populations
 * @property {FairnessJudgement[]} judgements
 * @property {FairnessJudgement[]} flags
 * @property {FairnessFinding[]} findings
 * @property {FairnessMeta} meta
 */

/**
 * One subject's contribution to an objective.
 *
 * @typedef {Object} FairnessObjectiveTerm
 * @property {string} subjectKind
 * @property {string} subjectId
 * @property {string|null} groupKey
 * @property {boolean} scored - false means it contributes nothing, not zero
 * @property {number|null} value
 * @property {number|null} target
 * @property {number|null} penalty
 * @property {string|null} reasonCode
 */

/**
 * @typedef {Object} FairnessObjectiveResult
 * @property {string} question
 * @property {string} objectiveId
 * @property {string} sense - a {@link import('./objectives.js').FAIRNESS_OBJECTIVE_SENSE} value
 * @property {string} unit
 * @property {number} weight
 * @property {string} basisKind
 * @property {number} score - the weighted sum over **scored terms only**
 * @property {number} termsScored
 * @property {number} termsUnscored
 * @property {number} coverage - scored / (scored + unscored); 1 is total
 * @property {string} status
 * @property {FairnessObjectiveTerm[]} terms
 * @property {FairnessFinding[]} findings
 */

export {};
