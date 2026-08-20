/**
 * JSDoc typedefs for the constraint registry.
 *
 * Type-only module: it has no runtime exports and ends with `export {};` so it
 * stays a module, exactly like `packages/core/src/facility/types.js`.
 *
 * The model this file describes is GAP-12's answer. `docs/ARCHITECTURE.md` §6.7
 * records what it replaces: *"Constraints are control flow. There is no table,
 * type, or serialized form for 'this rule, of this hardness, applies to this
 * scope'."* Every field below exists because that sentence made something
 * unrepresentable.
 *
 * @module constraints/types
 */

/**
 * Who wrote a constraint down, when, and on the strength of what.
 *
 * `reference` is **required and non-empty** on purpose: a constraint with no
 * cited origin is the code comment that lost incident 9's waiver, wearing a
 * schema. `setAt` is *nullable* for the opposite reason — several of the real
 * constraints are recorded in the incident log, which preserves the order events
 * happened in but not their dates, and a plausible-looking invented date is
 * worse than an admitted absence. When `setAt` is null, `note` must say why.
 *
 * @typedef {Object} ConstraintSource
 * @property {string} setBy - the person, body or document that set it
 * @property {string|null} setAt - ISO `YYYY-MM-DD`, or null when unrecorded
 * @property {string} reference - where to go and read it for yourself
 * @property {string|null} note - required when `setAt` is null
 */

/**
 * One type change in a constraint's life.
 *
 * This is incident 3 as a data structure: field adjacency was introduced as a
 * preference ("try to leave a field between them") and later hardened to
 * inviolable. The history is kept so that "it was always hard" — which is false
 * and which every earlier schedule version contradicts — cannot be quietly
 * asserted later.
 *
 * @typedef {Object} ConstraintTypeChange
 * @property {string|null} from - a `CONSTRAINT_TYPE` value, null at creation
 * @property {string} to - a `CONSTRAINT_TYPE` value
 * @property {string|null} at - ISO `YYYY-MM-DD`, or null when unrecorded
 * @property {string} by
 * @property {string} note - why it changed
 */

/**
 * What a constraint is narrowed to.
 *
 * Exactly one dimension per record. A rule that is genuinely two-dimensional
 * ("Orchard Park, but only on 09/19") is two records or a `date-range` record —
 * deliberately, because a scope with two axes has no defensible specificity rank
 * against a scope with one, and the whole precedence rule rests on that rank.
 *
 * @typedef {Object} ConstraintScope
 * @property {string} kind - a `CONSTRAINT_SCOPE_KIND` value
 * @property {string|null} venueId
 * @property {string|null} surfaceId - the prompt's "field"
 * @property {string|null} divisionLabel - a label, not a key (GAP-24)
 * @property {string|null} teamId
 * @property {string|null} personId
 * @property {string|null} date - ISO `YYYY-MM-DD`
 * @property {string|null} fromDate - inclusive, for `date-range`
 * @property {string|null} toDate - inclusive, for `date-range`
 * @property {string|null} label - display text, never parsed
 */

/**
 * One constraint, as a record rather than as an `if`.
 *
 * `policy` is the thing being decided (`turnover-minimum`); `id` is one
 * statement about it (`turnover-minimum-orchard-park`). Resolution happens per
 * policy, which is what lets a global floor and a venue-specific override
 * compete while a global floor and an unrelated preference do not.
 *
 * `restrictiveDirection` says which way "more restrictive" points for this
 * record's numeric parameters — `higher` for a minimum gap, `lower` for a
 * maximum gap. It is on the record rather than in a central table because the
 * record is the thing that knows, and a central table is one more place for a
 * new constraint to be forgotten.
 *
 * @typedef {Object} ConstraintRecord
 * @property {string} id
 * @property {string} policy - the decision this record speaks to
 * @property {string} name - display label
 * @property {string} type - a `CONSTRAINT_TYPE` value
 * @property {ConstraintScope} scope
 * @property {Record<string, number|string|boolean|null>} parameters
 * @property {'higher'|'lower'|'none'} restrictiveDirection
 * @property {string} rationale - free text, required
 * @property {ConstraintSource} source
 * @property {string|null} effectiveFrom - inclusive ISO date, null for "always"
 * @property {string|null} effectiveTo - inclusive ISO date, null for "no expiry"
 * @property {string} enforcement - a `CONSTRAINT_ENFORCEMENT` value
 * @property {string[]} reasonCodes - the codes whose severity this record sets
 * @property {number|null} weight - cost of violating (soft) or pull (preference)
 * @property {boolean} waivable - whether a Phase 2.2 waiver may except it
 * @property {ConstraintTypeChange[]} history
 */

/**
 * The built registry. Deep-frozen; every mutation returns a new one.
 *
 * @typedef {Object} ConstraintRegistry
 * @property {string|null} name
 * @property {string|null} source
 * @property {ConstraintRecord[]} constraints - sorted by id
 * @property {string[]} constraintIds
 * @property {Record<string, ConstraintRecord>} byId
 * @property {Record<string, string[]>} idsByPolicy
 * @property {string[]} policies
 * @property {Record<string, string[]>} idsByReasonCode
 * @property {string} status - a `CONSTRAINT_STATUS` value
 * @property {ConstraintFinding[]} findings
 * @property {ConstraintMeta} meta
 * @property {ConstraintRegistryStats} stats
 */

/**
 * Structural counts, so a test can meta-assert the *registry* before asserting
 * any behaviour on it. A registry with zero hard constraints would make every
 * "this is blocked" test pass for the wrong reason.
 *
 * @typedef {Object} ConstraintRegistryStats
 * @property {number} constraintCount
 * @property {number} policyCount
 * @property {number} hardCount
 * @property {number} softCount
 * @property {number} preferenceCount
 * @property {number} wiredCount - `enforcement: 'reason-codes'`
 * @property {number} declaredOnlyCount
 * @property {number} scopedCount - anything other than `global`
 * @property {number} governedReasonCodeCount
 * @property {number} retypedCount - records whose type has ever changed
 * @property {number} waivableCount
 * @property {number} datedSourceCount - records whose source carries a date
 */

/**
 * Counters proving a check actually looked at something.
 *
 * @typedef {Object} ConstraintMeta
 * @property {number} constraintsConsidered
 * @property {number} constraintsApplicable
 * @property {number} constraintsInactive
 * @property {number} constraintsOutOfScope
 * @property {number} scopeDimensionsTested
 * @property {number} policiesResolved
 * @property {number} ambiguitiesReported
 * @property {number} reasonCodesGoverned
 * @property {number} reasonCodesOverridden
 * @property {number} findingsExamined
 * @property {number} findingsReseverified
 * @property {number} evaluationsExamined
 */

/**
 * One machine-readable reason. Identical in shape to `FacilityFinding`,
 * `TimingFinding` and `AvailabilityFinding` so all four merge into one list
 * without a translation layer.
 *
 * @typedef {Object} ConstraintFinding
 * @property {string} code
 * @property {string} severity
 * @property {string} message
 * @property {Record<string, unknown>} details
 */

/**
 * Where a caller is standing when it asks the registry a question.
 *
 * Every field is optional, and an absent field is *not* a wildcard: a
 * venue-scoped record judged against a context with no `venueId` is reported
 * `CONSTRAINT_SCOPE_UNJUDGED`, never quietly dropped.
 *
 * `surfaceLineage` is the surface plus its ancestors (`FacilitySurface.lineage`),
 * so that a rule about Pitch 1 governs a booking on 1A. It is passed in rather
 * than looked up because this module must not import the facility *graph* — only
 * its severity vocabulary.
 *
 * @typedef {Object} ScopeContext
 * @property {string} [date] - ISO `YYYY-MM-DD`
 * @property {string} [venueId]
 * @property {string} [surfaceId]
 * @property {string[]} [surfaceLineage] - defaults to `[surfaceId]`
 * @property {string} [divisionLabel]
 * @property {string} [teamId]
 * @property {string[]} [teamIds] - both sides of a fixture
 * @property {string} [personId]
 * @property {string[]} [personIds]
 */

/**
 * Why one record did or did not apply to one context.
 *
 * @typedef {Object} ConstraintApplicability
 * @property {string} constraintId
 * @property {boolean} applicable
 * @property {boolean} inWindow
 * @property {boolean} inScope
 * @property {boolean} judged - false when the context could not decide
 * @property {number} specificity
 * @property {string|null} code - the `CONSTRAINT_REASON` explaining a `false`
 */

/**
 * The resolved position for one policy in one context.
 *
 * `byType` holds the winner in each hardness tier rather than a single winner,
 * because a hard floor and a soft preference on the same policy are not rivals:
 * "10 minutes is the floor" and "20 minutes is what we aim for" are both true at
 * once, and collapsing them would delete one of them.
 *
 * @typedef {Object} ResolvedPolicy
 * @property {string} policy
 * @property {ConstraintRecord|null} effective - hardest tier that has a winner
 * @property {Record<string, ConstraintRecord|null>} byType
 * @property {ConstraintApplicability[]} applicability - every candidate, judged
 * @property {ConstraintFinding[]} findings
 * @property {ConstraintMeta} meta
 * @property {string} status
 */

/**
 * The effective severity of every governed reason code in one context.
 *
 * @typedef {Object} EffectiveSeverityTable
 * @property {Record<string, string>} severityByCode - governed codes only
 * @property {SeverityOverride[]} overrides
 * @property {ConstraintFinding[]} findings
 * @property {ConstraintMeta} meta
 * @property {string} status
 */

/**
 * One reason code's severity as the registry sets it, next to what the frozen
 * Phase 1 table says on its own.
 *
 * `changed: false` is the common and reassuring case: it means the registry
 * wrote down a policy that was already true, which is exactly what seeding an
 * existing system should do.
 *
 * @typedef {Object} SeverityOverride
 * @property {string} code
 * @property {string} baseSeverity
 * @property {string} severity
 * @property {string} constraintId
 * @property {string} constraintType
 * @property {boolean} changed
 */

/**
 * The answer to "what would change if this constraint went back to being a
 * preference?"
 *
 * @typedef {Object} ConstraintTypeProjection
 * @property {string} constraintId
 * @property {string} currentType
 * @property {string} proposedType
 * @property {boolean} changed
 * @property {ConstraintRegistry} projectedRegistry - ready to re-run a solve with
 * @property {Array<{ code: string, from: string, to: string }>} severityDeltas
 * @property {Array<{ code: string, from: string, to: string, findingCount: number }>} findingDeltas
 * @property {Array<{ id: string, statusBefore: string, statusAfter: string }>} statusDeltas
 * @property {ConstraintFinding[]} findings
 * @property {ConstraintMeta} meta
 * @property {string} status
 */

export {};
