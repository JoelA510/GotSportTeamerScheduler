/**
 * JSDoc typedefs for the standing rule engine.
 *
 * Type-only module: no runtime exports, ending in `export {};` so it stays a
 * module, exactly like `facility/types.js`, `constraints/types.js` and
 * `waivers/types.js`.
 *
 * The model this file describes is Prompt 2.3's answer to incident 4 in
 * `fixtures/season-2026/README.md`. Two fields carry most of that weight:
 * {@link RuleDefinition.exercise}, which is **required** and is what a rule
 * must prove about itself before its verdict is worth reading, and
 * {@link RuleResult.exercised}, which is the engine's judgement on that proof.
 *
 * @module ruleEngine/types
 */

/**
 * One machine-readable reason. Identical in shape to `FacilityFinding`,
 * `TimingFinding`, `AvailabilityFinding`, `ConstraintFinding` and
 * `WaiverFinding`, so all six merge into one list without a translation layer.
 *
 * @typedef {Object} RuleFinding
 * @property {string} code
 * @property {string} severity
 * @property {string} message
 * @property {Record<string, unknown>} details
 */

/**
 * One scheduled row the engine judges.
 *
 * Deliberately **not** the corpus's `Season2026Game`: the engine takes ids and
 * minutes, and knows nothing about CSV columns. `homeTeamId` and `awayTeamId`
 * are nullable because a third of the combined schedule has no two named teams
 * — placeholders, Minis sessions, reservations and non-member opponents — and
 * the honest model keeps them representable rather than dropping the rows.
 *
 * `homeLabel` / `awayLabel` are display text and are **never** used as an
 * identifier by any rule. That distinction is incident 4's second half: the
 * checker that read `Select Game 7` as a team code was reading a label.
 *
 * @typedef {Object} ScheduledGame
 * @property {string} id
 * @property {string} date - ISO `YYYY-MM-DD`
 * @property {number} startMinutes - minutes past midnight
 * @property {number|null} endMinutes - null when the footprint is unknown (GAP-14)
 * @property {string} venueId
 * @property {string} surfaceId
 * @property {string|null} format
 * @property {string|null} divisionLabel - a label, not a key (GAP-24)
 * @property {string|null} homeTeamId
 * @property {string|null} awayTeamId
 * @property {string} homeLabel - display text, never parsed
 * @property {string} awayLabel - display text, never parsed
 * @property {boolean} counted - whether the round-robin and balance rules count it
 */

/**
 * One person's commitment to be somewhere, already resolved.
 *
 * The engine does not build these: no roster join, no identity resolution. That
 * is the personal timeline, GAP-19, and Prompt 3.1's subject. The adapter
 * supplies them, which is exactly the seam a deliberately-broken team-name join
 * is injected at.
 *
 * @typedef {Object} ScheduledCommitment
 * @property {string} id
 * @property {string} personId
 * @property {string} date - ISO `YYYY-MM-DD`
 * @property {number} startMinutes
 * @property {number|null} endMinutes
 * @property {string} venueId
 * @property {string|null} surfaceId
 * @property {string|null} teamId
 * @property {string|null} gameId
 */

/**
 * The whole thing a run judges.
 *
 * The `*Universe` fields are not decoration and are not derivable from `games`:
 * they are the schedule's statement of *what identifiers of each kind exist*,
 * and the engine checks every identifier a rule claims to have matched against
 * them. `placeholderLabels` is the same statement in the negative — the labels
 * that appear in the rows and are **not** identifiers of anything.
 *
 * @typedef {Object} Schedule
 * @property {string|null} name
 * @property {ScheduledGame[]} games
 * @property {ScheduledCommitment[]} commitments
 * @property {Array<{ id: string, divisionLabel: string|null, groupLabel: string|null, personIds: string[] }>} teams
 * @property {string[]} teamUniverse
 * @property {string[]} personUniverse
 * @property {string[]} divisionUniverse
 * @property {string[]} surfaceUniverse
 * @property {string[]} venueUniverse
 * @property {string[]} placeholderLabels
 */

/**
 * What a rule promises to have done, declared as data on the rule.
 *
 * **This is the centre of Prompt 2.3.** It is on the definition rather than
 * asserted inside the rule body for two reasons: a body assertion is invisible
 * to anything but the body, and a rule shipped without one would look exactly
 * like a rule that needs none. `RuleDefinitionSchema` requires this field and
 * requires it to be non-empty, so "a new rule forgot its meta-assertion" is a
 * build-time refusal rather than a review comment somebody might not leave.
 *
 * - `minimums` — counter name to floor. `{ personPairsCompared: 1 }` is *"the
 *   coach rule must assert it evaluated more than zero person-pairs"*.
 * - `coverage` — counter name to a universe on the {@link Schedule}. The
 *   counter must equal the size of that universe: *"the round-robin rule must
 *   assert it examined every division"* is `{ divisionsExamined: 'division' }`.
 * - `identifierKinds` — which universe each list of matched identifiers is
 *   judged against. This is the shape check, and the only one of the three that
 *   catches a rule matching the **wrong** data rather than too little of it.
 *
 * @typedef {Object} RuleExercise
 * @property {Record<string, number>} minimums
 * @property {Record<string, string>} coverage - counter -> `RULE_IDENTIFIER_KIND`
 * @property {string[]} identifierKinds - `RULE_IDENTIFIER_KIND` values
 * @property {string} rationale - why these are the right numbers to demand
 */

/**
 * One rule, as a record rather than as a function somebody remembered to call.
 *
 * @typedef {Object} RuleDefinition
 * @property {string} id
 * @property {string} title
 * @property {string[]} constraintIds - the registry constraints it enforces;
 *   empty means it enforces none, which is reported rather than assumed
 * @property {string[]} reasonCodes - every code it may emit
 * @property {Record<string, string[]>} constraintIdByCode - which of the rule's
 *   constraints each code belongs to; an empty list means "none of them, so no
 *   waiver may excuse it"
 * @property {RuleExercise} exercise
 * @property {string} rationale
 * @property {(schedule: Schedule, context: RuleContext) => RuleOutput} evaluate
 */

/**
 * What a rule is handed when it runs.
 *
 * @typedef {Object} RuleContext
 * @property {import('../constraints/types.js').ConstraintRegistry} registry
 * @property {import('../constraints/types.js').EffectiveSeverityTable} severityTable
 * @property {Record<string, unknown>} resources - evaluator handles supplied by
 *   the caller (`graph`, `timingTable`, `calendar`); a rule that needs one it
 *   was not given must say so rather than skip itself
 * @property {RuleDefinition} rule
 */

/**
 * What a rule returns.
 *
 * `counters` is the evidence for {@link RuleExercise}; `matched` is the
 * evidence for the shape half of it. A rule that returns neither cannot pass
 * its own expectation and the engine says so.
 *
 * @typedef {Object} RuleOutput
 * @property {Array<import('../waivers/types.js').WaiverSubject>} subjects
 * @property {RuleFinding[]} findings - rule-level, not attached to a subject
 * @property {Record<string, number>} counters
 * @property {Record<string, string[]>} matched - identifier kind -> ids matched
 */

/**
 * The engine's verdict on one rule's exercise expectation.
 *
 * @typedef {Object} RuleExerciseVerdict
 * @property {string} ruleId
 * @property {boolean} satisfied
 * @property {Record<string, number>} counters
 * @property {Array<{ counter: string, observed: number|null, required: number, kind: string }>} shortfalls
 * @property {Array<{ kind: string, identifier: string, code: string }>} badIdentifiers
 * @property {RuleFinding[]} findings
 * @property {number} identifiersChecked
 */

/**
 * One rule's whole result.
 *
 * @typedef {Object} RuleResult
 * @property {string} ruleId
 * @property {string} title
 * @property {string[]} constraintIds
 * @property {boolean} ran - false when the rule threw
 * @property {boolean} exercised - it proved it looked at the right data
 * @property {RuleExerciseVerdict} exercise
 * @property {Array<import('../waivers/types.js').WaiverSubject>} subjects
 * @property {RuleFinding[]} findings - the rule's own, before waivers
 * @property {number} subjectCount
 * @property {number} violationCount
 * @property {string} status
 */

/**
 * One violation, in the shape the prompt asks for.
 *
 * > *Each violation reports: constraint id, severity, the entities involved,
 * > the computed values (e.g. "gap 50 min, minimum 60"), and whether a waiver
 * > applies.*
 *
 * `severity` is the **effective** one: after the registry's severity table has
 * spoken and after any waiver has demoted a `blocking` to a `compromise`.
 * `baseSeverity` is what it was before either, because a schedule that is legal
 * only because adjacency is currently a preference has to be able to say so.
 *
 * @typedef {Object} RuleViolation
 * @property {string} ruleId
 * @property {string} code
 * @property {string} severity
 * @property {string} baseSeverity
 * @property {string|null} constraintId - the primary constraint, when there is one
 * @property {string[]} constraintIds
 * @property {string} subjectId
 * @property {Array<{ kind: string, id: string }>} entities
 * @property {Record<string, number|string|boolean|null>} computed
 * @property {string} summary - `"gap 50 min, minimum 60 min"`, rendered once
 * @property {string} message
 * @property {boolean} waived
 * @property {string|null} waiverId
 * @property {string|null} waivedBy
 * @property {Record<string, unknown>} details
 */

/**
 * Which registry constraints something checks, and which nothing checks.
 *
 * @typedef {Object} RuleCoverage
 * @property {string[]} constraintIds - every constraint in the registry
 * @property {string[]} enforcedConstraintIds
 * @property {string[]} unenforcedConstraintIds
 * @property {Record<string, string[]>} ruleIdsByConstraintId
 * @property {string[]} rulesEnforcingNothing
 * @property {RuleFinding[]} findings
 */

/**
 * The whole result of a run.
 *
 * @typedef {Object} RuleEngineResult
 * @property {RuleResult[]} rules
 * @property {Record<string, RuleResult>} byRuleId
 * @property {RuleViolation[]} violations
 * @property {RuleFinding[]} findings - engine-level plus every rule's, flattened
 * @property {RuleCoverage} coverage
 * @property {import('../waivers/types.js').WaiverApplication|null} waivers
 * @property {import('../waivers/types.js').WaiverDormancyReport|null} dormancy
 * @property {string} status
 * @property {string} disposition - a `WAIVER_DISPOSITION` value
 * @property {RuleEngineMeta} meta
 */

/**
 * Counters proving a run actually looked at something.
 *
 * @typedef {Object} RuleEngineMeta
 * @property {number} rulesRegistered
 * @property {number} rulesRun
 * @property {number} rulesExercised
 * @property {number} rulesUnderExercised
 * @property {number} rulesThrew
 * @property {number} constraintsCovered
 * @property {number} constraintsUnenforced
 * @property {number} subjectsExamined
 * @property {number} findingsExamined
 * @property {number} violationsReported
 * @property {number} violationsWaived
 * @property {number} exerciseChecksRun
 * @property {number} identifiersChecked
 */

/**
 * The full-schedule validation report.
 *
 * @typedef {Object} ValidationReport
 * @property {string|null} scheduleName
 * @property {Record<string, number>} countBySeverity - every severity, always
 *   present, even at zero
 * @property {Record<string, RuleViolation[]>} violationsBySeverity
 * @property {Record<string, number>} countByCode
 * @property {Record<string, number>} countByRuleId
 * @property {Record<string, number>} countByConstraintId
 * @property {number} violationCount
 * @property {number} waivedCount
 * @property {number} unwaivedCount
 * @property {string[]} unenforcedConstraintIds
 * @property {string[]} underExercisedRuleIds
 * @property {string[]} dormantWaiverIds
 * @property {RuleFinding[]} findings
 * @property {string} status
 * @property {string} disposition
 * @property {RuleEngineMeta} meta
 */

export {};
